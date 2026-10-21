import {scannerMarketName} from '../src/scanner.ts';
import { strict as assert } from 'node:assert';
import {COMPACT_MODEL_SHA,parseCompactPack,compactEventCards,nextScannerResults,type ScannerResults} from '../src/compact-library.ts';
import { test } from 'node:test';
import {SCANNER_GAMES} from '../src/scanner-games.ts';
import {encodeFeatures,decodeFeatures,FEATURE_BYTES,parseLibrary,SCANNER_MODEL_SHA,localEstimate,localMarketCard,formatScanPrice,scanEstimateLabel,scanResultImage} from '../src/scanner-library.ts';
import {emptyQuadTrack,trackCardQuad,predictedCardQuad} from '../src/card-detection.ts';
import {chooseScanRegion,alignedCardQuad} from '../src/scanner-regions.ts';
import {findIndexCandidates,findIndexHint,mergeScannerIndex,parseScannerIndex,scanFingerprint} from '../src/scanner-index.ts';
import {applyCameraZoom} from '../src/camera-control.ts';
import {availableVisualSnapshot,visualManifestChunks,type VisualLibrary} from '../src/visual-library.ts';
import {advanceScanProgress,emptyScanProgress,initialCardGuide,cardQuad,decodeCardRgb} from '../src/card-detection.ts';
import { ART_REGION, artworkReference,matchCardNames,artworkDescriptor, confirmCardNumber, confirmImageHint, cropCameraPixels, cropInputRegion, cropRgbaForOcr, cropRgbaPixels, emptyStability, findArtworkMatches, findCardAlignment, findMatches, INPUT_SIZE, inputToRgba, matchCardNumber, scannerCardNumber, scannerLookupNumber, nextStability, normalizePixels, OCR_WIDTH, parseCatalog, PREVIEW_SIZE, STABLE_FRAMES, unitVector, type Card } from '../src/scanner.ts';
const card: Card = { id: 'kream:1', name: '피카츄', number: '025/165', language: 'ko',
  pixels: `/api/scanner/images/${'a'.repeat(64)}`, image: `/market/images/kream/${'a'.repeat(64)}`, href: '/market/kream/1', price: null };
test('scanner supports six games in the requested order regardless of price market',()=>{
 assert.deepEqual(SCANNER_GAMES,['pokemon','riftbound','one_piece','yugioh','dragon_ball','magic']);
 const en={...card,language:'en',game:'magic',matchLevel:'printing' as const};
 for(const market of ['KR','US','EU'])assert.equal(localMarketCard(en,market).matchLevel,'printing');
});
test('compact packs reject partial downloads and incompatible models before opening the camera',()=>{
 const part={key:'a'.repeat(64),bytes:100},value={version:1,engine:'card-encoder-256-v1',usearchVersion:'2.26.3',game:'pokemon',dimensions:256,complete:true,
 generatedAt:new Date().toISOString(),count:74000,cardCount:74341,model:{...part,key:COMPACT_MODEL_SHA},index:part,cards:part,prices:part};
 assert.equal(parseCompactPack(value,'pokemon').count,74000);
 for(const invalid of [{...value,dimensions:1024},{...value,usearchVersion:'2.27.0'},{...value,complete:false},{...value,model:part},{...value,index:{...part,key:'../outside'}},{...value,cardCount:1}])assert.throws(()=>parseCompactPack(invalid,'pokemon'));
 assert.throws(()=>parseCompactPack(value,'magic'));
});
test('native shortlists accept public catalog references and reject unsafe or malformed result payloads',()=>{
 assert.deepEqual(compactEventCards(JSON.stringify([card])),[card]);
 assert.deepEqual(compactEventCards(JSON.stringify([{...card,image:'https://external.example/image.jpg'},{...card,href:'/admin'}])),[]);
 assert.deepEqual(compactEventCards('{'),[]);assert.deepEqual(compactEventCards(JSON.stringify(new Array(97).fill(card))),[]);
});
test('scanner results retain price evidence on missed frames and replace it on the next confirmed card',()=>{
 const now=Date.parse('2026-10-06T00:00:00Z'),fresh='2026-10-05T00:00:00Z';
 const target={...card,game:'pokemon',setCode:'sv1',rarity:'rare',finish:'regular'};
 const peers=[1000,2000,3000].map((amount,i)=>({...target,id:`kream:${10+i}`,price:{amount,currency:'KRW',source:'KREAM',type:'LISTED',observedAt:fresh}}));
 const empty:ScannerResults={card:null,comparables:[],similar:[]};
 const event={id:target.id,ids:[target.id],confirmed:true,cardsJson:JSON.stringify([target,...peers])};
 const confirmed=nextScannerResults(empty,event,undefined,false);
 assert.equal(localEstimate(confirmed.card!,confirmed.comparables,'KR',now)?.count,3);
 for(const miss of [{id:'',ids:[],confirmed:false,cardsJson:'[]'},{...event,id:'kream:missing'},{...event,cardsJson:'malformed'}]){
  const retained=nextScannerResults(confirmed,miss,undefined,true);assert.equal(retained,confirmed);
  assert.equal(localEstimate(retained.card!,retained.comparables,'KR',now)?.count,3);
 }
 const next={...target,id:'kream:99',price:{amount:15000,currency:'KRW',source:'KREAM',type:'LISTED',observedAt:fresh}};
 const changed=nextScannerResults(confirmed,{id:next.id,ids:[next.id],confirmed:true,cardsJson:JSON.stringify([next])},undefined,false);
 assert.equal(changed.card?.id,next.id);assert.deepEqual(changed.comparables.map(c=>c.id),[next.id]);assert.deepEqual(changed.similar,[]);
 assert.equal(localMarketCard(changed.card!,'KR',now).price?.amount,15000);
});
test('scanner results resolve catalog IDs consistently for live/photo and legacy paths',()=>{
 const target={...card,id:'riot:en:OGN-055/298',game:'riftbound'},id='catalog:'+target.id;
 const event={id,ids:[id],confirmed:true,cardsJson:JSON.stringify([target])},empty:ScannerResults={card:null,comparables:[],similar:[]};
 const compact=nextScannerResults(empty,event,undefined,false),legacy=nextScannerResults(empty,event,new Map([[id,target]]),true);
 assert.deepEqual(compact,legacy);assert.equal(compact.card?.id,target.id);
 const candidates=[1,2,3,4].map(n=>({...card,id:`kream:${n}`})),suggestion={id:'',ids:[],confirmed:false,cardsJson:JSON.stringify(candidates)};
 assert.equal(nextScannerResults(empty,suggestion,undefined,false),empty);
 assert.equal(nextScannerResults(empty,suggestion,undefined,true).similar.length,3);
 assert.equal(nextScannerResults(compact,suggestion,undefined,true),compact);
});
test('saves large manifests in bounded card batches with intact Unicode and metadata',()=>{
 const value:VisualLibrary={version:1,model:'orb-spatial-v1',game:'pokemon',generatedAt:new Date().toISOString(),complete:false,
  cards:Array.from({length:1000},(_,i)=>({id:`kream:${i}`,card:{...card,id:`kream:${i}`,name:'피카츄 🟡 ミュウ'},count:512,part:'a'.repeat(64)})),parts:[{key:'a'.repeat(64),bytes:10000}]};
 const chunks=[...visualManifestChunks(value)];
 assert.equal(chunks.length,6);assert.ok(chunks.every(c=>c.length<200000));
 assert.deepEqual(JSON.parse(chunks.join('')),value);
 assert.deepEqual(JSON.parse([...visualManifestChunks({...value,cards:[]})].join('')),{...value,cards:[]});
});
test('keeps usable descriptors during catalog replacement, persists partial downloads, and removes withdrawn cards',()=>{
 const oldPart='a'.repeat(64),newPart='b'.repeat(64);
 const old:VisualLibrary={version:1,model:'orb-spatial-v1',game:'pokemon',generatedAt:new Date().toISOString(),complete:true,
  cards:[{id:card.id,card:{...card,game:'pokemon'},count:128,part:oldPart},{id:'kream:withdrawn',card:{...card,id:'kream:withdrawn'},count:128,part:oldPart}],parts:[{key:oldPart,bytes:10000}]};
 const fresh:VisualLibrary={...old,cards:[{...old.cards[0],count:512,part:newPart,card:{...old.cards[0].card,name:'새 이름'}}],parts:[{key:newPart,bytes:20000}]};
 const partial=availableVisualSnapshot(fresh,old,new Set([oldPart]));
 assert.equal(partial.cards.length,1);assert.equal(partial.cards[0].part,oldPart);assert.equal(partial.cards[0].count,128);assert.equal(partial.cards[0].card.name,'새 이름');assert.equal(partial.complete,false);
 assert.deepEqual(availableVisualSnapshot(fresh,partial,new Set([oldPart,newPart])),fresh);
 assert.equal(availableVisualSnapshot(fresh,{...old,game:'magic'},new Set([oldPart])).cards[0].part,newPart);
});
const corners = (left: number, top: number, right: number, bottom: number) => [{ x: left, y: top }, { x: right, y: top }, { x: left, y: bottom }, { x: right, y: bottom }];
test('reads the guide without a detected rectangle and selects the card picture over an enclosing border',()=>{
 const pixels=new Float32Array(INPUT_SIZE**2*3);
 for(let y=0;y<INPUT_SIZE;y++)for(let x=0;x<INPUT_SIZE;x++)pixels.set([.5+.4*Math.sin(x/11+y/9),.5+.4*Math.cos(y/13),.5+.4*Math.cos(x/17-y/21)],(y*INPUT_SIZE+x)*3);
 const reference={card,vector:[1,0],artDescriptor:artworkDescriptor(pixels)!},index=[{...scanFingerprint(pixels),id:card.id,number:card.number}];
 const guide={source:'guide',pixels},outside={source:'edge',pixels:pixels.map(v=>1-v)},getReferences=()=>[reference];
 assert.equal(chooseScanRegion([guide],index,getReferences,'')!.region,guide);
 assert.equal(chooseScanRegion([outside,guide],index,getReferences,'')!.region,guide);
 const inner={source:'edge',pixels};
 assert.equal(chooseScanRegion([outside,inner,{source:'guide',pixels:outside.pixels}],index,getReferences,'')!.region,inner);
 assert.equal(chooseScanRegion([],index,getReferences,''),null);
});
test('maps a matched artwork back to the card boundary in camera perspective',()=>{
 const quad=cardQuad([{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}])!;
 const alignment={region:{left:.2+.6*ART_REGION.left,top:.15+.7*ART_REGION.top,width:.6*ART_REGION.width,height:.7*ART_REGION.height},scores:[],margin:1};
 const q=alignedCardQuad(quad,alignment),expected=[{x:.26,y:.22},{x:.74,y:.22},{x:.74,y:.78},{x:.26,y:.78}];
 q.forEach((p,i)=>assert.ok(Math.hypot(p.x-expected[i].x,p.y-expected[i].y)<1e-9));
 const perspective=cardQuad([{x:.2,y:.1},{x:.8,y:.2},{x:.75,y:.85},{x:.25,y:.9}])!;
 alignedCardQuad(perspective,{...alignment,region:ART_REGION}).forEach((p,i)=>assert.ok(Math.hypot(p.x-perspective[i].x,p.y-perspective[i].y)<1e-9));
});
test('partial local references do not remove NO112 from the complete discovery index',()=>{
 const input=new Float32Array(INPUT_SIZE**2*3);for(let i=0;i<input.length;i++)input[i]=.5+.4*Math.sin(i/31);
 const target={...scanFingerprint(input),id:'kream:667702',number:'NO112'},other={...target,id:'kream:1',hash:'a'.repeat(64),art:'b'.repeat(64),color:new Array(48).fill(0)};
 const index=mergeScannerIndex([target,other],[other]);assert.equal(index.length,2);assert.equal(findIndexHint(input,index)?.id,target.id);
 const refreshed={...other,number:'new-number'};assert.equal(mergeScannerIndex([other],[refreshed])[0].number,'new-number');
});
test('a verified photo reference does not compete with its linked catalog picture, while other editions stay distinct',()=>{
 const f={hash:'a'.repeat(64),art:'b'.repeat(64),color:new Array(48).fill(100)},catalog={...f,id:'catalog:scryfall:reference',number:'188'};
 const photo={...f,id:'photo:example',number:'188/350',card:{referenceId:'scryfall:reference'}},other={...catalog,id:'catalog:scryfall:other-edition'};
 assert.deepEqual(mergeScannerIndex([],[catalog,photo,other]).map(c=>c.id),[catalog.id,other.id]);
 assert.deepEqual(mergeScannerIndex([],[photo]).map(c=>c.id),[photo.id]);
 assert.equal(mergeScannerIndex([],[catalog,{...photo,card:{referenceId:'scryfall:unrelated'}}]).length,2);
});
test('zoom waits for live preview and ignores cancellation during camera shutdown',async()=>{
 const calls:number[]=[],controller={minZoom:1,maxZoom:2,setZoom:async(v:number)=>{calls.push(v);}};
 assert.equal(await applyCameraZoom(controller,1,()=>false),false);assert.deepEqual(calls,[]);
 assert.equal(await applyCameraZoom(controller,3,()=>true),true);assert.deepEqual(calls,[2]);
 let active=true;
 const shuttingDown={...controller,setZoom:async()=>{active=false;throw Error('OperationCanceledException: Camera is not active.');}};
 assert.equal(await applyCameraZoom(shuttingDown,1,()=>active),false);
 assert.equal(await applyCameraZoom({...controller,setZoom:async()=>{throw Error('Camera is not active.');}},1,()=>true),false);
 await assert.rejects(applyCameraZoom({...controller,setZoom:async()=>{throw Error('Unexpected camera failure');}},1,()=>true),/Unexpected camera failure/);
});
test('compressed references preserve cosine decisions and reject broken records',()=>{
 const vector=unitVector(Float32Array.from({length:1024},(_,i)=>Math.sin(i*.71)*.3+Math.cos(i*.17))),descriptor=unitVector(Float32Array.from({length:288},(_,i)=>Math.sin(i*.37)));
 const bytes=encodeFeatures([vector,vector,descriptor]);assert.equal(bytes.length,FEATURE_BYTES);
 const ref=decodeFeatures(card,bytes);assert.ok(vector.reduce((n,v,i)=>n+v*ref.vector[i],0)>.9999);assert.ok(descriptor.reduce((n,v,i)=>n+v*ref.artDescriptor![i],0)>.9999);
 assert.throws(()=>decodeFeatures(card,bytes.slice(1)));assert.throws(()=>encodeFeatures([new Float32Array(1024),vector,descriptor]));
 const fp={hash:'a'.repeat(64),art:'b'.repeat(64),color:new Array(48).fill(128)},part='c'.repeat(64),entry={...fp,id:card.id,number:card.number,card:{...card,game:'pokemon'},part,offset:0};
 const value={version:3,model:'mobilenet-v3-small-v1',modelSha:SCANNER_MODEL_SHA,complete:true,game:'pokemon',generatedAt:new Date().toISOString(),parts:[{key:part,bytes:FEATURE_BYTES}],cards:[entry]};
 assert.equal(parseLibrary(value,'pokemon').cards.length,1);assert.throws(()=>parseLibrary({...value,modelSha:'a'.repeat(64)},'pokemon'));assert.throws(()=>parseLibrary({...value,cards:[{...entry,offset:1}]},'pokemon'));assert.throws(()=>parseLibrary({...value,cards:[{...entry,card:{...entry.card,image:'/api/card-photos/private'}}]},'pokemon'));
 const riot={...entry,id:'catalog:riot:en:OGN-055/298',card:{...entry.card,id:'riot:en:OGN-055/298',game:'riftbound',href:'/market/catalog/riot%3Aen%3AOGN-055%2F298'}};
 assert.equal(parseLibrary({...value,game:'riftbound',cards:[riot]},'riftbound').cards[0].card.id,'riot:en:OGN-055/298');
 assert.throws(()=>parseLibrary({...value,cards:[{...entry,id:'source:'+ 'a'.repeat(64)}]},'pokemon'));
});
test('local prices retain currency, date and strict comparable identity evidence',()=>{
 const now=Date.parse('2026-10-06T00:00:00Z'),fresh='2026-10-05T00:00:00Z',target={...card,game:'pokemon',setCode:'sv1',rarity:'rare',finish:'regular'},price=(amount:number,currency='KRW',observedAt=fresh)=>({amount,currency,type:'LISTED',source:'KREAM',observedAt});
 const peers=[1000,2000,3000,4000].map((amount,i)=>({...target,id:'kream:'+(i+10),price:price(amount)}));
 assert.equal(localMarketCard({...target,prices:[price(5000),price(4,'USD')]},'US',now).price?.amount,4);assert.equal(localMarketCard({...target,prices:[price(5000,'KRW','2026-01-01T00:00:00Z')]},'KR',now).price,null);
 assert.deepEqual(localEstimate(target,peers,'KR',now),{low:1000,high:4000,currency:'KRW',count:4,observedAt:fresh,method:'same-game-set-rarity-language-finish-quartiles'});
 assert.equal(localEstimate({...target,rarity:undefined},peers,'KR',now),null);assert.equal(localEstimate(target,peers.slice(0,2),'KR',now),null);assert.equal(localEstimate(target,peers.map(c=>({...c,language:'en'})),'KR',now),null);assert.equal(localEstimate(target,peers,'US',now),null);assert.equal(localEstimate(target,peers.map(c=>({...c,finish:'foil'})),'KR',now),null);
 assert.equal(formatScanPrice(price(4,'USD')),'$4');
});
test('outline rejects isolated internal-rectangle jumps and follows sustained movement',()=>{
 const quad=initialCardGuide(360,800),first=trackCardQuad(emptyQuadTrack(),quad,1000),inner=quad.map(p=>({x:.5+(p.x-.5)*.65,y:.51+(p.y-.51)*.65})) as typeof quad;
 const bad=trackCardQuad(first,inner,1067);assert.deepEqual(bad.quad,first.quad);const restored=trackCardQuad(bad,quad,1134);assert.equal(restored.pending,null);
 const moving=quad.map(p=>({...p,x:p.x+.02})) as typeof quad,followed=trackCardQuad(first,moving,1067);assert.ok(followed.quad![0].x>quad[0].x);assert.ok(cardQuad(predictedCardQuad(followed)));
});

test('photo results use their saved prices offline without same-set comparables or treating other editions as exact prices',()=>{
 const now=Date.parse('2026-10-06T00:00:00Z'),id='46aa3116-6ae6-40d6-a5b2-da14bc2e17c8';
 const saved={amount:256,low:256,high:256,currency:'KRW',count:1,source:'Scryfall',observedAt:'2026-10-05T00:00:00Z',method:'catalog_reference' as const};
 const target={...card,id:'photo:'+id,game:'magic',artworkSpecific:false,image:'/api/card-photos/'+id,href:'/market/photos/'+id,valuations:[saved]};
 const estimate=localEstimate(target,[],'KR',now)!;
 assert.equal(estimate.low,256);assert.equal(scanEstimateLabel(estimate),'상품 참고가 · 등급 미확인');assert.equal(formatScanPrice(estimate),'₩256');
 assert.equal(target.price,null);assert.equal(localEstimate(target,[],'US',now),null);
 assert.equal(localEstimate({...target,valuations:[{...saved,observedAt:'2026-01-01'}]},[],'KR',now),null);
 assert.equal(scanEstimateLabel({...estimate,method:'ai'}),'AI 추정가');
 const part='c'.repeat(64),entry={id:target.id,number:target.number,card:target,part,offset:0,...{hash:'a'.repeat(64),art:'b'.repeat(64),color:Array(48).fill(100)}};
 const library={version:3,model:'mobilenet-v3-small-v1',modelSha:SCANNER_MODEL_SHA,complete:false,game:'magic',generatedAt:saved.observedAt,parts:[{key:part,bytes:FEATURE_BYTES}],cards:[entry]};
 assert.equal(parseLibrary(library,'magic').cards[0].card.id,target.id);
 assert.throws(()=>parseLibrary({...library,cards:[{...entry,card:{...target,valuations:[{...saved,high:-1}]}}]},'magic'));
});

test('estimate thumbnails use related catalog images and never substitute the uploaded photo',()=>{
 const photo={...card,id:'photo:13d30551-bbb2-4560-aa6f-2cae69ed4b33',image:'/api/card-photos/13d30551-bbb2-4560-aa6f-2cae69ed4b33'};
 const estimate={low:20000,high:20000,currency:'KRW',count:1,observedAt:'2026-10-05T00:00:00Z',method:'catalog_reference' as const};
 const referenceThumbnail={image:`/market/images/kream/${'b'.repeat(64)}`,href:'/market/printings/sp%3Akream%3A924168',name:'Gwynn'};
 assert.equal(scanResultImage({...photo,referenceThumbnail},estimate),referenceThumbnail.image);
 assert.equal(scanResultImage(photo,estimate),null);
 assert.equal(scanResultImage(card,null),card.image);
 assert.equal(scanResultImage({...card,referenceThumbnail},null),card.image);
});

test('fallback waits four clear continuous seconds and resets on blur, movement or dropped frames',()=>{
 const q=initialCardGuide(360,800);assert.ok(cardQuad(q));
 assert.ok(Math.abs((q[1].x-q[0].x)*360/((q[3].y-q[0].y)*800)-.716)<1e-8);
 let progress=emptyScanProgress();
 for(let t=1000;t<=5000;t+=100)progress=advanceScanProgress(progress,q,true,t);
 assert.equal(progress.elapsed,4000);
 assert.equal(advanceScanProgress(progress,q,false,5100).elapsed,0);
 assert.equal(advanceScanProgress(progress,null,true,5100).elapsed,0);
 assert.equal(advanceScanProgress(progress,q,true,6000).elapsed,0);
 const moved=q.map(p=>({...p,x:p.x+.07})) as typeof q;
 assert.equal(advanceScanProgress(progress,moved,true,5100).elapsed,0);
});

test('similar suggestions retain ambiguous distinct candidates without confirming them',()=>{
 const pixels=new Float32Array(INPUT_SIZE**2*3);
 for(let i=0;i<pixels.length;i++)pixels[i]=.5+.4*Math.sin(i/31);
 const f=scanFingerprint(pixels);
 const cards=[1,2,3].map(id=>({...f,id:`kream:${id}`,number:`card-${id}`}));
 const result=findIndexCandidates(pixels,[cards[0],cards[0],cards[1],cards[2]]);
 assert.deepEqual(result.map(c=>c.id),['kream:1','kream:2','kream:3']);
 assert.equal(findIndexHint(pixels,cards),null);
 assert.deepEqual(findIndexCandidates(new Float32Array(pixels.length).fill(.5),cards),[]);
});

test('normalizes actual model RGB input to 0..1 and rejects malformed images', () => {
  const rgb = new Uint8Array(INPUT_SIZE ** 2 * 3); rgb.set([0, 128, 255]);
  const normalized = normalizePixels(rgb);
  assert.equal(normalized[0], 0); assert.equal(normalized[2], 1); assert.ok(Math.abs(normalized[1] - 128 / 255) < 1e-6);
  assert.throws(() => normalizePixels(new Uint8Array(2)));
});
test('samples the portrait card guide from a centered square preview without outside background', () => {
  const rgb = new Uint8Array(PREVIEW_SIZE ** 2 * 3);
  for (let y = 19; y < 301; y++) for (let x = 59; x < 261; x++) rgb.set([255, 128, 0], (y * PREVIEW_SIZE + x) * 3);
  const crop = cropCameraPixels(rgb);
  assert.equal(crop.length, INPUT_SIZE ** 2 * 3);
  for (let i = 0; i < crop.length; i += 3) { assert.equal(crop[i], 1); assert.equal(crop[i + 2], 0); }
});
test('reads Android RGBA in RGB order with nonzero guide coordinates and padded rows', () => {
  const width = 6, height = 5, stride = 32;
  // The last row need not contain trailing padding.
  const rgba = new Uint8Array((height - 1) * stride + width * 4).fill(77);
  for (let y = 1; y < 4; y++) for (let x = 2; x < 5; x++) rgba.set([255, 128, 0, 19], y * stride + x * 4);
  const input = cropRgbaPixels(rgba, width, height, stride, corners(2, 1, 5, 4));
  for (let i = 0; i < input.length; i += 3) {
    assert.equal(input[i], 1); assert.ok(Math.abs(input[i + 1] - 128 / 255) < 1e-6); assert.equal(input[i + 2], 0);
  }
  const displayed = inputToRgba(input);
  for (let i = 0; i < displayed.length; i += 4) assert.deepEqual(Array.from(displayed.slice(i, i + 4)), [255, 128, 0, 255]);
});
test('clamps partly outside crops and rejects invalid or completely outside frame coordinates', () => {
  const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  const input = cropRgbaPixels(rgba, 2, 1, 8, corners(-1, -1, 3, 2));
  assert.ok(Math.abs(input[0] - 1 / 255) < 1e-6);
  assert.ok(Math.abs(input[input.length - 1] - 6 / 255) < 1e-6);
  for (const crop of [corners(2, 0, 3, 1), corners(1, 0, 1, 1), corners(NaN, 0, 1, 1)]) assert.throws(() => cropRgbaPixels(rgba, 2, 1, 8, crop));
  assert.throws(() => cropRgbaPixels(rgba, 2, 2, 8, corners(0, 0, 1, 1)));
  assert.throws(() => cropRgbaPixels(rgba, 2, 1, 7, corners(0, 0, 1, 1)));
});
test('orients sideways and upside-down sensor buffers by following the preview guide corners', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
  const variants = [
    { points: corners(0, 0, 2, 2), first: [1, 0, 0], last: [1, 1, 0] },
    { points: [{ x: 0, y: 2 }, { x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }], first: [0, 0, 1], last: [0, 1, 0] },
    { points: corners(2, 2, 0, 0), first: [1, 1, 0], last: [1, 0, 0] },
    { points: [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 0 }, { x: 0, y: 2 }], first: [0, 1, 0], last: [0, 0, 1] },
  ];
  for (const { points, first, last } of variants) {
    const input = cropRgbaPixels(rgba, 2, 2, 8, points);
    assert.deepEqual(Array.from(input.slice(0, 3)), first);
    assert.deepEqual(Array.from(input.slice(-3)), last);
  }
});
test('rejects unknown vectors and ambiguous editions rather than accepting a nearest neighbor', () => {
  const refs = [{ card, vector: unitVector([1, 0, 0]) }, { card: { ...card, id: 'kream:2' }, vector: unitVector([0, 1, 0]) }];
  assert.equal(findMatches([0, 0, 1], refs)[0].accepted, false);
  assert.equal(findMatches([1, 0, 0], refs)[0].accepted, true);
  assert.equal(findMatches([1, 0, 0], [refs[0], { ...refs[1], vector: refs[0].vector }])[0].accepted, false);
  assert.throws(() => findMatches([NaN, 0, 1], refs));
  assert.throws(() => findMatches([1], refs));
});
test('requires consecutive observations, resets on another card or a dropped stream', () => {
  const match = { card, score: 1, margin: 1, accepted: true };
  let state = emptyStability();
  for (let i = 0; i < STABLE_FRAMES; i++) state = nextStability(state, match, 1000 + i * 200);
  assert.equal(state.count, STABLE_FRAMES); assert.equal(state.startedAt, 1000);
  assert.equal(state.confirmedAt, 1400); assert.equal(nextStability(state, match, 1600).confirmedAt, 1400);
  assert.equal(nextStability(state, { ...match, accepted: false }, 1600).count, 0);
  assert.equal(nextStability(state, { ...match, card: { ...card, id: 'kream:2' } }, 1600).count, 1);
  assert.equal(nextStability(state, match, 3000).count, 1);
});
test('allows only the expected public catalog URLs and LISTED prices', () => {
  const pack = { version: 1, imageSize: 224, cards: [card], total: 1 };
  assert.equal(parseCatalog(pack).cards.length, 1);
  for (const pixels of ['https://example.com/image', '/api/card-photos/private', '//example.com/image']) assert.throws(() => parseCatalog({ ...pack, cards: [{ ...card, pixels }] }));
  assert.throws(() => parseCatalog({ ...pack, cards: Array(25).fill(card) }));
  assert.throws(() => parseCatalog({ ...pack, cards: [{ ...card, price: { amount: -1, currency: 'KRW' } }] }));
});

test('reads collector numbers, requires a unique set and rejects conflicting OCR', () => {
  const a = { card: { ...card, number: 'SV5K093-071' }, vector: [1, 0] };
  const b = { card: { ...card, id: 'kream:2', number: 'SV8A093-071' }, vector: [0, 1] };
  assert.equal(matchCardNumber('sv5K 093 / 071 SAR', [a, b]), a);
  assert.equal(matchCardNumber('SV5K093-071', [a, b]), a);
  assert.equal(matchCardNumber('093/071', [a]), a);
  assert.equal(matchCardNumber('093/071', [a, b]), null);
  assert.equal(matchCardNumber('SV8A 093/071', [a]), null);
  assert.equal(matchCardNumber('HP 230 260', [a]), null);
  assert.equal(matchCardNumber('000/071', [a]), null);
  const aligned = { region: ART_REGION, scores: [{ id: a.card.id, score: 0.9 }, { id: b.card.id, score: 0.3 }], margin: 0.6 };
  assert.equal(confirmCardNumber(a, [0.7, 0.1], [a, b], aligned)?.method, 'number');
  assert.equal(confirmCardNumber(a, [0, 1], [a, b], aligned), null);
  // An exact OCR number and clear spatial match can disambiguate generic
  // ImageNet vectors even when their cosine scores are close.
  assert.equal(confirmCardNumber(a, [1, 1], [a, b], aligned)?.accepted, true);
  assert.equal(confirmCardNumber(a, [1, 1], [a, b], { ...aligned, margin: 0.04 }), null);
  assert.equal(confirmCardNumber(a, [1, 1], [a, b], { ...aligned, scores: [{ id: b.card.id, score: 0.9 }] }), null);
  assert.equal(confirmCardNumber(a, [0.3, 0.95], [a], aligned), null);
  assert.equal(confirmCardNumber(a, [0.7, 0.1], [a, b], null), null);
  assert.equal(confirmCardNumber(a, [0.7, 0.1], [a, b], { ...aligned, scores: [{ id: a.card.id, score: 0.5 }] }), null);
  assert.equal(confirmCardNumber(a, [0.55, Math.sqrt(1 - 0.55 ** 2)], [a], aligned)?.accepted, true);
  assert.equal(confirmCardNumber(a, [0.49, Math.sqrt(1 - 0.49 ** 2)], [a], aligned), null);
});
test('reads complete One Piece/Yugioh codes without choosing between alternate illustrations',()=>{
 const a={card:{id:'piece-a',number:'ST23-001-SR-P'},vector:[]},b={card:{id:'piece-b',number:'ST23-001'},vector:[]};
 assert.equal(scannerLookupNumber('ST23-001 SR'),'ST23-001');
 assert.equal(matchCardNumber('ST23-001 SR',[a] as any),a);
 assert.equal(matchCardNumber('ST23-001',[a,b] as any),null);
 assert.equal(scannerLookupNumber('DP27-JP005'),'DP27-JP005');
 assert.equal(scannerLookupNumber('DP27-JP005 DP27-KR005'),null);
});

test('keeps M6a collectors separate from commemorative numbers and preserves Riot variants',()=>{
 const pikachu={card:{...card,number:'M6A017-103'},vector:[1,0]};
 const anniversary={card:{...card,id:'kream:other',number:'001-030'},vector:[0,1]};
 assert.equal(scannerLookupNumber('30th 01/30 M6a 017/103'),'M6A017-103');
 assert.equal(matchCardNumber('01/30 M6a 017/103',[pikachu,anniversary]),pikachu);
 assert.equal(matchCardNumber('M6a 01/30',[pikachu]),null);
 assert.equal(scannerLookupNumber('M6a 017/103 SV8a 103/187'),null);
 const alt={card:{...card,id:'riot:alt',game:'riftbound',number:'OGN-039A/298'},vector:[1,0]};
 const normal={...alt,card:{...alt.card,id:'riot:normal',number:'OGN-039/298'}};
 const foil={...alt,card:{...alt.card,id:'riot:foil',number:'OGN-039a-298-F'}};
 assert.equal(scannerLookupNumber('Kai’Sa OGN-039A/298'),'OGN-039A-298');
 assert.equal(matchCardNumber('OGN-039A/298',[alt,normal,foil]),alt);
 assert.equal(matchCardNumber('OGN-039a-298-F',[alt,normal,foil]),foil);
 assert.equal(matchCardNumber('039/298',[alt,normal,foil]),null);
 assert.equal(scannerLookupNumber('227/S-P'),'PROMO227-S-P');
});

test('labels another-language printing as a reference while retaining market and source date',()=>{
 const date='2026-10-08T14:38:32Z',value={amount:349,low:349,high:349,currency:'KRW',sourceCurrency:'USD',converted:true,count:1,source:'JustTCG',observedAt:date,method:'catalog_reference' as const,referenceKind:'other_printing' as const,sourceLanguage:'ja',sourceNumber:'103/187'};
 const target={...card,language:'ko',number:'SV8A103-187',price:null,valuations:[value]};
 const saved=localEstimate(target,[],'KR',Date.parse('2026-10-09T00:00:00Z'))!;
 assert.equal(scanEstimateLabel(saved),'해외 시세 환산 · 일본 판본 참고가');
 assert.equal(saved.observedAt,date);assert.equal(formatScanPrice(saved),'₩349');
 assert.equal(localEstimate(target,[],'US',Date.parse('2026-10-09T00:00:00Z')),null);
});

test('keeps M6a collectors separate from commemorative numbers and preserves Riot variants',()=>{
 const pikachu={card:{...card,number:'M6A017-103'},vector:[1,0]};
 const anniversary={card:{...card,id:'kream:other',number:'001-030'},vector:[0,1]};
 assert.equal(scannerLookupNumber('30th 01/30 M6a 017/103'),'M6A017-103');
 assert.equal(matchCardNumber('01/30 M6a 017/103',[pikachu,anniversary]),pikachu);
 assert.equal(matchCardNumber('M6a 01/30',[pikachu]),null);
 assert.equal(scannerLookupNumber('M6a 017/103 SV8a 103/187'),null);
 const alt={card:{...card,id:'riot:alt',game:'riftbound',number:'OGN-039A/298'},vector:[1,0]};
 const normal={...alt,card:{...alt.card,id:'riot:normal',number:'OGN-039/298'}};
 const foil={...alt,card:{...alt.card,id:'riot:foil',number:'OGN-039a-298-F'}};
 assert.equal(scannerLookupNumber('Kai’Sa OGN-039A/298'),'OGN-039A-298');
 assert.equal(matchCardNumber('OGN-039A/298',[alt,normal,foil]),alt);
 assert.equal(matchCardNumber('OGN-039a-298-F',[alt,normal,foil]),foil);
 assert.equal(matchCardNumber('039/298',[alt,normal,foil]),null);
 assert.equal(scannerLookupNumber('227/S-P'),'PROMO227-S-P');
 assert.equal(scannerLookupNumber('OGN-310-298-S-F'),'OGN-310-298-S-F');
});

test('labels another-language printing as a reference while retaining market and source date',()=>{
 const date='2026-10-08T14:38:32Z',value={amount:349,low:349,high:349,currency:'KRW',sourceCurrency:'USD',converted:true,count:1,source:'JustTCG',observedAt:date,method:'catalog_reference' as const,referenceKind:'other_printing' as const,sourceLanguage:'ja',sourceNumber:'103/187'};
 const target={...card,language:'ko',number:'SV8A103-187',price:null,valuations:[value]};
 const saved=localEstimate(target,[],'KR',Date.parse('2026-10-09T00:00:00Z'))!;
 assert.equal(scanEstimateLabel(saved),'해외 시세 환산 · 일본 판본 참고가');
 assert.equal(saved.observedAt,date);assert.equal(formatScanPrice(saved),'₩349');
 assert.equal(localEstimate(target,[],'US',Date.parse('2026-10-09T00:00:00Z')),null);
});

test('OCR includes a number above the last 14% of the guide without stretching digits', () => {
  const width = 8, height = 10, rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([x, y, 200, 255], (y * width + x) * 4);
  const result = cropRgbaForOcr(rgba, width, height, width * 4, corners(0, 0, width, height));
  // 8x10 guide => 7.68x4 footer, centered at 492x256 in the OCR canvas.
  assert.deepEqual(Array.from(result.slice(0, 4)), [255, 255, 255, 255]);
  assert.deepEqual(Array.from(result.slice(10 * 4, 10 * 4 + 4)), [0, 6, 200, 255]);
  const number = (Math.floor(0.5 * 256) * OCR_WIDTH + 256) * 4;
  assert.deepEqual(Array.from(result.slice(number, number + 4)), [4, 8, 200, 255]);
  assert.deepEqual(Array.from(result.slice(-4)), [255, 255, 255, 255]);
  assert.throws(() => cropRgbaForOcr(rgba, width, height, width * 4, corners(0, 0, 0, 0)));
  assert.equal(result.length % (OCR_WIDTH * 4), 0);
});

test('artwork alignment rejects blank backgrounds and needs independent model agreement', () => {
  const input = new Float32Array(INPUT_SIZE ** 2 * 3);
  for (let y = 0; y < INPUT_SIZE; y++) for (let x = 0; x < INPUT_SIZE; x++) {
    input.set([0.5 + 0.4 * Math.sin(x / 19 + y / 41), 0.5 + 0.4 * Math.cos(y / 23), 0.5 + 0.4 * Math.sin(x / 29 - y / 17)], (y * INPUT_SIZE + x) * 3);
  }
  const refs = [{ card, vector: [1, 0], artVector: [1, 0], artDescriptor: artworkDescriptor(input) }];
  const aligned = findCardAlignment(input, refs);
  assert.ok(aligned); assert.ok(aligned.scores[0].score > 0.999);
  assert.equal(findArtworkMatches([1, 0], refs, aligned)[0].accepted, true);
  assert.equal(findArtworkMatches([0, 1], refs, aligned)[0].accepted, false);
  assert.equal(findCardAlignment(input, [...refs, { ...refs[0], card: { ...card, id: 'kream:2' } }]), null);
  assert.equal(artworkDescriptor(new Float32Array(input.length).fill(0.5)), undefined);
  assert.equal(findCardAlignment(new Float32Array(input.length).fill(0.5), refs), null);
  const cropped = cropInputRegion(input, ART_REGION);
  assert.equal(cropped.length, input.length); assert.ok(cropped.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
});

test('refines artwork framing between coarse positions instead of lowering the threshold', () => {
  const reference = new Float32Array(INPUT_SIZE ** 2 * 3);
  for (let y = 0; y < INPUT_SIZE; y++) for (let x = 0; x < INPUT_SIZE; x++) {
    reference.set([0.5 + 0.4 * Math.sin(x / 9 + y / 21), 0.5 + 0.4 * Math.cos(y / 12), 0.5 + 0.4 * Math.sin(x / 17 - y / 11)], (y * INPUT_SIZE + x) * 3);
  }
  const frame = new Float32Array(reference.length).fill(0.8);
  const left = 0.12, top = 0.10, width = 0.8, height = 0.75;
  for (let y = 0; y < INPUT_SIZE; y++) for (let x = 0; x < INPUT_SIZE; x++) {
    const u = (x / INPUT_SIZE - left) / width, v = (y / INPUT_SIZE - top) / height;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
    const source = (Math.floor(v * INPUT_SIZE) * INPUT_SIZE + Math.floor(u * INPUT_SIZE)) * 3;
    frame.set(reference.subarray(source, source + 3), (y * INPUT_SIZE + x) * 3);
  }
  const refs = [{ card, vector: [1, 0], artDescriptor: artworkDescriptor(reference) }];
  const aligned = findCardAlignment(frame, refs);
  assert.ok(aligned); assert.ok(aligned.scores[0].score >= 0.88);
});

test('preserves promo prefixes and retrieves short names despite a contradictory number',()=>{
 for(const number of ['227/S-P','1001/XY-P','12/ADV-P','19/PCG-P'])assert.equal(scannerLookupNumber(number),'PROMO'+number.replace('/','-'));
 assert.equal(scannerLookupNumber('Mewtwo V SWSH229'),'SWSH229');
 assert.equal(scannerLookupNumber('S8a-P 014/025'),'S8A-P014-025');
 assert.equal(scannerLookupNumber('SM12 001/103'),'SM12001-103');
 const uta={card:{...card,id:'uta',name:'ウタ',number:'OP02-120'},vector:[]};
 const mew={card:{...card,id:'mew',name:'Mew'},vector:[]};
 assert.deepEqual(matchCardNames('ウタ\nOP05-120',[uta,mew]),[uta]);
 assert.equal(matchCardNumber('ウタ\nOP05-120',[uta,mew]),null);
 assert.deepEqual(matchCardNames('Mewtwo V\nSWSH229',[mew]),[]);
 assert.deepEqual(matchCardNames('',[uta,mew]),[]);
 const wrong={card:{...card,id:'luffy',name:'モンキー・D・ルフィ',number:'OP05-120'},vector:[1,0]};
 const alignment={...findCardAlignment(new Float32Array(INPUT_SIZE*INPUT_SIZE*3),[]),scores:[{id:'luffy',score:.95}],margin:.2} as Parameters<typeof confirmCardNumber>[3];
 assert.equal(confirmCardNumber(wrong,[1,0],[wrong,uta],alignment,'ウタ\nOP05-120'),null);
});

test('an image-only result keeps the source price as a reference without confirming the photographed edition',()=>{
 const source={...card,price:{amount:20000,currency:'KRW',type:'LISTED',source:'KREAM',observedAt:new Date().toISOString()}};
 const result=artworkReference(source);
 assert.equal(result.matchLevel,'card');assert.equal(result.price,null);assert.equal(result.artworkSpecific,false);
 assert.deepEqual(result.prices,[]);
 assert.equal(result.valuations?.[0]?.referenceKind,'other_printing');assert.equal(result.valuations?.[0]?.amount,20000);
 assert.equal(source.price.amount,20000);
});

test('looks up only complete unambiguous OCR collector numbers without requiring a prepared catalog', () => {
 assert.equal(scannerLookupNumber('SV4a 347/190 SAR'), 'SV4A347-190');
 assert.equal(scannerLookupNumber('SV2a173/165'), 'SV2A173-165');
 assert.equal(scannerLookupNumber('093 / 071'), '093-071');
 assert.equal(scannerLookupNumber('０９３／０７１'), '093-071');
 assert.equal(scannerLookupNumber('093/071 093/071'), '093-071');
 assert.equal(scannerLookupNumber('093/071 347/190'), null);
 assert.equal(scannerLookupNumber('HP 180 60 50'), null);
 assert.equal(scannerLookupNumber('000/190'), null);
 assert.equal(scannerLookupNumber('SV8a 237／I87 UR'), 'SV8A237-187');
 assert.equal(scannerLookupNumber('237 | 187'), '237-187');
 assert.equal(scannerLookupNumber('093⁄07I'), '093-071');
 assert.equal(scannerLookupNumber('BOI/ILL'), null);
 assert.equal(scannerLookupNumber('237/187 093/071'), null);
 const reference={card:{...card,number:'SV8A237-187'},vector:[1,0]};
 assert.equal(matchCardNumber('ＳＶ８ａ 237/I87', [reference]),reference);
});

test('uses native rectified RGB in channel order and rejects truncated or malformed pixels',()=>{
 const bytes=Buffer.alloc(224*224*3);bytes.set([0,128,255]);bytes.set([255,0,128],bytes.length-3);
 const input=decodeCardRgb(bytes.toString('base64'));
 assert.equal(input[0],0);assert.equal(input[2],1);assert.ok(Math.abs(input[1]-128/255)<1e-6);
 assert.equal(input.at(-3),1);assert.equal(input.at(-2),0);
 assert.throws(()=>decodeCardRgb(bytes.subarray(0,-3).toString('base64')));
 assert.throws(()=>decodeCardRgb('!'.repeat(bytes.length/3*4)));
});

test('accepts perspective card corners in preview order and rejects crossed, mirrored or invalid outlines',()=>{
 const points=[{x:.2,y:.1},{x:.8,y:.2},{x:.75,y:.85},{x:.25,y:.9}];
 assert.deepEqual(cardQuad(points),points);
 assert.equal(cardQuad([points[0],points[2],points[1],points[3]]),null);
 assert.equal(cardQuad(points.toReversed()),null);
 assert.equal(cardQuad([{x:NaN,y:0},...points.slice(1)]),null);
 assert.equal(cardQuad([{x:-.01,y:.1},...points.slice(1)]),null);
 assert.equal(cardQuad(null),null);
 assert.equal(cardQuad([{x:0,y:0},{x:.01,y:0},{x:.01,y:.01},{x:0,y:.01}]),null);
});


test('bootstraps only an unambiguous textured image by exact catalog ID including legacy numbers',()=>{
 const input=new Float32Array(INPUT_SIZE**2*3);
 for(let y=0;y<INPUT_SIZE;y++)for(let x=0;x<INPUT_SIZE;x++)input.set([.5+.4*Math.sin(x/11+y/9),.5+.4*Math.cos(y/13),.5+.4*Math.cos(x/17-y/21)],(y*INPUT_SIZE+x)*3);
 const fingerprint=scanFingerprint(input),a={id:'kream:667702',number:'NO112',...fingerprint};
 assert.equal(findIndexHint(input,[a,a])?.id,a.id);
 assert.equal(findIndexHint(input,[a,{...a,id:'kream:667703'}]),null);
 assert.equal(findIndexHint(new Float32Array(input.length).fill(.5),[a]),null);
 assert.equal(parseScannerIndex({version:2,cards:[a]}).length,1);
 assert.throws(()=>parseScannerIndex({version:1,cards:[a]}));
 assert.throws(()=>parseScannerIndex({version:2,cards:[{...a,hash:'invalid'}]}));
 assert.throws(()=>parseScannerIndex({version:2,cards:[{...a,color:[NaN]}]}));
 assert.throws(()=>parseScannerIndex({version:2,cards:[{...a,id:'../../../private'}]}));
});

test('image index hints still need independent model and spatial agreement',()=>{
 const ref={card:{...card,number:'NO112',language:'ja'},vector:[1,0]};
 const hint={id:ref.card.id,distance:.20,margin:.08};
 const alignment={region:ART_REGION,scores:[{id:card.id,score:.72}],margin:.1};
 assert.equal(confirmImageHint(hint,[.7,Math.sqrt(1-.7**2)],[ref],alignment)?.method,'artwork');
 // Camera colour shift may weaken retrieval; independent checks stay required.
 assert.equal(confirmImageHint({...hint,distance:.313,margin:.0249},[.7,Math.sqrt(1-.7**2)],[ref],alignment)?.accepted,true);
 assert.equal(confirmImageHint({...hint,distance:.3401},[1,0],[ref],alignment),null);
 assert.equal(confirmImageHint({...hint,margin:.0199},[1,0],[ref],alignment),null);
 assert.equal(confirmImageHint({...hint,margin:.01},[1,0],[ref],alignment),null);
 assert.equal(confirmImageHint({...hint,distance:.4},[1,0],[ref],alignment),null);
 assert.equal(confirmImageHint(hint,[.59,Math.sqrt(1-.59**2)],[ref],alignment),null);
 assert.equal(confirmImageHint(hint,[1,0],[ref],{...alignment,scores:[{id:card.id,score:.69}]}),null);
 assert.equal(confirmImageHint(hint,[1,0],[ref],null),null);
 assert.equal(confirmImageHint({...hint,id:'kream:667703'},[1,0],[ref],alignment),null);
 assert.equal(parseCatalog({version:1,imageSize:224,cards:[ref.card]}).cards[0].language,'ja');
});
test('matches a Magic fraction to a unique local collector number and keeps conflicting editions ambiguous',()=>{
 const magic={card:{...card,id:'scryfall:goblin',game:'magic',number:'188'},vector:[1,0]};
 assert.equal(matchCardNumber('Illus. Jerry Tirittilli 188/350',[magic]),magic);
 assert.equal(matchCardNumber('188/350',[magic,{...magic,card:{...magic.card,id:'scryfall:other-edition'}}]),null);
 assert.equal(matchCardNumber('188/350',[{...magic,card:{...magic.card,number:'188/351'}}]),null);
 assert.equal(matchCardNumber('SV2a 188/350',[magic]),null);
});

test('bounded top-two lookup preserves duplicate-ID minima and full-ranking ambiguity decisions',()=>{
 const input=new Float32Array(INPUT_SIZE**2*3);
 for(let i=0;i<input.length;i++)input[i]=.5+.4*Math.sin(i/31);
 const f=scanFingerprint(input),base={id:'kream:1',number:'OP01-001',...f};
 const candidates=Array.from({length:150},(_,i)=>({...base,id:`kream:${i+2}`,hash:i.toString(16).padStart(64,'a'),art:(i*13).toString(16).padStart(64,'b'),color:f.color.map(v=>(v+i)%256)}));
 const hamming=(a:string,b:string)=>{let n=0;for(let i=0;i<a.length;i++){let v=parseInt(a[i],16)^parseInt(b[i],16);for(;v;v>>=1)n+=v&1;}return n;};
 const slow=(cards:typeof candidates)=>{const scores=new Map<string,number>();for(const c of cards){const d=.4*hamming(f.hash,c.hash)/256+.45*hamming(f.art,c.art)/256+.15*f.color.reduce((sum,v,i)=>sum+Math.abs(v-c.color[i]),0)/(48*255);scores.set(c.id,Math.min(scores.get(c.id)??1,d));}const ranked=[...scores].sort((a,b)=>a[1]-b[1]);const [id,distance]=ranked[0],margin=(ranked[1]?.[1]??1)-distance;return distance<=.34&&margin>=.02?{id,distance,margin}:null;};
 for(const cards of [[...candidates,base],[base,...candidates,base],[...candidates,base,{...base,id:'kream:2'}],candidates]){
  const expected=slow(cards),actual=findIndexHint(input,cards);assert.equal(actual?.id??null,expected?.id??null);
  if(actual&&expected){assert.ok(Math.abs(actual.distance-expected.distance)<1e-12);assert.ok(Math.abs(actual.margin-expected.margin)<1e-12);}
 }
 assert.equal(parseCatalog({version:1,imageSize:224,cards:[{...card,game:'one_piece',number:'OP01-001'}]}).cards[0].game,'one_piece');
});

test('metadata refresh replaces current evidence immediately and removes a withdrawn card',()=>{
 const previous={card,comparables:[card],similar:[]};
 const refreshed={...card,name:'Updated name',price:null,prices:[],valuations:[]};
 const event={id:card.id,ids:[card.id],confirmed:true,metadataRefresh:true,cardsJson:JSON.stringify([refreshed])};
 assert.equal(nextScannerResults(previous,event,undefined,false).card?.name,'Updated name');
 assert.equal(nextScannerResults(previous,event,undefined,false).card?.price,null);
 assert.equal(nextScannerResults(previous,{...event,id:'',ids:[],confirmed:false},undefined,false).card,null);
});

test('uses the correct English Munkidori ex query overseas without changing Korean titles',()=>{
 assert.equal(scannerMarketName('포켓몬 TCG 이야후 ex RR 테라스탈 페스타 ex (한글판)','US'),'Munkidori ex');
 assert.equal(scannerMarketName('이야후 ex','EU'),'Munkidori ex');
 assert.equal(scannerMarketName('이야후 ex','KR'),'이야후 ex');
 assert.equal(scannerMarketName('Pikachu ex','US'),'Pikachu ex');
});

test('printed YGO set codes and One Piece rarity suffixes preserve collector identity',()=>{
 const ygo={...card,game:'yugioh',number:'89631139',setCode:'LOB-EN001'};
 assert.equal(scannerCardNumber(ygo),'LOB-EN001');
 assert.equal(scannerCardNumber({...ygo,setCode:'LOB'}),'89631139');
 assert.equal(scannerLookupNumber('Blue-Eyes LOB-EN001'),'LOB-EN001');
 assert.equal(matchCardNumber('Blue-Eyes LOB-EN001',[{card:ygo,vector:[1]}])?.card.id,ygo.id);
 for(const suffix of [' SR','SEC',' (R)'])assert.equal(scannerLookupNumber('OP01-120'+suffix),'OP01-120');
 assert.equal(scannerLookupNumber('P-001 L'), 'P-001');
 assert.equal(scannerLookupNumber('OP01-120 SR OP02-120 R'),null);
 const sameNumber=[{card:{...card,id:'first',number:'OP01-120 SR'},vector:[1]},{card:{...card,id:'alternate',number:'OP01-120'},vector:[1]}];
 assert.equal(matchCardNumber('OP01-120',sameNumber),null);
 assert.equal(matchCardNumber('LOB-JP001',[{card:ygo,vector:[1]}]),null);
});

test('50394ea collector formats preserve complete regional and promo codes',()=>{
 for(const [text,expected] of [['ST23 / 001 SR','ST23-001'],['RD / KP01 - JP001','RD/KP01-JP001'],['LOB-K001','LOB-K001'],['DP27-JPS01','DP27-JPS01']])assert.equal(scannerLookupNumber(text),expected);
 assert.equal(scannerLookupNumber('DP27-JP005 DP27-KR005'),null);
 assert.equal(scannerCardNumber({...card,game:'yugioh',number:'005',setCode:'DP27-JP'}),'DP27-JP005');
 const a={card:{...card,number:'ST23-001-SR-P'},vector:[1]},b={card:{...card,id:'alternate',number:'ST23-001'},vector:[1]};
 assert.equal(matchCardNumber('ST23-001 SR',[a]),a);assert.equal(matchCardNumber('ST23-001',[a,b]),null);
});

test('preserves promo prefixes and retrieves short names despite a contradictory number',()=>{
 for(const number of ['227/S-P','1001/XY-P','12/ADV-P','19/PCG-P'])assert.equal(scannerLookupNumber(number),'PROMO'+number.replace('/','-'));
 assert.equal(scannerLookupNumber('Mewtwo V SWSH229'),'SWSH229');
 assert.equal(scannerLookupNumber('S8a-P 014/025'),'S8A-P014-025');
 assert.equal(scannerLookupNumber('SM12 001/103'),'SM12001-103');
 const uta={card:{...card,id:'uta',name:'ウタ',number:'OP02-120'},vector:[]};
 const mew={card:{...card,id:'mew',name:'Mew'},vector:[]};
 assert.deepEqual(matchCardNames('ウタ\nOP05-120',[uta,mew]),[uta]);
 assert.equal(matchCardNumber('ウタ\nOP05-120',[uta,mew]),null);
 assert.deepEqual(matchCardNames('Mewtwo V\nSWSH229',[mew]),[]);
 assert.deepEqual(matchCardNames('',[uta,mew]),[]);
 const wrong={card:{...card,id:'luffy',name:'モンキー・D・ルフィ',number:'OP05-120'},vector:[1,0]};
 const alignment={...findCardAlignment(new Float32Array(INPUT_SIZE*INPUT_SIZE*3),[]),scores:[{id:'luffy',score:.95}],margin:.2} as Parameters<typeof confirmCardNumber>[3];
 assert.equal(confirmCardNumber(wrong,[1,0],[wrong,uta],alignment,'ウタ\nOP05-120'),null);
});

test('an image-only result keeps the source price as a reference without confirming the photographed edition',()=>{
 const source={...card,price:{amount:20000,currency:'KRW',type:'LISTED',source:'KREAM',observedAt:new Date().toISOString()}};
 const result=artworkReference(source);
 assert.equal(result.matchLevel,'card');assert.equal(result.price,null);assert.equal(result.artworkSpecific,false);
 assert.deepEqual(result.prices,[]);
 assert.equal(result.valuations?.[0]?.referenceKind,'other_printing');assert.equal(result.valuations?.[0]?.amount,20000);
 assert.equal(source.price.amount,20000);
});
