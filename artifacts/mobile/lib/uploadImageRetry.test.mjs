import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const code=ts.transpileModule(readFileSync(new URL('./uploadImage.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const asset={uri:'picker://temporary',width:100,height:100,fileName:'photo.jpg',mimeType:'image/jpeg'};
function setup(transfer=async()=>({objectPath:'/objects/photo'})) {
 let preparations=0;const timers=new Map();let next=0;
 const module={exports:{}};
 vm.runInNewContext(code,{exports:module.exports,require:name=>{
  if(name==='react-native')return{Platform:{OS:'web'}};
  if(name==='expo-image-picker')return{};
  if(name==='@workspace/api-client-react')return{customFetch:transfer};
  if(name==='./chatImagePreparation')return{prepareChatImage:async a=>{preparations++;return{...a,uri:'file://retained.jpg',thumbnail:'tiny'};}};
  if(name==='./convertHeic')return{convertHeicIfNeeded:async blob=>({blob,name:'photo.jpg',contentType:'image/jpeg'})};
  throw Error(name);
 },AbortController,URLSearchParams,fetch:async uri=>({blob:async()=>new Blob(['image'],{type:'image/jpeg'})}),setTimeout:callback=>{const id=++next;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),Error,Promise,Date,Math});
 return{api:module.exports,timers,preparations:()=>preparations};
}
test('failed upload retains prepared file and retries without picker or recompression',async()=>{
 let transfers=0,retained;
 const s=setup(async()=>{if(++transfers===1)throw Error('offline');return{objectPath:'/objects/photo'};});
 await assert.rejects(s.api.pickAndUploadImages({assets:[asset],onPrepared:a=>retained=a}),/offline/);
 assert.equal(retained.uri,'file://retained.jpg');
 assert.equal(retained._chatUploadPrepared,true);
 const result=await s.api.pickAndUploadImages({assets:[retained]});
 assert.equal(result[0].objectPath,'/objects/photo');assert.equal(result[0].thumbnail,'tiny');
 assert.equal(s.preparations(),1);assert.equal(s.timers.size,0);
});
test('a stalled transfer times out and releases its retry deadline',async()=>{
 let started;
 const ready=new Promise(r=>started=r);
 const s=setup(async()=>{started();return new Promise(()=>{});});
 const pending=s.api.pickAndUploadImages({assets:[asset]});
 await ready;[...s.timers.values()][0]();
 await assert.rejects(pending,/image-upload-timeout/);assert.equal(s.timers.size,0);
});
test('successful prefix is not reuploaded when retrying the failed album tail',async()=>{
 let transfers=0;const completed=[];let remaining=[asset,{...asset,uri:'picker://second'}];
 const s=setup(async()=>{if(++transfers===2)throw Error('offline');return{objectPath:'/objects/'+transfers};});
 const options={assets:remaining,onPrepared:a=>{remaining=[a,...remaining.slice(1)];},onUploaded:async image=>{completed.push(image.objectPath);remaining=remaining.slice(1);}};
 await assert.rejects(s.api.pickAndUploadImages(options),/offline/);
 assert.equal(remaining.length,1);
 await s.api.pickAndUploadImages({...options,assets:remaining});
 assert.deepEqual(completed,['/objects/1','/objects/3']);assert.equal(s.preparations(),2);
});
test('explicit cancellation remains distinct from timeout',async()=>{
 let started;const ready=new Promise(r=>started=r);
 const s=setup(async(_url,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true}));});
 const controller=new AbortController();const pending=s.api.pickAndUploadImages({assets:[asset],signal:controller.signal});
 await ready;controller.abort();await assert.rejects(pending,error=>error.name==='UploadCancelledError');assert.equal(s.timers.size,0);
});
