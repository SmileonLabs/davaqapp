import storage from './chatHistoryStorage';
import { parseChatHistory, CHAT_HISTORY_LIMIT, CHAT_HISTORY_ROOM_LIMIT, type ChatHistorySnapshot } from './chatHistoryPolicy';
const prefix='davaq:chat-history:v1:';
const key=(u:string,p:string,r:string)=>prefix+[u,p,r].map(encodeURIComponent).join(':');
const generations=new Map<string,number>();
const locks=new Map<string,Promise<unknown>>();
function locked<T>(owner:string,fn:()=>Promise<T>):Promise<T> {
 const next=(locks.get(owner)??Promise.resolve()).catch(()=>{}).then(fn);locks.set(owner,next);
 void next.then(()=>{if(locks.get(owner)===next)locks.delete(owner);},()=>{if(locks.get(owner)===next)locks.delete(owner);});return next;
}
export const chatHistoryGeneration=(owner:string)=>generations.get(owner)??0;
export async function loadChatHistory(u:string,p:string,r:string) {
 return locked(u,async()=>parseChatHistory(await storage.getItem(key(u,p,r)),u,p,r));
}
export async function saveChatHistory(snapshot:ChatHistorySnapshot,generation:number) {
 const u=snapshot.userId;
 return locked(u,async()=>{
  if(chatHistoryGeneration(u)!==generation)return;
  const messages=snapshot.messages.filter(m=>!m.id.startsWith('temp-')&&m.roomSeq>0).slice(-CHAT_HISTORY_LIMIT);
  const next={...snapshot,messages};if(!parseChatHistory(JSON.stringify(next),u,next.profileId,next.roomId))return;
  await storage.setItem(key(u,next.profileId,next.roomId),JSON.stringify(next));
  const keys=(await storage.getAllKeys()).filter(k=>k.startsWith(prefix+encodeURIComponent(u)+':'));
  const rows=await Promise.all(keys.map(async k=>{try{return {key:k,time:JSON.parse((await storage.getItem(k))??'{}').savedAt??0};}catch{return{key:k,time:0};}}));
  for(const row of rows.sort((a,b)=>b.time-a.time).slice(CHAT_HISTORY_ROOM_LIMIT))await storage.removeItem(row.key);
 });
}
export async function clearChatHistoryForOwner(owner:string) {
 generations.set(owner,chatHistoryGeneration(owner)+1);
 return locked(owner,async()=>{for(const k of await storage.getAllKeys())if(k.startsWith(prefix+encodeURIComponent(owner)+':'))await storage.removeItem(k);});
}
export async function sweepExpiredChatHistory(now=Date.now()) {
 for(const k of await storage.getAllKeys()) {
  if(!k.startsWith(prefix))continue;
  const parts=k.slice(prefix.length).split(':');if(parts.length!==3)continue;
  let scope:string[];try{scope=parts.map(decodeURIComponent);}catch{continue;}
  await locked(scope[0],async()=>{const raw=await storage.getItem(k);if(!parseChatHistory(raw,scope[0],scope[1],scope[2],now))await storage.removeItem(k);});
 }
}
