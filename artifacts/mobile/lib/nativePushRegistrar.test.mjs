import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(){
  const state={owner:"A",registered:[],revoked:[],bearerVersion:0};
  const refs=[], effects=[]; let cursor=0; const scheduled=[];
  const common={setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{},console:{info(){},warn(){}}};
  const coordinator={};vm.runInNewContext(compile("./pushRegistrationCoordinator.ts"),{...common,exports:coordinator});
  const no=()=>{};const unsub=()=>no;
  const hooks={useRef(value){const i=cursor++;return refs[i]??=( {current:value} );},useEffect(run,deps){
    const i=cursor++,prev=effects[i];
    if(!prev||deps.some((v,j)=>v!==prev.deps[j]))scheduled.push(()=>{prev?.cleanup?.();effects[i]={deps,cleanup:run()}});
  }};
  const exports={};
  vm.runInNewContext(compile("../components/NativePushRegistrar.android.tsx"),{...common,exports,require(name){
    if(name==="react")return hooks;
    if(name==="@clerk/expo")return {useAuth:()=>({isSignedIn:true,userId:state.owner,getToken:async()=>"bearer-"+state.bearerVersion})};
    if(name==="expo-router")return {useRouter:()=>({navigate:no}),usePathname:()=>"/chats"};
    if(name==="react-native")return {AppState:{currentState:"active",addEventListener:()=>({remove:no})}};
    if(name==="@workspace/api-client-react")return {useGetMe:()=>({data:{id:state.owner,notificationEnabled:true}}),useRegisterPushToken:()=>({mutateAsync:async()=>state.registered.push(state.owner)}),getCall:async()=>({status:"ringing"})};
    if(name==="@/components/CallProvider")return {useCall:()=>({joinFromCard:async()=>true,declineFromCard:async()=>true})};
    if(name==="@/lib/pushRegistrationCoordinator")return coordinator;
    if(name==="@/lib/pushOwnership")return {revokePushRegistrationWithBearer:async()=>state.revoked.push(true)};
    if(name==="@/lib/nativePushOwner")return {setCurrentNativePushOwner:async()=>{},clearCurrentNativePushOwner:async()=>{},NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS:21600000};
    if(name==="@/lib/nativePush.android")return {nativePushSupported:true,setupNotificationHandler:no,registerForPushTokenAsync:async()=>"device",getExistingNativePushToken:async()=>"device",getInitialNotificationUrl:async()=>null,subscribeForegroundIncomingCall:unsub,subscribeNotificationOpen:unsub,subscribePushTokenRefresh:unsub};
    if(name==="@/lib/androidTelecom")return {endSystemCall:async()=>{}};
    if(name==="@/lib/callNotifications.android")return {setupCallNotifications:async()=>{},cancelIncomingCallNotification:async()=>{},cancelExpiredIncomingCallNotifications:async()=>{},clearPendingCallIntent:async()=>{},consumePendingCallIntent:async()=>null,displayIncomingCallNotification:async()=>{},getTrackedIncomingCalls:async()=>[],subscribeCallActions:unsub};
    throw Error(name);
  }});
  async function render(){cursor=0;state.bearerVersion++;exports.NativePushRegistrar();while(scheduled.length)scheduled.shift()();for(let i=0;i<30;i++)await Promise.resolve();}
  return {state,render};
}
test("changing Clerk callback identity on rerender must not revoke a registered device",async()=>{
 const h=harness();await h.render();await h.render();await h.render();
 assert.deepEqual(h.state.registered,["A"]);assert.equal(h.state.revoked.length,0);
});
test("actual account switch revokes old ownership and registers the new owner",async()=>{
 const h=harness();await h.render();h.state.owner="B";await h.render();await h.render();
 assert.deepEqual(h.state.registered,["A","B"]);assert.equal(h.state.revoked.length,1);
});
