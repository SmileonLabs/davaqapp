import {useEffect,useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAuth} from './davaqAuth';
import {useDavaq} from './davaq';
import type {EngineScan} from './tcgEngineResult';
type Scans={items:EngineScan[]};
/** User-owned scan metadata stays available offline; a failed refresh never replaces it. */
export function useCachedTcgScans(){
 const {userId}=useAuth();
 const query=useDavaq<Scans>('/tcg/scans');
 const [cached,setCached]=useState<{owner:string;data:Scans}|null>(null);
 useEffect(()=>{
  if(!userId)return;
  let active=true;
  void AsyncStorage.getItem('davaq.owned-scan-results.v1:'+userId).then(raw=>{
   if(!active||!raw)return;
   try{const data=JSON.parse(raw);if(Array.isArray(data.items)&&data.items.every((v:any)=>typeof v.id==='string'&&typeof v.object_path==='string'&&typeof v.status==='string'))setCached({owner:userId,data});}catch{}
  }).catch(()=>{});
  return()=>{active=false;};
 },[userId]);
 useEffect(()=>{
  if(!userId||!query.data)return;
  setCached({owner:userId,data:query.data});
  void AsyncStorage.setItem('davaq.owned-scan-results.v1:'+userId,JSON.stringify(query.data)).catch(()=>{});
 },[userId,query.data]);
 const data=query.data??(cached&&cached.owner===userId?cached.data:undefined);
 return {...query,data,isPending:query.isPending&&!data};
}
