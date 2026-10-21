import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  claimChatDelivery,
  finishChatDelivery,
  deliverOneChatJob,
} from "./chatOutboxStore";
// The feed only uses the supplied database; no production pool is constructed.
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));
import { enqueueMessagePush } from "./chatPushOutbox";
import { messagesTable } from "@workspace/db/schema";
import { readRoomChangePage, parseChangeRevision } from "./chatChangeFeed";
const room = "00000000-0000-4000-8000-000000000001";
const alice = "00000000-0000-4000-8000-000000000002";
const bob = "00000000-0000-4000-8000-000000000003";
const stranger = "00000000-0000-4000-8000-000000000004";
const profile = "00000000-0000-4000-8000-000000000005";
const mid = (i: number) =>
  `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`;

describe("transactional chat change log and delivery recovery (PostgreSQL)", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle>;
  const rows = async (query: string, args?: any[]) =>
    (await client.query<any>(query, args)).rows;
  const seedMessage = async (i: number) =>
    client.query(
      `INSERT INTO messages(id,room_id,sender_id,room_seq,content,client_message_id)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(room_id,sender_id,client_message_id) DO NOTHING`,
      [mid(i), room, alice, i, `message ${i}`, `m-${i}`],
    );
  beforeAll(async () => {
    client = new PGlite();
    database = drizzle(client);
    await client.exec(`
      CREATE TABLE chat_rooms(id uuid PRIMARY KEY, name text, pinned_message_id uuid, visibility text);
      CREATE TABLE chat_room_members(id uuid DEFAULT gen_random_uuid(),room_id uuid REFERENCES chat_rooms(id) ON DELETE CASCADE,
        user_id uuid,profile_id uuid,joined_at timestamptz DEFAULT now(),last_read_message_id uuid,last_read_seq integer DEFAULT 0,
        muted boolean DEFAULT false,hidden_at timestamptz);
      CREATE TABLE messages(id uuid PRIMARY KEY,room_id uuid REFERENCES chat_rooms(id) ON DELETE CASCADE,sender_id uuid,
        sender_profile_id uuid,author_kind text DEFAULT 'user',type text DEFAULT 'text',content text,
        reply_to_message_id uuid,another_me_session_id uuid,call_id uuid,metadata jsonb,client_message_id text,
        deleted_at timestamptz,room_seq integer,created_at timestamptz DEFAULT now(),UNIQUE(room_id,sender_id,client_message_id));
      CREATE TABLE message_deletions(message_id uuid REFERENCES messages(id) ON DELETE CASCADE,user_id uuid);
      CREATE TABLE message_stickers(message_id uuid REFERENCES messages(id) ON DELETE CASCADE,user_id uuid,code text);
      CREATE TABLE message_link_previews(message_id uuid REFERENCES messages(id) ON DELETE CASCADE,title text);
    `);
    await client.exec(
      await readFile(
        new URL(
          "../../../../lib/db/drizzle/0046_chat_change_delivery.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }, 30_000);
  afterAll(async () => {
    await client?.close();
  });
  beforeEach(async () => {
    await client.exec(`TRUNCATE chat_rooms CASCADE; INSERT INTO chat_rooms(id) VALUES('${room}');
      INSERT INTO chat_room_members(room_id,user_id,profile_id) VALUES('${room}','${alice}','${profile}'),('${room}','${bob}',NULL);`);
    await client.exec("DELETE FROM chat_delivery_outbox");
  });

  it("commits messages and recoverable delivery jobs together; rollback leaves neither", async () => {
    await expect(
      client.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO messages(id,room_id,sender_id,room_seq,content) VALUES($1,$2,$3,1,'rollback')`,
          [mid(1), room, alice],
        );
        throw new Error("crash before commit");
      }),
    ).rejects.toThrow("crash before commit");
    expect(await rows("SELECT * FROM messages")).toHaveLength(0);
    expect(await rows("SELECT * FROM chat_delivery_outbox")).toHaveLength(0);
    await seedMessage(1); // Process may die here, before any delivery function.
    expect(await rows("SELECT * FROM messages")).toHaveLength(1);
    expect(await rows("SELECT * FROM chat_delivery_outbox")).toHaveLength(1);
    const sent: string[] = [];
    await deliverOneChatJob(client, async (job) => {
      sent.push(job.id);
    });
    expect(sent).toHaveLength(1);
    expect(await claimChatDelivery(client)).toBeNull();
    expect(
      (await rows("SELECT payload FROM chat_delivery_outbox"))[0].payload,
    ).toEqual({});
  });

  it("a duplicate client operation creates one message, change and realtime job", async () => {
    await seedMessage(1);
    await seedMessage(1);
    expect(await rows("SELECT * FROM messages")).toHaveLength(1);
    expect(
      await rows("SELECT * FROM chat_changes WHERE message_id IS NOT NULL"),
    ).toHaveLength(1);
    expect(await rows("SELECT * FROM chat_delivery_outbox")).toHaveLength(1);
  });

  it("persists a deduplicated per-recipient push job in the message transaction", async () => {
    await database.transaction(async (tx) => {
      const [message] = await tx
        .insert(messagesTable)
        .values({
          id: mid(1),
          roomId: room,
          senderId: alice,
          roomSeq: 1,
          content: "durable push",
        })
        .returning();
      await enqueueMessagePush(tx as any, message, "Alice", "durable push");
      await enqueueMessagePush(tx as any, message, "Alice", "durable push");
    });
    const jobs = await rows(
      "SELECT * FROM chat_delivery_outbox WHERE channel='push'",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].audience_user_id).toBe(bob);
    expect(jobs[0].payload.data.messageId).toBe(mid(1));
    await expect(
      database.transaction(async (tx) => {
        const [message] = await tx
          .insert(messagesTable)
          .values({
            id: mid(2),
            roomId: room,
            senderId: alice,
            roomSeq: 2,
            content: "rollback push",
          })
          .returning();
        await enqueueMessagePush(tx as any, message, "Alice", "rollback push");
        throw new Error("abort push transaction");
      }),
    ).rejects.toThrow("abort push transaction");
    expect(
      await rows("SELECT * FROM chat_delivery_outbox WHERE channel='push'"),
    ).toHaveLength(1);
  });

  it("delivery failure is durable and retries after its backoff", async () => {
    await seedMessage(1);
    await deliverOneChatJob(client, async () => {
      throw new Error("Redis disconnected");
    });
    expect(
      (
        await rows(
          "SELECT delivered_at,attempts,last_error FROM chat_delivery_outbox",
        )
      )[0],
    ).toMatchObject({
      delivered_at: null,
      attempts: 1,
      last_error: "delivery_failed",
    });
    expect(await claimChatDelivery(client)).toBeNull();
    await client.exec(
      "UPDATE chat_delivery_outbox SET available_at = now() - interval '1 second'",
    );
    await deliverOneChatJob(client, async () => {});
    expect(
      (await rows("SELECT delivered_at,attempts FROM chat_delivery_outbox"))[0]
        .attempts,
    ).toBe(2);
    expect(
      (await rows("SELECT delivered_at FROM chat_delivery_outbox"))[0]
        .delivered_at,
    ).not.toBeNull();
  });

  it("a stalled external provider times out without blocking the next durable job", async () => {
    await seedMessage(1);
    await deliverOneChatJob(client, async () => new Promise<void>(() => {}), 5);
    expect(
      (
        await rows(
          "SELECT delivered_at,last_error,lease_until FROM chat_delivery_outbox",
        )
      )[0],
    ).toMatchObject({
      delivered_at: null,
      last_error: "delivery_failed",
      lease_until: null,
    });
    await client.exec(
      "UPDATE chat_delivery_outbox SET available_at=now()-interval '1 second'",
    );
    await deliverOneChatJob(client, async () => {});
    expect(await claimChatDelivery(client)).toBeNull();
  });

  it("a failed DB acknowledgement leaves the claim recoverable after external delivery", async () => {
    await seedMessage(1);
    let delivered = 0;
    const brokenAck = {
      query: async (sql: string, values?: any[]) => {
        if (sql.includes("delivered_at = CASE"))
          throw new Error("DB connection dropped after send");
        return client.query<any>(sql, values);
      },
    };
    await expect(
      deliverOneChatJob(brokenAck, async () => {
        delivered++;
      }),
    ).rejects.toThrow("DB connection dropped");
    expect(delivered).toBe(1);
    expect(
      (await rows("SELECT delivered_at FROM chat_delivery_outbox"))[0]
        .delivered_at,
    ).toBeNull();
    await client.exec(
      "UPDATE chat_delivery_outbox SET lease_until=now()-interval '1 second'",
    );
    await deliverOneChatJob(client, async () => {
      delivered++;
    });
    expect(delivered).toBe(2);
    expect(await claimChatDelivery(client)).toBeNull();
  });

  it("a failed push channel cannot hold up realtime delivery", async () => {
    await seedMessage(1);
    await client.query(
      `INSERT INTO chat_delivery_outbox(dedupe_key,room_id,channel,payload)
      VALUES('blocked-push',$1,'push','{}')`,
      [room],
    );
    await deliverOneChatJob(
      client,
      async () => {
        throw new Error("push outage");
      },
      10,
      "push",
    );
    await deliverOneChatJob(
      client,
      async (job) => {
        expect(job.channel).toBe("realtime");
      },
      10,
      "realtime",
    );
    const jobs = await rows(
      "SELECT channel,delivered_at FROM chat_delivery_outbox ORDER BY channel",
    );
    expect(jobs.find((job) => job.channel === "push").delivered_at).toBeNull();
    expect(
      jobs.find((job) => job.channel === "realtime").delivered_at,
    ).not.toBeNull();
  });

  it("recovers expired crash leases and fences a late acknowledgement from the old worker", async () => {
    await seedMessage(1);
    const crashed = (await claimChatDelivery(client))!;
    expect(await claimChatDelivery(client)).toBeNull();
    await client.exec(
      "UPDATE chat_delivery_outbox SET lease_until = now() - interval '1 second'",
    );
    const replacement = (await claimChatDelivery(client))!;
    expect(replacement.claim_token).not.toBe(crashed.claim_token);
    await finishChatDelivery(client, crashed);
    expect(
      (await rows("SELECT delivered_at FROM chat_delivery_outbox"))[0]
        .delivered_at,
    ).toBeNull();
    await finishChatDelivery(client, replacement);
    expect(await claimChatDelivery(client)).toBeNull();
  });

  it("replays when external delivery succeeded but the worker died before acknowledgement", async () => {
    await seedMessage(1);
    const first = (await claimChatDelivery(client))!;
    await client.exec(
      "UPDATE chat_delivery_outbox SET lease_until = now() - interval '1 second'",
    );
    const replay = (await claimChatDelivery(client))!;
    expect(replay.id).toBe(first.id); // Stable event identity, at-least-once delivery.
    await finishChatDelivery(client, replay);
  });

  it("reaction removal commits a recoverable message update and outbox job; rollback preserves reaction", async () => {
    await seedMessage(1);
    await client.query("INSERT INTO message_stickers VALUES($1,$2,'heart')", [mid(1), alice]);
    const before = (await rows("SELECT revision FROM chat_sync_rooms WHERE room_id=$1", [room]))[0].revision;
    await expect(client.transaction(async (tx) => {
      await tx.query("DELETE FROM message_stickers WHERE message_id=$1 AND user_id=$2", [mid(1), alice]);
      throw new Error("crash");
    })).rejects.toThrow("crash");
    expect(await rows("SELECT * FROM message_stickers")).toHaveLength(1);
    await client.query("DELETE FROM message_stickers WHERE message_id=$1 AND user_id=$2", [mid(1), alice]);
    expect(await rows("SELECT * FROM message_stickers")).toHaveLength(0);
    const changes = await rows("SELECT kind,message_id FROM chat_changes WHERE room_id=$1 AND revision>$2", [room,before]);
    expect(changes).toEqual([{kind:"message.updated",message_id:mid(1)}]);
    expect(await rows("SELECT * FROM chat_delivery_outbox WHERE room_id=$1 AND payload->'data'->>'messageId'=$2 AND (payload->'data'->>'changeRevision')::bigint > $3", [room,mid(1),String(before)])).toHaveLength(1);
  });

  it("captures old deletes, personal deletes, reactions, previews, pins and read state", async () => {
    await seedMessage(1);
    const base = (await readRoomChangePage(
      database as any,
      room,
      bob,
      profile,
      null,
    ))!;
    await client.query("UPDATE messages SET deleted_at = now() WHERE id = $1", [
      mid(1),
    ]);
    await client.query("INSERT INTO message_stickers VALUES($1,$2,'heart')", [
      mid(1),
      alice,
    ]);
    await client.query(
      "INSERT INTO message_link_previews VALUES($1,'preview')",
      [mid(1)],
    );
    await client.query("INSERT INTO message_deletions VALUES($1,$2)", [
      mid(1),
      alice,
    ]);
    await client.query(
      "UPDATE chat_room_members SET last_read_seq=1 WHERE room_id=$1 AND user_id=$2",
      [room, alice],
    );
    await client.query(
      "UPDATE chat_rooms SET pinned_message_id=$1 WHERE id=$2",
      [mid(1), room],
    );
    const page = (await readRoomChangePage(
      database as any,
      room,
      bob,
      profile,
      base.revision,
    ))!;
    expect(page.ids).toEqual([mid(1)]);
    expect(page.messages[0].deletedAt).not.toBeNull();
    expect(BigInt(page.revision) - BigInt(base.revision)).toBe(6n);
    expect(
      (
        await rows(
          "SELECT kind FROM chat_changes WHERE revision > $1 ORDER BY revision",
          [base.revision],
        )
      ).map((r) => r.kind),
    ).toEqual([
      "message.updated",
      "message.updated",
      "message.updated",
      "message.updated",
      "message.read",
      "room.updated",
    ]);
  });

  it("paginates a gap beyond 1,000 events and advances past another user's private events", async () => {
    const base = (await readRoomChangePage(
      database as any,
      room,
      bob,
      profile,
      null,
    ))!;
    await client.exec(`INSERT INTO messages(id,room_id,sender_id,room_seq,content)
      SELECT ('00000000-0000-4000-8000-' || lpad((i+100)::text,12,'0'))::uuid,'${room}','${alice}',i,'gap' FROM generate_series(1,1005) i`);
    let cursor = base.revision,
      count = 0,
      pages = 0;
    while (true) {
      const page = (await readRoomChangePage(
        database as any,
        room,
        bob,
        profile,
        cursor,
      ))!;
      count += page.messages.length;
      pages++;
      cursor = page.revision;
      if (!page.hasMore) break;
    }
    expect(count).toBe(1005);
    expect(pages).toBe(6);
    await client.query("INSERT INTO message_deletions VALUES($1,$2)", [
      mid(1),
      alice,
    ]);
    const privatePage = (await readRoomChangePage(
      database as any,
      room,
      bob,
      profile,
      cursor,
    ))!;
    expect(privatePage.ids).toEqual([]);
    expect(BigInt(privatePage.revision)).toBeGreaterThan(BigInt(cursor));
    expect(privatePage.hasMore).toBe(false);
  });

  it("rejects nonmembers and wrong profiles; fresh caches get a bounded snapshot", async () => {
    await seedMessage(1);
    expect(
      await readRoomChangePage(database as any, room, stranger, profile, null),
    ).toBeNull();
    expect(
      await readRoomChangePage(database as any, room, alice, stranger, null),
    ).toBeNull();
    const snapshot = (await readRoomChangePage(
      database as any,
      room,
      alice,
      profile,
      null,
    ))!;
    expect(snapshot.reset).toBe(true);
    expect(snapshot.messages).toHaveLength(1);
    const reset = (await readRoomChangePage(
      database as any,
      room,
      alice,
      profile,
      "999999999999",
    ))!;
    expect(reset.reset).toBe(true);
    for (const value of ["-1", "1.5", "1e3", "9223372036854775808", ["1"]])
      expect(parseChangeRevision(value)).toBeUndefined();
  });

  it("cascading room removal does not recreate events/jobs during deferred capture", async () => {
    await seedMessage(1);
    await client.query("DELETE FROM chat_rooms WHERE id=$1", [room]);
    expect(await rows("SELECT * FROM chat_changes")).toHaveLength(0);
    expect(await rows("SELECT * FROM chat_delivery_outbox")).toHaveLength(0);
  });
});
