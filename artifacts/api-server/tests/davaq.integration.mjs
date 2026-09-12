// Isolated integration harness. Never imported by the production server.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import express from "express";
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
 for(const table of ["users","chat_rooms","chat_room_members","messages","blocked_users","admin_roles","admin_audit_logs"]){
  await setup.query('CREATE TABLE "'+schema+'"."'+table+'" (LIKE public."'+table+'" INCLUDING ALL)');
 }
 const scoped=new URL(base);scoped.searchParams.set("options","-c search_path="+schema);
 process.env.DATABASE_URL=scoped.toString();process.env.DATABASE_POOL_MAX="5";process.env.KNOWLEDGE_ADMIN_USER_IDS="";
 // The build aliases the stable workspace package, preserving the real pool and schema.
 const workspace=await import("@workspace/db");pool=workspace.pool;
 for(const file of ["0029_davaq_exchange.sql","0030_davaq_media_learning.sql","0031_davaq_request_keys.sql","0032_davaq_operational_state.sql"]){
  await pool.query(await readFile(new URL("./"+file,import.meta.url),"utf8"));
 }
 const exchange=(await import("../src/routes/exchange.ts")).default;
 const agents=(await import("../src/routes/agents.ts")).default;
 const app=express();app.use(express.json());app.use("/api",exchange,agents);
 server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const origin="http://127.0.0.1:"+server.address().port;
 const users=[];
 for(let n=0;n<4;n++){const id=randomUUID();users.push(id);await pool.query("INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",[id,"davaq_it_"+id,id+"@example.invalid","검증 사용자 "+n]);}
 const [a,b,c,analyst]=users;
 async function request(user,path,method="GET",body){const r=await fetch(origin+"/api"+path,{method,headers:{"content-type":"application/json",...(user?{"x-test-user":user}:{})},body:body===undefined?undefined:JSON.stringify(body)});const json=await r.json();return {status:r.status,data:json};}
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
 if(pool)await pool.end();
 // Only this run's generated schema is removed; no public table or real row is touched.
 assert.match(schema,/^davaq_it_[a-f0-9]{32}$/);
 await setup.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
 await setup.end();
}
