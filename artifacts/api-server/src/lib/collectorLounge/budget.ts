import {pool} from '@workspace/db';
import {getOpenAI} from '../aiClient';
// USD per million tokens == micro-USD per token. Cached input is deliberately
// charged at the uncached rate so the local cap is conservative.
const RATES:Record<string,[number,number]>={
 'gpt-5.4':[2.5,15], 'gpt-4.1-mini':[0.4,1.6], 'gpt-4o':[2.5,10],
 'gpt-5.4-nano':[0.2,1.25], 'gpt-5.4-mini':[0.75,4.5],
};
export const COLLECTOR_DAILY_MICROUSD=1_000_000;
export function collectorCostBound(request:any){
 const rates=RATES[request.model];const output=request.max_completion_tokens;
 if(!rates||!Number.isInteger(output)||output<1||output>2000)throw Error('collector_budget_unsupported_request');
 let pictures=0;
 const encoded=JSON.stringify(request,(key,value)=>{
  if(key==='image_url'){pictures++;return {url:'[image]',detail:value.detail};}return value;
 });
 if(pictures>4)throw Error('collector_budget_image_limit');
 // UTF-8 bytes upper-bound text BPE tokens, plus protocol overhead. High-detail
 // supported image encoders stay below 4,000 tokens per image after API resizing.
 const input=Buffer.byteLength(encoded,'utf8')+2048+4000*pictures;
 return {reserved:Math.ceil(input*rates[0]+output*rates[1]),rates};
}
export async function collectorCompletion(request:any,options:any){
 const {reserved,rates}=collectorCostBound(request);
 if(reserved>COLLECTOR_DAILY_MICROUSD)throw Error('collector_daily_budget_exhausted');
 const claim=await pool.query(`INSERT INTO collector_ai_spend_daily(day,microusd)
 VALUES((now() AT TIME ZONE 'Asia/Seoul')::date,$1)
 ON CONFLICT(day) DO UPDATE SET microusd=collector_ai_spend_daily.microusd+EXCLUDED.microusd
 WHERE collector_ai_spend_daily.microusd+EXCLUDED.microusd<=$2
 RETURNING day`,[reserved,COLLECTOR_DAILY_MICROUSD]);
 if(!claim.rows.length)throw Error('collector_daily_budget_exhausted');
 // A crash, timeout or absent usage retains the full reservation. Never refund
 // unknown spend, and never retry automatically after an uncertain provider call.
 const result=await getOpenAI().chat.completions.create(request,{...options,maxRetries:0});
 const u=result.usage;
 if(u&&Number.isFinite(u.prompt_tokens)&&Number.isFinite(u.completion_tokens)){
  const actual=Math.ceil(u.prompt_tokens*rates[0]+u.completion_tokens*rates[1]);
  if(actual>reserved)throw Error('collector_budget_bound_exceeded');
  await pool.query('UPDATE collector_ai_spend_daily SET microusd=microusd-$2+$3 WHERE day=$1',[claim.rows[0].day,reserved,actual]);
 }
 return result;
}
