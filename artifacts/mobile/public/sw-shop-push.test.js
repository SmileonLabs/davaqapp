const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function worker(owner='owner'){
 const listeners={},broadcast=[],notifications=[];
 const self={registration:{scope:'https://example.test/app/',showNotification:async(title,options)=>notifications.push({title,options})},location:{origin:'https://example.test'},addEventListener:(type,fn)=>listeners[type]=fn,clients:{matchAll:async()=>[{postMessage:message=>broadcast.push(message)}]}};
 const sandbox={self,URL,Request,Response,Date,console,caches:{open:async()=>({match:async()=>new Response(JSON.stringify({userId:owner,expiresAt:Date.now()+60000})),delete:async()=>{}})}};
 const context=vm.createContext(sandbox);sandbox.importScripts=(file)=>vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'sw.js'),'utf8'),context);
 return {listeners,broadcast,notifications};
}
test('shop push refreshes the right thread and preserves its app deep link',async()=>{
 const w=worker();let pending;const shopId='11111111-1111-4111-8111-111111111111',threadId='22222222-2222-4222-8222-222222222222',url=`/shop/conversation?shopId=${shopId}&threadId=${threadId}`;
 w.listeners.push({data:{json:()=>({title:'매장 상담',body:'새 메시지',url,recipientUserId:'owner',data:{type:'shop_message',shopId,threadId}})},waitUntil:p=>pending=p});await pending;
 assert.equal(w.broadcast[0].shopId,shopId);assert.equal(w.broadcast[0].threadId,threadId);assert.equal(w.broadcast[0].roomId,null);
 assert.equal(w.notifications[0].options.data.openUrl,'/app'+url);assert.equal(w.notifications[0].options.data.recipientUserId,'owner');
});
test('a different account cannot receive a stale shop push or invalidation',async()=>{
 const w=worker('new-owner');let pending;
 w.listeners.push({data:{json:()=>({recipientUserId:'old-owner',data:{shopId:'private',threadId:'private'}})},waitUntil:p=>pending=p});await pending;
 assert.equal(w.broadcast.length,0);assert.equal(w.notifications.length,0);
});
