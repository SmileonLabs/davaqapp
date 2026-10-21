import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as registration from "../../lib/tcgRegistration.ts";

// Render the actual screen functions with deterministic hooks and query fixtures.
// This exercises button handlers and visible controls without a native runtime.
const source = readFileSync(new URL("./Screens.tsx", import.meta.url), "utf8");
const screenSource = [
  source.slice(
    source.indexOf("export function TradeRow("),
    source.indexOf("export function ManageScreen()"),
  ),
  source.slice(
    source.indexOf("export function SellScreen() {"),
    source.indexOf("export function NotificationsScreen()"),
  ),
].join("\n");
const compiled = ts.transpileModule(screenSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const owned = {
  id: "22222222-2222-4222-8222-222222222222",
  card_id: "card-1",
  card_name: "내 카드",
  quantity: 4,
  reserved: 1,
  condition: "NM",
  photos: ["/objects/front.jpg", "/objects/back.jpg"],
};
const target = {
  ...owned,
  id: "target",
  owner_id: "seller",
  owner_name: "상대",
  collection_id: "their-collection",
  quantity: 2,
  available: 2,
  version: 7,
  status: "active",
  mode: "swap",
  wanted_card_ids: [],
  region: "",
  description: "",
  delivery: "ship",
};
const offered = {
  ...target,
  id: "offer-1",
  owner_id: "buyer",
  available: 3,
  quantity: 3,
  version: 12,
};

function render(name, options = {}) {
  const {
    choice = "offers",
    collectionId = owned.id,
    listingId,
    mode = "swap",
    count = "1",
    wanted = [],
    targetWanted = [],
    selected,
    offerId = "offer-1",
    offerCount = "1",
    available = 2,
    photos = owned.photos,
    viewer = "buyer",
    status = "proposed",
    cash = "0",
  } = options;
  const calls = [],
    errors = [],
    routes = [];
  const state =
    name === "SellScreen"
      ? [false, choice, count, wanted, null, "", "ship", ""]
      : name === "ListingScreen"
        ? [count, selected, offerCount, "", ""]
        : [count, offerCount, cash, ""];
  const trade = {
    id: "trade",
    buyer_id: "buyer",
    seller_id: "seller",
    viewerId: viewer,
    room_id: "trade-room",
    status,
    kind: mode,
    version: 9,
    quantity: 1,
    offered_quantity: mode === "gift" ? 0 : 1,
    cash: Number(cash),
    note: "",
    snapshot: { target, offered: mode === "gift" ? null : offered },
    actions: [],
  };
  const query = (path) => ({
    data:
      path === "/tcg/collection"
        ? { items: [{ ...owned, photos, listing_id: listingId }] }
        : path === "/tcg/wants"
          ? {
              items: [
                { id: "want-1", card_id: "wanted", card_name: "희망 카드" },
              ],
            }
          : path.includes("mine=true")
            ? { items: [offered] }
            : path.startsWith("/tcg/trades/")
              ? trade
              : { ...target, mode, available, wanted_card_ids: targetWanted },
    isPending: false,
    refetch: () => Promise.resolve(),
  });
  const env = {
    useUgcConsent: () => ({ ensureConsent: async () => true, promptProps: {} }),
    UgcConsentPrompt: "UgcConsentPrompt",
    ListingComments: "ListingComments",
    ...registration,
    React: { useMemo: (fn) => fn() },
    useState: (initial) => [state.shift() ?? initial, () => {}],
    useEffect() {},
    useLocalSearchParams: () =>
      name === "SellScreen"
        ? { collection: collectionId }
        : { id: name === "TradeScreen" ? trade.id : target.id, offer: offerId },
    useDavaq: query,
    useGetMe: () => ({ data: { id: viewer } }),
    useAuth: () => ({ userId: viewer }),
    useQueryClient: () => ({
      setQueryData() {},
      invalidateQueries: () => Promise.resolve(),
    }),
    key: () => "request-key",
    useAction: () => ({
      busy: false,
      feedback: null,
      run(path, body, method = "POST") {
        calls.push({ path, body, method });
        return Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" });
      },
      failure: (error) => errors.push(error.message),
      success() {},
    }),
    useRouter: () => ({
      push: (path) => routes.push(path),
      replace: (path) => routes.push(path),
      dismissTo: (path) => routes.push(path),
    }),
    S: { card: {}, row: {}, wrap: {} },
    C: {
      purple: "purple",
      ink: "black",
      line: "gray",
      soft: "light",
      white: "white",
      muted: "gray",
    },
    conditionName: (c) => c,
    money: (price) => String(price),
    statusName: (value) => value,
    cardLink: () => "/card",
  };
  for (const component of [
    "View",
    "Frame",
    "QueryState",
    "Txt",
    "Pressable",
    "CardArt",
    "CollectionCardArt",
    "Icon",
    "Button",
    "Empty",
    "Notice",
    "Field",
    "Chip",
    "Delivery",
    "MapPicker",
    "Section",
  ])
    env[component] = component;
  const jsx = (type, props) => ({ type, props });
  const screens = new Function(
    "exports",
    "require",
    ...Object.keys(env),
    compiled + "; return exports;",
  )(
    {},
    () => ({ jsx, jsxs: jsx, Fragment: "Fragment" }),
    ...Object.values(env),
  );
  const tree = screens[name](name === "TradeRow" ? { trade } : undefined);
  const flatten = (node) =>
    Array.isArray(node)
      ? node.flatMap(flatten)
      : node && typeof node === "object"
        ? [node, ...flatten(node.props?.children)]
        : [];
  const nodes = flatten(tree);
  const button = (label) =>
    nodes.find((node) => node.type === "Button" && node.props.label === label);
  return {
    calls,
    errors,
    routes,
    nodes,
    button,
    async submit() {
      const labels = [
        "교환 카드 올리기",
        "나눔 카드 올리기",
        "교환 제안 보내기",
        "나눔 신청하기",
        "교환 요청하기",
      ];
      const control = nodes.find(
        (node) => node.type === "Button" && labels.includes(node.props.label),
      );
      assert.ok(control, "Expected a submit button");
      control.props.onPress();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("open offers preserve collection id and clear wanted cards", async () => {
  const screen = render("SellScreen");
  await screen.submit();
  assert.deepEqual(screen.calls[0].body.wantedCardIds, []);
  assert.equal(screen.calls[0].body.mode, "swap");
  assert.equal(screen.calls[0].body.collectionId, owned.id);
  assert.equal(screen.calls[0].body.price, null);
});

test("direct trade requires a wanted card", async () => {
  const screen = render("SellScreen", { choice: "direct" });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
  assert.match(screen.errors[0], /받고 싶은/);
});

test("direct trade sends the selected wanted card", async () => {
  const screen = render("SellScreen", { choice: "direct", wanted: ["wanted"] });
  await screen.submit();
  assert.deepEqual(screen.calls[0].body.wantedCardIds, ["wanted"]);
});

test("gift registration discards previous wanted cards and price", async () => {
  const screen = render("SellScreen", { choice: "gift", wanted: ["wanted"] });
  await screen.submit();
  assert.equal(screen.calls[0].body.mode, "gift");
  assert.deepEqual(screen.calls[0].body.wantedCardIds, []);
  assert.equal(screen.calls[0].body.price, null);
});

test("missing original photos prevents registration", async () => {
  const screen = render("SellScreen", { photos: [] });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
  assert.match(screen.errors[0], /실물 사진/);
});

test("registration prevents fractional quantities", async () => {
  const screen = render("SellScreen", { count: "1.5" });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
});

test("registration respects reserved inventory", async () => {
  const screen = render("SellScreen", { count: "4" });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
});

test("offer route parameter selects the owned card and preserves versions and request key", async () => {
  const screen = render("ListingScreen");
  await screen.submit();
  assert.equal(screen.calls[0].body.listingVersion, 7);
  assert.equal(screen.calls[0].body.offeredVersion, 12);
  assert.equal(screen.calls[0].body.offeredListingId, "offer-1");
  assert.equal(screen.calls[0].body.requestKey, "request-key");
  assert.equal(screen.calls[0].body.cash, 0);
});

test("gift application needs no offered card and omits offered payload", async () => {
  const screen = render("ListingScreen", { mode: "gift", offerId: "" });
  await screen.submit();
  assert.equal(screen.calls[0].body.kind, "gift");
  assert.equal(screen.calls[0].body.cash, 0);
  assert.equal("offeredListingId" in screen.calls[0].body, false);
  assert.equal(
    screen.nodes.some(
      (node) => node.type === "Field" && node.props.label === "내가 줄 수량",
    ),
    false,
  );
});

test("a missing offered card cannot be submitted", async () => {
  const screen = render("ListingScreen", { offerId: "missing" });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
  assert.match(screen.errors[0], /내가 줄 카드/);
});

test("swap prevents excessive offered quantity", async () => {
  const screen = render("ListingScreen", { offerCount: "4" });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
});

test("swap prevents excessive target quantity", async () => {
  const screen = render("ListingScreen", { count: "3" });
  await screen.submit();
  assert.equal(screen.calls.length, 0);
});

test("gift applicant can revise quantity and note but cannot accept their own application", () => {
  const screen = render("TradeScreen", {
    mode: "gift",
    viewer: "buyer",
    cash: "999",
    count: "2",
  });
  assert.ok(screen.button("나눔 신청 수정하기"));
  assert.equal(screen.button("나눔 신청 수락"), undefined);
  assert.equal(
    screen.nodes.some(
      (node) =>
        node.type === "Field" && /금액|차액|제공 수량/.test(node.props.label),
    ),
    false,
  );
  screen.button("나눔 신청 수정하기").props.onPress();
  assert.deepEqual(screen.calls[0], {
    path: "/tcg/trades/trade",
    method: "PATCH",
    body: { version: 9, quantity: 2, cash: 0, note: "" },
  });
});

test("gift owner can accept or decline and cannot revise the applicant's quantity", () => {
  const screen = render("TradeScreen", { mode: "gift", viewer: "seller" });
  assert.ok(screen.button("나눔 신청 수락"));
  assert.ok(screen.button("나눔 신청 거절"));
  assert.equal(screen.button("나눔 신청 수정하기"), undefined);
  screen.button("나눔 신청 수락").props.onPress();
  assert.deepEqual(screen.calls[0].body, { kind: "accept", version: 9 });
});

test("gift transfer exposes only the sender action to the owner", () => {
  const screen = render("TradeScreen", {
    mode: "gift",
    viewer: "seller",
    status: "confirmed",
  });
  assert.ok(screen.button("카드 전달했어요"));
  assert.equal(screen.button("카드 수령 확인"), undefined);
});

test("gift transfer exposes only receipt confirmation to the applicant", () => {
  const screen = render("TradeScreen", {
    mode: "gift",
    viewer: "buyer",
    status: "confirmed",
  });
  assert.ok(screen.button("카드 수령 확인"));
  assert.equal(screen.button("카드 전달했어요"), undefined);
});

test("gift summary shows a free donation label instead of a cash amount", () => {
  const screen = render("TradeRow", { mode: "gift", cash: "0" });
  const text = screen.nodes
    .filter((node) => node.type === "Txt")
    .flatMap((node) => node.props.children);
  assert.ok(text.includes("무료 나눔"));
  assert.equal(
    text.some((value) => value === "0" || value === "차액"),
    false,
  );
});

test("gift revision rejects fractional quantity", () => {
  const screen = render("TradeScreen", { mode: "gift", count: "1.5" });
  screen.button("나눔 신청 수정하기").props.onPress();
  assert.equal(screen.calls.length, 0);
  assert.equal(screen.errors.length, 1);
});

test("designated exchange shows matching owned cards only", async () => {
  const screen = render("ListingScreen", { targetWanted: [offered.card_id] });
  assert.ok(
    screen.nodes.some(
      (node) => node.type === "Chip" && node.props.label === offered.card_name,
    ),
  );
  await screen.submit();
  assert.equal(screen.calls[0].body.offeredListingId, offered.id);
});

test("designated exchange explains missing matching cards and blocks an incompatible route offer", async () => {
  const screen = render("ListingScreen", { targetWanted: ["different-card"] });
  assert.equal(
    screen.nodes.some((node) => node.type === "Chip"),
    false,
  );
  assert.ok(
    screen.nodes.some(
      (node) =>
        node.type === "Notice" &&
        String(node.props.children).includes("상대가 원하는 카드와 맞는"),
    ),
  );
  assert.equal(screen.button("교환 요청하기").props.disabled, true);
  await screen.submit();
  assert.equal(screen.calls.length, 0);
});

test("published cards are excluded from new registration choices and link to their existing listing", () => {
  const screen = render("SellScreen", {
    collectionId: "",
    listingId: "existing-listing",
  });
  assert.equal(
    screen.nodes.some(
      (node) =>
        node.type === "Pressable" &&
        node.props.accessibilityLabel === owned.card_name + " 거래 등록",
    ),
    false,
  );
  assert.ok(screen.button("기존 거래 카드 보기"));
  assert.ok(screen.button("보유 카드 관리"));
  screen.button("기존 거래 카드 보기").props.onPress();
  assert.deepEqual(screen.routes, ["/tcg/listing/existing-listing"]);
});

test("a direct link to an already published card explains the existing listing and blocks duplicate submission", () => {
  const screen = render("SellScreen", { listingId: "existing-listing" });
  assert.ok(
    screen.nodes.some(
      (node) =>
        node.type === "Notice" &&
        String(node.props.children).includes("이미 공개 중인 카드"),
    ),
  );
  assert.equal(screen.button("이미 공개 중").props.disabled, true);
  assert.equal(
    screen.nodes.some(
      (node) => node.type === "Field" && node.props.label === "올릴 수량",
    ),
    false,
  );
  screen.button("이미 공개 중").props.onPress();
  assert.equal(screen.calls.length, 0);
  assert.match(screen.errors[0], /이미 공개 중/);
  screen.button("기존 거래 카드 보기").props.onPress();
  assert.deepEqual(screen.routes, ["/tcg/listing/existing-listing"]);
});
