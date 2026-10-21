import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(
    new URL("../../app/profile/[userId].tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const listing = {
  id: "offer-1",
  card_name: "공개 카드",
  mode: "gift",
  wanted_card_ids: [],
  available: 2,
};
const profile = {
  id: "other",
  nickname: "DAVAQ 수집가",
  profileImageUrl: null,
  statusMessage: "교환해요",
  stats: { publicCards: 1, publicOffers: 1, comments: 3 },
  offers: [listing],
  nextCursor: "cursor-one",
  fan: { level: 77, xp: 1000 },
  stars: [{ id: "legacy-star", displayName: "레거시 STAR" }],
  followerCount: 999,
  followingCount: 888,
};
const node = (type, props, key) => ({ type, props, key });
const flatten = (value) =>
  Array.isArray(value)
    ? value.flatMap(flatten)
    : value && typeof value === "object"
      ? [value, ...flatten(value.props?.children)]
      : [];
const textOf = (value) =>
  Array.isArray(value)
    ? value.map(textOf).join("")
    : value && typeof value === "object"
      ? textOf(value.props?.children)
      : value == null || typeof value === "boolean"
        ? ""
        : String(value);
function fixture({
  owner = false,
  signedIn = true,
  pages,
  chatFailure = false,
  gateChat = false,
  blockFailure = false,
  gateBlock = false,
} = {}) {
  const states = [],
    refs = [],
    calls = [],
    requests = [],
    navigation = [],
    output = {};
  let stateIndex = 0,
    refIndex = 0,
    options,
    chatCalls = 0,
    nextCalls = 0,
    finishChat;
  let finishBlock;
  const privateRows = [];
  const data = pages ?? [{ ...profile, id: owner ? "me" : "other" }];
  const react = {
    useMemo: (callback) => callback(),
    useCallback: (callback) => callback,
    useEffect() {},
    useState(value) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = value;
      return [
        states[index],
        (next) => {
          states[index] =
            typeof next === "function" ? next(states[index]) : next;
        },
      ];
    },
    useRef(value) {
      const index = refIndex++;
      return (refs[index] ??= { current: value });
    },
  };
  const createRoom = {
    isPending: false,
    async mutateAsync(input) {
      chatCalls++;
      calls.push({ chat: input });
      if (gateChat)
        await new Promise((resolve) => {
          finishChat = resolve;
        });
      if (chatFailure) throw new Error("대화를 연결하지 못했어요.");
      return { id: "room-1" };
    },
  };
  vm.runInNewContext(source, {
    exports: output,
    Map,
    encodeURIComponent,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "react/jsx-runtime")
        return { jsx: node, jsxs: node, Fragment: "Fragment" };
      if (name === "react-native")
        return {
          ActivityIndicator: "Spinner",
          Pressable: "Pressable",
          ScrollView: "ScrollView",
          Text: "Text",
          View: "View",
          StyleSheet: { create: (value) => value },
        };
      if (name === "@expo/vector-icons") return { Feather: "Icon" };
      if (name === "expo-router")
        return {
          useFocusEffect() {},
          useLocalSearchParams: () => ({ userId: owner ? "me" : "other" }),
          useRouter: () => ({
            canGoBack: () => false,
            replace: (route) => navigation.push(route),
            push: (route) => navigation.push(route),
          }),
        };
      if (name === "@tanstack/react-query")
        return {
          useQueryClient: () => ({ id: "query-client" }),
          useInfiniteQuery: (value) => {
            options = value;
            return {
              data: { pages: data },
              hasNextPage: true,
              isLoading: false,
              isError: false,
              refetch: async () => {},
              fetchNextPage: async () => {
                nextCalls++;
              },
            };
          },
        };
      if (name === "@workspace/api-client-react")
        return {
          useGetMe: () => ({ data: { id: "me" } }),
          useCreateRoom: () => createRoom,
          useBlockUser: () => ({
            isPending: false,
            async mutateAsync(input) {
              calls.push({ block: input });
              if (gateBlock)
                await new Promise((resolve) => {
                  finishBlock = resolve;
                });
              if (blockFailure) throw new Error("network down");
            },
          }),
          customFetch: async (path, options) => {
            requests.push({ path, options });
            return data[0];
          },
        };
      if (name === "react-native-safe-area-context")
        return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name === "@/components/Avatar") return { Avatar: "Avatar" };
      if (name === "@/components/ContentReportSheet")
        return { ContentReportSheet: "ContentReportSheet" };
      if (name === "@/components/chat/MessengerUI")
        return { MessengerSheet: "MessengerSheet" };
      if (name === "@/lib/contentReports")
        return {
          clearBlockedUserCaches: async (_client, owner) =>
            calls.push({ clear: owner }),
        };
      if (name === "@/components/tcg/Cards") return { CardArt: "CardArt" };
      if (name === "@/hooks/useColors")
        return {
          useColors: () => ({
            foreground: "#111",
            background: "#fff",
            primary: "#111",
          }),
        };
      if (name === "@/lib/davaqAuth")
        return {
          useAuth: () => ({
            userId: signedIn ? "me" : null,
            isSignedIn: signedIn,
          }),
        };
      if (name === "@/lib/tcg")
        return {
          cardLink: (id) => "/tcg/card/detail?id=" + id,
          conditionName: (value) => value,
          errorText: (error) => error.message,
          statusName: (value) => value,
          useDavaq: (path, enabled) => {
            privateRows.push({ path, enabled });
            return {
              data: { items: [] },
              isLoading: false,
              isError: false,
              refetch: async () => {},
            };
          },
        };
      throw new Error(name);
    },
  });
  return {
    render() {
      stateIndex = 0;
      refIndex = 0;
      privateRows.length = 0;
      return output.default();
    },
    get options() {
      return options;
    },
    privateRows,
    requests,
    navigation,
    calls,
    get chatCalls() {
      return chatCalls;
    },
    get nextCalls() {
      return nextCalls;
    },
    finishChat() {
      finishChat();
    },
    finishBlock() {
      finishBlock();
    },
  };
}
const tab = (tree, title) =>
  flatten(tree).find(
    (item) => item.props?.accessibilityRole === "tab" && textOf(item) === title,
  );
test("another user's profile never requests owner-only collections or trades and does not expose legacy identity fields", () => {
  const f = fixture(),
    tree = f.render();
  assert.ok(f.privateRows.every((query) => query.enabled === false));
  assert.deepEqual(
    flatten(tree)
      .filter((item) => item.props?.accessibilityRole === "tab")
      .map(textOf),
    ["공개 오퍼", "소개"],
  );
  assert.match(textOf(tree), /공개 카드/);
  assert.doesNotMatch(
    textOf(tree),
    /STAR|FAN|팔로워|팔로잉|배틀|성장|999|888|1000/,
  );
  assert.ok(
    !flatten(tree).some((item) => item.props?.children === "프로필 수정"),
  );
});
test("owner's collection and trade queries are enabled only for the corresponding selected tab", () => {
  const f = fixture({ owner: true });
  let tree = f.render();
  assert.equal(
    f.privateRows.find((row) => row.path === "/tcg/collection").enabled,
    true,
  );
  assert.equal(
    f.privateRows.find((row) => row.path === "/tcg/trades").enabled,
    false,
  );
  tab(tree, "거래 기록").props.onPress();
  tree = f.render();
  assert.equal(
    f.privateRows.find((row) => row.path === "/tcg/collection").enabled,
    false,
  );
  assert.equal(
    f.privateRows.find((row) => row.path === "/tcg/trades").enabled,
    true,
  );
  tab(tree, "공개 오퍼").props.onPress();
  f.render();
  assert.ok(f.privateRows.every((query) => query.enabled === false));
});
test("profile query and continuation use only the DavaQ endpoint with actor-scoped caching", async () => {
  const f = fixture();
  f.render();
  assert.deepEqual(Array.from(f.options.queryKey), [
    "davaq",
    "me",
    "public-profile",
    "other",
  ]);
  await f.options.queryFn({ pageParam: "a/b?x", signal: undefined });
  assert.equal(
    f.requests[0].path,
    "/api/tcg/users/other/profile?cursor=a%2Fb%3Fx",
  );
  assert.equal(f.options.getNextPageParam({ nextCursor: "next" }), "next");
  assert.equal(f.options.getNextPageParam({ nextCursor: null }), undefined);
  const signedOut = fixture({ signedIn: false });
  signedOut.render();
  assert.equal(signedOut.options.enabled, false);
});
test("overlapping offer pages do not duplicate listings and loading more keeps server cursor handling", async () => {
  const f = fixture({
    pages: [
      profile,
      { ...profile, offers: [listing, { ...listing, id: "offer-2" }] },
    ],
  });
  const tree = f.render();
  assert.equal(
    flatten(tree).filter(
      (item) => item.props?.accessibilityLabel === "공개 카드 오퍼 보기",
    ).length,
    2,
  );
  const more = flatten(tree).find(
    (item) =>
      item.props?.accessibilityRole === "button" &&
      textOf(item) === "오퍼 더 보기",
  );
  more.props.onPress();
  assert.equal(f.nextCalls, 1);
});
test("repeated chat presses create a single direct room request for the viewed user", async () => {
  const f = fixture({ gateChat: true }),
    tree = f.render();
  const chat = flatten(tree).find(
    (item) =>
      item.props?.accessibilityRole === "button" && textOf(item) === "대화하기",
  );
  chat.props.onPress();
  chat.props.onPress();
  assert.equal(f.chatCalls, 1);
  assert.equal(
    JSON.stringify(f.calls[0].chat),
    JSON.stringify({ data: { type: "direct", memberIds: ["other"] } }),
  );
  f.finishChat();
  await new Promise(setImmediate);
  assert.equal(
    JSON.stringify(f.navigation[0]),
    JSON.stringify({ pathname: "/chat/[id]", params: { id: "room-1" } }),
  );
});
test("a failed chat request remains on the profile and exposes a retryable error", async () => {
  const f = fixture({ chatFailure: true }),
    tree = f.render();
  flatten(tree)
    .find(
      (item) =>
        item.props?.accessibilityRole === "button" &&
        textOf(item) === "대화하기",
    )
    .props.onPress();
  await new Promise(setImmediate);
  assert.equal(f.navigation.length, 0);
  assert.ok(
    flatten(f.render()).some(
      (item) =>
        item.props?.accessibilityRole === "alert" &&
        /대화를 연결하지/.test(textOf(item)),
    ),
  );
});

test("only another user's profile exposes report and block, and report targets the public user", () => {
  const owner = fixture({ owner: true });
  assert.ok(
    !flatten(owner.render()).some(
      (item) => item.props?.accessibilityLabel === "사용자 신고",
    ),
  );
  const f = fixture();
  const tree = f.render();
  flatten(tree)
    .find((item) => item.props?.accessibilityLabel === "사용자 신고")
    .props.onPress();
  const sheet = flatten(f.render()).find(
    (item) => item.type === "ContentReportSheet",
  );
  assert.equal(sheet.props.target.targetType, "user");
  assert.equal(sheet.props.target.targetId, "other");
  assert.equal(f.calls.filter((call) => call.block).length, 0);
});

test("block requires confirmation, prevents duplicate requests, clears visibility caches and leaves the profile", async () => {
  const f = fixture({ gateBlock: true });
  flatten(f.render())
    .find((item) => item.props?.accessibilityLabel === "사용자 차단")
    .props.onPress();
  assert.equal(f.calls.filter((call) => call.block).length, 0);
  const tree = f.render();
  assert.ok(
    flatten(tree).find(
      (item) => item.type === "MessengerSheet" && item.props.visible,
    ),
  );
  assert.match(textOf(tree), /영구 삭제되지는 않으며/);
  const confirm = flatten(tree).find(
    (item) => item.props?.accessibilityLabel === "사용자 차단 확인",
  );
  confirm.props.onPress();
  confirm.props.onPress();
  assert.equal(f.calls.filter((call) => call.block).length, 1);
  assert.equal(f.calls[0].block.data.blockedUserId, "other");
  assert.equal(f.navigation.length, 0);
  f.finishBlock();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.find((call) => call.clear)?.clear, "me");
  assert.deepEqual(f.navigation, ["/(tabs)"]);
});

test("failed block remains retryable without clearing caches or leaving the profile", async () => {
  const f = fixture({ blockFailure: true });
  flatten(f.render())
    .find((item) => item.props?.accessibilityLabel === "사용자 차단")
    .props.onPress();
  flatten(f.render())
    .find((item) => item.props?.accessibilityLabel === "사용자 차단 확인")
    .props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(textOf(f.render()), /차단하지 못했어요/);
  assert.ok(!f.calls.some((call) => call.clear));
  assert.equal(f.navigation.length, 0);
});
