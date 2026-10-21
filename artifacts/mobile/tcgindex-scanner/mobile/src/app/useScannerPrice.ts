import {useEffect,useMemo,useRef,useState} from 'react';
import {AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {scannerCardNumber,type Card} from '../scanner';
import type {LocalEstimate} from '../scanner-library';
import {watchScannerPrice,scannerPriceDisplay,restoreScannerPriceDecision,type ScannerPriceState,type ScannerPriceReply} from '../scanner-live-price';
import {api} from './api';
import {useEngineVersion} from './useEngineVersion';

export function useScannerPrice(card:Card|null,local:LocalEstimate|null,market:string,dataVersion='',recognitionRevision=0){
 const engineVersion=useEngineVersion();
 const id=card?.id??'';
 const identity=JSON.stringify([card?.game,card?.number,card?.language,card?.setCode,card?.finish,card?.rarity,card?.image,card?.matchLevel,card?.artworkSpecific,card?.price,card?.prices,card?.valuations,dataVersion,engineVersion]);
 const key=JSON.stringify([id,market,identity,recognitionRevision]);
 const [remote,setRemote]=useState<{key:string;value:ScannerPriceState}|null>(null);
 const latest=useRef(remote);latest.current=remote;
 useEffect(()=>{
  if(!id)return;
  let cancel:(()=>void)|undefined,lastStarted=0,disposed=false,hydrated=false;
  const storageKey='davaq.scanner-price-decision.v1:'+JSON.stringify([id,market,card?.game,card?.number,card?.language,card?.setCode,card?.finish]);
  let first=true;
  const sync=(force=false)=>{
   const value=latest.current?.key===key?latest.current.value:null;
   if(!force&&value?.status==='withdrawn')return;
   if(!hydrated||disposed||AppState.currentState!=='active'||!force&&Date.now()-lastStarted<(value?.status==='ready'?90000:15000)||value?.checking&&!force)return;
   lastStarted=Date.now();cancel?.();
   cancel=watchScannerPrice(id,market,(id,market,signal)=>api<ScannerPriceReply>('scanner/price?'+new URLSearchParams({id,market,language:card?.language??'',number:card?scannerCardNumber(card):'',set:card?.setCode??'',finish:card?.finish??''}),{signal}),value=>{setRemote({key,value});
    if(!value.checking)void (value.invalidateLocal||value.status==='withdrawn'||value.status==='missing'||value.status==='ready'?AsyncStorage.setItem(storageKey,JSON.stringify(value)):Promise.resolve()).catch(()=>{});
   },Date.now,identity,recognitionRevision>0&&first?true:force?'revalidate':false);
   first=false;
  };
  void AsyncStorage.getItem(storageKey).then(raw=>{if(disposed)return;if(raw){try{const value=JSON.parse(raw);restoreScannerPriceDecision(id,market,identity,value);}catch{}}}).catch(()=>{}).finally(()=>{hydrated=true;if(!disposed)sync(true);});
  const timer=setInterval(()=>sync(),15000);
  const subscription=AppState.addEventListener('change',state=>{if(state==='active')sync(true);});
  return()=>{disposed=true;cancel?.();clearInterval(timer);subscription.remove();};
 },[id,market,key,identity]);
 const value=remote?.key===key?remote.value:null;
 const display=useMemo(()=>scannerPriceDisplay(card,local,value),[card,local,value]);
 return {...display,priceStatus:value?.status??(id?'pending':undefined),checking:!!id&&(!value||value.checking===true)};
}
