import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as reliability from '../lib/chatMessageReliability.ts';
import { selectPreloadRooms } from '../lib/chatPreloadPolicy.ts';

test('unread rooms precede recent read rooms and the preload budget is bounded', () => {
 const rooms=Array.from({length:10},(_,i)=>({id:String(i),unreadCount:i===0?1:0,lastMessageAt:new Date(i*1000).toISOString()}));
 const result=selectPreloadRooms(rooms);
 assert.deepEqual(result.map(r=>r.id),['0','9','8','7','6','5']);
 assert.equal(rooms[0].id,'0');
});
function fixture({head}={}) {
 const effects=[],requests=[],cache=new Map(); let pending=[],cleanup;
 const message=(id,seq)=>({id,roomId:'r',roomSeq:seq,senderId:'peer',createdAt:new Date(seq*1000).toISOString()});
 cache.set('r',[message('m1',1)]);
 const client={getQueryCache:()=>({find:({queryKey:[id]})=>id==='mounted'?{getObserversCount:()=>1}:undefined}),getQueryData:([id])=>cache.get(id),setQueryData:([id],update)=>cache.set(id,update(cache.get(id)))};
 const output={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useChatPreload.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:output,AbortController,Date,Promise,
 require(name){
  if(name==='react')return {useEffect:(fn)=>effects.push(fn),useState:(v)=>[v,()=>{}],useSyncExternalStore:()=>false};
  if(name==='react-native')return {Platform:{OS:'android'},AppState:{currentState:'active',addEventListener:()=>({remove(){}})}};
  if(name==='@tanstack/react-query')return {useQueryClient:()=>client};
  if(name==='@workspace/api-client-react')return {getListRoomsQueryKey:()=>['rooms'],getFetchRoomMessagesQueryKey:id=>[id],useGetMe:()=>({data:{id:'me'}}),useListRooms:()=>({data:[{id:'r',lastMessageSeq:head},{id:'mounted'},{id:'s'},{id:'t'}]})};
  if(name.includes('chatRealtimeStatus'))return {getChatRealtimeConnected:()=>false,subscribeChatRealtimeStatus:()=>()=>{},chatRoomListPollInterval:()=>30000};
  if(name.includes('useCharacterProfiles'))return {useCharacterProfiles:()=>({activeProfile:{id:'p'}})};
  if(name.includes('chatPreloadPolicy'))return {selectPreloadRooms};
  if(name.includes('chatMessageReliability'))return reliability;
  if(name.includes('chatTransport'))return {fetchChatMessages:(id,params,options)=>{requests.push({id,params,options});return new Promise(resolve=>pending.push(resolve));}};
  throw Error('Unexpected import '+name);
 }
 });
 output.useChatPreload();for(const effect of effects)cleanup=effect();
 return {requests,cache,message,resolveFirst:()=>pending.shift()([message('m1',1),message('m2',2)]),cancel:()=>cleanup()};
}
test('preloading limits concurrency, skips mounted rooms and preserves concurrent realtime rows',async()=>{
 const f=fixture();assert.deepEqual(f.requests.map(r=>r.id),['r','s']);
 f.cache.set('r',[f.message('m1',1),f.message('m3',3)]);
 f.resolveFirst();await new Promise(setImmediate);
 assert.deepEqual(f.cache.get('r').map(m=>m.id),['m1','m2','m3']);
 assert.deepEqual(f.requests.map(r=>r.id),['r','s','t']);f.cancel();
});
test('an aborted preload cannot write late data or start the remaining queue',async()=>{
 const f=fixture();f.cancel();f.resolveFirst();await new Promise(setImmediate);
 assert.equal(f.requests[0].options.signal.aborted,true);
 assert.deepEqual(f.cache.get('r').map(m=>m.id),['m1']);assert.equal(f.requests.length,2);
});

test('an unchanged warm room head does not fetch the same latest window again',()=>{
 const f=fixture({head:1});assert.deepEqual(f.requests.map(r=>r.id),['s','t']);f.cancel();
});
