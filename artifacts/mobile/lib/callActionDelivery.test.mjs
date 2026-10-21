import assert from "node:assert/strict";
import test from "node:test";
import { deliverTerminalCallActions } from "./callActionDelivery.ts";

function scenario(overrides = {}) {
  const ack = [], sent = [];
  const action = { id: "operation-1", callId: "call-1", ownerId: "A", action: "decline", expiresAt: 10_000 };
  const deps = {
    pending: async () => [action],
    authenticate: async () => ({ bearer: "test", isCurrent: () => true }),
    ownerMatches: async () => true,
    getCall: async () => ({ callerId: "B", calleeId: "A", status: "ringing", attemptId: "attempt-1" }),
    control: async (a, call) => { sent.push({ a, call }); return true; },
    acknowledge: async id => { ack.push(id); },
    now: () => 1_000,
    ...overrides,
  };
  return { action, deps, ack, sent };
}
test("cold reject reaches the server and is acknowledged only after success", async () => {
  const h = scenario(); await deliverTerminalCallActions(h.deps);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].a.id, "operation-1");
  assert.equal(h.sent[0].call.attemptId, "attempt-1"); assert.deepEqual(h.ack, ["operation-1"]);
});
test("failed delivery keeps the same operation id for retry", async () => {
  let succeeds = false; const ids = [];
  const h = scenario({ control: async a => { ids.push(a.id); return succeeds; } });
  await deliverTerminalCallActions(h.deps); assert.deepEqual(h.ack, []);
  succeeds = true; await deliverTerminalCallActions(h.deps);
  assert.deepEqual(ids, ["operation-1", "operation-1"]); assert.deepEqual(h.ack, ["operation-1"]);
});
test("session change while fetching the call blocks old-account delivery", async () => {
  let current = true;
  const h = scenario({ authenticate: async () => ({ bearer: "test", isCurrent: () => current }),
    getCall: async () => { current = false; return { callerId: "B", calleeId: "A", status: "ringing" }; } });
  await deliverTerminalCallActions(h.deps); assert.deepEqual(h.sent, []); assert.deepEqual(h.ack, []);
});
test("authentication failure preserves the action without server calls", async () => {
  const h = scenario({ authenticate: async () => null });
  await deliverTerminalCallActions(h.deps); assert.deepEqual(h.sent, []); assert.deepEqual(h.ack, []);
});
test("late reject cannot hang up a call already answered on another device", async () => {
  const h = scenario({ getCall: async () => ({ callerId: "B", calleeId: "A", status: "active" }) });
  await deliverTerminalCallActions(h.deps); assert.deepEqual(h.sent, []); assert.deepEqual(h.ack, ["operation-1"]);
});
test("headless accept never activates microphone or changes server state", async () => {
  const h = scenario(); h.action.action = "accept";
  await deliverTerminalCallActions(h.deps); assert.deepEqual(h.sent, []); assert.deepEqual(h.ack, []);
});
test("a pending action for a different owner remains blocked", async () => {
  const h = scenario({ ownerMatches: async () => false });
  await deliverTerminalCallActions(h.deps); assert.deepEqual(h.sent, []); assert.deepEqual(h.ack, []);
});
test("network errors do not consume the durable action", async () => {
  const h = scenario({ getCall: async () => { throw new Error("offline"); } });
  await assert.rejects(deliverTerminalCallActions(h.deps), /offline/); assert.deepEqual(h.ack, []);
});
test("group rejection authorizes an invited member but cannot hang up an already joined member", async () => {
 const h=scenario({ getCall: async()=>({ callerId:'B',calleeId:'B',status:'active',participants:[{userId:'A',state:'invited'}] }) });
 await deliverTerminalCallActions(h.deps); assert.equal(h.sent.length,1);
 const late=scenario({ getCall: async()=>({ callerId:'B',calleeId:'B',status:'active',participants:[{userId:'A',state:'joined'}] }) });
 await deliverTerminalCallActions(late.deps); assert.equal(late.sent.length,0);
});
