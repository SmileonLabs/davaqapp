import test from "node:test";
import assert from "node:assert/strict";
import { shouldClearChatNotification as clear } from "./chatNotificationPolicy.ts";
const notice = (roomId, messageSeq, extra = {}) => ({
  id: "os-id",
  date: 1000,
  notification: {
    data: {
      roomId,
      messageSeq: String(messageSeq),
      recipientUserId: "me",
      ...extra,
    },
  },
});
const read = { readThroughSeq: 8, ownerId: "me" };
test("only receipts at or behind the confirmed read sequence are removed", () => {
  assert.equal(clear(notice("room", 8), "room", read), true);
  assert.equal(clear(notice("room", 9), "room", read), false);
  assert.equal(clear(notice("another", 3), "room", read), false);
});
test("calls and another account remain untouched even when they reference the same room", () => {
  for (const type of ["incoming_call", "call_ended", "call"])
    assert.equal(
      clear(notice("room", 4, { type }), "room", {
        ...read,
        allowLegacy: true,
      }),
      false,
    );
  assert.equal(
    clear(notice("room", 4, { callId: "call" }), "room", read),
    false,
  );
  assert.equal(
    clear(notice("room", 4, { recipientUserId: "other" }), "room", read),
    false,
  );
});
test("old push formats are cleared only after room unread count has been confirmed zero", () => {
  const old = {
    id: "old",
    date: "1000",
    notification: { data: { url: "/chat/room" } },
  };
  assert.equal(clear(old, "room", read), false);
  assert.equal(
    clear(old, "room", { ...read, allowLegacy: true, observedBefore: 1001 }),
    true,
  );
  assert.equal(
    clear({ ...old, date: 1002 }, "room", {
      ...read,
      allowLegacy: true,
      observedBefore: 1001,
    }),
    false,
  );
});
test("tag-only Android tray notifications and direct APNs payloads match a room", () => {
  assert.equal(
    clear(
      { notification: { android: { tag: "room-room" }, data: {} } },
      "room",
      { allowLegacy: true },
    ),
    true,
  );
  assert.equal(clear(notice("room", 6), "room", read), true);
  assert.equal(
    clear({ notification: { data: { url: "/exchange/1" } } }, null, {
      allowLegacy: true,
    }),
    false,
  );
});
test("message time fallback retains newer unread notifications", () => {
  const options = { readThroughAt: "2026-10-10T12:00:00Z" };
  assert.equal(
    clear(
      notice("room", 0, { messageCreatedAt: "2026-10-10T11:59:00Z" }),
      "room",
      options,
    ),
    true,
  );
  assert.equal(
    clear(
      notice("room", 0, { messageCreatedAt: "2026-10-10T12:01:00Z" }),
      "room",
      options,
    ),
    false,
  );
});
