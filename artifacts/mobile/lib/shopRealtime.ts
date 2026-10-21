import { validShopScanId } from "./shopScan.ts";
export function shopEventTargets(type: string, data?: Record<string, unknown>) {
  if (
    !["shop.message.created", "shop.thread.updated"].includes(type) ||
    !validShopScanId(data?.shopId) ||
    !validShopScanId(data?.threadId)
  )
    return null;
  return { shopId: data.shopId, threadId: data.threadId };
}
export function shopQueryAffected(key: readonly unknown[], shopId?: string) {
  const path = key[0] === "davaq" ? key[2] : null;
  if (typeof path !== "string") return false;
  return (
    path === "/shops" ||
    path === "/shops/inbox" ||
    (shopId ? path.startsWith(`/shops/${shopId}/`) : path.startsWith("/shops/"))
  );
}
