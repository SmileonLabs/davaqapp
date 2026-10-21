import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
function harness() {
  const values = new Map();
  const storage = { getItem: async k => values.get(k) ?? null,
    setItem: async (k, v) => { values.set(k, v); }, removeItem: async k => { values.delete(k); } };
  function load(file, dependencies) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: name => dependencies[name] });
    return exports;
  }
  const policy = load("./chatOutboxPolicy.ts", {});
  const sweep = load("./chatOutboxStorageSweep.ts", {});
  return load("./chatMessageOutbox.ts", { "./chatOutboxPolicy": policy,
    "./chatOutboxStorageSweep": sweep, "@react-native-async-storage/async-storage": { default: storage } });
}
const entry = () => ({ clientMessageId: "m-wakeup-1", tempId: "temp-m-wakeup-1",
  roomId: "room", senderId: "owner", senderProfileId: "profile", content: "hello", type: "text",
  replyToMessageId: null, createdAt: Date.now(), attempts: 0, nextAttemptAt: Date.now(),
  deliveryState: "pending", retryable: true });
test("a new durable message wakes the global drainer after an empty read", async () => {
  const outbox = harness(); const owners = [];
  assert.equal((await outbox.loadChatOutbox("owner")).length, 0);
  const unsubscribe = outbox.subscribeChatOutboxChanges(owner => owners.push(owner));
  const row = entry(); await outbox.upsertChatOutboxEntry("owner", row);
  assert.deepEqual(owners, ["owner"]);
  await outbox.upsertChatOutboxEntry("owner", { ...row, attempts: 1 });
  assert.equal(owners.length, 1, "attempt bookkeeping must not cause a retry loop");
  unsubscribe();
  await outbox.upsertChatOutboxEntry("other", { ...row, clientMessageId: "m-wakeup-2", tempId: "temp-m-wakeup-2" });
  assert.equal(owners.length, 1);
});
test("manual failed-to-pending transition wakes retry again", async () => {
  const outbox = harness(); const row = entry(); const owners = [];
  await outbox.upsertChatOutboxEntry("owner", { ...row, deliveryState: "failed" });
  outbox.subscribeChatOutboxChanges(owner => owners.push(owner));
  await outbox.upsertChatOutboxEntry("owner", row);
  assert.deepEqual(owners, ["owner"]);
});
