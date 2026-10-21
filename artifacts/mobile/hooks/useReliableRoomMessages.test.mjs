import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { replaceEqualDeep } from '@tanstack/react-query';
import * as reliability from '../lib/chatMessageReliability.ts';
import { ChatChangeRecovery } from '../lib/chatChangeRecovery.ts';

function fixture({fetchChanges,fetchMessages,history=null}={}) {
 const saves=[];
 const slots=[],effects=[]; let position=0,options,cache=[],released,result,refetchCalls=0,latestRefreshCalls=0,committed=false,updatedAt=0,queryIdentity={};
 const pageGate=new Promise(resolve=>released=resolve);
 const message=(seq)=>({id:`m${seq}`,roomId:'room',roomSeq:seq,senderId:'other',createdAt:new Date(seq*1000).toISOString()});
 const requestedCursors=[];
 const latest=Array.from({length:50},(_,i)=>message(i+70));
 const client={getQueryCache:()=>({find:()=>queryIdentity}),getQueryData:()=>cache,setQueryData:(_,update)=>{cache=typeof update==='function'?update(cache):update},invalidateQueries:()=>{}};
 const react={useCallback(fn){position++;return fn},useRef(value){let i=position++;return slots[i]??= {current:value}},useState(value){let i=position++;if(!(i in slots))slots[i]=value;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useMemo(fn){position++;return fn()},useEffect(fn,deps){let i=position++;if(!slots[i]||deps.some((d,j)=>d!==slots[i][j])){slots[i]=deps;effects.push(fn)}}};
 const output={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useReliableRoomMessages.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:output,setTimeout,clearTimeout,AbortController,
 require(name){
  if(name==='react')return react;
  if(name==='@tanstack/react-query')return {replaceEqualDeep,useQueryClient:()=>client,useQuery:o=>{options=o;return {isSuccess:committed,data:cache,dataUpdatedAt:updatedAt,refetch:async()=>{refetchCalls++;return {}}}}};
  if(name==='@workspace/api-client-react')return {getFetchRoomMessagesQueryKey:()=>['room'],getListRoomsQueryKey:()=>['rooms'],getGetRoomQueryKey:()=>['meta']};
  if(name.includes('chatHistoryStore'))return {loadChatHistory:async()=>history,saveChatHistory:async s=>{saves.push(s)},chatHistoryGeneration:()=>0};
  if(name.includes('chatChangeRecovery'))return {ChatChangeRecovery};
  if(name.includes('chatMessageReliability'))return reliability;
  if(name.includes('chatConfirmedCursorStore'))return {loadConfirmedChatCursor:async()=>8,saveConfirmedChatCursor:async()=>{}};
  if(name.includes('chatPerformanceDiagnostics'))return {noteChatRender(){},noteChatResource(){}};
  if(name.includes('chatLatestRefresh'))return {refreshLatestRoomMessages:async()=>{latestRefreshCalls++;}};
  if(name.includes('chatTransport'))return {fetchChatChanges:fetchChanges,fetchChatMessages:async(room,params)=>{if(fetchMessages)return fetchMessages(room,params);if(!params.afterSeq)return latest;requestedCursors.push(params.afterSeq);await pageGate;return []}};
  throw Error(name);
 }
 });
 let profileId='profile';
 const render=()=>{position=0;result=output.useReliableRoomMessages('room',{userId:'me',profileId});effects.splice(0).forEach(fn=>fn())};
 return {saves,render,switchProfile(){profileId='profile-b';render();},remount(){slots.length=0;render();},evict(){cache=undefined;queryIdentity={};},preload(data){cache=data;},commit(data){cache=options.structuralSharing(cache,data);committed=true;updatedAt++;},get latestRefreshCalls(){return latestRefreshCalls},get result(){return result},get refetchCalls(){return refetchCalls},get options(){return options},get cache(){return cache},requestedCursors,release:()=>released()};
}
test('latest messages appear before a stalled catch-up page completes',async()=>{
 const f=fixture();f.render();await new Promise(setImmediate);f.render();
 assert.equal(f.options.enabled,true);
 let completed=false;
 const request=f.options.queryFn({signal:new AbortController().signal}).then(value=>{completed=true;return value});
 await new Promise(setImmediate);
 assert.equal(completed,false);
 assert.equal(f.cache.at(-1).id,'m119');
 f.release();const result=await request;assert.equal(result.at(-1).id,'m119');
 await f.options.queryFn({signal:new AbortController().signal});
 assert.deepEqual(f.requestedCursors,[8,8]); // Projection alone never commits a receive cursor.
});

test('focus recovery waits for account cursor hydration instead of starting a failing request',async()=>{
 const f=fixture();f.render();await f.result.refetch();assert.equal(f.refetchCalls,0);
 await new Promise(setImmediate);f.render();await f.result.refetch();assert.equal(f.refetchCalls,1);
});

test('entry starts latest-window request before durable cursor hydration enables catch-up',()=>{
 const f=fixture();f.render();
 assert.equal(f.options.enabled,false);
 assert.equal(f.latestRefreshCalls,1);
});


test('change cursor advances only after the exact query result commits',async()=>{
 const cursors=[];
 const f=fixture({fetchChanges:async(_,cursor)=>{cursors.push(cursor);return {protocol:1,revision:'7',snapshotRoomSeq:1,reset:cursor===null,hasMore:false,messages:[{id:'m1',roomId:'room',roomSeq:1,senderId:'other',createdAt:new Date(1000).toISOString()}],removedMessageIds:[],readCursors:[]}}});
 f.render();await new Promise(setImmediate);f.render();
 const aborted=await f.options.queryFn({signal:new AbortController().signal});
 assert.equal(aborted[0].id,'m1');
 const accepted=await f.options.queryFn({signal:new AbortController().signal});
 assert.deepEqual(cursors,[null,null]);
 f.commit(accepted);f.render();
 await f.options.queryFn({signal:new AbortController().signal});
 assert.deepEqual(cursors,[null,null,'7']);
});

test('new protocol failures do not silently downgrade or advance recovery',async()=>{
 let calls=0;
 const f=fixture({fetchChanges:async()=>{calls++;throw Object.assign(new Error('offline'),{status:503})}});
 f.render();await new Promise(setImmediate);f.render();
 await assert.rejects(f.options.queryFn({signal:new AbortController().signal}),/offline/);
 assert.equal(calls,1);assert.equal(f.requestedCursors.length,0);
});

test('older servers returning 404 keep the legacy message recovery path',async()=>{
 const f=fixture({fetchChanges:async()=>{throw Object.assign(new Error('old server'),{status:404})}});
 f.render();await new Promise(setImmediate);f.render();f.release();
 const result=await f.options.queryFn({signal:new AbortController().signal});
 assert.equal(result.at(-1).id,'m119');assert.deepEqual(f.requestedCursors,[8]);
});

test('room remount reuses the cursor only while its message cache exists',async()=>{
 const cursors=[];
 const f=fixture({fetchChanges:async(_,cursor)=>{cursors.push(cursor);return {protocol:1,revision:'7',snapshotRoomSeq:1,reset:cursor===null,hasMore:false,messages:[{id:'m1',roomId:'room',roomSeq:1,senderId:'other',createdAt:new Date(1000).toISOString()}],removedMessageIds:[],readCursors:[]}}});
 f.render();await new Promise(setImmediate);f.render();
 const first=await f.options.queryFn({signal:new AbortController().signal});
 f.commit(first);f.render();
 f.remount();await new Promise(setImmediate);f.render();
 await f.options.queryFn({signal:new AbortController().signal});
 assert.deepEqual(cursors,[null,'7']);
 f.evict();f.preload(first);f.remount();await new Promise(setImmediate);f.render();
 await f.options.queryFn({signal:new AbortController().signal});
 assert.deepEqual(cursors,[null,'7',null]);
});


test('restart restores matching bodies and revision, then persists only an accepted change result',async()=>{
 const m={id:'persisted',roomId:'room',roomSeq:44,senderId:'other',createdAt:new Date(44000).toISOString()};
 const history={version:1,userId:'me',profileId:'profile',roomId:'room',revision:'90',snapshotRoomSeq:44,savedAt:Date.now(),messages:[m]};
 const cursors=[];const f=fixture({history,fetchChanges:async(_r,c)=>{cursors.push(c);return{protocol:1,revision:'91',snapshotRoomSeq:44,reset:false,hasMore:false,messages:[],removedMessageIds:[],readCursors:[]}}});
 f.render();await new Promise(setImmediate);f.render();assert.equal(f.cache[0].id,'persisted');
 const result=await f.options.queryFn({signal:new AbortController().signal});assert.deepEqual(cursors,['90']);assert.equal(f.saves.length,0);
 f.commit(result);f.render();await new Promise(setImmediate);assert.equal(f.saves[0].revision,'91');assert.equal(f.saves[0].messages[0].id,'persisted');
});

const historyRow = seq => ({id:`m${seq}`,roomId:'room',roomSeq:seq,senderId:'other',createdAt:new Date(seq*1000).toISOString(),content:'original'});
const changePage = (revision, messages=[], rest={}) => ({protocol:1,revision,snapshotRoomSeq:119,reset:false,hasMore:false,messages,removedMessageIds:[],readCursors:[],...rest});
async function syncedFixture(options={}) {
 const f=fixture({fetchChanges:async()=>changePage('1',Array.from({length:50},(_,i)=>historyRow(70+i)),{reset:true}),...options});
 f.render();await new Promise(setImmediate);f.render();const data=await f.options.queryFn({signal:new AbortController().signal});f.commit(data);f.render();return f;
}
test('backward pagination adds history without advancing receive revision, and deduplicates in-flight calls',async()=>{
 let release;const gate=new Promise(r=>release=r);const calls=[];
 const f=await syncedFixture({fetchMessages:async(_r,p)=>{calls.push(p);await gate;return Array.from({length:50},(_,i)=>historyRow(20+i));}});
 const a=f.result.loadOlder(),b=f.result.loadOlder();assert.equal(a,b);release();await a;f.render();
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{beforeSeq:70,limit:50}]);assert.equal(f.cache.length,100);assert.equal(f.result.data[0].roomSeq,20);
 assert.equal(f.saves.length,2);assert.equal(f.saves[1].revision,'1'); // History persists bodies using the existing revision.
});
test('late history cannot resurrect a removed row or overwrite an edit from change recovery',async()=>{
 let release;const gate=new Promise(r=>release=r);let changes=0;
 const f=await syncedFixture({fetchChanges:async()=>++changes===1?changePage('1',Array.from({length:50},(_,i)=>historyRow(70+i)),{reset:true}):changePage('2',[{...historyRow(26),content:'edited'}],{removedMessageIds:['m25']}),fetchMessages:async()=>{await gate;return Array.from({length:50},(_,i)=>historyRow(20+i));}});
 const pending=f.result.loadOlder();f.commit(await f.options.queryFn({signal:new AbortController().signal}));f.render();release();await pending;f.render();
 assert.equal(f.result.data.some(m=>m.id==='m25'),false);assert.equal(f.result.data.find(m=>m.id==='m26')?.content,'edited');
});
test('history admitted during an in-flight change commit survives the commit',async()=>{
 let count=0;const f=await syncedFixture({fetchChanges:async()=>++count===1?changePage('1',Array.from({length:50},(_,i)=>historyRow(70+i)),{reset:true}):changePage('2'),fetchMessages:async()=>[historyRow(69)]});
 const change=await f.options.queryFn({signal:new AbortController().signal});await f.result.loadOlder();f.commit(change);f.render();
 assert.equal(f.result.data.some(m=>m.id==='m69'),true);
});
test('old account/profile history response is discarded',async()=>{
 let release;const gate=new Promise(r=>release=r);const f=await syncedFixture({fetchMessages:async()=>{await gate;return [historyRow(69)]}});
 const pending=f.result.loadOlder();f.switchProfile();release();await pending;
 assert.equal(f.cache.some(m=>m.id==='m69'),false);
});
test('invalid history page fails without mutating the message cache',async()=>{
 const f=await syncedFixture({fetchMessages:async()=>[{...historyRow(69),roomId:'another-room'}]});
 await assert.rejects(f.result.loadOlder(),/Invalid room history page/);f.render();assert.equal(f.cache.length,50);assert.match(f.result.olderError,/다시 시도/);
});
test('an authoritative reset reopens backward pagination and rejects an older page from the previous epoch',async()=>{
 let count=0,release;const gate=new Promise(r=>release=r);
 const f=await syncedFixture({fetchChanges:async()=>changePage(String(++count),Array.from({length:50},(_,i)=>historyRow(70+i)),{reset:true}),fetchMessages:async()=>{await gate;return [historyRow(69)]}});
 const pending=f.result.loadOlder();f.commit(await f.options.queryFn({signal:new AbortController().signal}));f.render();release();await pending;f.render();
 assert.equal(f.result.data.some(m=>m.id==='m69'),false);assert.equal(f.result.loadingOlder,false);assert.equal(f.result.hasOlder,true);
 await f.result.loadOlder();f.render();assert.equal(f.result.data.some(m=>m.id==='m69'),true);assert.equal(f.result.hasOlder,false);
 f.commit(await f.options.queryFn({signal:new AbortController().signal}));f.render();assert.equal(f.result.hasOlder,true);
});
test('the render accepting a change uses its new overlay before the cursor-commit effect',async()=>{
 let count=0;const f=await syncedFixture({fetchChanges:async()=>++count===1?changePage('1',[historyRow(70)],{reset:true}):changePage('2',[{...historyRow(70),content:'updated-now'}])});
 f.commit(await f.options.queryFn({signal:new AbortController().signal}));f.render();
 assert.equal(f.result.data.find(m=>m.id==='m70')?.content,'updated-now');
});
