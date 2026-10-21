let connected=false;
const listeners=new Set<()=>void>();
export const getChatRealtimeConnected=()=>connected;
export function setChatRealtimeConnected(next:boolean){if(connected===next)return;connected=next;listeners.forEach(fn=>fn());}
export function subscribeChatRealtimeStatus(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export const chatMessagePollInterval=(live:boolean)=>live?60_000:5_000;
export const chatRoomListPollInterval=(live:boolean)=>live?180_000:30_000;
