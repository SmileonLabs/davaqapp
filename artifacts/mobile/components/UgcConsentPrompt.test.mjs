import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => {
    assert.ok(dependencies[name], "Unexpected dependency: " + name); return dependencies[name];
  }, Date, Promise });
  return exports;
}
const legal = load("../lib/davaqLegal.ts", {});
const rules = load("../lib/davaqCommunityRules.ts", { "./davaqLegal": legal });
function fixture(platform = "web") {
  const values = new Map(), slots = [], effects = [], opened = [];
  let cursor = 0, failLink = false, keyboardDismissals = 0;
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };
  const consent = load("../lib/ugcConsent.ts", {
    "@react-native-async-storage/async-storage": { default: storage },
    "./davaqCommunityRules": rules,
  });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => previous.dependencies[i] !== value)) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: effect() }; });
      }
    },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
    useCallback(callback) { return callback; },
  };
  const jsx = (type, props) => ({ type, props });
  const module = load("./UgcConsentPrompt.tsx", {
    react: { default: react, ...react },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Platform: { OS: platform },
      Keyboard: { dismiss: () => { keyboardDismissals++; } },
      ...Object.fromEntries(["ActivityIndicator", "Modal", "Pressable", "ScrollView", "Text", "View"].map(name => [name, name])),
      StyleSheet: { create: value => value },
      Linking: { openURL: async url => { opened.push(url); if (failLink) throw new Error("link failed"); } },
    },
    "@expo/vector-icons": { Feather: "Feather" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 60, bottom: 34 }) },
    "@/hooks/useColors": { useColors: () => ({}) },
    "@/lib/davaqLegal": legal,
    "@/lib/davaqCommunityRules": rules,
    "@/lib/ugcConsent": consent,
  });
  return {
    values, opened,
    get keyboardDismissals() { return keyboardDismissals; },
    render(props) { cursor = 0; return module.UgcConsentPrompt(props); },
    hook(owner, options) { cursor = 0; return module.useUgcConsent(owner, options); },
    commit() { while (effects.length) effects.shift()(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    failLink() { failLink = true; },
  };
}
const flatten = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
const allText = node => flatten(node).filter(child => child.type === "Text").map(child => [child.props.children].flat(Infinity).filter(value => typeof value === "string").join("")).join(" ");
const button = (tree, label) => flatten(tree).find(child => child.type === "Pressable" && allText(child).includes(label));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const props = overrides => ({ ownerId: "db-account-A", visible: true, busy: false, error: "", onAccept: async () => {}, onCancel() {}, ...overrides });

test("agreement requires an unchecked-by-default explicit choice and full rules are available inside the app", async () => {
  const f = fixture(), accepted = [], p = props({ onAccept: async checked => { accepted.push(checked); } });
  let tree = f.render(p); f.commit();
  assert.equal(f.keyboardDismissals, 1);
  assert.equal(button(tree, "동의하고 계속").props.disabled, true);
  assert.equal(flatten(tree).find(node => node.props?.accessibilityRole === "checkbox").props.accessibilityState.checked, false);
  button(tree, "전체 보기").props.onPress();
  tree = f.render(p); f.commit();
  const content = allText(tree);
  for (const section of rules.DAVAQ_COMMUNITY_RULES) {
    assert.ok(content.includes(section.title));
    for (const paragraph of section.paragraphs) assert.ok(content.includes(paragraph));
  }
  assert.equal(content.includes("운영자 검토용 초안"), rules.DAVAQ_COMMUNITY_RULES_IS_DRAFT);
  flatten(tree).find(node => node.props?.accessibilityRole === "checkbox").props.onPress();
  tree = f.render(p); f.commit();
  assert.equal(button(tree, "동의하고 계속").props.disabled, false);
  await button(tree, "동의하고 계속").props.onPress();
  assert.deepEqual(accepted, [true]);
});

test("cancel and native back dismiss without agreement; saving prevents duplicate cancellation", () => {
  const f = fixture(); let cancels = 0;
  const p = props({ onCancel: () => { cancels++; } });
  let tree = f.render(p); f.commit();
  button(tree, "지금은 취소").props.onPress(); tree.props.onRequestClose(); assert.equal(cancels, 2);
  tree = f.render({ ...p, busy: true }); f.commit();
  tree.props.onRequestClose(); button(tree, "지금은 취소").props.onPress();
  assert.equal(cancels, 2);
  const confirm = flatten(tree).find(node => node.type === "Pressable" && node.props?.accessibilityState?.busy === true);
  assert.equal(confirm.props.disabled, true);
});

test("a hidden prompt does not dismiss the writing keyboard while browsing or typing", () => {
  const f = fixture(); f.render(props({ visible: false, ownerId: null })); f.commit();
  assert.equal(f.keyboardDismissals, 0);
});

test("switching the prompt account resets the checkbox; legal links show a support fallback if they fail", async () => {
  const f = fixture(), p = props(); let tree = f.render(p); f.commit();
  flatten(tree).find(node => node.props?.accessibilityRole === "checkbox").props.onPress();
  f.render({ ...p, ownerId: "db-account-B" }); f.commit();
  tree = f.render({ ...p, ownerId: "db-account-B" });
  assert.equal(button(tree, "동의하고 계속").props.disabled, true);
  button(tree, "전체 보기").props.onPress(); tree = f.render({ ...p, ownerId: "db-account-B" });
  f.failLink(); button(tree, "개인정보처리방침").props.onPress(); await flush();
  assert.ok(allText(f.render({ ...p, ownerId: "db-account-B" })).includes("contact@smileon.app"));
  assert.deepEqual(f.opened, [legal.DAVAQ_LEGAL_URLS.privacy]);
});

test("hook leaves browsing idle and cancels old-account writing actions on identity change or unmount", async () => {
  const f = fixture(); let hook = f.hook("db-account-A"); f.commit();
  assert.equal(hook.promptProps.visible, false); assert.equal(f.values.size, 0);
  const oldAction = hook.ensureConsent(); await flush();
  hook = f.hook("db-account-B");
  assert.equal(hook.promptProps.visible, false); f.commit();
  assert.equal(await oldAction, false);
  const newAction = hook.ensureConsent(); await flush(); hook = f.hook("db-account-B"); f.commit();
  assert.equal(hook.promptProps.visible, true);
  f.unmount(); assert.equal(await newAction, false);
  assert.equal(await hook.ensureConsent(), false);
  assert.equal(f.values.size, 0);
});

test("hook resolves true only after explicit persisted consent and rechecks the active account", async () => {
  const f = fixture(); let hook = f.hook("db-account-A"); f.commit();
  const action = hook.ensureConsent(); await flush(); hook = f.hook("db-account-A"); f.commit();
  await hook.promptProps.onAccept(true); assert.equal(await action, true);
  assert.equal(f.values.size, 1);
  assert.equal(await hook.ensureConsent(), true);
  f.hook(null); f.commit();
  assert.equal(await hook.ensureConsent(), false);
});

test("iOS first consent waits for native Modal dismissal before allowing another modal, saved consent stays immediate", async () => {
  const f = fixture("ios"); let hook = f.hook("db-account-A"); f.commit();
  let resolved = false;
  const action = hook.ensureConsent(); void action.then(() => { resolved = true; });
  await flush(); hook = f.hook("db-account-A"); f.commit();
  await hook.promptProps.onAccept(true); await flush();
  assert.equal(resolved, false);
  hook = f.hook("db-account-A"); f.commit();
  assert.equal(hook.promptProps.visible, false);
  hook.promptProps.onDismiss(); assert.equal(await action, true);
  assert.equal(await hook.ensureConsent(), true);
});

test("iOS modal dismissal wait is canceled safely by account change and screen unmount", async () => {
  for (const terminate of ["switch", "unmount"]) {
    const f = fixture("ios"); let hook = f.hook("db-account-A"); f.commit();
    const action = hook.ensureConsent(); await flush(); hook = f.hook("db-account-A"); f.commit();
    await hook.promptProps.onAccept(true); await flush();
    if (terminate === "switch") { f.hook("db-account-B"); f.commit(); }
    else f.unmount();
    assert.equal(await action, false);
  }
});

test("inline presentation uses only an in-place overlay inside an existing modal and iOS never waits for native dismissal", async () => {
  const f = fixture("ios"), options = { presentation: "inline" };
  let hook = f.hook("db-account-A", options); f.commit();
  const action = hook.ensureConsent(); await flush(); hook = f.hook("db-account-A", options); f.commit();
  assert.equal(hook.promptProps.presentation, "inline");
  await hook.promptProps.onAccept(true); assert.equal(await action, true);
  const ui = fixture("ios");
  assert.equal(ui.render(props({ presentation: "inline", visible: false })), null); ui.commit();
  const overlay = ui.render(props({ presentation: "inline" })); ui.commit();
  assert.equal(overlay.type, "View");
  assert.equal(flatten(overlay).some(node => node.type === "Modal"), false);
  assert.ok(overlay.props.style.some(style => style?.position === "absolute" && style.top === 0 && style.bottom === 0));
});

test("a stale previous-account prompt cannot accept or cancel the current account", async () => {
  const f = fixture(); let hook = f.hook("db-account-A"); f.commit();
  const previous = hook.ensureConsent(); await flush(); hook = f.hook("db-account-A"); f.commit();
  const oldProps = hook.promptProps;
  hook = f.hook("db-account-B"); f.commit(); assert.equal(await previous, false);
  const current = hook.ensureConsent(); await flush(); hook = f.hook("db-account-B"); f.commit();
  await oldProps.onAccept(true); oldProps.onCancel();
  assert.equal(f.values.size, 0);
  hook = f.hook("db-account-B"); f.commit(); assert.equal(hook.promptProps.visible, true);
  hook.promptProps.onCancel(); assert.equal(await current, false);
});

test("published HTML candidate matches the approved app rules and verified legal links", () => {
  const html = readFileSync(new URL("../../landing/public/legal/community.html", import.meta.url), "utf8");
  const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  assert.ok(html.includes(rules.DAVAQ_COMMUNITY_RULES_VERSION));
  assert.equal(html.includes("운영자 검토용 초안"), rules.DAVAQ_COMMUNITY_RULES_IS_DRAFT);
  assert.ok(html.includes('content="noindex,nofollow"'));
  for (const section of rules.DAVAQ_COMMUNITY_RULES) {
    assert.ok(html.includes(esc(section.title)));
    for (const paragraph of section.paragraphs) assert.ok(html.includes(esc(paragraph)));
  }
  for (const link of rules.DAVAQ_COMMUNITY_RELATED_LINKS) assert.ok(html.includes(`href="${link.url}"`));
  assert.equal(html.includes('href="https://davaq.app/legal/community.html"'), false);
  assert.equal(html.includes("관할법"), false);
  assert.equal(html.includes("보유기간"), false);
});
