/** Actual shop components + RN Web + existing realtime hook. Deterministic API/catalog/device fixtures. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  root = path.resolve(mobile, "../..");
const req = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { build } = req("esbuild"),
  { WebSocketServer } = req("ws");
const playwright = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? "playwright",
);
const tmp = await mkdtemp("/tmp/davaq-shop-browser-");
const fixtures = path.join(mobile, "tests/shop-fixtures"),
  shim = path.join(fixtures, "shims.jsx");
const exact = new Map([
  ["expo-router", path.join(fixtures, "router.jsx")],
  ["@/lib/davaq", path.join(fixtures, "api.jsx")],
  ...[
    "expo-linking",
    "expo-image-picker",
    "expo-image-manipulator",
    "@expo/vector-icons",
    "expo-linear-gradient",
    "react-native-safe-area-context",
    "@react-native-community/netinfo",
    "@workspace/api-client-react",
    "@/lib/davaqAuth",
    "@/hooks/useMediaUri",
    "@/lib/uploadImage",
    "@/lib/useCachedTcgScans",
    "@/components/tcg/Cards",
  ].map((k) => [k, shim]),
]);
const rnweb = createRequire(path.join(mobile, "package.json")).resolve(
  "react-native-web",
);
await build({
  absWorkingDir: mobile,
  entryPoints: [path.join(fixtures, "entry.jsx")],
  outfile: path.join(tmp, "app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { __DEV__: "false", "process.env.NODE_ENV": '"test"' },
  resolveExtensions: [
    ".web.tsx",
    ".web.ts",
    ".web.js",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".json",
  ],
  loader: { ".ttf": "file", ".png": "file" },
  plugins: [
    {
      name: "shop-fixtures",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (exact.has(args.path)) return { path: exact.get(args.path) };
          if (args.path.startsWith(".")) {
            const relative = path.resolve(args.resolveDir, args.path);
            if (relative === path.join(mobile, "lib/davaq"))
              return { path: path.join(fixtures, "api.jsx") };
            if (
              relative === path.join(mobile, "components/tcg/Cards") ||
              relative === path.join(mobile, "hooks/useMediaUri")
            )
              return { path: shim };
          }
          if (args.path === "react-native") return { path: rnweb };
          if (args.path.startsWith("@/"))
            return { path: resolveAlias(args.path) };
        });
      },
    },
  ],
});
function resolveAlias(p) {
  const base = path.join(mobile, p.slice(2));
  const { existsSync } = req("node:fs");
  for (const e of [
    "",
    ".web.tsx",
    ".web.ts",
    ".web.js",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "/index.ts",
  ])
    if (existsSync(base + e)) return base + e;
  throw Error("Missing alias " + p);
}
const shop = "11111111-1111-4111-8111-111111111111",
  quote = "22222222-2222-4222-8222-222222222222",
  thread = "33333333-3333-4333-8333-333333333333",
  scan = "44444444-4444-4444-8444-444444444444";
const card = {
  id: "kream:123",
  name: "피카츄 테스트 카드",
  game: "pokemon",
  number: "001",
  set: "테스트 세트",
  region: "KR",
  currency: "KRW",
  value: 12000,
  priceType: "LISTED",
  observedAt: "2026-10-20",
};
const state = {
  items: [],
  version: 1,
  messages: [],
  addRequests: [],
  read: [],
  push: [],
};
const sockets = new Set();
let server, context, browser;
function emit(messageId, actor) {
  for (const ws of sockets)
    ws.send(
      JSON.stringify({
        type: "shop.message.created",
        userIds: [ws.actor],
        actorUserId: actor,
        createdAt: new Date().toISOString(),
        data: { eventId: messageId, shopId: shop, threadId: thread, messageId },
      }),
    );
}
try {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost"),
        actor = req.headers["x-fixture-actor"] ?? "owner";
      let body = {};
      if (["POST", "PATCH", "DELETE"].includes(req.method)) {
        let raw = "";
        for await (const b of req) raw += b;
        body = raw ? JSON.parse(raw) : {};
      }
      const json = (x, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(x));
      };
      if (url.pathname === "/api/realtime/ticket")
        return json({
          ticket: (req.headers.authorization ?? "Bearer owner").replace(
            "Bearer ",
            "",
          ),
        });
      if (url.pathname === "/api/shops")
        return json({
          items: [{ id: shop, name: "DavaQ 테스트 매장", role: "owner" }],
        });
      if (url.pathname === `/api/shops/${shop}/quotes/${quote}`)
        return json({
          id: quote,
          version: state.version,
          status: "draft",
          customer_label: "테스트 고객",
          items: state.items,
          payment_status: "unpaid",
        });
      if (url.pathname === `/api/shops/${shop}/quotes/${quote}/items`) {
        assert.equal(body.version, state.version);
        assert.equal(body.printingConfirmed, true);
        assert.equal(body.scanId, scan);
        assert.ok(body.requestKey);
        state.addRequests.push(body);
        state.items.push({
          id: "item-1",
          card_id: body.cardId,
          card_name: card.name,
          quantity: body.quantity,
          condition: body.condition,
          unit_price: body.unitPrice,
          decision: body.decision,
          reason: body.reason,
          location: body.location,
        });
        state.version++;
        return json(state.items.at(-1), 201);
      }
      if (url.pathname === "/api/tcg/scans")
        return json({
          items: [
            {
              id: scan,
              object_path: "/objects/fixture-card",
              status: "identified",
              result: {
                targetId: card.id,
                name: card.name,
                number: "001",
                cardVerified: true,
                matchLevel: "printing",
                price: {
                  state: "priced",
                  price: 12000,
                  currency: "KRW",
                  priceType: "LISTED",
                },
              },
            },
          ],
        });
      if (url.pathname === "/api/tcg/catalog/detail")
        return json({ target: card, history: [] });
      if (url.pathname === "/api/tcg/catalog")
        return json({
          items: [{ id: card.id, saveId: card.id, title: card.name }],
        });
      if (url.pathname === `/api/shops/${shop}/prices`)
        return json({ items: [{ card_id: card.id, unit_price: 6000 }] });
      if (url.pathname === `/api/shops/${shop}/threads/${thread}`)
        return json({
          id: thread,
          status: "open",
          viewerKind: actor === "customer" ? "customer" : "shop",
          ai_consent: false,
          muted: false,
          messages: state.messages,
          wants: [],
        });
      if (url.pathname === `/api/shops/${shop}/threads/${thread}/messages`) {
        const msg = {
          id: crypto.randomUUID(),
          seq: state.messages.length + 1,
          sender_kind: actor === "customer" ? "customer" : "shop",
          content: body.content,
          created_at: new Date().toISOString(),
        };
        state.messages.push(msg);
        json({ id: msg.id, seq: msg.seq }, 201);
        emit(msg.id, actor);
        state.push.push({
          recipient: actor === "customer" ? "owner" : "customer",
          url: `/shop/conversation?shopId=${shop}&threadId=${thread}`,
        });
        return;
      }
      if (url.pathname.endsWith("/read")) {
        state.read.push({ actor, ...body });
        res.writeHead(204);
        return res.end();
      }
      if (
        url.pathname.endsWith("/stock") ||
        url.pathname.endsWith("/quotes") ||
        url.pathname.endsWith("/threads") ||
        url.pathname.endsWith("/matches") ||
        url.pathname.endsWith("/members")
      )
        return json({ items: [] });
      if (url.pathname.startsWith("/api"))
        return json(
          { message: "Unhandled browser fixture route " + url.pathname },
          404,
        );
      if (url.pathname === "/app.js") {
        res.setHeader("content-type", "text/javascript");
        return res.end(await readFile(path.join(tmp, "app.js")));
      }
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}input,textarea{font:inherit}</style><div id="root"></div><script src="/app.js"></script></html>',
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: String(e) }));
    }
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    ws.actor = new URL(req.url, "http://localhost").searchParams.get("ticket");
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(
    `${origin}/shop/scan?shopId=${shop}&quoteId=${quote}&actor=owner`,
  );
  await page.getByText("매입 견적 · 연속 스캔", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "이 견적에 추가 · 판본·금액 확인",
      exact: true,
    })
    .click();
  await page.getByText("스캔 카드 매입 확인", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "실물과 언어·판본·번호가 일치함을 확인",
      exact: true,
    })
    .click();
  await page.getByLabel("장당 매입 제안가 (원)").fill("6500");
  await page.getByRole("button", { name: "견적에 담기", exact: true }).click();
  await page.getByText("매입 견적 · 연속 스캔", { exact: true }).waitFor();
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].unit_price, 6500);
  assert.equal(state.addRequests[0].scanId, scan);
  const out = process.env.SHOP_EVIDENCE_DIR ?? path.join(tmp, "evidence");
  await mkdir(out, { recursive: true });
  await page.screenshot({
    path: path.join(out, "scan-next-card.png"),
    fullPage: true,
  });
  await page.goto(
    `${origin}/shop/conversation?shopId=${shop}&threadId=${thread}&actor=owner`,
  );
  const customer = await context.newPage();
  customer.on("pageerror", (e) => errors.push(String(e)));
  await customer.goto(
    `${origin}/shop/conversation?shopId=${shop}&threadId=${thread}&actor=customer`,
  );
  await customer
    .getByLabel("메시지", { exact: true })
    .fill("피카츄 재고 문의드립니다");
  const start = Date.now();
  await customer
    .getByRole("button", { name: "메시지 보내기", exact: true })
    .click();
  await page
    .getByText("피카츄 재고 문의드립니다", { exact: true })
    .waitFor({ timeout: 5000 });
  const receivedMs = Date.now() - start;
  assert.ok(receivedMs < 5000);
  await page
    .getByLabel("메시지", { exact: true })
    .fill("재고 확인 후 안내드리겠습니다");
  await page
    .getByRole("button", { name: "메시지 보내기", exact: true })
    .click();
  await customer
    .getByText("재고 확인 후 안내드리겠습니다", { exact: true })
    .waitFor({ timeout: 5000 });
  assert.ok(state.read.some((r) => r.actor === "owner" && r.throughSeq >= 1));
  assert.ok(state.push.some((p) => p.recipient === "customer"));
  await page.screenshot({
    path: path.join(out, "shop-live-conversation.png"),
    fullPage: true,
  });
  await customer.screenshot({
    path: path.join(out, "customer-live-conversation.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      scanQuoteItems: state.items.length,
      realtimeReceivedMs: receivedMs,
      messages: state.messages.length,
      readUpdates: state.read.length,
      evidence: out,
      boundaries:
        "Actual shop components and realtime hook; API/catalog/device/push provider fixtures. No physical device or real OCR/push delivery tested.",
    }),
  );
} finally {
  await context?.close();
  await browser?.close();
  for (const ws of sockets) ws.terminate();
  await new Promise((r) => (server ? server.close(r) : r()));
}
