import type {LocalEstimate} from './scanner-library';
import type {Card} from './scanner';

export type ScannerPriceState={status:'pending'|'ready'|'missing'|'unavailable'|'withdrawn';estimate?:LocalEstimate;dataVersion?:string;identityVersion?:string;checkedAt?:string;checking?:boolean;invalidateLocal?:boolean};
export type ScannerResult={card:Card;estimate:LocalEstimate|null;priceStatus?:ScannerPriceState['status']};
export function scannerPriceDisplay(card:Card|null,local:LocalEstimate|null,value:ScannerPriceState|null){
 const cleared=value?.invalidateLocal||value?.status==='withdrawn'||value?.status==='missing';
 const remote=value?.status==='ready'?value.estimate:undefined;
 const displayCard=card&&(cleared||remote)?{...card,price:null,prices:[],valuations:[]}:card;
 const estimate=remote??(cleared?null:local);
 return {displayCard,estimate:estimate&&card&&(card.matchLevel==='card'||card.artworkSpecific===false)?{...estimate,referenceKind:'other_printing' as const,sourceLanguage:estimate.sourceLanguage??card.language,sourceNumber:estimate.sourceNumber??card.number}:estimate};
}
export function scannerPriceText(card:Card,estimate:LocalEstimate|null,status:ScannerPriceState['status']|undefined,format:(value:LocalEstimate|Card['price'])=>string){
 if(status==='withdrawn')return '번호·판본 확인 보류';
 return estimate||card.price?format(estimate??card.price):status==='pending'?'참고가 확인 중…':status==='unavailable'?'가격 연결을 확인해 주세요':card.matchLevel==='card'||card.artworkSpecific===false?'판본 추가 확인 필요':'가격 자료 부족';
}
export type ScannerPriceReply=ScannerPriceState&{id:string;market:string;retryAfterMs?:number};
type RequestPrice=(id:string,market:string,signal:AbortSignal)=>Promise<ScannerPriceReply>;
const cache=new Map<string,{until:number;value:ScannerPriceState}>();
/** Restore price evidence or a tombstone, then revalidate without reviving local prices. */
export function restoreScannerPriceDecision(id:string,market:string,identityKey:string,value:ScannerPriceState){
 const key=JSON.stringify([id,market,identityKey]);if(cache.has(key))return;
 const v=value.estimate,currency=market==='US'?'USD':market==='EU'?'EUR':'KRW';
 if(value.status==='ready'&&v&&v.currency===currency&&Number.isFinite(v.low)&&Number.isFinite(v.high)&&v.low>0&&v.high>=v.low&&Number.isFinite(Date.parse(v.observedAt))&&Date.now()-Date.parse(v.observedAt)<=45*86400000&&Date.parse(v.observedAt)<=Date.now()+86400000){
  cache.set(key,{until:0,value:{...value,invalidateLocal:true}});
 }else if(value.invalidateLocal===true||value.status==='withdrawn'||value.status==='missing'||value.status==='ready'){
  cache.set(key,{until:0,value:{status:value.status==='withdrawn'?'withdrawn':'missing',invalidateLocal:true,dataVersion:value.dataVersion,identityVersion:value.identityVersion}});
 }
}
export function watchScannerPrice(id:string,market:string,request:RequestPrice,onState:(value:ScannerPriceState)=>void,now=Date.now,identityKey='',refresh:boolean|'revalidate'=false){
 const key=JSON.stringify([id,market,identityKey]),controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const stored=cache.get(key);
 if(!refresh&&stored&&stored.until>now()){onState(stored.value);return ()=>{};}
 // Retain a cached price during refresh; completed missing/withdrawn responses
 // replace it too. Network errors do not erase previously verified evidence.
 let previous=refresh===true?undefined:stored?.value,invalidated=refresh===true||previous?.invalidateLocal===true||previous?.status==='missing'||previous?.status==='withdrawn';
 if(refresh===true)cache.set(key,{until:0,value:{status:'pending',invalidateLocal:true}});
 const emit=(value:ScannerPriceState)=>{if(!controller.signal.aborted)onState(value);};
 const finish=(value:ScannerPriceState)=>{
  if(controller.signal.aborted)return;
  if(cache.size>=128)cache.delete(cache.keys().next().value!);
  cache.set(key,{until:now()+(value.status==='ready'?30000:5000),value});emit(value);
 };
 emit(previous?{...previous,checking:true}:{status:'pending',checking:true,...(invalidated?{invalidateLocal:true}:{})});
 const deadline=now()+90000;
 let attempts=0;
 const tick=async()=>{
  try{
   const reply=await request(id,market,controller.signal);
   if(controller.signal.aborted)return;
   if(reply.id!==id||reply.market!==market)throw Error('Price identity mismatch');
   if(reply.invalidateLocal||previous?.identityVersion&&reply.identityVersion!==previous.identityVersion||previous?.dataVersion&&reply.dataVersion!==previous.dataVersion){previous=undefined;invalidated=true;cache.set(key,{until:0,value:{status:'pending',invalidateLocal:true,dataVersion:reply.dataVersion,identityVersion:reply.identityVersion}});}
   if(reply.status==='ready'){
    const v=reply.estimate,currency=market==='US'?'USD':market==='EU'?'EUR':'KRW';
    if(!v||v.currency!==currency||!Number.isFinite(v.low)||!Number.isFinite(v.high)||v.low<=0||v.high<v.low||!Number.isFinite(Date.parse(v.observedAt))||now()-Date.parse(v.observedAt)>45*86400000||Date.parse(v.observedAt)>now()+86400000)throw Error('Invalid price evidence');
    finish({status:'ready',estimate:v,dataVersion:reply.dataVersion,identityVersion:reply.identityVersion,checkedAt:reply.checkedAt,...(invalidated?{invalidateLocal:true}:{})});return;
   }
   if(reply.status!=='pending'){finish({status:reply.status==='withdrawn'?'withdrawn':'missing',dataVersion:reply.dataVersion,identityVersion:reply.identityVersion,checkedAt:reply.checkedAt,invalidateLocal:true});return;}
   emit(previous?{...previous,checking:true}:{status:'pending',checking:true,dataVersion:reply.dataVersion,identityVersion:reply.identityVersion,...(invalidated?{invalidateLocal:true}:{})});
   if(now()>=deadline){finish({status:'unavailable',...(invalidated?{invalidateLocal:true}:{})});return;}
   timer=setTimeout(()=>void tick(),Math.min(5000,Math.max([500,1000,2000,3000,5000][Math.min(attempts++,4)],reply.retryAfterMs??500)));
  }catch(error){
   if((error as {status?:number})?.status===404)finish({status:'withdrawn',invalidateLocal:true});
   else finish(previous?.status==='ready'?previous:{status:'unavailable',...(invalidated?{invalidateLocal:true}:{})});
  }
 };
 void tick();
 return ()=>{controller.abort();clearTimeout(timer);};
}
