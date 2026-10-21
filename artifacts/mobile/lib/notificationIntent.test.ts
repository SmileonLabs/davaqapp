// @ts-nocheck -- exercised with the API workspace's Vitest runner.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const values = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); },
  removeItem: async (key: string) => { values.delete(key); },
} }));
import { consumeNotificationRoute, stashNotificationRoute } from "./notificationIntent";
beforeEach(() => values.clear());
afterEach(() => vi.useRealTimers());
it("opens a captured cold-launch message once after the owner signs in", async () => {
  await stashNotificationRoute({ url: "/chat/room", recipientUserId: "owner" });
  expect(await consumeNotificationRoute("owner")).toBe("/chat/room");
  expect(await consumeNotificationRoute("owner")).toBeNull();
});
it("does not open another account's notification after a switch", async () => {
  await stashNotificationRoute({ url: "/chat/private", recipientUserId: "old-owner" });
  expect(await consumeNotificationRoute("new-owner")).toBeNull();
});
it("rejects expired and external notification routes", async () => {
  vi.useFakeTimers();
  await stashNotificationRoute({ url: "/chat/room", recipientUserId: "owner" });
  vi.advanceTimersByTime(5 * 60_000 + 1);
  expect(await consumeNotificationRoute("owner")).toBeNull();
  await stashNotificationRoute({ url: "https://external.test", recipientUserId: "owner" });
  expect(await consumeNotificationRoute("owner")).toBeNull();
});
