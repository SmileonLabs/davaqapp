import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/davaqAuth";
import { useGetMe, useRegisterPushToken } from "@workspace/api-client-react";
import {
  ensureWebPushIfGranted,
  getCurrentWebPushSubscriptionToken,
  registerPushServiceWorker,
  setWebPushOwner,
  webPushSupported,
} from "@/lib/webPush";
import { revokePushRegistrationWithBearer } from "@/lib/pushOwnership";
import { pushRegistrationCoordinator } from "@/lib/pushRegistrationCoordinator";

/**
 * Web-only: silently re-subscribes to web push on load when the user is signed
 * in, has notifications enabled, and has already granted permission. Never
 * prompts — the prompt is triggered from the notification settings toggle.
 */
export function PushRegistrar() {
  const { isSignedIn, getToken } = useAuth();
  const { data: me } = useGetMe();
  const registerPushToken = useRegisterPushToken();
  const ownerId = isSignedIn ? (me?.id ?? null) : null;
  const registeredOwnerRef = useRef<string | null>(null);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const ownerTokenRef = useRef(pushRegistrationCoordinator.setOwner(ownerId));
  ownerTokenRef.current = pushRegistrationCoordinator.setOwner(ownerId);
  const notificationEnabledRef = useRef(me?.notificationEnabled === true);
  notificationEnabledRef.current = me?.notificationEnabled === true;

  // Hold the latest mutate fn in a ref so the registration effect does NOT
  // depend on the (unstable) mutation object. Each mutateAsync call flips the
  // mutation's isPending state, producing a new object reference — if that were
  // in the dependency array the effect would re-run and re-register on every
  // call, creating an infinite push-token registration loop.
  const registerRef = useRef(registerPushToken.mutateAsync);
  registerRef.current = registerPushToken.mutateAsync;

  // Register the push service worker once on load. Web push (and `.ready`, which
  // several components await) only works once a SW controls the page, and the
  // Expo web app ships none by default — so register ours up front, independent
  // of sign-in. Idempotent + best-effort.
  useEffect(() => {
    if (!webPushSupported) return;
    void registerPushServiceWorker();
  }, []);

  // When the browser rotates the push subscription, the service worker
  // re-subscribes and posts the fresh subscription here so we re-register it
  // with the server immediately — preventing the stale endpoint from delivering
  // duplicate pushes alongside the new one.
  useEffect(() => {
    if (!webPushSupported) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.type === "push-subscription-changed" && typeof data.subscription === "string") {
        if (!ownerRef.current || !notificationEnabledRef.current) return;
        const ownerToken = ownerTokenRef.current;
        if (!ownerToken) return;
        void pushRegistrationCoordinator
          .enqueue(ownerToken, () =>
            registerRef.current({ data: { token: data.subscription } }),
          )
          .catch(() => false);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Bind background display to the active account. The old bearer is captured
  // before logout/account switch; cleanup never consults the new global auth
  // context and the server removes the credential only from that old owner.
  useEffect(() => {
    if (!webPushSupported) return;
    if (!ownerId) {
      registeredOwnerRef.current = null;
      void setWebPushOwner(null);
      return;
    }

    const effectOwnerToken = ownerTokenRef.current;
    if (!effectOwnerToken || effectOwnerToken.ownerId !== ownerId) return;
    const capturedBearer = getToken().catch(() => null);
    const refreshOwnerLease = () => void setWebPushOwner(ownerId);
    refreshOwnerLease();
    const ownerLeaseTimer = setInterval(refreshOwnerLease, 6 * 60 * 60 * 1_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshOwnerLease();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(ownerLeaseTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (registeredOwnerRef.current === ownerId) {
        registeredOwnerRef.current = null;
      }
      pushRegistrationCoordinator.clearIfCurrent(effectOwnerToken);
      void setWebPushOwner(null);
      void pushRegistrationCoordinator
        .enqueueCleanup(async () => {
          const [bearer, token] = await Promise.all([
            capturedBearer,
            getCurrentWebPushSubscriptionToken(),
          ]);
          await revokePushRegistrationWithBearer(token, bearer);
        })
        .catch(() => undefined);
    };
  }, [getToken, ownerId]);

  useEffect(() => {
    if (!webPushSupported) return;
    if (!ownerId || !me?.notificationEnabled) {
      if (registeredOwnerRef.current === ownerId) registeredOwnerRef.current = null;
      return;
    }
    if (registeredOwnerRef.current === ownerId) return;
    // Claim the one-shot up-front so this never runs more than once per
    // sign-in / enable, even across rapid re-renders.
    registeredOwnerRef.current = ownerId;
    let cancelled = false;
    void (async () => {
      try {
        const ownerToken = ownerTokenRef.current;
        if (!ownerToken || ownerToken.ownerId !== ownerId) return;
        await ensureWebPushIfGranted((token) =>
          pushRegistrationCoordinator.enqueue(ownerToken, () =>
            registerRef.current({ data: { token } }),
          ),
        );
      } catch {
        // Transient failure — drop the guard so a later dependency change retries.
        if (!cancelled && registeredOwnerRef.current === ownerId) {
          registeredOwnerRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me?.notificationEnabled, ownerId]);

  return null;
}
