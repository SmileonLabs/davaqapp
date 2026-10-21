import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchScannerPrice,restoreScannerPriceDecision,scannerPriceText,scannerPriceDisplay,type ScannerPriceState} from '../src/scanner-live-price.ts';
import type {Card} from '../src/scanner.ts';
const estimate={low:4110,high:4110,currency:'KRW',count:1,source:'TCGplayer',observedAt:new Date().toISOString(),method:'market_reference' as const};
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('a withdrawn or missing server price stays revoked when a later recheck goes offline',async()=>{
 for(const status of ['withdrawn','missing'] as const){
  let clock=Date.now();const id='offline-after-'+status;
  watchScannerPrice(id,'KR',async(id,market)=>({id,market,status}),()=>{},()=>clock);
  await settle();clock+=6000;
  const values:ScannerPriceState[]=[];
  watchScannerPrice(id,'KR',async()=>{throw Error('offline');},v=>values.push(v),()=>clock,'','revalidate');
  await settle();
  assert.equal(values.at(-1)?.invalidateLocal,true);
  const display=scannerPriceDisplay({price:{amount:999,currency:'KRW'}} as Card,estimate,values.at(-1)!);
  assert.equal(display.displayCard?.price,null);assert.equal(display.estimate,null);
 }
});

test('a fresh ready response replaces invalidated downloaded prices instead of hiding the new price',async()=>{
 const values:ScannerPriceState[]=[];
 watchScannerPrice('fresh-invalidated','KR',async(id,market)=>({id,market,status:'ready',estimate,identityVersion:'new',dataVersion:'prices-2',invalidateLocal:true}),v=>values.push(v));
 await settle();const value=values.at(-1)!;
 const card={price:{amount:999,currency:'KRW'},prices:[{amount:999}],valuations:[{amount:999}]} as Card;
 const display=scannerPriceDisplay(card,{...estimate,low:999,high:999},value);
 assert.equal(display.estimate?.low,4110);assert.equal(display.displayCard?.price,null);
 assert.deepEqual(display.displayCard?.prices,[]);assert.deepEqual(display.displayCard?.valuations,[]);
 assert.equal(value.dataVersion,'prices-2');
});

test('a changed identity cannot restore old evidence when new evidence fails validation',async()=>{
 let clock=Date.now();const values:ScannerPriceState[]=[];
 watchScannerPrice('identity-revised','KR',async(id,market)=>({id,market,status:'ready',estimate,identityVersion:'old'}),()=>{},()=>clock);
 await settle();clock+=31000;
 watchScannerPrice('identity-revised','KR',async(id,market)=>({id,market,status:'ready',estimate:{...estimate,currency:'USD'},identityVersion:'new'}),v=>values.push(v),()=>clock);
 await settle();assert.equal(values.at(-1)?.status,'unavailable');assert.equal(values.at(-1)?.estimate,undefined);assert.equal(values.at(-1)?.invalidateLocal,true);
});

test('an artwork-only match never promotes a source price to a confirmed printing price',()=>{
 const card={language:'en',number:'7',matchLevel:'card',artworkSpecific:false,price:null} as Card;
 assert.equal(scannerPriceDisplay(card,estimate,null).estimate?.referenceKind,'other_printing');
 assert.equal(scannerPriceDisplay(card,{...estimate,sourceLanguage:'ja'},null).estimate?.sourceLanguage,'ja');
});
test('loads a reference asynchronously and reuses its cached price across frames',async()=>{
 let calls=0;const values:ScannerPriceState[]=[];
 const request=async(id:string,market:string)=>{calls++;return {id,market,status:'ready' as const,estimate};};
 const cancel=watchScannerPrice('photo:first','KR',request,value=>values.push(value));
 assert.equal(values[0].status,'pending');await settle();assert.equal(values[1].estimate?.low,4110);cancel();
 const cached:ScannerPriceState[]=[];watchScannerPrice('photo:first','KR',request,value=>cached.push(value));
 assert.equal(calls,1);assert.equal(cached[0].status,'ready');
});
test('ignores a late response after switching cards and separates market prices',async()=>{
 let complete!:(value:any)=>void;let signal:AbortSignal|undefined;const values:ScannerPriceState[]=[];
 const cancel=watchScannerPrice('late','KR',async(_id,_market,s)=>{signal=s;return new Promise(resolve=>{complete=resolve;});},v=>values.push(v));
 cancel();complete({id:'late',market:'KR',status:'ready',estimate});await settle();
 assert.equal(signal?.aborted,true);assert.deepEqual(values,[{status:'pending',checking:true}]);
 const eu:ScannerPriceState[]=[];watchScannerPrice('photo:first','EU',async(id,market)=>({id,market,status:'ready',estimate:{...estimate,currency:'EUR',low:3.07,high:3.07}}),v=>eu.push(v));
 await settle();assert.equal(eu[1].estimate?.currency,'EUR');
});
test('retains local prices during pending/offline requests and rejects wrong/stale server evidence',async()=>{
 const card={price:null} as Card;
 assert.equal(scannerPriceText(card,null,'pending',()=>''),'참고가 확인 중…');
 assert.equal(scannerPriceText(card,estimate,'unavailable',()=>'₩4,110'),'₩4,110');
 assert.equal(scannerPriceText({...card,price:{amount:900} as NonNullable<Card['price']>},null,'pending',()=>'₩900'),'₩900');
 for(const [id,change] of [['wrong',{currency:'USD'}],['old',{observedAt:'2020-01-01'}]] as const){
  const values:ScannerPriceState[]=[];watchScannerPrice(id,'KR',async(id,market)=>({id,market,status:'ready',estimate:{...estimate,...change}}),v=>values.push(v));
  await settle();assert.equal(values[1].status,'unavailable');
 }
});

test('rechecks cached prices after expiry and clears withdrawn/missing values',async()=>{
 let clock=Date.now(),calls=0;
 let status:'ready'|'withdrawn'|'missing'='ready';
 const values:ScannerPriceState[]=[];
 const request=async(id:string,market:string)=>{calls++;return {id,market,status,estimate:status==='ready'?estimate:undefined,dataVersion:String(calls),identityVersion:'identity-1',checkedAt:new Date(clock).toISOString()};};
 watchScannerPrice('updates','KR',request,v=>values.push(v),()=>clock);await settle();
 assert.equal(values.at(-1)?.status,'ready');
 clock+=31000;status='withdrawn';
 watchScannerPrice('updates','KR',request,v=>values.push(v),()=>clock);await settle();
 assert.equal(calls,2);assert.equal(values.at(-1)?.status,'withdrawn');assert.equal(values.at(-1)?.estimate,undefined);
 clock+=31000;status='missing';
 watchScannerPrice('updates','KR',request,v=>values.push(v),()=>clock);await settle();
 assert.equal(values.at(-1)?.status,'missing');
 assert.equal(scannerPriceText({price:{amount:100}} as Card,estimate,'withdrawn',()=>'$100'),'번호·판본 확인 보류');
});
test('a changed pack/printing does not reuse another identity cache and anonymous 404 withdraws old prices',async()=>{
 let calls=0;const request=async(id:string,market:string)=>{calls++;return {id,market,status:'ready' as const,estimate};};
 watchScannerPrice('printing','KR',request,()=>{},Date.now,'normal:pack-1');await settle();
 watchScannerPrice('printing','KR',request,()=>{},Date.now,'masterball:pack-2');await settle();assert.equal(calls,2);
 const values:ScannerPriceState[]=[];
 watchScannerPrice('private','KR',async()=>{throw {status:404};},v=>values.push(v));await settle();
 assert.equal(values.at(-1)?.status,'withdrawn');assert.equal(values.at(-1)?.estimate,undefined);
});

test('a server recheck invalidates both the previous response and the downloaded fallback',async()=>{
 let clock=Date.now();const values:ScannerPriceState[]=[];
 watchScannerPrice('rechecked','KR',async(id,market)=>({id,market,status:'ready',estimate,identityVersion:'same-card'}),v=>values.push(v),()=>clock);
 await settle();clock+=31000;
 const cancel=watchScannerPrice('rechecked','KR',async(id,market)=>({id,market,status:'pending',invalidateLocal:true,identityVersion:'same-card'}),v=>values.push(v),()=>clock);
 await settle();cancel();
 const pending=values.at(-1)!;
 assert.equal(pending.status,'pending');assert.equal(pending.estimate,undefined);assert.equal(pending.invalidateLocal,true);
 const card={price:{amount:999,currency:'KRW'}} as Card;
 assert.equal(scannerPriceDisplay(card,estimate,pending).estimate,null);
 assert.equal(scannerPriceDisplay(card,estimate,pending).displayCard?.price,null);
 assert.equal(scannerPriceDisplay(card,estimate,{status:'unavailable',invalidateLocal:true}).estimate,null);
 assert.equal(scannerPriceDisplay(card,estimate,{status:'unavailable'}).estimate,estimate);
});


test('a changed data pack invalidates a cached response even when identity is unchanged',async()=>{
 let clock=Date.now();const values:ScannerPriceState[]=[];
 watchScannerPrice('pack-revised','KR',async(id,market)=>({id,market,status:'ready',estimate,identityVersion:'same',dataVersion:'old'}),()=>{},()=>clock);
 await settle();clock+=31000;
 watchScannerPrice('pack-revised','KR',async(id,market)=>({id,market,status:'ready',estimate:{...estimate,currency:'USD'},identityVersion:'same',dataVersion:'new'}),v=>values.push(v),()=>clock);
 await settle();assert.equal(values.at(-1)?.estimate,undefined);assert.equal(values.at(-1)?.invalidateLocal,true);
});
test('canceling an invalidating pending recheck cannot resurrect the old price on the next watch',async()=>{
 let clock=Date.now();const values:ScannerPriceState[]=[];
 watchScannerPrice('cancel-invalidated','KR',async(id,market)=>({id,market,status:'ready',estimate}),()=>{},()=>clock);
 await settle();clock+=31000;
 const cancel=watchScannerPrice('cancel-invalidated','KR',async(id,market)=>({id,market,status:'pending',invalidateLocal:true}),()=>{},()=>clock);
 await settle();cancel();
 watchScannerPrice('cancel-invalidated','KR',async()=>{throw Error('offline');},v=>values.push(v),()=>clock);
 await settle();assert.equal(values.at(-1)?.estimate,undefined);assert.equal(values.at(-1)?.invalidateLocal,true);
});

test('fresh matching bypasses a missing-price cache and never restores invalidated prices on failure',async()=>{
 const id='fresh-matching';let calls=0;
 const request=async(id:string,market:string)=>{calls++;return {id,market,status:'missing' as const};};
 watchScannerPrice(id,'KR',request,()=>{});await settle();
 const values:ScannerPriceState[]=[];
 watchScannerPrice(id,'KR',async(id,market)=>{calls++;return {id,market,status:'ready',estimate};},v=>values.push(v),Date.now,'',true);await settle();
 assert.equal(calls,2);assert.equal(values.at(-1)?.status,'ready');assert.equal(values.at(-1)?.invalidateLocal,true);
 const failed:ScannerPriceState[]=[];
 watchScannerPrice(id,'KR',async()=>{throw Error('offline');},v=>failed.push(v),Date.now,'',true);await settle();
 assert.equal(failed.at(-1)?.status,'unavailable');assert.equal(failed.at(-1)?.estimate,undefined);assert.equal(failed.at(-1)?.invalidateLocal,true);
});

test('50394ea missing prices expire promptly and foreground revalidation preserves only valid identity',async()=>{
 let clock=Date.now(),calls=0;const values:ScannerPriceState[]=[];
 const request=async(id:string,market:string)=>{calls++;return calls===1?{id,market,status:'missing' as const,dataVersion:'old'}:{id,market,status:'ready' as const,estimate,dataVersion:'new'};};
 watchScannerPrice('prompt-recheck','KR',request,v=>values.push(v),()=>clock);await settle();clock+=6000;
 watchScannerPrice('prompt-recheck','KR',request,v=>values.push(v),()=>clock);await settle();
 assert.equal(calls,2);assert.equal(values.at(-1)?.status,'ready');assert.equal(values.at(-1)?.invalidateLocal,true);
 const current:ScannerPriceState[]=[];
 watchScannerPrice('prompt-recheck','KR',request,v=>current.push(v),()=>clock,'','revalidate');await settle();assert.equal(calls,3);assert.equal(current[0]?.estimate,estimate);
 const changed:ScannerPriceState[]=[];
 const cancel=watchScannerPrice('prompt-recheck','KR',async(id,market)=>({id,market,status:'pending',invalidateLocal:true}),v=>changed.push(v),()=>clock,'','revalidate');await settle();
 assert.equal(changed.at(-1)?.invalidateLocal,true);cancel();
 const card={language:'en',number:'7',matchLevel:'card',artworkSpecific:false,price:null} as Card;
 assert.equal(scannerPriceText(card,null,'missing',()=>''),'판본 추가 확인 필요');
});

test('a persisted withdrawal survives a new scanner session while offline',async()=>{
 const id='restored-withdrawal';restoreScannerPriceDecision(id,'KR','pack-1',{status:'withdrawn',invalidateLocal:true});
 let state:ScannerPriceState|undefined;
 watchScannerPrice(id,'KR',async()=>{throw Error('offline');},value=>{state=value;},Date.now,'pack-1','revalidate');
 await settle();assert.equal(state?.invalidateLocal,true);assert.equal(state?.status,'unavailable');
 assert.equal(scannerPriceDisplay({id,price:{amount:999,currency:'KRW'}} as Card,null,state!).displayCard?.price,null);
});

test('fresh persisted price evidence is retained during offline revalidation',async()=>{
 const id='restored-valid-evidence';restoreScannerPriceDecision(id,'KR','pack-current',{status:'ready',estimate});let state:ScannerPriceState|undefined;
 watchScannerPrice(id,'KR',async()=>{throw Error('offline');},value=>{state=value;},Date.now,'pack-current','revalidate');
 await settle();assert.equal(state?.status,'ready');assert.equal(state?.estimate?.low,4110);assert.equal(state?.invalidateLocal,true);
});
