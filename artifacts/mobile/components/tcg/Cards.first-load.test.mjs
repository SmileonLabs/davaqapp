import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as policy from "../../lib/publicCardImagePolicy.ts";
const source = "/market/images/kream/" + "a".repeat(64);
function fixture({ platform = "ios", resource = {}, browser = {} } = {}) {
  let cursor = 0,
    refCursor = 0,
    states = [],
    refs = [],
    effects = [],
    timers = new Map(),
    nextTimer = 0,
    refreshed = 0;
  const mediaCalls = [],
    browserCalls = [],
    node = (type, props, key) => ({ type, props, key }),
    out = {};
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value) =>
          (states[index] =
            typeof value === "function" ? value(states[index]) : value),
      ];
    },
    useRef(initial) {
      const index = refCursor++;
      return (refs[index] ??= { current: initial });
    },
    useEffect(fn) {
      effects.push(fn);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("./Cards.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports: out,
      setTimeout: (fn, ms) => {
        timers.set(++nextTimer, { fn, ms });
        return nextTimer;
      },
      clearTimeout: (id) => timers.delete(id),
      require(name) {
        if (name === "react") return { ...react, default: react };
        if (name === "react/jsx-runtime") return { jsx: node, jsxs: node };
        if (name === "react-native")
          return {
            Platform: { OS: platform },
            View: "View",
            Pressable: "Pressable",
            ActivityIndicator: "Spinner",
          };
        if (name === "expo-image") return { Image: "Image" };
        if (name === "expo-router") return {};
        if (name.includes("useMediaUri"))
          return {
            useMediaResource: (path) => {
              mediaCalls.push(path);
              return {
                ...resource,
                refresh: async () => {
                  refreshed++;
                  return await resource.refresh?.();
                },
              };
            },
          };
        if (name.includes("useBrowserChatPhoto"))
          return {
            useBrowserChatPhoto: (path, attempt) => {
              browserCalls.push({ path, attempt });
              return browser;
            },
          };
        if (name.includes("publicCardImagePolicy")) return policy;
        if (name.includes("/UI"))
          return { C: { muted: "#888" }, Txt: "Text", Icon: "Icon", S: {} };
        if (name.includes("/tcg")) return {};
        throw Error(name);
      },
    },
  );
  let cleanups = [];
  const render = (src = source, props = {}) => {
    cursor = 0;
    refCursor = 0;
    effects = [];
    const parent = out.CardArt({ src, large: true, catalog: true, ...props });
    return { parent, tree: parent.type(parent.props) };
  };
  const flush = () => {
    cleanups.forEach((cleanup) => cleanup?.());
    cleanups = effects.map((fn) => fn());
    effects = [];
  };
  const find = (tree, type) => {
    if (!tree) return null;
    if (Array.isArray(tree)) {
      for (const node of tree) {
        const found = find(node, type);
        if (found) return found;
      }
      return null;
    }
    return tree.type === type ? tree : find(tree.props?.children, type);
  };
  const fire = () => {
    const [id, value] = timers.entries().next().value;
    timers.delete(id);
    value.fn();
    return value.ms;
  };
  return {
    render,
    flush,
    find,
    timers,
    fire,
    mediaCalls,
    browserCalls,
    get refreshed() {
      return refreshed;
    },
  };
}
test("stable original starts immediately and only explicit hero images receive high priority", () => {
  const f = fixture();
  let image = f.find(f.render().tree, "Image");
  assert.equal(image.props.source.uri, "https://tcgindex.org" + source);
  assert.equal(image.props.cachePolicy, "memory-disk");
  assert.equal(image.props.priority, "normal");
  image = f.find(f.render(source, { priority: "high" }).tree, "Image");
  assert.equal(image.props.priority, "high");
});
test("cached display before initial effects stays visible after effects and rerender", () => {
  const f = fixture();
  let { tree } = f.render();
  f.find(tree, "Image").props.onDisplay();
  f.flush();
  tree = f.render().tree;
  assert.equal(f.find(tree, "Spinner"), null);
  f.flush();
  assert.equal(f.timers.size, 0);
});
test("load completion removes covering placeholder when no display event arrives", () => {
  const f = fixture();
  let { tree } = f.render();
  f.find(tree, "Image").props.onLoad({ source: { width: 63, height: 88 } });
  tree = f.render().tree;
  assert.equal(f.find(tree, "Spinner"), null);
});
test("a stalled original tries one supported fallback within a bounded timeout then offers retry", () => {
  const f = fixture();
  f.render();
  f.flush();
  assert.equal(f.fire(), policy.CARD_IMAGE_ATTEMPT_TIMEOUT_MS);
  let { tree } = f.render();
  assert.equal(
    f.find(tree, "Image").props.source.uri,
    policy.publicCardImageSources(source).fallback,
  );
  f.flush();
  assert.equal(f.fire(), policy.CARD_IMAGE_ATTEMPT_TIMEOUT_MS);
  tree = f.render().tree;
  assert.equal(f.find(tree, "Image"), null);
  const retry = f.find(tree, "Pressable");
  assert.equal(retry.props.accessibilityLabel, "카드 이미지 다시 불러오기");
  retry.props.onPress();
  tree = f.render().tree;
  assert.equal(
    f.find(tree, "Image").props.source.uri,
    "https://tcgindex.org" + source,
  );
});
test("late primary error/load events cannot cover a successfully displayed fallback", () => {
  const f = fixture(),
    primary = f.find(f.render().tree, "Image");
  primary.props.onError();
  const fallback = f.find(f.render().tree, "Image");
  fallback.props.onDisplay();
  primary.props.onError();
  primary.props.onLoad({ source: { width: 1, height: 1 } });
  const tree = f.render().tree;
  assert.equal(f.find(tree, "Spinner"), null);
  assert.equal(f.find(tree, "Pressable"), null);
  assert.equal(
    f.find(tree, "Image").props.source.uri,
    fallback.props.source.uri,
  );
});
test("a late error after the same image displayed is ignored even before another render", () => {
  const f = fixture(),
    image = f.find(f.render().tree, "Image");
  image.props.onDisplay();
  image.props.onError();
  assert.equal(
    f.find(f.render().tree, "Image").props.source.uri,
    image.props.source.uri,
  );
  assert.equal(f.find(f.render().tree, "Spinner"), null);
});
test("unsupported external images avoid a predictable failing converter request", () => {
  const f = fixture(),
    url = "https://kream-phinf.pstatic.net/image.jpg";
  f.render(url);
  f.flush();
  f.fire();
  assert.ok(f.find(f.render(url).tree, "Pressable"));
});
test("native private photos retain the signed media address and retry refreshes its authorization", async () => {
  const resource = {
    uri: "https://davaq.app/api/storage/photo?ticket=one",
    refresh: async () => {
      resource.uri = "https://davaq.app/api/storage/photo?ticket=two";
    },
  };
  const f = fixture({ platform: "android", resource });
  let image = f.find(f.render("/objects/photo").tree, "Image");
  assert.equal(image.props.source.uri, resource.uri);
  image.props.onError();
  const retry = f.find(f.render("/objects/photo").tree, "Pressable");
  await retry.props.onPress();
  await new Promise(setImmediate);
  image = f.find(f.render("/objects/photo").tree, "Image");
  assert.equal(image.props.source.uri, resource.uri);
  assert.equal(f.refreshed, 1);
  assert.ok(f.browserCalls.every((call) => call.path === undefined));
});
test("PWA private photos use account-scoped blob cache and never the public image proxy", () => {
  const f = fixture({
    platform: "web",
    browser: { uri: "blob:private-cached" },
  });
  assert.equal(
    f.find(f.render("/objects/photo").tree, "Image").props.source.uri,
    "blob:private-cached",
  );
  assert.ok(f.mediaCalls.every((path) => path === undefined));
  assert.equal(f.browserCalls.at(-1).path, "/objects/photo");
});
test("new card gets its own mounted image state", () => {
  const f = fixture();
  assert.notEqual(f.render("one").parent.key, f.render("two").parent.key);
});
