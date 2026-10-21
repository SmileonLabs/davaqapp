import { describe, expect, it } from "vitest";
import { applePushRequest, parseAppleDevice } from "./applePushPayload";
const token = "a".repeat(64);
const apns = { kind: "apns", environment: "production", token } as const;
const voip = { ...apns, kind: "voip" } as const;
describe("iOS push delivery contract", () => {
  it("validates kind and environment without treating FCM tokens as Apple credentials", () => {
    expect(parseAppleDevice(`apns:production:${token}`)).toEqual(apns);
    expect(parseAppleDevice(`voip:sandbox:${token}`)?.environment).toBe("sandbox");
    expect(parseAppleDevice("a-native-fcm-token")).toBeNull();
    expect(parseAppleDevice(`apns:production:bad/token`)).toBeNull();
  });
  it("sends regular messages with an audible alert on the app topic", () => {
    const result = applePushRequest(apns, "app.davaq.mobile", { recipientUserId: "owner", url: "/chat/room" }, "sender", "message", 1000)!;
    expect(result.headers).toMatchObject({ "apns-topic": "app.davaq.mobile", "apns-push-type": "alert", "apns-priority": "10" });
    expect(result.payload).toMatchObject({ recipientUserId: "owner", url: "/chat/room", aps: { sound: "default", alert: { title: "sender", body: "message" } } });
  });
  it("routes live calls only to VoIP devices with no delayed delivery", () => {
    const data = { type: "incoming_call", callId: "id", expiresAt: 46000 };
    const result = applePushRequest(voip, "app.davaq.mobile", data, "sender", "call", 1000)!;
    expect(result.headers).toMatchObject({ "apns-topic": "app.davaq.mobile.voip", "apns-push-type": "voip", "apns-expiration": "0" });
    expect(applePushRequest(apns, "app.davaq.mobile", data, "", "", 1000)).toBeNull();
    expect(applePushRequest(voip, "app.davaq.mobile", { ...data, expiresAt: 999 }, "", "", 1000)).toBeNull();
    expect(applePushRequest(voip, "app.davaq.mobile", { type: "incoming_call" }, "", "", 1000)).toBeNull();
  });
  it("never creates a new VoIP ringing call for terminal or ordinary messages", () => {
    const data = { type: "call_ended", callId: "id" };
    expect(applePushRequest(voip, "app.davaq.mobile", data, "", "")).toBeNull();
    expect(applePushRequest(voip, "app.davaq.mobile", {}, "", "")).toBeNull();
    const result = applePushRequest(apns, "app.davaq.mobile", data, "", "")!;
    expect(result.headers).toMatchObject({ "apns-push-type": "background", "apns-priority": "5", "apns-expiration": "0" });
    expect(result.payload.aps).toEqual({ "content-available": 1 });
  });
});
