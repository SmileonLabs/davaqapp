/** Fixed window bounds latency under a continuous burst; it is not a sliding debounce. */
export class ChatInvalidationBatch {
 private pending=new Map<string,()=>void>();
 private timer:ReturnType<typeof setTimeout>|null=null;
 private disposed=false;
 private readonly delay:number;
 constructor(delay=150){this.delay=delay;}
 enqueue(key:string,action:()=>void){
  if(this.disposed)return;this.pending.set(key,action);
  if(this.timer===null)this.timer=setTimeout(()=>{this.timer=null;const work=[...this.pending.values()];this.pending.clear();for(const fn of work)fn();},this.delay);
 }
 dispose(){this.disposed=true;if(this.timer!==null)clearTimeout(this.timer);this.timer=null;this.pending.clear();}
}
export class ChatRealtimeEventDeduper {
 private seen=new Map<string,number>();
 accept(type:string,room:string,data:Record<string,unknown>|undefined,now=Date.now()){
  const eventId=typeof data?.eventId==='string'?data.eventId:null;
  const createdId=type==='message.created'&&typeof data?.messageId==='string'?data.messageId:null;
  const keys=[...(eventId?[`event:${eventId}`]:[]),...(createdId?[`created:${room}:${createdId}`]:[])];
  if(keys.some(key=>(this.seen.get(key)??0)>now))return false;
  for(const key of keys){this.seen.delete(key);this.seen.set(key,now+(key.startsWith('created:')?5000:60000));}
  while(this.seen.size>1024)this.seen.delete(this.seen.keys().next().value!);
  return true;
 }
}
