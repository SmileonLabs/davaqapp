import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import request from "supertest";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
const fixture = vi.hoisted(() => ({ db: null as any, locks: [] as string[], warn: vi.fn() }));
vi.mock("@workspace/db", () => {
  const query = (text: string, values?: any[]) => {
    if (text.includes("pg_advisory_xact_lock")) { fixture.locks.push(values![0]); return Promise.resolve({ rows: [] }); }
    return fixture.db.query(text, values);
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("../lib/auth", () => ({ requireAuth: (req: any, res: any, next: any) => { if (req.get("authorization") !== "Bearer existing-fixture") return res.sendStatus(401); req.dbUser = { id: "11111111-1111-4111-8111-111111111111" }; next(); } }));
vi.mock("../lib/rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../lib/logger", () => ({ logger: { warn: fixture.warn } }));
import socialRouter from "./socialAuth";
import { hashSecret, validateAppleClaims, providerConfig } from "../lib/socialIdentity";
import * as socialIdentity from "../lib/socialIdentity";
import { socialReturnDestination } from "../lib/socialReturn";
import { resolveSocialBearer } from "../lib/socialSessions";
const app = express(); app.use(express.json(), express.urlencoded({ extended: true }), socialRouter);
const verifier = "a".repeat(43), existingId = "11111111-1111-4111-8111-111111111111";
async function attempt(email: string | null = "new@example.test", subject = "provider-sub", link = false, options: { provider?: "google" | "apple"; verified?: boolean } = {}) {
  const result = await request(app).post(link ? "/auth/social/link" : "/auth/social/start").set("Authorization", link ? "Bearer existing-fixture" : "").send({ provider: options.provider ?? "google", challenge: hashSecret(verifier) });
  expect(result.status).toBe(200);
  await fixture.db.query("UPDATE davaq_social_attempts SET subject=$2,email=$3,verified=$4 WHERE state_hash=$1", [hashSecret(result.body.state), subject, email, options.verified ?? true]);
  return result.body.state;
}
async function complete(state: string, extras = {}) { return request(app).post("/auth/social/complete").send({ state, verifier, ...extras }); }
function responseCookies(response: request.Response): string[] {
  const value = response.headers["set-cookie"] as string | string[] | undefined;
  return Array.isArray(value) ? value : value ? [value] : [];
}
beforeAll(async () => {
  fixture.db = new PGlite();
  await fixture.db.exec("CREATE TABLE users(id uuid PRIMARY KEY,clerk_id text UNIQUE NOT NULL,email text UNIQUE NOT NULL,nickname text NOT NULL);CREATE TABLE existing_content(owner_id uuid REFERENCES users(id),kind text,body text);");
  await fixture.db.exec(readFileSync(new URL("../../../../lib/db/drizzle/0042_davaq_social_auth.sql", import.meta.url), "utf8"));
  process.env.DAVAQ_SOCIAL_AUTH_ENABLED = "true";
  process.env.DAVAQ_GOOGLE_LOGIN_CLIENT_ID = "fixture-client";
  process.env.DAVAQ_GOOGLE_LOGIN_CLIENT_SECRET = "fixture-secret";
  process.env.DAVAQ_APPLE_LOGIN_CLIENT_ID = "fixture-apple";
  process.env.DAVAQ_APPLE_LOGIN_CLIENT_SECRET = "fixture-apple-secret";
});
beforeEach(async () => { fixture.locks = []; fixture.warn.mockClear(); await fixture.db.exec("TRUNCATE davaq_social_attempts,davaq_social_accounts,davaq_social_sessions,users CASCADE"); await fixture.db.query("INSERT INTO users VALUES($1,'legacy-clerk','existing@example.test','기존 회원')", [existingId]); });
afterAll(async () => { await fixture.db.close(); delete process.env.DAVAQ_SOCIAL_AUTH_ENABLED; delete process.env.DAVAQ_GOOGLE_LOGIN_CLIENT_ID; delete process.env.DAVAQ_GOOGLE_LOGIN_CLIENT_SECRET; delete process.env.DAVAQ_APPLE_LOGIN_CLIENT_ID; delete process.env.DAVAQ_APPLE_LOGIN_CLIENT_SECRET; });
describe("DAVAQ independent social authentication", () => {
  it("creates a standalone account and rejects replay", async () => {
    const state = await attempt(); const result = await complete(state); expect(result.status).toBe(200); expect(result.body.userId).toMatch(/^davaq_social_/);
    expect((await complete(state)).status).toBe(400);
    const identity = await resolveSocialBearer({ get: () => "Bearer " + result.body.accessToken } as any); expect(identity.id).toBe(result.body.dbUserId);
  });
  it("reuses the exact verified mailbox without changing legacy identity or card/chat ownership", async () => {
    const before = (await fixture.db.query("SELECT * FROM users WHERE id=$1", [existingId])).rows[0];
    await fixture.db.query("INSERT INTO existing_content VALUES($1,'card','original-card'),($1,'chat','original-message')", [existingId]);
    const result = await complete(await attempt(" EXISTING@example.test ")); expect(result.status).toBe(200); expect(result.body.dbUserId).toBe(existingId); expect(result.body.userId).toBe("legacy-clerk");
    expect((await fixture.db.query("SELECT * FROM users WHERE id=$1", [existingId])).rows[0]).toEqual(before);
    expect((await fixture.db.query("SELECT kind,body FROM existing_content WHERE owner_id=$1 ORDER BY kind", [existingId])).rows).toEqual([{kind:'card',body:'original-card'},{kind:'chat',body:'original-message'}]);
    expect((await fixture.db.query("SELECT count(*) AS n FROM users")).rows[0].n).toBe(1);
    expect(fixture.locks).toContain("davaq-social-subject:google:provider-sub");
    expect(fixture.locks).toContain("davaq-social-email:existing@example.test");
  });
  it("reuses one legacy identity across verified Google and Apple mailboxes", async () => {
    const google = await complete(await attempt("existing@example.test", "google-existing"));
    const apple = await complete(await attempt("existing@example.test", "apple-existing", false, { provider: "apple" }));
    expect(google.body.dbUserId).toBe(existingId); expect(apple.body.dbUserId).toBe(existingId);
    expect((await fixture.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(1);
  });
  it("prefers the already linked provider subject when its email changes or is omitted", async () => {
    await fixture.db.query("INSERT INTO davaq_social_accounts(provider,subject,user_id) VALUES('google','linked-subject',$1)", [existingId]);
    await fixture.db.query("INSERT INTO users VALUES('33333333-3333-4333-8333-333333333333','another-user','changed@example.test','다른 회원')");
    for (const email of ["changed@example.test", null]) {
      const result = await complete(await attempt(email, "linked-subject", false, { verified: false }));
      expect(result.status).toBe(200); expect(result.body.dbUserId).toBe(existingId);
    }
    expect((await fixture.db.query("SELECT email,clerk_id FROM users WHERE id=$1", [existingId])).rows[0]).toEqual({ email: "existing@example.test", clerk_id: "legacy-clerk" });
  });
  it("rejects unverified mailbox claims instead of merging or creating an account", async () => {
    for (const email of ["existing@example.test", "new@example.test"]) {
      const result = await complete(await attempt(email, "unverified-subject", false, { verified: false }));
      expect(result.status).toBe(403); expect(result.body.error).toBe("VERIFIED_EMAIL_REQUIRED");
    }
    expect((await fixture.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(1);
    expect((await fixture.db.query("SELECT count(*)::int AS n FROM davaq_social_accounts")).rows[0].n).toBe(0);
  });
  it("never guesses that an unknown Apple hidden relay address belongs to an existing member", async () => {
    const result = await complete(await attempt("unrelated@privaterelay.appleid.com", "hidden-apple", false, { provider: "apple" }));
    expect(result.status).toBe(200); expect(result.body.dbUserId).not.toBe(existingId);
    expect((await fixture.db.query("SELECT id,clerk_id FROM users WHERE email='existing@example.test'")).rows[0]).toEqual({ id: existingId, clerk_id: "legacy-clerk" });
  });
  it("rejects ambiguous case-normalized duplicate mailboxes", async () => {
    await fixture.db.query("INSERT INTO users VALUES('33333333-3333-4333-8333-333333333333','case-duplicate','EXISTING@example.test','기존 회원')");
    const result = await complete(await attempt("existing@example.test"));
    expect(result.status).toBe(409); expect(result.body.error).toBe("AMBIGUOUS_EMAIL_ACCOUNT");
    expect((await fixture.db.query("SELECT count(*)::int AS n FROM davaq_social_accounts")).rows[0].n).toBe(0);
  });
  it("links Apple relay or another verified email to the authenticated existing member", async () => {
    const result = await complete(await attempt("relay@privaterelay.appleid.test", "apple-relay-sub", true)); expect(result.status).toBe(200); expect(result.body.dbUserId).toBe(existingId); expect(result.body.userId).toBe("legacy-clerk");
    expect((await fixture.db.query("SELECT count(*) AS n FROM users")).rows[0].n).toBe(1);
  });
  it("requires a device verifier and authenticated linking", async () => {
    const state = await attempt(); const result = await request(app).post("/auth/social/complete").send({ state, verifier: "b".repeat(43) }); expect(result.status).toBe(400);
    expect((await request(app).post("/auth/social/link").send({ provider: "google", challenge: hashSecret(verifier) })).status).toBe(401);
    expect((await complete(state)).status).toBe(200);
  });
  it("revokes refresh and access together on logout", async () => {
    const result = await complete(await attempt());
    expect((await request(app).post("/auth/social/refresh").send({ refreshToken: result.body.refreshToken })).status).toBe(200);
    expect((await request(app).post("/auth/social/logout").send({ refreshToken: result.body.refreshToken })).status).toBe(204);
    expect((await request(app).post("/auth/social/refresh").send({ refreshToken: result.body.refreshToken })).status).toBe(401);
    expect(await resolveSocialBearer({ get: () => "Bearer " + result.body.accessToken } as any)).toBeNull();
  });
  it("keeps tokens from other tabs valid when a session refreshes", async () => {
    const initial = await complete(await attempt());
    const refreshed = await request(app).post("/auth/social/refresh").send({ refreshToken: initial.body.refreshToken });
    expect(refreshed.status).toBe(200);
    for (const token of [initial.body.accessToken, refreshed.body.accessToken]) {
      expect((await resolveSocialBearer({ get: () => "Bearer " + token } as any)).id).toBe(initial.body.dbUserId);
    }
  });
  it("keeps the web refresh credential in a Secure HttpOnly cookie", async () => {
    const result = await complete(await attempt(), { web: true }); expect(result.body.refreshToken).toBeUndefined(); expect(String(result.headers["set-cookie"])).toMatch(/HttpOnly/); expect(String(result.headers["set-cookie"])).toMatch(/Secure/); expect(String(result.headers["set-cookie"])).toMatch(/SameSite=Strict/);
  });
  it("rejects expired attempts and cross-browser callbacks", async () => {
    const state = await attempt(); await fixture.db.query("UPDATE davaq_social_attempts SET expires_at=now()-interval '1 second'"); expect((await complete(state)).status).toBe(400);
    expect((await request(app).get("/auth/social/google/callback").query({ state, code: "fixture" })).status).toBe(400);
  });
  it("reports fixed callback rejection reasons without logging or rendering callback secrets", async () => {
    const started = await request(app).post("/auth/social/start").send({ provider: "google", challenge: hashSecret(verifier) });
    const state = started.body.state, otherState = "b".repeat(43), code = "private-fixture-provider-code";
    const missing = await request(app).get("/auth/social/google/callback").query({ state, code });
    expect(missing.status).toBe(400);
    expect(missing.text).toContain('data-auth-error="browser-state-missing"');
    expect(fixture.warn).toHaveBeenLastCalledWith({ event: "social_callback_rejected", provider: "google", isGet: true, validState: true, cookiePresent: false, cookieMatches: false, cookieCount: 0, reason: "browser-state-missing" });
    const mismatch = await request(app).get("/auth/social/google/callback").query({ state, code }).set("Cookie", "__Host-davaq_oauth=" + otherState);
    expect(mismatch.status).toBe(400);
    expect(mismatch.text).toContain('data-auth-error="browser-state-mismatch"');
    expect(fixture.warn).toHaveBeenLastCalledWith({ event: "social_callback_rejected", provider: "google", isGet: true, validState: true, cookiePresent: true, cookieMatches: false, cookieCount: 1, reason: "browser-state-mismatch" });
    const duplicate = await request(app).get("/auth/social/google/callback").query({ state, code }).set("Cookie", "__Host-davaq_oauth=" + otherState + "; __Host-davaq_oauth=" + state);
    expect(duplicate.status).toBe(400);
    expect(duplicate.text).toContain('data-auth-error="browser-state-mismatch"');
    expect(fixture.warn).toHaveBeenLastCalledWith({ event: "social_callback_rejected", provider: "google", isGet: true, validState: true, cookiePresent: true, cookieMatches: false, cookieCount: 2, reason: "browser-state-mismatch" });
    await fixture.db.query("UPDATE davaq_social_attempts SET subject='already-processed' WHERE state_hash=$1", [hashSecret(state)]);
    const consumed = await request(app).get("/auth/social/google/callback").query({ state, code }).set("Cookie", "__Host-davaq_oauth=" + state);
    expect(consumed.status).toBe(400);
    expect(consumed.text).toContain('data-auth-error="attempt-unavailable"');
    expect(fixture.warn).toHaveBeenLastCalledWith({ event: "social_callback_rejected", provider: "google", isGet: true, validState: true, cookiePresent: true, cookieMatches: true, cookieCount: 1, reason: "attempt-unavailable" });
    const injection = '<script>alert("private-fixture")</script>';
    const invalidState = await request(app).get("/auth/social/google/callback").query({ state: injection, code });
    expect(invalidState.status).toBe(400);
    expect(invalidState.text).toContain('data-auth-error="invalid-request"');
    expect(fixture.warn).toHaveBeenLastCalledWith({ event: "social_callback_rejected", provider: "google", isGet: true, validState: false, cookiePresent: false, cookieMatches: false, cookieCount: 0, reason: "invalid-request" });
    const invalid = await request(app).post("/auth/social/untrusted-provider/callback").type("form").send({ state: injection, code });
    expect(invalid.status).toBe(400);
    expect(invalid.text).toContain('data-auth-error="invalid-request"');
    expect(fixture.warn).toHaveBeenLastCalledWith({ event: "social_callback_rejected", provider: "invalid", isGet: false, validState: false, cookiePresent: false, cookieMatches: false, cookieCount: 0, reason: "invalid-request" });
    for (const response of [missing, mismatch, duplicate, consumed, invalidState, invalid]) {
      expect(response.text).not.toContain(state); expect(response.text).not.toContain(code);
      expect(response.text).not.toContain(otherState); expect(response.text).not.toContain(injection);
    }
    const events = JSON.stringify(fixture.warn.mock.calls);
    for (const secret of [state, otherState, code, injection, "untrusted-provider"]) expect(events).not.toContain(secret);
  });
  it("returns web authentication to the current origin while keeping the registered OAuth callback", async () => {
    const started = await request(app).post("/auth/social/start").send({ provider: "google", challenge: hashSecret(verifier) });
    const browser = await request(app).get("/auth/social/browser").query({ state: started.body.state });
    expect(new URL(browser.headers.location).searchParams.get("redirect_uri")).toBe("https://davaq.anothermeai.app/api/auth/social/google/callback");
    const callback = await request(app).get("/auth/social/google/callback").query({ state: started.body.state }).set("Cookie", "__Host-davaq_oauth=" + started.body.state);
    expect(callback.status).toBe(200);
    expect(callback.text).toContain('href="https://davaq.app/app/sso-callback"');
    expect(callback.text).toContain('href="davaq://sso-callback"');
    expect(callback.text).not.toContain('href="/app/sso-callback"');
  });
  it("automatically returns canonical web Google login and completes the same browser's pending attempt", async () => {
    const identity = vi.spyOn(socialIdentity, "verifyProviderIdentity").mockResolvedValue({ subject: "google-web", email: "existing@example.test", verified: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id_token: "fixture-identity" }), { status: 200 })));
    try {
      const started = await request(app).post("/auth/social/start").set("Origin", "https://davaq.app").send({ provider: "google", challenge: hashSecret(verifier) });
      const browser = await request(app).get("/auth/social/browser").query(Object.fromEntries(new URL(started.body.url).searchParams));
      expect(responseCookies(browser).join(";")).toContain("SameSite=Lax");
      const cookies = responseCookies(browser).map((value: string) => value.split(";")[0]).join("; ");
      const callback = await request(app).get("/auth/social/google/callback").query({ state: started.body.state, code: "fixture-code" }).set("Cookie", cookies);
      expect(callback.status).toBe(303);
      expect(callback.headers.location).toBe("https://davaq.app/app/sso-callback");
      expect(callback.headers.location).not.toContain(started.body.state);
      expect(callback.headers["referrer-policy"]).toBe("no-referrer");
      const session = await complete(started.body.state, { web: true });
      expect(session.status).toBe(200); expect(session.body.dbUserId).toBe(existingId);
      expect(session.body.refreshToken).toBeUndefined();
      expect(responseCookies(session).join(";")).toContain("HttpOnly");
    } finally { identity.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("returns native Apple form_post to the app and preserves native verifier completion", async () => {
    const identity = vi.spyOn(socialIdentity, "verifyProviderIdentity").mockResolvedValue({ subject: "apple-native", email: "existing@example.test", verified: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id_token: "fixture-identity" }), { status: 200 })));
    try {
      const started = await request(app).post("/auth/social/start").send({ provider: "apple", challenge: hashSecret(verifier) });
      const browser = await request(app).get("/auth/social/browser").query(Object.fromEntries(new URL(started.body.url).searchParams));
      for (const cookie of responseCookies(browser)) {
        expect(cookie).toContain("SameSite=None"); expect(cookie).toContain("Secure"); expect(cookie).toContain("HttpOnly");
      }
      const cookies = responseCookies(browser).map((value: string) => value.split(";")[0]).join("; ");
      const callback = await request(app).post("/auth/social/apple/callback").type("form").send({ state: started.body.state, code: "fixture-code" }).set("Cookie", cookies);
      expect(callback.status).toBe(303); expect(callback.headers.location).toBe("davaq://sso-callback");
      expect((await complete(started.body.state)).status).toBe(200);
    } finally { identity.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("keeps legacy web completion on its own storage origin and rejects untrusted return URLs", async () => {
    const started = await request(app).post("/auth/social/start").set("Origin", "https://davaq.anothermeai.app").send({ provider: "google", challenge: hashSecret(verifier) });
    expect(new URL(started.body.url).searchParams.get("returnTo")).toBe("legacy-web");
    expect((await request(app).post("/auth/social/start").set("Origin", "https://attacker.test").send({ provider: "google", challenge: hashSecret(verifier) })).status).toBe(400);
    expect((await request(app).get("/auth/social/browser").query({ state: started.body.state, returnTo: "https://attacker.test" })).status).toBe(400);
    expect(socialReturnDestination(started.body.state + ".legacy-web", started.body.state)).toBe("https://davaq.anothermeai.app/app/sso-callback");
    expect(socialReturnDestination("b".repeat(43) + ".web", started.body.state)).toBeNull();
    expect(socialReturnDestination(started.body.state + ".https://attacker.test", started.body.state)).toBeNull();
  });
});
it("validates Apple's issuer, audience, nonce and expiry", () => {
  const claims = { iss: "https://appleid.apple.com", aud: "app.davaq", sub: "apple-sub", nonce: "nonce", exp: 2000, iat: 900, email: "RELAY@example.test", email_verified: "true" };
  expect(validateAppleClaims(claims, "app.davaq", "nonce", 1000).verified).toBe(true);
  for (const patch of [{ aud: "org.tcgindex.scanner" }, { nonce: "wrong" }, { exp: 999 }, { iss: "https://attacker.test" }]) expect(() => validateAppleClaims({ ...claims, ...patch }, "app.davaq", "nonce", 1000)).toThrow();
});

it("signs Apple server credentials for the DAVAQ service with a short expiry", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env = { DAVAQ_APPLE_LOGIN_CLIENT_ID: "app.davaq.mobile.web", DAVAQ_APPLE_LOGIN_KEY_ID: "fixture-key", DAVAQ_APPLE_LOGIN_TEAM_ID: "fixture-team", DAVAQ_APPLE_LOGIN_PRIVATE_KEY_BASE64: Buffer.from(privateKey.export({type:"pkcs8",format:"pem"})).toString("base64") };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    const [header, payload, signature] = providerConfig("apple").secret.split(".");
    expect(verify("sha256", Buffer.from(header+"."+payload), {key:publicKey,dsaEncoding:"ieee-p1363"}, Buffer.from(signature,"base64url"))).toBe(true);
    const claims=JSON.parse(Buffer.from(payload,"base64url").toString());
    expect(claims.sub).toBe("app.davaq.mobile.web"); expect(claims.iss).toBe("fixture-team"); expect(claims.aud).toBe("https://appleid.apple.com"); expect(claims.exp-claims.iat).toBe(3600);
  } finally { for(const k of Object.keys(env)) previous[k]===undefined ? delete process.env[k] : process.env[k]=previous[k]; }
});
