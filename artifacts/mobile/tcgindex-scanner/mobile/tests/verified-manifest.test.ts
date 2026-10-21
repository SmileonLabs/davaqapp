import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {File} from 'expo-file-system';
import {recoverVerifiedManifest,replaceVerifiedManifest} from '../src/verified-manifest.ts';

function fixture(failPublish=false){
 const files=new Map([['current','verified-old'],['pending','verified-new']]);
 const ref=(initial:string)=>{let name=initial;return ({get exists(){return files.has(name);},delete(){files.delete(name);},move(target:{name:string}){
  if(name==='pending'&&failPublish)throw Error('storage move failed');
  assert.ok(files.has(name));assert.equal(files.has(target.name),false);
  const destination=target.name;files.set(destination,files.get(name)!);files.delete(name);name=destination;
 },get name(){return name;}}) as unknown as File;};
 return {files,current:()=>ref('current'),pending:ref('pending'),previous:()=>ref('previous')};
}
test('verified snapshot publishes while retaining a recoverable prior manifest',async()=>{
 const f=fixture();await replaceVerifiedManifest(f.current,f.pending,f.previous);
 assert.equal(f.files.get('current'),'verified-new');assert.equal(f.files.get('previous'),'verified-old');
});
test('failed publication restores the old manifest for the next offline launch',async()=>{
 const f=fixture(true);await assert.rejects(replaceVerifiedManifest(f.current,f.pending,f.previous));
 assert.equal(f.files.get('current'),'verified-old');
});
test('app interruption between moving the old and new manifests recovers on launch',async()=>{
 const f=fixture();f.files.set('previous',f.files.get('current')!);f.files.delete('current');
 await recoverVerifiedManifest(f.current,f.previous);assert.equal(f.files.get('current'),'verified-old');
});
test('first download failure does not discard a recoverable previous snapshot',async()=>{
 const f=fixture(true);f.files.set('previous','last-usable');f.files.delete('current');
 await assert.rejects(replaceVerifiedManifest(f.current,f.pending,f.previous));
 assert.equal(f.files.get('current'),'last-usable');
});
