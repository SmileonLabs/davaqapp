import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({ db: null as any, roles: new Map<string, string>(), publish: vi.fn(async () => {}) }));
vi.mock("@workspace/db", () => {
  const query = async (text: string, values?: unknown[]) => {
    const result = await state.db.query(text, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? null };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("./auth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  const id = req.get("authorization")?.replace(/^Bearer /, "");
  if (!state.roles.has(id)) return res.sendStatus(401);
  req.dbUser = { id, email: `${id}@example.com` }; next();
} }));
vi.mock("./rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("./adminRbac", () => ({ hasAdminRole: async (id: string, roles: string[]) => roles.includes(state.roles.get(id)!) }));
vi.mock("./realtime", () => ({ publishRealtimeEvent: state.publish }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import router from "../routes/contentReports";
import { REMOVED_COMMENT } from "./contentReports";
const app = express();
app.use(express.json(), router);
const viewer = "11111111-1111-4111-8111-111111111111";
const author = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const moderator = "44444444-4444-4444-8444-444444444444";
const analyst = "55555555-5555-4555-8555-555555555555";
const room = "66666666-6666-4666-8666-666666666666";
const messageId = "77777777-7777-4777-8777-777777777777";
const commentId = "88888888-8888-4888-8888-888888888888";
const ownMessage = "99999999-9999-4999-8999-999999999999";
let listing: string;
const post = (targetType = "message", targetId = messageId, user = viewer, extra = {}) => request(app).post("/tcg/content-reports").auth(user, { type: "bearer" }).send({ targetType, targetId, reason: "반복적인 괴롭힘입니다.", ...extra });
const review = (id: string, action = "reviewed", user = moderator, status = "resolved") => request(app).patch(`/tcg/admin/content-reports/${id}`).auth(user, { type: "bearer" }).send({ status, action, note: "신고된 원문을 확인한 결과입니다." });
beforeAll(async () => {
  process.env.KNOWLEDGE_ADMIN_USER_IDS = "";
  state.db = new PGlite();
  await state.db.exec(`CREATE TABLE users(id uuid PRIMARY KEY,nickname text,status_message text);
    CREATE TABLE blocked_users(blocker_user_id uuid,blocked_user_id uuid);
    CREATE TABLE chat_rooms(id uuid PRIMARY KEY,last_message_seq integer,last_message text,pinned_message_id uuid,updated_at timestamptz);
    CREATE TABLE chat_room_members(room_id uuid,user_id uuid);
    CREATE TABLE messages(id uuid PRIMARY KEY,room_id uuid,sender_id uuid,author_kind text DEFAULT 'user',type text DEFAULT 'text',content text,metadata jsonb,deleted_at timestamptz,room_seq integer);
    CREATE TABLE message_deletions(message_id uuid,user_id uuid);`);
  for (const filename of ["0040_davaq_tcg.sql", "0043_davaq_tcg_offer_feed.sql", "0044_davaq_tcg_card_feed.sql", "0045_davaq_content_reports.sql"]) {
    await state.db.exec(await readFile(new URL(`../../../../lib/db/drizzle/${filename}`, import.meta.url), "utf8"));
  }
});
beforeEach(async () => {
  await state.db.exec("TRUNCATE users,blocked_users,chat_rooms,chat_room_members,messages,message_deletions,tcg_collection,tcg_listings,tcg_trades,tcg_card_catalog,tcg_listing_comments,tcg_card_comments,davaq_content_reports,davaq_content_report_actions CASCADE");
  state.roles = new Map([[viewer, "member"], [author, "member"], [outsider, "member"], [moderator, "support"], [analyst, "analyst"]]);
  state.publish.mockClear();
  for (const [id, role] of state.roles) await state.db.query("INSERT INTO users(id,nickname,status_message) VALUES($1,$2,'공개 소개')", [id, role]);
  await state.db.query("INSERT INTO chat_rooms VALUES($1,7,'private original',$2,now())", [room, messageId]);
  await state.db.query("INSERT INTO chat_room_members VALUES($1,$2),($1,$3)", [room, viewer, author]);
  await state.db.query("INSERT INTO messages(id,room_id,sender_id,content,room_seq) VALUES($1,$2,$3,'private original',7),($4,$2,$5,'my own message',8)", [messageId, room, author, ownMessage, viewer]);
  const collection = (await state.db.query("INSERT INTO tcg_collection(owner_id,card_id,card_name,quantity,condition,request_key) VALUES($1,'card','sample',1,'NM','fixture') RETURNING id", [author])).rows[0].id;
  listing = (await state.db.query("INSERT INTO tcg_listings(owner_id,collection_id,quantity,mode,delivery,request_key) VALUES($1,$2,1,'gift','meet','fixture') RETURNING id", [author, collection])).rows[0].id;
  await state.db.query("INSERT INTO tcg_card_catalog VALUES('card','{}',now())");
  await state.db.query("INSERT INTO tcg_card_comments(id,card_id,owner_id,body,request_key) VALUES($1,'card',$2,'inappropriate comment','comment-key')", [commentId, author]);
  await state.db.query("INSERT INTO tcg_listing_comments(id,listing_id,owner_id,body,request_key) VALUES($1,$2,$3,'inappropriate comment','comment-key')", [commentId, listing, author]);
});
afterAll(async () => { await state.db.close(); });

describe("DavaQ user-generated content reports", () => {
  it("requires authentication on submission, queue, inspection and review", async () => {
    expect((await request(app).post("/tcg/content-reports").send({})).status).toBe(401);
    expect((await request(app).get("/tcg/admin/content-reports")).status).toBe(401);
    expect((await request(app).get(`/tcg/admin/content-reports/${messageId}`)).status).toBe(401);
    expect((await request(app).patch(`/tcg/admin/content-reports/${messageId}`).send({})).status).toBe(401);
  });
  it("validates target enum, UUID, minimum reason, and rejects injected owner/room fields", async () => {
    for (const extra of [{ targetType: "wallet" }, { targetId: "not-uuid" }, { reason: "   " }, { reason: "😀😀😀" }, { roomId: room }, { targetOwnerId: author }]) expect((await post("message", messageId, viewer, extra)).status).toBe(400);
    expect((await state.db.query("SELECT * FROM davaq_content_reports")).rows).toHaveLength(0);
  });
  it("reports all four real visible types, stores references only and returns a minimal receipt", async () => {
    for (const [type, id] of [["user", author], ["card_comment", commentId], ["listing_comment", commentId], ["message", messageId]]) {
      const result = await post(type, id);
      expect(result.status).toBe(201); expect(result.body).toEqual({ id: expect.any(String), status: "pending" });
    }
    const reports = (await state.db.query("SELECT * FROM davaq_content_reports")).rows;
    expect(reports).toHaveLength(4);
    expect(JSON.stringify(reports)).not.toContain("private original");
    expect(JSON.stringify(reports)).not.toContain("inappropriate comment");
    expect(reports.every((r: any) => r.target_owner_id === author)).toBe(true);
  });
  it("deduplicates pending reports without changing their first evidence reason", async () => {
    const a = await post(); const b = await post("message", messageId, viewer, { reason: "a different valid reason" });
    expect(b.body).toEqual(a.body);
    expect((await state.db.query("SELECT reason FROM davaq_content_reports")).rows).toEqual([{ reason: "반복적인 괴롭힘입니다." }]);
    await expect(state.db.query("INSERT INTO davaq_content_reports(reporter_id,target_type,target_id,target_owner_id,reason) VALUES($1,'message',$2,$3,'duplicate report')", [viewer, messageId, author])).rejects.toMatchObject({ code: "23505" });
  });
  it("hides unknown and private-room targets from outsiders without an existence leak", async () => {
    const privateResult = await post("message", messageId, outsider);
    const unknown = await post("message", crypto.randomUUID(), outsider);
    expect(privateResult.status).toBe(404); expect(privateResult.body).toEqual(unknown.body);
    expect((await state.db.query("SELECT * FROM davaq_content_reports")).rows).toHaveLength(0);
  });
  it("rejects own user, own comment and own message", async () => {
    await state.db.query("UPDATE tcg_card_comments SET owner_id=$1 WHERE id=$2", [viewer, commentId]);
    for (const [type, id] of [["user", viewer], ["card_comment", commentId], ["message", ownMessage]]) expect((await post(type, id)).status).toBe(400);
  });
  it("rejects everyone-deleted, personally deleted and server-generated messages", async () => {
    await state.db.query("UPDATE messages SET deleted_at=now() WHERE id=$1", [messageId]);
    expect((await post()).status).toBe(404);
    await state.db.query("UPDATE messages SET deleted_at=NULL WHERE id=$1", [messageId]);
    await state.db.query("INSERT INTO message_deletions VALUES($1,$2)", [messageId, viewer]);
    expect((await post()).status).toBe(404);
    await state.db.query("DELETE FROM message_deletions");
    await state.db.query("UPDATE messages SET author_kind='system' WHERE id=$1", [messageId]);
    expect((await post()).status).toBe(404);
  });
  it.each([true, false])("applies both directions of blocking to every target (outgoing=%s)", async (outgoing) => {
    await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", outgoing ? [viewer, author] : [author, viewer]);
    for (const [type, id] of [["user", author], ["card_comment", commentId], ["listing_comment", commentId], ["message", messageId]]) expect((await post(type, id)).status).toBe(404);
  });
  it("does not authorize listing comments through a closed listing visible only to its owner", async () => {
    await state.db.query("UPDATE tcg_listings SET status='closed' WHERE id=$1", [listing]);
    expect((await post("listing_comment", commentId)).status).toBe(404);
    // Card-level comments remain public and have their own visibility policy.
    expect((await post("card_comment", commentId)).status).toBe(201);
  });
  it("enforces a persistent twenty-per-hour rate cap while allowing pending duplicates", async () => {
    for (let i = 0; i < 20; i++) await state.db.query("INSERT INTO davaq_content_reports(reporter_id,target_type,target_id,target_owner_id,reason) VALUES($1,'user',$2,$3,'valid reason')", [viewer, crypto.randomUUID(), author]);
    const limited = await post(); expect(limited.status).toBe(429); expect(limited.headers["retry-after"]).toBe("3600");
    await state.db.query("UPDATE davaq_content_reports SET created_at=now()-interval '2 hours'");
    expect((await post()).status).toBe(201); expect((await post()).status).toBe(201);
  });
  it("denies ordinary members and analyst-only admins even inspection of known report IDs", async () => {
    const id = (await post()).body.id;
    for (const user of [viewer, analyst]) {
      expect((await request(app).get("/tcg/admin/content-reports").auth(user, { type: "bearer" })).status).toBe(403);
      expect((await request(app).get(`/tcg/admin/content-reports/${id}`).auth(user, { type: "bearer" })).status).toBe(403);
      expect((await review(id, "reviewed", user)).status).toBe(403);
    }
  });
  it("lists references without private bodies, and separately inspects one reported target only", async () => {
    const id = (await post()).body.id;
    const list = await request(app).get("/tcg/admin/content-reports").auth(moderator, { type: "bearer" });
    expect(list.status).toBe(200); expect(list.headers["cache-control"]).toContain("no-store");
    expect(list.body.items).toHaveLength(1); expect(JSON.stringify(list.body)).not.toContain("private original");
    const detail = await request(app).get(`/tcg/admin/content-reports/${id}`).auth(moderator, { type: "bearer" });
    expect(detail.body.target.body).toBe("private original");
    expect(JSON.stringify(detail.body)).not.toContain("my own message");
    await state.db.query("UPDATE messages SET type='image',content='/objects/private-photo' WHERE id=$1", [messageId]);
    const media = await request(app).get(`/tcg/admin/content-reports/${id}`).auth(moderator, { type: "bearer" });
    expect(JSON.stringify(media.body)).not.toContain("/objects/private-photo");
  });
  it.each(["support", "operations", "super_admin"])("allows the narrowly scoped moderator role %s", async (role) => {
    state.roles.set(moderator, role);
    const id = (await post()).body.id;
    expect((await request(app).get("/tcg/admin/content-reports").auth(moderator, { type: "bearer" })).status).toBe(200);
    expect((await review(id)).status).toBe(200);
  });
  it("records moderator review without changing content, and prevents double processing", async () => {
    const id = (await post()).body.id;
    expect((await review(id)).status).toBe(200); expect((await review(id)).status).toBe(409);
    const record = (await state.db.query("SELECT * FROM davaq_content_reports WHERE id=$1", [id])).rows[0];
    expect(record.status).toBe("resolved"); expect(record.reviewer_id).toBe(moderator); expect(record.reviewed_at).not.toBeNull();
    const events = (await state.db.query("SELECT * FROM davaq_content_report_actions WHERE report_id=$1", [id])).rows;
    expect(events).toHaveLength(1); expect(events[0].action).toBe("reviewed");
    expect((await state.db.query("SELECT deleted_at FROM messages WHERE id=$1", [messageId])).rows[0].deleted_at).toBeNull();
  });
  it("removes a reported message, clears its pinned/last preview and refreshes only that room's members", async () => {
    const id = (await post()).body.id;
    expect((await review(id, "remove_content")).status).toBe(200);
    expect((await state.db.query("SELECT deleted_at FROM messages WHERE id=$1", [messageId])).rows[0].deleted_at).not.toBeNull();
    const updated = (await state.db.query("SELECT * FROM chat_rooms WHERE id=$1", [room])).rows[0];
    expect(updated.last_message).toBe("삭제된 메시지"); expect(updated.pinned_message_id).toBeNull();
    expect(state.publish).toHaveBeenCalledTimes(2);
    for (const [event] of state.publish.mock.calls as any) expect(event.userIds.sort()).toEqual([viewer, author].sort());
  });
  it("tombstones both mirrored comments without releasing their retry keys", async () => {
    const id = (await post("card_comment", commentId)).body.id;
    expect((await review(id, "remove_content")).status).toBe(200);
    for (const table of ["tcg_card_comments", "tcg_listing_comments"]) expect((await state.db.query(`SELECT body,request_key FROM ${table} WHERE id=$1`, [commentId])).rows[0]).toEqual({ body: REMOVED_COMMENT, request_key: "comment-key" });
    expect((await post("listing_comment", commentId)).status).toBe(404);
  });
  it("preserves a newer room preview and another pinned message on content removal", async () => {
    await state.db.query("UPDATE chat_rooms SET last_message_seq=8,last_message='newer message',pinned_message_id=$2 WHERE id=$1", [room, ownMessage]);
    const id = (await post()).body.id;
    expect((await review(id, "remove_content")).status).toBe(200);
    const updated = (await state.db.query("SELECT * FROM chat_rooms WHERE id=$1", [room])).rows[0];
    expect(updated.last_message).toBe("newer message"); expect(updated.pinned_message_id).toBe(ownMessage);
  });
  it("rejects destructive user actions, missing rationale, and dismissal with content removal atomically", async () => {
    const id = (await post("user", author)).body.id;
    expect((await review(id, "remove_content")).status).toBe(400);
    expect((await request(app).patch(`/tcg/admin/content-reports/${id}`).auth(moderator, { type: "bearer" }).send({ status: "resolved", action: "reviewed", note: "x" })).status).toBe(400);
    expect((await review(id, "remove_content", moderator, "dismissed")).status).toBe(400);
    expect((await state.db.query("SELECT status FROM davaq_content_reports WHERE id=$1", [id])).rows[0].status).toBe("pending");
    expect((await state.db.query("SELECT * FROM davaq_content_report_actions")).rows).toHaveLength(0);
    expect((await review(id, "reviewed", moderator, "dismissed")).status).toBe(200);
    expect((await state.db.query("SELECT action FROM davaq_content_report_actions")).rows[0].action).toBe("dismissed");
  });
});
