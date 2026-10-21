/** A partial read cannot determine unread count from sequence distance (own/deleted rows exist). */
export function projectRoomRead<T extends {id:string;lastMessageSeq?:number;unreadCount?:number;firstUnreadMessageId?:string|null}>(room:T,roomId:string,readThrough:number):T {
 if(room.id!==roomId || !Number.isSafeInteger(readThrough) || readThrough<0 ||
    !Number.isSafeInteger(room.lastMessageSeq) || readThrough<room.lastMessageSeq!)return room;
 return room.unreadCount===0&&room.firstUnreadMessageId==null?room:{...room,unreadCount:0,firstUnreadMessageId:null};
}
