import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const st=vi.hoisted(()=>({db:null as any,create:vi.fn()}));
vi.mock('@workspace/db',()=>({pool:{query:(q:string,a:any[])=>st.db.query(q,a)}}));
vi.mock('../aiClient',()=>({getOpenAI:()=>({chat:{completions:{create:st.create}}})}));
import {collectorCompletion,collectorCostBound} from './budget';
const request={model:'gpt-5.4-mini',max_completion_tokens:100,messages:[{role:'user',content:'짧게 대화하자.'}]};
beforeAll(async()=>{st.db=new PGlite();await st.db.exec(await readFile(new URL('../../../../../lib/db/drizzle/0051_collector_ai_budget.sql',import.meta.url),'utf8'));});
afterAll(async()=>{await st.db.close();});
beforeEach(async()=>{st.create.mockReset();await st.db.exec('DELETE FROM collector_ai_spend_daily');});
it('settles generation/review/repair calls together using confirmed usage',async()=>{
 st.create.mockResolvedValue({usage:{prompt_tokens:100,completion_tokens:20}});
 await Promise.all(Array.from({length:4},()=>collectorCompletion(request,{})));
 const r=await st.db.query('SELECT microusd FROM collector_ai_spend_daily');expect(Number(r.rows[0].microusd)).toBe(4*(75+90));
 expect(st.create.mock.calls.every((c:any)=>c[1].maxRetries===0)).toBe(true);
});
it('does not call the provider when the remaining global budget is insufficient',async()=>{
 await st.db.exec("INSERT INTO collector_ai_spend_daily VALUES((now() AT TIME ZONE 'Asia/Seoul')::date,999999)");
 await expect(collectorCompletion(request,{})).rejects.toThrow('collector_daily_budget_exhausted');expect(st.create).not.toHaveBeenCalled();
});
it('retains reservations after failures and missing usage',async()=>{
 st.create.mockRejectedValueOnce(Error('timeout')).mockResolvedValueOnce({});
 await expect(collectorCompletion(request,{})).rejects.toThrow('timeout');await collectorCompletion(request,{});
 expect(Number((await st.db.query('SELECT microusd FROM collector_ai_spend_daily')).rows[0].microusd)).toBe(2*collectorCostBound(request).reserved);
});
it('bounds concurrent callers at the final available reservation',async()=>{
 const amount=collectorCostBound(request).reserved;
 await st.db.query("INSERT INTO collector_ai_spend_daily VALUES((now() AT TIME ZONE 'Asia/Seoul')::date,$1)",[1000000-amount]);
 st.create.mockResolvedValue({});const r=await Promise.allSettled([collectorCompletion(request,{}),collectorCompletion(request,{})]);
 expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(st.create).toHaveBeenCalledOnce();
});
it('rejects unknown rates and oversized calls before reaching the provider',async()=>{
 await expect(collectorCompletion({...request,model:'unknown'},{})).rejects.toThrow('unsupported');
 await expect(collectorCompletion({...request,messages:[{content:'a'.repeat(1500000)}]},{})).rejects.toThrow('budget_exhausted');expect(st.create).not.toHaveBeenCalled();
});
