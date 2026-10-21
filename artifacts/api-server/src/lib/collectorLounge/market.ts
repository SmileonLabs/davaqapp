import { redact } from "./policy";
import { tcgRead } from "../tcgCatalog";
export type MarketObservation = {
  cardId: string;
  name: string;
  currency: "KRW";
  priceType: "LISTED";
  scope: "source_product";
  conditionLabel: string;
  fromDate: string;
  toDate: string;
  from: number;
  to: number;
  changePercent: number;
  points: number;
  observedAt: string;
  sourceLabel: string;
  url: string;
};
const date = (s: unknown) =>
  typeof s === "string" &&
  /^20\d{2}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s
    ? s
    : null;
// The upstream KREAM history endpoint explicitly filters LISTED, not SOLD.
// It does not retain per-point condition/grade, so no sale or grade claim is made.
export function marketObservation(
  id: string,
  data: any,
  now = new Date(),
): MarketObservation | null {
  const t = data?.target;
  if (
    !/^kream:\d+$/.test(id) ||
    t?.id !== id ||
    t.priceType !== "LISTED" ||
    t.currency !== "KRW" ||
    typeof t.name !== "string" ||
    !Array.isArray(data.history)
  )
    return null;
  const observed = Date.parse(t.observedAt);
  if (
    !Number.isFinite(observed) ||
    observed > now.getTime() + 15 * 60000 ||
    now.getTime() - observed > 48 * 3600000
  )
    return null;
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10),
    prices = new Map<string, number>();
  for (const point of data.history) {
    const d = date(point.date);
    if (
      !d ||
      d > day ||
      point.currency !== "KRW" ||
      !Number.isFinite(point.amount) ||
      point.amount <= 0 ||
      point.amount > 1e12
    )
      continue;
    if (prices.has(d) && prices.get(d) !== point.amount) return null;
    prices.set(d, point.amount);
  }
  const points = [...prices].sort(([a], [b]) => a.localeCompare(b));
  const end = points.at(-1);
  if (!end || Date.parse(day) - Date.parse(end[0]) > 2 * 86400000) return null;
  const threshold = Date.parse(end[0]) - 7 * 86400000;
  const start = points
    .filter(
      ([d]) =>
        Date.parse(d) <= threshold && Date.parse(d) >= threshold - 2 * 86400000,
    )
    .at(-1);
  if (!start) return null;
  const window = points.filter(([d]) => d >= start[0] && d <= end[0]);
  if (
    window.length < 7 ||
    window.some(
      ([d], i) =>
        i > 0 && Date.parse(d) - Date.parse(window[i - 1][0]) > 2 * 86400000,
    )
  )
    return null;
  return {
    cardId: id,
    name: redact(t.name).slice(0, 160),
    currency: "KRW",
    priceType: "LISTED",
    scope: "source_product",
    conditionLabel: "원문 상품 기준 · 상태/등급 미분리",
    fromDate: start[0],
    toDate: end[0],
    from: start[1],
    to: end[1],
    changePercent: Math.round((end[1] / start[1] - 1) * 1000) / 10,
    points: window.length,
    observedAt: new Date(observed).toISOString(),
    sourceLabel: "TCGINDEX · KREAM 판매 호가 관측",
    url: "https://davaq.app/app/tcg/card/detail?id=" + encodeURIComponent(id),
  };
}
export async function collectorMarket(id: string) {
  if (!/^kream:\d+$/.test(id)) return null;
  try {
    return marketObservation(
      id,
      await tcgRead("/api/mobile/v1/cards/detail", { id }, 6000),
    );
  } catch {
    return null;
  }
}
