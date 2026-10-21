import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, native) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: name => {
      if (name === "react-native") return { NativeModules: { DavaqTelecom: native } };
      if (name === "./androidCallPolicy" || name === "./nativePushOwner") return {};
      throw new Error("Unexpected dependency: " + name);
    },
  });
  return exports;
}

test("older Android native modules and unsupported platforms are safe without launching settings", async () => {
  for (const module of [
    load("./androidTelecom.android.ts", undefined),
    load("./androidTelecom.android.ts", { startCall() {} }),
    load("./androidTelecom.ts", undefined),
  ]) {
    const access = await module.getFullScreenCallAccess();
    assert.equal(access.supported, false);
    assert.equal(access.granted, false);
    assert.equal(await module.openFullScreenCallSettings(), false);
  }
});

test("reading full-screen access never opens the OS special-access screen", async () => {
  let opens = 0;
  const native = {
    fullScreenIntentAccess: async () => ({ supported: true, granted: false }),
    openFullScreenIntentSettings: async () => { opens++; return true; },
  };
  const module = load("./androidTelecom.android.ts", native);
  assert.equal((await module.getFullScreenCallAccess()).supported, true);
  assert.equal((await module.getFullScreenCallAccess()).granted, false);
  assert.equal(opens, 0);
  assert.equal(await module.openFullScreenCallSettings(), true);
  assert.equal(opens, 1);
});

test("access query normalizes unexpected values and explicit launch failure remains false", async () => {
  const module = load("./androidTelecom.android.ts", {
    fullScreenIntentAccess: async () => ({ supported: "yes", granted: 1 }),
    openFullScreenIntentSettings: async () => false,
  });
  assert.equal((await module.getFullScreenCallAccess()).supported, false);
  assert.equal((await module.getFullScreenCallAccess()).granted, false);
  assert.equal(await module.openFullScreenCallSettings(), false);
});

test("native errors reach the settings UI instead of silently claiming permission or success", async () => {
  const module = load("./androidTelecom.android.ts", {
    fullScreenIntentAccess: async () => { throw new Error("query failed"); },
    openFullScreenIntentSettings: async () => { throw new Error("activity failed"); },
  });
  await assert.rejects(module.getFullScreenCallAccess(), /query failed/);
  await assert.rejects(module.openFullScreenCallSettings(), /activity failed/);
});
