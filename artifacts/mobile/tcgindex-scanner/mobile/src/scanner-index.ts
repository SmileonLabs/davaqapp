import {fingerprintFromPixels,type ImageFingerprint} from '../../web/src/lib/card-image-fingerprint.ts';
import {INPUT_SIZE} from './scanner.ts';
export type IndexCard=ImageFingerprint&{id:string;number:string;card?:{referenceId?:string}};
export type IndexHint={id:string;number:string;distance:number;margin:number};
// Keep the full discovery index even while only some local feature parts are ready.
export function mergeScannerIndex(discovery:readonly IndexCard[],local:readonly IndexCard[]):IndexCard[]{
 const cards=new Map(discovery.map(c=>[c.id,c]));for(const c of local)cards.set(c.id,c);
 // An approved photo and its linked catalog picture are references to one image,
 // not competing card identities. Keep independent editions in the ranking.
 return [...cards.values()].filter(c=>{const reference=c.card?.referenceId;return !reference||!cards.has('catalog:'+reference);});
}
const packed=new WeakMap<object,{id:string;number:string;hash:Uint8Array;art:Uint8Array;color:number[]}[]>();
const pop=Uint8Array.from({length:256},(_,v)=>{let n=0;for(;v;v>>=1)n+=v&1;return n;});
const bytes=(hex:string)=>Uint8Array.from({length:32},(_,i)=>parseInt(hex.slice(i*2,i*2+2),16));

export function parseScannerIndex(value:unknown):IndexCard[]{
 const v=value as {version?:number;cards?:IndexCard[]};
 if(v?.version!==2||!Array.isArray(v.cards)||v.cards.length>50000)throw Error('카드 그림 색인 형식이 올바르지 않습니다.');
 return v.cards.map(c=>{
  if(!/^kream:[1-9]\d{0,14}$/.test(c.id)||typeof c.number!=='string'||c.number.length>120||/[\x00-\x1f]/.test(c.number)||!/^[a-f0-9]{64}$/.test(c.hash)||!/^[a-f0-9]{64}$/.test(c.art)||!Array.isArray(c.color)||c.color.length!==48||!c.color.every(v=>Number.isFinite(v)&&v>=0&&v<=255))throw Error('카드 그림 색인 값이 올바르지 않습니다.');
  return c;
 });
}
export function scanFingerprint(input:Float32Array):ImageFingerprint {
 if(input.length!==INPUT_SIZE**2*3)throw Error('카드 그림 크기가 올바르지 않습니다.');
 function sample(w:number,h:number,channels:number,region={left:0,top:0,width:1,height:1}){
  const result=new Uint8Array(w*h*channels);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const fromX=Math.floor((region.left+x/w*region.width)*INPUT_SIZE),toX=Math.min(INPUT_SIZE,Math.ceil((region.left+(x+1)/w*region.width)*INPUT_SIZE));
   const fromY=Math.floor((region.top+y/h*region.height)*INPUT_SIZE),toY=Math.min(INPUT_SIZE,Math.ceil((region.top+(y+1)/h*region.height)*INPUT_SIZE));
   const color=[0,0,0];let count=0;
   for(let yy=fromY;yy<toY;yy++)for(let xx=fromX;xx<toX;xx++){const p=(yy*INPUT_SIZE+xx)*3;for(let c=0;c<3;c++)color[c]!+=input[p+c]!*255;count++;}
   if(channels===1)result[y*w+x]=Math.round((color[0]!*.2126+color[1]!*.7152+color[2]!*.0722)/count);
   else for(let c=0;c<3;c++)result[(y*w+x)*3+c]=Math.round(color[c]!/count);
  }
  return result;
 }
 return fingerprintFromPixels(sample(17,16,1),sample(17,16,1,{left:13/252,top:42/352,width:226/252,height:197/352}),sample(4,4,3));
}
export function findIndexCandidates(input:Float32Array,cards:readonly IndexCard[],limit=3):IndexHint[] {
 if(!cards.length)return [];
 // Quantization can give a uniform field spurious one-bit edges.
 let sum=0,squares=0,samples=0;
 for(let i=0;i<input.length;i+=997){sum+=input[i]!;squares+=input[i]!*input[i]!;samples++;}
 if(squares/samples-(sum/samples)**2<.0001)return [];
 const f=scanFingerprint(input);
 // Flat backgrounds have an empty edge signature and cannot bootstrap a card.
 if(f.art==='0'.repeat(64)||f.art==='f'.repeat(64))return [];
 let prepared=packed.get(cards);
 if(!prepared){prepared=cards.map(c=>({id:c.id,number:c.number,hash:bytes(c.hash),art:bytes(c.art),color:c.color}));packed.set(cards,prepared);}
 const hash=bytes(f.hash),art=bytes(f.art);
 const leaders:{card:typeof prepared[number];distance:number}[]=[];
 const count=Math.max(2,Math.min(4,limit));
 for(const c of prepared){
  let full=0,picture=0,color=0;
  for(let i=0;i<32;i++){full+=pop[hash[i]!^c.hash[i]!]!;picture+=pop[art[i]!^c.art[i]!]!;}
  // Colour is nonnegative: candidates already worse than both leaders cannot win.
  if(leaders.length===count&&.4*full/256+.45*picture/256>=leaders.at(-1)!.distance)continue;
  for(let i=0;i<48;i++)color+=Math.abs(f.color[i]!-c.color[i]!);
  const d=.4*full/256+.45*picture/256+.15*color/(48*255);
  const old=leaders.findIndex(v=>v.card.id===c.id);
  if(old>=0){if(d>=leaders[old]!.distance)continue;leaders.splice(old,1);}
  const at=leaders.findIndex(v=>d<v.distance);
  leaders.splice(at<0?leaders.length:at,0,{card:c,distance:d});
  if(leaders.length>count)leaders.pop();
 }
 return leaders.slice(0,limit).map((v,i)=>({id:v.card.id,number:cards.find(c=>c.id===v.card.id)!.number,distance:v.distance,margin:(leaders[i+1]!?.distance??1)-v.distance}));
}
export function findIndexHint(input:Float32Array,cards:readonly IndexCard[]):IndexHint|null {
 const first=findIndexCandidates(input,cards,2)[0];
 // This retrieves a reference; model, spatial and consecutive-frame checks
 // still decide recognition. Camera colour/moire must not block retrieval.
 return first&&first.distance<=.34&&first.margin>=.02?first:null;
}
