import { shopEventTargets } from "./shopRealtime.ts";
type Listener = (shopId: string) => void;
const listeners = new Set<Listener>();
export function notifyShopPush(data: Record<string, unknown> | undefined) {
  const target = shopEventTargets("shop.message.created", data);
  if (target) for (const listener of listeners) listener(target.shopId);
}
export function subscribeShopPush(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
