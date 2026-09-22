// Isolated integration harness. Never imported by the production server.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import express from "express";
// Match deployed structured logging; the developer pretty transport needs an unbundled worker.
process.env.NODE_ENV="production";
const base=new URL(process.env.DATABASE_URL??"");
assert.equal(base.pathname,"/davaq","This test only runs against the DavaQ database.");
assert.equal(decodeURIComponent(base.username),"davaq");
const schema="davaq_it_"+randomUUID().replaceAll("-","");
assert.match(schema,/^davaq_it_[a-f0-9]{32}$/);
const setup=new pg.Pool({connectionString:base.toString(),max:1});
let pool,server;let checks=0;
const ok=(condition,message)=>{assert.ok(condition,message);checks++;console.log("PASS "+message);};
try{
 await setup.query('CREATE SCHEMA "'+schema+'"');
 const baseTables=(await setup.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND NOT(tablename=ANY($1::text[]))",[["exchange_listings","exchange_favorites","exchange_proposals","exchange_proposal_versions","exchange_acceptances","exchange_reservations","exchange_events","exchange_fulfillments","exchange_reviews","agent_settings","agent_memories","agent_growth_events","agent_messages","agent_search_jobs","agent_match_feedback","exchange_media","agent_learning_observations","brand_campaigns","brand_versions","brand_media","brand_units","brand_participations","brand_events","brand_claims","brand_outbox","brand_budget_ledger","brand_preferences","chat_upload_owners","agent_conversation_settings","exchange_relays","exchange_relay_members","exchange_relay_reservations","exchange_relay_events"]])).rows.map(r=>r.tablename);
 for(const table of baseTables){
  assert.match(table,/^[a-z_]+$/);
  await setup.query('CREATE TABLE "'+schema+'"."'+table+'" (LIKE public."'+table+'" INCLUDING ALL)');
 }
 const scoped=new URL(base);scoped.searchParams.set("options","-c search_path="+schema);
 process.env.DATABASE_URL=scoped.toString();process.env.DATABASE_POOL_MAX="5";process.env.KNOWLEDGE_ADMIN_USER_IDS="";
 // The build aliases the stable workspace package, preserving the real pool and schema.
 const workspace=await import("@workspace/db");pool=workspace.pool;
 for(const file of ["0029_davaq_exchange.sql","0030_davaq_media_learning.sql","0031_davaq_request_keys.sql","0032_davaq_operational_state.sql","0033_davaq_brand_exchange.sql","0034_davaq_chat_transport.sql","0035_davaq_messenger_actions.sql","0036_davaq_relay_exchange.sql"]){
  await pool.query(await readFile(new URL("./"+file,import.meta.url),"utf8"));
 }
 const exchange=(await import("../src/routes/exchange.ts")).default;
 const relay=(await import("../src/routes/relay.ts")).default;
 const agents=(await import("../src/routes/agents.ts")).default;
 const brand=(await import("../src/routes/brandExchange.ts")).default;
 const conversation=(await import("../src/routes/agentConversation.ts")).default;
 const friends=(await import('../src/routes/friends.ts')).default,invites=(await import('../src/routes/invites.ts')).default,rooms=(await import('../src/routes/rooms.ts')).default,messages=(await import('../src/routes/messages.ts')).default,summon=(await import('../src/routes/anotherMe.ts')).default;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.log={info(){},warn(){},error(){},debug(){}};next();});app.use("/api",exchange,relay,agents,brand,conversation,friends,invites,rooms,messages,summon);
 server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const origin="http://127.0.0.1:"+server.address().port;
 const users=[];
 for(let n=0;n<4;n++){const id=randomUUID();users.push(id);await pool.query("INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",[id,"davaq_it_"+id,id+"@example.invalid","검증 사용자 "+n]);}
 const [a,b,c,analyst]=users;
 async function request(user,path,method="GET",body){const r=await fetch(origin+"/api"+path,{method,headers:{"content-type":"application/json",...(user?{"x-test-user":user}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let json=null;if(text){try{json=JSON.parse(text);}catch{throw new Error(method+" "+path+" returned "+r.status+" "+text.slice(0,250));}}return {status:r.status,data:json};}
 const listing=(title,category,wantedCategories)=>({mode:"offer",kind:"service",category,title,description:"검증 전용 제공 내용",wantedText:"원하는 경험",wantedCategories,delivery:"online",durationMinutes:30,availableDays:[0,6],status:"published",requestKey:randomUUID()});
 const inputA=listing("발성 연습","voice",["photo"]),inputB=listing("사진 촬영","photo",["voice"]),inputC=listing("추가 발성","voice",["photo"]);
 const la=(await request(a,"/exchange/listings","POST",inputA)).data;
 assert.ok(la.id,JSON.stringify(la));
 const duplicate=(await request(a,"/exchange/listings","POST",inputA)).data;ok(la.id===duplicate.id,"duplicate registration returns one listing");
 const lb=(await request(b,"/exchange/listings","POST",inputB)).data,lc=(await request(c,"/exchange/listings","POST",inputC)).data;
 ok((await request(null,"/exchange/listings")).status===401,"anonymous requests are rejected");
 ok((await request(b,"/exchange/listings/"+la.id,"PATCH",{...inputA,version:1})).status===404,"another user cannot modify a listing");
 const draft=(await request(a,"/exchange/listings","POST",{...inputA,status:"draft",requestKey:randomUUID()})).data;
 ok((await request(c,"/exchange/listings/"+draft.id)).status===404,"private drafts are not disclosed");
 const restricted=(await request(a,"/exchange/listings","POST",{...inputA,title:"위스키 교환",category:"goods",requestKey:randomUUID()})).data;
 ok(restricted.status==="pending","restricted items enter review");
 ok((await request(a,"/exchange/matches")).data.items.some(m=>m.target.id===lb.id),"reciprocal offers produce an explained match");
 const day=new Date(Date.now()+86400000*3).toISOString(),day2=new Date(Date.now()+86400000*4).toISOString();
 const terms={offerStartsAt:day,requestedStartsAt:day2,location:"온라인 화상",note:"각 30분 진행",cancellation:"상호 협의 후 취소합니다."};
 const create={offerId:la.id,requestedId:lb.id,terms,requestKey:randomUUID()};
 let p=(await request(a,"/exchange/proposals","POST",create)).data;
 assert.ok(p.id,JSON.stringify(p));
 ok((await request(a,"/exchange/proposals","POST",create)).data.id===p.id,"proposal retry creates no duplicate room");
 ok((await request(c,"/exchange/proposals/"+p.id)).status===404,"outsiders cannot read proposals");
 const act=(u,id,action,version=1,extra={})=>request(u,"/exchange/proposals/"+id+"/actions","POST",{action,version,requestKey:randomUUID(),...extra});
 const accepted=await Promise.all([act(a,p.id,"accept"),act(b,p.id,"accept")]);
 ok(accepted.every(r=>r.status===200),"simultaneous acceptance succeeds without deadlock");
 p=(await request(a,"/exchange/proposals/"+p.id)).data;
 ok(p.status==="reserved"&&p.acceptances.length===2,"two approvals reserve both sides exactly once");
 ok((await pool.query("SELECT count(*)::int n FROM exchange_reservations WHERE proposal_id=$1",[p.id])).rows[0].n===2,"reservation count remains two");
 const conflict=(await request(c,"/exchange/proposals","POST",{offerId:lc.id,requestedId:lb.id,terms:{...terms,offerStartsAt:day2,requestedStartsAt:day},requestKey:randomUUID()})).data;
 await act(c,conflict.id,"accept");ok((await act(b,conflict.id,"accept")).status===409,"receiving time also blocks another overlapping exchange");
 ok((await act(a,p.id,"provided")).status===409,"fulfillment cannot be claimed before its scheduled time");
 await pool.query("UPDATE exchange_reservations SET starts_at=now()-interval '1 hour',ends_at=now()-interval '30 minutes' WHERE proposal_id=$1",[p.id]);
 await act(a,p.id,"provided",1,{note:"제공 기록"});await act(b,p.id,"received");let partial=(await request(a,"/exchange/proposals/"+p.id)).data;
 ok(partial.status==="in_progress","one-sided completion does not finish the exchange");
 await act(b,p.id,"provided");await act(a,p.id,"received");p=(await request(a,"/exchange/proposals/"+p.id)).data;
 ok(p.status==="completed","two fulfilled and received sides complete the exchange");
 await request(a,"/exchange/proposals/"+p.id+"/reviews","POST",{text:"좋은 교환",feedback:"내 비공개 선호"});
 const rb=(await request(b,"/exchange/proposals/"+p.id)).data;
 ok(rb.reviews.find(r=>r.author_id===a).feedback==="","private learning feedback is not shown to the counterparty");
 await request(a,"/agents/me");await request(a,"/agents/me/memories","POST",{label:"주말 온라인 교환이 좋아요"});
 let agent=(await request(a,"/agents/me")).data;ok(agent.memories.length===1&&agent.memories[0].status==="confirmed","manual memory is confirmed explicitly");
 const mid=agent.memories[0].id;
 ok((await request(b,"/agents/me/memories/"+mid,"PATCH",{status:"deleted"})).status===404,"another user cannot delete memory");
 await request(a,"/agents/me/memories/"+mid,"PATCH",{status:"deleted"});
 agent=(await request(a,"/agents/me")).data;ok(agent.memories.length===0,"deleted memory disappears from active state");
 ok((await pool.query("SELECT label FROM agent_memories WHERE id=$1",[mid])).rows[0].label==="","deleted memory content is removed");
 const late=new Date(Date.now()+86400000*6).toISOString();
 let versioned=(await request(a,"/exchange/proposals","POST",{...create,terms:{...terms,offerStartsAt:late,requestedStartsAt:late},requestKey:randomUUID()})).data;
 await act(a,versioned.id,"accept");await act(b,versioned.id,"revise",1,{terms:{...terms,offerStartsAt:late,requestedStartsAt:late,note:"변경된 조건"}});
 versioned=(await request(a,"/exchange/proposals/"+versioned.id)).data;
 ok(versioned.version===2&&versioned.acceptances.length===0,"revised terms clear prior version approvals");
 ok((await act(a,versioned.id,"accept",1)).status===409,"stale-version acceptance is rejected");
 const actionKey=randomUUID();const cancelBody={action:"cancel",version:2,requestKey:actionKey,note:"검증 취소"};
 await request(a,"/exchange/proposals/"+versioned.id+"/actions","POST",cancelBody);
 await request(a,"/exchange/proposals/"+versioned.id+"/actions","POST",cancelBody);
 ok((await pool.query("SELECT count(*)::int n FROM exchange_events WHERE proposal_id=$1 AND request_key=$2",[versioned.id,actionKey])).rows[0].n===1,"action retry adds no duplicate event");
 await pool.query("INSERT INTO admin_roles(user_id,role) VALUES($1,'analyst')",[analyst]);
 ok((await request(analyst,"/exchange/admin")).status===200,"read-only analyst may inspect the review queue");
 ok((await request(analyst,"/exchange/admin/"+restricted.id,"POST",{kind:"listing",action:"reject",reason:"권한 검증 테스트"})).status===403,"read-only analyst cannot resolve reviews");
 const s=agent.settings;
 const consent={name:s.name,tone:s.tone,activityLearning:false,chatLearning:true,autoSearch:false,allowedRoomIds:[p.room_id],consentVersion:s.consent_version};
 ok((await request(a,"/agents/me/settings","PATCH",consent)).status===200,"learning requires explicit room-scoped consent");
 ok((await request(c,"/agents/me/settings","PATCH",{...consent,consentVersion:1})).status===403,"learning cannot select someone else's conversation");
 ok((await request(a,"/agents/me/settings","PATCH",consent)).status===409,"stale consent settings cannot overwrite current consent");

 // Brand fixtures live only inside this disposable schema.
 process.env.BRAND_EXCHANGE_ENABLED="true";process.env.BRAND_EXCHANGE_Q_ENABLED="true";process.env.BRAND_EXCHANGE_STARTS_ENABLED="true";process.env.BRAND_REWARD_ENCRYPTION_KEY="e".repeat(64);
 const brandService=await import("../src/lib/brandExchange.ts");
 const cryptoRules=await import("../src/lib/brandRules.ts");
 await pool.query("INSERT INTO admin_roles(user_id,role) VALUES($1,'operations') ON CONFLICT DO NOTHING",[a]);
 const videoA="/objects/uploads/"+randomUUID(),videoB="/objects/uploads/"+randomUUID();
 await pool.query("INSERT INTO brand_media(object_path,owner_id,width,height,duration) VALUES($1,$3,640,360,30),($2,$3,640,360,30)",[videoA,videoB,a]);
 const cfg={title:"격리 검증 브랜드 교환",brand:"테스트 전용 브랜드",description:"실서비스에 게시하지 않는 격리 테스트 소재입니다.",category:"food",rewardType:"coupon",rewardTitle:"격리 검증 쿠폰",terms:"테스트 전용이며 실사용할 수 없습니다.",extraCost:"없음",support:"test@example.invalid",region:"서울",online:true,endsAt:new Date(Date.now()+86400000).toISOString(),duration:30,cost:10,videoA,videoB,rightsConfirmed:true,fundingConfirmed:true};
 const differences=[{start:0,end:30,x:0.1,y:0.1,w:0.2,h:0.2},{start:0,end:30,x:0.6,y:0.6,w:0.2,h:0.2}];
 const validUntil=new Date(Date.now()+30*86400000).toISOString();
 async function campaign(suffix,units=1,budget=10){
  const body={config:{...cfg,title:cfg.title+suffix},answers:differences,budget,requestKey:randomUUID()};
  const created=await request(a,"/brand-admin/campaigns","POST",body);assert.equal(created.status,201,JSON.stringify(created));
  const id=created.data.id;
  ok((await request(a,"/brand-admin/campaigns","POST",body)).data.id===id,"brand campaign creation retry is idempotent "+suffix);
  const imported=await request(a,"/brand-admin/campaigns/"+id+"/inventory","POST",{codes:Array.from({length:units},(_,n)=>"TEST-ONLY-"+id+"-"+n),validUntil});assert.equal(imported.status,200,JSON.stringify(imported));
  const publish=await request(a,"/brand-admin/campaigns/"+id+"/actions","POST",{status:"published",reason:"격리 검증에서만 공개",budget});assert.equal(publish.status,200,JSON.stringify(publish));
  return id;
 }
 ok((await request(null,"/brand-exchanges")).status===401,"brand browsing requires authentication");
 ok((await request(analyst,"/brand-admin")).data.canManage===false,"brand analyst has reports only");
 ok((await request(analyst,"/brand-admin/campaigns","POST",{})).status===403,"brand analyst cannot mutate campaigns or answers");
 ok((await request(a,"/brand-preferences")).data.personalized===false,"brand memory targeting is off by default");
 const cid=await campaign("1");
 const duplicateInventory=await request(a,"/brand-admin/campaigns/"+cid+"/inventory","POST",{codes:["TEST-ONLY-"+cid+"-0"],validUntil});
 ok(duplicateInventory.data.added===0,"duplicate coupon import adds no second code");
 const stored=(await pool.query("SELECT encrypted_code FROM brand_units WHERE campaign_id=$1",[cid])).rows[0].encrypted_code;
 ok(!stored.includes("TEST-ONLY")&&cryptoRules.decryptCode(stored)==="TEST-ONLY-"+cid+"-0","coupon codes are authenticated encrypted at rest");
 const publicCampaign=await request(b,"/brand-exchanges/"+cid);
 ok(!JSON.stringify(publicCampaign).includes("videoA")&&!JSON.stringify(publicCampaign).includes('"answers"'),"public campaign details contain no answer map or protected video");
 const started=await Promise.all([request(a,"/brand-exchanges/"+cid+"/start","POST",{requestKey:randomUUID()}),request(b,"/brand-exchanges/"+cid+"/start","POST",{requestKey:randomUUID()})]);
 ok(started.filter(x=>x.status===200).length===1&&started.filter(x=>x.status===409).length===1,"last available coupon has exactly one winner under concurrency");
 const winner=started[0].status===200?a:b,loser=winner===a?b:a;
 let bp=started.find(x=>x.status===200).data;
 ok((await request(winner,"/brand-exchanges/"+cid+"/start","POST",{requestKey:randomUUID()})).data.id===bp.id,"same user cannot reserve a second campaign reward");
 ok((await request(loser,"/brand-exchanges/participations/"+bp.id)).status===404,"another user cannot inspect play sessions");
 let lease=(await request(winner,"/brand-exchanges/participations/"+bp.id+"/lease","POST")).data.lease;
 ok(Boolean(lease)&&(await request(winner,"/brand-exchanges/participations/"+bp.id+"/lease","POST")).status===409,"only one live browser lease is granted");
 let seq=0,lastEvent;
 async function event(action,position=bp.progress,extra={}){
  const body={action,lease,sequence:seq+1,requestKey:randomUUID(),position,positionB:position,...extra};
  const result=await request(winner,"/brand-exchanges/participations/"+bp.id+"/events","POST",body);
  if(result.status===200){seq=result.data.sequence;bp=result.data;lastEvent=body;}
  return result;
 }
 assert.equal((await event("play",0)).status,200);
 ok((await event("tick",30)).status===409,"instant end-event playback spoof is rejected");
 ok((await event("tick",1,{positionB:6})).status===409,"unsynchronized videos cannot advance progress");
 assert.equal((await event("answer",0,{x:0.2,y:0.2})).status,200);
 const repeat=await request(winner,"/brand-exchanges/participations/"+bp.id+"/events","POST",lastEvent);
 ok(repeat.data.found===1&&repeat.data.clicks===1,"answer event retry does not consume another click");
 assert.equal((await event("answer",0,{x:0.7,y:0.7})).status,200);
 ok(bp.found===2&&bp.status==="playing","correct answers alone cannot earn the reward before full playback");
 await request(a,"/brand-admin/campaigns/"+cid+"/actions","POST",{status:"paused",reason:"진행 중 보상 보존 검증"});
 for(let position=2;position<=30;position+=2){await pool.query("UPDATE brand_participations SET last_tick=now()-interval '2 seconds' WHERE id=$1",[bp.id]);const tick=await event("tick",position);assert.equal(tick.status,200,JSON.stringify(tick));}
 assert.equal((await event("finish",30)).status,200);
 ok(bp.status==="succeeded"&&bp.claimId,"a campaign pause preserves the held participation and earned claim");
 await pool.query("UPDATE brand_participations SET expires_at=now()-interval '1 minute' WHERE id=$1",[bp.id]);
 await Promise.all([brandService.settleBrandRewards(),brandService.settleBrandRewards()]);
 let reward=(await request(winner,"/brand-rewards/"+bp.claimId)).data;
 ok(reward.status==="issued","earned reward survives reservation timeout and concurrent fulfillment workers");
 ok((await pool.query("SELECT count(*)::int n FROM brand_budget_ledger WHERE participation_id=$1 AND kind='spend'",[bp.id])).rows[0].n===1,"reward budget is charged exactly once");
 ok((await request(loser,"/brand-rewards/"+bp.claimId+"/reveal","POST")).status===404,"coupon secret is owner-only");
 ok((await request(winner,"/brand-rewards/"+bp.claimId+"/reveal","POST")).data.code==="TEST-ONLY-"+cid+"-0","issued owner can reveal the secured coupon");
 ok(!JSON.stringify(await request(winner,"/brand-rewards")).includes("TEST-ONLY"),"reward lists never contain coupon secrets");
 await request(winner,"/brand-rewards/"+bp.claimId+"/actions","POST",{action:"used"});
 ok(Boolean((await request(winner,"/brand-rewards/"+bp.claimId)).data.selfUsedAt),"manual usage is recorded separately from provider redemption");
 await request(winner,"/brand-rewards/"+bp.claimId+"/actions","POST",{action:"issue",note:"격리 검증용 문의입니다."});
 ok((await request(analyst,"/brand-admin")).data.issues.some(i=>i.id===bp.claimId),"support requests appear in the operator queue without the code");
 const cid2=await campaign("2",2,10);
 const held=(await request(c,"/brand-exchanges/"+cid2+"/start","POST",{requestKey:randomUUID()})).data;
 ok((await request(loser,"/brand-exchanges/"+cid2+"/start","POST",{requestKey:randomUUID()})).status===409,"available stock cannot exceed campaign financial budget");
 await pool.query("UPDATE brand_participations SET expires_at=now()-interval '1 second' WHERE id=$1",[held.id]);await brandService.settleBrandRewards();
 const stats=(await pool.query("SELECT held,spent FROM brand_campaigns WHERE id=$1",[cid2])).rows[0];
 ok(stats.held===0&&stats.spent===0,"unfinished expired participation releases only its held budget");
 const renewed=await request(loser,"/brand-exchanges/"+cid2+"/start","POST",{requestKey:randomUUID()});
 ok(renewed.status===200,"released inventory can serve another participant");
 let oldLease=(await request(loser,"/brand-exchanges/participations/"+renewed.data.id+"/lease","POST")).data.lease;
 await pool.query("UPDATE brand_participations SET lease_until=now()-interval '1 second' WHERE id=$1",[renewed.data.id]);
 const newLease=(await request(loser,"/brand-exchanges/participations/"+renewed.data.id+"/lease","POST")).data.lease;
 ok(newLease!==oldLease,"expired browser lease can recover with a fresh token");
 ok((await request(loser,"/brand-exchanges/participations/"+renewed.data.id+"/events","POST",{action:"play",lease:oldLease,requestKey:randomUUID(),sequence:1,position:0,positionB:0})).status===409,"superseded browser cannot submit progress");
 process.env.BRAND_EXCHANGE_STARTS_ENABLED="false";
 ok((await request(a,"/brand-exchanges/"+cid2+"/start","POST",{requestKey:randomUUID()})).status===409,"participation kill switch blocks new starts");
 ok((await request(winner,"/brand-rewards/"+bp.claimId+"/reveal","POST")).status===200,"kill switch preserves previously earned rewards");
 process.env.BRAND_EXCHANGE_STARTS_ENABLED="true";
 const settings=(await request(c,"/brand-preferences")).data;
 const preferences={categories:["food"],region:"서울",personalized:true,version:settings.version};
 await request(c,"/brand-preferences","PATCH",preferences);
 ok((await request(c,"/brand-preferences","PATCH",preferences)).status===409,"stale brand consent updates cannot overwrite current preference");
 await request(c,"/brand-preferences","PATCH",{...preferences,personalized:false,version:settings.version+1});
 ok((await request(c,"/brand-preferences")).data.personalized===false,"brand memory use can be revoked independently");


 // Exhaustion, resumption and reconciliation exercise failure paths as well as success.
 const failedCampaign=await campaign("3");
 let failP=(await request(c,"/brand-exchanges/"+failedCampaign+"/start","POST",{requestKey:randomUUID()})).data;
 const failLease=(await request(c,"/brand-exchanges/participations/"+failP.id+"/lease","POST")).data.lease;
 let failSeq=0;
 async function failEvent(action,position=failP.progress,extra={}){const r=await request(c,"/brand-exchanges/participations/"+failP.id+"/events","POST",{action,position,positionB:position,requestKey:randomUUID(),lease:failLease,sequence:failSeq+1,...extra});if(r.status===200){failSeq=r.data.sequence;failP=r.data;}return r;}
 await failEvent("play",0);
 for(let n=0;n<8;n++)assert.equal((await failEvent("answer",0,{x:0.99,y:0.99})).status,200);
 ok((await failEvent("answer",0,{x:0.2,y:0.2})).status===409,"a ninth guess cannot brute-force the answer map");
 ok((await failEvent("retry",0)).status===409,"retry cannot skip the first full viewing");
 for(let i=2;i<=30;i+=2){await pool.query("UPDATE brand_participations SET last_tick=now()-interval '2 seconds' WHERE id=$1",[failP.id]);assert.equal((await failEvent("tick",i)).status,200);}
 await failEvent("finish",30);
 ok(failP.status==="paused"&&!failP.claimId,"missing differences produce a retry opportunity instead of a reward");
 await failEvent("retry",30);ok(failP.attempt===2&&failP.progress===0&&failP.clicks===0,"the second attempt resets progress and guesses together");
 await failEvent("play",0);
 for(let i=2;i<=30;i+=2){await pool.query("UPDATE brand_participations SET last_tick=now()-interval '2 seconds' WHERE id=$1",[failP.id]);assert.equal((await failEvent("tick",i)).status,200);}
 await failEvent("finish",30);
 ok(failP.status==="failed"&&(await pool.query("SELECT held FROM brand_campaigns WHERE id=$1",[failedCampaign])).rows[0].held===0,"final failed attempt releases the held reward without a claim");
 const reconcileCampaign=await campaign("4");
 let rp=(await request(c,"/brand-exchanges/"+reconcileCampaign+"/start","POST",{requestKey:randomUUID()})).data;
 // Inject a post-verification state solely inside this isolated schema to test the payout boundary.
 await pool.query("UPDATE brand_participations SET status='succeeded',progress=30,found='[0,1]' WHERE id=$1",[rp.id]);
 const unit=(await pool.query("SELECT unit_id FROM brand_participations WHERE id=$1",[rp.id])).rows[0].unit_id;
 const rc=(await pool.query("INSERT INTO brand_claims(participation_id,user_id,unit_id) VALUES($1,$2,$3) RETURNING id",[rp.id,c,unit])).rows[0];
 await pool.query("INSERT INTO brand_outbox(claim_id) VALUES($1)",[rc.id]);
 const good=(await pool.query("SELECT encrypted_code FROM brand_units WHERE id=$1",[unit])).rows[0].encrypted_code;
 await pool.query("UPDATE brand_units SET encrypted_code='broken' WHERE id=$1",[unit]);
 await brandService.settleBrandRewards();
 ok((await request(c,"/brand-rewards/"+rc.id)).data.status==="needs_reconciliation","unreadable secured reward enters reconciliation without pretending it was issued");
 await pool.query("UPDATE brand_units SET encrypted_code=$2 WHERE id=$1",[unit,good]);
 const fix=await request(a,"/brand-admin/rewards/"+rc.id+"/resolve","POST",{reason:"격리 테스트 암호문 복구 확인",retry:true});
 assert.equal(fix.status,200);await brandService.settleBrandRewards();
 ok((await request(c,"/brand-rewards/"+rc.id)).data.status==="issued","operator repair retries the same claim and secured reward");
 const learningCampaign=await campaign("5");
 await request(c,"/agents/me/memories","POST",{label:"커피와 카페 체험을 좋아해요"});
 let pref=(await request(c,"/brand-preferences")).data;
 await request(c,"/brand-preferences","PATCH",{categories:[],region:"",personalized:false,version:pref.version});
 ok(!(await request(c,"/brand-exchanges?recommended=true")).data.items.find(i=>i.id===learningCampaign).reason.includes("기억"),"saved memories are not used without brand-specific consent");
 pref=(await request(c,"/brand-preferences")).data;
 await request(c,"/brand-preferences","PATCH",{categories:[],region:"",personalized:true,version:pref.version});
 ok((await request(c,"/brand-exchanges?recommended=true")).data.items.find(i=>i.id===learningCampaign).reason.includes("기억"),"explicit consent permits a grounded category recommendation");
 await pool.query("UPDATE agent_memories SET status='deleted',label='' WHERE user_id=$1",[c]);
 ok(!(await request(c,"/brand-exchanges?recommended=true")).data.items.find(i=>i.id===learningCampaign).reason.includes("기억"),"deleting memories removes their recommendation reason");
 process.env.BRAND_EXCHANGE_ENABLED="false";
 ok((await request(c,"/brand-exchanges")).data.items.length===0,"discovery flag suppresses campaign recommendations");
 ok((await request(c,"/brand-rewards/"+rc.id+"/reveal","POST")).status===200,"discovery shutdown preserves coupon access");
 process.env.BRAND_EXCHANGE_ENABLED="true";

 const {testAgentConversation}=await import("./agentConversation.integration.mjs");
 await testAgentConversation({pool,request,ok,users});

 await (await import('./messenger.integration.mjs')).testMessenger({pool,request,ok});
 await (await import("./relay.integration.mjs")).testRelays({pool,request,ok,listing,analyst});
 if(process.env.DAVAQ_INTEGRATION_AI==="1"){
  const ai=await import("../src/lib/davaqAgent.ts");
  const draftResult=await ai.registerDraft("영어 회화를 온라인으로 30분 도와줄 수 있어요. 대신 프로필 사진 촬영을 받고 싶어요.");
  ok(draftResult.kind==="service"&&draftResult.category==="language"&&draftResult.wantedCategories.includes("photo"),"live AI produces a validated barter draft");
  const answer=await ai.agentReply(a,"온라인으로 짧게 배우는 경험을 좋아해요.",false);
  ok(answer.data.reply.length>2,"live AI agent returns a grounded Korean reply");
 }
 console.log(JSON.stringify({checks,result:"passed",isolatedSchema:schema}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 // Presence/typing use Redis in CI; release their clients after the last AI chunk.
 await (await import("../src/lib/redis.ts")).closeRedisClients();
 if(pool)await pool.end();
 // Only this run's generated schema is removed; no public table or real row is touched.
 assert.match(schema,/^davaq_it_[a-f0-9]{32}$/);
 await setup.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
 await setup.end();
}
