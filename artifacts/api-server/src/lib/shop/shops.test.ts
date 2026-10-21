import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({
  db: null as any,
  ai: vi.fn(),
  push: vi.fn(),
  realtime: vi.fn(),
  failJobs: false,
}));
vi.mock("@workspace/db", () => {
  const query = async (text: string, values?: unknown[]) => {
    if (
      state.failJobs &&
      text.startsWith("INSERT INTO davaq_shop_delivery_jobs")
    )
      throw Error("simulated outbox failure");
    const r = await state.db.query(text, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? null };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("../tcgService", () => ({
  transaction: async (fn: any) => {
    const { pool } = await import("@workspace/db");
    const c = await pool.connect();
    await c.query("BEGIN");
    try {
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  },
}));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.get("x-test-user");
    if (!id) return res.sendStatus(401);
    req.dbUser = { id };
    next();
  },
}));
vi.mock("../rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../push", () => ({ sendPushToUser: state.push }));
vi.mock("../realtime", () => ({ publishRealtimeEvent: state.realtime }));
vi.mock("../aiClient", () => ({
  getOpenAI: () => ({ chat: { completions: { create: state.ai } } }),
}));
vi.mock("../tcgCatalog", async (importOriginal) => {
  const m = await importOriginal<any>();
  return {
    ...m,
    resolveCard: async (id: string) => ({
      target: {
        id,
        name: "테스트 카드",
        game: "pokemon",
        number: "001",
        region: "KR",
        value: 10000,
        currency: "KRW",
        observedAt: "2026-10-20",
        priceType: "LISTED",
      },
    }),
  };
});
import router from "../../routes/shops";
import { processShopDelivery, deliverShopJob } from "./delivery";
const owner = "11111111-1111-4111-8111-111111111111",
  staff = "22222222-2222-4222-8222-222222222222",
  customer = "33333333-3333-4333-8333-333333333333",
  other = "44444444-4444-4444-8444-444444444444";
const card = "kream:123";
const app = express();
app.use(express.json(), router);
const get = (path: string, user = owner) =>
  request(app).get(path).set("x-test-user", user);
const post = (path: string, body: object = {}, user = owner) =>
  request(app).post(path).set("x-test-user", user).send(body);
let shop: string, quote: string;
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(
    "CREATE TABLE users(id uuid PRIMARY KEY,nickname text); CREATE TABLE tcg_scans(id uuid PRIMARY KEY,owner_id uuid REFERENCES users(id),result jsonb);",
  );
  await state.db.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/drizzle/0052_davaq_shops.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await state.db.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/drizzle/0053_shop_scan_delivery.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
afterAll(async () => {
  await state.db.close();
});
beforeEach(async () => {
  process.env.DAVAQ_SHOPS_ENABLED = "true";
  state.failJobs = false;
  state.push.mockReset().mockResolvedValue(undefined);
  state.realtime.mockReset().mockResolvedValue(undefined);
  await state.db.exec("TRUNCATE users CASCADE");
  for (const [id, nick] of [
    [owner, "점주"],
    [staff, "직원"],
    [customer, "고객"],
    [other, "외부인"],
  ])
    await state.db.query("INSERT INTO users VALUES($1,$2)", [id, nick]);
  state.ai
    .mockReset()
    .mockResolvedValue({ choices: [{ message: { content: "검토용 초안" } }] });
  shop = (await post("/shops", { name: "테스트 매장" })).body.id;
  quote = (await post(`/shops/${shop}/quotes`, { customerLabel: "현장 고객" }))
    .body.id;
});
async function addItem(version = 1, decision = "buy") {
  return post(`/shops/${shop}/quotes/${quote}/items`, {
    cardId: card,
    version,
    quantity: 2,
    condition: "NM",
    unitPrice: 3000,
    decision,
    reason: decision === "reject" ? "상태 불량" : "",
    location: "A바인더",
  });
}
async function joinStaff() {
  const i = await post(`/shops/${shop}/invites`);
  return post("/shops/join", { token: i.body.token }, staff);
}
async function contact() {
  return (await post(`/shops/${shop}/contact`, {}, customer)).body.id;
}
describe("free shop pilot boundaries and workflows", () => {
  it("keeps the module disabled by default and requires login", async () => {
    delete process.env.DAVAQ_SHOPS_ENABLED;
    expect((await get("/shops/config")).body.available).toBe(false);
    expect((await get("/shops")).status).toBe(404);
    expect((await request(app).get("/shops/config")).status).toBe(401);
  });
  it("isolates all private shop resources from outsiders", async () => {
    for (const path of [
      "quotes",
      "stock",
      "prices",
      "members",
      "threads",
      "matches",
      "export",
    ])
      expect((await get(`/shops/${shop}/${path}`, other)).status).toBe(403);
    expect((await get(`/shops/${shop}/quotes/${quote}`, other)).status).toBe(
      403,
    );
    const p = await get(`/shops/${shop}/public`, other);
    expect(p.status).toBe(200);
    expect(p.body.owner_id).toBeUndefined();
  });
  it("uses one-time invites, restricts staff, and immediately revokes access", async () => {
    const i = await post(`/shops/${shop}/invites`);
    expect(
      (await post("/shops/join", { token: i.body.token }, staff)).status,
    ).toBe(200);
    expect(
      (await post("/shops/join", { token: i.body.token }, other)).status,
    ).toBe(409);
    expect((await post(`/shops/${shop}/invites`, {}, staff)).status).toBe(403);
    await addItem();
    expect(
      (
        await post(
          `/shops/${shop}/quotes/${quote}/confirm`,
          { version: 2, customerConfirmed: true },
          staff,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/shops/${shop}/members/${staff}`)
          .set("x-test-user", owner)
      ).status,
    ).toBe(204);
    expect((await get(`/shops/${shop}/stock`, staff)).status).toBe(403);
  });
  it("does not allow another shop to use a quote id", async () => {
    const s = (await post("/shops", { name: "다른 매장" }, other)).body.id;
    expect((await get(`/shops/${s}/quotes/${quote}`, other)).status).toBe(404);
  });
  it("rejects stale versions and retains server-resolved price snapshots", async () => {
    const i = await addItem();
    expect(i.status).toBe(201);
    expect(i.body.snapshot.value).toBe(10000);
    expect((await addItem()).status).toBe(409);
    const q = (await get(`/shops/${shop}/quotes/${quote}`)).body;
    expect(q.version).toBe(2);
    expect(q.items.length).toBe(1);
  });
  it("requires explicit customer confirmation and buys only accepted items", async () => {
    await addItem();
    await addItem(2, "reject");
    expect(
      (
        await post(`/shops/${shop}/quotes/${quote}/confirm`, {
          version: 3,
          customerConfirmed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/shops/${shop}/quotes/${quote}/confirm`, {
          version: 3,
          customerConfirmed: true,
        })
      ).status,
    ).toBe(200);
    const stock = (await get(`/shops/${shop}/stock`)).body.items;
    expect(stock).toHaveLength(1);
    expect(stock[0].quantity).toBe(2);
    expect(stock[0].unit_cost).toBe(3000);
    expect((await addItem(4)).status).toBe(409);
  });
  it("makes confirmation and stock movements idempotent without negative stock", async () => {
    await addItem();
    await post(`/shops/${shop}/quotes/${quote}/confirm`, {
      version: 2,
      customerConfirmed: true,
    });
    await post(`/shops/${shop}/quotes/${quote}/confirm`, {
      version: 2,
      customerConfirmed: true,
    });
    const items = (await get(`/shops/${shop}/stock`)).body.items;
    expect(items).toHaveLength(1);
    const path = `/shops/${shop}/stock/${items[0].id}/movements`,
      body = { delta: -1, reason: "현장 판매", requestKey: "sale-test-01" };
    expect((await post(path, body)).body.quantity).toBe(1);
    expect((await post(path, body)).body.quantity).toBe(1);
    expect((await post(path, { ...body, delta: -2 })).status).toBe(409);
    expect(
      (await post(path, { ...body, delta: -2, requestKey: "sale-test-02" }))
        .status,
    ).toBe(409);
  });
  it("does not invent payment verification and requires confirmed quote", async () => {
    expect(
      (
        await post(`/shops/${shop}/quotes/${quote}/payment`, {
          status: "recorded_paid",
        })
      ).status,
    ).toBe(409);
    await addItem();
    await post(`/shops/${shop}/quotes/${quote}/confirm`, {
      version: 2,
      customerConfirmed: true,
    });
    expect(
      (await get(`/shops/${shop}/quotes/${quote}`)).body.payment_status,
    ).toBe("unpaid");
    expect(
      (
        await post(`/shops/${shop}/quotes/${quote}/payment`, {
          status: "recorded_paid",
        })
      ).status,
    ).toBe(204);
  });
  it("cancels a draft without stock changes", async () => {
    await addItem();
    expect(
      (
        await post(`/shops/${shop}/quotes/${quote}/cancel`, {
          version: 2,
          reason: "고객 취소",
        })
      ).status,
    ).toBe(204);
    expect((await get(`/shops/${shop}/stock`)).body.items).toHaveLength(0);
    expect(
      (
        await post(`/shops/${shop}/quotes/${quote}/confirm`, {
          version: 3,
          customerConfirmed: true,
        })
      ).status,
    ).toBe(409);
  });
  it("allows scoped customer/shop conversation but no third-party or revoked access", async () => {
    const t = await contact();
    await joinStaff();
    const path = `/shops/${shop}/threads/${t}`;
    expect((await get(path, other)).status).toBe(403);
    expect(
      (
        await post(
          `${path}/messages`,
          { content: "카드 있어요?", requestKey: "message-key-1" },
          customer,
        )
      ).status,
    ).toBe(201);
    await post(
      `${path}/messages`,
      { content: "확인 중입니다", requestKey: "message-key-2" },
      staff,
    );
    const c = (await get(path, customer)).body;
    expect(c.messages.map((m: any) => m.sender_kind)).toEqual([
      "customer",
      "shop",
    ]);
    expect(c.messages[1].sender_id).toBeUndefined();
    await request(app)
      .delete(`/shops/${shop}/members/${staff}`)
      .set("x-test-user", owner);
    expect((await get(path, staff)).status).toBe(403);
  });
  it("lets only the customer grant AI consent; AI drafts are never sent", async () => {
    const t = await contact(),
      path = `/shops/${shop}/threads/${t}`,
      body = { purpose: "reply", threadId: t, acknowledgeExternalAi: true };
    expect((await post(`/shops/${shop}/ai-draft`, body)).status).toBe(403);
    expect(
      (
        await request(app)
          .patch(path)
          .set("x-test-user", owner)
          .send({ aiConsent: true })
      ).status,
    ).toBe(403);
    await request(app)
      .patch(path)
      .set("x-test-user", customer)
      .send({ aiConsent: true });
    const draft = await post(`/shops/${shop}/ai-draft`, body);
    expect(draft.body.requiresReview).toBe(true);
    expect((await get(path, customer)).body.messages).toHaveLength(0);
    await request(app)
      .patch(path)
      .set("x-test-user", customer)
      .send({ aiConsent: false });
    expect((await post(`/shops/${shop}/ai-draft`, body)).status).toBe(403);
  });
  it("enforces a persistent daily AI quota", async () => {
    const t = await contact();
    await request(app)
      .patch(`/shops/${shop}/threads/${t}`)
      .set("x-test-user", customer)
      .send({ aiConsent: true });
    await state.db.query(
      "INSERT INTO davaq_shop_ai_usage VALUES($1,(now() AT TIME ZONE 'Asia/Seoul')::date,20)",
      [shop],
    );
    expect(
      (
        await post(`/shops/${shop}/ai-draft`, {
          purpose: "summary",
          threadId: t,
          acknowledgeExternalAi: true,
        })
      ).status,
    ).toBe(429);
    expect(state.ai).not.toHaveBeenCalled();
  });
  it("matches customer requests to stock without pretending cost is a sale price", async () => {
    const t = await contact(),
      path = `/shops/${shop}/threads/${t}`;
    expect(
      (
        await post(
          `${path}/wants`,
          { cardId: card, quantity: 1, maxPrice: 100 },
          owner,
        )
      ).status,
    ).toBe(403);
    await post(
      `${path}/wants`,
      { cardId: card, quantity: 1, maxPrice: 100 },
      customer,
    );
    expect((await get(`/shops/${shop}/matches`)).body.items).toHaveLength(0);
    await addItem();
    await post(`/shops/${shop}/quotes/${quote}/confirm`, {
      version: 2,
      customerConfirmed: true,
    });
    const matches = (await get(`/shops/${shop}/matches`)).body.items;
    expect(matches).toHaveLength(1);
    expect(matches[0].available).toBe(2);
    expect(matches[0].unit_cost).toBeUndefined();
  });
  it("exports stock with spreadsheet formula protection", async () => {
    await addItem();
    await post(`/shops/${shop}/quotes/${quote}/confirm`, {
      version: 2,
      customerConfirmed: true,
    });
    await state.db.query(
      "UPDATE davaq_shop_stock SET location='=HYPERLINK(\"bad\")'",
    );
    const csv = await get(`/shops/${shop}/export`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("'=HYPERLINK");
    expect((await get(`/shops/${shop}/export`, customer)).status).toBe(403);
  });
  it("keeps the customer inbox private and message retries consistent", async () => {
    const t = await contact(),
      path = `/shops/${shop}/threads/${t}/messages`;
    const body = { content: "가격 문의", requestKey: "retry-message-01" };
    expect((await post(path, body, customer)).status).toBe(201);
    expect((await post(path, body, customer)).status).toBe(201);
    expect(
      (await post(path, { ...body, content: "다른 내용" }, customer)).status,
    ).toBe(409);
    expect((await get("/shops/inbox", customer)).body.items).toHaveLength(1);
    expect((await get("/shops/inbox", other)).body.items).toHaveLength(0);
    expect(
      (await get(`/shops/${shop}/threads/${t}`, customer)).body.messages,
    ).toHaveLength(1);
  });
  it("adds a scanned card with provenance exactly once across a lost response", async () => {
    const scan = "55555555-5555-4555-8555-555555555555";
    await state.db.query("INSERT INTO tcg_scans VALUES($1,$2,$3)", [
      scan,
      owner,
      JSON.stringify({ targetId: card }),
    ]);
    const path = `/shops/${shop}/quotes/${quote}/items`,
      body = {
        cardId: card,
        scanId: scan,
        printingConfirmed: true,
        requestKey: "scan-insert-01",
        version: 1,
        quantity: 1,
        condition: "NM",
        unitPrice: 2500,
      };
    const first = await post(path, body);
    expect(first.status).toBe(201);
    expect(first.body.source_scan_id).toBe(scan);
    expect(first.body.snapshot.sourceScan.recognizedCardId).toBe(card);
    expect((await post(path, body)).body.id).toBe(first.body.id);
    expect(
      (await get(`/shops/${shop}/quotes/${quote}`)).body.items,
    ).toHaveLength(1);
    expect((await post(path, { ...body, unitPrice: 3000 })).status).toBe(409);
  });
  it("blocks another user scan and requires explicit printing confirmation", async () => {
    const scan = "55555555-5555-4555-8555-555555555555";
    await state.db.query("INSERT INTO tcg_scans VALUES($1,$2,$3)", [
      scan,
      customer,
      JSON.stringify({ targetId: card }),
    ]);
    const path = `/shops/${shop}/quotes/${quote}/items`,
      body = {
        cardId: card,
        scanId: scan,
        requestKey: "scan-private-01",
        version: 1,
        quantity: 1,
        condition: "NM",
        unitPrice: 100,
      };
    expect((await post(path, body)).status).toBe(400);
    expect(
      (await post(path, { ...body, printingConfirmed: true })).status,
    ).toBe(403);
  });
  it("commits message and delivery jobs together and never duplicates jobs on retry", async () => {
    const t = await contact(),
      path = `/shops/${shop}/threads/${t}/messages`,
      body = { content: "카드 문의", requestKey: "atomic-message-01" };
    state.failJobs = true;
    expect((await post(path, body, customer)).status).toBe(503);
    expect(
      (await state.db.query("SELECT * FROM davaq_shop_messages")).rows,
    ).toHaveLength(0);
    state.failJobs = false;
    expect((await post(path, body, customer)).status).toBe(201);
    await post(path, body, customer);
    const jobs = (
      await state.db.query("SELECT * FROM davaq_shop_delivery_jobs")
    ).rows;
    expect(jobs).toHaveLength(3);
    expect(
      jobs
        .filter((j: any) => j.channel === "push")
        .map((j: any) => j.recipient_id),
    ).toEqual([owner]);
  });
  it("delivers metadata-only realtime and deep-linked private push through existing providers", async () => {
    const t = await contact();
    const message = await post(
      `/shops/${shop}/threads/${t}/messages`,
      { content: "비공개 본문입니다", requestKey: "delivery-test-01" },
      customer,
    );
    await processShopDelivery("realtime");
    expect(state.realtime).toHaveBeenCalled();
    const event = state.realtime.mock.calls[0][0];
    expect(event.type).toBe("shop.message.created");
    expect(event.data.threadId).toBe(t);
    expect(JSON.stringify(event)).not.toContain("비공개");
    await state.db.exec(
      "UPDATE davaq_shop_delivery_jobs SET available_at=now()-interval '1 second'",
    );
    await processShopDelivery("push");
    expect(state.push.mock.calls[0][0]).toBe(owner);
    expect(state.push.mock.calls[0][1].url).toBe(
      `/shop/conversation?shopId=${shop}&threadId=${t}`,
    );
    expect(state.push.mock.calls[0][1].data.messageId).toBe(message.body.id);
    expect(state.push.mock.calls[0][1].body).not.toContain("비공개");
  });
  it("retries provider failures and honors delivery leases", async () => {
    const t = await contact();
    await post(
      `/shops/${shop}/threads/${t}/messages`,
      { content: "문의", requestKey: "retry-delivery-01" },
      customer,
    );
    state.realtime.mockRejectedValueOnce(Error("offline"));
    expect(await processShopDelivery("realtime")).toBe(true);
    const pending = (
      await state.db.query(
        "SELECT * FROM davaq_shop_delivery_jobs WHERE channel='realtime' AND attempts=1",
      )
    ).rows[0];
    expect(pending.delivered_at).toBeNull();
    expect(pending.leased_until).toBeNull();
    await state.db.exec(
      "UPDATE davaq_shop_delivery_jobs SET leased_until=now()+interval '1 minute',lease_token=gen_random_uuid() WHERE delivered_at IS NULL",
    );
    expect(await processShopDelivery("realtime")).toBe(false);
    await state.db.exec(
      "UPDATE davaq_shop_delivery_jobs SET leased_until=now()-interval '1 minute',available_at=now()-interval '1 second'",
    );
    expect(await processShopDelivery("realtime")).toBe(true);
  });
  it("does not push a message that was read or muted before delayed delivery", async () => {
    const t = await contact(),
      path = `/shops/${shop}/threads/${t}`;
    const m = await post(
      `${path}/messages`,
      { content: "읽을 메시지", requestKey: "read-test-01" },
      customer,
    );
    expect(
      (await get(`/shops/${shop}/threads`)).body.items[0].unread_count,
    ).toBe(1);
    expect(
      (await post(`${path}/read`, { throughSeq: m.body.seq })).status,
    ).toBe(204);
    expect(
      (await get(`/shops/${shop}/threads`)).body.items[0].unread_count,
    ).toBe(0);
    await state.db.exec(
      "UPDATE davaq_shop_delivery_jobs SET available_at=now()-interval '1 second'",
    );
    await processShopDelivery("push");
    expect(state.push).not.toHaveBeenCalled();
    await request(app)
      .patch(`${path}/notifications`)
      .set("x-test-user", owner)
      .send({ muted: true });
    await post(
      `${path}/messages`,
      { content: "새 메시지", requestKey: "read-test-02" },
      customer,
    );
    await state.db.exec(
      "UPDATE davaq_shop_delivery_jobs SET available_at=now()-interval '1 second'",
    );
    await processShopDelivery("push");
    expect(state.push).not.toHaveBeenCalled();
  });
  it("revokes delayed realtime and push access when a staff member is removed", async () => {
    await joinStaff();
    const t = await contact();
    await post(
      `/shops/${shop}/threads/${t}/messages`,
      { content: "문의", requestKey: "staff-job-01" },
      customer,
    );
    const jobs = (
      await state.db.query(
        "SELECT * FROM davaq_shop_delivery_jobs WHERE recipient_id=$1",
        [staff],
      )
    ).rows;
    await request(app)
      .delete(`/shops/${shop}/members/${staff}`)
      .set("x-test-user", owner);
    for (const job of jobs) await deliverShopJob(job);
    expect(state.push).not.toHaveBeenCalled();
    expect(state.realtime).not.toHaveBeenCalled();
  });
  it("blocks unauthorized read and mute, and never regresses a read cursor", async () => {
    const t = await contact(),
      path = `/shops/${shop}/threads/${t}`;
    const m = await post(
      `${path}/messages`,
      { content: "문의", requestKey: "read-cursor-01" },
      customer,
    );
    expect(
      (await post(`${path}/read`, { throughSeq: m.body.seq }, other)).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`${path}/notifications`)
          .set("x-test-user", other)
          .send({ muted: true })
      ).status,
    ).toBe(403);
    await post(`${path}/read`, { throughSeq: 999999 });
    await post(`${path}/read`, { throughSeq: 0 });
    const reader = (
      await state.db.query(
        "SELECT * FROM davaq_shop_thread_readers WHERE thread_id=$1 AND user_id=$2",
        [t, owner],
      )
    ).rows[0];
    expect(Number(reader.last_read_seq)).toBe(m.body.seq);
  });
});
