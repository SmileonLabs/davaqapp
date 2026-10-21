/** Only validated identifiers cross scanner/quote navigation boundaries. */
export type ShopScanContext = { shopId: string; quoteId: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const card =
  /^(kream:\d+|justtcg:[a-f0-9-]{36}|cardmarket:[a-z_]+:\d+:(regular|foil))$/;
export function shopScanContext(p: {
  shopId?: unknown;
  quoteId?: unknown;
}): ShopScanContext | null {
  return typeof p.shopId === "string" &&
    uuid.test(p.shopId) &&
    typeof p.quoteId === "string" &&
    uuid.test(p.quoteId)
    ? { shopId: p.shopId.toLowerCase(), quoteId: p.quoteId.toLowerCase() }
    : null;
}
export function validShopScanCard(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && card.test(value);
}
export function validShopScanId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export function shopScanHref(
  context: ShopScanContext,
  cardId?: string,
  scanId?: string,
) {
  const p = new URLSearchParams(context);
  if (cardId && validShopScanCard(cardId)) p.set("cardId", cardId);
  if (scanId && validShopScanId(scanId)) p.set("scanId", scanId);
  return `/shop/scan?${p}`;
}
export function shopScannerHref(context: ShopScanContext, live = false) {
  return `/tcg/${live ? "live-scan" : "scan"}?${new URLSearchParams(context)}`;
}
