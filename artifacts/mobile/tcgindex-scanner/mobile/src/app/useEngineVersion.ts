import {useEffect,useState} from 'react';
import {AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
const storageKey='davaq.card-engine-manifest.v1';
type Snapshot={version:1;engineVersion:string};
let saved: {etag:string;manifest:Snapshot}|null=null;
let hydrated:Promise<void>|undefined;
let flight:Promise<string>|undefined;
let lastCheck=0;
async function currentVersion():Promise<string>{
 hydrated??=AsyncStorage.getItem(storageKey).then(raw=>{if(raw){try{const v=JSON.parse(raw);if(v.manifest?.version===1&&typeof v.manifest.engineVersion==='string')saved=v;}catch{}}}).catch(()=>{});
 await hydrated;
 if(Date.now()-lastCheck<300000&&saved)return saved.manifest.engineVersion;
 if(flight)return flight;
 flight=(async()=>{
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch('https://tcgindex.org/api/mobile/v1/engine/manifest',{signal:controller.signal,headers:saved?.etag?{'If-None-Match':saved.etag}:{}});
   if(response.status===304&&saved){lastCheck=Date.now();return saved.manifest.engineVersion;}
   if(!response.ok)throw Error('engine manifest');
   const manifest=await response.json();
   if(manifest.version!==1||typeof manifest.engineVersion!=='string'||!manifest.engineVersion)throw Error('unsupported engine manifest');
   const next={etag:response.headers.get('etag')??'',manifest};
   await AsyncStorage.setItem(storageKey,JSON.stringify(next));saved=next;lastCheck=Date.now();
   return manifest.engineVersion as string;
  }catch{return saved?.manifest.engineVersion??'';}
  finally{clearTimeout(timeout);flight=undefined;}
 })();return flight;
}
/** Public rule version refreshes prices; it never discards verified local packs. */
export function useEngineVersion(){
 const [version,setVersion]=useState(saved?.manifest.engineVersion??'');
 useEffect(()=>{let active=true;const refresh=()=>{if(AppState.currentState==='active')void currentVersion().then(v=>{if(active)setVersion(v);});};
 refresh();const timer=setInterval(refresh,300000);const subscription=AppState.addEventListener('change',s=>{if(s==='active')refresh();});
 return()=>{active=false;clearInterval(timer);subscription.remove();};},[]);return version;
}
