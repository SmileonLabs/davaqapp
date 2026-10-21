import * as chatPushRefresh from "./chatPushRefresh.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(file="../components/NativePushRegistrar.android.tsx", platform="android"){
  const state={owner:"A",registered:[],revoked:[],bearerVersion:0,groupActions:[],directJoins:0,callAction:null};
  const refs=[], effects=[]; let cursor=0; const scheduled=[];
  const timers=new Map();let timerId=0;
  const common={setTimeout,clearTimeout,setInterval:(fn)=>{timers.set(++timerId,fn);return timerId},clearInterval:id=>timers.delete(id),console:{info(){},warn(){}}};
  const reconciler={};vm.runInNewContext(compile("./reconcileTrackedIncomingNotifications.ts"),{...common,exports:reconciler});
  const coordinator={};vm.runInNewContext(compile("./pushRegistrationCoordinator.ts"),{...common,exports:coordinator});
  const no=()=>{};const unsub=()=>no;
  const hooks={useRef(value){const i=cursor++;return refs[i]??=( {current:value} );},useEffect(run,deps){
    const i=cursor++,prev=effects[i];
    if(!prev||deps.some((v,j)=>v!==prev.deps[j]))scheduled.push(()=>{prev?.cleanup?.();effects[i]={deps,cleanup:run()}});
  }};
  const exports={};
  vm.runInNewContext(compile(file),{...common,exports,require(name){
    if(name==="@/lib/chatPushRefresh")return chatPushRefresh;
    if(name==="react")return hooks;
    if(name==="@/lib/reconcileTrackedIncomingNotifications")return reconciler;
    if(name==="@clerk/expo"||name==="@/lib/davaqAuth")return {useAuth:()=>({isSignedIn:true,userId:state.owner,getToken:async()=>"bearer-"+state.bearerVersion})};
    if(name==="expo-router")return {useRouter:()=>({navigate:no}),usePathname:()=>"/chats"};
    if(name==="react-native")return {Platform:{OS:platform},AppState:{currentState:"active",addEventListener:()=>({remove:no})}};
    if(name==="@workspace/api-client-react")return {customFetch:async()=>({status:"active",expiresAt:Date.now()+45000}),useGetMe:()=>({data:{id:state.owner,notificationEnabled:true}}),useRegisterPushToken:()=>({mutateAsync:async()=>state.registered.push(state.owner)}),getCall:async()=>({status:"ringing"})};
    if(name==="@/components/CallProvider")return {useCall:()=>({joinFromCard:async()=>{state.directJoins++;return true},declineFromCard:async()=>true})};
    if(name==="@/lib/groupCallActions")return {isGroupCallId:id=>id.startsWith("da7a0001-"),dispatchGroupCallAction:async(id,action)=>{state.groupActions.push({id,action});return true}};
    if(name==="@/lib/pushRegistrationCoordinator")return coordinator;
    if(name==="@/lib/pushOwnership")return {revokePushRegistrationWithBearer:async(token,bearer)=>state.revoked.push({token,bearer})};
    if(name==="@/lib/nativePushOwner")return {setCurrentNativePushOwner:async()=>{},clearCurrentNativePushOwner:async()=>{},NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS:21600000};
    if(name==="@/lib/nativePush.android" || name==="@/lib/nativePush")return {nativePushSupported:true,setupNotificationHandler:no,registerForPushTokenAsync:async()=>"device",getExistingNativePushToken:async()=>"device",getInitialNotificationUrl:async()=>null,subscribeForegroundIncomingCall:unsub,subscribeNotificationOpen:unsub,subscribePushTokenRefresh:unsub};
    if(name==="@/lib/androidTelecom")return {endSystemCall:async()=>{}};
    if(name==="@/lib/callNotifications.android" || name==="@/lib/callNotifications")return {setupCallNotifications:async()=>{},cancelIncomingCallNotification:async()=>{},cancelExpiredIncomingCallNotifications:async()=>{},clearPendingCallIntent:async()=>{},consumePendingCallIntent:async()=>null,displayIncomingCallNotification:async()=>{},getTrackedIncomingCalls:async()=>[],subscribeCallActions:handler=>{state.callAction=handler;return no}};
    if(name==="@/lib/applePush")return {getApplePushCredentials:async()=>["apns:fixture"]};
    if(name==="@/lib/systemCalls")return {endSystemCall:async()=>{},setApplePushOwner:async()=>{},clearApplePushOwner:async()=>{},subscribeApplePushToken:unsub,subscribeSystemCallActions:unsub};
    throw Error(name);
  }});
  async function render(){cursor=0;state.bearerVersion++;exports.NativePushRegistrar();while(scheduled.length)scheduled.shift()();for(let i=0;i<30;i++)await Promise.resolve();}
  return {state,render,act:async event=>{await (event.action === "accept" ? state.callAction.onAccept(event.intent) : state.callAction.onDecline(event.intent));for(let i=0;i<30;i++)await Promise.resolve();},tick:async()=>{for(const fn of [...timers.values()])fn();for(let i=0;i<30;i++)await Promise.resolve();}};
}
test("changing Clerk callback identity on rerender must not revoke a registered device",async()=>{
 const h=harness();await h.render();await h.render();await h.render();
 assert.deepEqual(h.state.registered,["A"]);assert.equal(h.state.revoked.length,0);
});
test("actual account switch revokes old ownership and registers the new owner",async()=>{
 const h=harness();await h.render();h.state.owner="B";await h.render();await h.render();
 assert.deepEqual(h.state.registered,["A","B"]);assert.equal(h.state.revoked.length,1);
});

test("late account switch cleanup uses refreshed old-session bearer",async()=>{
 const h=harness();await h.render();h.state.bearerVersion=42;await h.tick();
 h.state.owner="B";await h.render();await h.render();
 assert.equal(h.state.revoked.length,1);assert.equal(h.state.revoked[0].bearer,"bearer-42");
});

test("iOS rerenders keep APNs registered when the Clerk callback identity changes",async()=>{
 const h=harness("../components/NativePushRegistrar.tsx","ios");
 await h.render();await h.render();await h.render();
 assert.deepEqual(h.state.registered,["A"]);assert.equal(h.state.revoked.length,0);
});
test("iOS account-switch cleanup revokes old tokens with the refreshed old-session bearer",async()=>{
 const h=harness("../components/NativePushRegistrar.tsx","ios");
 await h.render();h.state.bearerVersion=42;await h.tick();
 h.state.owner="B";await h.render();await h.render();
 assert.deepEqual(h.state.registered,["A","B"]);
 assert.ok(h.state.revoked.length>0);assert.ok(h.state.revoked.every(item=>item.bearer==="bearer-42"));
});

for (const platform of ["ios", "android"]) test(`${platform} accepts group notifications through the group flow rather than a direct call`, async()=>{
 const h=harness(platform==="ios"?"../components/NativePushRegistrar.tsx":"../components/NativePushRegistrar.android.tsx",platform);
 await h.render(); await h.act({action:"accept",intent:{callId:"da7a0001-0000-4000-8000-000000000001",callerName:"Group",media:"audio"}});
 assert.equal(h.state.directJoins,0); assert.equal(h.state.groupActions[0].action,"join");
});
