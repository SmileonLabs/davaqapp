import {unitVector,type Card,type Reference} from './scanner.ts';
import type {IndexCard} from './scanner-index.ts';
export const FEATURE_BYTES=2336;
export const SCANNER_MODEL='mobilenet-v3-small-v1';
export const SCANNER_MODEL_SHA='bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40';
export type LibraryCard=IndexCard&{card:Card;part:string;offset:number};
export type Library={version:3;model:string;modelSha:string;complete:boolean;game:string;generatedAt:string;photoReferencesVersion?:number;cards:LibraryCard[];parts:{key:string;bytes:number}[]};
const photoId='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const publicImage=(s:string)=>/^\/(?:market\/images\/kream|api\/catalog\/images)\/[a-f0-9]{64}$/.test(s)||new RegExp('^/api/card-photos/'+photoId+'$').test(s);
const publicHref=(s:string)=>/^\/market\/(?:printings|kream|catalog)\/[A-Za-z0-9%:._-]+$/.test(s)||new RegExp('^/market/photos/'+photoId+'$').test(s);
export function parseLibrary(value:unknown,game:string):Library {
 const v=value as Library;
 if(v?.version!==3||v.model!==SCANNER_MODEL||v.modelSha!==SCANNER_MODEL_SHA||v.game!==game||!Number.isFinite(Date.parse(v.generatedAt))||!Array.isArray(v.cards)||v.cards.length>100000||!Array.isArray(v.parts)||v.parts.length>400)throw Error('로컬 카드 데이터 형식이 올바르지 않습니다.');
 const parts=new Map<string,number>(),ids=new Set<string>();
 for(const p of v.parts){if(!/^[a-f0-9]{64}$/.test(p.key)||!Number.isInteger(p.bytes)||p.bytes<FEATURE_BYTES||p.bytes>FEATURE_BYTES*512||p.bytes%FEATURE_BYTES||parts.has(p.key))throw Error('인식 데이터 크기가 올바르지 않습니다.');parts.set(p.key,p.bytes);}
 for(const c of v.cards){
  const card=c.card;
  if(typeof c.id!=='string'||!(/^kream:[1-9]\d{0,14}$|^catalog:[a-zA-Z0-9:._/-]{1,180}$/.test(c.id)||new RegExp('^photo:'+photoId+'$').test(c.id))||ids.has(c.id)||!card||card.game!==game||card.id!==(c.id.startsWith('catalog:')?c.id.slice(8):c.id)||typeof card.name!=='string'||card.name.length>400||typeof card.number!=='string'||card.number.length>120||typeof card.language!=='string'||!publicImage(card.image)||!publicHref(card.href)||!/^[a-f0-9]{64}$/.test(c.hash)||!/^[a-f0-9]{64}$/.test(c.art)||!Array.isArray(c.color)||c.color.length!==48||!c.color.every(n=>Number.isFinite(n)&&n>=0&&n<=255)||!parts.has(c.part)||!Number.isInteger(c.offset)||c.offset<0||c.offset%FEATURE_BYTES||c.offset+FEATURE_BYTES>parts.get(c.part)!)throw Error('로컬 카드 값이 올바르지 않습니다.');
  for(const price of [...(card.prices??[]),...(card.price?[card.price]:[])])if(!Number.isFinite(price.amount)||price.amount<=0||!['KRW','USD','EUR'].includes(price.currency)||!['LISTED','SOLD','SALE_AVERAGE','REFERENCE'].includes(price.type)||typeof price.source!=='string'||!Number.isFinite(Date.parse(price.observedAt)))throw Error('가격 근거가 올바르지 않습니다.');
  for(const v of card.valuations??[])if(![v.amount,v.low,v.high].every(n=>Number.isFinite(n)&&n>0)||v.low>v.amount||v.amount>v.high||!['KRW','USD','EUR'].includes(v.currency)||!['ai','market_reference','catalog_reference'].includes(v.method)||!Number.isInteger(v.count)||v.count<1||typeof v.source!=='string'||!Number.isFinite(Date.parse(v.observedAt)))throw Error('사진 검색 가격 근거가 올바르지 않습니다.');
  ids.add(c.id);
 }
 return v;
}
// Direction is preserved by per-vector quantization. Magnitude is not used by cosine matching.
export function encodeFeatures(vectors:readonly ArrayLike<number>[]):Uint8Array {
 if(vectors.length!==3||vectors[0]!.length!==1024||vectors[1]!.length!==1024||vectors[2]!.length!==288)throw Error('인식 특징 크기가 올바르지 않습니다.');
 const bytes=new Uint8Array(FEATURE_BYTES);let offset=0;
 for(const vector of vectors){let max=0;for(let i=0;i<vector.length;i++){if(!Number.isFinite(vector[i]!))throw Error('잘못된 특징값');max=Math.max(max,Math.abs(vector[i]!));}if(max<1e-8)throw Error('빈 특징값');for(let i=0;i<vector.length;i++)bytes[offset++]=Math.round(vector[i]!/max*127)&255;}
 return bytes;
}
export function decodeFeatures(card:Card,bytes:Uint8Array):Reference {
 if(bytes.length!==FEATURE_BYTES)throw Error('인식 데이터가 손상됐습니다.');let offset=0;
 const vector=(size:number)=>{const values=new Float32Array(size);for(let i=0;i<size;i++){const n=bytes[offset++]!;values[i]=(n>127?n-256:n)/127;}return unitVector(values);};
 return{card,vector:vector(1024),artVector:vector(1024),artDescriptor:vector(288)};
}
export const marketCurrency=(market:string)=>market==='US'?'USD':market==='EU'?'EUR':'KRW';
export function localMarketCard(card:Card,market:string,now=Date.now()):Card {
 const currency=marketCurrency(market),prices=card.prices??(card.price?[card.price]:[]);
 const valid=prices.filter(p=>p.currency===currency&&now-Date.parse(p.observedAt)<=45*86400000&&Date.parse(p.observedAt)<=now+86400000).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||(['SOLD','SALE_AVERAGE','REFERENCE','LISTED'].indexOf(a.type)-['SOLD','SALE_AVERAGE','REFERENCE','LISTED'].indexOf(b.type)));
 return{...card,price:valid[0]??null};
}
export type LocalEstimate={low:number;high:number;amount?:number;currency:string;count:number;observedAt:string;source?:string;sourceCurrency?:string;converted?:boolean;priceType?:string;referenceKind?:'other_printing';sourceLanguage?:string;sourceNumber?:string;method:'same-game-set-rarity-language-finish-quartiles'|'ai'|'market_reference'|'catalog_reference'};
export function scanEstimateLabel(estimate:LocalEstimate){const label=estimate.referenceKind==='other_printing'?estimate.sourceLanguage==='ja'?'일본 판본 참고가':estimate.sourceLanguage==='ko'?'한국 판본 참고가':estimate.sourceLanguage==='en'?'영문 판본 참고가':'다른 언어·판본 참고가':estimate.method==='catalog_reference'?'상품 참고가 · 등급 미확인':estimate.method==='market_reference'?(estimate.priceType==='LISTED'?'참고 등록가':'시장 참고가'):estimate.method==='ai'?'AI 추정가':'비교 추정가';return estimate.converted?'해외 시세 환산 · '+label:label;}
export function scanResultImage(card:Card,estimate:LocalEstimate|null):string|null {
 if(!estimate)return card.image;
 return card.referenceThumbnail?.image??(card.id.startsWith('photo:')?null:card.image);
}
export function localEstimate(target:Card,cards:readonly Card[],market:string,now=Date.now()):LocalEstimate|null {
 const saved=target.valuations?.find(v=>v.currency===marketCurrency(market)&&now-Date.parse(v.observedAt)<=45*86400000&&Date.parse(v.observedAt)<=now+86400000);
 if(saved)return {...saved};
 // A confirmed identity with an unpriced printing may use comparable prices.
 // Artwork resemblance or OCR alone cannot establish these attributes.
 if(!target.game||!target.setCode||!target.rarity||!target.language||!target.finish||target.artworkSpecific===false)return null;
 const currency=marketCurrency(market),unique=new Map<string,NonNullable<Card['price']>>();
 for(const c of cards){if(c.id===target.id||c.game!==target.game||c.setCode!==target.setCode||c.rarity!==target.rarity||c.language!==target.language||c.finish!==target.finish||c.artworkSpecific===false)continue;const p=localMarketCard(c,market,now).price;if(p&&p.currency===currency&&now-Date.parse(p.observedAt)<=7*86400000)unique.set(c.id,p);}
 const prices=[...unique.values()];if(prices.length<3)return null;prices.sort((a,b)=>a.amount-b.amount);
 const low=prices[Math.floor((prices.length-1)*.25)]!.amount,high=prices[Math.ceil((prices.length-1)*.75)]!.amount;if(high/low>20)return null;
 return{low,high,currency,count:prices.length,observedAt:prices.map(p=>p.observedAt).sort()[0]!,method:'same-game-set-rarity-language-finish-quartiles'};
}
export function formatScanPrice(price:Card['price']|LocalEstimate|null):string {
 if(!price)return '가격 정보 없음';const currency=price.currency,prefix=currency==='KRW'?'₩':currency==='USD'?'$':'€';
 const number=(n:number)=>n.toLocaleString('ko-KR',{maximumFractionDigits:currency==='KRW'?0:2});
 return 'low'in price?price.low===price.high?`${prefix}${number(price.low)}`:`${prefix}${number(price.low)}–${number(price.high)}`:`${prefix}${number(price.amount)}`;
}
