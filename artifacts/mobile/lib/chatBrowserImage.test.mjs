import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('./chatBrowserImage.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function harness(blob,status=200,converted='image/jpeg') {
 let conversions=0,revoked=0;const exports={};
 vm.runInNewContext(code,{exports,Blob,TextDecoder,fetch:async()=>({ok:status===200,status,blob:async()=>blob}),URL:{createObjectURL:()=> 'blob:jpeg',revokeObjectURL:()=>revoked++},require:()=>({convertHeicIfNeeded:async()=>{conversions++;return {contentType:converted,blob:new Blob(['jpeg'],{type:converted})};}})});
 return {load:exports.decodeBrowserChatImage,counts:()=>({conversions,revoked})};
}
test('legacy received HEIC is converted for display and object URL is releasable',async()=>{const h=harness(new Blob(['heic'],{type:'image/heic'}));const r=await h.load('/ticket');assert.equal(r.uri,'blob:jpeg');r.release();assert.deepEqual(h.counts(),{conversions:1,revoked:1});});
test('HEIC magic is recognized even with generic server MIME',async()=>{const h=harness(new Blob([new Uint8Array([0,0,0,40]),'ftypheic0000']));assert.equal((await h.load('/ticket')).uri,'blob:jpeg');});
test('normal JPEG needs no conversion',async()=>{const h=harness(new Blob(['jpeg'],{type:'image/jpeg'}));assert.equal(await h.load('/ticket'),null);assert.equal(h.counts().conversions,0);});
test('expired URLs and failed HEIC decode remain visible errors',async()=>{await assert.rejects(harness(new Blob([]),404).load('/ticket'),/photo-http-404/);await assert.rejects(harness(new Blob(['heic'],{type:'image/heic'}),200,'image/heic').load('/ticket'),/photo-heic-decode-failed/);});
