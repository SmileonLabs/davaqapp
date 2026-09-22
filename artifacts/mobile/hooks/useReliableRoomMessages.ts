import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFetchRoomMessagesQueryKey,
  type Message,
} from "@workspace/api-client-react";
import {
  fetchAllMessagesAfter,
  catchUpCoversLatestWindow,
  ConfirmedCatchUpCursor,
  ConfirmedCatchUpCursorRegistry,
  confirmedCatchUpIsCommitted,
  maxConfirmedRoomSeq,
  mergeConcurrentChatWrites,
  mergeChatMessages,
  reconcileLatestMessageWindow,
} from "@/lib/chatMessageReliability";
import {
  loadConfirmedChatCursor,
  saveConfirmedChatCursor,
} from "@/lib/chatConfirmedCursorStore";
import {
  noteChatRender,
  noteChatResource,
} from "@/lib/chatPerformanceDiagnostics";

import { fetchChatMessages as fetchRoomMessages } from "@/lib/chatTransport";

const LATEST_WINDOW_SIZE = 50;
const CATCH_UP_PAGE_SIZE = 100;
const confirmedCursors = new ConfirmedCatchUpCursorRegistry();

/**
 * Reconciles the latest server window with every row after the last confirmed
 * roomSeq. This is intentionally different from a plain 50-row refetch: if the
 * socket was offline while 51+ messages arrived, every intermediate page is
 * fetched before the query cache is replaced.
 */
export function useReliableRoomMessages(
  roomId: string,
  identity: { userId?: string | null; profileId?: string | null; pollInterval?: number },
) {
  const queryClient = useQueryClient();
  const queryKey = getFetchRoomMessagesQueryKey(roomId);
  const cursorKey = useMemo(
    () =>
      roomId && identity.userId && identity.profileId
        ? `${identity.userId}\u0000${identity.profileId}\u0000${roomId}`
        : null,
    [identity.profileId, identity.userId, roomId],
  );
  const [hydratedCursorKey, setHydratedCursorKey] = useState<string | null>(null);
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<{
    key: string;
    cursorState: { key: string; cursor: ConfirmedCatchUpCursor };
    catchUpMessages: Message[];
    lastSeq: number;
    complete: boolean;
  } | null>(null);
  const pendingStructuralMergeRef = useRef<{
    result: Message[];
    snapshot: Message[];
  } | null>(null);
  const cursorRef = useRef<{
    key: string;
    cursor: ConfirmedCatchUpCursor;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHydratedCursorKey(null);
    if (!cursorKey || !identity.userId || !identity.profileId || !roomId) {
      cursorRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    const state = {
      key: cursorKey,
      cursor: confirmedCursors.forRoom(cursorKey),
    };
    cursorRef.current = state;
    void loadConfirmedChatCursor(identity.userId, identity.profileId, roomId)
      .then((persisted) => {
        if (cancelled || cursorRef.current !== state) return;
        // Persisted values were advanced only after a successful server page.
        // Taking max with a live in-memory cursor is therefore safe.
        state.cursor.advance(persisted);
        setHydratedCursorKey(cursorKey);
      })
      .catch(() => {
        if (cancelled || cursorRef.current !== state) return;
        // Storage can be unavailable in private browsing. Starting from zero
        // (or the still-live confirmed cursor) causes redundant fetches, not a
        // skipped interval.
        setHydratedCursorKey(cursorKey);
      });

    return () => {
      cancelled = true;
    };
  }, [cursorKey, identity.profileId, identity.userId, roomId]);

  useEffect(
    () => () => {
      if (continuationTimerRef.current) {
        clearTimeout(continuationTimerRef.current);
        continuationTimerRef.current = null;
        noteChatResource("timers", -1);
      }
    },
    [cursorKey],
  );

  const query = useQuery<Message[]>({
    queryKey,
    enabled: !!cursorKey && hydratedCursorKey === cursorKey,
    refetchOnReconnect: true,
    refetchInterval: identity.pollInterval ? (q) => q.state.data?.some(m => ["queued", "running"].includes(String(m.metadata?.replyState ?? ""))) ? identity.pollInterval! : 15000 : false,
    refetchIntervalInBackground: false,
    structuralSharing: (oldData, newData) => {
      const pending = pendingStructuralMergeRef.current;
      if (!pending || pending.result !== newData) return newData;
      pendingStructuralMergeRef.current = null;
      return mergeConcurrentChatWrites(
        pending.snapshot,
        Array.isArray(oldData) ? (oldData as Message[]) : [],
        newData as Message[],
      ) as Message[];
    },
    queryFn: async ({ signal }) => {
      const current = queryClient.getQueryData<Message[]>(queryKey) ?? [];
      const cursorState = cursorRef.current;
      if (!cursorState || cursorState.key !== cursorKey) {
        throw new Error("room catch-up cursor changed during synchronisation");
      }
      const lastSeq = cursorState.cursor.current;

      const latestPromise = fetchRoomMessages(
        roomId,
        { limit: LATEST_WINDOW_SIZE },
        { signal },
      );
      const catchUpPromise =
        lastSeq > 0
          ? fetchAllMessagesAfter<Message>(
              lastSeq,
              (afterSeq, limit) =>
                fetchRoomMessages(
                  roomId,
                  // afterSeq is part of the checked OpenAPI contract. The
                  // generated type is refreshed by codegen in this change set.
                  { afterSeq, limit },
                  { signal },
                ),
              { pageSize: CATCH_UP_PAGE_SIZE },
            )
          : null;
      const [latest, catchUp] = await Promise.all([
        latestPromise,
        catchUpPromise,
      ]);
      const reconciledLatest = reconcileLatestMessageWindow(
        current,
        latest,
        LATEST_WINDOW_SIZE,
      );

      // A zero cursor means this installation has no proof of a contiguous
      // receive position. Bootstrap from the authoritative latest window and
      // commit that window as the baseline; replaying an entire mature room
      // (potentially tens of thousands of rows) would make first-open memory
      // and render cost grow without bound. Older history belongs to a separate
      // backward-pagination path, not reconnect recovery.
      if (lastSeq === 0) {
        const baselineSeq = maxConfirmedRoomSeq(latest);
        if (!signal.aborted && cursorRef.current === cursorState) {
          pendingCommitRef.current = {
            key: cursorKey!,
            cursorState,
            catchUpMessages: latest,
            lastSeq: baselineSeq,
            complete: true,
          };
        }
        noteChatRender("catchUpPages", 0);
        const result = mergeConcurrentChatWrites(
          current,
          queryClient.getQueryData<Message[]>(queryKey) ?? [],
          reconciledLatest,
        ) as Message[];
        pendingStructuralMergeRef.current = { result, snapshot: current };
        return result;
      }

      if (!catchUp) {
        throw new Error("known room cursor requires a catch-up result");
      }
      noteChatRender("catchUpPages", catchUp.pages);
      const reconciled = mergeChatMessages(
        reconciledLatest,
        catchUp.messages,
      ) as Message[];
      if (!signal.aborted && cursorRef.current === cursorState) {
        // React Query may still discard this result if the request is aborted
        // during return/unmount. Cursor persistence happens in the commit
        // effect below, only after dataUpdatedAt proves the cache accepted it.
        pendingCommitRef.current = {
          key: cursorKey!,
          cursorState,
          catchUpMessages: catchUp.messages,
          lastSeq: catchUp.lastSeq,
          complete: catchUpCoversLatestWindow(catchUp, latest),
        };
      }
      const result = mergeConcurrentChatWrites(
        current,
        queryClient.getQueryData<Message[]>(queryKey) ?? [],
        reconciled,
      ) as Message[];
      pendingStructuralMergeRef.current = { result, snapshot: current };
      return result;
    },
  });

  useEffect(() => {
    if (!query.isSuccess || !query.dataUpdatedAt) return;
    const pending = pendingCommitRef.current;
    if (
      !pending ||
      pending.key !== cursorKey ||
      cursorRef.current !== pending.cursorState ||
      !confirmedCatchUpIsCommitted(query.data ?? [], pending.catchUpMessages) ||
      !identity.userId ||
      !identity.profileId
    ) {
      return;
    }
    pendingCommitRef.current = null;
    pending.cursorState.cursor.advance(pending.lastSeq);
    void saveConfirmedChatCursor(
      identity.userId,
      identity.profileId,
      roomId,
      pending.cursorState.cursor.current,
    ).catch(() => {
      // A stale persisted cursor causes duplicate catch-up, never a gap.
    });

    if (!pending.complete && continuationTimerRef.current === null) {
          // Continue a deliberately bounded sync even if no realtime event
          // arrives. The identity/cursor fence prevents an old room timer from
          // refetching a newly opened room.
          continuationTimerRef.current = setTimeout(() => {
            continuationTimerRef.current = null;
            noteChatResource("timers", -1);
            if (cursorRef.current !== pending.cursorState) return;
            void queryClient.invalidateQueries({ queryKey, exact: true });
          }, 1_000);
          noteChatResource("timers", 1);
        } else if (pending.complete && continuationTimerRef.current) {
          clearTimeout(continuationTimerRef.current);
          continuationTimerRef.current = null;
          noteChatResource("timers", -1);
    }
  }, [
    cursorKey,
    identity.profileId,
    identity.userId,
    query.dataUpdatedAt,
    query.isSuccess,
    queryClient,
    queryKey,
    roomId,
  ]);

  return query;
}
