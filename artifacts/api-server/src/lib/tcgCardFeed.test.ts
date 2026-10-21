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
const f = vi.hoisted(() => ({
  db: null as any,
  read: vi.fn(),
  transaction: false,
  gate: Promise.resolve(),
}));
vi.mock("@workspace/db", () => {
  async function acquire() {
    const previous = f.gate;
    let unlock!: () => void;
    f.gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    return unlock;
  }
  async function raw(text: string, values?: any[]) {
    if (text === "BEGIN") f.transaction = true;
    if (text === "COMMIT" || text === "ROLLBACK") f.transaction = false;
    if (text.includes("pg_advisory")) return { rows: [], rowCount: 1 };
    const r = await f.db.query(text, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? null };
  }
  return {
    pool: {
      query: async (text: string, values?: any[]) => {
        const release = await acquire();
        try {
          return await raw(text, values);
        } finally {
          release();
        }
      },
      connect: async () => {
        const release = await acquire();
        return { query: raw, release };
      },
    },
  };
});
vi.mock("./tcgCatalog", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  tcgRead: (...args: any[]) => f.read(...args),
}));
vi.mock("./auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.get("authorization")?.replace("Bearer ", "");
    if (
      ![
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ].includes(id)
    )
      return res.sendStatus(401);
    req.dbUser = { id };
    next();
  },
}));
vi.mock("./rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("./adminRbac", () => ({
  hasAdminAccess: async () => false,
  hasAdminRole: async () => false,
}));
vi.mock("./aiClient", () => ({ getOpenAI: vi.fn() }));
vi.mock("./tcgScans", () => ({ submitScan: vi.fn(), readScan: vi.fn() }));
vi.mock("./logger", () => ({ logger: { error: vi.fn() } }));
import router from "../routes/tcg";
import {
  cardFeed,
  cardOffers,
  setCardLike,
  cardComments,
  addCardComment,
  catalogPage,
  clearCardFeedUpstreamCache,
} from "./tcgCardFeed";
import { setListingLike, addListingComment } from "./tcgService";
const app = express();
app.use(express.json(), router);
const viewer = "11111111-1111-4111-8111-111111111111",
  seller = "22222222-2222-4222-8222-222222222222",
  blocked = "33333333-3333-4333-8333-333333333333";
const migration = async (n: string) =>
  readFile(new URL("../../../../lib/db/drizzle/" + n, import.meta.url), "utf8");
const row = (n: number) => ({
  id: "display:" + n,
  saveId: "kream:" + n,
  title: "Card " + n,
  imageSrc: "/cards/" + n + ".jpg",
  amount: 100,
  gameCode: n % 2 ? "pokemon" : "magic",
  saveAllowed: true,
});
let available: Record<string, any[]> = {};
async function listing(
  owner: string,
  card = "kream:1",
  mode = "swap",
  quantity = 1,
) {
  const owned = (
    await f.db.query(
      "INSERT INTO tcg_collection(owner_id,card_id,card_name,quantity,condition,photos,request_key) VALUES($1,$2,$2,$3,'NM','[\"/objects/real-photo\"]',$4) RETURNING id",
      [owner, card, quantity, crypto.randomUUID()],
    )
  ).rows[0].id;
  return (
    await f.db.query(
      "INSERT INTO tcg_listings(owner_id,collection_id,quantity,mode,price,delivery,request_key) VALUES($1,$2,$3,$4,CASE WHEN $4='gift' THEN NULL ELSE 1 END,'meet',$5) RETURNING id",
      [owner, owned, quantity, mode, crypto.randomUUID()],
    )
  ).rows[0].id;
}
beforeAll(async () => {
  f.db = new PGlite();
  await f.db.exec(
    "CREATE TABLE users(id uuid PRIMARY KEY,nickname text);CREATE TABLE blocked_users(blocker_user_id uuid,blocked_user_id uuid);CREATE TABLE chat_rooms(id uuid PRIMARY KEY);",
  );
  for (const n of [
    "0040_davaq_tcg.sql",
    "0041_davaq_tcg_map.sql",
    "0043_davaq_tcg_offer_feed.sql",
    "0044_davaq_tcg_card_feed.sql",
  ])
    await f.db.exec(await migration(n));
});
beforeEach(async () => {
  clearCardFeedUpstreamCache();
  f.transaction = false;
  await f.db.exec(
    "TRUNCATE users,blocked_users,tcg_card_catalog,tcg_collection CASCADE",
  );
  await f.db.query(
    "INSERT INTO users VALUES($1,'Viewer'),($2,'Seller'),($3,'Blocked')",
    [viewer, seller, blocked],
  );
  available = {
    KR: Array.from({ length: 50 }, (_, i) => row(1000 + i)),
    US: Array.from({ length: 50 }, (_, i) => row(1030 + i)),
    EU: [],
  };
  f.read.mockReset();
  f.read.mockImplementation(
    async (path: string, params: any, timeout: number) => {
      expect(f.transaction).toBe(false);
      expect(timeout).toBeLessThanOrEqual(12000);
      if (path.endsWith("/detail"))
        return {
          target: {
            id: params.id,
            name: "Detail " + params.id,
            imageSrc: "/detail.jpg",
            game: "pokemon",
            value: 123,
          },
        };
      expect(params.game).toBe("");
      const filtered = (available[params.market] ?? []).filter(
        (v) => !params.q || v.title.includes(params.q),
      );
      const start = (Number(params.page) - 1) * 25;
      return {
        items: filtered.slice(start, start + 25),
        pages: Math.ceil(filtered.length / 25),
        total: filtered.length,
      };
    },
  );
});
afterAll(async () => f.db.close());

describe("card-centric catalog feed", () => {
  it("shows real catalog cards without an owned card or public listing and canonicalizes saveId", async () => {
    const page = await cardFeed(viewer, {});
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeTruthy();
    for (const item of page.items) {
      expect(item.id).toMatch(/^kream:/);
      expect(item.card.id).toBe(item.card.saveId);
      expect(item.available_listing_count).toBe(0);
      expect(item.available_listings).toEqual([]);
      expect(item.owned_by_me).toBe(false);
      expect(item).not.toHaveProperty("owner_id");
    }
    expect(f.read.mock.calls.length).toBeLessThanOrEqual(2);
    expect(
      (await f.db.query("SELECT count(*)::int n FROM tcg_listings")).rows[0].n,
    ).toBe(0);
  });
  it("prioritizes grouped public offers even without any proposed trades", async () => {
    const ids = [];
    for (let n = 0; n < 4; n++)
      ids.push(await listing(seller, "kream:9", n === 0 ? "gift" : "swap"));
    await listing(seller, "kream:8");
    const result = await cardFeed(viewer, {});
    expect(
      result.items
        .slice(0, 2)
        .map((v) => v.id)
        .sort(),
    ).toEqual(["kream:8", "kream:9"]);
    const card = result.items.find((v) => v.id === "kream:9")!;
    expect(card.available_listing_count).toBe(4);
    expect(card.available_listings).toHaveLength(3);
    expect(
      (await cardOffers(viewer, "kream:9")).items.map((v) => v.id).sort(),
    ).toEqual(ids.sort());
  });
  it("deduplicates cards across markets and pages, preserving replay and all-market coverage", async () => {
    let page = await cardFeed(viewer, {}),
      seen = page.items.map((v) => v.id),
      cursor = page.nextCursor;
    for (let n = 0; cursor && n < 15; n++) {
      const first = await cardFeed(viewer, { cursor });
      const replay = await cardFeed(viewer, { cursor });
      expect(replay.items.map((v) => v.id)).toEqual(
        first.items.map((v) => v.id),
      );
      expect(replay.nextCursor).toBe(first.nextCursor);
      seen.push(...first.items.map((v) => v.id));
      cursor = first.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(80);
    expect(
      new Set(
        f.read.mock.calls
          .filter((v) => v[0].endsWith("/cards"))
          .map((v) => v[1].market),
      ),
    ).toEqual(new Set(["KR", "US", "EU"]));
  });
  it("freezes page IDs and uses a fresh user-scoped seed on refresh", async () => {
    const first = await cardFeed(viewer, {}),
      second = await cardFeed(viewer, {}),
      other = await cardFeed(seller, {});
    const states = (
      await f.db.query("SELECT seed,owner_id FROM tcg_card_feed_snapshots")
    ).rows;
    expect(new Set(states.map((v: any) => v.seed)).size).toBe(3);
    expect(first.items.map((v) => v.id)).not.toEqual(
      second.items.map((v) => v.id),
    );
    expect(first.items.map((v) => v.id)).not.toEqual(
      other.items.map((v) => v.id),
    );
    await expect(
      cardFeed(seller, { cursor: first.nextCursor! }),
    ).rejects.toThrow("만료");
  });
  it("keeps already visible cards when a catalog page fails and resumes that cursor", async () => {
    await listing(seller, "kream:7");
    f.read.mockRejectedValue(new Error("temporary upstream"));
    const first = await cardFeed(viewer, {});
    expect(first.items.map((v) => v.id)).toEqual(["kream:7"]);
    expect(first.catalogUnavailable).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    f.read.mockImplementation(async (_path: string, p: any) => ({
      items: Array.from({ length: 25 }, (_, i) => row(2000 + i)),
      pages: 1,
    }));
    const next = await cardFeed(viewer, { cursor: first.nextCursor! });
    expect(next.items).toHaveLength(20);
    expect(next.catalogUnavailable).toBeUndefined();
    expect(next.items.map((v) => v.id)).not.toContain("kream:7");
  });
  it("does not cache a failed empty page forever", async () => {
    f.read.mockRejectedValue(new Error("offline"));
    const empty = await cardFeed(viewer, {});
    expect(empty.items).toEqual([]);
    expect(empty.catalogUnavailable).toBe(true);
    f.read.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, i) => row(3000 + i)),
      pages: 1,
    });
    const recovered = await cardFeed(viewer, { cursor: empty.nextCursor! });
    expect(recovered.items).toHaveLength(20);
  });
  it("does not expose blocked offers or private collection rows as public offers", async () => {
    await listing(blocked, "kream:3");
    await f.db.query("INSERT INTO blocked_users VALUES($1,$2)", [
      viewer,
      blocked,
    ]);
    await f.db.query(
      "INSERT INTO tcg_collection(owner_id,card_id,card_name,quantity,condition,request_key) VALUES($1,'kream:1001','Private',1,'NM','private-key')",
      [viewer],
    );
    const result = await cardFeed(viewer, {});
    expect(result.items.some((v) => v.id === "kream:3")).toBe(false);
    const filtered = await cardFeed(viewer, { cardId: "kream:1001" });
    expect(filtered.items[0].owned_by_me).toBe(true);
    expect(filtered.items[0].available_listings).toEqual([]);
  });
  it("scopes search/card filters and rejects expired or malformed cursors", async () => {
    const result = await cardFeed(viewer, { q: "Card 100" });
    expect(result.items.every((v) => v.card.title.includes("Card 100"))).toBe(
      true,
    );
    const exact = await cardFeed(viewer, { cardId: "kream:444" });
    expect(exact.items.map((v) => v.id)).toEqual(["kream:444"]);
    expect(exact.nextCursor).toBeNull();
    await expect(cardFeed(viewer, { cursor: "bad" })).rejects.toThrow(
      "새로고침",
    );
    const full = await cardFeed(viewer, {});
    await expect(
      cardFeed(viewer, { cursor: full.nextCursor!, q: "other" }),
    ).rejects.toThrow("만료");
    await f.db.query(
      "UPDATE tcg_card_feed_snapshots SET expires_at=now()-interval '1 second'",
    );
    await expect(
      cardFeed(viewer, { cursor: full.nextCursor! }),
    ).rejects.toThrow("만료");
  });
  it("serializes concurrent continuation into one immutable page without network inside a transaction", async () => {
    const start = await cardFeed(viewer, {});
    const [a, b] = await Promise.all([
      cardFeed(viewer, { cursor: start.nextCursor! }),
      cardFeed(viewer, { cursor: start.nextCursor! }),
    ]);
    expect(a.items.map((v) => v.id)).toEqual(b.items.map((v) => v.id));
    expect(a.nextCursor).toBe(b.nextCursor);
    expect(new Set([...start.items, ...a.items].map((v) => v.id)).size).toBe(
      start.items.length + a.items.length,
    );
  });
  it("visits every catalog page exactly once including pages beyond 10000", () => {
    for (const pages of [1, 2, 7, 1466, 10270]) {
      const values = Array.from({ length: pages }, (_, n) =>
        catalogPage("seed", "US", pages, n),
      );
      expect(new Set(values).size).toBe(pages);
      expect(Math.min(...values)).toBe(1);
      expect(Math.max(...values)).toBe(pages);
    }
    expect(catalogPage("seed-a", "US", 10270, 1)).not.toBe(
      catalogPage("seed-b", "US", 10270, 1),
    );
  });
  it("advances a healthy empty catalog without falsely reporting failure", async () => {
    f.read.mockResolvedValue({ items: [], pages: 0 });
    const first = await cardFeed(viewer, {});
    expect(first.items).toEqual([]);
    expect(first.catalogUnavailable).toBeUndefined();
    expect(first.nextCursor).toBeTruthy();
    const next = await cardFeed(viewer, { cursor: first.nextCursor! });
    expect(next.nextCursor).toBeNull();
    expect(next.catalogUnavailable).toBeUndefined();
  });
  it("does not stop healthy full pages because another market failed", async () => {
    let call = 0;
    f.read.mockImplementation(async () => {
      if (++call === 1) throw Error("one market unavailable");
      return {
        items: Array.from({ length: 25 }, (_, i) => row(5000 + i)),
        pages: 1,
      };
    });
    const first = await cardFeed(viewer, {});
    expect(first.items).toHaveLength(20);
    expect(first.catalogUnavailable).toBeUndefined();
  });
});

describe("card social and authoritative offer APIs", () => {
  it("backfills existing likes and comments without deleting legacy data", async () => {
    const a = await listing(seller, "kream:11"),
      b = await listing(seller, "kream:11");
    await f.db.query(
      "INSERT INTO tcg_listing_likes(listing_id,owner_id,created_at) VALUES($1,$3,'2026-01-01'),($2,$3,'2026-02-01')",
      [a, b, viewer],
    );
    const original = (
      await f.db.query(
        "INSERT INTO tcg_listing_comments(listing_id,owner_id,body,request_key,created_at) VALUES($1,$2,'Original body','original-key','2026-01-02') RETURNING *",
        [a, viewer],
      )
    ).rows[0];
    await f.db.exec(
      "DROP TABLE tcg_card_feed_pages,tcg_card_feed_items,tcg_card_feed_snapshots,tcg_card_likes,tcg_card_comments,tcg_card_catalog CASCADE",
    );
    await f.db.exec(await migration("0044_davaq_tcg_card_feed.sql"));
    const copied = (
      await f.db.query("SELECT * FROM tcg_card_comments WHERE id=$1", [
        original.id,
      ])
    ).rows[0];
    expect(copied).toMatchObject({
      id: original.id,
      owner_id: viewer,
      body: original.body,
      created_at: original.created_at,
      request_key: original.request_key,
      card_id: "kream:11",
    });
    expect(
      (await f.db.query("SELECT count(*)::int n FROM tcg_card_likes")).rows[0]
        .n,
    ).toBe(1);
    expect(
      (await f.db.query("SELECT count(*)::int n FROM tcg_listing_likes"))
        .rows[0].n,
    ).toBe(2);
    expect(
      (await f.db.query("SELECT id FROM tcg_listing_comments")).rows[0].id,
    ).toBe(original.id);
  });
  it("keeps likes idempotent and comments deduplicated with blocked-author filtering", async () => {
    await cardFeed(viewer, { cardId: "kream:42" });
    expect(await setCardLike(viewer, "kream:42", true)).toEqual({
      liked_by_me: true,
      like_count: 1,
    });
    expect((await setCardLike(viewer, "kream:42", true)).like_count).toBe(1);
    expect((await setCardLike(viewer, "kream:42", false)).like_count).toBe(0);
    const input = { body: "Hello", requestKey: crypto.randomUUID() };
    const first = await addCardComment(seller, "kream:42", input),
      again = await addCardComment(seller, "kream:42", input);
    expect(first.item.id).toBe(again.item.id);
    expect(again.comment_count).toBe(1);
    await f.db.query("INSERT INTO blocked_users VALUES($1,$2)", [
      viewer,
      seller,
    ]);
    expect((await cardComments(viewer, "kream:42")).items).toEqual([]);
    await expect(
      addCardComment(viewer, "kream:42", {
        body: "x".repeat(501),
        requestKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow("500");
    await addCardComment(viewer, "kream:42", input);
    await expect(addCardComment(viewer, "kream:43", input)).rejects.toThrow(
      "다른 댓글",
    );
  });
  it("mirrors old listing writes without losing explicit card likes or original comment identities", async () => {
    const a = await listing(seller, "kream:9"),
      b = await listing(seller, "kream:9");
    await setListingLike(viewer, a, true);
    await setListingLike(viewer, b, true);
    expect(
      (await cardFeed(viewer, { cardId: "kream:9" })).items[0].like_count,
    ).toBe(1);
    await setListingLike(viewer, a, false);
    expect(
      (await cardFeed(viewer, { cardId: "kream:9" })).items[0].like_count,
    ).toBe(1);
    await setCardLike(viewer, "kream:9", true);
    await setListingLike(viewer, b, false);
    expect(
      (await cardFeed(viewer, { cardId: "kream:9" })).items[0].liked_by_me,
    ).toBe(true);
    await setListingLike(viewer, a, true);
    await setCardLike(viewer, "kream:9", false);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM tcg_listing_likes WHERE owner_id=$1",
          [viewer],
        )
      ).rows[0].n,
    ).toBe(0);
    const old = await addListingComment(viewer, a, {
      body: "Legacy comment",
      requestKey: crypto.randomUUID(),
    });
    expect((await cardComments(viewer, "kream:9")).items[0].id).toBe(
      old.item.id,
    );
  });
  it("reconciles rollback-window legacy writes idempotently while preserving direct card likes", async () => {
    const a = await listing(seller, "kream:90"),
      b = await listing(seller, "kream:91");
    await setListingLike(viewer, a, true);
    await setListingLike(viewer, b, true);
    await setCardLike(viewer, "kream:91", true);
    await f.db.query("DELETE FROM tcg_listing_likes WHERE owner_id=$1", [
      viewer,
    ]);
    const original = (
      await f.db.query(
        "INSERT INTO tcg_listing_comments(listing_id,owner_id,body,request_key) VALUES($1,$2,'Rollback-window body','rollback-comment') RETURNING *",
        [a, viewer],
      )
    ).rows[0];
    const sql = await readFile(
      new URL("./tcgCardSocialSync.sql", import.meta.url),
      "utf8",
    );
    await f.db.exec(sql);
    await f.db.exec(sql);
    expect(
      (
        await f.db.query(
          "SELECT card_id,source FROM tcg_card_likes WHERE owner_id=$1",
          [viewer],
        )
      ).rows,
    ).toEqual([{ card_id: "kream:91", source: "card" }]);
    const copied = (
      await f.db.query("SELECT id,body FROM tcg_card_comments WHERE id=$1", [
        original.id,
      ])
    ).rows[0];
    expect(copied).toEqual({ id: original.id, body: original.body });
  });
  it("copies legacy comment timestamps inside PostgreSQL without losing microseconds", async () => {
    const id = await listing(seller, "kream:91"),
      requestKey = "precise-legacy-comment";
    const original = (
      await f.db.query(
        "INSERT INTO tcg_listing_comments(listing_id,owner_id,body,request_key,created_at) VALUES($1,$2,'Precise original',$3,'2026-10-15T01:02:03.123456Z') RETURNING id",
        [id, viewer, requestKey],
      )
    ).rows[0];
    await addListingComment(viewer, id, {
      body: "Precise original",
      requestKey,
    });
    const result = (
      await f.db.query(
        "SELECT old.created_at=new.created_at AS exact,to_char(new.created_at,'US') AS micros FROM tcg_listing_comments old JOIN tcg_card_comments new ON new.id=old.id WHERE old.id=$1",
        [original.id],
      )
    ).rows[0];
    expect(result).toEqual({ exact: true, micros: "123456" });
  });
  it("paginates only available real offers and binds the cursor to viewer/card", async () => {
    for (let i = 0; i < 23; i++)
      await listing(seller, "kream:9", i % 2 ? "swap" : "gift");
    await listing(blocked, "kream:9");
    await f.db.query("INSERT INTO blocked_users VALUES($1,$2)", [
      viewer,
      blocked,
    ]);
    const first = await cardOffers(viewer, "kream:9"),
      second = await cardOffers(viewer, "kream:9", first.nextCursor!);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((v) => v.id)).size,
    ).toBe(23);
    await expect(
      cardOffers(seller, "kream:9", first.nextCursor!),
    ).rejects.toThrow("다시");
  });
  it("enforces HTTP authentication, card path encoding, and input validation", async () => {
    expect((await request(app).get("/tcg/card-feed")).status).toBe(401);
    const feed = await request(app)
      .get("/tcg/card-feed")
      .set("Authorization", "Bearer " + viewer);
    expect(feed.status).toBe(200);
    expect(feed.body.items).toHaveLength(20);
    const like = await request(app)
      .put("/tcg/cards/kream%3A42/like")
      .set("Authorization", "Bearer " + viewer)
      .send({ liked: true });
    expect(like.status).toBe(200);
    expect(like.body.like_count).toBe(1);
    expect(
      (
        await request(app)
          .post("/tcg/cards/kream%3A42/comments")
          .set("Authorization", "Bearer " + viewer)
          .send({ body: "", requestKey: crypto.randomUUID() })
      ).status,
    ).toBe(400);
  });
});
