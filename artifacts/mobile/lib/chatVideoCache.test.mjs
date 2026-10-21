import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts=require('typescript');
const code=ts.transpileModule(readFileSync(new URL('./chatVideoCache.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup({status=200,size=1024,block}={}) {
 const files=new Map(),root='file:///cache/davaq-videos/';let downloads=0;
 const fs={cacheDirectory:'file:///cache/',getInfoAsync:async uri=>files.has(uri)?{exists:true,isDirectory:false,size:files.get(uri).size,modificationTime:files.get(uri).time}:{exists:false},readDirectoryAsync:async()=>[...files.keys()].filter(x=>x.startsWith(root)).map(x=>x.slice(root.length)),makeDirectoryAsync:async()=>{},deleteAsync:async uri=>{for(const path of files.keys())if(path===uri||path.startsWith(uri+'/'))files.delete(path);},moveAsync:async({from,to})=>{files.set(to,files.get(from));files.delete(from);},downloadAsync:async(_url,uri)=>{downloads++;await block?.();files.set(uri,{size,time:Date.now()/1000});return{status,uri};}};
 const module={exports:{}};
 vm.runInNewContext(code,{exports:module.exports,require:name=>name==='expo-file-system/legacy'?fs:{CryptoDigestAlgorithm:{SHA256:'sha'},digestStringAsync:async(_type,value)=>Buffer.from(value).toString('hex')},Map,Promise,Date,Error,Math});
 return {api:module.exports,files,root,downloads:()=>downloads};
}
test('cached video survives a renewed ticket and works without network',async()=>{const s=setup();const first=await s.api.getChatVideoFile('a','/objects/x',async()=> 'ticket1');const second=await s.api.getChatVideoFile('a','/objects/x',async()=>{throw Error('offline');});assert.equal(first,second);assert.equal(s.downloads(),1);});
test('concurrent opens share one download',async()=>{const s=setup();const values=await Promise.all([1,2,3].map(()=>s.api.getChatVideoFile('a','/objects/x',async()=> 'url')));assert.equal(new Set(values).size,1);assert.equal(s.downloads(),1);});
test('different owners never share a video file',async()=>{const s=setup();const a=await s.api.getChatVideoFile('a','/objects/x',async()=> 'url');const b=await s.api.getChatVideoFile('b','/objects/x',async()=> 'url');assert.notEqual(a,b);});
test('expired files are downloaded again',async()=>{const s=setup();const uri=await s.api.getChatVideoFile('a','/objects/x',async()=> 'url');s.files.get(uri).time-=8*86400;await s.api.getChatVideoFile('a','/objects/x',async()=> 'new');assert.equal(s.downloads(),2);});
test('failed responses never become cached videos',async()=>{const s=setup({status:404});await assert.rejects(s.api.getChatVideoFile('a','/objects/x',async()=> 'url'));assert.equal(s.files.size,0);});
test('cache size evicts oldest files above 150MB',async()=>{const s=setup({size:25*1024*1024});for(let i=0;i<8;i++)await s.api.getChatVideoFile('a',`/objects/${i}`,async()=> 'url');assert.ok(s.files.size<=6);});
test('owner switch during download cannot recreate old cached media',async()=>{let release;const gate=new Promise(r=>release=r);const s=setup({block:()=>gate});await s.api.setChatMediaOwner('a');const pending=s.api.getChatVideoFile('a','/objects/x',async()=> 'url');while(!s.downloads())await new Promise(r=>setTimeout(r,0));await s.api.setChatMediaOwner('b');release();await assert.rejects(pending);assert.equal(s.files.size,0);});
