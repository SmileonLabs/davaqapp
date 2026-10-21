import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('./ChatCachedImage.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(resource) {
 const slots=[];let index=0;const pending=[];
 const React={useState(initial){const i=index++;if(!slots[i])slots[i]={value:initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value}];},useRef(initial){const i=index++;return slots[i]??=( {current:initial});},useEffect(fn,deps){const i=index++;if(!slots[i]||deps.some((v,j)=>v!==slots[i][j])){slots[i]=deps;pending.push(fn);}}};
 const exports={};vm.runInNewContext(code,{exports,require:name=>name==='react'?React:name==='react-native'?{Platform:{OS:'web'}}:name==='expo-image'?{Image:'image'}:name==='@clerk/expo'?{useAuth:()=>({userId:'owner'})}:name==='react/jsx-runtime'?{jsx:(type,props,key)=>({props,key})}: {useMediaResource:()=>resource,useBrowserChatPhoto:()=>({uri:resource.uri})}});
 return props=>{index=0;let result=exports.ChatCachedImage({objectPath:'/objects/photo',...props});pending.splice(0).forEach(fn=>fn());index=0;return exports.ChatCachedImage({objectPath:'/objects/photo',...props});};
}
test('expired photo retries the image element even if refreshed URL is unchanged',async()=>{
 let refreshes=0;const render=harness({uri:'https://example.test/photo',refresh:async()=>{refreshes++;return {error:null}}});
 const first=render({});first.props.onError({error:'expired'});await new Promise(resolve=>setImmediate(resolve));
 const retried=render({});assert.notEqual(retried.key,first.key);assert.equal(refreshes,1);
 retried.props.onError({error:'missing'});assert.equal(render({}).props.source,undefined);
 assert.equal(render({retryKey:1}).props.source.uri,'https://example.test/photo');
});
test('access URL failure is visible rather than a silent empty tile',()=>{
 const errors=[];const render=harness({uri:undefined,error:new Error('403'),refresh:async()=>({error:new Error('403')})});render({onError:e=>errors.push(e.error)});assert.equal(errors.length,1);
});
