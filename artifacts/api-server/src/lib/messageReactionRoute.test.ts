import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
const members = pgTable("reaction_members", {
  id: uuid("id").defaultRandom(),
  roomId: uuid("room_id"),
  userId: uuid("user_id"),
});
const messages = pgTable("reaction_messages", {
  id: uuid("id").primaryKey(),
  roomId: uuid("room_id"),
  deletedAt: timestamp("deleted_at"),
});
const stickers = pgTable(
  "reaction_stickers",
  {
    messageId: uuid("message_id"),
    userId: uuid("user_id"),
    code: text("code"),
    createdAt: timestamp("created_at"),
  },
  (t) => [unique().on(t.messageId, t.userId)],
);
const room = "00000000-0000-4000-8000-000000000001",
  mid = "00000000-0000-4000-8000-000000000002",
  user = "00000000-0000-4000-8000-000000000003",
  other = "00000000-0000-4000-8000-000000000004";
let client: PGlite, handler: (req: any, res: any) => Promise<void>;
const publish = vi.fn(async () => {});
beforeAll(async () => {
  client = new PGlite();
  await client.exec(`CREATE TABLE reaction_members(id uuid DEFAULT gen_random_uuid(),room_id uuid,user_id uuid);
    CREATE TABLE reaction_messages(id uuid PRIMARY KEY,room_id uuid,deleted_at timestamp);
    CREATE TABLE reaction_stickers(message_id uuid,user_id uuid,code text,created_at timestamp,UNIQUE(message_id,user_id));`);
  const source = readFileSync(
    new URL("../routes/messages.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    'router.post(\n  "/rooms/:id/messages/:messageId/sticker"',
  );
  const end = source.indexOf("router.patch(", start);
  expect(start).toBeGreaterThan(0);
  const js = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  new Function(
    "router",
    "requireAuth",
    "db",
    "chatRoomMembersTable",
    "messagesTable",
    "messageStickersTable",
    "and",
    "eq",
    "isValidStickerCode",
    "publishRoomRealtimeEvent",
    js,
  )(
    {
      post: (...args: any[]) => {
        handler = args.at(-1);
      },
    },
    () => {},
    drizzle(client),
    members,
    messages,
    stickers,
    and,
    eq,
    (code: string) => /^[a-z0-9_]+$/.test(code),
    publish,
  );
}, 30000);
afterAll(async () => client?.close());
beforeEach(async () => {
  publish.mockClear();
  await client.exec(`TRUNCATE reaction_members,reaction_messages,reaction_stickers;
    INSERT INTO reaction_members(room_id,user_id) VALUES('${room}','${user}'),('${room}','${other}');
    INSERT INTO reaction_messages(id,room_id) VALUES('${mid}','${room}');`);
});
async function request(body: any, actor = user, messageId = mid) {
  let status = 200;
  const res = {
    status: (value: number) => {
      status = value;
      return res;
    },
    json: () => res,
    sendStatus: (value: number) => {
      status = value;
      return res;
    },
  };
  await handler(
    {
      dbUser: { id: actor },
      params: { id: room, messageId },
      body,
      log: { error: vi.fn() },
    },
    res,
  );
  return status;
}
it("replaces one reaction per user, preserves other users, removes explicitly and tolerates retry", async () => {
  expect(await request({ code: "heart" })).toBe(204);
  await request({ code: "heart" }, other);
  await request({ code: "thumb" });
  expect(
    (await client.query("SELECT * FROM reaction_stickers")).rows,
  ).toHaveLength(2);
  await request({ code: "heart", remove: true }); // stale removal must not remove newer thumb
  expect(
    (
      await client.query(
        "SELECT code FROM reaction_stickers WHERE user_id=$1",
        [user],
      )
    ).rows,
  ).toEqual([{ code: "thumb" }]);
  await request({ code: "thumb", remove: true });
  await request({ code: "thumb", remove: true });
  expect(
    (await client.query("SELECT user_id,code FROM reaction_stickers")).rows,
  ).toEqual([{ user_id: other, code: "heart" }]);
});
it("keeps legacy add requests idempotent and rejects malformed removal", async () => {
  await request({ code: "heart" });
  await request({ code: "heart" });
  expect(
    (await client.query("SELECT * FROM reaction_stickers")).rows,
  ).toHaveLength(1);
  expect(await request({ code: "heart", remove: "yes" })).toBe(400);
  expect(await request({ code: "<invalid>" })).toBe(400);
});
it("rejects non-members, missing and deleted messages without changing reactions", async () => {
  expect(
    await request({ code: "heart" }, "00000000-0000-4000-8000-000000000005"),
  ).toBe(403);
  expect(
    await request(
      { code: "heart" },
      user,
      "00000000-0000-4000-8000-000000000006",
    ),
  ).toBe(404);
  await client.exec("UPDATE reaction_messages SET deleted_at=now()");
  expect(await request({ code: "heart", remove: true })).toBe(404);
  expect(
    (await client.query("SELECT * FROM reaction_stickers")).rows,
  ).toHaveLength(0);
  expect(publish).not.toHaveBeenCalled();
});
