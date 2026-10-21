import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {selectPreloadRooms} from './chatPreloadPolicy.ts';
function fixture(){
 const output={},requests=[],pending=[];let resolveRooms,cache;
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./chatResumeRefresh.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:output,Map,Promise,
  require(name){
   if(name==='@workspace/api-client-react')return {listRooms:()=>new Promise(r=>resolveRooms=r),getListRoomsQueryKey:()=>['rooms']};
   if(name.includes('chatPreloadPolicy'))return {selectPreloadRooms};
   if(name.includes('chatLatestRefresh'))return {refreshLatestRoomMessages:(_,id)=>{requests.push(id);return new Promise(r=>pending.push(r))}};
   throw Error(name);
  }
 });
 const client={setQueryData:(_,data)=>{cache=data}};
 return {run:signal=>output.refreshChatsOnResume(client,signal),rooms:data=>resolveRooms(data),requests,pending,get cache(){return cache}};
}
test('resume publishes fresh inbox and queues every unread room beyond preload limit with concurrency two',async()=>{
 const f=fixture(),task=f.run(new AbortController().signal);
 const rooms=Array.from({length:8},(_,i)=>({id:String(i),unreadCount:1}));
 f.rooms(rooms);await new Promise(setImmediate);
 assert.equal(f.cache,rooms);assert.deepEqual(f.requests,['0','1']);
 while(f.pending.length){f.pending.shift()();await new Promise(setImmediate);}
 await task;assert.deepEqual(f.requests,rooms.map(r=>r.id));
});
test('backgrounding during inbox fetch prevents stale writes and message requests',async()=>{
 const f=fixture(),c=new AbortController(),task=f.run(c.signal);c.abort();f.rooms([{id:'r',unreadCount:1}]);await task;
 assert.equal(f.cache,undefined);assert.equal(f.requests.length,0);
});
test('backgrounding during message refresh stops remaining queue',async()=>{
 const f=fixture(),c=new AbortController(),task=f.run(c.signal);f.rooms(Array.from({length:8},(_,i)=>({id:String(i),unreadCount:1})));await new Promise(setImmediate);
 c.abort();for(const resolve of f.pending)resolve();await task;assert.equal(f.requests.length,2);
});
