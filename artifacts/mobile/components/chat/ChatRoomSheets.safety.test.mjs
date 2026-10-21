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
function fixture({
  mine = false,
  deleted = false,
  type = "image",
  os = "android",
} = {}) {
  const output = {},
    states = [],
    refs = [];
  let cursor = 0,
    closed = 0,
    forwarded = 0,
    refCursor = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useRef(value) {
      return (refs[refCursor++] ??= { current: value });
    },
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
  };
  const source = ts.transpileModule(
    readFileSync(new URL("./ChatRoomSheets.tsx", import.meta.url), "utf8"),
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
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react-native")
        return {
          Pressable: "Pressable",
          Switch: "Switch",
          Text: "Text",
          TextInput: "TextInput",
          View: "View",
          StyleSheet: { create: (value) => value, hairlineWidth: 1 },
          Platform: { OS: os },
        };
      if (name === "@expo/vector-icons") return { Feather: "Icon" };
      if (name === "@/components/StickerPicker")
        return { StickerPicker: "StickerPicker" };
      if (name === "@/components/ContentReportSheet")
        return { ContentReportSheet: "ContentReportSheet" };
      if (name === "@/lib/chatScreenUtils")
        return {
          summarizeMessage: (message) => message.content,
          roomDisplayName: () => "방",
        };
      if (name === "@/hooks/useColors") return { useColors: () => ({}) };
      if (name === "./MessageFocusMenu") return { MessageFocusMenu: "MessageFocusMenu" };
      if (name === "./MessengerUI")
        return {
          MessengerAction: "MessengerAction",
          MessengerSheet: "MessengerSheet",
        };
      throw new Error(name);
    },
  });
  return {
    render() {
      cursor = 0;
      refCursor = 0;
      return output.ChatRoomSheets({
        roomOptions: {},
        messageActions: {
          message: { id: "private-room-message", type, content: "메시지 내용" },
          isMine: mine,
          isDeleted: deleted,
          onClose: () => closed++,
          onForward: () => forwarded++,
        },
        stickerBadge: {},
        forward: { rooms: [] },
      });
    },
    get closed() {
      return closed;
    },
    get forwarded() {
      return forwarded;
    },
  };
}
test("long-press menu reports only the selected other-user message and closes the action menu", () => {
  const f = fixture();
  const action = flatten(f.render()).find(
    (item) => item.props?.label === "메시지 신고",
  );
  assert.ok(action);
  action.props.onPress();
  assert.equal(f.closed, 1);
  const report = flatten(f.render()).find(
    (item) => item.type === "ContentReportSheet",
  );
  assert.equal(report.props.target.targetType, "message");
  assert.equal(report.props.target.targetId, "private-room-message");
  assert.equal(report.props.target.content, undefined);
});
test("own, deleted, and system messages never expose the report action", () => {
  for (const options of [{ mine: true }, { deleted: true }, { type: "system" }])
    assert.ok(
      !flatten(fixture(options).render()).some(
        (item) => item.props?.label === "메시지 신고",
      ),
    );
});
test("iOS opens a report only after the message action modal has dismissed", () => {
  const f = fixture({ os: "ios" });
  flatten(f.render())
    .find((item) => item.props?.label === "메시지 신고")
    .props.onPress();
  let tree = f.render();
  assert.equal(
    flatten(tree).find((item) => item.type === "ContentReportSheet").props
      .target,
    null,
  );
  flatten(tree)
    .find(
      (item) => item.type === "MessageFocusMenu" && item.props.title === "메시지",
    )
    .props.onDismiss();
  tree = f.render();
  assert.equal(
    flatten(tree).find((item) => item.type === "ContentReportSheet").props
      .target.targetId,
    "private-room-message",
  );
});
test("iOS finishes the message menu before asking for consent to open forwarding", () => {
  const f = fixture({ os: "ios" });
  flatten(f.render())
    .find((item) => item.props?.label === "전달")
    .props.onPress();
  assert.equal(f.closed, 1);
  assert.equal(f.forwarded, 0);
  flatten(f.render())
    .find(
      (item) => item.type === "MessageFocusMenu" && item.props.title === "메시지",
    )
    .props.onDismiss();
  assert.equal(f.forwarded, 1);
});
