import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('./chatBrowserMediaCache.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness() {
 const stores=new Map(); let fetches=0, conversions=0, revoked=0;
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {match:async r=>map.get(r.url)?.clone(),put:async(r,v)=>map.set(r.url,v),keys:async()=>[...map.keys()].map(u=>new Request(u)),delete:async r=>map.delete(r.url)};}};
 function create(){const exports={};vm.runInNewContext(code,{exports,Blob,Request,Response,TextDecoder,Date,Map,Promise,location:{origin:'https://example.test'},caches,fetch:async()=>{fetches++;return new Response(new Blob(['heic'],{type:'image/heic'}));},URL:{createObjectURL:()=>`blob:${fetches}:${conversions}`,revokeObjectURL:()=>revoked++},require:()=>({convertHeicIfNeeded:async()=>{conversions++;return {contentType:'image/jpeg',blob:new Blob(['jpeg'],{type:'image/jpeg'})};}})});return exports;}
 return {create,stores,counts:()=>({fetches,conversions,revoked})};
}
test('concurrent consumers and scroll remount reuse one converted photo',async()=>{
 const h=harness(),m=h.create();m.setBrowserMediaOwner('alice');
 const [a,b]=await Promise.all([m.acquireBrowserPhoto('alice','/objects/p',async()=>'/ticket'),m.acquireBrowserPhoto('alice','/objects/p',async()=>'/ticket')]);
 assert.equal(a.uri,b.uri);a.release();a.release();b.release();
 const c=await m.acquireBrowserPhoto('alice','/objects/p',async()=>'/new-ticket');assert.equal(c.uri,a.uri);c.release();assert.deepEqual(h.counts(),{fetches:1,conversions:1,revoked:0});
});
test('new page reuses persistent JPEG without network or conversion',async()=>{
 const h=harness(),m=h.create();m.setBrowserMediaOwner('alice');(await m.acquireBrowserPhoto('alice','/objects/p',async()=>'/ticket')).release();
 const next=h.create();next.setBrowserMediaOwner('alice');(await next.acquireBrowserPhoto('alice','/objects/p',async()=>{throw Error('network should not run');})).release();assert.equal(h.counts().fetches,1);assert.equal(h.counts().conversions,1);
});
test('account change invalidates old access and removes prior local data',async()=>{
 const h=harness(),m=h.create();m.setBrowserMediaOwner('alice');(await m.acquireBrowserPhoto('alice','/objects/p',async()=>'/ticket')).release();
 m.setBrowserMediaOwner('bob');await m.acquireBrowserPhoto('bob','/objects/p',async()=>'/ticket');assert.equal(h.stores.has('davaq-private-photo-v1-alice'),false);await assert.rejects(m.acquireBrowserPhoto('alice','/objects/p',async()=>'/ticket'),/owner-changed/);assert.equal(h.counts().fetches,2);
});
test('logout during fetch prevents insertion of private photo',async()=>{
 const h=harness(),m=h.create();m.setBrowserMediaOwner('alice');let resume;const loading=m.acquireBrowserPhoto('alice','/objects/p',()=>new Promise(r=>resume=r));while(!resume)await new Promise(r=>setImmediate(r));m.setBrowserMediaOwner(undefined);resume('/ticket');await assert.rejects(loading,/owner-changed/);assert.equal(h.stores.has('davaq-private-photo-v1-alice'),false);
});
test('explicit retry discards cached data and fetches a fresh copy',async()=>{
 const h=harness(),m=h.create();m.setBrowserMediaOwner('alice');const first=await m.acquireBrowserPhoto('alice','/objects/p',async()=>'/ticket');first.release();
 await m.invalidateBrowserPhoto('alice','/objects/p');assert.equal(m.peekBrowserPhoto('alice','/objects/p'),undefined);(await m.acquireBrowserPhoto('alice','/objects/p',async()=>'/fresh')).release();assert.equal(h.counts().fetches,2);
});
test('memory and persistent cache retain at most 80 inactive photos',async()=>{
 const h=harness(),m=h.create();m.setBrowserMediaOwner('alice');for(let i=0;i<82;i++)(await m.acquireBrowserPhoto('alice',`/objects/${i}`,async()=>'/ticket')).release();
 assert.equal(m.peekBrowserPhoto('alice','/objects/0'),undefined);assert.equal(h.stores.get('davaq-private-photo-v1-alice').size,80);assert.equal(h.counts().revoked,2);
});
