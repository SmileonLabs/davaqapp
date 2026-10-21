import { notifyChatPush, chatRoomFromPush } from "@/lib/chatPushRefresh";
import { customFetch } from "@workspace/api-client-react";
import { isGroupCallId, dispatchGroupCallAction } from "@/lib/groupCallActions";
import { useEffect, useRef } from "react";
import { endSystemCall, subscribeSystemCallActions, setApplePushOwner, clearApplePushOwner, subscribeApplePushToken } from "@/lib/systemCalls";
import { useAuth } from "@/lib/davaqAuth";
import { useRouter } from "expo-router";
import { getApplePushCredentials } from "@/lib/applePush";
import { AppState, Platform } from "react-native";
import { getCall, useGetMe, useRegisterPushToken } from "@workspace/api-client-react";
import { useCall } from "@/components/CallProvider";
import {
  cancelIncomingCallNotification,
  cancelExpiredIncomingCallNotifications,
  clearPendingCallIntent,
  consumePendingCallIntent,
  displayIncomingCallNotification,
  getTrackedIncomingCalls,
  setupCallNotifications,
  subscribeCallActions,
  type IncomingCallIntent,
} from "@/lib/callNotifications";
import {
  getInitialNotificationUrl,
  getExistingNativePushToken,
  nativePushSupported,
  registerForPushTokenAsync,
  setupNotificationHandler,
  subscribeForegroundIncomingCall,
  subscribeNotificationOpen,
  subscribePushTokenRefresh,
} from "@/lib/nativePush";
import {
  clearCurrentNativePushOwner,
  NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS,
  setCurrentNativePushOwner,
} from "@/lib/nativePushOwner";
import { revokePushRegistrationWithBearer } from "@/lib/pushOwnership";
import { pushRegistrationCoordinator } from "@/lib/pushRegistrationCoordinator";

/**
 * Native-only counterpart to PushRegistrar. Registers the device push token,
 * shows a full-screen incoming-call notification for `incoming_call` data
 * messages, and routes accept/decline taps into the call flow.
 */
export function NativePushRegistrar() {
  const { isSignedIn, getToken, userId: clerkUserId } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const router = useRouter();
  const { data: me } = useGetMe();
  // A profile switch temporarily evicts /users/me from React Query. Preserve
  // the backend owner through that same-Clerk-account gap, but discard it
  // immediately when the Clerk account itself changes.
  const ownerIdentityRef = useRef<{
    clerkUserId: string | null;
    ownerId: string | null;
  }>({ clerkUserId: null, ownerId: null });
  if (!isSignedIn || !clerkUserId) {
    ownerIdentityRef.current = { clerkUserId: null, ownerId: null };
  } else {
    if (ownerIdentityRef.current.clerkUserId !== clerkUserId) {
      ownerIdentityRef.current = { clerkUserId, ownerId: null };
    }
    if (me?.id) ownerIdentityRef.current.ownerId = me.id;
  }
  const ownerId = ownerIdentityRef.current.ownerId;
  const ownerTokenRef = useRef(pushRegistrationCoordinator.setOwner(ownerId));
  ownerTokenRef.current = pushRegistrationCoordinator.setOwner(ownerId);
  const registerPushToken = useRegisterPushToken();
  const { joinFromCard, declineFromCard } = useCall();

  // Hold latest mutate / join fns in refs so the effects don't re-run (and
  // re-subscribe / re-register) every time these unstable objects change.
  const registerRef = useRef(registerPushToken.mutateAsync);
  registerRef.current = registerPushToken.mutateAsync;
  const joinRef = useRef(joinFromCard);
  joinRef.current = joinFromCard;
  const declineRef = useRef(declineFromCard);
  declineRef.current = declineFromCard;
  const routerRef = useRef(router);
  routerRef.current = router;
  const done = useRef(false);
  const registrationOwnerRef = useRef<string | null>(null);
  const lastRegistrationAt = useRef(0);
  const initialNotificationHandled = useRef(false);

  // One-time native setup: notification display behaviour + the call channel.
  useEffect(() => {
    if (!nativePushSupported) return;
    setupNotificationHandler();
    void setupCallNotifications();
  }, []);

  // Persist the signed-in owner for headless FCM handlers. Cleanup uses the
  // old account's captured bearer and only revokes that old server binding.
  useEffect(() => {
    if (!nativePushSupported) return;
    if (!ownerId) {
      void endSystemCall();
      void setCurrentNativePushOwner(null);
      void cancelIncomingCallNotification();
      return;
    }
    const effectOwnerToken = ownerTokenRef.current;
    if (!effectOwnerToken || effectOwnerToken.ownerId !== ownerId) return;
    let capturedBearer = getTokenRef.current().catch(() => null);
    const effectClerkUserId = clerkUserId;
    const refreshBearer = () => {
      if (ownerIdentityRef.current.clerkUserId === effectClerkUserId &&
          ownerIdentityRef.current.ownerId === ownerId) {
        capturedBearer = getTokenRef.current().catch(() => null);
      }
    };
    const bearerTimer = setInterval(refreshBearer, 30_000);
    const refreshOwnerLease = () => void setCurrentNativePushOwner(ownerId);
    refreshOwnerLease();
    const ownerLeaseTimer = setInterval(
      refreshOwnerLease,
      NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS,
    );
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") { refreshOwnerLease(); refreshBearer(); }
    });
    return () => {
      clearInterval(ownerLeaseTimer);
      clearInterval(bearerTimer);
      appStateSubscription.remove();
      pushRegistrationCoordinator.clearIfCurrent(effectOwnerToken);
      // A late cleanup must not erase a lease already rebound to account B.
      void endSystemCall();
      void clearCurrentNativePushOwner(ownerId);
      void cancelIncomingCallNotification();
      void pushRegistrationCoordinator
        .enqueueCleanup(async () => {
          const [bearer, token] = await Promise.all([
            capturedBearer,
            getExistingNativePushToken(),
          ]);
          await revokePushRegistrationWithBearer(token, bearer);
        })
        .catch(() => undefined);
    };
  }, [ownerId]);

  // Reset the registration guard so a later sign-in / re-enable re-registers.
  useEffect(() => {
    if (
      registrationOwnerRef.current !== ownerId ||
      me?.notificationEnabled === false
    ) {
      registrationOwnerRef.current = ownerId;
      done.current = false;
      lastRegistrationAt.current = 0;
    }
  }, [me?.notificationEnabled, ownerId]);

  // Register once at sign-in and retry after a denied/transient token lookup.
  // Refresh on foreground at a bounded interval so an APK whose initial
  // registration failed does not remain permanently unreachable for calls.
  useEffect(() => {
    if (!nativePushSupported || Platform.OS === "ios") return;
    if (!ownerId || !me?.notificationEnabled) return;
    let mounted = true;
    let registrationInFlight = false;
    const effectOwnerToken = ownerTokenRef.current;
    if (!effectOwnerToken || effectOwnerToken.ownerId !== ownerId) return;
    const registerDevice = async (force = false) => {
      const sixHours = 6 * 60 * 60 * 1000;
      if (registrationInFlight) return;
      if (
        !force &&
        done.current &&
        Date.now() - lastRegistrationAt.current < sixHours
      ) {
        return;
      }
      registrationInFlight = true;
      try {
        const token = await registerForPushTokenAsync();
        if (!token || !mounted) {
          done.current = false;
          return;
        }
        const registered = await pushRegistrationCoordinator.enqueue(
          effectOwnerToken,
          () => registerRef.current({ data: { token } }),
        );
        if (!mounted || !registered) return;
        done.current = true;
        lastRegistrationAt.current = Date.now();
      } catch {
        done.current = false;
      } finally {
        registrationInFlight = false;
      }
    };

    void registerDevice();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerDevice();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [me?.notificationEnabled, ownerId]);

  // iOS uses APNs directly for alerts and PushKit for calls. Store credentials
  // independently of FCM configuration and message-notification preferences.
  useEffect(() => {
    if (Platform.OS !== "ios" || !ownerId) return;
    const effectOwnerToken = ownerTokenRef.current;
    if (!effectOwnerToken) return;
    let mounted = true;
    let inFlight = false;
    const registered = new Set<string>();
    let capturedBearer = getTokenRef.current().catch(() => null);
    const effectClerkUserId = clerkUserId;
    const refresh = async () => {
      if (!mounted || inFlight) return;
      if (ownerIdentityRef.current.clerkUserId === effectClerkUserId &&
          ownerIdentityRef.current.ownerId === ownerId) {
        capturedBearer = getTokenRef.current().catch(() => null);
      }
      inFlight = true;
      try {
        await setApplePushOwner(ownerId);
        const tokens = await getApplePushCredentials();
        for (const token of tokens) {
          if (!mounted || registered.has(token)) continue;
          const saved = await pushRegistrationCoordinator.enqueue(effectOwnerToken, () => registerRef.current({ data: { token } }));
          if (saved) registered.add(token);
        }
      } catch (error) {
        console.warn("Apple push registration failed", error instanceof Error ? error.message : "unknown");
      } finally { inFlight = false; }
    };
    void refresh();
    const tokenListener = subscribeApplePushToken(() => void refresh());
    const stateListener = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    const retry = setInterval(() => void refresh(), 30_000);
    return () => {
      mounted = false;
      clearInterval(retry); tokenListener(); stateListener.remove();
      void clearApplePushOwner(ownerId);
      void pushRegistrationCoordinator.enqueueCleanup(async () => {
        const bearer = await capturedBearer;
        await Promise.all(Array.from(registered).map(token => revokePushRegistrationWithBearer(token, bearer)));
      }).catch(() => {});
    };
  }, [ownerId]);

  // FCM can rotate device tokens. Keep the server-side token list fresh instead
  // of waiting until the old token starts failing during sends.
  useEffect(() => {
    if (!nativePushSupported || Platform.OS === "ios") return;
    if (!ownerId || !me?.notificationEnabled) return;
    return subscribePushTokenRefresh((token) => {
      const ownerToken = ownerTokenRef.current;
      if (!ownerToken || ownerToken.ownerId !== ownerId) return;
      void pushRegistrationCoordinator
        .enqueue(ownerToken, () => registerRef.current({ data: { token } }))
        .then((registered) => {
          if (!registered) return;
          done.current = true;
          lastRegistrationAt.current = Date.now();
        })
        .catch(() => {
          done.current = false;
        });
    });
  }, [me?.notificationEnabled, ownerId]);

  // Route regular FCM notification taps. Incoming-call action taps stay on the
  // notifee path below because they need accept/decline semantics, not navigation.
  useEffect(() => {
    if (!nativePushSupported || !ownerId) return;

    const navigate = (url: string) => {
      notifyChatPush(chatRoomFromPush({ url }));
      routerRef.current.navigate(url as any);
    };

    const unsubscribe = subscribeNotificationOpen(navigate);
    if (!initialNotificationHandled.current) {
      initialNotificationHandled.current = true;
      void (async () => {
        await setCurrentNativePushOwner(ownerId);
        const url = await getInitialNotificationUrl();
        if (url) navigate(url);
      })();
    }
    return unsubscribe;
  }, [ownerId]);

  // Wire incoming-call notifications and their accept/decline actions.
  useEffect(() => {
    if (!nativePushSupported || !ownerId) return;

    const isStillRinging = async (intent: IncomingCallIntent) => {
      try {
        if (isGroupCallId(intent.callId)) {
          const group = await customFetch<{ status: string; expiresAt: number }>(`/api/group-calls/${intent.callId}`, { responseType: "json" });
          return group.status === "active" && group.expiresAt > Date.now();
        }
        const call = await getCall(intent.callId);
        return call.status === "ringing";
      } catch {
        // If the status check fails, prefer ringing over silently dropping a real call.
        return true;
      }
    };

    const accept = async (intent: IncomingCallIntent) => {
      await cancelIncomingCallNotification();
      if (isGroupCallId(intent.callId)) return dispatchGroupCallAction(intent.callId, "join");
      return joinRef.current(intent.callId, intent.callerName, intent.media);
    };
    const decline = async (intent: IncomingCallIntent) => {
      await cancelIncomingCallNotification();
      // Tell the server so the call records as "declined" instead of ringing
      // out to "missed" on the caller's side.
      if (isGroupCallId(intent.callId)) return dispatchGroupCallAction(intent.callId, "decline");
      return declineRef.current(intent.callId);
    };

    const unsubActions = subscribeCallActions({
      onAccept: (intent) => {
        void accept(intent);
      },
      onDecline: (intent) => {
        void decline(intent);
      },
    });
    const unsubSystem = subscribeSystemCallActions((event) => {
      if (event.action === "accept") {
        void accept(event.intent).then(handled => {
          if (!handled) void endSystemCall(event.intent.callId);
        }).catch(() => void endSystemCall(event.intent.callId));
      } else if (event.action === "decline") {
        void decline(event.intent).catch(() => {});
      }
    });
    const unsubIncoming = subscribeForegroundIncomingCall((intent) => {
      void (async () => {
        if (await isStillRinging(intent)) {
          await displayIncomingCallNotification(intent);
        }
      })();
    });

    // Android can display a notification while this JS runtime is suspended.
    // Reconcile its persisted per-call IDs against the authenticated API whenever
    // the app wakes, rather than letting an old ringing notification survive.
    const reconcileTrackedNotifications = async () => {
      await cancelExpiredIncomingCallNotifications();
      const tracked = await getTrackedIncomingCalls();
      await Promise.all(
        tracked.map(async ({ intent }) => {
          try {
            if (!(await isStillRinging(intent))) {
              await cancelIncomingCallNotification(intent.callId);
              await clearPendingCallIntent(intent.callId);
            }
          } catch {}
        }),
      );
    };
    void reconcileTrackedNotifications();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reconcileTrackedNotifications();
    });

    // Cold start: an accept/decline tapped while the app was killed (handled in
    // the headless background context and persisted) is replayed here.
    void (async () => {
      const queued = await consumePendingCallIntent();
      if (!queued) return;
      if (!(await isStillRinging(queued.intent))) {
        await clearPendingCallIntent();
        return;
      }
      const handled =
        queued.action === "accept"
          ? await accept(queued.intent)
          : await decline(queued.intent);
      if (handled) await clearPendingCallIntent();
    })();

    return () => {
      unsubSystem();
      unsubActions();
      unsubIncoming();
      appStateSubscription.remove();
    };
  }, [ownerId]);

  return null;
}
