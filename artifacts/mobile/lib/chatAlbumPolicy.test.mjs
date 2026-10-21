import assert from 'node:assert/strict';
import test from 'node:test';
import { albumRows, collectChatAlbums } from './chatAlbumPolicy.ts';
import { isChatOutboxEntry, pruneChatOutbox } from './chatOutboxPolicy.ts';
for (const count of [1, 2, 3, 5, 10]) test(`${count} images fill every album row`, () => {
  const rows = albumRows(count);
  assert.equal(rows.reduce((a,b) => a+b, 0), count);
  assert.ok(rows.every(size => size === 1 || size === 2));
  if (count % 2) assert.equal(rows[0], 1);
});
const image = (id, index, overrides={}) => ({ id, senderId: 'a', type: 'image', content: `/objects/${id}`, metadata: {albumId: 'album', albumIndex: index, caption: index === 0 ? 'caption' : undefined}, ...overrides });
test('out of order arrivals preserve selection order and caption', () => {
  const result = collectChatAlbums([image('second',1), image('first',0), image('third',2)]);
  assert.deepEqual(result.albums.get('third').map(item=>item.uri), ['/objects/first','/objects/second','/objects/third']);
  assert.equal(result.captions.get('third'), 'caption');
  assert.deepEqual([...result.hidden], ['first','second']);
});
test('different senders, deleted photos and ungrouped old messages stay separate', () => {
  const result = collectChatAlbums([image('one',0), image('other',1,{senderId:'b'}), image('deleted',2,{deletedAt:'now'}), image('legacy',3,{metadata:null})]);
  assert.equal(result.hidden.size,0);
});
test('partial albums fill actual received count, without waiting for missing uploads', () => {
  const result=collectChatAlbums([image('one',0),image('two',1)]);
  assert.equal(result.albums.get('two').length,2);
});
test('outbox persists thumbnails and album metadata across retry/restart', () => {
  const now=Date.now();
  const entry={clientMessageId:'m-photo-1',tempId:'temp-m-photo-1',roomId:'room',senderId:'user',senderProfileId:null,content:'/objects/photo',type:'image',metadata:{albumId:'album',imageThumbnail:'data:image/jpeg;base64,AA=='},replyToMessageId:null,createdAt:now,attempts:1,nextAttemptAt:now,deliveryState:'pending',retryable:true};
  const restored=JSON.parse(JSON.stringify(entry));
  assert.ok(isChatOutboxEntry(restored));
  assert.deepEqual(pruneChatOutbox([restored],now)[0].metadata,entry.metadata);
});

test('read target uses highest committed sequence while album keeps selection order', () => {
  const result=collectChatAlbums([image('first',0,{roomSeq:23}),image('second',1,{roomSeq:21}),image('third',2,{roomSeq:22})]);
  assert.ok(result.albums.has('first'));
  assert.equal(result.representativeById.get('third'),'first');
  assert.deepEqual(result.albums.get('first').map(item=>item.uri),['/objects/first','/objects/second','/objects/third']);
});

test('failed and pending album photos remain individually visible for retry', () => {
  const result = collectChatAlbums([
    image('committed-one', 0, {roomSeq: 1}),
    image('failed', 1, {_deliveryState: 'failed', clientMessageId: 'retry-id'}),
    image('pending', 2, {_deliveryState: 'pending'}),
    image('temp-awaiting', 3),
    image('committed-two', 4, {roomSeq: 2}),
  ]);
  assert.deepEqual(result.albums.get('committed-two').map(item => item.uri), ['/objects/committed-one', '/objects/committed-two']);
  for (const id of ['failed', 'pending', 'temp-awaiting']) {
    assert.equal(result.hidden.has(id), false);
    assert.equal(result.representativeById.has(id), false);
  }
});
test('retried photo rejoins its album after server acknowledgement', () => {
  const messages = [image('one',0,{roomSeq:1}), image('retry',1,{_deliveryState:'failed'}), image('two',2,{roomSeq:2})];
  assert.equal(collectChatAlbums(messages).hidden.has('retry'), false);
  messages[1] = image('retry',1,{roomSeq:3});
  const result = collectChatAlbums(messages);
  assert.deepEqual(result.albums.get('retry').map(item => item.uri), ['/objects/one','/objects/retry','/objects/two']);
  assert.equal(result.hidden.size,2);
});
test('unchanged album image arrays retain identity while changed thumbnails invalidate them',()=>{
 const messages=[{id:'a',senderId:'u',type:'image',content:'a',roomSeq:1,metadata:{albumId:'x',albumIndex:0}},{id:'b',senderId:'u',type:'image',content:'b',roomSeq:2,metadata:{albumId:'x',albumIndex:1}}];
 const first=collectChatAlbums(messages);const next=collectChatAlbums([...messages,{id:'c',senderId:'u',type:'text',content:'new'}],first);
 assert.equal(next.albums.get('b'),first.albums.get('b'));
 const changed=collectChatAlbums(messages.map(m=>m.id==='a'?{...m,metadata:{...m.metadata,imageThumbnail:'new'}}:m),next);
 assert.notEqual(changed.albums.get('b'),next.albums.get('b'));
});
