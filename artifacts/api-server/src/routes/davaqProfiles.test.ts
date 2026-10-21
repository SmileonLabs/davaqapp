import { isDefaultCardAvatar, defaultCardAvatar } from "../lib/defaultCardAvatar";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({ db: null as any, calls: [] as string[], fail: false }));
const viewer = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
vi.mock("@workspace/db", () => ({ pool: {
  query: async (sql: string, values?: unknown[]) => {
    state.calls.push(sql);
    if (state.fail) throw new Error("database connection postgres://private-secret");
    const result = await state.db.query(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? null };
  },
} }));
vi.mock("../lib/auth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  const id = req.get("authorization")?.replace("Bearer ", "");
  if (!["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].includes(id)) return res.sendStatus(401);
  req.dbUser = { id };
  next();
} }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../lib/rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: any) => next() }));
import router from "./davaqProfiles";
const app = express().use(router);
const path = (id = owner) => `/tcg/users/${id}/profile`;
const get = (url = path(), actor = viewer) => request(app).get(url).set("Authorization", `Bearer ${actor}`);

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`CREATE TABLE users(id uuid PRIMARY KEY,nickname text,status_message text,created_at timestamptz,
    profile_image_url text,email text,push_token text);
    CREATE TABLE blocked_users(blocker_user_id uuid,blocked_user_id uuid);
    CREATE TABLE chat_rooms(id uuid PRIMARY KEY);
    CREATE TABLE character_profiles(id uuid PRIMARY KEY,owner_user_id uuid REFERENCES users(id),type text,
      profile_image_url text,metadata jsonb,status text,archived_at timestamptz,display_name text,status_message text);
    CREATE TABLE active_character_profiles(user_id uuid PRIMARY KEY REFERENCES users(id),active_profile_id uuid REFERENCES character_profiles(id));`);
  for (const file of ["0040_davaq_tcg.sql", "0041_davaq_tcg_map.sql", "0043_davaq_tcg_offer_feed.sql", "0044_davaq_tcg_card_feed.sql"])
    await state.db.exec(await readFile(new URL(`../../../../lib/db/drizzle/${file}`, import.meta.url), "utf8"));
});
beforeEach(async () => {
  await state.db.exec("TRUNCATE users,blocked_users,tcg_card_catalog CASCADE");
  await state.db.query(`INSERT INTO users VALUES
    ($1,'Viewer',NULL,'2026-01-01Z',NULL,'viewer@private.test','viewer-secret'),
    ($2,'DavaQ nickname','DavaQ introduction','2026-02-03T04:05:06Z','/objects/private-account','owner@private.test','owner-secret'),
    ($3,'Other',NULL,'2026-01-01Z',NULL,'other@private.test','other-secret')`, [viewer, owner, other]);
  state.calls = [];
  state.fail = false;
});
afterAll(async () => { await state.db.close(); });

async function avatar(input: { type?: string; url?: string; source?: string; status?: string; archived?: boolean; profileOwner?: string } = {}) {
  const id = crypto.randomUUID();
  await state.db.query(`INSERT INTO character_profiles VALUES($1,$2,$3,$4,$5,$6,$7,'LEGACY_CHARACTER_NAME','LEGACY_CHARACTER_INTRO')`,
    [id, input.profileOwner ?? owner, input.type ?? "fan", input.url ?? "/objects/public-davaq-avatar",
      JSON.stringify(input.source === undefined ? { avatarSource: "davaq", secret: "PRIVATE_CHARACTER_METADATA" } : { avatarSource: input.source }),
      input.status ?? "active", input.archived ? new Date() : null]);
  await state.db.query("INSERT INTO active_character_profiles VALUES($1,$2)", [owner, id]);
}
async function listing(card: string, mode = "swap", input: { owner?: string; collectionOwner?: string; quantity?: number; reserved?: number; status?: string; listedQuantity?: number } = {}) {
  const id = (await state.db.query(`INSERT INTO tcg_collection(owner_id,card_id,card_name,quantity,reserved,condition,photos,purchase_price,folder,note,request_key)
    VALUES($1,$2,$2,$3,$4,'NM','["/objects/public-card-photo"]',987654,'PRIVATE_FOLDER','PRIVATE_NOTE',$5) RETURNING id`,
    [input.collectionOwner ?? input.owner ?? owner, card, input.quantity ?? 5, input.reserved ?? 0, crypto.randomUUID()])).rows[0].id;
  return (await state.db.query(`INSERT INTO tcg_listings(owner_id,collection_id,quantity,mode,price,delivery,status,request_key)
    VALUES($1,$2,$3,$4,CASE WHEN $4='gift' THEN NULL ELSE 100 END,'meet',$5,$6) RETURNING id`,
    [input.owner ?? owner, id, input.listedQuantity ?? 5, mode, input.status ?? "active", "PRIVATE_REQUEST_" + crypto.randomUUID()])).rows[0].id;
}

describe("DavaQ public profile authentication and privacy", () => {
  it("requires authentication before reading any profile", async () => {
    expect((await request(app).get(path())).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
  it("rejects malformed UUIDs and query/cursor values before querying", async () => {
    for (const url of [path("not-a-uuid"), path() + "?cursor=nope", path() + "?cursor=", path() + "?limit=9999"])
      expect((await get(url)).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it("uses the same not-found result for nonexistent and bilaterally blocked users", async () => {
    const absent = await get(path("44444444-4444-4444-8444-444444444444"));
    expect(absent.status).toBe(404);
    for (const pair of [[viewer, owner], [owner, viewer]]) {
      await state.db.exec("TRUNCATE blocked_users");
      await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", pair);
      const hidden = await get();
      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(absent.body);
    }
  });
  it("returns actual DavaQ account text and only the selected public avatar", async () => {
    await avatar();
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.body).toEqual({ id: owner, nickname: "DavaQ nickname", profileImageUrl: "/objects/public-davaq-avatar",
      statusMessage: "DavaQ introduction", createdAt: "2026-02-03T04:05:06.000Z",
      stats: { publicCards: 0, publicOffers: 0, comments: 0 }, offers: [], nextCursor: null });
    expect(JSON.stringify(result.body)).not.toMatch(/LEGACY_|PRIVATE_|private-account|@private|owner-secret|stars|fan|xp|followers/);
    expect(state.calls.join("\n")).not.toMatch(/SELECT\s+\*|u\.email|u\.push_token/);
  });
  it.each([
    ["STAR", { type: "star" }],
    ["official character", { type: "official_ai" }],
    ["locked character", { status: "locked" }],
    ["archived character", { archived: true }],
    ["different owner's character", { profileOwner: other }],
    ["private account photo", { url: "/objects/private-account" }],
    ["legacy recipe", { url: "anotherme-avatar:v1:{}" }],
    ["external photo", { url: "https://anotherme.example/private.png" }],
    ["unselected old upload", { source: "legacy" }],
  ])("does not publish %s", async (_name, options) => {
    await avatar(options);
    const result = await get();
    expect(result.status).toBe(200);
    expect(isDefaultCardAvatar(result.body.profileImageUrl)).toBe(true);
    expect(result.body.nickname).toBe("DavaQ nickname");
    expect(result.body.statusMessage).toBe("DavaQ introduction");
  });
  it("does not fall back to the private account photo without an active character", async () => {
    expect(isDefaultCardAvatar((await get()).body.profileImageUrl)).toBe(true);
  });
  it("keeps a self profile valid without publishing private collection/history", async () => {
    await state.db.query("INSERT INTO blocked_users VALUES($1,$1)", [owner]);
    const result = await get(path(), owner);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual(["id", "nickname", "profileImageUrl", "statusMessage", "createdAt", "stats", "offers", "nextCursor"].sort());
  });
  it("returns a safe unavailable response on DB failure", async () => {
    state.fail = true;
    const result = await get();
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toMatch(/postgres|secret|database|SELECT/);
  });
});

describe("accurate public card activity", () => {
  it("counts distinct publicly available cards, listings and authored card comments without private inventory", async () => {
    await listing("kream:a");
    await listing("kream:a", "both");
    await listing("kream:b", "gift");
    const sale = await listing("kream:c", "sale", { quantity: 3, reserved: 2 });
    await listing("kream:closed", "swap", { status: "closed" });
    await listing("kream:empty", "swap", { listedQuantity: 0 });
    await listing("kream:reserved", "swap", { reserved: 5 });
    await listing("kream:other", "swap", { owner: other });
    await listing("kream:inconsistent-owner", "swap", { collectionOwner: other });
    await state.db.query(`INSERT INTO tcg_collection(owner_id,card_id,quantity,condition,note,request_key)
      VALUES($1,'PRIVATE_UNLISTED_CARD',100,'NM','PRIVATE_NOTE',$2)`, [owner, crypto.randomUUID()]);
    await state.db.query("INSERT INTO tcg_card_catalog(card_id,card) VALUES('kream:a','{}'),('kream:catalog-only','{}')");
    for (const [actor, card] of [[owner, "kream:a"], [owner, "kream:a"], [owner, "kream:catalog-only"], [other, "kream:a"]])
      await state.db.query("INSERT INTO tcg_card_comments(owner_id,card_id,body,request_key) VALUES($1,$2,'Actual public comment',$3)", [actor, card, crypto.randomUUID()]);
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body.stats).toEqual({ publicCards: 3, publicOffers: 4, comments: 3 });
    expect(result.body.offers).toHaveLength(4);
    expect(result.body.offers.map((item: any) => item.mode).sort()).toEqual(["both", "gift", "sale", "swap"]);
    expect(result.body.offers.find((item: any) => item.id === sale).available).toBe(1);
    for (const offer of result.body.offers) {
      expect(offer.owner_id).toBe(owner);
      expect(offer.owner_name).toBe("DavaQ nickname");
      expect(offer.photos).toEqual(["/objects/public-card-photo"]);
      expect(Object.keys(offer).sort()).toEqual(["id", "owner_id", "owner_name", "collection_id", "card_id", "card_name", "condition", "photos", "quantity", "available", "price", "mode", "wanted_card_ids", "wanted_card_names", "region", "delivery", "description", "status", "version", "map_lat", "map_lng"].sort());
    }
    expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE_|purchase_price|reserved|request_key|trade|snapshot/);
  });
  it("paginates real offers without duplicates or timestamp precision loss and scopes cursors", async () => {
    for (let n = 0; n < 23; n++) {
      const id = await listing("kream:" + n);
      await state.db.query("UPDATE tcg_listings SET created_at='2026-03-01T00:00:00.000123Z' WHERE id=$1", [id]);
    }
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.body.offers).toHaveLength(20);
    expect(first.body.stats).toEqual({ publicCards: 23, publicOffers: 23, comments: 0 });
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const cursor = JSON.parse(Buffer.from(first.body.nextCursor, "base64url").toString());
    expect(cursor.createdAt).toBe("2026-03-01T00:00:00.000123Z");
    const second = await get(path() + "?cursor=" + first.body.nextCursor);
    expect(second.status).toBe(200);
    expect(second.body.offers).toHaveLength(3);
    expect(second.body.nextCursor).toBeNull();
    expect(second.body.stats).toEqual(first.body.stats);
    expect(new Set([...first.body.offers, ...second.body.offers].map((item: any) => item.id)).size).toBe(23);
    expect((await get(path(viewer) + "?cursor=" + first.body.nextCursor)).status).toBe(400);
    expect((await get(path() + "?cursor=" + first.body.nextCursor, owner)).status).toBe(400);
    await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", [owner, viewer]);
    expect((await get(path() + "?cursor=" + first.body.nextCursor)).status).toBe(404);
  });
});

it("keeps the same profile card identity when both account and profile photos are null", async () => {
  await avatar({ source: "" });
  await state.db.query("UPDATE users SET profile_image_url=NULL WHERE id=$1", [owner]);
  await state.db.query("UPDATE character_profiles SET profile_image_url=NULL WHERE owner_user_id=$1", [owner]);
  const id=(await state.db.query("SELECT id FROM character_profiles WHERE owner_user_id=$1",[owner])).rows[0].id;
  const first=await get();
  expect(first.status).toBe(200);
  expect(first.body.profileImageUrl).toBe(defaultCardAvatar(id));
  await state.db.query("UPDATE character_profiles SET display_name='renamed' WHERE id=$1",[id]);
  expect((await get()).body.profileImageUrl).toBe(first.body.profileImageUrl);
});
