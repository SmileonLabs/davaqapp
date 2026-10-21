import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import type { Request, Response } from "express";
import { hashSecret, newSecret } from "./socialIdentity";

export const refreshCookie = "__Host-davaq_session";
export function readCookie(req: Request, name: string): string {
  const value = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="))?.slice(name.length + 1);
  try { return value ? decodeURIComponent(value) : ""; } catch { return ""; }
}
export async function resolveSocialBearer(req: Request) {
  const token = req.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!/^dvq_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await pool.query(`SELECT u.*, s.id AS social_session_id FROM davaq_social_access_tokens a JOIN davaq_social_sessions s ON s.id=a.session_id JOIN users u ON u.id=s.user_id WHERE a.token_hash=$1 AND a.expires_at>now() AND s.expires_at>now()`, [hashSecret(token)]);
  return rows[0] ?? null;
}
export async function createSocialSession(userId: string, res: Response, web: boolean) {
  const access = "dvq_" + newSecret(), refresh = newSecret(), id = randomUUID();
  await pool.query(`WITH session AS (INSERT INTO davaq_social_sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 days') RETURNING id) INSERT INTO davaq_social_access_tokens(token_hash,session_id,expires_at) SELECT $4,id,now()+interval '15 minutes' FROM session`, [id, userId, hashSecret(refresh), hashSecret(access)]);
  if (web) res.cookie(refreshCookie, refresh, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 30 * 86400_000 });
  return { accessToken: access, ...(web ? {} : { refreshToken: refresh }), expiresAt: Date.now() + 15 * 60_000, sessionId: id };
}
