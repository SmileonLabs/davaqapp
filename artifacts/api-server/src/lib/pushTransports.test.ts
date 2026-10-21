import { expect, it, vi } from "vitest";
const sends = vi.hoisted(() => ({ apple: vi.fn(async () => {}), notification: vi.fn(async () => {}), fcm: vi.fn(async () => {}), web: vi.fn() }));
vi.stubEnv("VAPID_PUBLIC_KEY", "test-public");
vi.stubEnv("VAPID_PRIVATE_KEY", "test-private");
vi.mock("web-push", () => ({ default: { setVapidDetails: () => {}, sendNotification: sends.web } }));
vi.mock("./applePush", () => ({ sendApplePushToUser: sends.apple }));
vi.mock("./fcm", () => ({ addFcmToken: vi.fn(), removeFcmToken: vi.fn(), sendFcmCallToUser: sends.fcm, sendFcmNotificationToUser: sends.notification }));
vi.mock("@workspace/db", () => ({ usersTable: { id: "id" }, db: { select: () => ({ from: () => ({ where: async () => [{ notificationEnabled: true, pushToken: JSON.stringify([{ endpoint: "https://push.test", keys: { p256dh: "key", auth: "auth" } }]) }] }) }) } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), asc: vi.fn(), inArray: vi.fn(), isNotNull: vi.fn(), or: vi.fn(), sql: vi.fn() }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
it("starts native ringing even while a browser push endpoint is stalled", async () => {
  let release: () => void = () => {};
  sends.web.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  const { sendCallPush } = await import("./push");
  const delivery = sendCallPush("owner", { title: "caller", body: "incoming", data: { type: "incoming_call", callId: "call", expiresAt: Date.now() + 45000 } });
  await vi.waitFor(() => {
    expect(sends.web).toHaveBeenCalled();
    expect(sends.apple).toHaveBeenCalled();
    expect(sends.fcm).toHaveBeenCalled();
  });
  release();
  await delivery;
  vi.unstubAllEnvs();
});

it("preserves the message read boundary in both Apple and FCM pushes", async () => {
  const { sendPushToUser } = await import("./push");
  await sendPushToUser("owner", { title: "sender", body: "message", url: "/chat/room", tag: "room-room", data: { type: "chat_message", messageId: "message", messageSeq: 8, messageCreatedAt: "2026-10-10T12:00:00Z" } });
  const expected = { type: "chat_message", messageId: "message", messageSeq: "8", messageCreatedAt: "2026-10-10T12:00:00Z", roomId: "room", url: "/chat/room", tag: "room-room" };
  expect(sends.apple).toHaveBeenLastCalledWith("owner", expect.objectContaining({ data: expected }));
  expect(sends.notification).toHaveBeenLastCalledWith("owner", expect.objectContaining({ data: expected }));
});


it("durable delivery reports native failures while still attempting the independent web channel", async () => {
  sends.web.mockResolvedValue(undefined);
  sends.apple.mockRejectedValueOnce(new Error("APNs unavailable"));
  const { sendPushToUser } = await import("./push");
  const webCalls = sends.web.mock.calls.length;
  await expect(sendPushToUser("owner", { title: "sender", body: "message" }, { strict: true })).rejects.toThrow("Push delivery failed");
  expect(sends.web.mock.calls.length).toBe(webCalls + 1);
  expect(sends.apple).toHaveBeenLastCalledWith("owner", expect.any(Object), { strict: true });
});

it("durable web failures are retryable; existing callers keep best-effort behaviour", async () => {
  sends.web.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { statusCode: 503 }));
  const { sendPushToUser } = await import("./push");
  await expect(sendPushToUser("owner", { title: "sender", body: "message" }, { strict: true })).rejects.toThrow("Push delivery failed");
  sends.web.mockRejectedValueOnce(new Error("best effort"));
  await expect(sendPushToUser("owner", { title: "sender", body: "message" })).resolves.toBeUndefined();
});

it('preserves shop thread deep links and recipient ownership in native/web pushes',async()=>{
  sends.web.mockResolvedValue(undefined);sends.apple.mockResolvedValue(undefined);sends.notification.mockResolvedValue(undefined);
  const {sendPushToUser}=await import('./push');
  const url='/shop/conversation?shopId=shop&threadId=thread';
  await sendPushToUser('owner',{title:'DavaQ 매장 상담',body:'새 메시지',url,tag:'shop-thread-thread',type:'shop_message',data:{type:'shop_message',shopId:'shop',threadId:'thread',messageId:'message',recipientUserId:'owner'}},{strict:true});
  const data={type:'shop_message',shopId:'shop',threadId:'thread',messageId:'message',recipientUserId:'owner',url,tag:'shop-thread-thread'};
  expect(sends.apple).toHaveBeenLastCalledWith('owner',expect.objectContaining({data}),{strict:true});
  expect(sends.notification).toHaveBeenLastCalledWith('owner',expect.objectContaining({data}),{strict:true});
  expect(JSON.parse(sends.web.mock.calls.at(-1)![1]).recipientUserId).toBe('owner');
});
