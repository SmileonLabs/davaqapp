import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
  const slots = [],
    calls = [];
  let cursor = 0,
    resolve,
    reject,
    consentAllowed = true;
  const react = {
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn(),
    useEffect() {},
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [
        slots[i],
        (next) =>
          (slots[i] = typeof next === "function" ? next(slots[i]) : next),
      ];
    },
  };
  const jsx = (type, props) => ({ type, props });
  const out = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("./GroupCreateScreenV2.tsx", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports: out,
      require(name) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime")
          return { jsx, jsxs: jsx, Fragment: "Fragment" };
        if (name === "react-native")
          return {
            Platform: { OS: "ios" },
            StyleSheet: { create: (v) => v },
            ...Object.fromEntries(
              [
                "ActivityIndicator",
                "FlatList",
                "KeyboardAvoidingView",
                "Pressable",
                "ScrollView",
                "Text",
                "TextInput",
                "View",
              ].map((n) => [n, n]),
            ),
          };
        if (name === "react-native-safe-area-context")
          return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
        if (name === "expo-router")
          return {
            useFocusEffect() {},
            useRouter: () => ({
              canGoBack: () => false,
              replace: (v) => calls.push(["navigate", v]),
              push() {},
            }),
          };
        if (name === "@expo/vector-icons") return { Feather: "Icon" };
        if (name === "@tanstack/react-query")
          return {
            useQueryClient: () => ({
              setQueryData: (...v) => calls.push(["seed", ...v]),
              invalidateQueries: (v) => {
                calls.push(["invalidate", v]);
                return Promise.resolve();
              },
            }),
          };
        if (name === "@workspace/api-client-react")
          return {
            getGetRoomQueryKey: (id) => ["room", id],
            getListRoomsQueryKey: () => ["rooms"],
            useListFriends: () => ({
              data: [{ id: "friend", displayName: "친구" }],
              refetch() {},
            }),
            useGetMe: () => ({ data: { id: "owner" } }),
            useCreateRoom: () => ({
              isPending: false,
              mutateAsync: (v) => {
                calls.push(["create", v]);
                return new Promise((a, b) => {
                  resolve = a;
                  reject = b;
                });
              },
            }),
          };
        if (name.endsWith("UgcConsentPrompt"))
          return {
            UgcConsentPrompt: "UgcConsentPrompt",
            useUgcConsent: () => ({
              ensureConsent: async () => consentAllowed,
              promptProps: {},
            }),
          };
        if (name.endsWith("Avatar")) return { Avatar: "Avatar" };
        if (name.endsWith("useColors"))
          return {
            useColors: () => ({
              primary: "#6D4AFF",
              card: "#FFFFFF",
              background: "#F7F6FB",
              foreground: "#242438",
            }),
          };
        if (name.endsWith("designSystem"))
          return { spacing: {}, radii: {}, typography: {}, interaction: {} };
        if (name.endsWith("crossAlert"))
          return { crossAlert: (...v) => calls.push(["alert", ...v]) };
        if (name.endsWith("friendNames"))
          return { userDisplayName: (v) => v.displayName };
        throw Error(name);
      },
    },
  );
  const render = () => {
    cursor = 0;
    return out.default();
  };
  const nodes = (node) =>
    !node
      ? []
      : Array.isArray(node)
        ? node.flatMap(nodes)
        : typeof node === "object"
          ? [
              node,
              ...nodes(node.props?.children),
              ...nodes(node.props?.ListHeaderComponent),
            ]
          : [];
  const find = (tree, predicate) => nodes(tree).find(predicate);
  const footer = (tree) =>
    nodes(tree)
      .filter((n) => n.type === "Pressable" && n.props?.accessibilityRole === "button")
      .at(-1);
  function prepare() {
    let tree = render();
    const list = find(tree, (n) => n.type === "FlatList");
    list.props.renderItem({ item: list.props.data[0] }).props.onPress();
    tree = render();
    footer(tree).props.onPress();
    tree = render();
    find(
      tree,
      (n) => n.props?.accessibilityLabel === "그룹 이름",
    ).props.onChangeText("새 그룹");
    return render();
  }
  return {
    render,
    find,
    footer,
    prepare,
    calls,
    setConsent: (value) => { consentAllowed = value; },
    resolve: () => resolve({ id: "created-room", name: "새 그룹" }),
    reject: () => reject(new Error("network")),
  };
}

test("selection and name survive back navigation between creation steps", () => {
  const f = fixture();
  const tree = f.prepare();
  f.find(
    tree,
    (n) => n.props?.accessibilityLabel === "뒤로 가기",
  ).props.onPress();
  const first = f.render();
  assert.equal(
    f.find(first, (n) => n.type === "FlatList").props.data.length,
    1,
  );
  f.footer(first).props.onPress();
  assert.equal(
    f.find(f.render(), (n) => n.props?.accessibilityLabel === "그룹 이름").props
      .value,
    "새 그룹",
  );
});
test("double submission creates one room, seeds its cache and opens the result", async () => {
  const f = fixture();
  const tree = f.prepare();
  f.footer(tree).props.onPress();
  f.footer(tree).props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.filter((v) => v[0] === "create").length, 1);
  f.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    f.calls.map((v) => v[0]),
    ["create", "seed", "invalidate", "navigate"],
  );
  assert.equal(f.calls.at(-1)[1].params.id, "created-room");
});
test("failure preserves the draft and unlocks retry", async () => {
  const f = fixture();
  f.footer(f.prepare()).props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  f.reject();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.find(f.render(), (n) => n.props?.accessibilityLabel === "그룹 이름").props
      .value,
    "새 그룹",
  );
  f.footer(f.render()).props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.filter((v) => v[0] === "create").length, 2);
});
test("declining rules keeps the group draft and creates no room; accepting permits retry", async () => {
  const f = fixture();
  f.setConsent(false);
  f.footer(f.prepare()).props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.filter((v) => v[0] === "create").length, 0);
  assert.equal(f.find(f.render(), (n) => n.props?.accessibilityLabel === "그룹 이름").props.value, "새 그룹");
  f.setConsent(true);
  f.footer(f.render()).props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.filter((v) => v[0] === "create").length, 1);
  f.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});
