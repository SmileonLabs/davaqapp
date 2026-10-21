import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChatHistory,CHAT_HISTORY_RETENTION_MS} from './chatHistoryPolicy.ts';
import {projectRoomRead} from './chatUnreadProjection.ts';
import {canRetryChatOutboxEntry,markChatOutboxFailure,pruneChatOutbox} from './chatOutboxPolicy.ts';
const now=1800000000000;
const snapshot={version:1,userId:'u',profileId:'p',roomId:'r',revision:'200',snapshotRoomSeq:20,savedAt:now,messages:[{id:'m1',roomId:'r',roomSeq:20,content:'test',senderId:'peer',type:'text',authorKind:'user',createdAt:new Date(now).toISOString()}]};
test('history body and revision load as one owner/profile scoped checkpoint',()=>{
 assert.deepEqual(parseChatHistory(JSON.stringify(snapshot),'u','p','r',now),snapshot);
 for(const scope of [['other','p','r'],['u','other','r'],['u','p','other']])assert.equal(parseChatHistory(JSON.stringify(snapshot),...scope,now),null);
 for(const patch of [{messages:[{id:'temp-m',roomId:'r',roomSeq:0}]},{revision:'9223372036854775808'},{snapshotRoomSeq:19},{savedAt:now-CHAT_HISTORY_RETENTION_MS-1}])assert.equal(parseChatHistory(JSON.stringify({...snapshot,...patch}),'u','p','r',now),null);
});
test('read acknowledgement clears a full room badge and preserves a newer unread interval',()=>{
 const room={id:'r',lastMessageSeq:20,unreadCount:3,firstUnreadMessageId:'m18'};
 assert.equal(projectRoomRead(room,'r',19),room);
 assert.equal(projectRoomRead(room,'other',20),room);
 assert.deepEqual(projectRoomRead(room,'r',20),{...room,unreadCount:0,firstUnreadMessageId:null});
});
test('a message survives a multi-day offline interval and retries with its original operation id',()=>{
 const entry={clientMessageId:'m-original',tempId:'temp-m-original',roomId:'r',senderId:'u',senderProfileId:'p',content:'offline',type:'text',replyToMessageId:null,createdAt:now-3*86400000,attempts:25,nextAttemptAt:now-1,deliveryState:'pending',retryable:true};
 assert.equal(pruneChatOutbox([entry],now).length,1);assert.equal(canRetryChatOutboxEntry(entry,now),true);
 assert.equal(markChatOutboxFailure(entry,now,true).deliveryState,'pending');
 const manual={...entry,createdAt:now-10*86400000,retryStartedAt:now,attempts:0};assert.equal(canRetryChatOutboxEntry(manual,now),true);assert.equal(manual.clientMessageId,entry.clientMessageId);
});
