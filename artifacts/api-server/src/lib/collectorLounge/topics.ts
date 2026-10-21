import { randomInt } from 'node:crypto';
import { cardId, tcgRead } from '../tcgCatalog';

const angles = ['그림이 좋은 한 장을 전시할지 바인더에 넣을지', '좋아하는 캐릭터 한 장과 같은 세트 완성 중 고르기', '한 장 수집과 세트 수집의 취향', '바인더 한 칸만 남으면 이 카드를 넣을지', '이 카드 옆에 어떤 카드가 어울릴지', '서로 다른 언어판을 모으는 취향'];
type CatalogItem = {saveId?:string;title?:string;gameCode?:string};
export async function chooseLoungeTopic(previous: {cardIds:string[];game?:string;episodes:number}, read:typeof tcgRead=tcgRead, pick:(max:number)=>number=randomInt) {
  const base=await read('/api/mobile/v1/cards',{market:'KR',page:'1'},8000);
  const games=(Array.isArray(base.games)?base.games:[]).map((g:any)=>g.code).filter((g:unknown):g is string=>typeof g==='string'&&/^[a-z_]{1,40}$/.test(g));
  const start=Math.max(0,games.indexOf(previous.game??'')+1)%Math.max(1,games.length);
  const candidates=(items:unknown):CatalogItem[]=>Array.isArray(items)?items.filter((x:any)=>cardId.safeParse(x?.saveId).success&&typeof x?.title==='string'&&x.title.trim().length>0&&x.title.length<=160&&!previous.cardIds.includes(x.saveId)):[];
  let items:CatalogItem[]=[];
  for(let i=0;i<Math.min(games.length,3);i++) {
    const game=games[(start+i)%games.length];
    try {const page=await read('/api/mobile/v1/cards',{game,market:game==='magic'||game==='lorcana'?'US':'KR',page:'1'},8000);items=candidates(page.items).filter(x=>x.gameCode===game);if(items.length)break;}catch{}
  }
  if(!items.length)items=candidates(base.items);
  if(!items.length)return null;
  const item=items[pick(items.length)];
  const angle=angles[previous.episodes%angles.length];
  return {cardId:item.saveId!,game:item.gameCode??'',topic:`${item.title!.trim()} — ${angle}`,angle};
}
