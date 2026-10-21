const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'sw.js'),'utf8');
const start = source.indexOf('function notificationWasRead(');
const end = source.indexOf('async function closeNotificationsByTag',start);
const wasRead = vm.runInNewContext('('+source.slice(start,end)+')');
test('browser cleanup preserves newer unread messages and calls',()=>{
 const read={readThroughSeq:4,ownerId:'me'};
 assert.equal(wasRead({data:{messageSeq:'3',recipientUserId:'me'}},read),true);
 assert.equal(wasRead({data:{messageSeq:'5',recipientUserId:'me'}},read),false);
 assert.equal(wasRead({data:{messageSeq:'3',type:'incoming_call'}},read),false);
 assert.equal(wasRead({data:{messageSeq:'3',recipientUserId:'another'}},read),false);
});
test('legacy browser notifications wait for a confirmed unread-zero snapshot',()=>{
 assert.equal(wasRead({data:{},timestamp:100},{}),false);
 assert.equal(wasRead({data:{},timestamp:100},{allowLegacy:true,observedBefore:101}),true);
 assert.equal(wasRead({data:{},timestamp:102},{allowLegacy:true,observedBefore:101}),false);
});

test('switching push accounts clears notifications without a read boundary',async()=>{
 const start=source.indexOf('async function writePushOwner(');
 const end=source.indexOf('function appShellUrl(',start);
 let closed=0;
 const context={PUSH_OWNER_CACHE:'test-owner',caches:{open:async()=>({put:async()=>{},delete:async()=>{}})},pushOwnerRequest:()=>({}),readPushOwner:async()=>({userId:'old'}),createOwnerRecord:(userId)=>({userId}),Response,Date,self:{registration:{getNotifications:async()=>[{close:()=>closed++}]}}};
 const writeOwner=vm.runInNewContext('('+source.slice(start,end)+')',context);
 await writeOwner('new');
 assert.equal(closed,1);
});
