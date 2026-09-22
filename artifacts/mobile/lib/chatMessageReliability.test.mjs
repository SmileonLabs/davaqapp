import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAllMessagesAfter, latestWindowCoversCursor,
  catchUpCoversLatestWindow,
  confirmedCatchUpIsCommitted,
  ConfirmedCatchUpCursor,
  ConfirmedCatchUpCursorRegistry,
  maxConfirmedRoomSeq,
  mergeConcurrentChatWrites,
  mergeChatMessages,
  normalizePersistedConfirmedCursors,
  reconcileLatestMessageWindow,
  safeCatchUpStartFromCache,
  upsertPersistedConfirmedCursor,
} from "./chatMessageReliability.ts";
import {
  canRetryChatOutboxEntry,
  markChatOutboxAttempt,
  markChatOutboxFailure,
  pruneChatOutbox,
  upsertChatOutboxEntries,
  CHAT_OUTBOX_MAX_ENTRIES,
  ChatDeliveryLeaseRegistry,
  ChatOutboxDrainOwnerFence,
  ChatSendOwnerFence,
  ChatOutboxCapacityError,
  isRetryableChatDeliveryError,
} from "./chatOutboxPolicy.ts";
import { EphemeralRequestGate } from "./ephemeralRequestGate.ts";
import {
  appendBoundedLatencySample,
  getChatPerformanceSnapshot,
  noteChatResource,
} from "./chatPerformanceDiagnostics.ts";
import {
  CHARACTER_PROFILES_ROOT_KEY,
  prepareProfileStateTransition,
  purgeProfileScopedQueries,
} from "./profileQueryIsolation.ts";
import { linkPreviewThumbnailUri } from "./linkPreviewThumbnailPolicy.ts";

function message(roomSeq, overrides = {}) {
  return {
    id: `server-${roomSeq}`,
    roomId: "room-1",
    roomSeq,
    senderId: "user-1",
    clientMessageId: `operation-${roomSeq}`,
    createdAt: new Date(1_700_000_000_000 + roomSeq).toISOString(),
    ...overrides,
  };
}

test("link previews never make recipients fetch a third-party thumbnail", () => {
  for (const candidate of [
    "https://tracker.example/pixel.gif?recipient=123",
    "http://93.184.216.34/thumbnail.jpg",
    "//cdn.example/preview.webp",
    "/api/link-preview-images/not-implemented",
    null,
    undefined,
  ]) {
    assert.equal(linkPreviewThumbnailUri(candidate), null);
  }
});

test("a response-loss retry/realtime acknowledgement produces one displayed message", () => {
  const optimistic = message(0, {
    id: "temp-operation-91",
    clientMessageId: "operation-91",
    _deliveryState: "pending",
  });
  const acknowledgement = message(91, { clientMessageId: "operation-91" });

  const merged = mergeChatMessages(
    [optimistic],
    [acknowledgement],
    [acknowledgement],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "server-91");
  assert.equal(merged[0].roomSeq, 91);
  assert.equal(merged[0]._deliveryState, undefined);
});

test("same client operation IDs from different senders are not collapsed", () => {
  const merged = mergeChatMessages(
    [message(1, { senderId: "user-a", clientMessageId: "same" })],
    [message(2, { senderId: "user-b", clientMessageId: "same" })],
  );
  assert.deepEqual(merged.map((item) => item.roomSeq), [1, 2]);
});

test("cursor catch-up restores more than 50 messages without gaps", async () => {
  const stored = Array.from({ length: 237 }, (_, index) => message(index + 11));
  const calls = [];
  const result = await fetchAllMessagesAfter(
    10,
    async (afterSeq, limit) => {
      calls.push(afterSeq);
      return stored.filter((item) => item.roomSeq > afterSeq).slice(0, limit);
    },
  );

  assert.equal(result.complete, true);
  assert.equal(result.messages.length, 237);
  assert.equal(result.lastSeq, 247);
  assert.deepEqual(calls, [10, 110, 210, 247]);
  assert.equal(maxConfirmedRoomSeq(result.messages), 247);
});

test("an outbox acknowledgement cannot jump the confirmed catch-up cursor over a gap", async () => {
  const cursor = new ConfirmedCatchUpCursor();
  // Only a completed server page may advance this cursor.
  cursor.advance(100);
  const cacheAfterEarlyAck = mergeChatMessages(
    Array.from({ length: 100 }, (_, index) => message(index + 1)),
    [message(200, { clientMessageId: "m-early-ack" })],
  );
  assert.equal(maxConfirmedRoomSeq(cacheAfterEarlyAck), 200);
  assert.equal(cursor.current, 100);

  const result = await fetchAllMessagesAfter(cursor.current, async (after, limit) =>
    Array.from({ length: 100 }, (_, index) => message(index + 101))
      .filter((item) => item.roomSeq > after)
      .slice(0, limit),
  );
  cursor.advance(result.lastSeq);
  assert.deepEqual(result.messages.map((item) => item.roomSeq),
    Array.from({ length: 100 }, (_, index) => index + 101));
  assert.equal(cursor.current, 200);
});

test("cursor commit requires every catch-up row in the accepted cache", () => {
  const catchUp = [message(101), message(102), message(103)];
  assert.equal(
    confirmedCatchUpIsCommitted([message(100), message(200)], catchUp),
    false,
  );
  assert.equal(
    confirmedCatchUpIsCommitted(
      [message(100), ...catchUp, message(200)],
      catchUp,
    ),
    true,
  );
  assert.equal(
    confirmedCatchUpIsCommitted(
      [message(101, { id: "server-101", roomSeq: 999 })],
      [message(101)],
    ),
    false,
  );
});

test("leaving and re-entering a room keeps its confirmed cursor despite a higher cache row", () => {
  const registry = new ConfirmedCatchUpCursorRegistry(2);
  const firstVisit = registry.forRoom("room-1");
  firstVisit.advance(100);

  // This simulates an outbox/realtime row arriving with a later sequence. The
  // cache high-water is intentionally never passed to the registry.
  const cacheAfterEarlyAck = mergeChatMessages(
    Array.from({ length: 100 }, (_, index) => message(index + 1)),
    [message(200, { clientMessageId: "m-early-ack" })],
  );
  assert.equal(maxConfirmedRoomSeq(cacheAfterEarlyAck), 200);

  registry.forRoom("room-2").advance(8);
  const reentered = registry.forRoom("room-1");
  assert.equal(reentered, firstVisit);
  assert.equal(reentered.current, 100);

  registry.forRoom("room-3");
  assert.equal(registry.size, 2);
  assert.equal(registry.forRoom("room-1").current, 100);
});

test("a cold reload restores only the persisted server-confirmed cursor", () => {
  const serialized = JSON.stringify(
    upsertPersistedConfirmedCursor([], "room-1", 100, 10_000),
  );
  const restored = normalizePersistedConfirmedCursors(
    JSON.parse(serialized),
    10_001,
  );
  const cursor = new ConfirmedCatchUpCursor();
  cursor.advance(restored[0].roomSeq);

  const cacheWithRealtimeHighWater = mergeChatMessages(
    Array.from({ length: 100 }, (_, index) => message(index + 1)),
    [message(200)],
  );
  assert.equal(maxConfirmedRoomSeq(cacheWithRealtimeHighWater), 200);
  assert.equal(cursor.current, 100);
});

test("persisted cursor LRU eviction replays from zero despite cached rows", () => {
  let records = upsertPersistedConfirmedCursor([], "room-1", 100, 1_000, 2);
  records = upsertPersistedConfirmedCursor(records, "room-2", 50, 2_000, 2);
  records = upsertPersistedConfirmedCursor(records, "room-3", 75, 3_000, 2);
  assert.deepEqual(records.map((record) => record.roomId), ["room-2", "room-3"]);

  const evictedRoomCache = [
    ...Array.from({ length: 50 }, (_, index) => message(index + 101)),
    message(200),
  ];
  assert.equal(safeCatchUpStartFromCache(evictedRoomCache), 0);
});

test("a lone realtime or outbox acknowledgement cannot become a catch-up cursor", () => {
  assert.equal(safeCatchUpStartFromCache([message(200)]), 0);
});

test("an authoritative latest window provides a bounded cold-start baseline", () => {
  const latest = Array.from({ length: 50 }, (_, index) => message(49_951 + index));
  assert.equal(maxConfirmedRoomSeq(latest), 50_000);
  // The hook commits this baseline after the latest window is accepted. It
  // does not issue 500 forward pages from sequence zero on first open.
  const cursor = new ConfirmedCatchUpCursor();
  cursor.advance(maxConfirmedRoomSeq(latest));
  assert.equal(cursor.current, 50_000);
});

test("a slow refresh cannot erase a concurrently queued optimistic message", () => {
  const snapshot = [message(100)];
  const pending = message(0, {
    id: "temp-concurrent-101",
    clientMessageId: "concurrent-101",
    _deliveryState: "pending",
  });
  const result = mergeConcurrentChatWrites(
    snapshot,
    [...snapshot, pending],
    [message(100)],
  );

  assert.deepEqual(result.map((item) => item.id), ["server-100", "temp-concurrent-101"]);
});

test("a slow refresh keeps a concurrent acknowledgement exactly once", () => {
  const optimistic = message(0, {
    id: "temp-concurrent-101",
    clientMessageId: "concurrent-101",
    _deliveryState: "pending",
  });
  const acknowledgement = message(101, {
    clientMessageId: "concurrent-101",
  });
  const result = mergeConcurrentChatWrites(
    [message(100), optimistic],
    [message(100), acknowledgement],
    [message(100)],
  );

  assert.deepEqual(result.map((item) => item.id), ["server-100", "server-101"]);
  assert.equal(result[1]._deliveryState, undefined);
});

test("commit reconciliation does not resurrect an already confirmed deleted row", () => {
  const deleted = message(100);
  const result = mergeConcurrentChatWrites([deleted], [deleted], []);
  assert.deepEqual(result, []);
});

test("cold restart after persisted cursor eviction safely replays from zero", async () => {
  const stored = Array.from({ length: 160 }, (_, index) => message(index + 1));
  const coldCache = [];
  const result = await fetchAllMessagesAfter(
    safeCatchUpStartFromCache(coldCache),
    async (after, limit) =>
      stored.filter((item) => item.roomSeq > after).slice(0, limit),
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.messages.map((item) => item.roomSeq),
    Array.from({ length: 160 }, (_, index) => index + 1),
  );
});

test("a bounded catch-up resumes from its last confirmed page", async () => {
  const stored = Array.from({ length: 1_250 }, (_, index) => message(index + 1));
  const fetchPage = async (after, limit) =>
    stored.filter((item) => item.roomSeq > after).slice(0, limit);
  const first = await fetchAllMessagesAfter(0, fetchPage, {
    pageSize: 100,
    maxPages: 10,
  });
  assert.equal(first.complete, false);
  assert.equal(first.lastSeq, 1_000);
  const continuation = await fetchAllMessagesAfter(first.lastSeq, fetchPage, {
    pageSize: 100,
    maxPages: 10,
  });
  assert.equal(continuation.complete, true);
  assert.equal(continuation.lastSeq, 1_250);
});

test("a newer latest-window snapshot forces continuation after an empty catch-up", () => {
  const latest = Array.from({ length: 50 }, (_, index) => message(251 + index));
  assert.equal(
    catchUpCoversLatestWindow({ lastSeq: 200, complete: true }, latest),
    false,
  );
  assert.equal(
    catchUpCoversLatestWindow({ lastSeq: 300, complete: true }, latest),
    true,
  );
  assert.equal(
    catchUpCoversLatestWindow({ lastSeq: 300, complete: false }, latest),
    false,
  );
});

test("realtime and catch-up overlap stays unique and roomSeq ordered", () => {
  const existing = [message(7), message(8)];
  const realtime = [message(10)];
  const catchUp = [message(9), message(10), message(11)];
  const merged = mergeChatMessages(existing, realtime, catchUp);
  assert.deepEqual(merged.map((item) => item.roomSeq), [7, 8, 9, 10, 11]);
});

test("latest-window reconciliation removes a server-omitted deletion but keeps older history", () => {
  const current = Array.from({ length: 100 }, (_, index) => message(index + 1));
  const latest = current.filter(
    (item) => item.roomSeq >= 50 && item.roomSeq !== 75,
  );
  assert.equal(latest.length, 50);

  const reconciled = reconcileLatestMessageWindow(current, latest, 50);
  assert.equal(reconciled.some((item) => item.roomSeq === 75), false);
  assert.equal(reconciled.some((item) => item.roomSeq === 49), true);
  assert.equal(reconciled.length, 99);
});

test("an empty latest window does not discard a durable pending message", () => {
  const pending = message(0, {
    id: "temp-m-pending",
    clientMessageId: "m-pending",
    _deliveryState: "pending",
  });
  assert.deepEqual(
    reconcileLatestMessageWindow([pending], [], 50).map((item) => item.id),
    [pending.id],
  );
});

test("a non-advancing server page fails closed instead of looping", async () => {
  await assert.rejects(
    () => fetchAllMessagesAfter(10, async () => [message(10)]),
    /did not advance/,
  );
});

test("outbox retries are bounded by count, total window and retention", () => {
  const now = 1_800_000_000_000;
  const base = {
    clientMessageId: "m-operation-1",
    tempId: "temp-m-operation-1",
    roomId: "room-1",
    senderId: "user-1",
    senderProfileId: null,
    content: "hello",
    type: "text",
    replyToMessageId: null,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    deliveryState: "pending",
    retryable: true,
  };
  assert.equal(canRetryChatOutboxEntry(base, now), true);
  const attempted = markChatOutboxAttempt(base, now);
  assert.equal(attempted.attempts, 1);
  const waiting = markChatOutboxFailure(attempted, now, true);
  assert.equal(waiting.deliveryState, "pending");
  assert.equal(canRetryChatOutboxEntry(waiting, now), false);

  const terminal = markChatOutboxFailure(attempted, now, false);
  assert.equal(terminal.deliveryState, "failed");
  assert.equal(terminal.retryable, false);

  const expired = { ...base, createdAt: now - 25 * 60 * 60 * 1_000 };
  assert.deepEqual(pruneChatOutbox([expired], now), []);

  const full = Array.from({ length: CHAT_OUTBOX_MAX_ENTRIES }, (_, index) => ({
    ...base,
    clientMessageId: `m-operation-${index}`,
    tempId: `temp-m-operation-${index}`,
    createdAt: now + index,
    nextAttemptAt: now + index,
  }));
  assert.throws(
    () =>
      upsertChatOutboxEntries(full, {
        ...base,
        clientMessageId: "m-over-capacity",
        tempId: "temp-m-over-capacity",
      }, now + CHAT_OUTBOX_MAX_ENTRIES),
    ChatOutboxCapacityError,
  );
  assert.equal(
    upsertChatOutboxEntries(full, { ...full[0], attempts: 1 }, now).length,
    CHAT_OUTBOX_MAX_ENTRIES,
  );
});

test("mounted-room and app-level drains share a once-only delivery lease", () => {
  const leases = new ChatDeliveryLeaseRegistry();
  const release = leases.tryAcquire("user-1", "m-operation-1");
  assert.equal(typeof release, "function");
  assert.equal(leases.tryAcquire("user-1", "m-operation-1"), null);
  assert.equal(typeof leases.tryAcquire("user-2", "m-operation-1"), "function");
  release();
  release();
  assert.equal(typeof leases.tryAcquire("user-1", "m-operation-1"), "function");
});

test("an in-flight old owner drain hands off to the newly signed-in owner", () => {
  const fence = new ChatOutboxDrainOwnerFence();
  fence.setOwner("user-a");
  const attemptA = fence.tryBegin();
  assert.equal(attemptA.ownerId, "user-a");

  fence.setOwner("user-b");
  assert.equal(fence.tryBegin(), null);
  assert.equal(fence.isCurrent(attemptA), false);
  assert.equal(fence.finish(attemptA), true);

  const attemptB = fence.tryBegin();
  assert.equal(attemptB.ownerId, "user-b");
  assert.equal(fence.isCurrent(attemptB), true);
  assert.equal(fence.finish(attemptB), false);
});

test("mounted send continuations are fenced across account and profile changes", () => {
  const fence = new ChatSendOwnerFence();
  fence.setOwner("user-a", "profile-a", "room-1");
  const tokenA = fence.capture();
  const entryA = {
    clientMessageId: "m-a",
    tempId: "temp-m-a",
    roomId: "room-1",
    senderId: "user-a",
    senderProfileId: "profile-a",
    content: "private-a",
    type: "text",
    replyToMessageId: null,
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 1,
    deliveryState: "pending",
    retryable: true,
  };
  assert.equal(fence.matchesEntry(tokenA, entryA), true);

  fence.setOwner("user-b", "profile-b", "room-1");
  assert.equal(fence.isCurrent(tokenA), false);
  assert.equal(fence.matchesEntry(tokenA, entryA), false);
  assert.equal(fence.matchesEntry(fence.capture(), entryA), false);

  const tokenB = fence.capture();
  fence.setOwner("user-b", "profile-c", "room-1");
  assert.equal(fence.isCurrent(tokenB), false);

  const profileCToken = fence.capture();
  fence.setOwner("user-b", "profile-c", "room-2");
  assert.equal(fence.isCurrent(profileCToken), false);
});

test("a profile switch synchronously removes old profile query payloads", () => {
  const cache = new Map([
    [JSON.stringify([CHARACTER_PROFILES_ROOT_KEY]), { active: "profile-b" }],
    [JSON.stringify(["room-messages", "room-a"]), [{ content: "private-a" }]],
    [JSON.stringify(["feed"]), [{ content: "profile-a-post" }]],
  ]);
  const client = {
    cancelQueries: async () => undefined,
    removeQueries: ({ predicate }) => {
      for (const serialized of Array.from(cache.keys())) {
        const queryKey = JSON.parse(serialized);
        if (predicate({ queryKey })) cache.delete(serialized);
      }
    },
  };

  purgeProfileScopedQueries(client);
  assert.deepEqual(
    Array.from(cache.keys()).map((key) => JSON.parse(key)),
    [[CHARACTER_PROFILES_ROOT_KEY]],
  );
  // A failed profile-B refetch cannot reveal the removed profile-A rows.
  assert.equal(cache.has(JSON.stringify(["room-messages", "room-a"])), false);
});

test("a server-refetched profile switch fences requests before removing old cache", () => {
  const events = [];
  const cache = new Map([
    [JSON.stringify([CHARACTER_PROFILES_ROOT_KEY]), { active: "profile-a" }],
    [JSON.stringify(["feed"]), [{ content: "profile-a-private" }]],
  ]);
  const client = {
    cancelQueries: async () => {
      events.push("cancel");
    },
    removeQueries: ({ predicate }) => {
      events.push("remove");
      for (const serialized of Array.from(cache.keys())) {
        const queryKey = JSON.parse(serialized);
        if (predicate({ queryKey })) cache.delete(serialized);
      }
    },
  };

  assert.equal(
    prepareProfileStateTransition(client, "profile-a", "profile-b", (id) => {
      events.push(`getter:${id}`);
    }),
    true,
  );
  assert.deepEqual(events, ["getter:profile-b", "cancel", "remove"]);
  assert.equal(cache.has(JSON.stringify(["feed"])), false);
});

test("outbox delivery retries only transient or unknown failures", () => {
  assert.equal(isRetryableChatDeliveryError(new Error("network")), true);
  assert.equal(isRetryableChatDeliveryError({ status: 408 }), true);
  assert.equal(isRetryableChatDeliveryError({ status: 429 }), true);
  assert.equal(isRetryableChatDeliveryError({ status: 503 }), true);
  assert.equal(isRetryableChatDeliveryError({ status: 400 }), false);
  assert.equal(isRetryableChatDeliveryError({ status: 403 }), false);
});

test("ephemeral signals are single-flight and never queue stale work", async () => {
  let now = 1_000;
  let resolveFirst;
  let calls = 0;
  const gate = new EphemeralRequestGate({
    minIntervalMs: 2_000,
    timeoutMs: 10_000,
    now: () => now,
  });
  const first = gate.tryRun(async () => {
    calls += 1;
    await new Promise((resolve) => {
      resolveFirst = resolve;
    });
  });
  const droppedWhilePending = gate.tryRun(async () => {
    calls += 1;
  });
  assert.equal(first, true);
  assert.equal(droppedWhilePending, false);
  assert.equal(calls, 1);

  resolveFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.pending, false);
  assert.equal(gate.tryRun(async () => {}), false);
  now += 2_000;
  assert.equal(gate.tryRun(async () => { calls += 1; }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  gate.dispose();
});

test("a timed-out ephemeral request clears pending state exactly once", async () => {
  const transitions = [];
  const gate = new EphemeralRequestGate({
    minIntervalMs: 0,
    timeoutMs: 5,
    onPendingChange: (pending) => transitions.push(pending),
  });
  gate.tryRun(() => new Promise(() => {}));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(gate.pending, false);
  assert.deepEqual(transitions, [true, false]);
  gate.dispose();
});

test("tracked chat resources return to baseline after lifecycle cleanup", () => {
  const baseline = getChatPerformanceSnapshot().resources;
  noteChatResource("timers", 3);
  noteChatResource("listeners", 6);
  noteChatResource("listeners", -6);
  noteChatResource("timers", -3);
  assert.deepEqual(getChatPerformanceSnapshot().resources, baseline);
});

test("chat latency diagnostics keep only a bounded sample window", () => {
  const values = [];
  assert.equal(appendBoundedLatencySample(values, 12.345, 2), true);
  assert.equal(appendBoundedLatencySample(values, 20, 2), true);
  assert.equal(appendBoundedLatencySample(values, 30, 2), true);
  assert.deepEqual(values, [20, 30]);
  assert.equal(appendBoundedLatencySample(values, Number.NaN, 2), false);
});

test('one latest-window read covers idle/small updates, but never skips a burst gap',()=>{
 const window=Array.from({length:50},(_,i)=>({id:String(i+51),roomSeq:i+51}));
 assert.equal(latestWindowCoversCursor(window,100,50),true);
 assert.equal(latestWindowCoversCursor(window,75,50),true);
 assert.equal(latestWindowCoversCursor(window,20,50),false);
 assert.equal(latestWindowCoversCursor([{id:'new',roomSeq:700}],1,50),true);
 assert.equal(latestWindowCoversCursor(Array.from({length:50},(_,i)=>({id:String(i)})),20,50),false);
});
