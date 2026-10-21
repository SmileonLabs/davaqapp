import type { ShopMarketHistoryPoint } from './types';

export type HistoryValue = { time: string; value: number };
export type HistorySeries = { key: string; sample: ShopMarketHistoryPoint; values: HistoryValue[] };

/** Keep editions, conditions and currencies separate; use the latest observation per day. */
export function historySeries(points: readonly ShopMarketHistoryPoint[]): HistorySeries[] {
  const groups = new Map<string, { sample: ShopMarketHistoryPoint; days: Map<string, ShopMarketHistoryPoint> }>();
  for (const point of points) {
    const date = point.priceDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !Number.isFinite(point.amountMinor) || point.amountMinor < 0) continue;
    const key = JSON.stringify([point.shopCode, point.sourceProductId, point.priceType, point.currencyCode, point.conditionLabel, point.gradingLabel]);
    const group = groups.get(key) ?? { sample: point, days: new Map<string, ShopMarketHistoryPoint>() };
    const previous = group.days.get(date);
    if (!previous || (Date.parse(point.observedAt) || 0) >= (Date.parse(previous.observedAt) || 0)) group.days.set(date, point);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({ key, sample: group.sample, values: [...group.days.values()].sort((a, b) => a.priceDate.localeCompare(b.priceDate)).map(p => ({ time: p.priceDate, value: p.amountMinor })) })).sort((a, b) => b.values.length - a.values.length || a.key.localeCompare(b.key));
}

export function historyRange(values: readonly HistoryValue[], days: number): HistoryValue[] {
  if (!days || !values.length) return [...values];
  const from = Date.parse(values[values.length - 1]!.time) - (days - 1) * 86_400_000;
  return values.filter(p => Date.parse(p.time) >= from);
}

/** Average actual observations, never fabricated missing dates. */
export function historyAverage(values: readonly HistoryValue[], count = 7): HistoryValue[] {
  if (count < 1) return [];
  return values.slice(count - 1).map((p, index) => ({ time: p.time, value: values.slice(index, index + count).reduce((sum, item) => sum + item.value, 0) / count }));
}
