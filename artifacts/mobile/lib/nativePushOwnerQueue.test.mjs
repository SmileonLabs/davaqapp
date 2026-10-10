import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function harness(){
 let now=1000;const values=new Map();
 const storage={getItem:async k=>values.get(k)??null,setItem:async(k,v)=>{values.set(k,v)},removeItem:async k=>{values.delete(k)}};
 function load(file,deps){const exports={};const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{exports,Date:class extends Date {static now(){return now}},require:n=>deps[n]});return exports;}
 const policy=load('./nativePushOwnerPolicy.ts',{});
 const owner=load('./nativePushOwner.ts',{'./nativePushOwnerPolicy':policy,'@react-native-async-storage/async-storage':{default:storage}});
 const calls=[];
 const telecom=load('./androidTelecom.android.ts',{'./androidCallPolicy':{},'./nativePushOwner':owner,'react-native':{NativeModules:{DavaqTelecom:{startCall:async raw=>{calls.push(JSON.parse(raw))}}}}});
 return {owner,telecom,calls,advance:()=>{now+=10}};
}
test('queued lookup must not delete an owner written after lookup was scheduled',async()=>{
 const h=harness();const write=h.owner.setCurrentNativePushOwner('A');const read=h.owner.getCurrentNativePushOwner();h.advance();await write;assert.equal(await read,'A');assert.equal(await h.owner.getCurrentNativePushOwner(),'A');
});
test('incoming push evaluates time when its queued owner read executes',async()=>{
 const h=harness();const write=h.owner.setCurrentNativePushOwner('A');const match=h.owner.nativePushMatchesCurrentOwner('A');h.advance();await write;assert.equal(await match,true);assert.equal(await h.owner.nativePushMatchesCurrentOwner('B'),false);
});
test('explicit validation time still rejects a future lease',async()=>{
 const h=harness();await h.owner.setCurrentNativePushOwner('A');assert.equal(await h.owner.getCurrentNativePushOwner(999),null);
});

test('outgoing Telecom registration survives a pending login owner write',async()=>{
 const h=harness();const write=h.owner.setCurrentNativePushOwner('A');
 const started=h.telecom.registerSystemCall({id:'call-1',callerId:'A',media:'audio',status:'ringing',createdAt:'2026-10-10T00:00:00Z'},'Test');
 h.advance();await write;await started;
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].ownerId,'A');assert.equal(h.calls[0].direction,'outgoing');
});
test('signed-out Telecom registration remains blocked',async()=>{
 const h=harness();await assert.rejects(h.telecom.registerSystemCall({id:'call-1'},'Test'),/call_owner_unavailable/);assert.equal(h.calls.length,0);
});
