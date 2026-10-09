import { endSystemCall } from "@/lib/androidTelecom";
import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { AppState } from "react-native";
import {
  getCall,
  useGetMe,
  useRegisterPushToken,
} from "@workspace/api-client-react";
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
} from "@/lib/callNotifications.android";
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
    if (!ownerId) {
      void setCurrentNativePushOwner(null);
      void cancelIncomingCallNotification();
      return;
    }
    const effectOwnerToken = ownerTokenRef.current;
    if (!effectOwnerToken || effectOwnerToken.ownerId !== ownerId) return;
    const capturedBearer = getToken().catch(() => null);
    const refreshOwnerLease = () => void setCurrentNativePushOwner(ownerId);
    refreshOwnerLease();
    const ownerLeaseTimer = setInterval(
      refreshOwnerLease,
      NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS,
    );
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") refreshOwnerLease();
      },
    );
    return () => {
      clearInterval(ownerLeaseTimer);
      appStateSubscription.remove();
      pushRegistrationCoordinator.clearIfCurrent(effectOwnerToken);
      // A late cleanup must not erase a lease already rebound to account B.
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
  }, [getToken, ownerId]);

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
    if (!nativePushSupported) return;
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

  // FCM can rotate device tokens. Keep the server-side token list fresh instead
  // of waiting until the old token starts failing during sends.
  useEffect(() => {
    if (!nativePushSupported) return;
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
  // Telecom action path below because they need accept/decline semantics, not navigation.
  useEffect(() => {
    if (!nativePushSupported || !ownerId) return;

    const navigate = (url: string) => {
      routerRef.current.navigate(url as any);
    };

    const unsubscribe = subscribeNotificationOpen(navigate);
    if (!initialNotificationHandled.current) {
      initialNotificationHandled.current = true;
      void (async () => {
        const url = await getInitialNotificationUrl();
        if (url) navigate(url);
      })();
    }
    return unsubscribe;
  }, [ownerId]);

  // Wire incoming-call notifications and their accept/decline actions.
  useEffect(() => {
    if (!ownerId) return;

    const isStillRinging = async (intent: IncomingCallIntent) => {
      try {
        const call = await getCall(intent.callId);
        return call.status === "ringing";
      } catch {
        // If the status check fails, prefer ringing over silently dropping a real call.
        return true;
      }
    };

    const accept = async (intent: IncomingCallIntent) => {
      await cancelIncomingCallNotification();
      return joinRef.current(intent.callId, intent.callerName, intent.media);
    };
    const decline = async (intent: IncomingCallIntent) => {
      await cancelIncomingCallNotification();
      // Tell the server so the call records as "declined" instead of ringing
      // out to "missed" on the caller's side.
      return declineRef.current(intent.callId);
    };

    const unsubActions = subscribeCallActions({
      onAccept: async (intent) => {
        if (await accept(intent))
          await clearPendingCallIntent(intent.callId, "accept");
      },
      onDecline: async (intent) => {
        if (await decline(intent))
          await clearPendingCallIntent(intent.callId, "decline");
      },
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
              await endSystemCall(intent.callId);
              await cancelIncomingCallNotification(intent.callId);
              await clearPendingCallIntent(intent.callId);
            }
          } catch {}
        }),
      );
    };
    void reconcileTrackedNotifications();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") void reconcileTrackedNotifications();
      },
    );

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
      unsubActions();
      unsubIncoming();
      appStateSubscription.remove();
    };
  }, [ownerId]);

  return null;
}
