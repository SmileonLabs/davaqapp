import test from "node:test";
import assert from "node:assert/strict";
import {
  createReadingPositionStore,
  parseReadingPosition,
} from "./chatReadingPosition.ts";
const position = {
  messageId: "m1",
  roomSeq: 1,
  atLatest: false,
  savedAt: Date.now(),
};
test("reading positions reject malformed, expired and future values", () => {
  for (const raw of [
    "bad",
    JSON.stringify({ ...position, roomSeq: 0 }),
    JSON.stringify({ ...position, savedAt: 0 }),
    JSON.stringify({ ...position, savedAt: Date.now() + 86400000 }),
  ])
    assert.equal(parseReadingPosition(raw), null);
  assert.equal(parseReadingPosition(JSON.stringify(position)).messageId, "m1");
});
test("position writes are serial and isolated per account, profile and room", async () => {
  const values = new Map();
  const store = createReadingPositionStore({
    getItem: async (k) => values.get(k) ?? null,
    setItem: async (k, v) => {
      await new Promise(setImmediate);
      values.set(k, v);
    },
  });
  const a = store.write("account-a\0profile\0room", position);
  const b = store.write("account-a\0profile\0room", {
    ...position,
    messageId: "m2",
    roomSeq: 2,
  });
  await Promise.all([a, b]);
  assert.equal((await store.read("account-a\0profile\0room")).messageId, "m2");
  assert.equal(await store.read("account-b\0profile\0room"), null);
  assert.equal(await store.read("account-a\0profile-b\0room"), null);
  assert.equal(await store.read("account-a\0profile\0room-b"), null);
});
