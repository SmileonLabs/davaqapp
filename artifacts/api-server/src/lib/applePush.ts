import { connect } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { parseFcmTokens, removeFcmToken } from "./fcm";
import { logger } from "./logger";
import { applePushRequest, parseAppleDevice } from "./applePushPayload";
let cached: { value: string; at: number } | undefined;
function bearer(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.at < 3000) return cached.value;
  const pem = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!pem || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) throw new Error("apns_not_configured");
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now })).toString("base64url");
  const message = `${header}.${body}`;
  const signature = sign("sha256", Buffer.from(message), { key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" }).toString("base64url");
  cached = { value: `${message}.${signature}`, at: now };
  return cached.value;
}
export async function sendApplePushToUser(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }, opts: { strict?: boolean } = {}): Promise<void> {
  const [user] = await db.select({ fcmTokens: usersTable.fcmTokens }).from(usersTable).where(eq(usersTable.id, userId));
  const devices = parseFcmTokens(user?.fcmTokens).map(raw => ({ raw, device: parseAppleDevice(raw) })).filter(item => item.device);
  const incoming = payload.data?.type === "incoming_call";
  if (!devices.length || (incoming && !devices.some(({ device }) => device?.kind === "voip"))) {
    logger.warn({ userId, callId: payload.data?.callId, incoming }, "Apple push skipped: matching device credential unavailable");
    return;
  }
  if (!process.env.APNS_PRIVATE_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) {
    logger.warn({ userId, callId: payload.data?.callId, tokenCount: devices.length }, "Apple push skipped: APNs credentials unavailable");
    if (opts.strict) throw new Error("APNs unavailable for registered devices");
    return;
  }
  const results = await Promise.allSettled(devices.map(async ({ raw, device }) => {
    if (!device) return;
    const request = applePushRequest(device, process.env.APNS_BUNDLE_ID || "app.davaq.mobile", { ...payload.data, recipientUserId: userId }, payload.title, payload.body);
    if (!request) return;
    const session = connect(device.environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    try {
      const result = await new Promise<{ status: number; reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("apns_timeout")), 10000);
        session.once("error", error => { clearTimeout(timer); reject(error); });
        let stream;
        try { stream = session.request({ ":method": "POST", ":path": `/3/device/${device.token}`, authorization: `bearer ${bearer()}`, ...request.headers }); }
        catch (error) { clearTimeout(timer); reject(error); return; }
        let status = 0; let body = "";
        stream.on("response", headers => { status = Number(headers[":status"]); });
        stream.setEncoding("utf8");
        stream.on("data", chunk => { body += chunk; });
        stream.once("error", error => { clearTimeout(timer); reject(error); });
        stream.once("end", () => {
          clearTimeout(timer);
          let reason = "";
          try { reason = JSON.parse(body).reason || ""; } catch {}
          resolve({ status, reason });
        });
        stream.end(JSON.stringify(request.payload));
      });
      logger.info({ userId, callId: payload.data?.callId, kind: device.kind, ...result }, "Apple push delivery result");
      // Only definitive unregistration expires a credential. BadDeviceToken can
      // indicate the wrong APNs environment/configuration; retain it for repair.
      if (result.status === 410 && result.reason === "Unregistered") await removeFcmToken(userId, raw);
      else if (result.status !== 200 && opts.strict) throw new Error("APNs delivery failed");
    } catch (error) {
      logger.error({ userId, callId: payload.data?.callId, kind: device.kind, reason: error instanceof Error ? error.message : "unknown" }, "Apple push delivery failed");
      if (opts.strict) throw error;
    } finally { session.destroy(); }
  }));
  if (opts.strict && results.some(result => result.status === "rejected")) throw new Error("APNs delivery failed");
}
