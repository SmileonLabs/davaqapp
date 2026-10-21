import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

function fixture({
  game = "",
  platform = "web",
  visible = true,
  online = true,
} = {}) {
  const source = readFileSync(
    new URL("./Screens.tsx", import.meta.url),
    "utf8",
  );
  const component = source.slice(
    source.indexOf("export function HomeScreen()"),
    source.indexOf("export function MarketScreen()"),
  );
  const effects = [],
    preloads = [],
    queries = [],
    refreshed = [],
    output = {};
  const cards = (game) =>
    Array.from({ length: 5 }, (_, index) => ({
      saveId: `${game}:${index}`,
      title: `${game} ${index}`,
      imageSrc: `https://tcgindex.org/market/images/kream/${game}-${index}`,
    }));
  const node = (type, props, key) => ({ type, props, key });
  const environment = {
    exports: output,
    document: { visibilityState: visible ? "visible" : "hidden" },
    navigator: { onLine: online },
    React: { useMemo: (fn) => fn(), Fragment: "Fragment" },
    useState: () => [game, () => {}],
    useEffect: (effect) => effects.push(effect),
    useRouter: () => ({ push() {} }),
    Platform: { OS: platform },
    AppState: { currentState: visible ? "active" : "background" },
    C: {},
    S: {},
    preloadPublicCardImages: (sources, allowed) =>
      preloads.push({ sources, allowed }),
    useDavaq: (path, enabled = true) => {
      queries.push({ path, enabled });
      const game =
        new URL("https://davaq.app" + path).searchParams.get("game") ||
        "pokemon";
      return {
        data: { items: path.startsWith("/tcg/catalog") ? cards(game) : [] },
        isSuccess: true,
        refetch: async () => {
          refreshed.push(path);
        },
      };
    },
    require: (name) => {
      assert.equal(name, "react/jsx-runtime");
      return { jsx: node, jsxs: node };
    },
  };
  for (const type of [
    "Frame",
    "Button",
    "View",
    "Chip",
    "Txt",
    "Icon",
    "CardArt",
    "CollectionCardArt",
    "CatalogRow",
    "Pressable",
    "Section",
    "QueryState",
    "Empty",
    "ListingRow",
    "Notice",
  ])
    environment[type] = type;
  vm.runInNewContext(
    ts.transpileModule(component, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    environment,
  );
  const tree = output.HomeScreen(),
    cleanups = effects.map((effect) => effect());
  return { tree, preloads, queries, refreshed, cleanups, environment };
}
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}

test("home reserves high image priority for two heroes and preloads only its next four displayed cards", () => {
  const f = fixture();
  const heroes = nodes(f.tree, "CardArt");
  assert.equal(heroes.length, 2);
  assert.equal(
    heroes.every((hero) => hero.props.priority === "high"),
    true,
  );
  assert.deepEqual(
    heroes.map((hero) => hero.props.src),
    [
      "https://tcgindex.org/market/images/kream/pokemon-0",
      "https://tcgindex.org/market/images/kream/one_piece-0",
    ],
  );
  assert.equal(
    nodes(f.tree, "CatalogRow").every((row) => row.props.priority !== "high"),
    true,
  );
  assert.deepEqual(Array.from(f.preloads[0].sources), [
    "https://tcgindex.org/market/images/kream/pokemon-0",
    "https://tcgindex.org/market/images/kream/one_piece-0",
    "https://tcgindex.org/market/images/kream/yugioh-0",
    "https://tcgindex.org/market/images/kream/magic-0",
  ]);
});

test("home image warming stops on unmount, backgrounding and loss of web connectivity", () => {
  for (const platform of ["web", "android", "ios"]) {
    const f = fixture({ platform });
    assert.equal(f.preloads[0].allowed(), true);
    if (platform === "web") {
      f.environment.document.visibilityState = "hidden";
      assert.equal(f.preloads[0].allowed(), false);
      f.environment.document.visibilityState = "visible";
      f.environment.navigator.onLine = false;
      assert.equal(f.preloads[0].allowed(), false);
      f.environment.navigator.onLine = true;
    } else {
      f.environment.AppState.currentState = "background";
      assert.equal(f.preloads[0].allowed(), false);
      f.environment.AppState.currentState = "active";
    }
    f.cleanups[0]();
    assert.equal(f.preloads[0].allowed(), false);
  }
});

test("a selected home game disables and avoids refreshing the three unrelated catalogs", async () => {
  const f = fixture({ game: "yugioh" });
  assert.equal(f.queries.filter((query) => query.enabled === false).length, 3);
  assert.equal(
    nodes(f.tree, "CardArt").every((hero) => hero.props.src.includes("yugioh")),
    true,
  );
  f.tree.props.onRefresh();
  await new Promise(setImmediate);
  assert.deepEqual(
    f.refreshed.filter((path) => path.startsWith("/tcg/catalog")),
    ["/tcg/catalog?game=yugioh&market=KR&page=1"],
  );
  const all = fixture();
  all.tree.props.onRefresh();
  assert.equal(
    all.refreshed.filter((path) => path.startsWith("/tcg/catalog")).length,
    4,
  );
});
