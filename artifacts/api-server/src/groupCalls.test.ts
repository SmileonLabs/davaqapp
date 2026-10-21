import express from "express";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
const state = vi.hoisted(() => ({ database: null as any, liveError: null as {code:number} | null }));
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        const value = state.database[key];
        return typeof value === "function" ? value.bind(state.database) : value;
      },
    },
  ),
}));
vi.mock("./lib/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.dbUser = { id: req.headers["x-user"], nickname: "DavaQ tester" };
    next();
  },
}));
vi.mock("./lib/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("./lib/realtime", () => ({
  publishRealtimeEvent: vi.fn(async () => {}),
}));
vi.mock("./lib/push", () => ({
  sendCallPush: vi.fn(async () => {}),
  sendCallTerminalPush: vi.fn(async () => {}),
  incomingCallData: (x: any) => x,
}));
vi.mock("livekit-server-sdk", () => ({
  AccessToken: class {
    addGrant() {}
    async toJwt() {
      return "fixture-token";
    }
  },
  TrackSource: { MICROPHONE: 2, CAMERA: 1 },
  RoomServiceClient: class {
    async removeParticipant() {}
    async deleteRoom() {}
    async listParticipants() {
      if (state.liveError) throw state.liveError;
      return [];
    }
  },
}));
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003",
  roomId = "00000000-0000-4000-8000-000000000004";
describe("DavaQ group-call membership and lifecycle", () => {
  let client: PGlite, server: Server, base: string;
  beforeAll(async () => {
    process.env.LIVEKIT_URL = "wss://fixture.invalid";
    process.env.LIVEKIT_API_KEY = "fixture";
    process.env.LIVEKIT_API_SECRET = "fixture";
    client = new PGlite();
    state.database = drizzle(client);
    await client.exec(`CREATE TABLE users(id uuid PRIMARY KEY,nickname text NOT NULL); CREATE TABLE chat_rooms(id uuid PRIMARY KEY,type text NOT NULL,category text DEFAULT 'casual',visibility text DEFAULT 'private',name text,owner_id uuid,last_message text,last_message_at timestamptz,last_message_seq integer DEFAULT 0,pinned_message_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
  CREATE TABLE chat_room_members(id uuid DEFAULT gen_random_uuid(),room_id uuid,user_id uuid,profile_id uuid,joined_at timestamptz DEFAULT now(),last_read_message_id uuid,last_read_seq integer DEFAULT 0,muted boolean DEFAULT false,hidden_at timestamptz);
  CREATE TABLE blocked_users(id uuid DEFAULT gen_random_uuid(),blocker_user_id uuid,blocked_user_id uuid,created_at timestamptz DEFAULT now());
  CREATE TABLE call_user_locks(user_id uuid PRIMARY KEY,call_id uuid,created_at timestamptz DEFAULT now());`);
    await client.exec(
      await readFile(
        new URL(
          "../../../lib/db/drizzle/0039_davaq_group_calls.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const app = express();
    app.use(express.json());
    app.use("/api", (await import("./routes/groupCalls")).default);
    app.use((err: Error, _req: any, res: any, _next: any) => {
      console.error(err.message);
      res.status(500).json({ error: "fixture failure" });
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("address missing");
    base = `http://127.0.0.1:${address.port}/api`;
  }, 30000);
  beforeEach(async () => {
    state.liveError = null;
    await client.exec(
      `TRUNCATE davaq_group_call_participants,davaq_group_calls,chat_room_members,chat_rooms,blocked_users,call_user_locks,users CASCADE; INSERT INTO users VALUES('${a}','Alice'),('${b}','Bob'),('${outsider}','Other'); INSERT INTO chat_rooms(id,type,name) VALUES('${roomId}','group','Our group'); INSERT INTO chat_room_members(room_id,user_id) VALUES('${roomId}','${a}'),('${roomId}','${b}');`,
    );
  });
  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await client?.close();
  });
  const request = (user: string, path: string, body?: object) =>
    fetch(base + path, {
      headers: { "x-user": user, "Content-Type": "application/json" },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
  const start = async () => {
    const response = await request(a, `/rooms/${roomId}/group-call`, {
      media: "video",
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { call: { id: string } }).call;
  };
  it("invites members, rejects outsiders, and allows multiple participants", async () => {
    const call = await start();
    expect(call.id.startsWith("da7a0001-")).toBe(true);
    expect(
      (await request(outsider, `/group-calls/${call.id}/join`, {})).status,
    ).toBe(404);
    expect((await request(b, `/group-calls/${call.id}/join`, {})).status).toBe(
      200,
    );
    const rows = await client.query(
      "SELECT * FROM davaq_group_call_participants WHERE state='joined'",
    );
    expect(rows.rows).toHaveLength(2);
  });
  it("leaving does not hang up remaining participants, final departure ends the session", async () => {
    const call = await start();
    await request(b, `/group-calls/${call.id}/join`, {});
    expect(
      (
        (await (
          await request(a, `/group-calls/${call.id}/leave`, {})
        ).json()) as { status: string }
      ).status,
    ).toBe("active");
    expect(
      (
        (await (
          await request(b, `/group-calls/${call.id}/leave`, {})
        ).json()) as { status: string }
      ).status,
    ).toBe("ended");
    expect((await request(a, `/group-calls/${call.id}/join`, {})).status).toBe(
      409,
    );
  });
  it("repeated start/join does not create duplicate rooms or participants", async () => {
    const call = await start();
    const replay = await request(a, `/rooms/${roomId}/group-call`, {
      media: "video",
    });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { call: { id: string } }).call.id).toBe(
      call.id,
    );
    await request(b, `/group-calls/${call.id}/join`, {});
    await request(b, `/group-calls/${call.id}/join`, {});
    expect(
      (await client.query("SELECT * FROM davaq_group_call_participants")).rows,
    ).toHaveLength(2);
  });
  it("a late decline cannot disconnect an accepted call", async () => {
    const call = await start();
    await request(b, `/group-calls/${call.id}/join`, {});
    await request(b, `/group-calls/${call.id}/decline`, {});
    const row = await client.query<{ state: string }>(
      "SELECT state FROM davaq_group_call_participants WHERE user_id=$1",
      [b],
    );
    expect(row.rows[0].state).toBe("joined");
  });
  it("block relationships prevent joining the same room", async () => {
    const call = await start();
    await client.query(
      "INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",
      [b, a],
    );
    expect((await request(b, `/group-calls/${call.id}/join`, {})).status).toBe(
      403,
    );
  });
  it("recovers a crashed call and releases joined-user locks", async () => {
    const call = await start();
    state.liveError = { code: 5 };
    await client.query(
      "UPDATE davaq_group_call_participants SET heartbeat_at=now()-interval '3 minutes'",
    );
    await client.query(
      "UPDATE davaq_group_calls SET created_at=now()-interval '3 minutes'",
    );
    await (await import("./routes/groupCalls")).processGroupCallLifecycle();
    const databaseState = await client.query<{ status: string }>(
      "SELECT status FROM davaq_group_calls WHERE id=$1",
      [call.id],
    );
    expect(databaseState.rows[0].status).toBe("ended");
    await start();
  });
  it("LiveKit network failure cannot be mistaken for an empty call", async () => {
    const call = await start(); state.liveError = {code:14};
    await client.query("UPDATE davaq_group_call_participants SET heartbeat_at=now()-interval '3 minutes'");
    await client.query("UPDATE davaq_group_calls SET created_at=now()-interval '3 minutes'");
    await (await import("./routes/groupCalls")).processGroupCallLifecycle();
    const row = await client.query<{status:string}>("SELECT status FROM davaq_group_calls WHERE id=$1",[call.id]); expect(row.rows[0].status).toBe("active");
  });
  it("removes a joined participant whose group membership was revoked", async () => {
    const call = await start();
    await request(b, `/group-calls/${call.id}/join`, {});
    await client.query("DELETE FROM chat_room_members WHERE user_id=$1", [b]);
    await (await import("./routes/groupCalls")).processGroupCallLifecycle();
    const databaseState = await client.query<{ state: string }>(
      "SELECT state FROM davaq_group_call_participants WHERE user_id=$1",
      [b],
    );
    expect(databaseState.rows[0].state).toBe("left");
  });
  it("removed membership and direct-call locks block participation", async () => {
    const call = await start();
    await client.query(
      "INSERT INTO call_user_locks(user_id,call_id) VALUES($1,$2)",
      [b, call.id],
    );
    expect((await request(b, `/group-calls/${call.id}/join`, {})).status).toBe(
      409,
    );
    await client.query("DELETE FROM chat_room_members WHERE user_id=$1", [b]);
    expect((await request(b, `/group-calls/${call.id}`)).status).toBe(404);
  });
});
