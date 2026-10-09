import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./callApi.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadCallApi(windowGlobals = {}) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    ...windowGlobals,
    require(name) {
      if (name === "@react-native-async-storage/async-storage") return {};
      if (name === "@workspace/api-client-react") return {};
      if (name === "./callAttemptPolicy") return {};
      throw new Error("Unexpected dependency: " + name);
    },
  });
  return exports;
}

test("login mount and cleanup tolerate React Native's non-DOM window", () => {
  const api = loadCallApi({ window: {} });
  const dispose = api.installCallReliabilityFlushTriggers();
  assert.doesNotThrow(dispose);
});

test("call reliability can mount without a window during server rendering", () => {
  assert.doesNotThrow(loadCallApi().installCallReliabilityFlushTriggers());
});

test("web reconnect listener retains its receiver and is removed on unmount", () => {
  let subscribed;
  const target = {
    addEventListener(type, callback) {
      assert.equal(this, target);
      assert.equal(type, "online");
      subscribed = callback;
    },
    removeEventListener(type, callback) {
      assert.equal(this, target);
      assert.equal(type, "online");
      assert.equal(callback, subscribed);
      subscribed = undefined;
    },
  };
  const dispose = loadCallApi({ window: target }).installCallReliabilityFlushTriggers();
  assert.equal(typeof subscribed, "function");
  assert.doesNotThrow(subscribed);
  dispose();
  assert.equal(subscribed, undefined);
});
