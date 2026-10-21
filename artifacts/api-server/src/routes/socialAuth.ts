import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { callbackUrl, hashSecret, newSecret, providerConfig, validSecret, verifyProviderIdentity, type SocialProvider } from "../lib/socialIdentity";
import { createSocialSession, readCookie, refreshCookie } from "../lib/socialSessions";
import { isSocialReturn, socialReturnCookie, socialReturnDestination, socialReturnForOrigin } from "../lib/socialReturn";
import { logger } from "../lib/logger";

const router = Router();
const origin = "https://davaq.anothermeai.app";
const isProvider = (value: unknown): value is SocialProvider => value === "google" || value === "apple";
router.use("/auth/social", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/auth/social/providers", (_req, res) => {
  const ready = (p: SocialProvider) => process.env.DAVAQ_SOCIAL_AUTH_ENABLED === "true" && !!providerConfig(p).id && !!providerConfig(p).secret;
  res.json({ google: ready("google"), apple: ready("apple") });
});
async function start(req: any, res: any) {
  const provider = req.body?.provider, challenge = req.body?.challenge;
  if (!isProvider(provider) || typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge)) { res.status(400).json({ error: "INVALID_INPUT" }); return; }
  const returnTo = socialReturnForOrigin(req.get("origin"));
  if (!returnTo) { res.status(400).json({ error: "INVALID_ORIGIN" }); return; }
  const config = providerConfig(provider);
  if (process.env.DAVAQ_SOCIAL_AUTH_ENABLED !== "true" || !config.id || !config.secret) { res.status(503).json({ error: "PROVIDER_UNAVAILABLE" }); return; }
  const state = newSecret();
  await pool.query("DELETE FROM davaq_social_attempts WHERE expires_at<now()");
  await pool.query("DELETE FROM davaq_social_access_tokens WHERE expires_at<now()");
  await pool.query("DELETE FROM davaq_social_sessions WHERE expires_at<now()");
  await pool.query(`INSERT INTO davaq_social_attempts(state_hash,provider,challenge,link_user_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')`, [hashSecret(state), provider, challenge, req.dbUser?.id ?? null]);
  res.json({ state, url: origin + "/api/auth/social/browser?" + new URLSearchParams({ state, returnTo }) });
}
router.post("/auth/social/start", rateLimit({ name: "social-start", limit: 20, windowSeconds: 900 }), start);
router.post("/auth/social/link", requireAuth, rateLimit({ name: "social-link", limit: 10, windowSeconds: 900 }), start);
router.get("/auth/social/browser", async (req, res) => {
  const state = req.query.state;
  // Old installed clients may still open a URL without returnTo. Keep their
  // manual fallback, while every new start response supplies an exact mode.
  const returnTo = req.query.returnTo;
  if (!validSecret(state) || (returnTo !== undefined && !isSocialReturn(returnTo))) { res.sendStatus(400); return; }
  const { rows } = await pool.query("SELECT provider FROM davaq_social_attempts WHERE state_hash=$1 AND expires_at>now() AND subject IS NULL AND error IS NULL", [hashSecret(state)]);
  if (!rows[0]) { res.sendStatus(400); return; }
  const provider = rows[0].provider as SocialProvider, { id } = providerConfig(provider);
  // Apple returns form_post; SameSite=None is necessary only for the short-lived OAuth state cookie.
  res.cookie("__Host-davaq_oauth", state, { httpOnly: true, secure: true, sameSite: provider === "apple" ? "none" : "lax", path: "/", maxAge: 600_000 });
  if (isSocialReturn(returnTo)) res.cookie(socialReturnCookie, state + "." + returnTo, { httpOnly: true, secure: true, sameSite: provider === "apple" ? "none" : "lax", path: "/", maxAge: 600_000 });
  else res.clearCookie(socialReturnCookie, { path: "/", secure: true, sameSite: provider === "apple" ? "none" : "lax" });
  const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize");
  url.search = new URLSearchParams({ client_id: id, redirect_uri: callbackUrl(provider), response_type: "code", scope: provider === "google" ? "openid email" : "email", state, nonce: hashSecret(state), ...(provider === "apple" ? { response_mode: "form_post" } : {}) }).toString();
  res.set("Referrer-Policy", "no-referrer"); res.redirect(url.toString());
});
async function callback(req: any, res: any) {
  const provider = req.params.provider, input = req.method === "POST" ? req.body : req.query;
  const state = input?.state, code = input?.code;
  const validState = validSecret(state);
  const browserState = readCookie(req, "__Host-davaq_oauth");
  const cookieCount = typeof req.headers.cookie === "string" ? req.headers.cookie.split(";").filter((cookie: string) => cookie.trim().startsWith("__Host-davaq_oauth=")).length : 0;
  const cookiePresent = browserState.length > 0;
  const cookieMatches = validState && browserState === state;
  type CallbackError = "invalid-request" | "browser-state-missing" | "browser-state-mismatch" | "attempt-unavailable";
  const invalidCallback = (reason: CallbackError) => {
    logger.warn({ event: "social_callback_rejected", provider: isProvider(provider) ? provider : "invalid", isGet: req.method === "GET", validState, cookiePresent, cookieMatches, cookieCount, reason });
    const messages: Record<CallbackError, string> = {
      "invalid-request": "로그인 요청을 확인할 수 없어요. 로그인 화면에서 다시 시작해 주세요.",
      "browser-state-missing": "이 브라우저에서 시작한 로그인 정보를 찾지 못했어요. 원래 로그인한 창에서 다시 시도해 주세요.",
      "browser-state-mismatch": "다른 로그인 요청과 겹쳤어요. 로그인 창을 닫고 다시 시작해 주세요.",
      "attempt-unavailable": "로그인 요청이 만료됐거나 이미 처리됐어요. 로그인 화면에서 다시 시작해 주세요.",
    };
    res.set({ "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer" });
    res.status(400).type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DAVAQ 로그인 다시 시작</title><style>body{background:#fff;color:#111;font:16px system-ui;max-width:420px;margin:80px auto;padding:24px;line-height:1.7}a{color:#111;display:inline-block;padding:12px 0}</style><main data-auth-error="${reason}"><h1>로그인을 다시 시작해 주세요</h1><p>${messages[reason]}</p><p>앱에서 로그인 중이라면 이 창을 닫고 다시 시도해 주세요.</p><a href="https://davaq.app/app/sign-in">DAVAQ 로그인으로 돌아가기</a></main></html>`);
  };
  if (!isProvider(provider) || !validState) { invalidCallback("invalid-request"); return; }
  if (!cookiePresent) { invalidCallback("browser-state-missing"); return; }
  if (!cookieMatches) { invalidCallback("browser-state-mismatch"); return; }
  const { rows } = await pool.query(`SELECT provider FROM davaq_social_attempts WHERE state_hash=$1 AND provider=$2 AND expires_at>now() AND subject IS NULL AND error IS NULL`, [hashSecret(state), provider]);
  if (!rows[0]) { invalidCallback("attempt-unavailable"); return; }
  try {
    if (typeof code !== "string" || !code || code.length > 4096) throw new Error("Cancelled or invalid code");
    const config = providerConfig(provider);
    const response = await fetch(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://appleid.apple.com/auth/token", { method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.id, client_secret: config.secret, redirect_uri: callbackUrl(provider), grant_type: "authorization_code" }) });
    if (!response.ok) throw new Error("Token exchange failed");
    const tokens = await response.json() as { id_token?: string };
    if (typeof tokens.id_token !== "string") throw new Error("Missing identity");
    const identity = await verifyProviderIdentity(provider, tokens.id_token, hashSecret(state));
    await pool.query(`UPDATE davaq_social_attempts SET subject=$2,email=$3,verified=$4 WHERE state_hash=$1 AND subject IS NULL AND error IS NULL`, [hashSecret(state), identity.subject, identity.email, identity.verified]);
  } catch {
    await pool.query("UPDATE davaq_social_attempts SET error='PROVIDER_FAILED' WHERE state_hash=$1 AND subject IS NULL", [hashSecret(state)]);
  }
  res.clearCookie("__Host-davaq_oauth", { path: "/", secure: true, sameSite: provider === "apple" ? "none" : "lax" });
  const destination = socialReturnDestination(readCookie(req, socialReturnCookie), state);
  res.clearCookie(socialReturnCookie, { path: "/", secure: true, sameSite: provider === "apple" ? "none" : "lax" });
  res.set("Referrer-Policy", "no-referrer");
  if (destination) { res.redirect(303, destination); return; }
  res.set({ "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer" });
  res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DAVAQ 로그인</title><style>body{background:#fff;color:#111;font:16px system-ui;max-width:420px;margin:80px auto;padding:24px;line-height:1.7}a{color:#111;display:inline-block;padding:12px 0}</style><h1>DAVAQ</h1><p>로그인 화면으로 돌아가 인증 결과를 확인해 주세요.</p><p><a href="davaq://sso-callback">앱으로 돌아가기</a></p><p><a href="https://davaq.app/app/sso-callback">웹으로 돌아가기</a></p></html>`);
}
router.get("/auth/social/:provider/callback", callback);
router.post("/auth/social/:provider/callback", callback);
router.post("/auth/social/complete", rateLimit({ name: "social-complete", limit: 60, windowSeconds: 900 }), async (req, res) => {
  const { state, verifier, web } = req.body ?? {};
  if (!validSecret(state) || !validSecret(verifier)) { res.status(400).json({ error: "INVALID_INPUT" }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM davaq_social_attempts WHERE state_hash=$1 AND expires_at>now() FOR UPDATE", [hashSecret(state)]);
    const attempt = rows[0];
    if (!attempt || attempt.challenge !== hashSecret(verifier)) { await client.query("ROLLBACK"); res.status(400).json({ error: "INVALID_ATTEMPT" }); return; }
    if (!attempt.subject && !attempt.error) { await client.query("ROLLBACK"); res.status(202).json({ pending: true }); return; }
    await client.query("DELETE FROM davaq_social_attempts WHERE state_hash=$1", [hashSecret(state)]);
    if (attempt.error) { await client.query("COMMIT"); res.status(400).json({ error: attempt.error }); return; }
    // A provider identity and a verified mailbox each serialize independently.
    // Concurrent Google/Apple completions must reuse one database user row.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["davaq-social-subject:" + attempt.provider + ":" + attempt.subject]);
    const { rows: linked } = await client.query("SELECT user_id FROM davaq_social_accounts WHERE provider=$1 AND subject=$2", [attempt.provider, attempt.subject]);
    let userId = linked[0]?.user_id;
    if (attempt.link_user_id) {
      if (userId && userId !== attempt.link_user_id) { await client.query("COMMIT"); res.status(409).json({ error: "ACCOUNT_ALREADY_LINKED" }); return; }
      userId = attempt.link_user_id;
    } else if (!userId) {
      const email = typeof attempt.email === "string" ? attempt.email.trim().toLowerCase() : "";
      if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || attempt.verified !== true) { await client.query("COMMIT"); res.status(403).json({ error: "VERIFIED_EMAIL_REQUIRED" }); return; }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["davaq-social-email:" + email]);
      const { rows: existing } = await client.query("SELECT id FROM users WHERE lower(btrim(email))=$1 ORDER BY id LIMIT 2 FOR UPDATE", [email]);
      if (existing.length > 1) { await client.query("COMMIT"); res.status(409).json({ error: "AMBIGUOUS_EMAIL_ACCOUNT" }); return; }
      if (existing[0]) {
        // Legacy provisioning accepted only a Clerk-verified PRIMARY email;
        // the profile update API cannot edit that mailbox. A signed provider's
        // verified exact mailbox therefore reuses the existing identity.
        // Never rewrite clerk_id, nickname or any card/chat ownership.
        userId = existing[0].id;
      } else {
        userId = randomUUID();
        await client.query("INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)", [userId, "davaq_social_" + userId, email, email.split("@")[0].slice(0,30)]);
      }
    }
    await client.query("INSERT INTO davaq_social_accounts(provider,subject,user_id) VALUES($1,$2,$3) ON CONFLICT(provider,subject) DO NOTHING", [attempt.provider, attempt.subject, userId]);
    const { rows: mapping } = await client.query("SELECT user_id FROM davaq_social_accounts WHERE provider=$1 AND subject=$2", [attempt.provider, attempt.subject]);
    if (mapping[0]?.user_id !== userId) { await client.query("ROLLBACK"); res.status(409).json({ error: "ACCOUNT_ALREADY_LINKED" }); return; }
    const { rows: users } = await client.query("SELECT id,clerk_id FROM users WHERE id=$1", [userId]);
    await client.query("COMMIT");
    const session = await createSocialSession(userId, res, web === true);
    res.json({ ...session, userId: users[0].clerk_id, dbUserId: userId });
  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(error?.code === "23505" ? 409 : 500).json({ error: error?.code === "23505" ? "ACCOUNT_ALREADY_LINKED" : "AUTH_FAILED" });
  } finally { client.release(); }
});
router.post("/auth/social/refresh", rateLimit({ name: "social-refresh", limit: 120, windowSeconds: 900 }), async (req, res) => {
  const web = req.body?.web === true, token = web ? readCookie(req, refreshCookie) : req.body?.refreshToken;
  if (!validSecret(token)) { res.sendStatus(401); return; }
  const access = "dvq_" + newSecret();
  const { rows } = await pool.query(`WITH session AS (SELECT id,user_id FROM davaq_social_sessions WHERE refresh_hash=$1 AND expires_at>now()), inserted AS (INSERT INTO davaq_social_access_tokens(token_hash,session_id,expires_at) SELECT $2,id,now()+interval '15 minutes' FROM session RETURNING session_id) SELECT s.id,s.user_id FROM session s JOIN inserted a ON a.session_id=s.id`, [hashSecret(token), hashSecret(access)]);
  if (!rows[0]) { res.sendStatus(401); return; }
  const { rows: users } = await pool.query("SELECT clerk_id FROM users WHERE id=$1", [rows[0].user_id]);
  res.json({ accessToken: access, expiresAt: Date.now()+15*60_000, sessionId: rows[0].id, userId: users[0].clerk_id, dbUserId: rows[0].user_id });
});
router.post("/auth/social/logout", async (req, res) => {
  const token = req.body?.web === true ? readCookie(req, refreshCookie) : req.body?.refreshToken;
  if (validSecret(token)) await pool.query("DELETE FROM davaq_social_sessions WHERE refresh_hash=$1", [hashSecret(token)]);
  res.clearCookie(refreshCookie, { path: "/", secure: true, sameSite: "strict" }); res.sendStatus(204);
});
export default router;
