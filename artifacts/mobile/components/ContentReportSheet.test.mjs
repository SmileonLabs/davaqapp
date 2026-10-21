import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
const node = (type, props) => ({ type, props });
const flatten = (value) =>
  Array.isArray(value)
    ? value.flatMap(flatten)
    : value && typeof value === "object"
      ? [value, ...flatten(value.props?.children)]
      : [];
const text = (value) =>
  Array.isArray(value)
    ? value.map(text).join("")
    : value && typeof value === "object"
      ? text(value.props?.children)
      : value == null || typeof value === "boolean"
        ? ""
        : String(value);
function fixture({
  reject = false,
  gate = false,
  presentation = "modal",
} = {}) {
  const output = {},
    states = [],
    refs = [],
    calls = [];
  let cursor = 0,
    refCursor = 0,
    closeCalls = 0,
    finish;
  const react = {
    useEffect() {},
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
  const compiled = ts.transpileModule(
    readFileSync(new URL("./ContentReportSheet.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(compiled, {
    exports: output,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "react/jsx-runtime")
        return { jsx: node, jsxs: node, Fragment: "Fragment" };
      if (name === "react-native")
        return Object.fromEntries(
          [
            "ActivityIndicator",
            "KeyboardAvoidingView",
            "Modal",
            "Pressable",
            "ScrollView",
            "Text",
            "TextInput",
            "View",
          ]
            .map((name) => [name, name])
            .concat([
              ["Platform", { OS: "ios" }],
              ["StyleSheet", { create: (value) => value, absoluteFill: {} }],
            ]),
        );
      if (name === "@expo/vector-icons") return { Feather: "Icon" };
      if (name === "react-native-safe-area-context")
        return { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) };
      if (name === "@/hooks/useColors") return { useColors: () => ({}) };
      if (name === "@/lib/contentReports")
        return {
          reportReasonError: (value) =>
            value.trim().length < 5 ? "5자 이상" : null,
          contentReportError: () => "신고 실패. 다시 시도해 주세요.",
          submitContentReport: async (target, reason) => {
            calls.push({ target, reason });
            if (gate)
              await new Promise((resolve) => {
                finish = resolve;
              });
            if (reject) throw new Error("network down");
            return { id: "receipt", status: "pending" };
          },
        };
      throw new Error(name);
    },
  });
  const target = { targetType: "message", targetId: "a-message" };
  return {
    calls,
    render() {
      cursor = refCursor = 0;
      return output.ContentReportSheet({
        target,
        presentation,
        onClose: () => closeCalls++,
      });
    },
    finish: () => finish(),
    get closeCalls() {
      return closeCalls;
    },
  };
}
function button(tree) {
  return flatten(tree).find(
    (item) => item.props?.accessibilityState?.busy !== undefined,
  );
}
test("report reason survives failure and no receipt is shown before server success", async () => {
  const f = fixture({ reject: true });
  flatten(f.render())
    .find((item) => item.props?.accessibilityLabel === "신고 사유")
    .props.onChangeText("반복적인 괴롭힘 메시지입니다");
  button(f.render()).props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  const tree = f.render();
  assert.match(text(tree), /신고 실패/);
  assert.equal(
    flatten(tree).find((item) => item.props?.accessibilityLabel === "신고 사유")
      .props.value,
    "반복적인 괴롭힘 메시지입니다",
  );
  assert.doesNotMatch(text(tree), /신고를 접수했어요/);
  assert.equal(button(tree).props.disabled, false);
});
test("rapid submits issue one request and prevent dismissal until completion", async () => {
  const f = fixture({ gate: true });
  flatten(f.render())
    .find((item) => item.props?.accessibilityLabel === "신고 사유")
    .props.onChangeText("부적절한 사진을 반복 전송합니다");
  const submit = button(f.render());
  submit.props.onPress();
  submit.props.onPress();
  assert.equal(f.calls.length, 1);
  flatten(f.render())
    .find((item) => item.type === "Modal")
    .props.onRequestClose();
  assert.equal(f.closeCalls, 0);
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  const tree = f.render();
  assert.match(text(tree), /신고를 접수했어요/);
  assert.equal(
    flatten(tree).find((item) => item.type === "KeyboardAvoidingView").props
      .style[1].paddingTop,
    75,
  );
  flatten(tree)
    .find((item) => item.type === "Modal")
    .props.onRequestClose();
  assert.equal(f.closeCalls, 1);
});
test("short reasons keep submission disabled and are never sent", () => {
  const f = fixture();
  assert.equal(button(f.render()).props.disabled, true);
  button(f.render()).props.onPress();
  assert.equal(f.calls.length, 0);
});

test("inline reporting inside an existing sheet creates no additional native Modal", () => {
  const f = fixture({ presentation: "inline" });
  const tree = f.render();
  assert.equal(flatten(tree).filter((item) => item.type === "Modal").length, 0);
  assert.equal(
    flatten(tree).filter(
      (item) => item.props?.accessibilityLabel === "신고 사유",
    ).length,
    1,
  );
});
