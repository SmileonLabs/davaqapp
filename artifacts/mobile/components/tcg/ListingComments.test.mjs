import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
const flatten = (value) =>
  Array.isArray(value)
    ? value.flatMap(flatten)
    : value && typeof value === "object"
      ? [value, ...flatten(value.props?.children)]
      : [];
const id = "11111111-1111-4111-8111-111111111111";
function fixture({
  fail = false,
  gate = false,
  canComment = true,
  consent = true,
} = {}) {
  const output = {},
    states = [],
    refs = [],
    calls = [],
    routes = [],
    writes = [];
  let cursor = 0,
    refCursor = 0,
    queryOptions,
    finish;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(value) {
      const i = cursor++;
      if (!(i in states)) states[i] = value;
      return [
        states[i],
        (value) => {
          states[i] = value;
        },
      ];
    },
    useRef(value) {
      return (refs[refCursor++] ??= { current: value });
    },
  };
  const items = [
    {
      id,
      owner_id: "other",
      owner_name: "상대",
      body: "질문",
      created_at: "2026-10-15T00:00:00Z",
    },
    {
      id: "own-comment",
      owner_id: "me",
      owner_name: "나",
      body: "내 댓글",
      created_at: "2026-10-15T00:00:00Z",
    },
  ];
  const source = ts.transpileModule(
    readFileSync(new URL("./ListingComments.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports: output,
    Map,
    Date,
    encodeURIComponent,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react-native")
        return {
          ActivityIndicator: "Spinner",
          Pressable: "Pressable",
          View: "View",
        };
      if (name === "@expo/vector-icons") return { Feather: "Icon" };
      if (name === "expo-router")
        return { useRouter: () => ({ push: (route) => routes.push(route) }) };
      if (name === "@workspace/api-client-react")
        return { useGetMe: () => ({ data: { id: "me" } }) };
      if (name === "@/lib/davaqAuth")
        return { useAuth: () => ({ userId: "owner-auth" }) };
      if (name === "@tanstack/react-query")
        return {
          useQueryClient: () => ({
            setQueryData: (_key, update) =>
              writes.push(
                update({
                  pages: [{ items, nextCursor: null, comment_count: 2 }],
                  pageParams: [""],
                }),
              ),
            invalidateQueries() {},
          }),
          useInfiniteQuery: (options) => {
            queryOptions = options;
            return {
              data: { pages: [{ items, nextCursor: null }] },
              isSuccess: true,
            };
          },
        };
      if (name === "@/lib/tcg")
        return {
          key: () => "request-id",
          errorText: (error) => error.message,
          api: async (path, method, body) => {
            calls.push({ path, method, body });
            if (!method) return { items };
            if (gate)
              await new Promise((resolve) => {
                finish = resolve;
              });
            if (fail) throw new Error("연결 실패");
            return {
              item: { ...items[1], id: "new", body: body.body },
              comment_count: 3,
            };
          },
        };
      if (name === "@/components/davaq/UI")
        return {
          C: {},
          S: {},
          Txt: "Txt",
          Button: "Button",
          Field: "Field",
          Notice: "Notice",
        };
      if (name === "@/components/ContentReportSheet")
        return { ContentReportSheet: "ContentReportSheet" };
      if (name === "@/components/UgcConsentPrompt")
        return {
          useUgcConsent: (owner) => {
            assert.equal(owner, "me");
            return { ensureConsent: async () => consent, promptProps: {} };
          },
          UgcConsentPrompt: "UgcConsentPrompt",
        };
      throw new Error(name);
    },
  });
  return {
    calls,
    routes,
    writes,
    get options() {
      return queryOptions;
    },
    finish: () => finish(),
    render() {
      cursor = refCursor = 0;
      return output.ListingComments({ listingId: id, canComment });
    },
  };
}
test("listing comment pagination keeps listing identity and only other authors can be reported", async () => {
  const f = fixture();
  let tree = f.render();
  await f.options.queryFn({ pageParam: "a/b?x" });
  assert.equal(
    f.calls[0].path,
    `/tcg/listings/${id}/comments?cursor=a%2Fb%3Fx`,
  );
  assert.equal(f.options.queryKey[1], "owner-auth");
  const buttons = flatten(tree).filter(
    (item) => item.props?.accessibilityLabel === "오퍼 댓글 신고",
  );
  assert.equal(buttons.length, 1);
  buttons[0].props.onPress();
  tree = f.render();
  const sheet = flatten(tree).find(
    (item) => item.type === "ContentReportSheet",
  );
  assert.equal(sheet.props.target.targetType, "listing_comment");
  assert.equal(sheet.props.target.targetId, id);
  flatten(tree)
    .find((item) => item.props?.accessibilityLabel === "상대 프로필 보기")
    .props.onPress();
  assert.equal(f.routes[0].params.userId, "other");
});
test("comment double submit is locked and successful post updates cache before clearing text", async () => {
  const f = fixture({ gate: true });
  flatten(f.render())
    .find((item) => item.type === "Field")
    .props.onChangeText("상태가 궁금합니다");
  const button = flatten(f.render()).find(
    (item) => item.props?.label === "댓글 등록",
  );
  button.props.onPress();
  button.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.writes[0].pages[0].items[0].body, "상태가 궁금합니다");
  assert.equal(
    flatten(f.render()).find((item) => item.type === "Field").props.value,
    "",
  );
});
test("failed comment keeps its body and request key for safe retry; closed listing is read-only", async () => {
  const f = fixture({ fail: true });
  flatten(f.render())
    .find((item) => item.type === "Field")
    .props.onChangeText("상태가 궁금합니다");
  flatten(f.render())
    .find((item) => item.props?.label === "댓글 등록")
    .props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  let tree = f.render();
  assert.equal(
    flatten(tree).find((item) => item.type === "Field").props.value,
    "상태가 궁금합니다",
  );
  flatten(tree)
    .find((item) => item.props?.label === "댓글 등록")
    .props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls[0].body.requestKey, f.calls[1].body.requestKey);
  assert.equal(f.writes.length, 0);
  assert.ok(
    !flatten(fixture({ canComment: false }).render()).some(
      (item) => item.type === "Field",
    ),
  );
});

test("declining first-write consent preserves the drafted comment and never posts", async () => {
  const f = fixture({ consent: false });
  flatten(f.render())
    .find((item) => item.type === "Field")
    .props.onChangeText("사유를 검토한 뒤 보낼 댓글");
  flatten(f.render())
    .find((item) => item.props?.label === "댓글 등록")
    .props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 0);
  assert.equal(
    flatten(f.render()).find((item) => item.type === "Field").props.value,
    "사유를 검토한 뒤 보낼 댓글",
  );
  const report = flatten(f.render()).find(
    (item) => item.props?.accessibilityLabel === "오퍼 댓글 신고",
  );
  assert.ok(report);
});
