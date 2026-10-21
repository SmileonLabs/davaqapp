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
const state = vi.hoisted(() => ({ db: null as any, feedQuery: null as { text: string; values?: unknown[] } | null }));
vi.mock("@workspace/db", () => {
  const query = async (text: string, values?: unknown[]) => {
    if (text.includes("pg_advisory")) return { rows: [], rowCount: 1 };
    if (text.startsWith("WITH feed_snapshot AS")) state.feedQuery = { text, values };
    const r = await state.db.query(text, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? null };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock("./auth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  const id = req.get("authorization")?.replace(/^Bearer /, "");
  if (!["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].includes(id)) return res.sendStatus(401);
  req.dbUser = { id }; next();
} }));
vi.mock("./rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("./adminRbac", () => ({ hasAdminAccess: async () => false, hasAdminRole: async () => false }));
vi.mock("./aiClient", () => ({ getOpenAI: vi.fn() }));
vi.mock("./tcgScans", () => ({ submitScan: vi.fn(), readScan: vi.fn() }));
vi.mock("./logger", () => ({ logger: { error: vi.fn() } }));
import tcgRouter from "../routes/tcg";
import {
  mapListings,
  createTrade,
  tradeAction,
  tradeDetail,
  matches,
  validatePhotos,
  reviseTrade,
  resolveDispute,
  feedListings,
  setListingLike,
  listingComments,
  addListingComment,
} from "./tcgService";
const buyer = "11111111-1111-4111-8111-111111111111",
  seller = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333";
let listing: string, offered: string;
const httpApp = express();
httpApp.use(express.json(), tcgRouter);
async function addListing(
  owner: string,
  card: string,
  mode = "sale",
  quantity = 1,
  wanted: string[] = [],
) {
  const c = (
    await state.db.query(
      "INSERT INTO tcg_collection(owner_id,card_id,card_name,quantity,condition,photos,request_key) VALUES($1,$2,$2,$3,'NM','[\"/objects/photo\"]',$4) RETURNING id",
      [owner, card, quantity, crypto.randomUUID()],
    )
  ).rows[0].id;
  return (
    await state.db.query(
      "INSERT INTO tcg_listings(owner_id,collection_id,quantity,mode,price,wanted_card_ids,delivery,request_key) VALUES($1,$2,$3,$4,CASE WHEN $4='gift' THEN NULL ELSE 10000 END,$5,'meet',$6) RETURNING id",
      [owner, c, quantity, mode, JSON.stringify(wanted), crypto.randomUUID()],
    )
  ).rows[0].id;
}
const proposal = (kind = "buy", requestKey = crypto.randomUUID()) => ({
  listingId: listing,
  listingVersion: 1,
  kind,
  quantity: 1,
  offeredListingId: kind === "swap" ? offered : undefined,
  offeredVersion: 1,
  offeredQuantity: 1,
  cash: 0,
  note: "토요일 직거래",
  requestKey,
});
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(
    `CREATE TABLE users(id uuid PRIMARY KEY,nickname text);CREATE TABLE blocked_users(blocker_user_id uuid,blocked_user_id uuid);CREATE TABLE chat_rooms(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text,category text,visibility text,owner_id uuid,last_message_seq integer DEFAULT 0,last_message text,last_message_at timestamptz,updated_at timestamptz);CREATE TABLE chat_room_members(room_id uuid,user_id uuid);CREATE TABLE messages(id uuid DEFAULT gen_random_uuid(),room_id uuid,sender_id uuid,author_kind text,type text,content text,metadata jsonb,room_seq integer);CREATE TABLE chat_upload_owners(user_id uuid,object_path text,content_type text);`,
  );
  await state.db.exec(
    await readFile(
      new URL("../../../../lib/db/drizzle/0040_davaq_tcg.sql", import.meta.url),
      "utf8",
    ),
  );
  await state.db.exec(
    await readFile(
      new URL(
        "../../../../lib/db/drizzle/0041_davaq_tcg_map.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await state.db.exec(await readFile(new URL("../../../../lib/db/drizzle/0043_davaq_tcg_offer_feed.sql", import.meta.url), "utf8"));
  await state.db.exec(await readFile(new URL("../../../../lib/db/drizzle/0044_davaq_tcg_card_feed.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await state.db.exec(
    "TRUNCATE users,blocked_users,chat_rooms,chat_room_members,messages,chat_upload_owners,tcg_collection,tcg_wants,tcg_listings,tcg_trades,tcg_trade_actions,tcg_notifications,tcg_reports,tcg_price_alerts,tcg_card_requests,tcg_scans CASCADE",
  );
  await state.db.query(
    "INSERT INTO users VALUES($1,'구매자'),($2,'판매자'),($3,'다른 사람')",
    [buyer, seller, other],
  );
  listing = await addListing(seller, "kream:1", "both", 1, ["kream:2"]);
  offered = await addListing(buyer, "kream:2", "swap", 1, ["kream:1"]);
});
afterAll(async () => await state.db.close());
describe("TCG 거래 수량·권한·이행", () => {
  it("구매 확정 후 수령으로 수량 0과 완료를 기록한다", async () => {
    const t = await createTrade(buyer, proposal());
    await tradeAction(seller, t.id, "accept", 1);
    await tradeAction(seller, t.id, "sent", 1);
    expect((await tradeAction(buyer, t.id, "received", 1)).status).toBe(
      "completed",
    );
    expect(
      (
        await state.db.query(
          "SELECT quantity,reserved FROM tcg_collection WHERE owner_id=$1",
          [seller],
        )
      ).rows[0],
    ).toEqual({ quantity: 0, reserved: 0 });
  });
  it("같은 생성 키의 재전송은 거래와 방을 중복 생성하지 않는다", async () => {
    const p = proposal();
    expect((await createTrade(buyer, p)).id).toBe(
      (await createTrade(buyer, p)).id,
    );
    expect(
      (await state.db.query("SELECT count(*)::int n FROM chat_rooms")).rows[0]
        .n,
    ).toBe(1);
  });
  it("마지막 카드가 예약되면 다른 제안의 확정을 거부한다", async () => {
    const a = await createTrade(buyer, proposal()),
      b = await createTrade(other, proposal());
    await tradeAction(seller, a.id, "accept", 1);
    await expect(tradeAction(seller, b.id, "accept", 1)).rejects.toThrow(
      "수량",
    );
    expect(
      (await tradeDetail(other, b.id)).actions.filter(
        (x: any) => x.user_id === seller,
      ),
    ).toHaveLength(0);
  });
  it("교환은 양쪽 수령이 있어야 완료한다", async () => {
    const t = await createTrade(buyer, proposal("swap"));
    await tradeAction(seller, t.id, "accept", 1);
    await tradeAction(seller, t.id, "sent", 1);
    await tradeAction(buyer, t.id, "sent", 1);
    expect((await tradeAction(buyer, t.id, "received", 1)).status).toBe(
      "confirmed",
    );
    expect((await tradeAction(seller, t.id, "received", 1)).status).toBe(
      "completed",
    );
  });
  it("확정 거래의 취소는 두 사람의 동의 후 수량을 복원한다", async () => {
    const t = await createTrade(buyer, proposal());
    await tradeAction(seller, t.id, "accept", 1);
    expect((await tradeAction(buyer, t.id, "cancel", 1)).status).toBe(
      "confirmed",
    );
    expect((await tradeAction(seller, t.id, "cancel", 1)).status).toBe(
      "cancelled",
    );
    expect(
      (
        await state.db.query("SELECT quantity FROM tcg_listings WHERE id=$1", [
          listing,
        ])
      ).rows[0].quantity,
    ).toBe(1);
  });
  it("비참여자는 거래 열람과 동작을 할 수 없다", async () => {
    const t = await createTrade(buyer, proposal());
    await expect(tradeDetail(other, t.id)).rejects.toThrow("거래를 찾지");
    await expect(tradeAction(other, t.id, "accept", 1)).rejects.toThrow(
      "거래를 찾지",
    );
  });
  it("차단은 확정을 막는다", async () => {
    const t = await createTrade(buyer, proposal());
    await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", [
      buyer,
      seller,
    ]);
    await expect(tradeAction(seller, t.id, "accept", 1)).rejects.toThrow(
      "차단",
    );
  });
  it("매물 버전 변경은 확정을 막는다", async () => {
    const t = await createTrade(buyer, proposal());
    await state.db.query("UPDATE tcg_listings SET version=2 WHERE id=$1", [
      listing,
    ]);
    await expect(tradeAction(seller, t.id, "accept", 1)).rejects.toThrow(
      "매물이 변경",
    );
  });
  it("전달 전 수령과 전달 후 일반 취소를 막는다", async () => {
    const t = await createTrade(buyer, proposal());
    await tradeAction(seller, t.id, "accept", 1);
    await expect(tradeAction(buyer, t.id, "received", 1)).rejects.toThrow(
      "전달 기록",
    );
    await tradeAction(seller, t.id, "sent", 1);
    await expect(tradeAction(buyer, t.id, "cancel", 1)).rejects.toThrow("분쟁");
  });
  it("분쟁은 완료를 동결하고 운영 요청을 남긴다", async () => {
    const t = await createTrade(buyer, proposal());
    await tradeAction(seller, t.id, "accept", 1);
    expect((await tradeAction(buyer, t.id, "dispute", 1)).status).toBe(
      "disputed",
    );
    await expect(tradeAction(seller, t.id, "sent", 1)).rejects.toThrow(
      "확인이 필요한",
    );
  });
  it("희망 가격과 양방향 카드 조건으로 후보를 찾는다", async () => {
    await state.db.query(
      "INSERT INTO tcg_wants(owner_id,card_id,quantity,mode,max_price) VALUES($1,'kream:1',1,'buy',9000)",
      [buyer],
    );
    expect(await matches(buyer)).toHaveLength(0);
    await state.db.query(
      "UPDATE tcg_wants SET max_price=10000 WHERE owner_id=$1",
      [buyer],
    );
    expect(await matches(buyer)).toHaveLength(1);
    await state.db.query("UPDATE tcg_wants SET mode='swap' WHERE owner_id=$1", [
      buyer,
    ]);
    expect(await matches(buyer)).toHaveLength(1);
    await state.db.query(
      "UPDATE tcg_listings SET wanted_card_ids='[]' WHERE id=$1",
      [offered],
    );
    expect(await matches(buyer)).toHaveLength(0);
  });
  it("타인 업로드를 실물 사진으로 사용하지 못한다", async () => {
    await state.db.query(
      "INSERT INTO chat_upload_owners VALUES($1,'/objects/private','image/jpeg')",
      [seller],
    );
    const sql = {
      query: async (q: string, v?: any[]) => {
        const r = await state.db.query(q, v);
        return { rows: r.rows, rowCount: r.affectedRows };
      },
    };
    await expect(
      validatePhotos(sql, buyer, ["/objects/private"]),
    ).rejects.toThrow("내가 업로드");
  });
  it("조건 수정은 이전 동의를 무효화하고 상대의 재동의를 요구한다", async () => {
    const t = await createTrade(buyer, proposal());
    const revised = await reviseTrade(seller, t.id, {
      version: 1,
      quantity: 1,
      offeredQuantity: 1,
      cash: 9000,
      note: "변경 조건",
    });
    expect(revised.version).toBe(2);
    expect(revised.actions).toHaveLength(1);
    await expect(tradeAction(buyer, t.id, "accept", 1)).rejects.toThrow(
      "조건이 변경",
    );
    expect((await tradeAction(buyer, t.id, "accept", 2)).status).toBe(
      "confirmed",
    );
  });
  it("운영의 반환 확인 후 분쟁 취소는 예약 수량을 복원한다", async () => {
    const t = await createTrade(buyer, proposal());
    await tradeAction(seller, t.id, "accept", 1);
    await tradeAction(buyer, t.id, "dispute", 1);
    await resolveDispute(other, t.id, "cancel", "당사자와 전체 반환을 확인함");
    expect((await tradeDetail(buyer, t.id)).status).toBe("cancelled");
    expect(
      (
        await state.db.query(
          "SELECT reserved FROM tcg_collection WHERE owner_id=$1",
          [seller],
        )
      ).rows[0].reserved,
    ).toBe(0);
  });
  it("공개 매물은 비공개 전체 보유 수량을 노출하지 않는다", async () => {
    await state.db.query(
      "UPDATE tcg_collection SET quantity=10 WHERE owner_id=$1",
      [seller],
    );
    await state.db.query(
      "INSERT INTO tcg_wants(owner_id,card_id,quantity,mode) VALUES($1,'kream:1',1,'buy')",
      [buyer],
    );
    expect((await matches(buyer))[0].available).toBe(1);
  });
});

describe("published exchange location", () => {
  it("rejects precise, partial and shipping coordinates", async () => {
    const id = await addListing(seller, "pokemon:test", "swap");
    await expect(
      state.db.query(
        "UPDATE tcg_listings SET map_lat=37.57123,map_lng=126.98 WHERE id=$1",
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      state.db.query("UPDATE tcg_listings SET map_lat=37.57 WHERE id=$1", [id]),
    ).rejects.toThrow();
    await state.db.query(
      "UPDATE tcg_listings SET map_lat=37.57,map_lng=126.98 WHERE id=$1",
      [id],
    );
    await expect(
      state.db.query("UPDATE tcg_listings SET delivery='ship' WHERE id=$1", [
        id,
      ]),
    ).rejects.toThrow();
    await state.db.query(
      "UPDATE tcg_listings SET delivery='ship',map_lat=NULL,map_lng=NULL WHERE id=$1",
      [id],
    );
  });
});

it("map excludes unpublished, sold out, reserved and blocked cards",async()=>{
 const id=await addListing(seller,"pokemon:map-test","swap");
 const center={lat:37.57,lng:126.98,q:"map-test"};
 expect((await mapListings(buyer,center)).items).toHaveLength(0);
 await state.db.query("UPDATE tcg_listings SET map_lat=37.57,map_lng=126.98 WHERE id=$1",[id]);
 expect((await mapListings(buyer,center)).items.map((v:any)=>v.id)).toEqual([id]);
 await state.db.query("INSERT INTO blocked_users VALUES($1,$2)",[seller,buyer]);
 expect((await mapListings(buyer,center)).items).toHaveLength(0);
 await state.db.exec("TRUNCATE blocked_users");
 await state.db.query("UPDATE tcg_collection SET reserved=quantity WHERE id=(SELECT collection_id FROM tcg_listings WHERE id=$1)",[id]);
 expect((await mapListings(buyer,center)).items).toHaveLength(0);
 await state.db.query("UPDATE tcg_collection SET reserved=0 WHERE id=(SELECT collection_id FROM tcg_listings WHERE id=$1)",[id]);
 await state.db.query("UPDATE tcg_listings SET status='closed' WHERE id=$1",[id]);
 expect((await mapListings(buyer,center)).items).toHaveLength(0);
});

describe("swipe offer feed", () => {
  it("bounds social and inventory metadata work to the 21-row page before joining details", async () => {
    for (let i = 0; i < 45; i++) await addListing(seller, `bounded-${i}`, "swap");
    await feedListings(buyer, { q: "bounded-" });
    const statement = state.feedQuery!;
    const explained = (await state.db.query("EXPLAIN (ANALYZE, FORMAT JSON) " + statement.text, statement.values)).rows[0]["QUERY PLAN"][0].Plan;
    const nodes: any[] = [];
    const visit = (node: any) => { nodes.push(node); for (const child of node.Plans ?? []) visit(child); };
    visit(explained);
    expect(nodes.find((node) => node["Subplan Name"] === "CTE page")["Actual Rows"]).toBe(21);
    const metadataCounts = nodes.filter((node) => node["Node Type"] === "Aggregate");
    expect(metadataCounts.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...metadataCounts.map((node) => node["Actual Loops"]))).toBeLessThanOrEqual(21);
  });

  it.each(["accept", "cancel"] as const)("keeps an active-offer snapshot stable after %s while new offers arrive", async (action) => {
    const ids: string[] = [];
    for (let i = 0; i < 43; i++) ids.push(await addListing(seller, `feed-${i}`, "gift", i === 0 ? 2 : 1));
    await state.db.query("UPDATE tcg_listings SET created_at='2026-01-01T01:02:03.000123Z' WHERE id=ANY($1::uuid[])", [ids]);
    const history = await createTrade(buyer, { ...proposal("gift"), listingId: ids[0], offeredListingId: undefined });
    const first = await feedListings(buyer, { q: "feed-" });
    expect(first.items).toHaveLength(20);
    expect(first.items[0].id).toBe(ids[0]);
    expect(first.items[0].offer_count).toBe(1);
    expect(first.items[0].can_offer).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const newlyCreated = await addListing(seller, "feed-new", "gift");
    const notYetSeen = ids.find((id) => !first.items.some((item) => item.id === id))!;
    await createTrade(buyer, { ...proposal("gift"), listingId: notYetSeen, offeredListingId: undefined });
    await tradeAction(action === "accept" ? seller : buyer, history.id, action, 1);
    const seen = first.items.map((item) => item.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await feedListings(buyer, { q: "feed-", cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(43);
    expect(seen).toHaveLength(43);
    expect(seen).not.toContain(newlyCreated);
    expect((await feedListings(buyer, { q: "feed-" })).items.slice(0, 2).map((item) => item.id)).toContain(notYetSeen);
  });

  it("prioritizes only currently open offers on a fresh snapshot, excluding declined and expired history", async () => {
    const oldDeclined = await addListing(seller, "active-rank-declined", "gift");
    const oldExpired = await addListing(seller, "active-rank-expired", "gift");
    const active = await addListing(seller, "active-rank-open", "gift");
    const declinedTrade = await createTrade(buyer, { ...proposal("gift"), listingId: oldDeclined });
    await tradeAction(seller, declinedTrade.id, "decline", 1);
    const expiredTrade = await createTrade(buyer, { ...proposal("gift"), listingId: oldExpired });
    await state.db.query("UPDATE tcg_trades SET expires_at=now()-interval '1 second' WHERE id=$1", [expiredTrade.id]);
    await createTrade(buyer, { ...proposal("gift"), listingId: active });
    await state.db.query("UPDATE tcg_listings SET created_at='2026-01-01T00:00:00.000123Z' WHERE id=$1", [active]);
    const page = await feedListings(buyer, { q: "active-rank-" });
    expect(page.items[0]).toMatchObject({ id: active, offer_count: 1 });
    expect(page.items.slice(1).every((item) => item.offer_count === 0)).toBe(true);
  });

  it("binds snapshots to the viewer and filters, expires with 410 and cleans at most 50 stale rows", async () => {
    for (let i = 0; i < 21; i++) await addListing(seller, `snapshot-${i}`, "gift");
    const first = await feedListings(buyer, { q: "snapshot-" });
    const cursor = first.nextCursor!;
    const snapshotId = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).snapshotId;
    await expect(feedListings(other, { q: "snapshot-", cursor })).rejects.toMatchObject({ status: 410 });
    await expect(feedListings(buyer, { q: "different", cursor })).rejects.toMatchObject({ status: 410 });
    await expect(feedListings(buyer, { q: "snapshot-", cardId: "kream:1", cursor })).rejects.toMatchObject({ status: 410 });
    await state.db.query("UPDATE tcg_feed_snapshots SET expires_at=now()-interval '1 second' WHERE id=$1", [snapshotId]);
    await expect(feedListings(buyer, { q: "snapshot-", cursor })).rejects.toMatchObject({ status: 410 });
    await state.db.query("INSERT INTO tcg_feed_snapshots(owner_id,expires_at) SELECT $1,now()-interval '1 minute' FROM generate_series(1,59)", [buyer]);
    await feedListings(buyer, { q: "snapshot-" });
    expect((await state.db.query("SELECT count(*)::int AS n FROM tcg_feed_snapshots WHERE expires_at<=now()")).rows[0].n).toBe(10);
  });

  it("filters blocked, closed, sale-only and reserved inventory and reports only usable owned cards", async () => {
    const available = await addListing(seller, "feed-visible", "swap", 1, ["kream:2"]);
    const closed = await addListing(seller, "feed-closed", "swap");
    const reserved = await addListing(seller, "feed-reserved", "swap");
    await addListing(seller, "feed-sale", "sale");
    await state.db.query("UPDATE tcg_listings SET status='closed' WHERE id=$1", [closed]);
    await state.db.query("UPDATE tcg_collection SET reserved=quantity WHERE id=(SELECT collection_id FROM tcg_listings WHERE id=$1)", [reserved]);
    const page = await feedListings(buyer, { q: "feed-" });
    expect(page.items.map((item) => item.id)).toEqual([available]);
    expect(page.items[0].can_offer).toBe(true);
    await state.db.query("UPDATE tcg_collection SET reserved=quantity WHERE owner_id=$1", [buyer]);
    expect((await feedListings(buyer, { cardId: "feed-visible" })).items[0].can_offer).toBe(false);
    await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", [seller, buyer]);
    expect((await feedListings(buyer, { q: "feed-" })).items).toHaveLength(0);
  });

  it("rejects malformed pagination without running an unbounded query", async () => {
    await expect(feedListings(buyer, { cursor: "not-a-cursor" })).rejects.toThrow("새로고침");
    await expect(feedListings(buyer, { cursor: Buffer.from(JSON.stringify({ v: 1, bucket: 1, asOf: "tomorrow", createdAt: "tomorrow", id: listing })).toString("base64url") })).rejects.toThrow("새로고침");
  });
});

describe("listing likes and comments", () => {
  it("uses a desired boolean so repeating a like or unlike remains idempotent", async () => {
    expect(await setListingLike(buyer, listing, true)).toEqual({ liked_by_me: true, like_count: 1 });
    expect(await setListingLike(buyer, listing, true)).toEqual({ liked_by_me: true, like_count: 1 });
    await setListingLike(other, listing, true);
    const visible = (await feedListings(buyer, { cardId: "kream:1" })).items[0];
    expect(visible.liked_by_me).toBe(true);
    expect(visible.like_count).toBe(2);
    expect(await setListingLike(buyer, listing, false)).toEqual({ liked_by_me: false, like_count: 1 });
    expect(await setListingLike(buyer, listing, false)).toEqual({ liked_by_me: false, like_count: 1 });
  });

  it("deduplicates a retried comment and excludes blocked authors", async () => {
    const input = { body: "  실물 상태가 궁금해요  ", requestKey: crypto.randomUUID() };
    const first = await addListingComment(buyer, listing, input);
    expect((await addListingComment(buyer, listing, input)).item.id).toBe(first.item.id);
    expect(first.item.body).toBe("실물 상태가 궁금해요");
    expect(first.comment_count).toBe(1);
    await addListingComment(other, listing, { body: "내일 가능한가요?", requestKey: crypto.randomUUID() });
    await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", [buyer, other]);
    const visible = await listingComments(buyer, listing);
    expect(visible.items).toHaveLength(1);
    expect(visible.comment_count).toBe(1);
    expect(visible.items[0].owner_name).toBe("구매자");
    expect((await feedListings(buyer, { cardId: "kream:1" })).items[0].comment_count).toBe(visible.comment_count);
    await expect(addListingComment(buyer, offered, input)).rejects.toThrow("다른 댓글");
    await expect(addListingComment(buyer, listing, { body: " ", requestKey: crypto.randomUUID() })).rejects.toThrow("1~500");
    await expect(addListingComment(buyer, listing, { body: "가".repeat(501), requestKey: crypto.randomUUID() })).rejects.toThrow("1~500");
  });

  it("paginates 50 comments without losing equal-timestamp rows", async () => {
    for (let i = 0; i < 53; i++) await state.db.query(
      "INSERT INTO tcg_listing_comments(listing_id,owner_id,body,request_key,created_at) VALUES($1,$2,$3,$4,'2026-01-01T01:02:03.000123Z')",
      [listing, buyer, `댓글 ${i}`, crypto.randomUUID()],
    );
    const first = await listingComments(buyer, listing);
    expect(first.items).toHaveLength(50);
    const second = await listingComments(buyer, listing, first.nextCursor!);
    expect(second.items).toHaveLength(3);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(53);
    expect(second.nextCursor).toBeNull();
  });

  it("does not allow blocked users or comments on closed listings", async () => {
    await state.db.query("INSERT INTO blocked_users VALUES($1,$2)", [seller, buyer]);
    await expect(setListingLike(buyer, listing, true)).rejects.toThrow("매물을 찾지");
    await expect(addListingComment(buyer, listing, { body: "문의", requestKey: crypto.randomUUID() })).rejects.toThrow("매물을 찾지");
    await state.db.exec("TRUNCATE blocked_users");
    await state.db.query("UPDATE tcg_listings SET status='closed' WHERE id=$1", [listing]);
    await expect(addListingComment(seller, listing, { body: "닫힘", requestKey: crypto.randomUUID() })).rejects.toThrow("종료된");
  });
});

describe("giveaway proposals", () => {
  it("requires the donor to accept, reserves one card and completes after recipient receipt", async () => {
    listing = await addListing(seller, "gift-card", "gift");
    const t = await createTrade(buyer, proposal("gift"));
    await expect(tradeAction(buyer, t.id, "accept", 1)).rejects.toThrow("나눔 등록자");
    expect((await tradeAction(seller, t.id, "accept", 1)).status).toBe("confirmed");
    await expect(tradeAction(buyer, t.id, "sent", 1)).rejects.toThrow("수행할 수");
    await tradeAction(seller, t.id, "sent", 1);
    expect((await tradeAction(buyer, t.id, "received", 1)).status).toBe("completed");
    expect((await state.db.query("SELECT quantity,reserved FROM tcg_collection WHERE id=(SELECT collection_id FROM tcg_listings WHERE id=$1)", [listing])).rows[0]).toEqual({ quantity: 0, reserved: 0 });
  });

  it("rejects money, disguised swaps and a second claim on the same last card", async () => {
    const ordinary = listing;
    listing = await addListing(seller, "gift-last", "gift");
    await expect(createTrade(buyer, { ...proposal("gift"), cash: 1 })).rejects.toThrow("무료 나눔");
    await expect(createTrade(buyer, proposal("swap"))).rejects.toThrow("교환 가능한");
    await expect(createTrade(buyer, { ...proposal("gift"), listingId: ordinary })).rejects.toThrow("무료 나눔 카드");
    const a = await createTrade(buyer, proposal("gift"));
    const b = await createTrade(other, proposal("gift"));
    await tradeAction(seller, a.id, "accept", 1);
    await expect(tradeAction(seller, b.id, "accept", 1)).rejects.toThrow("수량");
  });
});

describe("authenticated offer feed HTTP contract", () => {
  it("keeps giveaways out of the legacy public listing API while exposing them in the new feed and owner's inventory", async () => {
    const gift = await addListing(seller, "kream:777", "gift");
    const publicListings = await request(httpApp).get("/tcg/listings").auth(buyer, { type: "bearer" });
    expect(publicListings.status).toBe(200);
    expect(publicListings.body.items.some((item: any) => item.id === gift)).toBe(false);
    const feed = await request(httpApp).get("/tcg/feed?cardId=kream:777").auth(buyer, { type: "bearer" });
    expect(feed.body.items.map((item: any) => item.id)).toEqual([gift]);
    const own = await request(httpApp).get("/tcg/listings?mine=true").auth(seller, { type: "bearer" });
    expect(own.body.items.some((item: any) => item.id === gift && item.mode === "gift")).toBe(true);
  });

  it("requires authentication and validates pagination, likes and comment bodies", async () => {
    expect((await request(httpApp).get("/tcg/feed")).status).toBe(401);
    expect((await request(httpApp).put(`/tcg/listings/${listing}/like`).send({ liked: true })).status).toBe(401);
    expect((await request(httpApp).get("/tcg/feed?cursor=bad").auth(buyer, { type: "bearer" })).status).toBe(400);
    expect((await request(httpApp).put(`/tcg/listings/${listing}/like`).auth(buyer, { type: "bearer" }).send({ liked: "true" })).status).toBe(400);
    expect((await request(httpApp).post(`/tcg/listings/${listing}/comments`).auth(buyer, { type: "bearer" }).send({ body: "가".repeat(501), requestKey: crypto.randomUUID() })).status).toBe(400);
    const liked = await request(httpApp).put(`/tcg/listings/${listing}/like`).auth(buyer, { type: "bearer" }).send({ liked: true });
    expect(liked.body).toEqual({ liked_by_me: true, like_count: 1 });
    const comment = await request(httpApp).post(`/tcg/listings/${listing}/comments`).auth(buyer, { type: "bearer" }).send({ body: "상태 문의", requestKey: crypto.randomUUID() });
    expect(comment.status).toBe(201);
    expect(comment.body.comment_count).toBe(1);
    expect(comment.body.item.owner_name).toBe("구매자");
    const feed = await request(httpApp).get("/tcg/feed?cardId=kream:1").auth(buyer, { type: "bearer" });
    expect(feed.status).toBe(200);
    expect(feed.body.items[0]).toMatchObject({ id: listing, like_count: 1, comment_count: 1, can_offer: true });
    expect(feed.body).toHaveProperty("nextCursor", null);
  });

  it("allows open swap registration without wanted cards and a zero-cost giveaway claim", async () => {
    const collectionId = (await state.db.query("SELECT collection_id FROM tcg_listings WHERE id=$1", [offered])).rows[0].collection_id;
    await state.db.query("UPDATE tcg_listings SET status='closed' WHERE id=$1", [offered]);
    const base = { collectionId, quantity: 1, requestKey: crypto.randomUUID() };
    const open = await request(httpApp).post("/tcg/listings").auth(buyer, { type: "bearer" }).send({ ...base, mode: "swap" });
    expect(open.status).toBe(201);
    expect(open.body.wanted_card_ids).toEqual([]);
    const invalid = await request(httpApp).post("/tcg/listings").auth(buyer, { type: "bearer" }).send({ ...base, mode: "gift", price: 100 });
    expect(invalid.status).toBe(400);

    listing = await addListing(seller, "kream:999", "gift");
    const claim = await request(httpApp).post("/tcg/trades").auth(buyer, { type: "bearer" }).send(proposal("gift"));
    expect(claim.status).toBe(201);
    expect(claim.body).toMatchObject({ kind: "gift", cash: 0, offered_listing_id: null, offered_quantity: 0 });
    const accept = await request(httpApp).post(`/tcg/trades/${claim.body.id}/actions`).auth(seller, { type: "bearer" }).send({ kind: "accept", version: 1 });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("confirmed");
  });
});
