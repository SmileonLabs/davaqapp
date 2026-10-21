import { createHash, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

export type SocialProvider = "google" | "apple";
export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");
export const newSecret = () => randomBytes(32).toString("base64url");
export const validSecret = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const callbackUrl = (provider: SocialProvider) => `https://davaq.anothermeai.app/api/auth/social/${provider}/callback`;
export function providerConfig(provider: SocialProvider) {
  const prefix = provider === "google" ? "GOOGLE" : "APPLE";
  const id = process.env[`DAVAQ_${prefix}_LOGIN_CLIENT_ID`] ?? "";
  let secret = process.env[`DAVAQ_${prefix}_LOGIN_CLIENT_SECRET`] ?? "";
  if (provider === "apple" && id && process.env.DAVAQ_APPLE_LOGIN_PRIVATE_KEY_BASE64 && process.env.DAVAQ_APPLE_LOGIN_KEY_ID && process.env.DAVAQ_APPLE_LOGIN_TEAM_ID) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.DAVAQ_APPLE_LOGIN_KEY_ID })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: process.env.DAVAQ_APPLE_LOGIN_TEAM_ID, iat: now, exp: now + 3600, aud: "https://appleid.apple.com", sub: id })).toString("base64url");
    const input = `${header}.${payload}`;
    secret = input + "." + sign("sha256", Buffer.from(input), { key: Buffer.from(process.env.DAVAQ_APPLE_LOGIN_PRIVATE_KEY_BASE64, "base64"), dsaEncoding: "ieee-p1363" }).toString("base64url");
  }
  return { id, secret };
}
export function validateAppleClaims(claims: Record<string, unknown>, audience: string, nonce: string, now = Date.now() / 1000) {
  if (claims.iss !== "https://appleid.apple.com" || claims.aud !== audience || typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now + 60 || claims.nonce !== nonce) throw new Error("Invalid Apple identity");
  return { subject: claims.sub, email: typeof claims.email === "string" ? claims.email.toLowerCase() : null, verified: claims.email_verified === true || claims.email_verified === "true" };
}
let appleKeys: { expires: number; keys: Array<Record<string, any>> } | undefined;
async function loadAppleKeys(refresh = false) {
  if (!refresh && appleKeys && appleKeys.expires > Date.now()) return appleKeys.keys;
  const response = await fetch("https://appleid.apple.com/auth/keys", { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error("Apple key service unavailable");
  const value = await response.json() as { keys?: Array<Record<string, any>> };
  if (!value.keys?.length || value.keys.length > 10) throw new Error("Invalid Apple keys");
  appleKeys = { expires: Date.now() + 3600_000, keys: value.keys }; return value.keys;
}
export async function verifyProviderIdentity(provider: SocialProvider, token: string, nonce: string) {
  if (token.length > 16_000) throw new Error("Invalid identity token");
  const { id } = providerConfig(provider);
  if (!id) throw new Error("Provider unavailable");
  if (provider === "google") {
    const ticket = await new OAuth2Client(id).verifyIdToken({ idToken: token, audience: id });
    const payload = ticket.getPayload();
    if (!payload?.sub || payload.nonce !== nonce) throw new Error("Invalid Google nonce");
    return { subject: payload.sub, email: payload.email?.toLowerCase() ?? null, verified: payload.email_verified === true };
  }
  const [headerRaw, payloadRaw, signature, extra] = token.split(".");
  if (!headerRaw || !payloadRaw || !signature || extra) throw new Error("Invalid Apple token");
  const header = JSON.parse(Buffer.from(headerRaw, "base64url").toString());
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid Apple algorithm");
  let key = (await loadAppleKeys()).find(k => k.kid === header.kid && k.kty === "RSA" && k.alg === "RS256");
  if (!key) key = (await loadAppleKeys(true)).find(k => k.kid === header.kid && k.kty === "RSA" && k.alg === "RS256");
  if (!key || !verify("RSA-SHA256", Buffer.from(`${headerRaw}.${payloadRaw}`), createPublicKey({ key: key as any, format: "jwk" }), Buffer.from(signature, "base64url"))) throw new Error("Invalid Apple signature");
  return validateAppleClaims(JSON.parse(Buffer.from(payloadRaw, "base64url").toString()), id, nonce);
}
