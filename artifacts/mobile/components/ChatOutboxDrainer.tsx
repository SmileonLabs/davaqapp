import React, { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/expo";
import { AppState, Platform } from "react-native";
import {
  useGetMe,
} from "@workspace/api-client-react";
import { sendChatMessage as sendMessageRequest } from "@/lib/chatTransport";
import {
  canRetryChatOutboxEntry,
  ChatOutboxDrainOwnerFence,
  isRetryableChatDeliveryError,
  markChatOutboxAttempt,
  markChatOutboxFailure,
  type ChatOutboxEntry,
  type ChatOutboxDrainToken,
} from "@/lib/chatOutboxPolicy";
import {
  clearChatOutboxForOwner,
  loadChatOutbox,
  removeChatOutboxEntry,
  sweepExpiredChatOutboxes,
  tryAcquireChatOutboxDelivery,
  upsertChatOutboxEntry,
} from "@/lib/chatMessageOutbox";
import {
  noteChatMessageAck,
  noteChatPending,
  noteChatResource,
} from "@/lib/chatPerformanceDiagnostics";

const DRAIN_BATCH_SIZE = 3;
const DRAIN_INTERVAL_MS = 5_000;
// Survives the brief descendant unmount/remount that ApiAuthBridge performs
// during an in-process Clerk account transition.
let lastAuthenticatedOutboxOwnerId: string | null = null;
let lastAuthenticatedClerkUserId: string | null = null;

function foregroundNetworkIsUsable(): boolean {
  if (Platform.OS === "web") {
    return (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      (typeof navigator === "undefined" || navigator.onLine !== false)
    );
  }
  return AppState.currentState === "active";
}

/**
 * Retries durable messages even after their room screen has unmounted. Work is
 * scoped to the authenticated user, capped to three sequential sends per
 * trigger, and shares an operation lease with the mounted-room sender.
 */
export function ChatOutboxDrainer() {
  const { isLoaded, isSignedIn, userId: clerkUserId } = useAuth();
  const { data: me } = useGetMe();
  const ownerFenceRef = useRef(new ChatOutboxDrainOwnerFence());
  const flushCallbackRef = useRef<() => Promise<void>>(async () => {});
  const hasPendingRef = useRef(false);
  const controllersRef = useRef(new Map<string, AbortController>());

  const deliver = useCallback(
    async (entry: ChatOutboxEntry, ownerToken: ChatOutboxDrainToken) => {
      const release = tryAcquireChatOutboxDelivery(
        entry.senderId,
        entry.clientMessageId,
      );
      if (!release) return;

      const controller = new AbortController();
      controllersRef.current.set(entry.clientMessageId, controller);
      const timeout = setTimeout(() => controller.abort(), 12_000);
      noteChatResource("timers", 1);
      noteChatPending("messageSend", 1);
      const attempted = markChatOutboxAttempt(entry, Date.now());
      try {
        try {
          await upsertChatOutboxEntry(entry.senderId, attempted);
          if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        } catch {
          return;
        }

        try {
          await sendMessageRequest(
            entry.roomId,
            {
              content: entry.content,
              type: entry.type,
              replyToMessageId: entry.replyToMessageId,
              clientMessageId: entry.clientMessageId,
            },
            {
              signal: controller.signal,
              headers: {
                "x-request-id": entry.clientMessageId,
                // New durable entries always capture the profile used at send
                // time. Never silently substitute the currently active profile.
                "x-character-profile-id": entry.senderProfileId!,
              },
            },
          );
        } catch (error) {
          // Logout/account switch deletion owns the final write. Never recreate
          // A's plaintext after its controller was aborted and namespace cleared.
          if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
          const failed = markChatOutboxFailure(
            attempted,
            Date.now(),
            isRetryableChatDeliveryError(error),
          );
          try {
            await upsertChatOutboxEntry(entry.senderId, failed);
          } catch {
            // The previously durable operation remains for a later trigger.
          }
          return;
        }

        noteChatMessageAck(entry.createdAt);
        try {
          await removeChatOutboxEntry(entry.senderId, entry.clientMessageId);
        } catch {
          // A later retry is safe because the server deduplicates this ID.
        }
      } finally {
        clearTimeout(timeout);
        noteChatResource("timers", -1);
        if (controllersRef.current.get(entry.clientMessageId) === controller) {
          controllersRef.current.delete(entry.clientMessageId);
        }
        noteChatPending("messageSend", -1);
        release();
      }
    },
    [],
  );

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      const previousOwnerId = lastAuthenticatedOutboxOwnerId;
      lastAuthenticatedOutboxOwnerId = null;
      lastAuthenticatedClerkUserId = null;
      if (previousOwnerId) {
        void clearChatOutboxForOwner(previousOwnerId).catch(() => undefined);
      }
      return;
    }
    // Clerk switches identity before B's /users/me request necessarily
    // completes. Clear the captured backend owner A at that auth boundary
    // instead of leaving its plaintext resident while B is loading/offline.
    if (clerkUserId) {
      if (
        lastAuthenticatedClerkUserId &&
        lastAuthenticatedClerkUserId !== clerkUserId
      ) {
        const previousOwnerId = lastAuthenticatedOutboxOwnerId;
        lastAuthenticatedOutboxOwnerId = null;
        if (previousOwnerId) {
          void clearChatOutboxForOwner(previousOwnerId).catch(() => undefined);
        }
      }
      lastAuthenticatedClerkUserId = clerkUserId;
    }
    if (!me?.id) return;
    const previousOwnerId = lastAuthenticatedOutboxOwnerId;
    lastAuthenticatedOutboxOwnerId = me.id;
    if (previousOwnerId && previousOwnerId !== me.id) {
      void clearChatOutboxForOwner(previousOwnerId).catch(() => undefined);
    }
  }, [clerkUserId, isLoaded, isSignedIn, me?.id]);

  const flush = useCallback(async () => {
    if (!foregroundNetworkIsUsable()) return;
    const token = ownerFenceRef.current.tryBegin();
    if (!token) return;
    try {
      const entries = await loadChatOutbox(token.ownerId);
      if (!ownerFenceRef.current.isCurrent(token)) return;
      const currentUserEntries = entries.filter(
        (entry) => entry.senderId === token.ownerId,
      );
      hasPendingRef.current = currentUserEntries.some(
        (entry) =>
          Boolean(entry.senderProfileId) &&
          entry.deliveryState === "pending" &&
          entry.retryable,
      );

      // An old row without a captured profile cannot be replayed without risk
      // of attributing it to a different active character. It remains visible
      // for manual handling until normal outbox retention removes it.
      const retryable = currentUserEntries
        .filter(
          (entry) =>
            Boolean(entry.senderProfileId) &&
            canRetryChatOutboxEntry(entry, Date.now()),
        )
        .slice(0, DRAIN_BATCH_SIZE);
      for (const entry of retryable) {
        if (!ownerFenceRef.current.isCurrent(token)) return;
        await deliver(entry, token);
      }
    } catch {
      // Private browsing/storage failures are retried on the next lifecycle tick.
    } finally {
      if (ownerFenceRef.current.finish(token)) {
        queueMicrotask(() => void flushCallbackRef.current());
      }
    }
  }, [deliver]);
  flushCallbackRef.current = flush;

  useEffect(() => {
    // Sweep every stored account namespace on cold startup and auth changes;
    // pruning only the current user's key would leave signed-out users' message
    // bodies on a shared device beyond the documented 24-hour retention.
    void sweepExpiredChatOutboxes().catch(() => {
      // Storage may be unavailable in private browsing. Retry on the next
      // startup/session transition without preventing the active owner drain.
    });
    ownerFenceRef.current.setOwner(me?.id ?? null);
    if (!me?.id) {
      hasPendingRef.current = false;
      return;
    }
    void flush();
    const timer = setInterval(() => {
      if (hasPendingRef.current) void flush();
    }, DRAIN_INTERVAL_MS);
    noteChatResource("timers", 1);

    const resume = () => void flush();
    let removeLifecycleListeners: () => void;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("online", resume);
      window.addEventListener("pageshow", resume);
      document.addEventListener("visibilitychange", resume);
      noteChatResource("listeners", 3);
      removeLifecycleListeners = () => {
        window.removeEventListener("online", resume);
        window.removeEventListener("pageshow", resume);
        document.removeEventListener("visibilitychange", resume);
        noteChatResource("listeners", -3);
      };
    } else {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") resume();
      });
      noteChatResource("listeners", 1);
      removeLifecycleListeners = () => {
        subscription.remove();
        noteChatResource("listeners", -1);
      };
    }

    return () => {
      ownerFenceRef.current.setOwner(null);
      clearInterval(timer);
      noteChatResource("timers", -1);
      removeLifecycleListeners();
      for (const controller of controllersRef.current.values()) controller.abort();
      controllersRef.current.clear();
    };
  }, [flush, me?.id]);

  return null;
}
