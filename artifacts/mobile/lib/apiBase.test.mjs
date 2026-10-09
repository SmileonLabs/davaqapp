import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("./apiBase.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(os, env = {}, windowGlobals = {}) {
  const exports = {};
  vm.runInNewContext(code, {
    exports, process: { env }, ...windowGlobals,
    require(name) {
      assert.equal(name, "react-native");
      return { Platform: { OS: os } };
    },
  });
  return exports;
}
test("Android ignores Metro window origin and uses the configured API", () => {
  const api = load("android", { EXPO_PUBLIC_API_BASE_URL: "https://davaq.anothermeai.app/" },
    { window: { location: { origin: "http://127.0.0.1:8081" } } });
  assert.equal(api.getApiBase(), "https://davaq.anothermeai.app");
  assert.equal(api.mediaUri("/objects/photo"), "https://davaq.anothermeai.app/api/storage/objects/photo");
});
test("native window without DOM location cannot crash API initialization", () => {
  const api = load("android", { EXPO_PUBLIC_DOMAIN: "davaq.anothermeai.app" }, { window: {} });
  assert.equal(api.getApiBase(), "https://davaq.anothermeai.app");
});
test("web continues to use its own origin", () => {
  assert.equal(load("web", { EXPO_PUBLIC_API_BASE_URL: "https://other.example" },
    { window: { location: { origin: "https://davaq.anothermeai.app" } } }).getApiBase(), "https://davaq.anothermeai.app");
});
test("native explicit host and domain fallback work without window", () => {
  assert.equal(load("ios", { EXPO_PUBLIC_API_BASE_URL: "https://api.example/" }).getApiBase(), "https://api.example");
  assert.equal(load("android", { EXPO_PUBLIC_DOMAIN: "api.example" }).getApiBase(), "https://api.example");
});
