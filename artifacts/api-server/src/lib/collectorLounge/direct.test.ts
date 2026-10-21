vi.mock('./quality',async importOriginal=>{const actual=await importOriginal<typeof import('./quality')>();return {...actual,checkedCollectorReply:async(o:import('./quality').QualityOptions)=>{const r=await o.draft('');o.onTokens(r.usage?.total_tokens??0);return (await import('./policy')).normalizeCollectorReply(r.choices[0]?.message?.content??'');}};});
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const st = vi.hoisted(() => ({
  db: null as any,
  generate: vi.fn(),
  publish: vi.fn(),
  download:vi.fn(),
  reading:vi.fn(),
}));
vi.mock('./reading',async importOriginal=>({...await importOriginal<typeof import('./reading')>(),getReadingDigest:st.reading}));
vi.mock("../objectStorage",()=>({ObjectStorageService:class {async getObjectEntityFile(p:string){return p;}downloadObject(p:string){return st.download(p);}}}));
vi.mock("@workspace/db", () => {
  const query = async (q: string, a?: unknown[]) =>
    q.includes("pg_advisory") ? { rows: [] } : await st.db.query(q, a);
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("../aiClient", () => ({
  getOpenAI: () => ({ chat: { completions: { create: st.generate } } }),
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../chatDelivery", () => ({
  getRoomDeliveryRecipients: async () => ({
    realtimeUserIds: ["owner"],
    pushUserIds: [],
  }),
}));
vi.mock("../realtime", () => ({ publishRealtimeEvent: st.publish }));
vi.mock("../push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../tcgCatalog", () => ({
  cardId: { safeParse: (v:unknown) => ({ success: typeof v==="string"&&/^kream:\d+$/.test(v),data:v }) },
  resolveCard: vi.fn(),
  tcgRead: vi.fn(),
}));
import { runCollectorDirectTurn } from "./direct";
const owner = "11111111-1111-4111-8111-111111111111",
  actor = "00000000-0000-4000-8000-00000000c101",
  room = "33333333-3333-4333-8333-333333333333",
  other = "44444444-4444-4444-8444-444444444444";
beforeAll(async () => {
  st.db = new PGlite();
  await st.db.exec(await readFile(new URL('../../../../../lib/db/drizzle/0051_collector_ai_budget.sql',import.meta.url),'utf8'));
  await st.db.exec(
    `CREATE TABLE tcg_card_catalog(card_id text PRIMARY KEY,card jsonb,updated_at timestamptz DEFAULT now());CREATE TABLE chat_upload_owners(object_path text,user_id uuid);CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE chat_rooms(id uuid PRIMARY KEY,type text,last_message_seq int,last_message text,last_message_at timestamptz,updated_at timestamptz);CREATE TABLE chat_room_members(room_id uuid,user_id uuid,hidden_at timestamptz);CREATE TABLE blocked_users(blocker_user_id uuid,blocked_user_id uuid);CREATE TABLE messages(id uuid DEFAULT gen_random_uuid(),room_id uuid,sender_id uuid,sender_profile_id uuid,author_kind text,type text,content text,room_seq int,client_message_id text UNIQUE,metadata jsonb,deleted_at timestamptz,created_at timestamptz DEFAULT now());`,
  );
  await st.db.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/drizzle/0050_collector_direct.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
beforeEach(async () => {
  vi.stubEnv("COLLECTOR_LOUNGE_ENABLED", "true");
  await st.db.exec(
    "TRUNCATE collector_ai_spend_daily,tcg_card_catalog,chat_upload_owners,collector_direct_chats,messages,blocked_users,chat_room_members,chat_rooms,users CASCADE",
  );
  await st.db.query("INSERT INTO users(id) VALUES($1),($2)", [owner, actor]);
  await st.db.query(
    "INSERT INTO chat_rooms(id,type,last_message_seq) VALUES($1,'direct',1),($2,'group',1)",
    [room, other],
  );
  await st.db.query(
    "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2),($1,$3)",
    [room, owner, actor],
  );
  await st.db.query(
    "INSERT INTO collector_direct_chats(room_id,owner_id,collector_id) VALUES($1,$2,$3)",
    [room, owner, actor],
  );
  await st.db.query(
    "INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq) VALUES($1,$2,'user','text','내 카드 이야기',1),($3,$2,'user','text','다른 방 비밀 내용',1)",
    [room, owner, other],
  );
  st.reading.mockReset().mockResolvedValue({day:'2026-10-20',checkedAt:new Date().toISOString(),items:[{id:'basics:test',kind:'collector_basics',title:'호가와 실거래가',facts:['호가는 판매자가 내놓은 가격이다.'],url:'https://davaq.app/app/tcg',sourceLabel:'카탈로그 안내',region:'일반',checkedAt:new Date().toISOString()}],market:{state:'unavailable',reason:'거래 통계 없음'},sources:[]});
  st.generate
    .mockReset()
    .mockResolvedValue({
      choices: [
        { message: { content: "어떤 카드인지 이름을 알려줘. 함께 살펴보자." } },
      ],
    });
  st.publish.mockReset();
  st.download.mockReset().mockImplementation(async()=>new Response(new Uint8Array([255,216,255,1,2,3]),{headers:{"content-type":"image/jpeg"}}));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await st.db.close();
});
it("replies only in the private room using only that room's history and never loops", async () => {
  await runCollectorDirectTurn();
  const prompt = JSON.stringify(st.generate.mock.calls[0][0]);
  expect(prompt).toContain("내 카드 이야기");
  expect(prompt).not.toContain("다른 방 비밀 내용");
  const m = (
    await st.db.query("SELECT * FROM messages WHERE author_kind='bot'")
  ).rows;
  expect(m).toHaveLength(1);
  expect(m[0].room_id).toBe(room);
  expect(m[0].room_seq).toBe(2);
  expect(m[0].metadata.privateCollector).toBe(true);
  await runCollectorDirectTurn();
  expect(st.generate).toHaveBeenCalledOnce();
  expect(st.publish).toHaveBeenCalledOnce();
});
it("silences blocked or left rooms before calling the model", async () => {
  await st.db.query("INSERT INTO blocked_users VALUES($1,$2)", [owner, actor]);
  await runCollectorDirectTurn();
  expect(st.generate).not.toHaveBeenCalled();
  await st.db.exec("TRUNCATE blocked_users");
  await st.db.query(
    "UPDATE chat_room_members SET hidden_at=now() WHERE user_id=$1",
    [owner],
  );
  await runCollectorDirectTurn();
  expect(st.generate).not.toHaveBeenCalled();
});
it("drops an obsolete reply if another message arrives during generation", async () => {
  st.generate.mockImplementationOnce(async () => {
    await st.db.query("UPDATE chat_rooms SET last_message_seq=2 WHERE id=$1", [
      room,
    ]);
    return { choices: [{ message: { content: "늦은 답장" } }] };
  });
  await runCollectorDirectTurn();
  expect(
    (await st.db.query("SELECT * FROM messages WHERE author_kind='bot'")).rows,
  ).toHaveLength(0);
  expect(st.publish).not.toHaveBeenCalled();
});
it("enforces per-room daily budget and bounded retries after invalid output", async () => {
  await st.db.exec("UPDATE collector_direct_chats SET daily_calls=20");
  await runCollectorDirectTurn();
  expect(st.generate).not.toHaveBeenCalled();
  await st.db.exec("UPDATE collector_direct_chats SET daily_calls=0");
  st.generate.mockResolvedValue({
    choices: [{ message: { content: "가격은 50만원이야." } }],
  });
  for (let i = 0; i < 4; i++) {
    await st.db.exec("UPDATE collector_direct_chats SET next_at=now()");
    await runCollectorDirectTurn();
  }
  expect(st.generate).toHaveBeenCalledTimes(3);
  expect(
    (await st.db.query("SELECT * FROM messages WHERE author_kind='bot'")).rows,
  ).toHaveLength(0);
});

async function directPhoto(){
 await st.db.query("UPDATE messages SET type='image',content='/objects/chopper.jpg',metadata=$2::jsonb WHERE room_id=$1",[room,JSON.stringify({caption:'이 쵸파 카드 사진 보고 이야기해줘',albumId:'photo'})]);
 await st.db.query("INSERT INTO chat_upload_owners VALUES('/objects/chopper.jpg',$1)",[owner]);
 await st.db.query("INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,$2,'bot','text','OLD_PIKACHU',0,now()-interval '1 hour')",[room,actor]);
}
it('uses the private photo and its caption without mixing older or other-room cards',async()=>{
 await directPhoto();await runCollectorDirectTurn();
 const request=st.generate.mock.calls[0][0];const text=JSON.stringify(request);
 expect(request.messages[1].content.filter((p:any)=>p.type==='image_url')).toHaveLength(1);
 expect(text).toContain('data:image/jpeg;base64,/9j/');expect(text).toContain('이 쵸파 카드 사진');expect(text).not.toContain('OLD_PIKACHU');expect(text).not.toContain('다른 방 비밀 내용');expect(text).not.toContain('/objects/chopper.jpg');
});
it('does not read a private object the sender does not own',async()=>{
 await directPhoto();await st.db.exec('DELETE FROM chat_upload_owners');
 await runCollectorDirectTurn();expect(st.download).not.toHaveBeenCalled();expect(st.generate).not.toHaveBeenCalled();
 const m=(await st.db.query("SELECT content FROM messages WHERE author_kind='bot' AND room_seq=2")).rows[0];expect(m.content).toContain('사진을 제대로 읽지 못했어');
});
it('retains a recent photo for a follow-up question after the initial reply',async()=>{
 await directPhoto();await st.db.query("INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq) VALUES($1,$2,'user','text','이 사진의 카드 이름은?',2)",[room,owner]);await st.db.exec('UPDATE chat_rooms SET last_message_seq=2 WHERE type=\'direct\'');
 await runCollectorDirectTurn();const text=JSON.stringify(st.generate.mock.calls[0][0]);expect(text).toContain('data:image/jpeg;base64,');expect(text).toContain('이 사진의 카드 이름은?');expect(text).not.toContain('OLD_PIKACHU');
});
it('refuses to load a forged image reference from another room',async()=>{
 const {loadCollectorImages}=await import('./images');
 await st.db.query("UPDATE messages SET type='image',content='/objects/other-room.jpg' WHERE room_id=$1",[other]);
 await st.db.query("INSERT INTO chat_upload_owners VALUES('/objects/other-room.jpg',$1)",[owner]);
 await st.db.query('INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2)',[other,owner]);
 const photo=(await st.db.query('SELECT * FROM messages WHERE room_id=$1',[other])).rows[0];
 const image=await loadCollectorImages(room,[photo]);
 expect(image.parts).toEqual([]);expect(st.download).not.toHaveBeenCalled();
});
it('does not send mislabeled non-image data to AI',async()=>{
 await directPhoto();st.download.mockResolvedValue(new Response('<html>not a card</html>',{headers:{'content-type':'image/png'}}));
 await runCollectorDirectTurn();expect(st.generate).not.toHaveBeenCalled();
 expect((await st.db.query("SELECT content FROM messages WHERE room_id=$1 AND room_seq=2",[room])).rows[0].content).toContain('사진을 제대로');
});
it('limits image payload size without falling back to an unrelated card',async()=>{
 await directPhoto();st.download.mockResolvedValue(new Response('too large',{headers:{'content-length':String(11*1024*1024)}}));
 await runCollectorDirectTurn();expect(st.generate).not.toHaveBeenCalled();
});
it('explains an image decoding rejection instead of leaving the member without a reply',async()=>{
 await directPhoto();st.generate.mockRejectedValue(Object.assign(new Error('provider_image_decode'),{status:400}));
 await runCollectorDirectTurn();const m=(await st.db.query("SELECT content FROM messages WHERE room_id=$1 AND room_seq=2",[room])).rows[0];expect(m.content).toContain('사진을 제대로 읽지 못했어');
});

it('provides local public card facts and a source in private replies without exposing collection owners',async()=>{
 await st.db.query("INSERT INTO tcg_card_catalog(card_id,card) VALUES('kream:42',$1::jsonb)",[JSON.stringify({title:'피카츄 001',gameCode:'pokemon',owner:'PRIVATE_OWNER'})]);await st.db.query("UPDATE messages SET content='피카츄 카드 번호 알려줘' WHERE room_id=$1",[room]);
 await runCollectorDirectTurn();const req=JSON.stringify(st.generate.mock.calls[0][0]);expect(req).toContain('피카츄 001');expect(req).not.toContain('PRIVATE_OWNER');const m=(await st.db.query("SELECT content FROM messages WHERE room_id=$1 AND author_kind='bot'",[room])).rows[0];expect(m.content).toContain('id=kream%3A42');
});
it('shares the dollar cap with public AI and preserves the pending private turn for the next Korean day',async()=>{
 await st.db.exec("INSERT INTO collector_ai_spend_daily VALUES((now() AT TIME ZONE 'Asia/Seoul')::date,999999)");
 await runCollectorDirectTurn();expect(st.generate).not.toHaveBeenCalled();
 const d=(await st.db.query('SELECT lease_token,last_processed_seq,attempts,next_at=((now() AT TIME ZONE \'Asia/Seoul\')::date+1)::timestamp AT TIME ZONE \'Asia/Seoul\' AS tomorrow FROM collector_direct_chats')).rows[0];
 expect(d.lease_token).toBeNull();expect(d.last_processed_seq).toBe(0);expect(d.attempts).toBe(0);expect(d.tomorrow).toBe(true);
});

it('answers a private news question from public sources without using another room history',async()=>{await st.db.query("UPDATE messages SET content='최신 원피스 카드 뉴스 알려줘' WHERE room_id=$1",[room]);st.reading.mockResolvedValue({day:'2026-10-20',items:[{id:'news:kr',kind:'official_news',title:'원피스 한국 공지',sourceLabel:'원피스 한국 공식',region:'한국',facts:['한국 공식 공지'],url:'https://onepiece-cardgame.kr/topics.do',checkedAt:new Date().toISOString()}],market:{state:'unavailable'},sources:[]});await runCollectorDirectTurn();const prompt=JSON.stringify(st.generate.mock.calls[0][0]);expect(prompt).toContain('원피스 한국 공지');expect(prompt).not.toContain('다른 방 비밀 내용');expect((await st.db.query("SELECT content FROM messages WHERE author_kind='bot'")).rows[0].content).toContain('onepiece-cardgame.kr');});
