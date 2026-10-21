import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const assets = new URL("../../assets/icons/exchange/", import.meta.url);
const files = readdirSync(assets).filter((name) => name.endsWith(".svg"));
const source = readFileSync(
  new URL("./ExchangeIcon.tsx", import.meta.url),
  "utf8",
);
const localRequire = createRequire(
  new URL("../../package.json", import.meta.url),
);
const svgRequire = createRequire(
  localRequire.resolve("react-native-svg-transformer"),
);
const { transform } = svgRequire("@svgr/core");
const plugin = svgRequire("@svgr/plugin-jsx");
const jsxPlugin = plugin.default ?? plugin;

function iconFixture() {
  const out = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: out,
      require(name) {
        if (name === "react") return {};
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "@/constants/colors")
          return {
            __esModule: true,
            default: { light: { foreground: "#242236" } },
          };
        if (
          name.startsWith("@/assets/icons/exchange/") &&
          name.endsWith(".svg")
        ) {
          const file = name.split("/").at(-1);
          assert.ok(files.includes(file), `Missing imported asset: ${file}`);
          return { __esModule: true, default: file };
        }
        throw new Error(`Unexpected icon dependency: ${name}`);
      },
    },
  );
  return out.ExchangeIcon;
}

test("all exchange assets share the optical grid and editable currentColor stroke", () => {
  assert.equal(files.length, 21);
  for (const file of files) {
    const svg = readFileSync(new URL(file, assets), "utf8");
    assert.match(svg, /viewBox="0 0 24 24"/, file);
    assert.match(svg, /stroke="currentColor"/, file);
    assert.match(svg, /stroke-width="1\.9"/, file);
    assert.match(svg, /stroke-linecap="round"/, file);
    assert.match(svg, /stroke-linejoin="round"/, file);
    assert.doesNotMatch(
      svg,
      /<(?:text|image|foreignObject|style)\b|font-family|#[0-9a-f]{3,8}\b/i,
      file,
    );
    assert.match(svg, /<(?:path|circle|rect)\b/, file);
  }
});

test("every SVG compiles for both react-native-svg and browser rendering", async () => {
  for (const file of files) {
    const svg = readFileSync(new URL(file, assets), "utf8");
    for (const native of [true, false]) {
      const output = await transform(
        svg,
        { native, plugins: [jsxPlugin] },
        { componentName: "Graphic" },
      );
      assert.match(output, /currentColor/, file);
      assert.match(output, /viewBox="0 0 24 24"/, file);
      if (native) assert.match(output, /from "react-native-svg"/, file);
      else assert.match(output, /<svg\b/, file);
    }
  }
});

test("the icon registry connects each name to its SVG asset", () => {
  const icon = iconFixture();
  for (const file of files) {
    const name = file.replace(/\.svg$/, "");
    assert.equal(icon({ name }).type, file);
  }
});

test("24, 28, and 32 point controls preserve vector sizing and explicit color", () => {
  const icon = iconFixture();
  for (const size of [24, 28, 32]) {
    const control = icon({ name: "message-circle", size, color: "#FFFFFF" });
    assert.equal(control.props.width, size);
    assert.equal(control.props.height, size);
    assert.equal(control.props.color, "#FFFFFF");
    assert.equal(control.props.accessible, false);
    assert.equal(control.props.focusable, false);
  }
});

test("selected heart uses a filled asset while the other controls retain their shapes", () => {
  const icon = iconFixture();
  assert.equal(icon({ name: "heart" }).type, "heart.svg");
  assert.equal(icon({ name: "heart", filled: true }).type, "heart-filled.svg");
  assert.equal(icon({ name: "share", filled: true }).type, "share.svg");
  const filled = readFileSync(new URL("heart-filled.svg", assets), "utf8");
  assert.match(filled, /<path fill="currentColor"/);
  assert.doesNotMatch(
    readFileSync(new URL("heart.svg", assets), "utf8"),
    /<path fill="currentColor"/,
  );
});

test("home and scan controls are connected to editable vector assets", () => {
  const icon = iconFixture();
  assert.equal(icon({ name: "home", size: 24 }).type, "home.svg");
  assert.equal(icon({ name: "maximize", size: 28 }).type, "maximize.svg");
  const scan = readFileSync(new URL("maximize.svg", assets), "utf8");
  assert.match(
    scan,
    /M7 12h10/,
    "The scan control includes the center scan line",
  );
});
