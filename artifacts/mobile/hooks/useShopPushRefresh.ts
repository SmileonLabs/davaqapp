import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/davaqAuth";
import { shopQueryAffected, shopEventTargets } from "@/lib/shopRealtime";
import { subscribeShopPush } from "@/lib/shopPushRefresh";
/** Uses the existing owner-fenced native and service-worker push transports. */
export function useShopPushRefresh() {
  const client = useQueryClient(),
    { isSignedIn, userId } = useAuth();
  useEffect(() => {
    if (!isSignedIn) return;
    const refresh = (shopId?: string) =>
      void client.invalidateQueries({
        predicate: (q) => shopQueryAffected(q.queryKey, shopId),
      });
    const unsubscribe = subscribeShopPush(refresh);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const message = (e: MessageEvent) => {
      if (e.data?.type !== "data-changed") return;
      const t = shopEventTargets("shop.message.created", e.data);
      if (t) refresh(t.shopId);
    };
    if (Platform.OS === "web" && typeof navigator !== "undefined")
      navigator.serviceWorker?.addEventListener("message", message);
    return () => {
      unsubscribe();
      app.remove();
      if (Platform.OS === "web" && typeof navigator !== "undefined")
        navigator.serviceWorker?.removeEventListener("message", message);
    };
  }, [client, isSignedIn, userId]);
}
