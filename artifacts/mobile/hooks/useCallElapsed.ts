import {useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {nextCallClock,formatCallDuration,type CallClock} from '@/lib/callPresentation';
export function useCallElapsed(callId:string|null|undefined, connected:boolean){
 const clock=useRef<CallClock>({callId:null,startedAt:null});
 clock.current=nextCallClock(clock.current,callId??null,connected,Date.now());
 const [,tick]=useState(0);
 const startedAt=clock.current.startedAt;
 useEffect(()=>{
  if(startedAt===null)return;
  const refresh=()=>tick(n=>n+1);
  const timer=setInterval(refresh,1000);const app=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
  return()=>{clearInterval(timer);app.remove();};
 },[callId,startedAt]);
 const seconds=startedAt===null?0:Math.max(0,Math.floor((Date.now()-startedAt)/1000));
 return {seconds,label:formatCallDuration(seconds),connected:startedAt!==null};
}
