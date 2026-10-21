import { chartTemplate } from './template';
import type { Detail } from '@/lib/tcg';
export function chartHtml(detail: Detail) {
  const d = detail.target;
  const points = detail.history.map(p => ({
    shopCode: d.id.startsWith('kream:') ? 'kream' : d.id.startsWith('cardmarket:') ? 'cardmarket-' + (d.id.endsWith(':foil') ? 'foil' : 'regular') : 'justtcg-reference',
    shopName: d.region === 'KR' ? 'KREAM' : d.region === 'EU' ? 'Cardmarket' : 'JustTCG',
    sourceProductId: d.id.startsWith("kream:") ? d.id.slice(6) : d.id, displayName: d.name, conditionLabel: d.condition === "SOURCE_PRODUCT" ? null : d.condition,
    gradingLabel: null, priceType: d.priceType === 'SOLD' ? 'SOLD' : 'LISTED',
    priceDate: p.date.slice(0,10), amountMinor: p.amount, currencyCode: p.currency,
    observedAt: p.date,
  }));
  return chartTemplate.replace('DAVAQ_POINTS_TOKEN', JSON.stringify(points).replace(/</g, '\\u003c'));
}
