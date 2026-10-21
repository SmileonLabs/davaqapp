import { EventEmitter } from "node:events";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ tokens: [] as string[], status: 200, reason: "", sent: [] as { headers: Record<string, string>; body: Record<string, unknown> }[], remove: vi.fn(), destroy: vi.fn(), log: vi.fn() }));
vi.mock("@workspace/db", () => ({ usersTable: { id: "id", fcmTokens: "fcmTokens" }, db: { select: () => ({ from: () => ({ where: async () => [{ fcmTokens: JSON.stringify(fake.tokens) }] }) }) } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("./fcm", () => ({ parseFcmTokens: (raw: string) => JSON.parse(raw), removeFcmToken: fake.remove }));
vi.mock("./logger", () => ({ logger: { info: fake.log, warn: fake.log, error: fake.log } }));
vi.mock("node:http2", () => ({ connect: () => {
  const session = new EventEmitter() as EventEmitter & { request: (headers: Record<string, string>) => EventEmitter; destroy: typeof fake.destroy };
  session.destroy = fake.destroy;
  session.request = headers => {
    const stream = new EventEmitter() as EventEmitter & { setEncoding: () => void; end: (body: string) => void };
    stream.setEncoding = () => {};
    stream.end = body => {
      fake.sent.push({ headers, body: JSON.parse(body) });
      queueMicrotask(() => { stream.emit("response", { ":status": fake.status }); stream.emit("data", JSON.stringify({ reason: fake.reason })); stream.emit("end"); });
    };
    return stream;
  };
  return session;
} }));
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
import { sendApplePushToUser } from "./applePush";
beforeEach(() => {
  fake.tokens = [`apns:production:${"a".repeat(64)}`, `voip:production:${"b".repeat(64)}`, "FCM-token"];
  fake.status = 200; fake.reason = ""; fake.sent = []; vi.clearAllMocks();
  vi.stubEnv("APNS_PRIVATE_KEY", keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  vi.stubEnv("APNS_KEY_ID", "test-key"); vi.stubEnv("APNS_TEAM_ID", "test-team");
});
afterEach(() => vi.unstubAllEnvs());
describe("Apple push transport", () => {
  it("records an incoming call with no VoIP credential instead of sending an alert", async () => {
    fake.tokens = [`apns:production:${"a".repeat(64)}`];
    await sendApplePushToUser("owner", { title: "caller", body: "call", data: { type: "incoming_call", callId: "id", expiresAt: Date.now() + 45000 } });
    expect(fake.sent).toHaveLength(0);
    expect(fake.log).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", callId: "id", incoming: true }), "Apple push skipped: matching device credential unavailable");
  });
  it("records missing provider configuration without exposing a credential", async () => {
    vi.stubEnv("APNS_PRIVATE_KEY", "");
    await sendApplePushToUser("owner", { title: "caller", body: "call", data: { type: "incoming_call", callId: "id", expiresAt: Date.now() + 45000 } });
    expect(fake.sent).toHaveLength(0);
    expect(fake.log).toHaveBeenCalledWith({ userId: "owner", callId: "id", tokenCount: 2 }, "Apple push skipped: APNs credentials unavailable");
  });

  it("sends only to an alert credential with a valid ES256 provider signature", async () => {
    await sendApplePushToUser("owner", { title: "name", body: "message", data: { url: "/chat/room" } });
    expect(fake.sent).toHaveLength(1);
    const request = fake.sent[0]!;
    const parts = request.headers.authorization!.slice(7).split(".");
    expect(JSON.parse(Buffer.from(parts[0]!, "base64url").toString())).toEqual({ alg: "ES256", kid: "test-key" });
    expect(verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2]!, "base64url"))).toBe(true);
    expect(request.body).toMatchObject({ recipientUserId: "owner", aps: { sound: "default" } });
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });
  it("sends a current incoming call only to the VoIP credential", async () => {
    await sendApplePushToUser("owner", { title: "caller", body: "call", data: { type: "incoming_call", callId: "id", expiresAt: Date.now() + 45000 } });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.headers["apns-push-type"]).toBe("voip");
  });
  it("removes only a definitively unregistered credential", async () => {
    fake.status = 410; fake.reason = "Unregistered";
    await sendApplePushToUser("owner", { title: "name", body: "message" });
    expect(fake.remove).toHaveBeenCalledWith("owner", fake.tokens[0]);
  });
  it("retains credentials for wrong-environment or payload errors", async () => {
    fake.status = 400; fake.reason = "BadDeviceToken";
    await sendApplePushToUser("owner", { title: "name", body: "message" });
    expect(fake.remove).not.toHaveBeenCalled();
  });
});
