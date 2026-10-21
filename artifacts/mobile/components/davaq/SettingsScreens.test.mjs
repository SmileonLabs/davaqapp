import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const legal = {};
vm.runInNewContext(compile("../../lib/davaqLegal.ts"), { exports: legal });
function fixture(platform, { supported = false, granted = false, openResult = true, consentAllowed = true } = {}) {
  const states = [], effects = [], appStateListeners = [], urls = [], mutations = [], consentChecks = [];
  let cursor = 0, effectMounted = false, launches = 0, queries = 0, failLink = false;
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: {
      useCallback: fn => fn,
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useEffect: effect => { if (!effectMounted) effects.push(effect); },
    },
    "react-native": {
      Platform: { OS: platform }, View: "View", Pressable: "Pressable",
      Linking: { openURL: async url => { urls.push(url); if (failLink) throw new Error("cannot open"); } },
      AppState: { addEventListener: (_event, handler) => { appStateListeners.push(handler); return { remove() {} }; } },
    },
    "expo-router": { useFocusEffect: fn => fn(), useRouter: () => ({ push() {}, replace() {} }) },
    "expo-image": { Image: {} },
    "@/components/Avatar": { Avatar: "Avatar" },
    "@/hooks/useCharacterProfiles": { useCharacterProfiles: () => ({ activeProfile: { profileImageUrl: "/objects/selected-photo" }, refetch: async () => {} }) },
    "@/lib/chatVideoCache": {}, "@/lib/chatMessageOutbox": {}, "@/lib/nativePush": {},
    "@/lib/applePush": {}, "@/lib/pushOwnership": {},
    "@/lib/davaqAuth": { useAuth: () => ({}) },
    "@workspace/api-client-react": { useGetMe: () => ({ data: { id: "review-user", nickname: "review" } }) },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "./SocialLoginButtons": { SocialLoginButtons: "SocialLoginButtons" },
    "@/hooks/useKnowledge": { useKnowledgeAdminMe: () => ({}) },
    "@/lib/davaq": {
      useDavaqMutation: () => ({ mutateAsync: value => { mutations.push(value); } }),
      errorText: String,
    },
    "@/lib/davaqLegal": legal,
    "@/components/UgcConsentPrompt": { UgcConsentPrompt: "UgcConsentPrompt", useUgcConsent: owner => ({ ensureConsent: async () => { consentChecks.push(owner); return consentAllowed; }, promptProps: {} }) },
    "@/lib/androidTelecom": {
      getFullScreenCallAccess: async () => { queries++; return { supported, granted }; },
      openFullScreenCallSettings: async () => { launches++; return openResult; },
    },
    "./UI": { C: {}, S: {}, ...Object.fromEntries(["Txt", "Frame", "Button", "Field", "Section", "QueryState", "Notice", "Cue"].map(name => [name, name])) },
  };
  const module = {};
  vm.runInNewContext(compile("./SettingsScreens.tsx"), {
    exports: module,
    require: name => { assert.ok(dependencies[name], "Unexpected dependency: " + name); return dependencies[name]; },
    console,
  });
  return {
    urls, mutations, consentChecks,
    render(props) { cursor = 0; return module.SettingsScreen(props); },
    profileRender() { cursor = 0; return module.ProfileEditor(); },
    mount() { effectMounted = true; return effects.map(effect => effect()); },
    active() { appStateListeners.forEach(listener => listener("active")); },
    setGranted(value) { granted = value; },
    failLink() { failLink = true; },
    get launches() { return launches; }, get queries() { return queries; },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && node.props.label === label);
const text = tree => nodes(tree).filter(node => node.type === "Notice").map(node => [node.props.children].flat(Infinity).join("")).join(" ");
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("settings exposes verified privacy and deletion-request pages on every platform without deleting an account", async () => {
  for (const platform of ["android", "ios", "web"]) {
    const f = fixture(platform);
    const tree = f.render();
    await button(tree, "개인정보처리방침").props.onPress();
    await button(tree, "계정·데이터 삭제 요청").props.onPress();
    await flush();
    assert.deepEqual(f.urls, [legal.DAVAQ_LEGAL_URLS.privacy, legal.DAVAQ_LEGAL_URLS.accountDeletion]);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.urls.some(url => url.startsWith("https://davaq.app/")), false);
    assert.equal(f.urls.some(url => url.includes("terms")), false);
  }
});

test("legal page opening failure keeps a visible support email fallback", async () => {
  const f = fixture("web"); f.failLink();
  button(f.render(), "계정·데이터 삭제 요청").props.onPress();
  await flush();
  assert.match(text(f.render()), /contact@smileon\.app/);
  assert.equal(f.mutations.length, 0);
});

test("account linking describes the current DavaQ account instead of claiming AnotherMe login sharing", () => {
  const tree = fixture("web").render();
  assert.match(text(tree), /Google·Apple 로그인 계정을 현재 DAVAQ 계정에 연결/);
  assert.equal(text(tree).includes("AnotherMe"), false);
  const social = nodes(tree).find(node => node.type === "SocialLoginButtons");
  assert.equal(social.props.link, true);
});

test("Android supported access opens only after user tap and refreshes when returning from settings", async () => {
  const f = fixture("android", { supported: true }); f.render(); f.mount();
  await flush();
  assert.equal(f.queries, 1); assert.equal(f.launches, 0);
  const tree = f.render();
  assert.match(text(tree), /허용하지 않아도 일반 수신 전화 알림/);
  button(tree, "수신 전화 전체 화면 설정").props.onPress(); await flush();
  assert.equal(f.launches, 1);
  f.setGranted(true); f.active(); await flush();
  assert.match(text(f.render()), /전체 화면 수신 전화가 허용되어 있습니다/);
});

test("unsupported native builds and iOS/web leave full-screen controls hidden and launch failure remains recoverable", async () => {
  for (const platform of ["android", "ios", "web"]) {
    const f = fixture(platform); f.render(); f.mount(); await flush();
    assert.equal(button(f.render(), "수신 전화 전체 화면 설정"), undefined);
    assert.equal(f.queries, platform === "android" ? 1 : 0);
    assert.equal(f.launches, 0);
  }
  const f = fixture("android", { supported: true, openResult: false }); f.render(); f.mount(); await flush();
  button(f.render(), "수신 전화 전체 화면 설정").props.onPress(); await flush();
  assert.match(text(f.render()), /설정을 열지 못했습니다/);
  assert.ok(button(f.render(), "알림 설정"));
});

test("canceling profile writing consent preserves the draft and makes no profile mutation", async () => {
  const f = fixture("web", { consentAllowed: false });
  f.profileRender(); f.mount();
  let tree = f.profileRender();
  const name = nodes(tree).find(node => node.type === "Field" && node.props.label === "이름");
  name.props.onChangeText("draft collector"); tree = f.profileRender();
  button(tree, "저장").props.onPress(); await flush();
  assert.deepEqual(f.consentChecks, ["review-user"]);
  assert.equal(f.mutations.length, 0);
  tree = f.profileRender();
  assert.equal(nodes(tree).find(node => node.type === "Field" && node.props.label === "이름").props.value, "draft collector");
  assert.ok(nodes(tree).some(node => node.type === "UgcConsentPrompt"));
});

test("accepted profile writing uses the existing DavaQ profile update flow", async () => {
  const f = fixture("web"); f.profileRender(); f.mount();
  button(f.profileRender(), "저장").props.onPress(); await flush();
  assert.deepEqual(f.consentChecks, ["review-user"]);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.mutations[0].path, "/users/me");
  assert.equal(f.mutations[0].method, "PATCH");
  assert.equal(f.mutations[0].body.nickname, "review");
});

test("settings uses the actual profile portrait and exposes photo editing instead of a fixed mascot", () => {
 const f=fixture("ios");const nodes=[];
 const visit=x=>{if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==="object"){nodes.push(x);visit(x.props?.children)}};visit(f.render());
 assert.equal(nodes.find(x=>x.type==="Avatar").props.uri,"/objects/selected-photo");
 assert.equal(nodes.some(x=>x.type==="Cue"),false);
 assert(nodes.some(x=>x.props?.accessibilityLabel==="프로필 사진 변경"));
});

test("bottom settings tab uses its own title without a stack back button", () => { const tree = fixture("ios").render({ tab: true }); const frame = nodes(tree).find(n => n.type === "Frame"); assert.equal(frame.props.title, "설정"); assert.equal(frame.props.back, false); });
