// Compact, deterministic image descriptors. These retrieve candidates, never prove a printing.
export type ImageFingerprint = {hash:string;art:string;color:number[]};
const bits=(pixels:Uint8Array,width:number,height:number)=>{
 let out='';for(let y=0;y<height;y++)for(let x=0;x<width-1;x+=4){let n=0;for(let b=0;b<4;b++)n=(n<<1)|Number(pixels[y*width+x+b]!>pixels[y*width+x+b+1]!);out+=n.toString(16);}return out;
};
export function fingerprintFromPixels(full:Uint8Array,art:Uint8Array,rgb:Uint8Array):ImageFingerprint{
 if(full.length!==17*16||art.length!==17*16||rgb.length!==4*4*3)throw Error('Invalid descriptor pixels');
 return {hash:bits(full,17,16),art:bits(art,17,16),color:Array.from(rgb)};
}
const pop=[0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
export function hashDistance(a:string,b:string){if(a.length!==64||b.length!==64)return 1;let n=0;for(let i=0;i<64;i++)n+=pop[parseInt(a[i]!,16)^parseInt(b[i]!,16)]!;return n/256;}
export function fingerprintDistance(a:ImageFingerprint,b:ImageFingerprint){
 const color=a.color.reduce((n,v,i)=>n+Math.abs(v-(b.color[i]??v)),0)/(48*255);
 return .4*hashDistance(a.hash,b.hash)+.45*hashDistance(a.art,b.art)+.15*color;
}
export function fingerprintBands(f:ImageFingerprint){return [f.hash,f.art].flatMap((h,j)=>Array.from({length:16},(_,i)=>`${j}:${i}:${h.slice(i*4,i*4+4)}`));}
