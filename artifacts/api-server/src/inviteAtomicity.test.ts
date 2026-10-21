import express from "express";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: null as any, gate: null as null | (() => Promise<void>) }));
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: new Proxy({}, { get: (_target, key) => {
    if (key === "transaction") return async (work: any) => {
      await state.gate?.();
      return state.database.transaction(work);
    };
    const value = state.database[key];
    return typeof value === "function" ? value.bind(state.database) : value;
  } }),
}));
vi.mock("./lib/auth", () => ({ requireAuth: (req: any, _res: any, next: any) => {
  req.dbUser = { id: req.headers["x-fixture-user"] }; next();
} }));

const inviter = "00000000-0000-4000-8000-00000000e001";
const userA = "00000000-0000-4000-8000-00000000e002";
const userB = "00000000-0000-4000-8000-00000000e003";
const inviteId = "00000000-0000-4000-8000-00000000e004";
const code = "atomic-invite-fixture";
describe("invite redemption against isolated PostgreSQL (PGlite)", () => {
  let client: PGlite, server: Server, base: string;
  beforeAll(async () => {
    client = new PGlite(); state.database = drizzle(client);
    await client.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE invites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invite_code text NOT NULL UNIQUE,
        inviter_user_id uuid NOT NULL REFERENCES users(id), used_by_user_id uuid REFERENCES users(id),
        status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), expired_at timestamptz
      );
      CREATE TABLE friend_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_user_id uuid NOT NULL REFERENCES users(id),
        to_user_id uuid NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const app = express(); app.use(express.json());
    app.use("/api", (await import("./routes/invites")).default);
    app.use((_err: unknown, _req: any, res: any, _next: any) => res.status(500).json({ error: "fixture failure" }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture address unavailable");
    base = `http://127.0.0.1:${address.port}`;
  }, 30_000);
  beforeEach(async () => {
    state.gate = null;
    await client.exec(`ALTER TABLE friend_requests DROP CONSTRAINT IF EXISTS reject_fixture;
      TRUNCATE friend_requests, invites, users;
      INSERT INTO users(id) VALUES ('${inviter}'), ('${userA}'), ('${userB}');`);
    await client.query(`INSERT INTO invites(id, invite_code, inviter_user_id, expired_at)
      VALUES ($1, $2, $3, now() + interval '1 hour')`, [inviteId, code, inviter]);
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await client?.close();
  });
  const redeem = (user: string) => fetch(`${base}/api/invites/redeem`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-fixture-user": user },
    body: JSON.stringify({ inviteCode: code }),
  });
  it("two requests that both read active produce exactly one friend request", async () => {
    let arrived = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    state.gate = async () => { if (++arrived === 2) release(); await barrier; };
    const responses = await Promise.all([redeem(userA), redeem(userB)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    const friends = await client.query<{ from_user_id: string }>("SELECT from_user_id FROM friend_requests");
    const invite = await client.query<{ status: string; used_by_user_id: string }>("SELECT status, used_by_user_id FROM invites");
    expect(friends.rows).toHaveLength(1); expect(invite.rows[0].status).toBe("used");
    expect(invite.rows[0].used_by_user_id).toBe(friends.rows[0].from_user_id);
  });
  it("friend creation failure rolls back the consumed invite", async () => {
    await client.exec(`ALTER TABLE friend_requests ADD CONSTRAINT reject_fixture CHECK (from_user_id <> '${userA}'::uuid)`);
    expect((await redeem(userA)).status).toBe(500);
    const invite = await client.query<{ status: string; used_by_user_id: string | null }>("SELECT status, used_by_user_id FROM invites");
    expect(invite.rows[0]).toEqual({ status: "active", used_by_user_id: null });
    expect((await client.query("SELECT id FROM friend_requests")).rows).toHaveLength(0);
    expect((await redeem(userB)).status).toBe(200);
  });
  it("expired invite is rejected without creating a friendship request", async () => {
    await client.exec("UPDATE invites SET expired_at = now() - interval '1 second'");
    expect((await redeem(userA)).status).toBe(400);
    expect((await client.query("SELECT id FROM friend_requests")).rows).toHaveLength(0);
    expect((await client.query<{ status: string }>("SELECT status FROM invites")).rows[0].status).toBe("expired");
  });
  it("expiry while waiting to consume is rechecked inside the transaction", async () => {
    state.gate = async () => {
      await client.exec("UPDATE invites SET expired_at = now() - interval '1 second'");
    };
    expect((await redeem(userA)).status).toBe(400);
    expect((await client.query("SELECT id FROM friend_requests")).rows).toHaveLength(0);
    expect((await client.query<{ used_by_user_id: string | null }>("SELECT used_by_user_id FROM invites")).rows[0].used_by_user_id).toBeNull();
  });
});
