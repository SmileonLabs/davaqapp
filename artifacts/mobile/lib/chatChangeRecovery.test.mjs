import test from "node:test";
import assert from "node:assert/strict";
import { ChatChangeRecovery } from "./chatChangeRecovery.ts";
const row = (seq, extra = {}) => ({
  id: `m${seq}`,
  roomId: "r",
  roomSeq: seq,
  senderId: "a",
  createdAt: new Date(seq).toISOString(),
  content: "original",
  ...extra,
});
const page = (revision, messages = [], extra = {}) => ({
  protocol: 1,
  revision,
  snapshotRoomSeq: Math.max(0, ...messages.map((m) => m.roomSeq)),
  reset: false,
  hasMore: false,
  messages,
  removedMessageIds: [],
  readCursors: [],
  ...extra,
});
test("old deletion and reaction recover outside the latest fifty and resist stale HTTP projections", () => {
  let recovery = new ChatChangeRecovery("r");
  const current = Array.from({ length: 100 }, (_, i) => row(i + 1));
  recovery = recovery.prepare([], page("100", current, { reset: true })).next;
  recovery = recovery.prepare(
    current,
    page("102", [
      row(1, { content: "", deletedAt: "2026-10-16T00:00:00Z" }),
      row(2, { stickers: [{ code: "heart", count: 1 }] }),
    ]),
  ).next;
  assert.equal(recovery.project(current)[0].content, "");
  assert.equal(recovery.project(current)[1].stickers[0].code, "heart");
});
test("personal removal tolerates duplicate delivery without resurrecting a stale cached row", () => {
  let state = new ChatChangeRecovery("r").prepare(
    [],
    page("2", [row(1), row(2)], { reset: true }),
  ).next;
  const delta = page("3", [], { removedMessageIds: ["m1"] });
  state = state.prepare(state.project([]), delta).next;
  state = state.prepare(state.project([]), delta).next;
  assert.deepEqual(
    state.project([row(1), row(2)]).map((m) => m.id),
    ["m2"],
  );
});
test("preparing an aborted request never advances the live cursor", () => {
  const state = new ChatChangeRecovery("r");
  const uncommitted = state.prepare([], page("10", [row(10)], { reset: true }));
  assert.equal(state.revision, null);
  assert.equal(uncommitted.next.revision, "10");
  assert.deepEqual(state.project([]), []);
});
test("cold caches bootstrap anew and keep unsent operations", () => {
  const cold = new ChatChangeRecovery("r");
  const pending = row(0, { id: "temp-m-a", clientMessageId: "m-a" });
  const result = cold.prepare(
    [row(1), pending],
    page("100", [row(100)], { reset: true }),
  );
  assert.equal(cold.revision, null);
  assert.equal(result.next.revision, "100");
  assert.deepEqual(
    new Set(result.data.map((m) => m.id)),
    new Set(["m100", "temp-m-a"]),
  );
  assert.equal(
    result.next.project([row(1), row(100), pending]).some((m) => m.id === "m1"),
    false,
  );
});
test("read cursors from another device apply to old messages", () => {
  let state = new ChatChangeRecovery("r").prepare(
    [],
    page("2", [row(1), row(2)], { reset: true }),
  ).next;
  state = state.prepare(
    state.project([]),
    page("3", [], {
      readCursors: [
        { userId: "b", lastReadSeq: 2, isReadReceiptParticipant: true },
      ],
    }),
  ).next;
  assert.equal(state.project([row(1)])[0].readCount, 1);
});
test("bounded pages continue until over a thousand events have committed", () => {
  let state = new ChatChangeRecovery("r").prepare(
    [],
    page("0", [], { reset: true }),
  ).next;
  let cached = [];
  for (let start = 1; start <= 1201; start += 200) {
    const end = Math.min(1201, start + 199);
    const prepared = state.prepare(
      cached,
      page(
        String(end),
        Array.from({ length: end - start + 1 }, (_, i) => row(start + i)),
        { hasMore: end < 1201 },
      ),
    );
    assert.equal(prepared.hasMore, end < 1201);
    cached = prepared.data;
    state = prepared.next;
  }
  assert.equal(cached.length, 1201);
  assert.equal(state.revision, "1201");
});
test("rejects older, foreign-room or malformed change pages", () => {
  const state = new ChatChangeRecovery("r").prepare(
    [],
    page("10", [], { reset: true }),
  ).next;
  assert.throws(() => state.prepare([], page("9")));
  assert.throws(() =>
    state.prepare([], page("11", [row(1, { roomId: "other" })])),
  );
  assert.throws(() => state.prepare([], page("-1")));
});

test("authoritative overlays do not resurrect a local delete awaiting server acknowledgement", () => {
  const prepared = new ChatChangeRecovery("r").prepare(
    [],
    page("2", [row(1), row(2)], { reset: true }),
  );
  assert.deepEqual(
    prepared.next.project([row(2)]).map((message) => message.id),
    ["m2"],
  );
});

test("an empty or personally filtered snapshot cannot reintroduce stale highest messages", () => {
  const filtered = new ChatChangeRecovery("r").prepare(
    [row(100)],
    page("10", [row(1)], { reset: true, snapshotRoomSeq: 100 }),
  );
  assert.deepEqual(
    filtered.next.project([row(1), row(100)]).map((m) => m.id),
    ["m1"],
  );
  const empty = new ChatChangeRecovery("r").prepare(
    [row(1)],
    page("11", [], { reset: true, snapshotRoomSeq: 100 }),
  );
  assert.deepEqual(empty.data, []);
  assert.deepEqual(empty.next.project([row(1)]), []);
  assert.deepEqual(
    empty.next.project([row(101)]).map((m) => m.id),
    ["m101"],
  );
});

test("a change to unloaded old history does not insert a stray historical row into the visible window", () => {
  const snapshot = new ChatChangeRecovery("r").prepare(
    [],
    page("100", [row(100)], { reset: true }),
  );
  const changed = snapshot.next.prepare(
    snapshot.data,
    page("101", [row(1, { content: "", deletedAt: "deleted" })]),
  );
  assert.deepEqual(
    changed.data.map((m) => m.id),
    ["m100"],
  );
  // If that old row is subsequently loaded, its deletion still wins.
  assert.equal(changed.next.project([row(1), row(100)])[0].content, "");
});
test('history admission shares only a reset epoch and never overrides a tombstone',()=>{
 let state=new ChatChangeRecovery('r').prepare([],page('10',[row(100)],{reset:true,snapshotRoomSeq:100})).next;
 const next=state.prepare([row(100)],page('11',[],{snapshotRoomSeq:100,removedMessageIds:['m1']})).next;
 state.admitHistory([row(1),row(2)]);
 assert.deepEqual(next.project([row(1),row(2),row(100)]).map(m=>m.id),['m2','m100']);
 const reset=next.prepare([],page('12',[row(100)],{reset:true,snapshotRoomSeq:100})).next;
 assert.notEqual(reset.historyEpoch,next.historyEpoch);
 assert.deepEqual(reset.project([row(2),row(100)]).map(m=>m.id),['m100']);
});
