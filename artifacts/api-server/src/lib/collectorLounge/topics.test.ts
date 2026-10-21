import {it,expect,vi} from 'vitest';
import {chooseLoungeTopic} from './topics';
it('rotates games and excludes recent cards while ignoring unsupported identifiers',async()=>{
 const read=vi.fn(async(_path:string,p:any)=>p.game==='one_piece'?{items:[{saveId:'kream:1',title:'이미 본 카드',gameCode:'one_piece'},{saveId:'unsafe',title:'잘못된 카드',gameCode:'one_piece'},{saveId:'kream:2',title:'새 원피스 카드',gameCode:'one_piece'}]}:{games:[{code:'pokemon'},{code:'one_piece'}],items:[]});
 const t=await chooseLoungeTopic({cardIds:['kream:1'],game:'pokemon',episodes:0},read,()=>0);
 expect(t?.cardId).toBe('kream:2');expect(t?.game).toBe('one_piece');expect(t?.topic).toContain('그림');
 expect(read).toHaveBeenCalledTimes(2);
});
it('changes discussion angles and never invents cards when the catalog is empty',async()=>{
 const read=vi.fn(async()=>({games:[],items:[{saveId:'kream:3',title:'카드',gameCode:'pokemon'}]}));
 const a=await chooseLoungeTopic({cardIds:[],episodes:0},read,()=>0);
 const b=await chooseLoungeTopic({cardIds:[],episodes:1},read,()=>0);
 expect(a?.angle).not.toBe(b?.angle);
 expect(await chooseLoungeTopic({cardIds:['kream:3'],episodes:2},read,()=>0)).toBeNull();
});
it('skips unavailable games and does not carry pricing fields into a topic',async()=>{
 const read=vi.fn(async(_path:string,p:any)=>{if(p.game==='pokemon')throw Error('offline');if(p.game==='magic')return {items:[{saveId:'justtcg:12345678-1234-1234-1234-123456789abc',title:'매직 카드',gameCode:'magic',price:'100000원'}]};return {games:[{code:'pokemon'},{code:'magic'}],items:[]};});
 const t=await chooseLoungeTopic({cardIds:[],episodes:2},read,()=>0);
 expect(t?.game).toBe('magic');expect(JSON.stringify(t)).not.toContain('100000');
 expect(read.mock.calls.at(-1)?.[1].market).toBe('US');
});

