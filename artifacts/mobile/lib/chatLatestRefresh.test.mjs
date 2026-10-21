import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as reliability from './chatMessageReliability.ts';
import {notifyChatPush,subscribeChatPush,chatRoomFromPush} from './chatPushRefresh.ts';
function fixture(){
 let cache=[],resolve;
 const message=seq=>({id:`m${seq}`,roomId:'r',roomSeq:seq,senderId:'peer',createdAt:new Date(seq*1000).toISOString()});
 const client={getQueryData:()=>cache,setQueryData:(_,fn)=>{cache=fn(cache)}};
 const output={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./chatLatestRefresh.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:output,
  require(name){
   if(name==='@workspace/api-client-react')return {getFetchRoomMessagesQueryKey:id=>[id]};
   if(name.includes('chatMessageReliability'))return reliability;
   if(name.includes('chatTransport'))return {fetchChatMessages:()=>new Promise(r=>resolve=r)};
   throw Error(name);
  }
 });
 return {run:signal=>output.refreshLatestRoomMessages(client,'r',signal),resolve:()=>resolve([message(1),message(2)]),live:()=>{cache=[message(3)]},get cache(){return cache}};
}
test('push can populate a closed room and retain realtime writes during its request',async()=>{
 const f=fixture(),task=f.run(new AbortController().signal);f.live();f.resolve();await task;
 assert.deepEqual(f.cache.map(m=>m.id),['m1','m2','m3']);
});
test('account/route cancellation prevents late response from populating cache',async()=>{
 const f=fixture(),controller=new AbortController(),task=f.run(controller.signal);controller.abort();f.resolve();await task;
 assert.equal(f.cache.length,0);
});
test('native push identifiers reach subscribed session and stop after cleanup',()=>{
 const rooms=[],unsubscribe=subscribeChatPush(id=>rooms.push(id));
 notifyChatPush(chatRoomFromPush({url:'/chat/r'}));notifyChatPush(chatRoomFromPush({url:'https://other.example/chat/r'}));
 unsubscribe();notifyChatPush('r');assert.deepEqual(rooms,['r']);
});
