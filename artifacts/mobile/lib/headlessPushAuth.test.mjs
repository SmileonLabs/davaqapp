import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
function harness({ signedIn = true, owner = "A", serverClerkId = "clerk-A", responseOk = true, switchDuringFetch = false } = {}) {
  const requests = [];
  const session = { id: "session-A", getToken: async () => "test-session-token" };
  const clerk = { loaded: false, user: signedIn ? { id: "clerk-A" } : null,
    session: signedIn ? session : null, load: async () => { clerk.loaded = true; } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./headlessPushAuth.android.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, AbortController, setTimeout, clearTimeout, process: { env: { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture" } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (switchDuringFetch) clerk.session = { ...session, id: "session-B" };
      return { ok: responseOk, json: async () => ({ id: owner, clerkId: serverClerkId }) };
    }, require: name => {
      if (name === "@clerk/expo") return { getClerkInstance: () => clerk };
      if (name === "@clerk/expo/token-cache") return { tokenCache: { fixture: true } };
      if (name === "./davaqAuth") return { getSocialToken: async () => null, socialSessionIdentity: () => null };
      if (name === "./apiBase") return { getApiBase: () => "https://api.example.invalid" };
      throw Error(name);
    } });
  return { auth: exports.getHeadlessPushAuth, clerk, requests };
}
test("cold-start auth restores Clerk and verifies the backend owner with a fresh bearer", async () => {
  const h = harness(); const auth = await h.auth("A");
  assert.equal(h.clerk.loaded, true); assert.equal(auth.bearer, "test-session-token");
  assert.equal(h.requests[0].url, "https://api.example.invalid/api/users/me");
  assert.equal(h.requests[0].options.headers.Authorization, "Bearer test-session-token");
});
test("signed-out device cannot renew a push owner", async () => {
  const h = harness({ signedIn: false }); assert.equal(await h.auth("A"), null); assert.equal(h.requests.length, 0);
});
test("backend owner mismatch and Clerk identity mismatch both fail closed", async () => {
  assert.equal(await harness({ owner: "B" }).auth("A"), null);
  assert.equal(await harness({ serverClerkId: "clerk-B" }).auth("A"), null);
});
test("session change during backend verification fails closed", async () => {
  assert.equal(await harness({ switchDuringFetch: true }).auth("A"), null);
});
test("backend authentication rejection cannot extend a lease", async () => {
  assert.equal(await harness({ responseOk: false }).auth("A"), null);
});
test("a previously verified auth becomes invalid immediately on session switch", async () => {
  const h = harness(); const auth = await h.auth("A");
  h.clerk.session = null; assert.equal(auth.isCurrent(), false);
});
