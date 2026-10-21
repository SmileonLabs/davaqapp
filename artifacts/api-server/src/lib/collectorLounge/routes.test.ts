vi.mock('./reading',()=>({getReadingDigest:async()=>({day:'2026-10-20',items:[],sources:[],market:{state:'unavailable'}})}));
import { beforeAll, beforeEach, afterAll, vi, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
const st = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", () => {
  const query = async (q: string, a?: unknown[]) =>
    q.includes("pg_advisory") ? { rows: [] } : await st.db.query(q, a);
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.dbUser = { id: req.headers.authorization, email: "admin@test.local" };
    next();
  },
}));
vi.mock("../adminRbac", () => ({
  hasAdminAccess: async () => false,
  hasAdminRole: async (id: string) =>
    id === "11111111-1111-4111-8111-111111111111",
}));
vi.mock("../knowledge/validation", () => ({ isKnowledgeAdmin: () => false }));
vi.mock("../characterProfiles", () => ({
  resolveCharacterProfileActor: async (id: string) => ({ id }),
}));
vi.mock("../rateLimit", () => ({
  rateLimit: () => (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../knowledgeGraph/core", () => ({
  upsertGraphTenant: vi.fn(),
  upsertEntity: vi.fn(),
  upsertClaim: vi.fn(),
}));
import router from "../../routes/collectorLounge";
import { LOUNGE_ID } from "./policy";
const app = express();
app.use(express.json(), router);
const admin = "11111111-1111-4111-8111-111111111111",
  user = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  st.db = new PGlite();
  await st.db.exec(`
CREATE TABLE users(id uuid PRIMARY KEY,clerk_id text,email text,nickname text,status_message text,notification_enabled bool,talk_analysis_enabled bool);
CREATE TABLE official_ai_accounts(id uuid PRIMARY KEY,slug text UNIQUE,display_name text,account_kind text,status text,description text,official_user_id uuid,knowledge_tenant_id text,persona_json jsonb,published_at timestamptz);
CREATE TABLE character_profiles(id uuid PRIMARY KEY,owner_user_id uuid,type text,handle text,display_name text,status_message text,status text,metadata jsonb);
CREATE TABLE official_ai_character_profiles(profile_id uuid PRIMARY KEY,official_ai_account_id uuid);
CREATE TABLE active_character_profiles(user_id uuid PRIMARY KEY,active_profile_id uuid,last_star_profile_id uuid);
CREATE TABLE chat_rooms(id uuid PRIMARY KEY,type text,category text,visibility text,name text,owner_id uuid);
CREATE TABLE chat_room_members(id uuid DEFAULT gen_random_uuid(),room_id uuid,user_id uuid,profile_id uuid,muted bool,hidden_at timestamptz);
CREATE TABLE messages(id uuid,room_id uuid,sender_id uuid,author_kind text,metadata jsonb,content text,created_at timestamptz,deleted_at timestamptz,room_seq int);
CREATE TABLE friendships(id uuid DEFAULT gen_random_uuid(),user_a_id uuid,user_b_id uuid);
CREATE TABLE blocked_users(id uuid DEFAULT gen_random_uuid(),blocker_user_id uuid,blocked_user_id uuid);
`);
  await st.db.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/drizzle/0048_collector_lounge.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await st.db.exec(await readFile(new URL("../../../../../lib/db/drizzle/0049_collector_presentation.sql",import.meta.url),"utf8"));
  await st.db.exec(await readFile(new URL("../../../../../lib/db/drizzle/0050_collector_direct.sql",import.meta.url),"utf8"));
  await st.db.exec("ALTER TABLE chat_rooms ALTER COLUMN id SET DEFAULT gen_random_uuid()");
});
beforeEach(async () => {
  vi.stubEnv("COLLECTOR_LOUNGE_ENABLED", "true");
  await st.db.exec(
    "TRUNCATE collector_direct_chats,friendships,blocked_users,collector_lounge_runs,collector_lounges,messages,chat_room_members,chat_rooms,active_character_profiles,official_ai_character_profiles,character_profiles,official_ai_accounts,users CASCADE",
  );
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await st.db.close();
});
it("requires admin provisioning and creates one official room idempotently", async () => {
  expect(
    (
      await request(app)
        .post("/admin/collector-lounge/provision")
        .set("Authorization", user)
    ).status,
  ).toBe(403);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await request(app)
          .post("/admin/collector-lounge/provision")
          .set("Authorization", admin)
      ).status,
    ).toBe(200);
  expect((await st.db.query("SELECT * FROM chat_rooms")).rows).toHaveLength(1);
  expect(
    (await st.db.query("SELECT * FROM chat_room_members")).rows,
  ).toHaveLength(3);
  expect(
    (await st.db.query("SELECT category FROM chat_rooms")).rows[0].category,
  ).toBe("collector_ai");
});
it("public discovery is independent of membership; joining needs login and notice", async () => {
  await request(app)
    .post("/admin/collector-lounge/provision")
    .set("Authorization", admin);
  const q = await request(app).get("/collector-lounge");
  expect(q.body.available).toBe(true);
  expect(q.body.name).toBe("수집AI수다방");
  expect(q.body.presentation.readingEnabled).toBe(true);
  expect(q.body).not.toHaveProperty("lease_token");
  expect((await request(app).post("/collector-lounge/join")).status).toBe(401);
  expect(
    (
      await request(app)
        .post("/collector-lounge/join")
        .set("Authorization", user)
    ).status,
  ).toBe(400);
  for (let i = 0; i < 2; i++) {
    expect(
      (
        await request(app)
          .post("/collector-lounge/join")
          .set("Authorization", user)
          .send({ acknowledgePublicAi: true })
      ).body.roomId,
    ).toBe(LOUNGE_ID);
  }
  expect(
    (
      await st.db.query("SELECT * FROM chat_room_members WHERE user_id=$1", [
        user,
      ])
    ).rows,
  ).toHaveLength(1);
});
it("only returns AI preview, never human or deleted messages", async () => {
  await request(app)
    .post("/admin/collector-lounge/provision")
    .set("Authorization", admin);
  await st.db.query(
    `INSERT INTO messages(id,room_id,sender_id,author_kind,content,metadata,room_seq,created_at) SELECT gen_random_uuid(),$1,id,'user','private-looking human text','{}',1,now() FROM users LIMIT 1`,
    [LOUNGE_ID],
  );
  expect((await request(app).get("/collector-lounge")).body.preview).toEqual(
    [],
  );
});
it("only admins change remote labels and empty labels hide without changing worker settings",async()=>{
 await request(app).post("/admin/collector-lounge/provision").set("Authorization",admin);
 const path="/admin/collector-lounge/presentation";
 expect((await request(app).patch(path).set("Authorization",user).send({messageLabel:"hello"})).status).toBe(403);
 expect((await request(app).patch(path).set("Authorization",admin).send({messageLabel:"카드 친구"})).status).toBe(200);
 expect((await request(app).get("/collector-lounge")).body.presentation.messageLabel).toBe("카드 친구");
 expect((await st.db.query("SELECT paused FROM collector_lounges")).rows[0].paused).toBe(true);
 await request(app).patch(path).set("Authorization",admin).send({messageLabel:"  "});
 expect((await request(app).get("/collector-lounge")).body.presentation.messageLabel).toBeNull();
 expect((await request(app).patch(path).set("Authorization",admin).send({messageLabel:"x".repeat(81)})).status).toBe(400);
});
it("registers an AI friend immediately once and prevents blocked registration",async()=>{
 await request(app).post("/admin/collector-lounge/provision").set("Authorization",admin);
 const path="/collector-lounge/characters/00000000-0000-4000-8000-00000000c101";
 expect((await request(app).post(path+"/friend")).status).toBe(401);
 for(let i=0;i<2;i++)expect((await request(app).post(path+"/friend").set("Authorization",user)).status).toBe(200);
 expect((await st.db.query("SELECT * FROM friendships")).rows).toHaveLength(1);
 expect((await request(app).get(path+"/relationship").set("Authorization",user)).body.isFriend).toBe(true);
 await st.db.query("INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",[user,"00000000-0000-4000-8000-00000000c101"]);
 expect((await request(app).post(path+"/friend").set("Authorization",user)).status).toBe(403);
});
it("requires AI notice and reuses a private two-member profile-scoped room",async()=>{
 await request(app).post("/admin/collector-lounge/provision").set("Authorization",admin);
 await st.db.query("INSERT INTO users(id) VALUES($1)",[user]);
 const path="/collector-lounge/characters/00000000-0000-4000-8000-00000000c101/chat";
 expect((await request(app).post(path).set("Authorization",user).send({})).status).toBe(400);
 const a=await request(app).post(path).set("Authorization",user).send({acknowledgeAiProcessing:true});
 const b=await request(app).post(path).set("Authorization",user).send({acknowledgeAiProcessing:true});
 expect(a.status).toBe(200);expect(b.body.roomId).toBe(a.body.roomId);
 expect((await st.db.query("SELECT * FROM collector_direct_chats")).rows).toHaveLength(1);
 expect((await st.db.query("SELECT * FROM chat_room_members WHERE room_id=$1",[a.body.roomId])).rows).toHaveLength(2);
});

it('serves only the public reading digest and disables it with the lounge',async()=>{expect((await request(app).get('/collector-lounge/reading')).body).toMatchObject({day:'2026-10-20',market:{state:'unavailable'}});vi.stubEnv('COLLECTOR_LOUNGE_ENABLED','false');expect((await request(app).get('/collector-lounge/reading')).status).toBe(404);});
