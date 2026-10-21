import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function fixture(platform='web') {
 const doc=new EventTarget(), win=new EventTarget(), calls=[];doc.hidden=false;
 let now=0,cleanup,resolveCancel;
 const client={cancelQueries:options=>{calls.push(['cancel',options]);return new Promise(r=>resolveCancel=r)},invalidateQueries:async options=>{calls.push(['invalidate',options])}};
 const output={};const nav={onLine:true};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./usePwaQueryRecovery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:output,document:doc,window:win,navigator:nav,Date:{now:()=>now},require(name){if(name==='react')return {useEffect:fn=>cleanup=fn()};if(name==='react-native')return {Platform:{OS:platform}};if(name==='@tanstack/react-query')return {useQueryClient:()=>client};throw Error(name)}});
 output.usePwaQueryRecovery();return {doc,win,nav,calls,setTime:n=>now=n,cleanup:()=>cleanup?.(),resolve:()=>resolveCancel?.()};
}
const flush=()=>new Promise(setImmediate);
test('long suspension cancels pending reads then refetches active queries once',async()=>{
 const f=fixture();f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.setTime(31000);f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.win.dispatchEvent(new Event('online'));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].fetchStatus,'fetching');f.resolve();await flush();assert.equal(f.calls[1][0],'invalidate');assert.equal(f.calls[1][1].type,'active');f.cleanup();
});
test('short suspension and offline resume do not trigger requests',()=>{
 const f=fixture();f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.setTime(1000);f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.nav.onLine=false;f.win.dispatchEvent(new Event('online'));assert.equal(f.calls.length,0);f.cleanup();
});
test('cleanup prevents a late cancel result from refetching another session',async()=>{
 const f=fixture();f.win.dispatchEvent(new Event('online'));f.cleanup();f.resolve();await flush();assert.equal(f.calls.length,1);f.win.dispatchEvent(new Event('online'));assert.equal(f.calls.length,1);
});
test('native does not install browser recovery',()=>{const f=fixture('ios');f.win.dispatchEvent(new Event('online'));assert.equal(f.calls.length,0)});
