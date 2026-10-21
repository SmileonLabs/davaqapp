export type CardPoint = { x: number; y: number };
export type CardQuad = [CardPoint, CardPoint, CardPoint, CardPoint];

export function initialCardGuide(width:number,height:number):CardQuad {
  const w=Math.min(width*.72,height*.62*.716),h=w/.716,cx=width/2,cy=height*.51;
  return [{x:(cx-w/2)/width,y:(cy-h/2)/height},{x:(cx+w/2)/width,y:(cy-h/2)/height},{x:(cx+w/2)/width,y:(cy+h/2)/height},{x:(cx-w/2)/width,y:(cy+h/2)/height}];
}
export type ScanProgress={quad:CardQuad|null;lastAt:number;elapsed:number};
export const emptyScanProgress=():ScanProgress=>({quad:null,lastAt:0,elapsed:0});
export type QuadTrack={quad:CardQuad|null;velocity:CardQuad|null;at:number;pending:CardQuad|null};
export const emptyQuadTrack=():QuadTrack=>({quad:null,velocity:null,at:0,pending:null});
export function trackCardQuad(state:QuadTrack,next:CardQuad,now:number):QuadTrack {
 if(!state.quad||now-state.at>600||now<=state.at)return{quad:next,velocity:next.map(()=>({x:0,y:0})) as CardQuad,at:now,pending:null};
 const distance=(a:CardQuad,b:CardQuad)=>Math.max(...a.map((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y)));
 const jump=distance(state.quad,next);
 // A one-frame switch to an inner artwork rectangle must not pull in the outline.
 if(jump>.07&&(!state.pending||distance(state.pending,next)>.025))return{...state,pending:next};
 const dt=Math.max(.02,Math.min(.2,(now-state.at)/1000)),alpha=Math.min(.85,Math.max(.25,jump*9));
 const quad=next.map((p,i)=>{const old=state.quad![i];return{x:old.x+(Math.abs(p.x-old.x)<.001?0:(p.x-old.x)*alpha),y:old.y+(Math.abs(p.y-old.y)<.001?0:(p.y-old.y)*alpha)};}) as CardQuad;
 const velocity=quad.map((p,i)=>({x:(p.x-state.quad![i].x)/dt,y:(p.y-state.quad![i].y)/dt})) as CardQuad;
 return{quad,velocity,at:now,pending:null};
}
export function predictedCardQuad(state:QuadTrack):CardQuad|null {
 if(!state.quad)return null;
 const predicted=state.quad.map((p,i)=>({x:Math.max(0,Math.min(1,p.x+Math.max(-.01,Math.min(.01,(state.velocity?.[i].x??0)*.035)))),y:Math.max(0,Math.min(1,p.y+Math.max(-.01,Math.min(.01,(state.velocity?.[i].y??0)*.035))))})) as CardQuad;
 return cardQuad(predicted)??state.quad;
}
// Only clear, continuously observed cards advance the fallback timer.
export function advanceScanProgress(state:ScanProgress,quad:CardQuad|null,clear:boolean,now:number):ScanProgress {
  if(!quad||!clear)return emptyScanProgress();
  const moved=!state.quad||quad.some((p,i)=>Math.hypot(p.x-state.quad![i].x,p.y-state.quad![i].y)>.06);
  if(moved||now-state.lastAt>750||now<state.lastAt)return{quad,lastAt:now,elapsed:0};
  return{quad,lastAt:now,elapsed:state.elapsed+now-state.lastAt};
}
const rgbAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const rgbLookup = new Int16Array(128).fill(-1);
for (let i = 0; i < rgbAlphabet.length; i++) rgbLookup[rgbAlphabet.charCodeAt(i)] = i;

// The native detector returns upright RGB bytes, independent of platform bitmap ordering.
export function decodeCardRgb(encoded: string): Float32Array {
  const bytes = 224 * 224 * 3;
  if (encoded.length !== bytes / 3 * 4) throw new Error('카드 이미지 크기가 올바르지 않습니다.');
  const input = new Float32Array(bytes);
  for (let i = 0, j = 0; i < encoded.length; i += 4) {
    const a=rgbLookup[encoded.charCodeAt(i)]??-1,b=rgbLookup[encoded.charCodeAt(i+1)]??-1;
    const c=rgbLookup[encoded.charCodeAt(i+2)]??-1,d=rgbLookup[encoded.charCodeAt(i+3)]??-1;
    if ((a|b|c|d)<0) throw new Error('카드 이미지 형식이 올바르지 않습니다.');
    input[j++] = ((a << 2) | (b >> 4)) / 255;
    input[j++] = (((b & 15) << 4) | (c >> 2)) / 255;
    input[j++] = (((c & 3) << 6) | d) / 255;
  }
  return input;
}

export function cardQuad(value: unknown): CardQuad | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return null;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = value[i], b = value[(i+1)%4], c = value[(i+2)%4];
    if ((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x) <= 0) return null;
    area += a.x*b.y-b.x*a.y;
  }
  return area >= 0.04 ? value as CardQuad : null;
}
