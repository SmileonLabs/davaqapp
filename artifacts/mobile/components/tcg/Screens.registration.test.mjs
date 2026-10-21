import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as registration from "../../lib/tcgRegistration.ts";
const target = "11111111-1111-4111-8111-111111111111",
  ownedId = "22222222-2222-4222-8222-222222222222",
  listingId = "33333333-3333-4333-8333-333333333333";
const settle = () => new Promise(setImmediate);
function fixture({
  params = {},
  photos = true,
  fail = false,
  gated = false,
  mutationGated = false,
  consent = true,
} = {}) {
  const output = {},
    requests = [],
    navigation = [],
    cache = new Map(),
    refreshes = [],
    pendingMutations = [],
    states = [];
  const owned = {
    id: ownedId,
    card_id: "pokemon:1",
    card_name: "내 카드",
    condition: "NM",
    photos: photos ? ["/objects/photo"] : [],
    quantity: 2,
    reserved: 0,
  };
  const detail = {
    target: {
      id: "pokemon:1",
      name: "내 카드",
      imageSrc: "photo",
      currency: "KRW",
    },
    history: [],
  };
  const client = {
    setQueryData(key, update) {
      const id = JSON.stringify(key);
      cache.set(
        id,
        typeof update === "function" ? update(cache.get(id)) : update,
      );
    },
    invalidateQueries(options) {
      return gated
        ? new Promise((resolve) => refreshes.push({ options, resolve }))
        : Promise.resolve();
    },
  };
  const node = (type, props, key) => ({ type, props, key });
  const react = {
    useState(initial) {
      const index = states.length;
      states.push(
        Array.isArray(initial) && !initial.length && photos
          ? ["/objects/photo"]
          : typeof initial === "function"
            ? initial()
            : initial,
      );
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useEffect() {},
    useMemo: (fn) => fn(),
  };
  const queries = (path) => ({
    data: path.startsWith("/tcg/catalog/detail")
      ? detail
      : path.startsWith("/tcg/catalog?")
        ? {
            items: [{ id: "c", saveId: "pokemon:1", title: "내 카드" }],
            games: [],
            pages: 1,
          }
        : path === "/tcg/collection"
          ? { items: [owned] }
          : { items: [] },
    isSuccess: true,
    refetch: async () => {},
  });
  const code = ts.transpileModule(
    readFileSync(new URL("./Screens.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports: output,
    require(name) {
      if (name === "@/components/UgcConsentPrompt")
        return {
          useUgcConsent: (owner) => {
            assert.equal(owner, "db-me");
            return { ensureConsent: async () => consent, promptProps: {} };
          },
          UgcConsentPrompt: "UgcConsentPrompt",
        };
      if (name === "./ListingComments")
        return { ListingComments: "ListingComments" };
      if (name === "@/hooks/useExchangeFeed")
        return { preloadPublicCardImages() {} };
      if (name === "react") return { ...react, default: react };
      if (name === "react/jsx-runtime") return { jsx: node, jsxs: node };
      if (name === "react-native")
        return {
          View: "View",
          Pressable: "Pressable",
          Platform: { OS: "web" },
        };
      if (name === "expo-router")
        return {
          useLocalSearchParams: () => params,
          useRouter: () => ({
            push: (href) => navigation.push({ method: "push", href }),
            replace: (href) => navigation.push({ method: "replace", href }),
            dismissTo: (href) => navigation.push({ method: "dismissTo", href }),
          }),
        };
      if (name === "@workspace/api-client-react")
        return { useGetMe: () => ({ data: { id: "db-me" } }) };
      if (name === "@tanstack/react-query")
        return { useQueryClient: () => client };
      if (name.includes("davaqAuth"))
        return { useAuth: () => ({ userId: "clerk-me" }) };
      if (name.includes("tcgRegistration")) return registration;
      if (name.includes("/UI"))
        return {
          Frame: "Frame",
          Txt: "Text",
          Button: "Button",
          Field: "Field",
          Chip: "Chip",
          Section: "Section",
          Notice: "Notice",
          Empty: "Empty",
          QueryState: "QueryState",
          Icon: "Icon",
          C: { muted: "#888", purple: "#746" },
          S: {},
        };
      if (name === "@/lib/tcg")
        return {
          useDavaq: queries,
          useDavaqMutation: () => ({
            isPending: false,
            mutateAsync: async (request) => {
              requests.push(request);
              if (mutationGated)
                await new Promise((resolve) => pendingMutations.push(resolve));
              if (fail) throw Error("network failed");
              return request.path.startsWith("/tcg/collection")
                ? owned
                : {
                    id: listingId,
                    owner_id: "db-me",
                    collection_id: ownedId,
                    quantity: 1,
                    mode: "swap",
                    wanted_card_ids: [],
                    status: "active",
                    version: 1,
                  };
            },
          }),
          key: () => "request-unique",
          errorText: (error) => error.message,
          CONDITIONS: [["NM", "상태 좋음"]],
          conditionName: (value) => value,
          money: () => "",
          cardLink: (id, name) =>
            `/tcg/card/detail?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`,
        };
      if (name === "./Cards")
        return {
          CardArt: "CardArt", CollectionCardArt: "CollectionCardArt",
          CatalogRow: "CatalogRow",
          ListingRow: "ListingRow",
        };
      if (name === "./Map") return { MapPicker: "MapPicker" };
      if (name === "./PriceChart") return { PriceChart: "PriceChart" };
      if (name.startsWith("./")) return {};
      if (name.includes("uploadImage")) return {};
      throw Error(name);
    },
  });
  const find = (tree, predicate) => {
    if (!tree) return undefined;
    if (Array.isArray(tree)) {
      for (const child of tree) {
        const result = find(child, predicate);
        if (result) return result;
      }
      return;
    }
    if (predicate(tree)) return tree;
    return find(tree.props?.children, predicate);
  };
  return {
    output,
    requests,
    navigation,
    cache,
    refreshes,
    pendingMutations,
    states,
    find,
  };
}

test("catalog selections preserve publication and original-offer intent", () => {
  const f = fixture({ params: { publish: "1", offerListing: target } });
  const tree = f.output.RegisterScreen();
  f.find(tree, (node) => node.type === "CatalogRow").props.onPress();
  const href = new URL(f.navigation[0].href, "https://davaq.test");
  assert.equal(href.pathname, "/tcg/card/detail");
  assert.equal(href.searchParams.get("publish"), "1");
  assert.equal(href.searchParams.get("offerListing"), target);
});

test("saved owned card is cached and refresh completes before automatic publication navigation", async () => {
  const f = fixture({
    params: { id: "pokemon:1", publish: "1", offerListing: target },
    gated: true,
  });
  const tree = f.output.CardDetailScreen();
  f.find(
    tree,
    (node) =>
      node.type === "Button" && node.props.label === "등록하고 공개 설정하기",
  ).props.onPress();
  await settle();
  assert.equal(f.requests[0].path, "/tcg/collection");
  assert.equal(
    f.cache.get(JSON.stringify(["davaq", "clerk-me", "/tcg/collection"]))
      .items[0].id,
    ownedId,
  );
  assert.equal(f.navigation.length, 0);
  f.refreshes.forEach((item) => item.resolve());
  await settle();
  assert.deepEqual(f.navigation, [
    {
      method: "dismissTo",
      href: `/tcg/sell?collection=${ownedId}&offerListing=${target}`,
    },
  ]);
});

test("ordinary owned-card registration finishes in the collection instead of leaving a repeat-submit form", async () => {
  const f = fixture({ params: { id: "pokemon:1" } }),
    tree = f.output.CardDetailScreen();
  f.find(
    tree,
    (node) => node.type === "Button" && node.props.label === "보유 카드 등록",
  ).props.onPress();
  await settle();
  assert.deepEqual(f.navigation, [
    { method: "dismissTo", href: `/(tabs)/exchanges?registered=${ownedId}` },
  ]);
});

test("publication requires an actual photo and failed registration remains on the form", async () => {
  const empty = fixture({
    params: { id: "pokemon:1", publish: "1" },
    photos: false,
  });
  const tree = empty.output.CardDetailScreen();
  empty
    .find(
      tree,
      (node) =>
        node.type === "Button" && node.props.label === "등록하고 공개 설정하기",
    )
    .props.onPress();
  await settle();
  assert.equal(empty.requests.length, 0);
  assert.equal(empty.navigation.length, 0);
  assert.ok(
    empty.states.some(
      (value) => typeof value === "string" && value.includes("실물 사진"),
    ),
  );
  const failed = fixture({
      params: { id: "pokemon:1", publish: "1" },
      fail: true,
    }),
    failedTree = failed.output.CardDetailScreen();
  failed
    .find(
      failedTree,
      (node) =>
        node.type === "Button" && node.props.label === "등록하고 공개 설정하기",
    )
    .props.onPress();
  await settle();
  assert.equal(failed.navigation.length, 0);
  assert.equal(failed.cache.size, 0);
});

test("public listing caches joined card details and returns to the original offer after narrow refresh", async () => {
  const f = fixture({
      params: { collection: ownedId, offerListing: target },
      gated: true,
    }),
    tree = f.output.SellScreen();
  assert.equal(
    f.find(
      tree,
      (node) =>
        node.type === "Pressable" &&
        node.props.accessibilityRole === "radio" &&
        f.find(
          node,
          (n) => n.type === "Text" && n.props.children === "무료 나눔",
        ),
    ),
    undefined,
  );
  f.find(
    tree,
    (node) => node.type === "Button" && node.props.label === "교환 카드 올리기",
  ).props.onPress();
  await settle();
  const mine = f.cache.get(
    JSON.stringify(["davaq", "clerk-me", "/tcg/listings?mine=true"]),
  ).items[0];
  assert.equal(mine.id, listingId);
  assert.equal(mine.card_name, "내 카드");
  assert.deepEqual(Array.from(mine.photos), ["/objects/photo"]);
  assert.equal(f.navigation.length, 0);
  f.refreshes.forEach((item) => item.resolve());
  await settle();
  assert.deepEqual(f.navigation, [
    {
      method: "dismissTo",
      href: `/(tabs)/search?offerListing=${target}&offeredListing=${listingId}`,
    },
  ]);
});

test("failed listing publication does not dismiss the form or create optimistic public inventory", async () => {
  const f = fixture({ params: { collection: ownedId }, fail: true }),
    tree = f.output.SellScreen();
  f.find(
    tree,
    (node) => node.type === "Button" && node.props.label === "교환 카드 올리기",
  ).props.onPress();
  await settle();
  assert.equal(f.navigation.length, 0);
  assert.equal(f.cache.size, 0);
});

test("adding a missing owned-card photo waits for save and account refresh before resuming the selected public offer", async () => {
  const f = fixture({
      params: { id: ownedId, publish: "1", offerListing: target },
      mutationGated: true,
      gated: true,
    }),
    tree = f.output.ManageScreen();
  f.find(
    tree,
    (node) =>
      node.type === "Button" &&
      node.props.label === "저장하고 공개 설정 계속하기",
  ).props.onPress();
  await settle();
  assert.equal(f.requests[0].path, `/tcg/collection/${ownedId}`);
  assert.equal(f.requests[0].method, "PATCH");
  assert.deepEqual(Array.from(f.requests[0].body.photos), ["/objects/photo"]);
  assert.equal(f.cache.size, 0);
  assert.equal(f.navigation.length, 0);
  f.pendingMutations.forEach((resolve) => resolve());
  await settle();
  const own = f.cache.get(
    JSON.stringify(["davaq", "clerk-me", "/tcg/collection"]),
  ).items[0];
  assert.equal(own.id, ownedId);
  assert.deepEqual(Array.from(own.photos), ["/objects/photo"]);
  assert.equal(f.refreshes.length, 1);
  assert.deepEqual(Array.from(f.refreshes[0].options.queryKey), [
    "davaq",
    "clerk-me",
    "/tcg/collection",
  ]);
  assert.equal(f.refreshes[0].options.exact, true);
  assert.equal(f.navigation.length, 0);
  f.refreshes.forEach((item) => item.resolve());
  await settle();
  assert.deepEqual(f.navigation, [
    {
      method: "dismissTo",
      href: `/tcg/sell?collection=${ownedId}&offerListing=${target}`,
    },
  ]);
});

test("resuming public registration from owned-card management cannot leave a form without a real photo", async () => {
  const f = fixture({
      params: { id: ownedId, publish: "1", offerListing: target },
      photos: false,
    }),
    tree = f.output.ManageScreen();
  f.find(
    tree,
    (node) =>
      node.type === "Button" &&
      node.props.label === "저장하고 공개 설정 계속하기",
  ).props.onPress();
  await settle();
  assert.equal(f.requests.length, 0);
  assert.equal(f.cache.size, 0);
  assert.equal(f.navigation.length, 0);
  assert.ok(
    f.states.some(
      (value) => typeof value === "string" && value.includes("실물 사진"),
    ),
  );
});

test("declining first-write consent cancels registration and publication without requests or navigation", async () => {
  for (const [screen, params, label] of [
    ["CardDetailScreen", { id: "pokemon:1" }, "보유 카드 등록"],
    ["SellScreen", { collection: ownedId }, "교환 카드 올리기"],
  ]) {
    const f = fixture({ params, consent: false });
    const tree = f.output[screen]();
    f.find(
      tree,
      (node) => node.type === "Button" && node.props.label === label,
    ).props.onPress();
    await settle();
    assert.equal(f.requests.length, 0);
    assert.equal(f.navigation.length, 0);
  }
});
