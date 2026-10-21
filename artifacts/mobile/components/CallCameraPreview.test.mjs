import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness(){
 let resolve,reject,listener,cleanup,cancelled=0,confirmed=0,audio=0;
 const capture=new Promise((res,rej)=>{resolve=res;reject=rej;});const effects=[];
 const React={createElement:(type,props,...children)=>({type,props:props??{},children}),useEffect:fn=>effects.push(fn),useRef:value=>({current:value}),useState:value=>[value,()=>{}]};
 const modules={react:React,'react-native':{AppState:{addEventListener:(_event,fn)=>{listener=fn;return{remove(){}};}},ActivityIndicator:'spinner',Modal:'modal',Pressable:'button',Text:'text',View:'view'},'livekit-client':{createLocalVideoTrack:()=>capture},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'./LocalCameraPreview':{LocalCameraPreview:'preview'},'@/hooks/useCallScreenAwake':{useCallScreenAwake:()=>{}}};
 const source=fs.readFileSync(new URL('./CallCameraPreview.tsx',import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name];}});
 const tree=exports.CallCameraPreview({visible:true,embedded:true,onCancel:()=>cancelled++,onConfirm:()=>confirmed++,onAudioOnly:()=>audio++});for(const effect of effects)cleanup=effect();
 function button(text,node=tree){if(!node||typeof node!=='object')return; if(node.type==='button'&&JSON.stringify(node.children).includes(text))return node;for(const child of node.children??[]){const result=button(text,child);if(result)return result;}}
 return{resolve,reject,inactive:()=>listener('inactive'),background:()=>listener('background'),cleanup,button,counts:()=>({cancelled,confirmed,audio})};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const camera=()=>({stops:0,stop(){this.stops++;}});
test('pending camera permission resolved after dismissal immediately stops that exact track',async()=>{const s=harness();s.cleanup();const track=camera();s.resolve(track);await flush();assert.equal(track.stops,1);assert.equal(s.counts().confirmed,0);});
test('backgrounding during pending permission stops late camera without waiting for React cleanup',async()=>{const s=harness();s.background();const track=camera();s.resolve(track);await flush();assert.equal(track.stops,1);assert.equal(s.counts().cancelled,1);s.cleanup();});
test('background stops an already opened preview before dismissing it',async()=>{const s=harness(),track=camera();s.resolve(track);await flush();s.background();assert.equal(track.stops,1);assert.equal(s.counts().cancelled,1);s.cleanup();});
test('audio-only selection cancels pending capture and is single shot',async()=>{const s=harness();s.button('카메라 없이').props.onPress();s.button('카메라 없이').props.onPress();const track=camera();s.resolve(track);await flush();assert.equal(track.stops,1);assert.equal(s.counts().audio,1);assert.equal(s.counts().confirmed,0);s.cleanup();});
test('preview capture alone never confirms or publishes a video call',async()=>{const s=harness(),track=camera();s.resolve(track);await flush();assert.equal(s.counts().confirmed,0);assert.equal(track.stops,0);s.cleanup();assert.equal(track.stops,1);});

test('a system permission dialog does not dismiss the preview as if the app were backgrounded',async()=>{const s=harness();s.inactive();const track=camera();s.resolve(track);await flush();assert.equal(s.counts().cancelled,0);assert.equal(track.stops,0);s.cleanup();assert.equal(track.stops,1);});
test('unmounting the native preview releases its stream without owning or stopping the call capture',()=>{
 let cleanup,stream;const capture={id:'camera-owner-track'};const React={createElement:(type,props)=>({type,props}),useMemo:fn=>fn(),useEffect:fn=>{cleanup=fn();}};
 class Stream{constructor(tracks){this.tracks=tracks;this.releases=[];stream=this;}toURL(){return'preview-stream';}release(stopTracks){this.releases.push(stopTracks);}}
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('./LocalCameraPreview.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>name==='react'?React:{RTCView:'rtc',MediaStream:Stream}});
 const view=exports.LocalCameraPreview({track:{mediaStreamTrack:capture}});assert.equal(view.props.streamURL,'preview-stream');assert.equal(stream.tracks[0],capture);cleanup();assert.deepEqual(stream.releases,[false]);
});
