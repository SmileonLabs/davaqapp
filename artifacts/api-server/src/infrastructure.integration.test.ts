import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

const runInfrastructureTests = process.env.RUN_INFRA_INTEGRATION === "1";
const dependencies = runInfrastructureTests
  ? {
      ...(await import("@workspace/db")),
      ...(await import("./lib/redis")),
      ...(await import("./lib/rateLimit")),
      ...(await import("./lib/mediaTicket")),
      ...(await import("./routes/storage")),
    }
  : null;

describe("migrated infrastructure", () => {
  if (!runInfrastructureTests) {
    it.skip("requires RUN_INFRA_INTEGRATION=1", () => {});
    return;
  }

  const { pool, closeRedisClients, redisReady, rateLimit, canReadPrivateObject, issueMediaTicket, validateMediaTicket } = dependencies!;

  afterAll(async () => {
    await closeRedisClients();
    await pool.end();
  });

  it("has the migrated core schema and Drizzle ledger", async () => {
    const [{ tableCount }] = (await pool.query<{ tableCount: number }>(`
      SELECT count(*)::int AS "tableCount"
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `)).rows;
    const [{ migrationCount }] = (await pool.query<{ migrationCount: number }>(`
      SELECT count(*)::int AS "migrationCount"
      FROM drizzle.__drizzle_migrations
    `)).rows;
    const [{ exists }] = (await pool.query<{ exists: string | null }>(`
      SELECT to_regclass('public.messages') AS "exists"
    `)).rows;

    expect(tableCount).toBeGreaterThanOrEqual(59);
    expect(migrationCount).toBeGreaterThan(0);
    expect(exists).toBe("messages");
  });

  it("can reach Redis through the production readiness client", async () => {
    await expect(redisReady()).resolves.toBe(true);
  });

  it("enforces a shared Redis rate limit", async () => {
    const middleware = rateLimit({ name: `infra-${Date.now()}`, limit: 1, windowSeconds: 60, requireRedis: true });
    const req = { ip: "127.0.0.9" } as any;
    const makeResponse = () => {
      const response = {
        set: () => response,
        statusCode: 200,
        status(code: number) { response.statusCode = code; return response; },
        json: () => response,
      };
      return response;
    };
    let nextCalls = 0;
    await middleware(req, makeResponse() as any, (() => { nextCalls += 1; }) as any);
    const blocked = makeResponse();
    await middleware(req, blocked as any, (() => { nextCalls += 1; }) as any);
    expect(nextCalls).toBe(1);
    expect(blocked.statusCode).toBe(429);
  });

  it("binds reusable short-lived media tickets to one object path", async () => {
    const objectPath = "/objects/uploads/ticket-test";
    const ticket = await issueMediaTicket("00000000-0000-4000-8000-00000000a001", objectPath);
    await expect(validateMediaTicket(ticket, objectPath)).resolves.toBe(true);
    await expect(validateMediaTicket(ticket, `${objectPath}-other`)).resolves.toBe(false);
  });

  it("allows private chat objects only to room members", async () => {
    const ownerId = "00000000-0000-4000-8000-00000000a001";
    const memberId = "00000000-0000-4000-8000-00000000a002";
    const outsiderId = "00000000-0000-4000-8000-00000000a003";
    const roomId = "00000000-0000-4000-8000-00000000b001";
    const objectPath = "/objects/uploads/00000000-0000-4000-8000-00000000c001";
    await pool.query(`
      INSERT INTO users (id, clerk_id, email, nickname) VALUES
        ($1, 'test:acl-owner', 'acl-owner@example.invalid', 'owner'),
        ($2, 'test:acl-member', 'acl-member@example.invalid', 'member'),
        ($3, 'test:acl-outsider', 'acl-outsider@example.invalid', 'outsider')
    `, [ownerId, memberId, outsiderId]);
    await pool.query("INSERT INTO chat_rooms (id, type, owner_id) VALUES ($1, 'direct', $2)", [roomId, ownerId]);
    await pool.query("INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2), ($1, $3)", [roomId, ownerId, memberId]);
    await pool.query("INSERT INTO messages (room_id, sender_id, type, content, room_seq) VALUES ($1, $2, 'image', $3, 1)", [roomId, ownerId, objectPath]);
    try {
      await expect(canReadPrivateObject(ownerId, objectPath)).resolves.toBe(true);
      await expect(canReadPrivateObject(memberId, objectPath)).resolves.toBe(true);
      await expect(canReadPrivateObject(outsiderId, objectPath)).resolves.toBe(false);
      await pool.query("UPDATE messages SET deleted_at = now() WHERE room_id = $1", [roomId]);
      await expect(canReadPrivateObject(ownerId, objectPath)).resolves.toBe(false);
    } finally {
      await pool.query("DELETE FROM chat_rooms WHERE id = $1", [roomId]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ownerId, memberId, outsiderId]]);
    }
  });

  it("protects exchange images across draft, publication, blocking and proposal access", async () => {
    const [owner, viewer, outsider] = [randomUUID(), randomUUID(), randomUUID()];
    const ids = [owner, viewer, outsider];
    const listingId = randomUUID(), requestedId = randomUUID(), roomId = randomUUID();
    const objectPath = "/objects/private/exchange/" + randomUUID() + ".png";
    try {
      for (const id of ids) await pool.query(
        "INSERT INTO users (id, clerk_id, email, nickname) VALUES ($1,$2,$3,'media test')",
        [id, "test:exchange-media:" + id, id + "@example.invalid"],
      );
      await pool.query("INSERT INTO exchange_media (object_path,owner_id) VALUES ($1,$2)", [objectPath,owner]);
      await expect(canReadPrivateObject(owner,objectPath)).resolves.toBe(true);
      await expect(canReadPrivateObject(viewer,objectPath)).resolves.toBe(false);
      await pool.query("INSERT INTO exchange_listings (id,owner_id,mode,kind,category,title,image_key) VALUES ($1,$2,'offer','service','photo','media test',$3)", [listingId,owner,objectPath]);
      await expect(canReadPrivateObject(viewer,objectPath)).resolves.toBe(false);
      await pool.query("UPDATE exchange_listings SET status='published' WHERE id=$1", [listingId]);
      await expect(canReadPrivateObject(viewer,objectPath)).resolves.toBe(true);
      await pool.query("INSERT INTO blocked_users (blocker_user_id,blocked_user_id) VALUES ($1,$2)", [owner,viewer]);
      await expect(canReadPrivateObject(viewer,objectPath)).resolves.toBe(false);
      await expect(canReadPrivateObject(owner,objectPath)).resolves.toBe(true);
      await pool.query("DELETE FROM blocked_users WHERE blocker_user_id=$1 AND blocked_user_id=$2", [owner,viewer]);
      await pool.query("UPDATE exchange_listings SET status='paused' WHERE id=$1", [listingId]);
      await expect(canReadPrivateObject(viewer,objectPath)).resolves.toBe(false);
      await pool.query("INSERT INTO exchange_listings (id,owner_id,mode,kind,category,title) VALUES ($1,$2,'offer','service','voice','other offer')", [requestedId,viewer]);
      await pool.query("INSERT INTO chat_rooms (id,type,owner_id) VALUES ($1,'direct',$2)", [roomId,owner]);
      await pool.query("INSERT INTO exchange_proposals (proposer_id,recipient_id,offer_id,requested_id,room_id,terms,snapshots) VALUES ($1,$2,$3,$4,$5,'{}','{}')", [owner,viewer,listingId,requestedId,roomId]);
      await expect(canReadPrivateObject(viewer,objectPath)).resolves.toBe(true);
      await expect(canReadPrivateObject(outsider,objectPath)).resolves.toBe(false);
    } finally {
      await pool.query("DELETE FROM exchange_proposals WHERE offer_id=$1", [listingId]);
      await pool.query("DELETE FROM exchange_listings WHERE id=ANY($1::uuid[])", [[listingId,requestedId]]);
      await pool.query("DELETE FROM exchange_media WHERE object_path=$1", [objectPath]);
      await pool.query("DELETE FROM chat_rooms WHERE id=$1", [roomId]);
      await pool.query("DELETE FROM blocked_users WHERE blocker_user_id=ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    }
  });
});
