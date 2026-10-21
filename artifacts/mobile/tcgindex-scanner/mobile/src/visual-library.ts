import type {Card} from './scanner';
export type VisualCard={id:string;card:Card;count:number;part:string};
export type VisualLibrary={version:1;model:'orb-spatial-v1';game:string;generatedAt:string;complete:boolean;cards:VisualCard[];parts:{key:string;bytes:number}[]};
// Avoid passing a catalog-sized Java String through the file-system bridge.
export function* visualManifestChunks(value:VisualLibrary):Generator<string>{
 const {cards,...metadata}=value;
 yield JSON.stringify(metadata).slice(0,-1)+',"cards":[';
 for(let i=0;i<cards.length;i+=256)yield (i?',':'')+JSON.stringify(cards.slice(i,i+256)).slice(1,-1);
 yield ']}';
}
// A catalog refresh may replace immutable feature parts. Keep each old public
// descriptor until its replacement arrives, using the new card/price metadata.
export function availableVisualSnapshot(fresh:VisualLibrary,cached:VisualLibrary|undefined,available:Set<string>):VisualLibrary {
 const previous=new Map((cached?.game===fresh.game?cached.cards:[]).map(c=>[c.id,c]));
 const cards=fresh.cards.map(row=>{const old=previous.get(row.id);return !available.has(row.part)&&old&&available.has(old.part)?{...row,part:old.part,count:old.count}:row;});
 const parts=new Map(fresh.parts.map(p=>[p.key,p]));
 const usedParts=new Set(cards.map(c=>c.part));
 for(const p of cached?.game===fresh.game?cached.parts:[])if(usedParts.has(p.key)&&!parts.has(p.key))parts.set(p.key,p);
 return {...fresh,complete:fresh.complete&&cards.every(c=>available.has(c.part))&&cards.every((c,i)=>c.part===fresh.cards[i].part),cards,parts:[...parts.values()]};
}
export function parseVisualLibrary(value:unknown,game:string):VisualLibrary {
  const v=value as VisualLibrary;
  if(v?.version!==1||v.model!=='orb-spatial-v1'||v.game!==game||!Number.isFinite(Date.parse(v.generatedAt))||!Array.isArray(v.cards)||v.cards.length>100000||!Array.isArray(v.parts)||v.parts.length>2000)throw Error('그림 인식 데이터 형식이 올바르지 않습니다.');
  const parts=new Set<string>(),ids=new Set<string>();
  for(const p of v.parts){if(!/^[a-f0-9]{64}$/.test(p.key)||!Number.isInteger(p.bytes)||p.bytes<8||p.bytes>2000000||parts.has(p.key))throw Error('그림 특징 데이터 크기가 올바르지 않습니다.');parts.add(p.key);}
  for(const row of v.cards){const c=row.card;
    if(typeof row.id!=='string'||!/^((?:kream|catalog):[a-zA-Z0-9:._/-]{1,180}|photo:[a-f0-9-]{36})$/.test(row.id)||ids.has(row.id)||!parts.has(row.part)||!Number.isInteger(row.count)||row.count<12||row.count>512||!c||c.id!==(row.id.startsWith('catalog:')?row.id.slice(8):row.id)||c.game!==game||typeof c.name!=='string'||c.name.length>400||typeof c.number!=='string'||typeof c.language!=='string'||!/^\/(?:market\/images\/kream\/[a-f0-9]{64}|api\/catalog\/images\/[a-f0-9]{64}|api\/card-photos\/[a-f0-9-]{36})$/.test(c.image)||!/^\/market\/(?:printings|kream|catalog|photos)\/[A-Za-z0-9%:._-]+$/.test(c.href))throw Error('그림 카드 값이 올바르지 않습니다.');
    for(const p of [...(c.prices??[]),...(c.price?[c.price]:[])])if(!Number.isFinite(p.amount)||p.amount<=0||!['KRW','USD','EUR'].includes(p.currency)||!['LISTED','SOLD','SALE_AVERAGE','REFERENCE'].includes(p.type)||typeof p.source!=='string'||!Number.isFinite(Date.parse(p.observedAt)))throw Error('카드 가격 근거가 올바르지 않습니다.');
    for(const p of c.valuations??[])if(![p.amount,p.low,p.high].every(n=>Number.isFinite(n)&&n>0)||p.low>p.amount||p.amount>p.high||!['KRW','USD','EUR'].includes(p.currency)||!['ai','market_reference','catalog_reference'].includes(p.method)||!Number.isInteger(p.count)||p.count<1||typeof p.source!=='string'||!Number.isFinite(Date.parse(p.observedAt)))throw Error('추정가 근거가 올바르지 않습니다.');
    const t=c.referenceThumbnail;if(t&&(!/^\/(?:market\/images\/kream|api\/catalog\/images)\/[a-f0-9]{64}$/.test(t.image)||!/^\/market\/(?:printings|kream|catalog)\/[A-Za-z0-9%:._-]+$/.test(t.href)||typeof t.name!=='string'||t.name.length>400))throw Error('참고 이미지 형식이 올바르지 않습니다.');
    ids.add(row.id);
  }
  return v;
}
