import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(storage) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("./ugcConsent.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date,
    require: name => name === "./davaqCommunityRules"
      ? { DAVAQ_COMMUNITY_RULES_VERSION: "rules-1" }
      : { default: storage },
  });
  return exports;
}
function fixture() {
  const values = new Map();
  let reads = 0, writes = 0;
  const storage = {
    getItem: async key => { reads++; return values.get(key) ?? null; },
    setItem: async (key, value) => { writes++; values.set(key, value); },
  };
  const exports = load(storage);
  return { storage, values, ...exports, create: version => new exports.UgcConsentController(storage, version),
    get reads() { return reads; }, get writes() { return writes; } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const record = (ownerId, version) => JSON.stringify({ ownerId, version, accepted: true, acceptedAt: "2026-10-15T00:00:00Z" });

test("constructing, subscribing and binding an account never reads storage or prompts during browsing", async () => {
  const f = fixture(), controller = f.create();
  controller.subscribe(() => {}); controller.setOwner("account-A"); await flush();
  assert.equal(f.reads, 0); assert.equal(f.writes, 0);
  assert.equal(controller.getSnapshot().visible, false);
  controller.setOwner(null);
  assert.equal(await controller.ensureConsent(), false);
  assert.equal(f.reads, 0);
});

test("first writing action is coalesced; cancel is false and cannot save implicit consent", async () => {
  const f = fixture(), controller = f.create(); controller.setOwner("account-A");
  const first = controller.ensureConsent();
  assert.equal(controller.ensureConsent(), first);
  await flush();
  assert.equal(controller.getSnapshot().visible, true);
  await controller.accept(false);
  assert.equal(f.writes, 0); assert.equal(controller.getSnapshot().visible, true);
  controller.cancel();
  assert.equal(await first, false); assert.equal(controller.getSnapshot().visible, false);
  assert.equal(f.values.size, 0);
});

test("explicit consent is verified on storage and reused only for the same account and rules version", async () => {
  const f = fixture(), controller = f.create(); controller.setOwner("account-A");
  const first = controller.ensureConsent(); await flush(); await controller.accept(true);
  assert.equal(await first, true); assert.equal(f.writes, 1);
  assert.equal(await controller.ensureConsent(), true);
  const saved = JSON.parse(f.values.get(f.ugcConsentStorageKey("account-A")));
  assert.equal(saved.ownerId, "account-A"); assert.equal(saved.version, "rules-1"); assert.equal(saved.accepted, true);
  controller.setOwner("account-B");
  const otherAccount = controller.ensureConsent(); await flush();
  assert.equal(controller.getSnapshot().visible, true); controller.cancel(); assert.equal(await otherAccount, false);
  const changedRules = f.create("rules-2"); changedRules.setOwner("account-A");
  const updated = changedRules.ensureConsent(); await flush();
  assert.equal(changedRules.getSnapshot().visible, true); changedRules.cancel(); assert.equal(await updated, false);
});

test("malformed, wrong-owner and wrong-version records never authorize a write", async () => {
  const f = fixture();
  for (const invalid of ["not-json", "null", "{}", record("account-B", "rules-1"), record("account-A", "old"),
    JSON.stringify({ ownerId: "account-A", version: "rules-1", accepted: false, acceptedAt: new Date().toISOString() }),
    JSON.stringify({ ownerId: "account-A", version: "rules-1", accepted: true, acceptedAt: "invalid" })]) {
    const controller = f.create(); controller.setOwner("account-A");
    f.values.set(f.ugcConsentStorageKey("account-A"), invalid);
    const pending = controller.ensureConsent(); await flush();
    assert.equal(controller.getSnapshot().visible, true);
    controller.cancel(); assert.equal(await pending, false);
  }
});

test("write failures keep the prompt open, return no success and allow explicit retry", async () => {
  const f = fixture(); let fail = true;
  const storage = { ...f.storage, setItem: async (...args) => { if (fail) throw new Error("full disk"); await f.storage.setItem(...args); } };
  const controller = new f.UgcConsentController(storage); controller.setOwner("account-A");
  const pending = controller.ensureConsent(); let resolved = false; void pending.then(() => { resolved = true; });
  await flush(); await controller.accept(true); await flush();
  assert.equal(resolved, false); assert.equal(controller.getSnapshot().visible, true);
  assert.equal(controller.getSnapshot().busy, false); assert.match(controller.getSnapshot().error, /저장하지 못했/);
  fail = false; await controller.accept(true); assert.equal(await pending, true);
});

test("silently dropped writes and unavailable storage cannot claim consent", async () => {
  const f = fixture();
  for (const storage of [
    { getItem: async () => null, setItem: async () => {} },
    { getItem: async () => { throw new Error("blocked"); }, setItem: async () => { throw new Error("blocked"); } },
  ]) {
    const controller = new f.UgcConsentController(storage); controller.setOwner("account-A");
    const pending = controller.ensureConsent(); await flush(); await controller.accept(true);
    assert.match(controller.getSnapshot().error, /저장하지 못했/);
    controller.cancel(); assert.equal(await pending, false);
  }
});

test("account switch while a previous consent read is pending cancels the old action", async () => {
  const f = fixture(); let complete;
  const controller = new f.UgcConsentController({ ...f.storage, getItem: () => new Promise(resolve => { complete = resolve; }) });
  controller.setOwner("account-A"); const previous = controller.ensureConsent();
  controller.setOwner("account-B"); assert.equal(await previous, false);
  complete(record("account-A", "rules-1")); await flush();
  assert.equal(controller.getSnapshot().visible, false);
  assert.equal(f.writes, 0);
});

test("a late old-account save cannot authorize a new account or replace its prompt", async () => {
  const f = fixture(); let complete;
  const controller = new f.UgcConsentController({ ...f.storage, setItem: (key, value) => new Promise(resolve => {
    complete = async () => { await f.storage.setItem(key, value); resolve(); };
  }) });
  controller.setOwner("account-A"); const previous = controller.ensureConsent(); await flush();
  const save = controller.accept(true);
  assert.equal(controller.getSnapshot().busy, true);
  controller.cancel(); assert.equal(controller.getSnapshot().busy, true);
  controller.setOwner("account-B"); assert.equal(await previous, false);
  const next = controller.ensureConsent(); await flush();
  await complete(); await save;
  assert.equal(controller.getSnapshot().ownerId, "account-B"); assert.equal(controller.getSnapshot().visible, true);
  assert.equal(f.values.has(f.ugcConsentStorageKey("account-B")), false);
  controller.cancel(); assert.equal(await next, false);
});

test("screen unmount cancels pending actions and late storage reads cannot reopen a prompt", async () => {
  const f = fixture(); let complete;
  const controller = new f.UgcConsentController({ ...f.storage, getItem: () => new Promise(resolve => { complete = resolve; }) });
  controller.setOwner("account-A"); const pending = controller.ensureConsent();
  controller.dispose(); assert.equal(await pending, false);
  complete(null); await flush(); assert.equal(controller.getSnapshot().visible, false);
});
