export type CallClock = { callId: string | null; startedAt: number | null };
export function nextCallClock(previous: CallClock, callId: string | null, connected: boolean, now: number): CallClock {
  if (!callId) return { callId: null, startedAt: null };
  if (previous.callId !== callId) return { callId, startedAt: connected ? now : null };
  return previous.startedAt === null && connected ? { callId, startedAt: now } : previous;
}
export function formatCallDuration(seconds: number): string {
  const value=Math.max(0,Math.floor(seconds));
  return value>=3600 ? `${Math.floor(value/3600)}:${String(Math.floor(value/60)%60).padStart(2,'0')}:${String(value%60).padStart(2,'0')}` : `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
}
export function callPrimaryStatus(mode: string, recovery: string, connected: boolean, duration: string): string {
  if(mode==='outgoing')return '전화 거는 중';
  if(mode==='joining')return '연결 중';
  if(mode==='incoming')return '전화가 왔어요';
  if(recovery!=='none')return `다시 연결 중 · ${duration}`;
  return connected ? `통화 중 · ${duration}` : '상대방 연결 대기 중';
}
export function callEndLabel(reason:string):string {
 return ({declined:'통화를 받지 않았어요',missed:'부재중 전화',cancelled:'취소된 통화',failed:'연결이 끊겼어요',ended:'통화가 끝났어요'} as Record<string,string>)[reason]??'통화가 끝났어요';
}
export function cameraAllowed(media:string, withCamera:boolean):boolean {return media==='video'&&withCamera;}
export function clampCallPosition(x:number,y:number,width:number,height:number,boxWidth:number,boxHeight:number){return {x:Math.min(Math.max(0,x),Math.max(0,width-boxWidth)),y:Math.min(Math.max(0,y),Math.max(0,height-boxHeight))};}

// Auth-provider IDs are not database participant IDs. An unknown owner must
// never offer a retry to an unverified participant (including the caller itself).
export function callPeerId(call:{callerId:string;calleeId:string},ownerId?:string):string {
 if(ownerId===call.callerId)return call.calleeId;
 if(ownerId===call.calleeId)return call.callerId;
 return '';
}
