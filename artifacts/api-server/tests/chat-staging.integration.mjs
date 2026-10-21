/** Actual PostgreSQL/Redis/HTTP/WebSocket verification. Refuses non-loopback/non-staging DBs. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, mkdir, cp, open } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
const require = createRequire(new URL('../package.json', import.meta.url));
const { Pool, Client } = createRequire(new URL('../../../lib/db/package.json', import.meta.url))('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { WebSocket } = require('ws');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const root = join(repo, '.local/chat-staging-20261016');
const env = JSON.parse(await readFile(join(root, 'staging-environment.json'), 'utf8'));
const dbUrl = new URL(env.DATABASE_URL);
assert.equal(dbUrl.hostname, '127.0.0.1'); assert.equal(dbUrl.port, '55446');
assert.equal(dbUrl.pathname, '/davaq_chat_stage'); assert.equal(dbUrl.username, 'davaq_stage');
assert.equal(env.REDIS_URL, 'redis://127.0.0.1:56346');
const pgctl = join(root, 'postgres/package/native/bin/pg_ctl');
const redisBin = join(root, 'redis-source/redis-7.4.0/src');
const checks = [];
const check = (name, detail = {}) => { checks.push({name, ...detail}); console.log(JSON.stringify({passed:name,...detail})); };
const sha = value => createHash('sha256').update(value).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pool = new Pool({connectionString:env.DATABASE_URL,max:8,connectionTimeoutMillis:3000,statement_timeout:15000});
pool.on("error", () => {}); // Expected idle disconnects during the isolated crash test.
let fixtures;
const children = new Map();
const sockets = new Set();
let reportWritten = false;
async function report(status,error) {
  await writeFile(join(root,'p0-integration-result.json'),JSON.stringify({status,at:new Date().toISOString(),database:'davaq_chat_stage',postgres:'16.14',redis:'7.4.0',checks,error:error?String(error.message):undefined,productionTouched:false},null,2));
  reportWritten = true;
}
async function until(fn,label,timeout=20000) {
  const deadline=Date.now()+timeout;let last;
  while(Date.now()<deadline){try{const result=await fn();if(result)return result;}catch(error){last=error;}await wait(150);}
  throw new Error(`Timed out: ${label}${last?' ('+last.message+')':''}`);
}
async function prepare() {
  const adminUrl=new URL(dbUrl);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='davaq_chat_stage'")).rowCount)await admin.query('CREATE DATABASE davaq_chat_stage');
  await admin.end();
  const migrations=join(repo,'lib/db/drizzle');
  const journal=JSON.parse(await readFile(join(migrations,'meta/_journal.json'),'utf8'));
  const before=join(root,'baseline-migrations');await mkdir(join(before,'meta'),{recursive:true});
  for(const entry of journal.entries.filter(entry=>entry.idx<46))await cp(join(migrations,entry.tag+'.sql'),join(before,entry.tag+'.sql'));
  await writeFile(join(before,'meta/_journal.json'),JSON.stringify({...journal,entries:journal.entries.filter(entry=>entry.idx<46)}));
  await migrate(drizzle(pool),{migrationsFolder:before});
  let existing;
  try{existing=JSON.parse(await readFile(join(root,'fixtures.private.json'),'utf8'));}catch{}
  if(existing)fixtures=existing;
  else {
    const users={};
    for(const name of ['alice','bob','outsider']){
      const id=randomUUID();await pool.query('INSERT INTO users(id,clerk_id,email,nickname,notification_enabled) VALUES($1,$2,$3,$4,false)',[id,'davaq_social_stage_'+id,id+'@stage.example.invalid','Stage '+name]);
      users[name]={id};
    }
    const devices={};
    for(const [device,user] of [['a','alice'],['a2','alice'],['b','bob'],['outsider','outsider']]){
      const token='dvq_'+randomBytes(32).toString('base64url'),session=randomUUID();
      await pool.query(`WITH s AS (INSERT INTO davaq_social_sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day') RETURNING id)
        INSERT INTO davaq_social_access_tokens(token_hash,session_id,expires_at) SELECT $4,id,now()+interval '1 day' FROM s`,[session,users[user].id,sha(randomBytes(32)),sha(token)]);
      devices[device]={userId:users[user].id,token};
    }
    const room=randomUUID();await pool.query("INSERT INTO chat_rooms(id,type,last_message_seq) VALUES($1,'direct',120)",[room]);
    for(const user of ['alice','bob'])await pool.query('INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2)',[room,users[user].id]);
    const old=[];
    for(let i=1;i<=120;i++){const id=randomUUID();old.push(id);await pool.query("INSERT INTO messages(id,room_id,sender_id,room_seq,content,client_message_id) VALUES($1,$2,$3,$4,$5,$6)",[id,room,users.alice.id,i,'baseline '+i,'m-baseline-'+i]);}
    fixtures={room,users,devices,baselineMessages:old};
    await writeFile(join(root,'fixtures.private.json'),JSON.stringify(fixtures),{mode:0o600});
  }
  const beforeCount=(await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id=$1',[fixtures.room])).rows[0].n;
  await migrate(drizzle(pool),{migrationsFolder:migrations});
  const afterCount=(await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id=$1',[fixtures.room])).rows[0].n;
  assert.equal(afterCount,beforeCount);
  const entry=journal.entries.find(entry=>entry.idx===46),hash=sha(await readFile(join(migrations,entry.tag+'.sql')));
  const ledger=(await pool.query('SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1',[entry.when])).rows;
  assert.equal(ledger.length,1);assert.equal(ledger[0].hash,hash);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='message_deletions' AND column_name='profile_id'")).rows[0].n,1);
  check('migrations 0046 and 0047 preserve existing messages and deletion profiles',{messages:beforeCount,migrationSha256:hash});
}
function apiEnv(port){
  return {PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8',...Object.fromEntries(Object.entries(env).filter(([key])=>key!=='STAGE_DATABASE_PASSWORD')),HOST:'127.0.0.1',PORT:String(port),INSTANCE_NAME:'chat-stage-'+port,AWS_EC2_METADATA_DISABLED:'true',TCGINDEX_ORIGIN:'https://127.0.0.1:1'};
}
async function startApi(port){
  if(children.has(port))return;
  const log=await open(join(root,'api-'+port+'.log'),'a');
  const child=spawn(process.execPath,[join(repo,'artifacts/api-server/dist/index.mjs')],{cwd:join(repo,'artifacts/api-server'),env:apiEnv(port),stdio:['ignore',log.fd,log.fd]});
  children.set(port,child);await log.close();
  await until(async()=>{if(child.exitCode!==null)throw new Error('API exited '+child.exitCode);return (await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok;},'API ready '+port);
}
async function stopApi(port){const child=children.get(port);if(!child)return;children.delete(port);if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;}}
async function request(device,path,method='GET',body,port=18460){
  const identity=fixtures.devices[device];
  const response=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{Authorization:'Bearer '+identity.token,'Content-Type':'application/json',...(identity.profileId?{'x-character-profile-id':identity.profileId}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data=raw;}
  return {status:response.status,data};
}
async function send(device,content,key='m-'+randomUUID(),port=18460){const response=await request(device,`/rooms/${fixtures.room}/messages`,'POST',{content,type:'text',clientMessageId:key},port);assert.equal(response.status,201,JSON.stringify(response.data));return response.data;}
async function changes(device,cursor=null,port=18460){const response=await request(device,`/rooms/${fixtures.room}/changes${cursor===null?'':'?afterRevision='+cursor}`,'GET',undefined,port);assert.equal(response.status,200,JSON.stringify(response.data));return response.data;}
async function connect(device,port=18460){
  const ticket=await request(device,'/realtime/ticket','POST',undefined,port);assert.equal(ticket.status,200);
  const ws=new WebSocket(`ws://127.0.0.1:${port}/api/realtime?ticket=${encodeURIComponent(ticket.data.ticket)}`),events=[];
  ws.on('message',raw=>{try{events.push(JSON.parse(raw.toString()));}catch{}});sockets.add(ws);ws.on('close',()=>sockets.delete(ws));
  await until(()=>events.some(event=>event.type==='connected'),'socket connected');return {ws,events};
}
async function replay(device,cursor){let pages=0,rows=new Map(),removed=new Set(),last;do{last=await changes(device,cursor);cursor=last.revision;pages++;for(const m of last.messages)rows.set(m.id,m);for(const id of last.removedMessageIds)removed.add(id);}while(last.hasMore);return{cursor,pages,rows,removed,last};}
async function drain(){await until(async()=>Number((await pool.query('SELECT count(*) AS n FROM chat_delivery_outbox WHERE delivered_at IS NULL')).rows[0].n)===0,'outbox drained',30000);}
async function verify(){
  await startApi(18460);await startApi(18461);
  for(const device of Object.keys(fixtures.devices)){const state=await request(device,'/users/me/profiles');assert.equal(state.status,200,JSON.stringify(state.data));fixtures.devices[device].profileId=state.data.activeProfile.id;}
  await writeFile(join(root,'fixtures.private.json'),JSON.stringify(fixtures),{mode:0o600});
  const [a,a2,b]=await Promise.all([connect('a'),connect('a2',18461),connect('b',18461)]);
  const sent=await send('a','same account two-device delivery');
  for(const client of [a,a2,b])await until(()=>client.events.some(event=>event.type==='message.created'&&event.data?.messageId===sent.id),'message on each real socket');
  check('two API replicas deliver to sender, second session of same account and peer via real WebSockets');
  const duplicateKey='m-'+randomUUID();const duplicate=await Promise.all([send('a','response loss retry',duplicateKey),send('a','response loss retry',duplicateKey,18461)]);
  assert.equal(duplicate[0].id,duplicate[1].id);assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE client_message_id=$1',[duplicateKey])).rows[0].n,1);
  check('concurrent cross-replica retries persist one message');
  assert.equal((await request('outsider',`/rooms/${fixtures.room}/changes`)).status,403);
  check('real authentication rejects nonmember change-feed access');
  // Reset only disposable synthetic fixtures so repeated runs exercise real changes.
  await pool.query('UPDATE messages SET deleted_at=NULL WHERE id=$1',[fixtures.baselineMessages[0]]);
  await pool.query('DELETE FROM message_deletions WHERE message_id=$1',[fixtures.baselineMessages[1]]);
  await pool.query('DELETE FROM message_stickers WHERE message_id=ANY($1::uuid[])',[fixtures.baselineMessages.slice(2,4)]);
  const baseline=await changes('b');b.ws.terminate();
  const deleted=fixtures.baselineMessages[0],personal=fixtures.baselineMessages[1],reaction=fixtures.baselineMessages[2];
  assert.equal((await request('a',`/rooms/${fixtures.room}/messages/${deleted}/delete`,'POST',{scope:'everyone'})).status,204);
  assert.equal((await request('b',`/rooms/${fixtures.room}/messages/${personal}/delete`,'POST',{scope:'me'})).status,204);
  assert.equal((await request('a',`/rooms/${fixtures.room}/messages/${reaction}/sticker`,'POST',{code:'1f44d'})).status,204);
  const newIds=[];for(let i=0;i<65;i++)newIds.push((await send('a','offline gap '+i)).id);
  const restored=await replay('b',baseline.revision);
  assert(restored.rows.get(deleted)?.deletedAt);assert(restored.removed.has(personal));assert(restored.rows.get(reaction)?.stickerBadges.some(item=>item.code==='1f44d'));
  for(const id of newIds)assert(restored.rows.has(id));
  await connect('b',18461);
  check('disconnected real session restores >50 messages, old global/personal deletions and reactions',{newMessages:65,pages:restored.pages});
  assert.equal((await request('a2',`/rooms/${fixtures.room}/read`,'PATCH',{messageId:newIds.at(-1)},18461)).status,204);
  const readState=await changes('a');assert(readState.readCursors.find(row=>row.userId===fixtures.users.alice.id).lastReadSeq>=sent.roomSeq);
  check('read cursor from second device converges on first device');
  const roomMeta=await request('b',`/rooms/${fixtures.room}`);assert.equal(roomMeta.status,200);
  const unread=(await pool.query(`SELECT count(*)::int AS n FROM messages m JOIN chat_room_members cm ON cm.room_id=m.room_id AND cm.user_id=$2
    WHERE m.room_id=$1 AND m.sender_id<>$2 AND m.deleted_at IS NULL AND m.room_seq>cm.last_read_seq
    AND NOT EXISTS(SELECT 1 FROM message_deletions md WHERE md.message_id=m.id AND md.user_id=$2)`,[fixtures.room,fixtures.users.bob.id])).rows[0].n;
  assert.equal(roomMeta.data.unreadCount,unread);
  check('unread badge excludes global and personal deletions using the monotonic read cursor');
  await drain();
  // Independent SQL connections: a deferred revision lock must follow commit order.
  const c1=await pool.connect(),c2=await pool.connect();const marker=await changes('b');let secondCommitted=false;
  try{
    await c1.query('BEGIN');await c1.query("INSERT INTO message_stickers(message_id,user_id,code) VALUES($1,$2,'1f600') ON CONFLICT(message_id,user_id) DO UPDATE SET code=EXCLUDED.code",[reaction,fixtures.users.alice.id]);
    await c1.query('SET CONSTRAINTS ALL IMMEDIATE');
    await c2.query('BEGIN');await c2.query("INSERT INTO message_stickers(message_id,user_id,code) VALUES($1,$2,'1f601') ON CONFLICT(message_id,user_id) DO UPDATE SET code=EXCLUDED.code",[fixtures.baselineMessages[3],fixtures.users.bob.id]);
    const second=c2.query('COMMIT').then(()=>{secondCommitted=true;});await wait(200);assert.equal(secondCommitted,false);
    const whileWaiting=await changes('b',marker.revision);assert.equal(whileWaiting.revision,marker.revision);
    await c1.query('COMMIT');await second;
    const committed=await replay('b',marker.revision);assert(committed.rows.has(reaction));assert(committed.rows.has(fixtures.baselineMessages[3]));
  }finally{await c1.query('ROLLBACK').catch(()=>{});await c2.query('ROLLBACK').catch(()=>{});c1.release();c2.release();}
  check('independent PostgreSQL connections cannot commit a later room revision ahead of an earlier held revision');
  const beforeRedis=await changes('b');
  execFileSync(join(redisBin,'redis-cli'),['-h','127.0.0.1','-p','56346','shutdown','nosave']);
  const duringOutage=await send('a','persist while actual Redis is stopped');
  await until(async()=>Number((await pool.query('SELECT count(*) AS n FROM chat_delivery_outbox WHERE delivered_at IS NULL')).rows[0].n)>0,'durable jobs pending during Redis outage');
  assert.equal((await request('a','/realtime/ticket','POST')).status,503);
  execFileSync(join(redisBin,'redis-server'),['--bind','127.0.0.1','--port','56346','--protected-mode','yes','--daemonize','yes','--dir',join(root,'redis-data'),'--appendonly','yes','--pidfile',join(root,'redis.pid'),'--logfile',join(root,'redis.log')]);
  await drain();const afterRedis=await replay('b',beforeRedis.revision);assert(afterRedis.rows.has(duringOutage.id));
  check('actual Redis shutdown leaves durable work and restart drains it without message loss');
  const beforeCrash=await changes('b');await stopApi(18460);await stopApi(18461);
  const crashId=randomUUID();await pool.query(`WITH seq AS (UPDATE chat_rooms SET last_message_seq=last_message_seq+1 WHERE id=$1 RETURNING last_message_seq)
    INSERT INTO messages(id,room_id,sender_id,room_seq,content,client_message_id) SELECT $2,$1,$3,last_message_seq,'committed without an API worker',$4 FROM seq`,[fixtures.room,crashId,fixtures.users.alice.id,'m-'+randomUUID()]);
  assert(Number((await pool.query('SELECT count(*) AS n FROM chat_delivery_outbox WHERE delivered_at IS NULL')).rows[0].n)>0);
  await startApi(18460);await startApi(18461);await drain();const afterCrash=await replay('b',beforeCrash.revision);assert(afterCrash.rows.has(crashId));
  check('real API SIGKILL/restart recovers committed jobs and disconnected client history');
  execFileSync(pgctl,['-D',join(root,'pgdata'),'-m','immediate','-w','stop']);
  await until(async()=>!(await fetch('http://127.0.0.1:18460/api/healthz')).ok,'DB-down readiness',12000);
  execFileSync(pgctl,['-D',join(root,'pgdata'),'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p 55446 -k ${root}`,'-w','start']);
  await until(async()=>(await fetch('http://127.0.0.1:18460/api/healthz')).ok,'DB crash recovery');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE id=$1',[crashId])).rows[0].n,1);
  check('actual PostgreSQL immediate crash and WAL restart preserve committed messages and restore readiness');
}
try{
  await prepare();
  if(!process.argv.includes('--prepare-only'))await verify();
  await report('passed');
}catch(error){await report('failed',error);console.error(error);process.exitCode=1;}
finally{
  for(const socket of sockets)socket.terminate();
  for(const port of [...children.keys()])await stopApi(port);
  await pool.end().catch(()=>{});
}
