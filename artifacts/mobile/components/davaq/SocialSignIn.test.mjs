import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function moduleFor(name, signIn) {
  const source = readFileSync(new URL(`../../app/(auth)/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    "react": {}, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { StyleSheet: { create: value => value }, Text: "Text", View: "View" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) },
    "@/components/CustomScroll": { CustomScrollView: "CustomScrollView" },
    "@/hooks/useColors": { useColors: () => ({ background: "white", foreground: "black", mutedForeground: "gray" }) },
    "@/components/davaq/SocialLoginButtons": { SocialLoginButtons: "SocialLoginButtons" },
    "expo-router": { Redirect: "Redirect" },
    "./sign-in": { default: signIn },
  };
  return new Function("exports", "require", compiled + ";return exports.default;")({}, name => {
    assert.ok(modules[name], "Unexpected sign-in dependency: " + name);
    return modules[name];
  });
}
function flatten(node) {
  return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [node];
}

test("sign in presents provider login and existing-data guidance without password/email inputs", () => {
  const screen = moduleFor("sign-in")();
  const nodes = flatten(screen);
  assert.equal(nodes.filter(node => node?.type === "SocialLoginButtons").length, 1);
  assert.equal(nodes.filter(node => node?.type === "TextInput").length, 0);
  const text = nodes.filter(node => typeof node === "string").join(" ");
  assert.match(text, /Google·Apple/);
  assert.match(text, /같은 계정/);
  assert.match(text, /카드와 채팅 기록/);
  assert.doesNotMatch(text, /비밀번호|이메일 또는 아이디|인증 코드/);
});

test("sign up reuses the same provider-only entry", () => {
  const signIn = moduleFor("sign-in");
  assert.equal(moduleFor("sign-up", signIn), signIn);
});

test("legacy password-recovery links redirect to provider sign in", () => {
  const node = moduleFor("forgot-password")();
  assert.equal(node.type, "Redirect");
  assert.equal(node.props.href, "/(auth)/sign-in");
});

function providerModule(states = []) {
  const source = readFileSync(new URL("./SocialLoginButtons.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => ({ type, props });
  const updates = []; let stateIndex = 0;
  const modules = {
    react: { useEffect() {}, useRef: value => ({current: value}), useState: initial => { const index = stateIndex++; return [index in states ? states[index] : initial, value => updates.push({index, value})]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "ActivityIndicator", AppState: {}, Platform: {OS: "web"}, Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: {create: value => value} },
    "expo-web-browser": {}, "expo-router": { useRouter: () => ({}) },
    "@/lib/davaqAuth": { useAuth: () => ({isLoaded: true}) },
    "@/lib/apiBase": { getApiBase: () => "https://davaq.app" },
  };
  const exports = new Function("exports", "require", compiled + ";return exports;")({}, name => {
    assert.ok(modules[name], "Unexpected social dependency: " + name);
    return modules[name];
  });
  return { ...exports, updates };
}

test("provider loading forwards cancellation and can succeed after a failed request", async () => {
  const {loadSocialProviders} = providerModule();
  const original = globalThis.fetch, signal = new AbortController().signal;
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://davaq.app/api/auth/social/providers"); assert.equal(options.signal, signal);
    return ++attempts === 1 ? {ok: false} : {ok: true, json: async () => ({google: true, apple: true})};
  };
  try {
    await assert.rejects(loadSocialProviders(signal), /연결하지 못했어요/);
    assert.deepEqual(await loadSocialProviders(signal), {google: true, apple: true});
    globalThis.fetch = async () => ({ok: true, json: async () => ({google: "yes", apple: false})});
    await assert.rejects(loadSocialProviders(signal), /확인하지 못했어요/);
  } finally { globalThis.fetch = original; }
});

test("a failed provider lookup exposes a working retry without email fallback", () => {
  const module = providerModule([false, "", {google: false, apple: false}, "네트워크를 확인하고 다시 시도해 주세요.", false, 0]);
  const nodes = flatten(module.SocialLoginButtons({}));
  const retry = nodes.find(node => node?.type === "Pressable" && flatten(node).includes("로그인 연결 다시 확인"));
  assert.ok(retry); assert.equal(retry.props.disabled, false);
  retry.props.onPress();
  assert.equal(module.updates[0].index, 5); assert.equal(module.updates[0].value(0), 1);
  assert.ok(nodes.some(node => node?.props?.accessibilityRole === "alert"));
  assert.equal(nodes.filter(node => node?.type === "TextInput").length, 0);
});
