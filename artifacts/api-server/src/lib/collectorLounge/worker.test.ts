vi.mock('./quality',async importOriginal=>{const actual=await importOriginal<typeof import('./quality')>();return {...actual,checkedCollectorReply:async(o:import('./quality').QualityOptions)=>{const r=await o.draft('');o.onTokens(r.usage?.total_tokens??0);return (await import('./policy')).normalizeCollectorReply(r.choices[0]?.message?.content??'');}};});
import { beforeAll, beforeEach, afterAll, vi, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const state = vi.hoisted(() => ({
  db: null as any,
  generate: vi.fn(),
  decide: vi.fn(),
  publish: vi.fn(),
  topic:vi.fn(),
  download:vi.fn(),
  reading:vi.fn(),
}));
vi.mock('./reading',async importOriginal=>({...await importOriginal<typeof import('./reading')>(),getReadingDigest:state.reading}));
vi.mock("../objectStorage",()=>({ObjectStorageService:class {async getObjectEntityFile(p:string){return p;}downloadObject(p:string){return state.download(p);}}}));
vi.mock("@workspace/db", () => {
  const query = async (text: string, args?: unknown[]) => {
    const r = await state.db.query(text, args);
    return { rows: r.rows, rowCount: r.affectedRows };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("../aiClient", () => ({
  getOpenAI: () => ({ chat: { completions: { create: state.generate } } }),
}));
vi.mock("./topics",()=>({chooseLoungeTopic:state.topic}));
vi.mock("./jev", () => ({ selectCollector: state.decide }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../realtime", () => ({ publishRealtimeEvent: state.publish }));
vi.mock("../chatDelivery", () => ({
  getRoomDeliveryRecipients: async () => ({ realtimeUserIds: ["human"] }),
}));
vi.mock("../knowledgeGraph/core", () => ({
  retrieveApprovedClaimsForPrompt: async () => [],
}));
vi.mock("../knowledgeGraph/client", () => ({
  runKnowledgeGraphRead: async () => null,
  runKnowledgeGraphWrite: async () => null,
}));
vi.mock("../push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../tcgCatalog", () => ({
  upstream:{origin:"https://tcgindex.org"},
  tcgRead: async () => ({ state: "unavailable" }),
  cardId: {
    safeParse: (v: unknown) => ({ success: typeof v === "string", data: v }),
  },
  resolveCard: async () => ({ target: { id: "kream:1" } }),
}));
import { runCollectorLoungeTurn } from "./worker";
import { LOUNGE_ID } from "./policy";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(await readFile(new URL('../../../../../lib/db/drizzle/0051_collector_ai_budget.sql',import.meta.url),'utf8'));
  await state.db.exec(
    `CREATE TABLE tcg_card_catalog(card_id text PRIMARY KEY,card jsonb,updated_at timestamptz DEFAULT now());CREATE TABLE chat_upload_owners(object_path text,user_id uuid);CREATE TABLE chat_room_members(room_id uuid,user_id uuid,hidden_at timestamptz);CREATE TABLE chat_rooms(id uuid PRIMARY KEY,last_message_seq int DEFAULT 0,last_message text,last_message_at timestamptz,updated_at timestamptz); CREATE TABLE messages(id uuid DEFAULT gen_random_uuid(),room_id uuid,sender_id uuid,sender_profile_id uuid,author_kind text,type text,content text,room_seq int,metadata jsonb,client_message_id text UNIQUE,deleted_at timestamptz,created_at timestamptz DEFAULT now());`,
  );
  await state.db.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/drizzle/0048_collector_lounge.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
beforeEach(async () => {
  vi.stubEnv("COLLECTOR_LOUNGE_ENABLED", "true");
  vi.stubEnv("JEV_AI_API_KEY", "test");
  await state.db.exec(
    "TRUNCATE collector_ai_spend_daily,tcg_card_catalog,chat_upload_owners,chat_room_members,collector_lounge_runs,collector_lounges,messages,chat_rooms CASCADE",
  );
  await state.db.query("INSERT INTO chat_rooms(id) VALUES($1)", [LOUNGE_ID]);
  await state.db.query(
    "INSERT INTO collector_lounges(room_id,slug,paused) VALUES($1,'collectors',false)",
    [LOUNGE_ID],
  );
  state.reading.mockReset().mockResolvedValue({day:'2026-10-20',checkedAt:new Date().toISOString(),items:[{id:'basics:test',kind:'collector_basics',title:'호가와 실거래가',facts:['호가는 판매자가 내놓은 가격이다.'],url:'https://davaq.app/app/tcg',sourceLabel:'카탈로그 안내',region:'일반',checkedAt:new Date().toISOString()}],market:{state:'unavailable',reason:'거래 통계 없음'},sources:[]});
  state.generate.mockReset().mockResolvedValue({
    choices: [{ message: { content: "어떤 그림의 카드를 가장 좋아하세요?" } }],
    usage:{total_tokens:600},
  });
  state.decide
    .mockReset()
    .mockResolvedValue({ speaker: "art", inputTokens: 400 });
  state.publish.mockReset();
  state.topic.mockReset().mockResolvedValue(null);
  state.download.mockReset().mockImplementation(async()=>new Response(new Uint8Array([255,216,255,1,2,3]),{headers:{"content-type":"image/jpeg"}}));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await state.db.close();
});
async function human() {
 await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'11111111-1111-4111-8111-111111111111','user','text','質問あるよ',1,now()-interval '20 seconds')`,[LOUNGE_ID]);
 await state.db.exec('UPDATE chat_rooms SET last_message_seq=1');
}
it("publishes one sequenced AI message and records usage", async () => {
  await runCollectorLoungeTurn();
  const m = (await state.db.query("SELECT * FROM messages")).rows;
  expect(m).toHaveLength(1);
  expect(m[0].author_kind).toBe("bot");
  expect(m[0].room_seq).toBe(1);
  const l = (await state.db.query("SELECT * FROM collector_lounges")).rows[0];
  expect(l.daily_calls).toBe(1);
  expect(l.daily_tokens).toBe(600);
  expect(state.decide).not.toHaveBeenCalled();
  expect(l.lease_token).toBeNull();
  expect(state.publish).toHaveBeenCalledOnce();
});
it("does not call paid services while paused or at budget", async () => {
  await state.db.exec("UPDATE collector_lounges SET paused=true");
  await runCollectorLoungeTurn();
  expect(state.decide).not.toHaveBeenCalled();
  await state.db.exec(
    "UPDATE collector_lounges SET paused=false,daily_calls=daily_limit",
  );
  await runCollectorLoungeTurn();
  expect(state.decide).not.toHaveBeenCalled();
});
it("drops generated reply when a new message arrives", async () => {
  state.generate.mockImplementation(async () => {
    await state.db.exec("UPDATE chat_rooms SET last_message_seq=1");
    return { choices: [{ message: { content: "늦은 답변" } }] };
  });
  await runCollectorLoungeTurn();
  expect((await state.db.query("SELECT * FROM messages")).rows).toHaveLength(0);
  expect(
    (await state.db.query("SELECT status FROM collector_lounge_runs")).rows[0]
      .status,
  ).toBe("superseded");
});
it("responds to a new member without a routing gate or Jev key", async () => {
  await human();vi.stubEnv('JEV_AI_API_KEY','');
  state.decide.mockResolvedValue({speaker:null,inputTokens:350});
  await runCollectorLoungeTurn();
  expect(state.decide).not.toHaveBeenCalled();expect(state.generate).toHaveBeenCalledOnce();
  expect((await state.db.query('SELECT status FROM collector_lounge_runs')).rows[0].status).toBe('sent');
});
it("provider failure keeps bounded budget reservation and backs off", async () => {
  await human();
  state.generate.mockRejectedValue(new Error("provider_failed"));
  await runCollectorLoungeTurn();
  expect(state.generate).toHaveBeenCalledOnce();
  const l = (await state.db.query("SELECT * FROM collector_lounges")).rows[0];
  expect(l.lease_token).toBeNull();
  expect(l.daily_calls).toBe(1);
  expect(l.daily_tokens).toBe(24000);
});

it("paces autonomous turns but answers a new human without waiting 1 hour", async () => {
  await runCollectorLoungeTurn();
  const pacing = (await state.db.query("SELECT extract(epoch FROM (next_at-now()))::float8 AS seconds FROM collector_lounges")).rows[0];
  expect(Number(pacing.seconds)).toBeGreaterThan(3590);
  expect(Number(pacing.seconds)).toBeLessThanOrEqual(3600);
  await state.db.exec("UPDATE messages SET created_at=now()-interval '20 seconds'");
  await runCollectorLoungeTurn();
  expect(state.generate).toHaveBeenCalledTimes(1);
  await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'11111111-1111-4111-8111-111111111111','user','text','저건 누구 카드냐?',2,now()-interval '20 seconds')`, [LOUNGE_ID]);
  await state.db.exec('UPDATE chat_rooms SET last_message_seq=2');
  state.generate.mockResolvedValueOnce({choices:[{message:{content:'공개 카탈로그 카드 예시라 소유자는 알 수 없어.'}}],usage:{total_tokens:600}});
  await runCollectorLoungeTurn();
  expect(state.decide).not.toHaveBeenCalled();
  expect(state.generate).toHaveBeenCalledTimes(2);
  expect((await state.db.query('SELECT daily_tokens FROM collector_lounges')).rows[0].daily_tokens).toBe(1200);
});
it('answers the latest member in a group but respects another worker lease',async()=>{
 await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'11111111-1111-4111-8111-111111111111','user','text','대화1',1,now()-interval '20 seconds'),($1,'22222222-2222-4222-8222-222222222222','user','text','대화2',2,now()-interval '15 seconds')`,[LOUNGE_ID]);await state.db.exec('UPDATE chat_rooms SET last_message_seq=2');await runCollectorLoungeTurn();expect(state.generate).toHaveBeenCalledOnce();
 await state.db.exec("DELETE FROM messages;UPDATE collector_lounges SET next_at=now(),lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'");await runCollectorLoungeTurn();expect(state.generate).toHaveBeenCalledOnce();
});

it('starts an empty lounge with sourced reading instead of a fixed fictional card topic',async()=>{
 await runCollectorLoungeTurn();expect(state.topic).not.toHaveBeenCalled();
 const p=JSON.parse(state.generate.mock.calls[0][0].messages[1].content[0].text);expect(p.topic).toBe('호가와 실거래가');expect(p.readingEvidence.item.id).toBe('basics:test');expect(p.card).toBeNull();
});

it('rotates speakers without a routing call and paces subsequent turns', async () => {
  await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'00000000-0000-4000-8000-00000000c102','bot','text','판본 번호를 같이 보자.',1,now()-interval '30 seconds')`, [LOUNGE_ID]);
  await state.db.exec("UPDATE chat_rooms SET last_message_seq=1;UPDATE collector_lounges SET episode_turns=3,last_topic_at=now()");
  state.decide.mockResolvedValue({speaker:'catalog',inputTokens:400});
  await runCollectorLoungeTurn();
  expect(state.decide).not.toHaveBeenCalled();
  expect(['00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-00000000c103']).toContain((await state.db.query('SELECT sender_id FROM messages ORDER BY room_seq DESC LIMIT 1')).rows[0].sender_id);
  expect((await state.db.query('SELECT episode_turns FROM collector_lounges')).rows[0].episode_turns).toBe(4);
  await state.db.exec("UPDATE messages SET created_at=now()-interval '30 seconds'");
  await runCollectorLoungeTurn();
  expect(state.generate).toHaveBeenCalledTimes(1);
});

it('answers an unanswered human instead of replacing it with a scheduled topic', async () => {
  await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'11111111-1111-4111-8111-111111111111','user','text','저건 누구 카드냐?',1,now()-interval '30 seconds')`, [LOUNGE_ID]);
  await state.db.exec("UPDATE chat_rooms SET last_message_seq=1;UPDATE collector_lounges SET last_processed_seq=0,episode_turns=4,last_topic_at=now()-interval '1 hour'");
  await runCollectorLoungeTurn();
  expect(state.decide).not.toHaveBeenCalled();
  const payload=JSON.parse(state.generate.mock.calls[0][0].messages[1].content[0].text);
  expect(payload.turnGoal).toContain('회원이 방금');
  expect(payload.replyingTo.point).toBe('저건 누구 카드냐?');
  expect(payload.topic).toBeNull();
});

it('continues the conversation after four turns without a forced topic replacement',async()=>{
 await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'00000000-0000-4000-8000-00000000c102','bot','text','퇴근하고 듣기 좋은 노래 이야기',1,now()-interval '30 seconds')`,[LOUNGE_ID]);
 await state.db.exec('UPDATE chat_rooms SET last_message_seq=1;UPDATE collector_lounges SET last_processed_seq=1,episode_turns=4');await runCollectorLoungeTurn();
 expect(state.topic).not.toHaveBeenCalled();const p=JSON.parse(state.generate.mock.calls[0][0].messages[1].content[0].text);expect(p.conversation[0].text).toContain('노래');expect((await state.db.query('SELECT episode_turns FROM collector_lounges')).rows[0].episode_turns).toBe(5);
});

it('respects failure backoff for an already attempted human message',async()=>{
 await human();state.generate.mockRejectedValue(new Error('provider_unavailable'));
 await runCollectorLoungeTurn();await runCollectorLoungeTurn();
 expect(state.generate).toHaveBeenCalledTimes(1);
 expect((await state.db.query('SELECT daily_calls FROM collector_lounges')).rows[0].daily_calls).toBe(1);
});

it('recovers from three failed turns with a fresh topic after a bounded cooldown',async()=>{
 await state.db.query(`INSERT INTO collector_lounge_runs(id,room_id,trigger_seq,status) SELECT gen_random_uuid(),$1,0,'failed' FROM generate_series(1,3)`,[LOUNGE_ID]);
 await runCollectorLoungeTurn();expect(state.generate).not.toHaveBeenCalled();
 expect((await state.db.query('SELECT episode_turns FROM collector_lounges')).rows[0].episode_turns).toBe(4);
 await state.db.exec("UPDATE collector_lounge_runs SET created_at=now()-interval '31 minutes';UPDATE collector_lounges SET next_at=now()");
 await runCollectorLoungeTurn();expect(state.generate).toHaveBeenCalledOnce();
});

async function memberPhoto(){
 await human();
 await state.db.query("UPDATE messages SET type='image',content='/objects/chopper.jpg',metadata=$1::jsonb",[JSON.stringify({caption:'쵸파 카드인데 어떤 부분이 보여?',albumId:'camera-or-gallery',albumTotal:1})]);
 await state.db.query("INSERT INTO chat_upload_owners VALUES('/objects/chopper.jpg','11111111-1111-4111-8111-111111111111')");
 await state.db.query("INSERT INTO chat_room_members(room_id,user_id) VALUES($1,'11111111-1111-4111-8111-111111111111')",[LOUNGE_ID]);
 await state.db.exec("UPDATE collector_lounges SET topic='OLD_PIKACHU',topic_card_id='kream:999'");
}
it('sends the real member photo and caption instead of the old catalog card',async()=>{
 await memberPhoto();
 await state.db.query("INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'00000000-0000-4000-8000-00000000c102','bot','text','OLD_PIKACHU',0,now()-interval '1 hour')",[LOUNGE_ID]);
 await runCollectorLoungeTurn();
 const request=state.generate.mock.calls[0][0];const prompt=JSON.stringify(request);
 expect(request.messages[1].content.filter((p:any)=>p.type==='image_url')).toHaveLength(1);
 expect(prompt).toContain('data:image/jpeg;base64,/9j/');expect(prompt).toContain('쵸파 카드');
 expect(prompt).not.toContain('OLD_PIKACHU');expect(prompt).not.toContain('kream:999');expect(prompt).not.toContain('/objects/chopper.jpg');
 expect(state.decide).not.toHaveBeenCalled();expect(state.reading).not.toHaveBeenCalled();
 const l=(await state.db.query('SELECT * FROM collector_lounges')).rows[0];expect(l.topic_card_id).toBeNull();expect(l.daily_tokens).toBe(600);
});
it('does not silently answer about a catalog card when the member photo cannot be read',async()=>{
 await memberPhoto();state.download.mockRejectedValue(new Error('storage_down'));
 await runCollectorLoungeTurn();expect(state.generate).not.toHaveBeenCalled();
 const m=(await state.db.query("SELECT content FROM messages WHERE author_kind='bot'")).rows[0];expect(m.content).toContain('사진을 제대로 읽지 못했어');expect(m.content).not.toContain('피카츄');
});
it('drops a photo answer if its source was deleted during generation',async()=>{
 await memberPhoto();state.generate.mockImplementation(async()=>{await state.db.exec("UPDATE messages SET deleted_at=now() WHERE type='image'");return {choices:[{message:{content:'사진 답변'}}],usage:{total_tokens:500}};});
 await runCollectorLoungeTurn();expect((await state.db.query("SELECT * FROM messages WHERE author_kind='bot'")).rows).toHaveLength(0);
 expect((await state.db.query('SELECT status FROM collector_lounge_runs')).rows[0].status).toBe('superseded');
});
it('waits briefly for an image album before using its shared caption',async()=>{
 await memberPhoto();await state.db.query("UPDATE messages SET metadata=$1::jsonb,created_at=now()-interval '3 seconds' WHERE type='image'",[JSON.stringify({caption:'두 사진 비교해줘',albumId:'batch',albumIndex:0,albumTotal:2})]);
 await runCollectorLoungeTurn();expect(state.generate).not.toHaveBeenCalled();
 await state.db.exec("UPDATE messages SET created_at=now()-interval '20 seconds'");await runCollectorLoungeTurn();
 expect(state.generate).toHaveBeenCalledOnce();expect(JSON.stringify(state.generate.mock.calls[0][0])).toContain('두 사진 비교해줘');
});

it('grounds a named card question in the public local catalog and stores its source',async()=>{
 await human();
 await state.db.query("INSERT INTO tcg_card_catalog(card_id,card) VALUES('kream:42',$1::jsonb)",[JSON.stringify({title:'피카츄 001',gameCode:'pokemon',amount:123456,owner:'PRIVATE_OWNER'})]);
 await state.db.query("UPDATE messages SET content='피카츄 카드 번호 알려줘',type='text'");
 await runCollectorLoungeTurn();
 const req=JSON.stringify(state.generate.mock.calls[0][0]);expect(req).toContain('피카츄 001');expect(req).not.toContain('PRIVATE_OWNER');expect(req).not.toContain('123456');
 const m=(await state.db.query("SELECT content,metadata FROM messages WHERE author_kind='bot' ORDER BY room_seq DESC LIMIT 1")).rows[0];expect(m.content).toContain('id=kream%3A42');expect(m.metadata.collectorCatalogSourceIds).toEqual(['kream:42']);
});
it('does not reuse an earlier photo or force a card topic when a member switches to daily life',async()=>{
 await memberPhoto();
 const user=(await state.db.query("SELECT sender_id FROM messages WHERE author_kind='user' LIMIT 1")).rows[0].sender_id;
 await state.db.query("INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,$2,'user','text','오늘 퇴근하고 너무 피곤해',2,now()-interval '10 seconds')",[LOUNGE_ID,user]);await state.db.query('UPDATE chat_rooms SET last_message_seq=2');
 await runCollectorLoungeTurn();expect(state.download).not.toHaveBeenCalled();const req=state.generate.mock.calls[0][0];const prompt=JSON.parse(req.messages[1].content[0].text);expect(prompt.card).toBeNull();expect(prompt.catalogEvidence.state).toBe('not_requested');expect(prompt.yourPosition).toContain('자유');
});
it('retains a member rejection after more than forty autonomous messages',async()=>{
 await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'11111111-1111-4111-8111-111111111111','user','text','음악 얘기 그만. 질문하지 마.',1,now()-interval '2 days')`,[LOUNGE_ID]);
 for(let seq=2;seq<=45;seq++)await state.db.query(`INSERT INTO messages(room_id,sender_id,author_kind,type,content,room_seq,created_at) VALUES($1,'00000000-0000-4000-8000-00000000c101','bot','text',$2,$3,now()-interval '1 hour')`,[LOUNGE_ID,'옛 대화 '+seq,seq]);
 await state.db.exec('UPDATE chat_rooms SET last_message_seq=45;UPDATE collector_lounges SET last_processed_seq=45,next_at=now()');
 await runCollectorLoungeTurn();const payload=JSON.parse(state.generate.mock.calls[0][0].messages[1].content[0].text);
 expect(payload.dialogueContext.boundaries.avoidedTopics).toContain('음악');expect(payload.dialogueContext.recent).toHaveLength(12);
});
it('keeps hourly pacing when an autonomous reply is rejected for quality',async()=>{
 state.generate.mockRejectedValue(new Error('collector_quality_skipped'));await runCollectorLoungeTurn();
 const l=(await state.db.query('SELECT extract(epoch FROM (next_at-now()))::float8 AS seconds,lease_token FROM collector_lounges')).rows[0];expect(Number(l.seconds)).toBeGreaterThan(3590);expect(l.lease_token).toBeNull();expect((await state.db.query('SELECT * FROM messages')).rows).toHaveLength(0);
});
it('stops paid lounge calls at the shared dollar cap and releases the lease until the next Korean day',async()=>{
 await human();await state.db.exec("INSERT INTO collector_ai_spend_daily VALUES((now() AT TIME ZONE 'Asia/Seoul')::date,999999)");
 await runCollectorLoungeTurn();expect(state.generate).not.toHaveBeenCalled();
 const l=(await state.db.query('SELECT lease_token,last_processed_seq,next_at=((now() AT TIME ZONE \'Asia/Seoul\')::date+1)::timestamp AT TIME ZONE \'Asia/Seoul\' AS tomorrow FROM collector_lounges')).rows[0];
 expect(l.lease_token).toBeNull();expect(l.last_processed_seq).toBe(0);expect(l.tomorrow).toBe(true);
 expect((await state.db.query('SELECT error_code FROM collector_lounge_runs')).rows[0].error_code).toBe('collector_daily_budget_exhausted');
});

it('responds to member news questions ahead of the hourly slot with grounded public evidence',async()=>{await human();await state.db.exec("UPDATE messages SET content='최신 포켓몬 카드 소식 알려줘'; UPDATE collector_lounges SET next_at=now()+interval '1 hour'");state.reading.mockResolvedValue({day:'2026-10-20',items:[{id:'news:jp',kind:'official_news',title:'포켓몬 일본 공지',sourceLabel:'포켓몬 일본 공식',region:'일본',facts:['일본에서 공개된 공식 소식이다.'],url:'https://www.pokemon-card.com/info/005701.html',checkedAt:new Date().toISOString()}],market:{state:'unavailable'},sources:[]});await runCollectorLoungeTurn();expect(state.generate).toHaveBeenCalledOnce();const payload=JSON.parse(state.generate.mock.calls[0][0].messages[1].content[0].text);expect(payload.memberPending).toBe(true);expect(payload.readingEvidence.item.region).toBe('일본');const m=(await state.db.query("SELECT metadata FROM messages WHERE author_kind='bot'")).rows[0];expect(m.metadata.collectorReadingId).toBe('news:jp');});
it('does not spend a completion on exhausted reading material and keeps hourly pacing',async()=>{state.reading.mockResolvedValue({day:'2026-10-20',items:[],sources:[],market:{state:'unavailable'}});await runCollectorLoungeTurn();expect(state.generate).not.toHaveBeenCalled();const r=(await state.db.query("SELECT extract(epoch FROM(next_at-now())) AS seconds, daily_tokens FROM collector_lounges")).rows[0];expect(Number(r.seconds)).toBeGreaterThan(3500);expect(r.daily_tokens).toBe(0);expect((await state.db.query('SELECT status FROM collector_lounge_runs')).rows[0].status).toBe('skipped');});
