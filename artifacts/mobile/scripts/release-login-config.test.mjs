import test from "node:test";
import assert from "node:assert/strict";
import { resolveReleaseLogin, loadReleaseLogin } from "./release-login-config.mjs";
const key = "pk_test_" + Buffer.from("davaq-fixture.clerk.accounts.dev$").toString("base64");
const settings = { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: key, EXPO_PUBLIC_API_BASE_URL: "https://davaq.app/" };
test("shared release login overrides inherited development instance and proxy", () => {
  const release = resolveReleaseLogin(settings);
  const env = { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "old-dev-instance", EXPO_PUBLIC_CLERK_PROXY_URL: "https://old.example", ...release };
  assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, key);
  assert.equal(env.EXPO_PUBLIC_CLERK_PROXY_URL, "");
  assert.equal(env.EXPO_PUBLIC_API_BASE_URL, "https://davaq.app");
  assert.equal(env.EXPO_PUBLIC_DOMAIN, "davaq.app");
});
test("release cannot fall back to a development API or missing login settings", () => {
  assert.throws(() => resolveReleaseLogin({ ...settings, EXPO_PUBLIC_API_BASE_URL: "http://localhost:8080" }));
  assert.throws(() => resolveReleaseLogin({ ...settings, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "" }));
  assert.throws(() => loadReleaseLogin("/tmp/davaq-missing-release-fixture"));
});
test("new releases cannot accidentally target the retired native base URL", () => {
  assert.throws(() => resolveReleaseLogin({ ...settings, EXPO_PUBLIC_API_BASE_URL: "https://davaq.anothermeai.app" }));
  assert.throws(() => resolveReleaseLogin({ ...settings, EXPO_PUBLIC_API_BASE_URL: "https://davaq.app.attacker.example" }));
});
