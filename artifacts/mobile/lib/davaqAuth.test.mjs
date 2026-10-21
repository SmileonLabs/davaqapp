import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const SESSION_KEY = "davaq.social.session.v1", PENDING_KEY = "davaq.social.pending.v1";
const state = "A".repeat(43), verifier = "B".repeat(43);
const pending = () => JSON.stringify({ state, verifier });
const session = (id = "new", expiresAt = Date.now() + 900_000) => ({
  accessToken: `fixture-access-${id}`, refreshToken: `fixture-refresh-${id}`,
  expiresAt, sessionId: id, userId: `fixture-user-${id}`, dbUserId: `fixture-db-${id}`,
});
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function load({ platform = "web", stored = {}, routes = {}, beforeWrite, digest, legacyAuth } = {}) {
  const storage = new Map(Object.entries(stored)), requests = [], effects = [];
  const hooks = []; let cursor = 0;
  const compiled = ts.transpileModule(readFileSync(new URL("./davaqAuth.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modules = {
    "@clerk/expo": { useAuth: () => legacyAuth?.() ?? ({ isLoaded: true, isSignedIn: false }) },
    react: {
      useCallback: (value, deps) => {
        const index = cursor++, previous = hooks[index];
        if (!previous || deps.some((value, index) => value !== previous.deps[index])) hooks[index] = { value, deps };
        return hooks[index].value;
      },
      useRef: value => { const index = cursor++; return hooks[index] ??= { current: value }; },
      useEffect: effect => effects.push(effect), useSyncExternalStore: (_subscribe, get) => get(),
    },
    "react-native": { Platform: { OS: platform } },
    "expo-secure-store": {
      getItemAsync: async key => storage.get(key) ?? null,
      setItemAsync: async (key, value) => { await beforeWrite?.(key, value); storage.set(key, value); },
      deleteItemAsync: async key => { await beforeWrite?.(key, null); storage.delete(key); },
    },
    "expo-crypto": { getRandomBytes: size => new Uint8Array(size), CryptoDigestAlgorithm: { SHA256: "SHA256" }, digestStringAsync: digest ?? (async () => "c".repeat(64)) },
    "./apiBase": { getApiBase: () => "https://davaq.app" },
    "./socialVerifier": { encodeSocialVerifier: () => verifier },
  };
  const fetch = async (url, options) => {
    const path = url.split("/").at(-1), request = { path, body: JSON.parse(options.body), options };
    requests.push(request);
    assert.ok(routes[path], "Unexpected authentication request: " + path);
    return routes[path](request);
  };
  const exports = {};
  new Function("exports", "require", "fetch", "sessionStorage", compiled)(exports, name => {
    assert.ok(modules[name], "Unexpected authentication dependency: " + name);
    return modules[name];
  }, fetch, {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  });
  const renderAuth = () => {
    cursor = 0;
    const result = exports.useAuth();
    effects.splice(0).forEach(effect => effect());
    return result;
  };
  return { ...exports, storage, requests, effects, renderAuth };
}

test("provider login accepts canonical and registered legacy bridge URLs with the matching state", async () => {
  for (const origin of ["https://davaq.app", "https://davaq.anothermeai.app"]) {
    for (const returnTo of ["", "web", "legacy-web", "app"]) {
      const expected = `${origin}/api/auth/social/browser?state=${state}${returnTo ? "&returnTo=" + returnTo : ""}`;
      const auth = load({ routes: { start: () => response({ state, url: expected }) } });
      assert.equal(await auth.startSocial("google"), expected);
      assert.deepEqual(auth.requests[0].body, { provider: "google", challenge: "c".repeat(64) });
      assert.deepEqual(JSON.parse(auth.storage.get(PENDING_KEY)), { state, verifier });
    }
  }
});

test("provider URL validation rejects other hosts, paths, credentials, fragments and mismatched state", async () => {
  const invalid = [
    `https://davaq.app.attacker.test/api/auth/social/browser?state=${state}`,
    `https://attacker.test/api/auth/social/browser?state=${state}`,
    `http://davaq.app/api/auth/social/browser?state=${state}`,
    `https://davaq.app:444/api/auth/social/browser?state=${state}`,
    `https://user@davaq.app/api/auth/social/browser?state=${state}`,
    `https://@davaq.app/api/auth/social/browser?state=${state}`,
    `https://user:password@davaq.app/api/auth/social/browser?state=${state}`,
    `https://davaq.app/api/auth/social/browser/elsewhere?state=${state}`,
    `https://davaq.app/api/auth/social/browser?state=${state}#return`,
    `https://davaq.app/api/auth/social/browser?state=${state}#`,
    `https://davaq.app/api/auth/social/browser?state=${state}&next=https://attacker.test`,
    `https://davaq.app/api/auth/social/browser?state=${state}&state=${state}`,
    `https://davaq.app/api/auth/social/browser?state=${state}&returnTo=other`,
    `https://davaq.app/api/auth/social/browser?state=${state}&returnTo=`,
    `https://davaq.app/api/auth/social/browser?state=${state}&returnTo=https://attacker.test`,
    `https://davaq.app/api/auth/social/browser?state=${state}&returnTo=web&returnTo=app`,
    `https://davaq.app/api/auth/social/browser?state=${verifier}`,
    "https://davaq.app/api/auth/social/browser", "not a URL", null,
  ];
  for (const url of invalid) {
    const auth = load({ routes: { start: () => response({ state, url }) } });
    await assert.rejects(auth.startSocial("google"), /로그인 주소/);
    assert.equal(auth.storage.has(PENDING_KEY), false);
  }
  for (const invalidState of ["short", "A".repeat(42) + "/", undefined]) {
    const auth = load({ routes: { start: () => response({ state: invalidState, url: `https://davaq.app/api/auth/social/browser?state=${invalidState}` }) } });
    await assert.rejects(auth.startSocial("apple"), /로그인 주소/);
  }
});

test("account linking keeps the existing wire protocol and bearer authentication", async () => {
  const auth = load({ routes: { link: () => response({ state, url: `https://davaq.app/api/auth/social/browser?state=${state}` }) } });
  await auth.startSocial("apple", "fixture-existing-bearer");
  assert.equal(auth.requests[0].path, "link");
  assert.deepEqual(auth.requests[0].body, { provider: "apple", challenge: "c".repeat(64) });
  assert.equal(auth.requests[0].options.headers.Authorization, "Bearer fixture-existing-bearer");
});

test("a refresh 401 started before login cannot clear the newly completed web session", async () => {
  const stale = deferred(), requested = deferred();
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: {
    refresh: () => { requested.resolve(); return stale.promise; }, complete: () => response(session()),
  } });
  const refresh = auth.getSocialToken(); await requested.promise;
  assert.equal(await auth.completeSocial(), true);
  stale.resolve(response({ error: "UNAUTHORIZED" }, 401)); await refresh;
  assert.equal(auth.socialSessionIdentity()?.sessionId, "new");
  assert.equal(await auth.getSocialToken(), session().accessToken);
});

test("a successful old native refresh cannot replace a newly completed session", async () => {
  const stale = deferred(), requested = deferred();
  const auth = load({ platform: "ios", stored: { [PENDING_KEY]: pending(), [SESSION_KEY]: JSON.stringify({ refreshToken: "fixture-refresh-old" }) }, routes: {
    refresh: () => { requested.resolve(); return stale.promise; }, complete: () => response(session()),
  } });
  const refresh = auth.getSocialToken(); await requested.promise;
  assert.equal(await auth.completeSocial(), true);
  stale.resolve(response(session("old"))); await refresh;
  assert.equal(auth.socialSessionIdentity()?.sessionId, "new");
  assert.equal(JSON.parse(auth.storage.get(SESSION_KEY)).refreshToken, session().refreshToken);
});

test("fresh native installs can refresh after their first completed login expires", async () => {
  const auth = load({ platform: "android", stored: { [PENDING_KEY]: pending() }, routes: {
    complete: () => response(session("new", Date.now() - 1)), refresh: () => response(session("renewed")),
  } });
  assert.equal(await auth.getSocialToken(), null);
  assert.equal(await auth.completeSocial(), true);
  assert.equal(await auth.getSocialToken(), session("renewed").accessToken);
  assert.equal(auth.requests.filter(request => request.path === "refresh").length, 1);
});

test("corrupt persisted native session JSON does not leave refresh permanently latched", async () => {
  const auth = load({ platform: "ios", stored: { [PENDING_KEY]: pending(), [SESSION_KEY]: "{broken" }, routes: {
    complete: () => response(session("new", Date.now() - 1)), refresh: () => response(session("renewed")),
  } });
  assert.equal(await auth.getSocialToken(), null);
  assert.equal(await auth.completeSocial(), true);
  assert.equal(await auth.getSocialToken(), session("renewed").accessToken);
});

test("malformed pending login data is discarded without a completion request", async () => {
  for (const value of ["{broken", "null", '"text"', JSON.stringify({ state: "invalid", verifier }), JSON.stringify({ state, verifier: 12 })]) {
    const auth = load({ stored: { [PENDING_KEY]: value } });
    assert.equal(await auth.completeSocial(), false);
    assert.equal(auth.storage.has(PENDING_KEY), false);
    assert.equal(auth.requests.length, 0);
  }
});

test("logout during a native credential write cannot resurrect the completed session", async () => {
  const write = deferred(), writing = deferred(); let blocked = false;
  const auth = load({ platform: "ios", stored: { [PENDING_KEY]: pending() }, beforeWrite: async (key, value) => {
    if (key === SESSION_KEY && value && !blocked) { blocked = true; writing.resolve(); await write.promise; }
  }, routes: { complete: () => response(session()), logout: () => response(null, 204) } });
  const completion = auth.completeSocial(); await writing.promise;
  const logout = auth.socialSignOut(); write.resolve();
  assert.equal(await completion, false); await logout;
  assert.equal(auth.socialSessionIdentity(), null);
  assert.equal(auth.storage.has(SESSION_KEY), false);
});

test("serialized native writes preserve the latest login after an older refresh write finishes", async () => {
  const write = deferred(), writing = deferred(), completing = deferred(); let blocked = false;
  const auth = load({ platform: "android", stored: { [PENDING_KEY]: pending(), [SESSION_KEY]: JSON.stringify({ refreshToken: "fixture-refresh-old" }) }, beforeWrite: async (key, value) => {
    if (key === SESSION_KEY && value && !blocked) { blocked = true; writing.resolve(); await write.promise; }
  }, routes: { refresh: () => response(session("old")), complete: () => { completing.resolve(); return response(session()); } } });
  const refresh = auth.getSocialToken(); await writing.promise;
  const completion = auth.completeSocial(); await completing.promise;
  // Let the completion invalidate the older generation before releasing storage.
  await Promise.resolve(); await Promise.resolve(); write.resolve();
  await refresh; assert.equal(await completion, true);
  assert.equal(auth.socialSessionIdentity()?.sessionId, "new");
  assert.equal(JSON.parse(auth.storage.get(SESSION_KEY)).refreshToken, session().refreshToken);
});

test("concurrent callback checks consume a pending attempt only once", async () => {
  const completion = deferred(), requested = deferred();
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: { complete: () => { requested.resolve(); return completion.promise; } } });
  const first = auth.completeSocial(), second = auth.completeSocial();
  assert.equal(first, second); await requested.promise;
  completion.resolve(response(session()));
  assert.equal(await first, true); assert.equal(await second, true);
  assert.equal(auth.requests.length, 1);
});

test("completion waiting polls a pending attempt until the provider has finished", async () => {
  let calls = 0;
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: {
    complete: () => ++calls < 3 ? response({ pending: true }, 202) : response(session()),
  } });
  assert.equal(await auth.waitForSocialCompletion({ timeoutMs: 3000 }), true);
  assert.equal(calls, 3);
  assert.equal(auth.socialSessionIdentity()?.sessionId, "new");
  assert.equal(auth.storage.has(PENDING_KEY), false);
});

test("completion waiting retries a shared in-flight 202 instead of treating it as failure", async () => {
  const firstResponse = deferred(), requested = deferred(); let calls = 0;
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: {
    complete: () => { if (++calls === 1) { requested.resolve(); return firstResponse.promise; } return response(session()); },
  } });
  const foregroundCheck = auth.completeSocial(); await requested.promise;
  const callbackCheck = auth.waitForSocialCompletion({ timeoutMs: 2000 });
  firstResponse.resolve(response({ pending: true }, 202));
  assert.equal(await foregroundCheck, false);
  assert.equal(await callbackCheck, true);
  assert.equal(calls, 2);
});

test("completion waiting stops promptly when aborted during an in-flight request", async () => {
  const held = deferred(), requested = deferred(), controller = new AbortController();
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: {
    complete: () => { requested.resolve(); return held.promise; },
  } });
  const wait = auth.waitForSocialCompletion({ signal: controller.signal }); await requested.promise;
  controller.abort(); assert.equal(await wait, false);
  held.resolve(response({ pending: true }, 202));
  await auth.completeSocial();
  assert.equal(auth.requests.length, 1);
  assert.equal(auth.storage.has(PENDING_KEY), true);
});

test("completion waiting is bounded even while the shared request is still in flight", async () => {
  const held = deferred();
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: { complete: () => held.promise } });
  assert.equal(await auth.waitForSocialCompletion({ timeoutMs: 20 }), false);
  held.resolve(response({ pending: true }, 202)); await auth.completeSocial();
  assert.equal(auth.requests.length, 1);
});

test("completion waiting returns false without requests for missing, corrupt or cancelled attempts", async () => {
  for (const stored of [{}, { [PENDING_KEY]: "{broken" }]) {
    const auth = load({ stored });
    assert.equal(await auth.waitForSocialCompletion(), false);
    assert.equal(auth.requests.length, 0);
  }
  const controller = new AbortController(); controller.abort();
  const auth = load({ stored: { [PENDING_KEY]: pending() } });
  assert.equal(await auth.waitForSocialCompletion({ signal: controller.signal }), false);
  assert.equal(await auth.waitForSocialCompletion({ timeoutMs: 0 }), false);
  assert.equal(auth.requests.length, 0);
});

test("a callback waiter recognizes a social login already completed by another caller", async () => {
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: { complete: () => response(session()) } });
  assert.equal(await auth.completeSocial(), true);
  assert.equal(auth.storage.has(PENDING_KEY), false);
  assert.equal(await auth.waitForSocialCompletion(), true);
  assert.equal(auth.requests.length, 1);
});

test("a new login keeps completion HTTP requests serialized and preserves its pending data", async () => {
  const oldResult = deferred(), oldRequested = deferred(), newResult = deferred(), newRequested = deferred();
  const newState = "C".repeat(43); let completions = 0;
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: {
    start: () => response({ state: newState, url: `https://davaq.app/api/auth/social/browser?state=${newState}&returnTo=web` }),
    complete: () => { if (++completions === 1) { oldRequested.resolve(); return oldResult.promise; } newRequested.resolve(); return newResult.promise; },
  } });
  const old = auth.completeSocial(); await oldRequested.promise;
  await auth.startSocial("google");
  assert.equal(auth.completeSocial(), old);
  assert.equal(completions, 1);
  oldResult.resolve(response(session("old")));
  assert.equal(await old, false);
  assert.equal(auth.socialSessionIdentity(), null);
  assert.equal(JSON.parse(auth.storage.get(PENDING_KEY)).state, newState);
  const fresh = auth.completeSocial(); await newRequested.promise;
  assert.equal(auth.completeSocial(), fresh);
  newResult.resolve(response(session()));
  assert.equal(await fresh, true);
  assert.equal(auth.socialSessionIdentity()?.sessionId, "new");
  assert.equal(completions, 2);
});

test("the newer of two overlapping login starts owns the pending attempt", async () => {
  const oldResponse = deferred(), oldRequested = deferred(); let starts = 0;
  const newState = "C".repeat(43);
  const auth = load({ routes: { start: () => {
    if (++starts === 1) { oldRequested.resolve(); return oldResponse.promise; }
    return response({ state: newState, url: `https://davaq.app/api/auth/social/browser?state=${newState}` });
  } } });
  const old = auth.startSocial("google"); await oldRequested.promise;
  await auth.startSocial("apple");
  oldResponse.resolve(response({ state, url: `https://davaq.app/api/auth/social/browser?state=${state}` }));
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(JSON.parse(auth.storage.get(PENDING_KEY)).state, newState);
});

test("an aborted start forwards cancellation and cannot overwrite a newer pending attempt", async () => {
  const oldResponse = deferred(), oldRequested = deferred(), controller = new AbortController(); let starts = 0;
  const newState = "C".repeat(43);
  const auth = load({ routes: { start: () => {
    if (++starts === 1) { oldRequested.resolve(); return oldResponse.promise; }
    return response({ state: newState, url: `https://davaq.app/api/auth/social/browser?state=${newState}` });
  } } });
  const old = auth.startSocial("google", null, { signal: controller.signal }); await oldRequested.promise;
  controller.abort(); assert.equal(auth.requests[0].options.signal.aborted, true);
  await auth.startSocial("apple");
  oldResponse.resolve(response({ state, url: `https://davaq.app/api/auth/social/browser?state=${state}` }));
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(JSON.parse(auth.storage.get(PENDING_KEY)).state, newState);
});

test("cancellation during challenge creation makes no login request or pending write", async () => {
  const challenge = deferred(), hashing = deferred(), controller = new AbortController();
  const auth = load({ stored: { [PENDING_KEY]: pending() }, digest: () => { hashing.resolve(); return challenge.promise; } });
  const start = auth.startSocial("google", null, { signal: controller.signal }); await hashing.promise;
  controller.abort(); challenge.resolve("c".repeat(64));
  await assert.rejects(start, { name: "AbortError" });
  assert.equal(auth.requests.length, 0);
  assert.equal(auth.storage.has(PENDING_KEY), false);
});

test("an already aborted start leaves an existing attempt untouched", async () => {
  const controller = new AbortController(); controller.abort();
  const auth = load({ stored: { [PENDING_KEY]: pending() } });
  await assert.rejects(auth.startSocial("google", null, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(auth.storage.get(PENDING_KEY), pending());
  assert.equal(auth.requests.length, 0);
});

test("logout fences a login start whose server response arrives late", async () => {
  const held = deferred(), requested = deferred();
  const auth = load({ routes: {
    start: () => { requested.resolve(); return held.promise; }, logout: () => response(null, 204),
  } });
  const start = auth.startSocial("google"); await requested.promise;
  await auth.socialSignOut();
  held.resolve(response({ state, url: `https://davaq.app/api/auth/social/browser?state=${state}` }));
  await assert.rejects(start, { name: "AbortError" });
  assert.equal(auth.storage.has(PENDING_KEY), false);
  assert.equal(auth.socialSessionIdentity(), null);
});

test("an aborted native pending write cannot replace the following login attempt", async () => {
  const writing = deferred(), write = deferred(), controller = new AbortController(); let blocked = false, starts = 0;
  const newState = "C".repeat(43);
  const auth = load({ platform: "ios", beforeWrite: async (key, value) => {
    if (key === PENDING_KEY && value && !blocked) { blocked = true; writing.resolve(); await write.promise; }
  }, routes: { start: () => {
    const nextState = ++starts === 1 ? state : newState;
    return response({ state: nextState, url: `https://davaq.app/api/auth/social/browser?state=${nextState}` });
  } } });
  const old = auth.startSocial("google", null, { signal: controller.signal }); await writing.promise;
  controller.abort();
  const fresh = auth.startSocial("apple"); write.resolve();
  await assert.rejects(old, { name: "AbortError" }); await fresh;
  assert.equal(JSON.parse(auth.storage.get(PENDING_KEY)).state, newState);
});

test("expired and failed completion errors provide readable recovery messages", async () => {
  for (const [error, status, expected] of [["INVALID_ATTEMPT", 400, /로그인 요청이 만료/], ["AUTH_FAILED", 500, /잠시 후 다시 시도/]]) {
    const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: { complete: () => response({ error }, status) } });
    await assert.rejects(auth.completeSocial(), expected);
  }
});

test("web logout waits for an earlier completion response before clearing its cookie", async () => {
  const held = deferred(), requested = deferred();
  const auth = load({ stored: { [PENDING_KEY]: pending() }, routes: {
    complete: () => { requested.resolve(); return held.promise; }, logout: () => response(null, 204),
  } });
  const completion = auth.completeSocial(); await requested.promise;
  const logout = auth.socialSignOut();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(auth.requests.filter(request => request.path === "logout").length, 0);
  held.resolve(response(session("old")));
  assert.equal(await completion, false); await logout;
  assert.deepEqual(auth.requests.map(request => request.path), ["complete", "logout"]);
  assert.equal(auth.socialSessionIdentity(), null);
  assert.equal(auth.storage.has(PENDING_KEY), false);
});

test("native logout does not wait for an unrelated in-flight browser completion", async () => {
  const held = deferred(), requested = deferred();
  const auth = load({ platform: "android", stored: { [PENDING_KEY]: pending() }, routes: {
    complete: () => { requested.resolve(); return held.promise; }, logout: () => response(null, 204),
  } });
  const completion = auth.completeSocial(); await requested.promise;
  await auth.socialSignOut();
  assert.deepEqual(auth.requests.map(request => request.path), ["complete", "logout"]);
  held.resolve(response(session("old"))); assert.equal(await completion, false);
  assert.equal(auth.socialSessionIdentity(), null);
});

test("login request timeout still covers a response body after headers arrive", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const parsing = deferred();
  const auth = load({ routes: { start: request => ({
    ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => {
      request.options.signal.addEventListener("abort", () => reject(Object.assign(new Error("fixture abort"), { name: "AbortError" })), { once: true });
      parsing.resolve();
    }),
  }) } });
  const start = auth.startSocial("google"); await parsing.promise;
  context.mock.timers.tick(15_000);
  await assert.rejects(start, { name: "AbortError" });
  assert.equal(auth.storage.has(PENDING_KEY), false);
  context.mock.timers.reset();
});

test("legacy token wrapper rerenders keep one API getter while using the latest committed delegate", async () => {
  const delegates = []; let revision = 1;
  const auth = load({ platform: "android", stored: { [PENDING_KEY]: pending() }, routes: { complete: () => response(session()) }, legacyAuth: () => {
    const current = revision;
    return { isLoaded: true, isSignedIn: true, sessionId: "legacy-session", userId: "legacy-user", getToken: async options => { delegates.push({ revision: current, options }); return `fixture-legacy-${current}`; } };
  } });
  const first = auth.renderAuth();
  assert.equal(await first.getToken({ template: "fixture" }), "fixture-legacy-1");
  revision = 2;
  const second = auth.renderAuth();
  assert.equal(second.getToken, first.getToken);
  assert.equal(await first.getToken(), "fixture-legacy-2");
  assert.deepEqual(delegates, [{ revision: 1, options: { template: "fixture" } }, { revision: 2, options: undefined }]);
  assert.equal(await auth.completeSocial(), true);
  const social = auth.renderAuth();
  assert.equal(social.getToken, first.getToken);
  assert.equal(await social.getToken(), session().accessToken);
  assert.equal(delegates.length, 2);
});

test("actual API bridge retains ready queries across legacy wrapper rerenders and resets on identity change", async () => {
  let identity = "one";
  const auth = load({ platform: "android", legacyAuth: () => ({ isLoaded: true, isSignedIn: true, sessionId: `session-${identity}`, userId: `user-${identity}`, getToken: async () => `fixture-${identity}` }) });
  auth.renderAuth(); await new Promise(setImmediate);
  let current, ready = null, previousDeps, cleanup, effect;
  const installations = [];
  const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  const source = layout.slice(layout.indexOf("function ApiAuthBridge("), layout.indexOf("function SessionQueryProvider("));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => ({ type, props });
  const Bridge = new Function("exports", "require", "useAuth", "useState", "useEffect", "setAuthTokenGetter", "setCharacterProfileIdGetter", "StartupSplash", compiled + ";return ApiAuthBridge;")(
    {}, () => ({ jsx, jsxs: jsx, Fragment: "Fragment" }), () => current,
    () => [ready, value => { ready = value; }],
    (callback, deps) => { if (!previousDeps || deps.some((value, index) => value !== previousDeps[index])) { previousDeps = deps; effect = callback; } },
    value => installations.push(value), () => {}, "StartupSplash",
  );
  const render = () => { current = auth.renderAuth(); return Bridge({ children: "ready-content" }); };
  const commit = () => { if (effect) { cleanup?.(); const next = effect; effect = undefined; cleanup = next(); } };
  assert.equal(render().type, "StartupSplash"); commit();
  assert.equal(render().props.children, "ready-content"); commit();
  for (let index = 0; index < 5; index++) { assert.equal(render().props.children, "ready-content"); commit(); }
  assert.equal(installations.length, 1);
  assert.equal(typeof installations[0], "function");
  identity = "two";
  assert.equal(render().type, "StartupSplash"); commit();
  assert.equal(render().props.children, "ready-content"); commit();
  assert.equal(installations.length, 3);
  assert.equal(installations[1], null);
  assert.equal(typeof installations[2], "function");
});
