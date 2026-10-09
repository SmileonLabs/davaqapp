import { describe, expect, it } from "vitest";
import { buildFcmNotificationMessage } from "./fcmNotificationMessage";
describe("Android message push delivery", () => {
  it("sets the app's high importance channel, sound and vibration", () => {
    const message = buildFcmNotificationMessage("recipient", "device", { title: "Alice", body: "Hi", tag: "room-1", data: { url: "/chat/1", recipientUserId: "spoofed" } });
    expect(message.android).toMatchObject({ priority: "high", notification: { channelId: "general-notifications", sound: "default", defaultVibrateTimings: true, visibility: "private", tag: "room-1" } });
    expect(message.notification).toEqual({ title: "Alice", body: "Hi" });
    expect(message.data).toEqual({ url: "/chat/1", recipientUserId: "recipient" });
  });
  it("preserves an explicitly selected channel", () => {
    expect(buildFcmNotificationMessage("u", "t", { title: "Notice", body: "Hi", channelId: "custom" }).android?.notification?.channelId).toBe("custom");
  });
});
