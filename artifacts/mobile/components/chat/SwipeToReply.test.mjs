import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  const callbacks = {},
    config = {},
    values = [];
  let replies = 0,
    haptics = 0;
  const gesture = new Proxy(
    {},
    {
      get: (_, key) => (value) => {
        if (key.startsWith("on")) callbacks[key] = value;
        else config[key] = value;
        return gesture;
      },
    },
  );
  const jsx = (type, props) => ({ type, props });
  const out = {};
  const react = { useCallback: (fn) => fn, useMemo: (fn) => fn() };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("./SwipeToReply.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports: out,
      require(name) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "react-native")
          return {
            Platform: { OS: "ios" },
            StyleSheet: { create: (x) => x },
            View: "View",
          };
        if (name === "react-native-gesture-handler")
          return {
            Gesture: { Pan: () => gesture },
            GestureDetector: "GestureDetector",
          };
        if (name === "react-native-reanimated")
          return {
            __esModule: true,
            default: { View: "AnimatedView" },
            runOnJS: (fn) => fn,
            useAnimatedStyle: (fn) => fn(),
            useReducedMotion: () => false,
            useSharedValue: (x) => {
              const v = { value: x };
              values.push(v);
              return v;
            },
            withSpring: (x) => x,
          };
        if (name === "@expo/vector-icons") return { Feather: "Icon" };
        if (name === "expo-haptics")
          return {
            selectionAsync: () => {
              haptics++;
              return Promise.resolve();
            },
          };
        if (name === "@/hooks/useColors") return { useColors: () => ({}) };
        throw Error(name);
      },
    },
  );
  out.SwipeToReply({ children: "bubble", onReply: () => replies++ });
  return {
    callbacks,
    config,
    values,
    get replies() {
      return replies;
    },
    get haptics() {
      return haptics;
    },
  };
}
test("reply accepts left direction and fails rightward or vertical drags", () => {
  const f = fixture();
  assert.equal(f.config.activeOffsetX, -12);
  assert.equal(f.config.failOffsetX, 10);
  assert.deepEqual([...f.config.failOffsetY], [-10, 10]);
  f.callbacks.onUpdate({ translationX: -30 });
  f.callbacks.onEnd();
  f.callbacks.onFinalize();
  assert.equal(f.replies, 0);
  assert.equal(f.values[0].value, 0);
});
test("threshold feedback occurs once; release after retreat cancels; finalization never replies", () => {
  const f = fixture();
  f.callbacks.onUpdate({ translationX: -60 });
  f.callbacks.onUpdate({ translationX: -20 });
  f.callbacks.onUpdate({ translationX: -70 });
  assert.equal(f.haptics, 1);
  f.callbacks.onUpdate({ translationX: -20 });
  f.callbacks.onEnd();
  f.callbacks.onFinalize();
  assert.equal(f.replies, 0);
  f.callbacks.onUpdate({ translationX: -65 });
  f.callbacks.onFinalize();
  assert.equal(f.replies, 0);
});
test("committed gesture replies once and resets offset for subsequent gestures", () => {
  const f = fixture();
  f.callbacks.onUpdate({ translationX: -500 });
  assert.equal(f.values[0].value, -84);
  f.callbacks.onEnd();
  f.callbacks.onFinalize();
  assert.equal(f.replies, 1);
  assert.equal(f.values[0].value, 0);
});
