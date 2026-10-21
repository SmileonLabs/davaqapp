import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { stickerPage, STICKER_PAGE_SIZE } from "../lib/stickerPickerPolicy.ts";
const jsx = (type, props, key) => ({ type, props, key });
const flatten = (tree) =>
  Array.isArray(tree)
    ? tree.flatMap(flatten)
    : tree && typeof tree === "object"
      ? [tree, ...flatten(tree.props?.children)]
      : [];
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name in imports) return imports[name];
        if (name.endsWith(".webp")) return name;
        throw Error(name);
      },
    },
  );
  return exports;
}
const metadata = load("../constants/animatedStickers.ts", {});
function fixture() {
  let cursor = 0;
  const states = [],
    sent = [];
  const react = {
    useMemo: (fn) => fn(),
    useRef: value => { const index = cursor++; if (!(index in states)) states[index] = { current: value }; return states[index]; },
    useState: (value) => {
      const index = cursor++;
      if (!(index in states)) states[index] = value;
      return [
        states[index],
        (next) => {
          states[index] =
            typeof next === "function" ? next(states[index]) : next;
        },
      ];
    },
  };
  const { StickerPicker } = load("./StickerPicker.tsx", {
    react,
    "react-native": {
      Animated: { Value: class { setValue() {} stopAnimation() {} }, View: "AnimatedView", timing: () => ({ start: fn => fn({ finished: true }) }) },
      Platform: { OS: "ios" },
      Linking: { openURL: () => {} },
      PanResponder: { create: handlers => ({ panHandlers: handlers }) },
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      Text: "Text",
      TextInput: "TextInput",
      View: "View",
      StyleSheet: { create: (x) => x },
    },
    "react-native-reanimated": { useReducedMotion: () => false },
    "@/constants/animatedStickers": metadata,
    "@/lib/stickerPickerPolicy": { stickerPage, STICKER_PAGE_SIZE },
    "./StickerImage": { StickerImage: "StickerImage" },
    "@/hooks/useColors": { useColors: () => ({}) },
  });
  return {
    render() {
      cursor = 0;
      return flatten(StickerPicker({ onSelect: (code) => sent.push(code) }));
    },
    sent,
  };
}
test("opening bounds adjacent animations; next page and selection preserve the active code", () => {
  const f = fixture();
  let tree = f.render();
  const initial = tree
    .filter((x) => x.type === "StickerImage")
    .map((x) => x.props.code);
  assert.equal(initial.length, 24);
  assert.equal(tree.filter(x => x.type === "StickerImage" && x.props.autoplay).length, 12);
  tree.find((x) => x.props?.accessibilityLabel === "다음").props.onPress();
  tree = f.render();
  const next = tree
    .filter((x) => x.type === "StickerImage")
    .map((x) => x.props.code);
  assert.equal(next.length, 36);
  assert.equal(tree.filter(x => x.type === "StickerImage" && x.props.autoplay).length, 12);
  assert.ok(next.includes(metadata.ANIMATED_STICKERS[24].code));
  const cell = tree.find(
    (x) =>
      x.props?.accessibilityLabel ===
      metadata.ANIMATED_STICKERS[12].label + " 움직이는 스티커",
  );
  cell.props.onPress();
  assert.deepEqual(f.sent, [metadata.ANIMATED_STICKERS[12].code]);
});
test("search and category changes reset pagination and an empty search unmounts animations", () => {
  const f = fixture();
  let tree = f.render();
  tree.find((x) => x.props?.accessibilityLabel === "다음").props.onPress();
  tree = f.render();
  tree
    .find((x) => x.props?.accessibilityLabel === "음식 스티커 분류")
    .props.onPress();
  tree = f.render();
  assert.ok(
    tree
      .filter((x) => x.type === "StickerImage")
      .every(
        (x) =>
          metadata.ANIMATED_STICKERS.find((item) => item.code === x.props.code)
            .category === "음식",
      ),
  );
  assert.equal(
    tree.find((x) => x.props?.accessibilityLabel === "이전").props.disabled,
    true,
  );
  tree
    .find((x) => x.type === "TextInput")
    .props.onChangeText("no-result-for-this");
  tree = f.render();
  assert.equal(tree.filter((x) => x.type === "StickerImage").length, 0);
});
test("every catalog selection resolves to a bundled animation; historical codes retain remote fallback", () => {
  const { StickerImage } = load("./StickerImage.tsx", {
    react: { useState: (value) => [value, () => {}] },
    "react-native": { Text: "Text", View: "View" },
    "expo-image": { Image: "Image" },
    "react-native-reanimated": { useReducedMotion: () => false },
    "@/constants/animatedStickers": metadata,
    "@/constants/stickers": {
      stickerUri: (code) => `https://legacy.example/${code}.webp`,
    },
  });
  for (const code of [
    ...metadata.ANIMATED_STICKERS.map((item) => item.code),
    "1ffff",
  ]) {
    const wrapper = StickerImage({ code, size: 54 });
    const image = wrapper.type(wrapper.props);
    assert.equal(image.type, "Image");
    assert.equal(image.props.autoplay, true);
    if (code === "1ffff")
      assert.equal(
        image.props.source.uri,
        `https://legacy.example/${code}.webp`,
      );
    else assert.equal(typeof image.props.source, "string");
  }
  assert.notEqual(
    StickerImage({ code: "1f600", size: 54 }).key,
    StickerImage({ code: "1f602", size: 54 }).key,
  );
});

test("grid swipes page once, clamp at ends, ignore vertical and short drags, and never send a sticker", () => {
  const f = fixture();
  const grid = () => f.render().find(x => x.props?.onMoveShouldSetPanResponder);
  assert.equal(grid().props.onMoveShouldSetPanResponder(null, { dx: 30, dy: 40 }), false);
  grid().props.onPanResponderRelease(null, { dx: 70, dy: 2 });
  assert.equal(f.render().find(x => x.type === "Pressable" && x.props.accessibilityRole === "button" && x.props.disabled === false).props.children.props.code, metadata.ANIMATED_STICKERS[0].code);
  grid().props.onPanResponderRelease(null, { dx: -70, dy: 2 });
  assert.equal(f.render().find(x => x.type === "Pressable" && x.props.accessibilityRole === "button" && x.props.disabled === false).props.children.props.code, metadata.ANIMATED_STICKERS[12].code);
  grid().props.onPanResponderRelease(null, { dx: -30, dy: 2 });
  assert.equal(f.render().find(x => x.type === "Pressable" && x.props.accessibilityRole === "button" && x.props.disabled === false).props.children.props.code, metadata.ANIMATED_STICKERS[12].code);
  grid().props.onPanResponderRelease(null, { dx: -70, dy: 80 });
  assert.equal(f.render().find(x => x.type === "Pressable" && x.props.accessibilityRole === "button" && x.props.disabled === false).props.children.props.code, metadata.ANIMATED_STICKERS[12].code);
  assert.deepEqual(f.sent, []);
});
