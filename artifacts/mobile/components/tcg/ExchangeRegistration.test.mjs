import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { registrationId } from "../../lib/tcgRegistration.ts";

const source = readFileSync(
  new URL("./ExchangeFeedScreen.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(
  "export " +
    source.slice(
      source.indexOf("function OfferForm("),
      source.indexOf("function Comments("),
    ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const targetId = "f28ea003-6c26-4ae6-b75e-e0103ddaa442";
const ownId = "dacec9a4-91cc-4fa5-87e6-8fa8ce6577a7";
const collectionId = "f04607c0-92ad-4ea2-a695-772c1a62be53";
const listing = {
  id: targetId,
  mode: "swap",
  version: 3,
  status: "active",
  available: 1,
  owner_id: "other",
  card_name: "상대 카드",
  wanted_card_ids: [],
};
const offered = {
  id: ownId,
  mode: "swap",
  status: "active",
  version: 9,
  available: 1,
  photos: [],
  card_id: "catalog-card",
  card_name: "내 카드",
};

function fixture({ items = [], owned = [], error } = {}) {
  const calls = [],
    routes = [],
    events = [],
    exports = {};
  const jsx = (type, props) => ({ type, props });
  const env = {
    useUgcConsent: () => ({ ensureConsent: async () => true, promptProps: {} }),
    UgcConsentPrompt: "UgcConsentPrompt",
    useState: (initial) => [initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useAuth: () => ({ userId: "viewer" }),
    useGetMe: () => ({ data: { id: "viewer" } }),
    registrationId,
    useRouter: () => ({
      push: (path) => {
        events.push("navigate");
        routes.push(path);
      },
    }),
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
    useQuery: (options) =>
      options.queryKey[2] === "/tcg/collection"
        ? { data: { items: owned }, isSuccess: true }
        : options.queryKey[2] === "/tcg/listings/" + targetId
          ? {
              data: listing,
              isSuccess: true,
              isPending: false,
              isFetching: false,
              isError: false,
              refetch: async () => {},
            }
          : {
              data: { items },
              isSuccess: !error,
              isPending: false,
              isFetching: false,
              isError: !!error,
              error,
            },
    api: async (path, method, body) => {
      calls.push({ path, method, body });
      return { id: "trade" };
    },
    key: () => "idempotency-key",
    errorText: (error) => error?.message,
    conditionName: (value) => value,
    FlatList: "FlatList",
    Pressable: "Pressable",
    View: "View",
    Txt: "Text",
    Button: "Button",
    Field: "Field",
    Notice: "Notice",
    Icon: "Icon",
    CardArt: "CardArt", CollectionCardArt: "CollectionCardArt",
    ActivityIndicator: "Spinner",
    styles: {},
    C: {},
  };
  new Function("exports", "require", ...Object.keys(env), compiled)(
    exports,
    () => ({ jsx, jsxs: jsx }),
    ...Object.values(env),
  );
  const tree = exports.OfferForm({
    listing,
    offeredListingId: ownId,
    onClose: () => events.push("close"),
    ensureConsent: async () => true,
  });
  function find(node, type, label) {
    if (!node) return;
    if (Array.isArray(node))
      return node.map((item) => find(item, type, label)).find(Boolean);
    if (node.type === type && (!label || node.props.label === label))
      return node;
    return (
      find(node.props?.children, type, label) ||
      find(node.props?.ListHeaderComponent, type, label) ||
      find(node.props?.ListFooterComponent, type, label)
    );
  }
  return { tree, calls, routes, events, find };
}

test("returning from publication selects the newly created listing and submits its latest version", async () => {
  const f = fixture({ items: [offered] });
  const submit = f.find(f.tree, "Button", "교환 제안 보내기");
  assert.equal(submit.props.disabled, false);
  submit.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls[0].body.offeredListingId, ownId);
  assert.equal(f.calls[0].body.offeredVersion, 9);
  assert.deepEqual(f.events, ["close", "navigate"]);
});

test("a saved but unpublished card continues to its selected publication step with the original target", () => {
  const f = fixture({
    owned: [
      { id: collectionId, card_id: offered.card_id, quantity: 1, reserved: 0 },
    ],
  });
  const action = f.find(f.tree, "Button", "보유 카드 공개하고 제안하기");
  assert.ok(action);
  action.props.onPress();
  assert.deepEqual(f.events, ["close", "navigate"]);
  assert.deepEqual(f.routes, [
    {
      pathname: "/tcg/sell",
      params: { offerListing: targetId, collection: collectionId },
    },
  ]);
  assert.equal(
    f.find(f.tree, "Button", "교환 제안 보내기").props.disabled,
    true,
  );
});

test("a cancelled or unavailable listing cannot be selected by a registration return parameter", () => {
  for (const item of [
    { ...offered, status: "cancelled" },
    { ...offered, available: 0 },
  ]) {
    const f = fixture({ items: [item] });
    assert.equal(
      f.find(f.tree, "Button", "교환 제안 보내기").props.disabled,
      true,
    );
  }
});
