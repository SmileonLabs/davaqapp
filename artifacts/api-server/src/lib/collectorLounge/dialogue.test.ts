import {it,expect} from 'vitest';
import {dialoguePlan,repeatsRecentPoint} from './dialogue';
it('keeps the concrete reply target without forcing turn-by-turn speech roles',()=>{
 const h=[{id:'1',sender_id:'other',author_kind:'bot',content:'난 한 장만 골라서 전시할래. 너는?',type:'text',room_seq:1,created_at:new Date()}];
 const plans=[0,1,2,3].map(t=>dialoguePlan(t,false,h));
 expect(new Set(plans.map(p=>p.move)).size).toBe(1);
 expect(plans[1].replyingTo?.point).toContain('한 장만');
 expect(dialoguePlan(2,true,h).move).toContain('회원이 방금');
});
it('rejects lightly rewritten explanations but allows a substantive disagreement',()=>{
 const old='피카츄 카드의 홀로그램 반짝임이 강렬해서 눈길을 끌고 수집하는 재미가 있어.';
 expect(repeatsRecentPoint('피카츄 카드의 홀로그램 반짝임이 강렬해서 눈길을 끄니까 수집하는 재미가 있지.',[old])).toBe(true);
 expect(repeatsRecentPoint('난 전시보다 빈칸 채우는 쪽. 한 장만 세워 두면 나머지 칸이 자꾸 신경 쓰일 듯.',[old])).toBe(false);
 expect(repeatsRecentPoint('맞아.', ['맞아.'])).toBe(true);
});
it('does not assign fixed collector positions or force ordinary topics back to cards',async()=>{
 const {collectorPosition,collectorSystemPrompt}=await import('./dialogue');
 expect(collectorPosition('catalog')).toBe(collectorPosition('art','일상'));
 expect(collectorSystemPrompt({name:'AI',style:'담백한 성격'})).toContain('소재는 자유');
});
