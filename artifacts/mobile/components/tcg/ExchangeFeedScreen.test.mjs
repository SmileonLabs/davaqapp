import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import * as publicImages from "../../lib/publicCardImagePolicy.ts";

// Exercise the real media view while the authorized address resolves, expires,
// or is already cached. It must never start a native image with an empty URI.
const source = readFileSync(
  new URL("./ExchangeFeedScreen.tsx", import.meta.url),
  "utf8",
);
const imageSource =
  "export " +
  source.slice(
    source.indexOf("function FeedArt("),
    source.indexOf("function ExchangeSheet("),
  );
const compiled = ts.transpileModule(imageSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function fixture(platform = "ios", resource = {}) {
  let cursor = 0,
    refCursor = 0,
    effects = [],
    refreshed = 0;
  const states = [],
    refs = [],
    timers = new Map();
  const useState = (value) => {
    const i = cursor++;
    if (!(i in states)) states[i] = value;
    return [
      states[i],
      (next) => {
        states[i] = typeof next === "function" ? next(states[i]) : next;
      },
    ];
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function(
    "exports",
    "require",
    "useState",
    "useEffect",
    "useRef",
    "publicCardImageSources",
    "CARD_IMAGE_ATTEMPT_TIMEOUT_MS",
    "Platform",
    "useMediaResource",
    "exchangeFeedImageSource",
    "cardImage",
    "Image",
    "useBrowserChatPhoto",
    "View",
    "Pressable",
    "Icon",
    "Txt",
    "ActivityIndicator",
    "styles",
    "C",
    "setTimeout",
    "clearTimeout",
    compiled,
  )(
    exports,
    () => ({ jsx, jsxs: jsx }),
    useState,
    (fn) => effects.push(fn),
    (value) => {
      const index = refCursor++;
      return (refs[index] ??= { current: value });
    },
    publicImages.publicCardImageSources,
    publicImages.CARD_IMAGE_ATTEMPT_TIMEOUT_MS,
    { OS: platform },
    () => ({
      ...resource,
      refresh: () => {
        refreshed++;
        return resource.refresh?.();
      },
    }),
    (s) => "https://images.test/thumbnail?src=" + s,
    (s) => s,
    "Image",
    () => ({
      uri: resource.browserUri ?? "blob:cached-card",
      error: resource.browserError,
    }),
    "View",
    "Pressable",
    "Icon",
    "Text",
    "Spinner",
    {},
    {},
    (fn) => {
      timers.set(timers.size + 1, fn);
      return timers.size;
    },
    (id) => timers.delete(id),
  );
  const render = (src = "/objects/card") => {
    cursor = 0;
    refCursor = 0;
    effects = [];
    return exports.FeedArt({ src });
  };
  const find = (node, type) => {
    if (!node) return undefined;
    if (Array.isArray(node))
      return node.map((v) => find(v, type)).find(Boolean);
    return node.type === type ? node : find(node.props?.children, type);
  };
  return {
    render,
    find,
    flush: () => effects.forEach((fn) => fn()),
    refreshed: () => refreshed,
    timers,
  };
}
test("native card waits for an authorized URI instead of rendering an invalid image source", () => {
  const f = fixture();
  const tree = f.render();
  assert.equal(f.find(tree, "Image"), undefined);
  assert.ok(f.find(tree, "Spinner"));
});
test("native display uses exactly the address prepared by the shared media query", () => {
  const uri = "https://davaq.app/api/storage/photo?ticket=example";
  const f = fixture("android", { uri });
  const image = f.find(f.render(), "Image");
  assert.equal(image.props.source.uri, uri);
  assert.equal(image.props.cachePolicy, "memory-disk");
});
test("cached image display before mount effects does not leave a covering placeholder", () => {
  const f = fixture("ios", { uri: "https://images.test/ready" });
  f.find(f.render(), "Image").props.onDisplay();
  const tree = f.render();
  f.flush();
  assert.equal(f.find(tree, "Spinner"), undefined);
  assert.equal(f.timers.size, 0);
});
test("failed native access resolves a new signed address when the user retries", () => {
  const f = fixture("android", { error: new Error("expired") });
  f.render();
  f.flush();
  const retry = f.find(f.render(), "Pressable");
  assert.equal(retry.props.accessibilityLabel, "카드 사진 다시 불러오기");
  retry.props.onPress();
  assert.equal(f.refreshed(), 1);
});
test("PWA photos reuse the private cache by object identity instead of expiring ticket URL", () => {
  const f = fixture("web", { uri: "https://images.test/expiring" });
  const tree = f.render();
  assert.equal(f.find(tree, "Image").props.source.uri, "blob:cached-card");
});

test("public feed art displays the shared original cache identity before conversion", () => {
  const source = "/market/images/kream/" + "a".repeat(64);
  const f = fixture("web"),
    image = f.find(f.render(source), "Image");
  assert.equal(image.props.source.uri, publicImages.publicCardImageUri(source));
  assert.equal(image.props.priority, "high");
});

test("late original errors cannot hide a successfully displayed feed fallback", () => {
  const source = "/market/images/kream/" + "a".repeat(64);
  const f = fixture("android"),
    primary = f.find(f.render(source), "Image");
  primary.props.onError();
  const fallback = f.find(f.render(source), "Image");
  assert.equal(
    fallback.props.source.uri,
    publicImages.publicCardImageSources(source).fallback,
  );
  fallback.props.onDisplay();
  primary.props.onError();
  primary.props.onLoad();
  const tree = f.render(source);
  assert.equal(f.find(tree, "Spinner"), undefined);
  assert.equal(
    f.find(tree, "Image").props.source.uri,
    fallback.props.source.uri,
  );
});

test("native retry waits for the new authorized address before removing the failure state", async () => {
  let resolve;
  const f = fixture("android", {
    error: new Error("expired"),
    refresh: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  f.render();
  f.flush();
  f.find(f.render(), "Pressable").props.onPress();
  const pending = f.find(f.render(), "Pressable");
  assert.equal(pending.props.disabled, true);
  assert.equal(pending.props.accessibilityState.busy, true);
  resolve();
  await new Promise((done) => setImmediate(done));
  assert.equal(f.find(f.render(), "Pressable"), undefined);
});

async function refreshFixture(fails) {
  const client = new QueryClient();
  const queryKey = ["davaq", "viewer", "exchange-card-feed", "", ""];
  const old = {
    pages: [{ items: [{ id: "first" }] }, { items: [{ id: "later" }] }],
    pageParams: [undefined, "old-cursor"],
  };
  client.setQueryData(queryKey, old);
  const activeId = { current: "later" },
    scrollIndex = { current: 1 },
    notices = [],
    offsets = [],
    busy = [];
  let seenPages;
  const query = {
    refetch: async () => {
      seenPages = client.getQueryData(queryKey).pages.length;
      if (fails) throw new Error("offline");
      client.setQueryData(queryKey, {
        pages: [{ items: [{ id: "fresh" }] }],
        pageParams: [undefined],
      });
    },
  };
  const context = {
    client,
    userId: "viewer",
    search: "",
    cardId: "",
    query,
    activeId,
    scrollIndex,
    height: 600,
    list: {
      current: { scrollToOffset: (value) => offsets.push(value.offset) },
    },
    setRefreshing: (value) => busy.push(value),
    setNotice: (value) => notices.push(value),
    setActiveIndex() {},
    useCallback: (fn) => fn,
    exchangeFeedQueryKey: (owner, q = "", card = "") => [
      "davaq",
      owner,
      "exchange-card-feed",
      q,
      card,
    ],
    errorText: (error) => error.message,
  };
  const start = source.indexOf("  const refresh = useCallback");
  const refreshSource = source.slice(
    start,
    source.indexOf("  const top =", start),
  );
  const js = ts.transpileModule(refreshSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  await new Function(...Object.keys(context), js + ";return refresh();")(
    ...Object.values(context),
  );
  const data = client.getQueryData(queryKey);
  client.clear();
  return {
    data,
    old,
    activeId,
    scrollIndex,
    notices,
    offsets,
    busy,
    seenPages,
  };
}
test("offline refresh restores all earlier pages and the card the user was browsing", async () => {
  const f = await refreshFixture(true);
  assert.equal(f.seenPages, 1);
  assert.deepEqual(f.data, f.old);
  assert.equal(f.activeId.current, "later");
  assert.equal(f.offsets.at(-1), 600);
  assert.equal(f.notices.at(-1), "offline");
  assert.deepEqual(f.busy, [true, false]);
});
test("successful explicit refresh starts at the new first card without keeping old cursors", async () => {
  const f = await refreshFixture(false);
  assert.equal(f.data.pages.length, 1);
  assert.equal(f.data.pages[0].items[0].id, "fresh");
  assert.equal(f.scrollIndex.current, 0);
  assert.equal(f.offsets.at(-1), 0);
});
