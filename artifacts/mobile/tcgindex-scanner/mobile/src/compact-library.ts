export const COMPACT_MODEL_SHA = '98c98a68aefaf1d923ded91b71ee78a60d1eefdbb9b2202a86a01fdbe0225a4e';
export type CompactPart = {key: string; bytes: number};
export type CompactPack = {
  version: 1; engine: 'card-encoder-256-v1'; usearchVersion:'2.26.3'; game: string; complete: true;
  dimensions: 256; generatedAt: string; count: number; cardCount: number;
  model: CompactPart; index: CompactPart; cards: CompactPart; prices: CompactPart;
};
export const COMPACT_PARTS = ['model', 'index', 'cards', 'prices'] as const;
export function parseCompactPack(value: unknown, game: string): CompactPack {
  const v = value as CompactPack;
  if (v?.version !== 1 || v.engine !== 'card-encoder-256-v1' || v.usearchVersion !== '2.26.3' || v.dimensions !== 256 || v.game !== game || v.complete !== true ||
      !Number.isFinite(Date.parse(v.generatedAt)) || !Number.isInteger(v.count) || v.count < 1 || v.count > 100000 ||
      !Number.isInteger(v.cardCount) || v.cardCount < v.count || v.cardCount > 100000) throw Error('카드 데이터 형식이 올바르지 않습니다.');
  for (const name of COMPACT_PARTS) {
    const p = v[name];
    if (!p || !/^[a-f0-9]{64}$/.test(p.key) || !Number.isInteger(p.bytes) || p.bytes < 1 || p.bytes > 100000000) throw Error('카드 데이터 크기가 올바르지 않습니다.');
  }
  if (v.model.key !== COMPACT_MODEL_SHA) throw Error('앱과 카드 인식 모델의 버전이 다릅니다.');
  return v;
}
import type {Card} from './scanner';
export function compactEventCards(json: string | undefined): Card[] {
  if (!json || json.length>250000) return [];
  try {
    const values = JSON.parse(json) as Card[];
    if (!Array.isArray(values) || values.length>96) return [];
    return values.filter(c => c && typeof c.id==='string' && typeof c.name==='string' && typeof c.number==='string' && typeof c.language==='string' &&
      /^\/market\/(?:printings|kream|catalog|photos)\/[A-Za-z0-9%:._-]+$/.test(c.href) &&
      /^\/(?:market\/images\/kream\/[a-f0-9]{64}|api\/catalog\/images\/[a-f0-9]{64}|api\/card-photos\/[a-f0-9-]{36})$/.test(c.image));
  } catch {return [];}
}

export type ScannerResults = {card: Card | null; comparables: Card[]; similar: Card[]};
type ScannerResultEvent = {id: string; ids: string[]; confirmed: boolean; cardsJson?: string; metadataRefresh?:boolean};

/** Live frames and selected photos share one result transition. A missed frame
 * retains the confirmed card and its price evidence until a new card succeeds. */
export function nextScannerResults(previous: ScannerResults, event: ScannerResultEvent, legacyCards: ReadonlyMap<string, Card> | undefined, showSimilar: boolean): ScannerResults {
  const found = legacyCards ? event.ids.flatMap(id => legacyCards.get(id) ?? []) : compactEventCards(event.cardsJson);
  if(event.metadataRefresh&&!event.confirmed)return {card:null,comparables:[],similar:[]};
  if (event.confirmed) {
    const cardId = event.id.startsWith('catalog:') ? event.id.slice(8) : event.id;
    const card = legacyCards ? legacyCards.get(event.id) : found.find(c => c.id === cardId || c.id === event.id);
    return card ? {card, comparables: found, similar: []} : previous;
  }
  return showSimilar && !previous.card ? {...previous, similar: found.slice(0, 3)} : previous;
}
