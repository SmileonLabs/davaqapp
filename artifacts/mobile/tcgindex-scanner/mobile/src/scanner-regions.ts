import {ART_REGION,findCardAlignment,matchCardNumber,MIN_SCORE,type CardAlignment,type Reference} from './scanner.ts';
import {findIndexCandidates,type IndexCard} from './scanner-index.ts';
import {cardQuad,type CardQuad} from './card-detection.ts';

export function chooseScanRegion<T extends {pixels:Float32Array;source?:string}>(regions:readonly T[],index:readonly IndexCard[],getReferences:(hints:ReturnType<typeof findIndexCandidates>,text:string)=>Reference[],text:string){
 const retrieved=regions.map(region=>{
  const ranked=findIndexCandidates(region.pixels,index),first=ranked[0];
  const hint=first&&first.distance<=.34&&first.margin>=.02?first:null;
  const reading=hint?'':text,references=getReferences(ranked,reading),numbered=matchCardNumber(reading,references);
  return {region,ranked,first,hint,references,numbered,retrieval:hint?1-first!.distance:-(first?.distance??1)+(region.source==='guide'?.001:0)};
 }).sort((a,b)=>b.retrieval-a.retrieval);
 // Limit expensive spatial searches; all regions still participate in retrieval.
 const choices=retrieved.slice(0,2).map(choice=>{
  const {region,ranked,first,hint,references,numbered}=choice;
  const alignment=findCardAlignment(region.pixels,references,hint||numbered ? .70:MIN_SCORE);
  const hintId=hint?.id.startsWith('catalog:')?hint.id.slice(8):hint?.id;
  const visual=alignment&&(alignment.scores[0].id===(numbered?.card.id??hintId)||alignment.scores[0].score>=MIN_SCORE);
  return {region,ranked,hint,references,alignment,quality:visual?2+alignment!.scores[0].score-(first?.distance??1)*.1:hint?1-first!.distance:-(first?.distance??1)};
 });
 return choices.sort((a,b)=>b.quality-a.quality)[0]??null;
}

// Convert the matched artwork's location back to the complete card, then map
// that rectangle through the camera crop's perspective into preview space.
export function alignedCardQuad(quad:CardQuad,alignment:CardAlignment):CardQuad{
 const r=alignment.region,w=r.width/ART_REGION.width,h=r.height/ART_REGION.height;
 const left=r.left-w*ART_REGION.left,top=r.top-h*ART_REGION.top;
 const [a,b,c,d]=quad,dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x,dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
 const determinant=dx1*dy2-dx2*dy1;
 const g=Math.abs(determinant)>1e-9?(dx3*dy2-dx2*dy3)/determinant:0,hp=Math.abs(determinant)>1e-9?(dx1*dy3-dx3*dy1)/determinant:0;
 const project=(u:number,v:number)=>{const denominator=g*u+hp*v+1;return{x:Math.max(0,Math.min(1,((b.x-a.x+g*b.x)*u+(d.x-a.x+hp*d.x)*v+a.x)/denominator)),y:Math.max(0,Math.min(1,((b.y-a.y+g*b.y)*u+(d.y-a.y+hp*d.y)*v+a.y)/denominator))};};
 return cardQuad([project(left,top),project(left+w,top),project(left+w,top+h),project(left,top+h)])??quad;
}
