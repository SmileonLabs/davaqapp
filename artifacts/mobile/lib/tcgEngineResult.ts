/** DAVAQ-owned photo response, not the public/member photo API. */
export type EnginePrice = {
  state: 'checking'|'identified'|'priced'|'review'|'catalog_missing'|'held'|'privacy_blocked'|'unsupported';
  price: number|null; currency: string; priceType: string; statusMessage?: string; dataVersion?: string; checkedAt?: string;
  estimate?: { amount: number; currency: string; referenceKind?: 'other_printing'; converted?: boolean; priceType?: string; low?:number; high?:number; count?:number; observedAt?:string; source?:string; method?:'ai'|'market_reference'|'catalog_reference'; sourceCurrency?:string; sourceLanguage?:string; sourceNumber?:string }|null;
};
export type EngineScan = {
  id: string; object_path: string; status: string;
  result?: { targetId?: string|null; name?: string; number?: string; cardVerified?: boolean;
    matchLevel?: 'printing'|'card'; engine?: {stage: string}; candidates?: {name:string;href:string}[];
    price?: EnginePrice; engineVersion?: string; identityVersion?: string }|null;
};
export function scanNeedsRefresh(scan: EngineScan): boolean {
  const result = scan.result;
  // Private photos remain review even when recognition/pricing has completed.
  if (result?.price) return result.price.state === 'checking' ||
    (result.price.state === 'identified' && !['complete','review'].includes(result.engine?.stage ?? ''));
  return !['identified','review','published','failed'].includes(scan.status);
}
export function scanPriceLabel(scan: EngineScan): string {
  const price = scan.result?.price;
  if (!price) return '가격 확인 중';
  if (price.state !== 'priced') return price.statusMessage || ({checking:'가격 확인 중',identified:'카드 확인 · 가격 자료 부족',review:'판본 추가 확인 필요',catalog_missing:'카드 자료 확인 필요',held:'가격 표시 보류',privacy_blocked:'사진 개인정보 확인 필요',unsupported:'지원하지 않는 카드'}[price.state]);
  const reference = price.estimate?.referenceKind === 'other_printing';
  const exact = scan.result?.cardVerified === true && scan.result.matchLevel === 'printing';
  const amount = reference ? price.estimate?.amount : price.price ?? price.estimate?.amount;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return '가격 자료 없음';
  const currency = reference ? price.estimate!.currency : price.currency;
  const label = reference ? '다른 판본 참고가' : !exact ? '판본 미확정 참고가' : price.price != null ? '동일 판본 가격' : price.estimate?.method === 'ai' ? '동일 판본 AI 추정가' : '동일 판본 참고가';
  return `${label} ${amount.toLocaleString()} ${currency}${price.estimate?.converted ? ' · 환산' : ''}${(price.estimate?.priceType ?? price.priceType) === 'LISTED' ? ' · 판매 호가' : ''}`;
}
