import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import {
  exchangeCardPhotos,
  cardFeedPath,
  preserveCardFeedWrites,
} from "../../lib/tcgCardFeed.ts";
import { registrationId } from "../../lib/tcgRegistration.ts";

const source = readFileSync(
  new URL("./ExchangeFeedScreen.tsx", import.meta.url),
  "utf8",
);
const ranges = {
  ExchangeFeedScreen: [
    "export function ExchangeFeedScreen()",
    "const FeedSlide = memo(",
  ],
  FeedSlide: ["const FeedSlide = memo(", "function FeedAction("],
  CardOffers: ["function CardOffers(", "function RegisterCard("],
  RegisterCard: ["function RegisterCard(", "function OfferForm("],
  OfferForm: ["function OfferForm(", "function Comments("],
  Comments: ["function Comments(", "const styles ="],
  ExchangeSheet: ["function ExchangeSheet(", "function CardOffers("],
};
const viewer = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const ownId = "33333333-3333-4333-8333-333333333333";
const collectionId = "44444444-4444-4444-8444-444444444444";
const card = {
  id: "one_piece/ko/OP01-001",
  card: {
    id: "one_piece/ko/OP01-001",
    saveId: "one_piece/ko/OP01-001",
    title: "테스트 카드",
    imageSrc: "/catalog/card.jpg",
    gameCode: "one_piece",
    amount: null,
    saveAllowed: true,
  },
  available_listing_count: 0,
  available_listings: [],
  like_count: 0,
  comment_count: 0,
  liked_by_me: false,
  owned_by_me: false,
};
const target = {
  id: targetId,
  card_id: card.id,
  card_name: card.card.title,
  owner_id: "other",
  owner_name: "상대",
  collection_id: "their-collection",
  condition: "NM",
  photos: ["/objects/seller-photo"],
  quantity: 2,
  available: 2,
  version: 9,
  status: "active",
  mode: "swap",
  wanted_card_ids: [],
  wanted_card_names: [],
  region: "",
  delivery: "ship",
  description: "",
  price: null,
};
const offered = {
  ...target,
  id: ownId,
  owner_id: viewer,
  card_id: "another-card",
  version: 7,
};
const tick = () => new Promise((done) => setImmediate(done));
const flatten = (node) =>
  Array.isArray(node)
    ? node.flatMap(flatten)
    : node && typeof node === "object"
      ? [
          node,
          ...flatten(node.props?.children),
          ...flatten(node.props?.ListHeaderComponent),
          ...flatten(node.props?.ListFooterComponent),
          ...flatten(node.props?.ListEmptyComponent),
        ]
      : [];
function fixture(name, options = {}) {
  const [from, to] = ranges[name];
  const start = source.indexOf(from),
    end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const states = [],
    refs = [],
    calls = [],
    routes = [],
    queryOptions = [],
    closed = [];
  let stateCursor = 0,
    refCursor = 0;
  const client = new QueryClient();
  const ready = (data) => ({
    data,
    isSuccess: true,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: async () => {},
    ...options.queryFlags,
  });
  const api = async (path, method = "GET", body) => {
    calls.push({ path, method, body });
    return options.api
      ? options.api(path, method, body)
      : {
          id: "trade",
          liked_by_me: true,
          like_count: 1,
          item: { id: "comment", body: "hello" },
          comment_count: 1,
        };
  };
  const jsx = (type, props) => ({ type, props });
  const feed = {
    items: [],
    isPending: false,
    isError: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    catalogUnavailable: false,
    refetch: async () => {},
    fetchNextPage: async () => {
      calls.push({ next: true });
    },
    ...options.feed,
  };
  const env = {
    React: {},
    ContentReportSheet: "ContentReportSheet",
    UgcConsentPrompt: "UgcConsentPrompt",
    useUgcConsent: (_owner, config) => ({
      ensureConsent: async () => options.consent !== false,
      promptProps: {
        presentation: config?.presentation ?? "modal",
        visible: false,
        onCancel() {},
      },
    }),
    Feather: "Feather",
    memo: (fn) => fn,
    useState(initial) {
      const i = stateCursor++;
      if (!(i in states)) states[i] = options.state?.[i] ?? initial;
      return [
        states[i],
        (next) => {
          states[i] = typeof next === "function" ? next(states[i]) : next;
        },
      ];
    },
    useRef(initial) {
      const i = refCursor++;
      return (refs[i] ??= { current: initial });
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useFocusEffect() {},
    useLocalSearchParams: () => ({}),
    useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
    usePwaBottomInset: () => 0,
    useAuth: () => ({ userId: viewer }),
    useGetMe: () => ({ data: { id: viewer } }),
    useRouter: () => ({ push: (value) => routes.push(value), setParams() {} }),
    useQueryClient: () => client,
    useQuery(config) {
      queryOptions.push(config);
      const path = config.queryKey[2];
      if (path?.startsWith("/tcg/listings/") && !path.includes("mine=true"))
        return { ...ready(options.target ?? target), ...options.targetFlags };
      if (path === "/tcg/listings?mine=true")
        return ready({ items: options.offered ?? [offered] });
      if (path === "/tcg/collection")
        return ready({ items: options.owned ?? [] });
      return ready(undefined);
    },
    useInfiniteQuery(config) {
      queryOptions.push(config);
      return {
        ...ready({
          pages: [{ items: options.offers ?? [], nextCursor: null }],
        }),
        dataUpdatedAt: 1,
        isPlaceholderData: false,
        hasNextPage: false,
        fetchNextPage: async () => {},
        refetch: async () => {},
        ...options.infinite,
      };
    },
    useExchangeFeed: () => feed,
    useExchangeFeedPreload() {},
    exchangeFeedQueryKey: (owner, q = "", id = "") => [
      "davaq",
      owner,
      "exchange-card-feed",
      q,
      id,
    ],
    exchangeCardPhotos,
    cardFeedPath,
    preserveCardFeedWrites,
    registrationId,
    listingKey: (item) => item.id,
    layoutItem: (_, index, height) => ({
      length: height,
      offset: height * index,
      index,
    }),
    cardLink: (id, title) =>
      "/tcg/card/detail?id=" +
      encodeURIComponent(id) +
      "&name=" +
      encodeURIComponent(title),
    api,
    key: () => "request-key",
    errorText: (error) => error.message,
    conditionName: (value) => value,
    modeLabel: (item) => (item.mode === "gift" ? "무료 나눔" : "제안 받기"),
    actionLabel: (item) =>
      item.mode === "gift" ? "나눔 신청하기" : "교환 제안하기",
    Platform: { OS: "ios" },
    Haptics: { selectionAsync: async () => {} },
    Share: { share: async (value) => calls.push({ share: value }) },
    C: {
      purple: "purple",
      muted: "gray",
      ink: "black",
      line: "gray",
      soft: "light",
      red: "red",
    },
    S: { between: {} },
    styles: {},
    Stack: { Screen: "StackScreen" },
  };
  for (const component of [
    "View",
    "Modal",
    "KeyboardAvoidingView",
    "Comments",
    "OfferForm",
    "CardOffers",
    "RegisterCard",
    "Pressable",
    "Txt",
    "FeedArt",
    "FeedAction",
    "LinearGradient",
    "Icon",
    "FlatList",
    "ScrollView",
    "CardArt",
    "CollectionCardArt",
    "Button",
    "Notice",
    "Empty",
    "Field",
    "ActivityIndicator",
    "RefreshControl",
    "StatusBar",
    "ExchangeSheet",
    "FeedSlide",
  ])
    env[component] = component;
  delete env[name];
  const renderFunction = new Function(
    "exports",
    "require",
    ...Object.keys(env),
    compiled + ";return " + name,
  )({}, () => ({ jsx, jsxs: jsx }), ...Object.values(env));
  const props = {
    card,
    listing: { ...target, version: 1 },
    height: 700,
    topInset: 56,
    bottomInset: 106,
    onLike: async (item, liked) => {
      calls.push({ like: { id: item.id, liked } });
      return { liked_by_me: liked, like_count: liked ? 1 : 0 };
    },
    onOffers: (item) => calls.push({ offers: item.id }),
    onRegister: (item) => calls.push({ register: item?.id }),
    onComments: (item) => calls.push({ comments: item.id }),
    onReport: (target) => calls.push({ report: target }),
    ensureConsent: async () => options.consent !== false,
    onDetail: (item) => calls.push({ detail: item.id }),
    onChoose: (listing) => calls.push({ choose: listing.id }),
    onClose: () => closed.push(true),
    patchCard: (id, patch) => calls.push({ patch: { id, ...patch } }),
    ...options.props,
  };
  const render = () => {
    stateCursor = 0;
    refCursor = 0;
    return renderFunction(props);
  };
  const find = (tree, type, predicate = () => true) =>
    flatten(tree).find((node) => node.type === type && predicate(node.props));
  return {
    render,
    find,
    calls,
    routes,
    closed,
    queryOptions,
    client,
    props,
    states,
    feed,
  };
}

test("a catalog card without offers displays its catalog art and a registration action without a seller", () => {
  const f = fixture("FeedSlide");
  const tree = f.render();
  assert.equal(f.find(tree, "FeedArt").props.src, card.card.imageSrc);
  const action = f.find(
    tree,
    "Pressable",
    (props) => props.accessibilityLabel === "이 카드 가지고 있어요",
  );
  action.props.onPress();
  assert.deepEqual(f.calls, [{ register: card.id }]);
  assert.equal(
    flatten(tree).some(
      (node) =>
        node.type === "Txt" && String(node.props.children).includes("상대"),
    ),
    false,
  );
});

test("cards with offers open the card offer selector and expose a separate own-offer action", () => {
  const c = {
    ...card,
    available_listing_count: 4,
    available_listings: [target],
  };
  const f = fixture("FeedSlide", { props: { card: c } });
  const tree = f.render();
  f.find(
    tree,
    "Pressable",
    (props) => props.accessibilityLabel === "공개 오퍼 4개 보기",
  ).props.onPress();
  f.find(
    tree,
    "Pressable",
    (props) => props.accessibilityLabel === "이 카드의 내 오퍼 추가",
  ).props.onPress();
  assert.deepEqual(f.calls, [{ offers: card.id }, { register: card.id }]);
  assert.equal(f.find(tree, "FeedArt").props.src, card.card.imageSrc);
});

test("readonly catalog entries remain browsable without advertising a registration action", () => {
  const f = fixture("FeedSlide", {
    props: { card: { ...card, card: { ...card.card, saveAllowed: false } } },
  });
  const tree = f.render();
  assert.equal(
    f.find(
      tree,
      "Pressable",
      (props) => props.accessibilityLabel === "이 카드 가지고 있어요",
    ),
    undefined,
  );
  f.find(
    tree,
    "Pressable",
    (props) => props.accessibilityLabel === "카드 정보 보기",
  ).props.onPress();
  assert.deepEqual(f.calls, [{ detail: card.id }]);
});

test("social actions are tied to the canonical card rather than one collector listing", async () => {
  const f = fixture("FeedSlide");
  const tree = f.render();
  f.find(
    tree,
    "FeedAction",
    (props) => props.accessibilityLabel === "좋아요",
  ).props.onPress();
  f.find(
    tree,
    "FeedAction",
    (props) => props.accessibilityLabel === "카드 댓글 보기",
  ).props.onPress();
  await tick();
  assert.deepEqual(f.calls, [
    { like: { id: card.id, liked: true } },
    { comments: card.id },
  ]);
});

test("sharing a card produces a card-filtered feed URL instead of a listing UUID", async () => {
  const f = fixture("FeedSlide");
  f.find(
    f.render(),
    "FeedAction",
    (props) => props.accessibilityLabel === "카드 공유",
  ).props.onPress();
  await tick();
  assert.equal(
    f.calls[0].share.url,
    "https://davaq.app/app/search?cardId=" + encodeURIComponent(card.id),
  );
});

test("card offers use the encoded card endpoint and show separate actual listing photos", async () => {
  const f = fixture("CardOffers", { offers: [target] });
  const tree = f.render();
  assert.equal(
    f.queryOptions[0].queryKey[2],
    cardFeedPath(card.id) + "/offers",
  );
  const list = f.find(tree, "FlatList");
  const row = list.props.renderItem({ item: target });
  assert.equal(f.find(row, "CardArt").props.src, target.photos[0]);
  f.find(row, "Pressable").props.onPress();
  assert.deepEqual(f.calls, [{ choose: target.id }]);
});

test("withdrawn, unavailable, and wrong-card offers cannot become a trade target", () => {
  const f = fixture("CardOffers", {
    offers: [
      target,
      { ...target, id: card.id },
      { ...target, id: "withdrawn", status: "closed" },
      { ...target, id: "reserved", available: 0 },
      { ...target, id: "other-card", card_id: "other" },
    ],
  });
  assert.deepEqual(
    f.find(f.render(), "FlatList").props.data.map((item) => item.id),
    [target.id],
  );
});

test("selecting the user's own offer opens management instead of making an offer to themselves", () => {
  const mine = { ...target, owner_id: viewer };
  const f = fixture("CardOffers", { offers: [mine] });
  const list = f.find(f.render(), "FlatList");
  f.find(list.props.renderItem({ item: mine }), "Pressable").props.onPress();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.routes, ["/tcg/listing/" + target.id]);
});

test("card registration starts with the same canonical card preselected and publish enabled", () => {
  const f = fixture("RegisterCard");
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "사진 추가하고 내 오퍼 등록",
  ).props.onPress();
  assert.equal(
    f.routes[0],
    "/tcg/card/detail?id=" +
      encodeURIComponent(card.card.saveId) +
      "&name=" +
      encodeURIComponent(card.card.title) +
      "&publish=1",
  );
});

test("an existing saved physical card can proceed directly to publication", () => {
  const saved = {
    id: collectionId,
    card_id: card.id,
    photos: ["/objects/mine"],
    condition: "NM",
    quantity: 2,
    reserved: 0,
  };
  const f = fixture("RegisterCard", { owned: [saved] });
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "이 카드로 내 오퍼 등록",
  ).props.onPress();
  assert.deepEqual(f.routes, ["/tcg/sell?collection=" + collectionId]);
});

test("an already published saved card opens the existing offer instead of registering it twice", () => {
  const saved = {
    id: collectionId,
    card_id: card.id,
    listing_id: ownId,
    photos: [],
    condition: "NM",
    quantity: 1,
    reserved: 0,
  };
  const f = fixture("RegisterCard", { owned: [saved] });
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "공개 중인 내 오퍼 보기",
  ).props.onPress();
  assert.deepEqual(f.routes, ["/tcg/listing/" + ownId]);
});

test("trade submission uses the fresh UUID listing version and retains the selected own offer", async () => {
  const f = fixture("OfferForm", { props: { offeredListingId: ownId } });
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "교환 제안 보내기",
  ).props.onPress();
  await tick();
  const request = f.calls.find((call) => call.path === "/tcg/trades");
  assert.equal(request.body.listingId, targetId);
  assert.equal(request.body.listingVersion, 9);
  assert.equal(request.body.offeredListingId, ownId);
  assert.equal(request.body.offeredVersion, 7);
  assert.equal(request.body.requestKey, "request-key");
});

test("a deleted or stale target cannot submit using only the feed summary", async () => {
  const f = fixture("OfferForm", {
    props: { offeredListingId: ownId },
    targetFlags: { isSuccess: false, isError: true, data: undefined },
  });
  const send = f.find(
    f.render(),
    "Button",
    (props) => props.label === "교환 제안 보내기",
  );
  assert.equal(send.props.disabled, true);
  send.props.onPress();
  await tick();
  assert.equal(
    f.calls.some((call) => call.path === "/tcg/trades"),
    false,
  );
});

test("gift selection verifies the live target and sends no offered card or cash", async () => {
  const gift = { ...target, mode: "gift" };
  const f = fixture("OfferForm", { target: gift, props: { listing: gift } });
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "나눔 신청 보내기",
  ).props.onPress();
  await tick();
  const request = f.calls.find((call) => call.path === "/tcg/trades");
  assert.equal(request.body.kind, "gift");
  assert.equal(request.body.cash, 0);
  assert.equal("offeredListingId" in request.body, false);
});

test("empty intermediate catalog pages expose continuation instead of declaring no cards exist", () => {
  const f = fixture("ExchangeFeedScreen", {
    state: { 2: 700 },
    feed: { hasNextPage: true },
  });
  const list = f.find(f.render(), "FlatList");
  const empty = f.find(list.props.ListEmptyComponent, "Empty");
  assert.equal(empty.props.action, "카드 계속 불러오기");
  empty.props.onPress();
  assert.deepEqual(f.calls, [{ next: true }]);
});

test("a partial catalog failure keeps prior cards and exposes a manual retry", () => {
  const f = fixture("ExchangeFeedScreen", {
    state: { 2: 700 },
    feed: { items: [card], catalogUnavailable: true, hasNextPage: true },
  });
  const list = f.find(f.render(), "FlatList");
  assert.equal(list.props.data[0].id, card.id);
  assert.equal(
    f.find(list.props.ListFooterComponent, "Empty").props.action,
    "카드 다시 불러오기",
  );
});

test("the footer exposes remaining pages rather than an inaccurate end-of-feed message", () => {
  const f = fixture("ExchangeFeedScreen", {
    state: { 2: 700 },
    feed: { items: [card], hasNextPage: true },
  });
  const list = f.find(f.render(), "FlatList");
  assert.equal(
    f.find(list.props.ListFooterComponent, "Empty").props.action,
    "다음 카드 더 보기",
  );
});

test("card likes patch only the canonical card across cached filters", async () => {
  const f = fixture("ExchangeFeedScreen", {
    state: { 2: 700 },
    feed: { items: [card] },
  });
  const key = ["davaq", viewer, "exchange-card-feed", "", ""];
  f.client.setQueryData(key, {
    pages: [{ items: [card, { ...card, id: "another" }] }],
    pageParams: [undefined],
  });
  const list = f.find(f.render(), "FlatList");
  const slide = list.props.renderItem({ item: card });
  await slide.props.onLike(card, true);
  assert.equal(f.calls[0].path, cardFeedPath(card.id) + "/like");
  const items = f.client.getQueryData(key).pages[0].items;
  assert.equal(items[0].liked_by_me, true);
  assert.equal(items[1].liked_by_me, false);
});

test("comments use card identity and update its counter after a successful post", async () => {
  const f = fixture("Comments");
  f.find(f.render(), "Field").props.onChangeText("hello");
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "댓글 등록",
  ).props.onPress();
  await tick();
  const request = f.calls.find((call) => call.method === "POST");
  assert.equal(request.path, cardFeedPath(card.id) + "/comments");
  assert.deepEqual(f.calls.find((call) => call.patch)?.patch, {
    id: card.id,
    comment_count: 1,
  });
});

test("a posted comment survives a next-page response already in flight", async () => {
  let resolveNextPage;
  const nextPage = new Promise((resolve) => {
    resolveNextPage = resolve;
  });
  const f = fixture("Comments", {
    api: (path, method) =>
      method === "POST"
        ? { item: { id: "new-comment", body: "hello" }, comment_count: 52 }
        : nextPage,
  });
  f.render();
  const config = f.queryOptions[0];
  f.client.setQueryData(config.queryKey, {
    pages: [{ items: [{ id: "first-comment" }], nextCursor: "page-2" }],
    pageParams: [""],
  });
  const observer = new InfiniteQueryObserver(f.client, config);
  const unsubscribe = observer.subscribe(() => {});
  try {
    const pending = observer.fetchNextPage();
    await tick();
    f.find(f.render(), "Field").props.onChangeText("hello");
    f.find(
      f.render(),
      "Button",
      (props) => props.label === "댓글 등록",
    ).props.onPress();
    await tick();
    assert.equal(
      f.client.getQueryData(config.queryKey).pages[0].items[0].id,
      "new-comment",
    );
    resolveNextPage({ items: [{ id: "older-comment" }], nextCursor: null });
    await pending;
    assert.deepEqual(
      f.client
        .getQueryData(config.queryKey)
        .pages.flatMap((page) => page.items.map((item) => item.id)),
      ["new-comment", "first-comment", "older-comment"],
    );
    assert.match(
      f.calls.find((call) => call.method === "GET").path,
      /cursor=page-2/,
    );
  } finally {
    unsubscribe();
    observer.destroy();
    f.client.clear();
  }
});

test("a canonical card id can never be sent to the UUID trade endpoint", async () => {
  const malformed = { ...target, id: card.id };
  const f = fixture("OfferForm", {
    target: malformed,
    props: { listing: malformed, offeredListingId: ownId },
  });
  const send = f.find(
    f.render(),
    "Button",
    (props) => props.label === "교환 제안 보내기",
  );
  assert.equal(send.props.disabled, true);
  send.props.onPress();
  await tick();
  assert.equal(
    f.calls.some((call) => call.path === "/tcg/trades"),
    false,
  );
});

test("a no-longer-available selected own offer does not silently submit another card", async () => {
  const f = fixture("OfferForm", {
    props: { offeredListingId: ownId },
    offered: [{ ...offered, available: 0 }],
  });
  const send = f.find(
    f.render(),
    "Button",
    (props) => props.label === "교환 제안 보내기",
  );
  assert.equal(send.props.disabled, true);
  send.props.onPress();
  await tick();
  assert.equal(
    f.calls.some((call) => call.path === "/tcg/trades"),
    false,
  );
});

test("public card comment authors open profiles and only other users' comments can be reported", () => {
  const f = fixture("Comments", {
    infinite: {
      data: {
        pages: [
          {
            items: [
              {
                id: targetId,
                owner_id: "other",
                owner_name: "상대",
                body: "공개 댓글",
                created_at: "2026-10-15T00:00:00Z",
              },
              {
                id: ownId,
                owner_id: viewer,
                owner_name: "나",
                body: "내 댓글",
                created_at: "2026-10-15T00:00:00Z",
              },
            ],
            nextCursor: null,
          },
        ],
      },
    },
  });
  let tree = f.render({ card, patchCard() {} });
  const report = flatten(tree).filter(
    (item) => item.props?.accessibilityLabel === "댓글 신고",
  );
  assert.equal(report.length, 1);
  report[0].props.onPress();
  assert.equal(
    f.calls.find((call) => call.report).report.targetType,
    "card_comment",
  );
  assert.equal(f.calls.find((call) => call.report).report.targetId, targetId);
});

test("declining first-write consent keeps a public card comment draft without a POST", async () => {
  const f = fixture("Comments", { consent: false });
  f.find(f.render(), "Field").props.onChangeText("동의 취소 후 유지할 댓글");
  f.find(
    f.render(),
    "Button",
    (props) => props.label === "댓글 등록",
  ).props.onPress();
  await tick();
  assert.ok(!f.calls.some((call) => call.method === "POST"));
  assert.equal(
    f.find(f.render(), "Field").props.value,
    "동의 취소 후 유지할 댓글",
  );
});

test("exchange comments and offers use one native Modal with inline safety prompts at its bounded root", () => {
  for (const kind of ["comments", "offer"]) {
    const f = fixture("ExchangeSheet", {
      props: {
        sheet: kind === "comments" ? { kind, card } : { kind, listing: target },
      },
    });
    let tree = f.render();
    assert.equal(
      flatten(tree).filter((item) => item.type === "Modal").length,
      1,
    );
    assert.equal(f.find(tree, "UgcConsentPrompt").props.presentation, "inline");
    assert.equal(
      f.find(tree, "ContentReportSheet").props.presentation,
      "inline",
    );
    const content = f.find(
      tree,
      kind === "comments" ? "Comments" : "OfferForm",
    );
    assert.equal(typeof content.props.ensureConsent, "function");
    if (kind === "comments") {
      content.props.onReport({ targetType: "card_comment", targetId });
      tree = f.render();
      assert.equal(
        f.find(tree, "ContentReportSheet").props.target.targetId,
        targetId,
      );
      assert.equal(
        flatten(tree).filter((item) => item.type === "Modal").length,
        1,
      );
    }
  }
});
