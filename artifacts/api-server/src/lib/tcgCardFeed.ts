import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { demand, tcgRead, cardId as tradingCardId } from "./tcgCatalog";
import { listingSelect, transaction, type Sql } from "./tcgService";

type Card = {
  id: string;
  saveId: string;
  saveAllowed: boolean;
  title: string;
  imageSrc?: string | null;
  amount: number | null;
  gameCode: string;
  [key: string]: unknown;
};
type Stream = {
  market: string;
  pages: number | null;
  visited: number;
  done: boolean;
};
type CatalogState = { streams: Stream[]; turn: number; done: boolean };
type Snapshot = {
  id: string;
  owner_id: string;
  q: string;
  card_id: string | null;
  seed: string;
  offer_card_ids: string[];
  offer_offset: number;
  catalog_state: CatalogState;
  next_position: number;
  version: number;
};
const PAGE = 20;
const visible = `l.status='active' AND l.mode IN('swap','both','gift') AND l.quantity>0 AND c.quantity-c.reserved>0
 AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocker_user_id=l.owner_id AND b.blocked_user_id=$1))`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/;
const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function decoded(value: string): any {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    demand(false, 400, "피드를 새로고침해 주세요.");
  }
}
function readCursor(cursor?: string) {
  if (!cursor) return null;
  const value = decoded(cursor);
  demand(
    value?.v === 1 &&
      uuid.test(value.snapshotId) &&
      Number.isSafeInteger(value.offset) &&
      value.offset >= 0,
    400,
    "피드를 새로고침해 주세요.",
  );
  return value as { v: 1; snapshotId: string; offset: number };
}
function ordered<T>(values: T[], seed: string, key: (value: T) => string) {
  return [...values].sort((a, b) =>
    hash(seed + key(a)).localeCompare(hash(seed + key(b))),
  );
}
const cardKey = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 200 &&
  !/[\x00-\x1f\x7f]/.test(value);
function normalCard(value: any): Card | null {
  const id = cardKey(value?.saveId)
    ? value.saveId
    : cardKey(value?.id)
      ? value.id
      : null;
  if (!id || typeof value.title !== "string") return null;
  const allowed =
    tradingCardId.safeParse(id).success && value.saveAllowed !== false;
  return {
    id,
    saveId: id,
    saveAllowed: allowed,
    title: value.title.slice(0, 160),
    imageSrc:
      typeof value.imageSrc === "string" && value.imageSrc.length <= 4096
        ? value.imageSrc
        : null,
    amount:
      typeof value.amount === "number" && Number.isFinite(value.amount)
        ? value.amount
        : null,
    gameCode:
      typeof value.gameCode === "string" ? value.gameCode.slice(0, 40) : "",
    ...(typeof value.priceLabel === "string"
      ? { priceLabel: value.priceLabel.slice(0, 160) }
      : {}),
    ...(Array.isArray(value.badges)
      ? {
          badges: value.badges
            .filter((v: unknown) => typeof v === "string")
            .slice(0, 8),
        }
      : {}),
  };
}
function detailCard(data: any, id: string): Card {
  demand(data?.target?.id === id, 503, "카드 식별 정보를 확인하지 못했습니다.");
  const t = data.target;
  const card = normalCard({
    id,
    saveId: id,
    title: t.name,
    imageSrc: t.imageSrc,
    amount: t.value,
    gameCode: t.game,
    saveAllowed: true,
  });
  demand(card, 503, "카드 정보를 확인하지 못했습니다.");
  return card;
}
// Page 1 is useful first-card data, not a discarded metadata-only request.
// Subsequent pages traverse 2..N with a seeded affine bijection.
export function catalogPage(
  seed: string,
  market: string,
  pages: number,
  visited: number,
) {
  if (visited === 0) return 1;
  const n = pages - 1;
  if (n <= 1) return 2;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let step = parseInt(hash(seed + market + ":step").slice(0, 8), 16) % n || 1;
  while (gcd(step, n) !== 1) step = (step % n) + 1;
  const start = parseInt(hash(seed + market + ":start").slice(0, 8), 16) % n;
  return 2 + ((start + step * (visited - 1)) % n);
}
// Only public upstream data is shared. Concurrent requests for one source page
// share a promise; a small TTL/FIFO cache bounds memory independently of session size.
const upstreamPages = new Map<
  string,
  { expires: number; promise: Promise<any> }
>();
async function readCatalog(
  path: string,
  params: Record<string, string>,
  timeout: number,
) {
  const key = path + JSON.stringify(params),
    existing = upstreamPages.get(key);
  let promise =
    existing && existing.expires > Date.now() ? existing.promise : undefined;
  if (!promise) {
    if (upstreamPages.size >= 64)
      upstreamPages.delete(upstreamPages.keys().next().value!);
    promise = tcgRead(path, params, timeout).catch((error) => {
      upstreamPages.delete(key);
      throw error;
    });
    upstreamPages.set(key, { expires: Date.now() + 60_000, promise });
  }
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("catalog-timeout")),
      timeout,
    );
    promise!.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
export function clearCardFeedUpstreamCache() {
  upstreamPages.clear();
}
async function createSnapshot(user: string, q: string, cardId?: string) {
  await pool.query(
    `DELETE FROM tcg_card_feed_snapshots WHERE id IN(SELECT id FROM tcg_card_feed_snapshots WHERE expires_at<=now() ORDER BY expires_at,id LIMIT 20)`,
  );
  const seed = hash(user + randomBytes(24).toString("hex"));
  const ids = (
    await pool.query(
      `SELECT c.card_id FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id WHERE ${visible}
 AND ($2='' OR c.card_name ILIKE '%'||$2||'%') AND ($3::text IS NULL OR c.card_id=$3) GROUP BY c.card_id ORDER BY md5(c.card_id||$4),c.card_id`,
      [user, q, cardId ?? null, seed],
    )
  ).rows.map((row) => row.card_id);
  const state: CatalogState = {
    streams: ordered(["KR", "US", "EU"], seed, (x) => x).map((market) => ({
      market,
      pages: null,
      visited: 0,
      done: false,
    })),
    turn: 0,
    done: false,
  };
  return (
    await pool.query(
      `INSERT INTO tcg_card_feed_snapshots(owner_id,q,card_id,seed,offer_card_ids,catalog_state) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [user, q, cardId ?? null, seed, ids, JSON.stringify(state)],
    )
  ).rows[0] as Snapshot;
}
async function snapshot(user: string, id: string, q: string, cardId?: string) {
  const row = (
    await pool.query(
      "SELECT * FROM tcg_card_feed_snapshots WHERE id=$1 AND owner_id=$2 AND q=$3 AND card_id IS NOT DISTINCT FROM $4::text AND expires_at>now()",
      [id, user, q, cardId ?? null],
    )
  ).rows[0];
  demand(row, 410, "피드가 만료됐습니다. 새 카드를 불러와 주세요.");
  return row as Snapshot;
}
async function marketCards(ids: string[]) {
  const rows = (
    await pool.query(
      `SELECT x.card_id,COALESCE(r.card,jsonb_build_object('id',x.card_id,'saveId',x.card_id,'saveAllowed',true,'title',COALESCE(c.card_name,x.card_id),'imageSrc',null,'amount',null,'gameCode','')) AS card
 FROM unnest($1::text[]) WITH ORDINALITY x(card_id,n) LEFT JOIN tcg_card_catalog r ON r.card_id=x.card_id
 LEFT JOIN LATERAL(SELECT card_name FROM tcg_collection WHERE card_id=x.card_id ORDER BY updated_at DESC,id DESC LIMIT 1)c ON true ORDER BY x.n`,
      [ids],
    )
  ).rows;
  return rows.map((row) => row.card as Card);
}
// All upstream requests finish BEFORE this short version-CAS transaction starts.
async function append(
  snapshot: Snapshot,
  cards: Card[],
  offerOffset: number,
  state: CatalogState,
) {
  return transaction(async (sql) => {
    const current = (
      await sql.query(
        "SELECT version,next_position FROM tcg_card_feed_snapshots WHERE id=$1 AND expires_at>now() FOR UPDATE",
        [snapshot.id],
      )
    ).rows[0];
    demand(current, 410, "피드가 만료됐습니다. 새 카드를 불러와 주세요.");
    if (current.version !== snapshot.version) return false;
    const unique = [...new Map(cards.map((card) => [card.id, card])).values()];
    const seen = new Set(
      (
        await sql.query(
          "SELECT card_id FROM tcg_card_feed_items WHERE snapshot_id=$1 AND card_id=ANY($2::text[])",
          [snapshot.id, unique.map((card) => card.id)],
        )
      ).rows.map((row) => row.card_id),
    );
    const fresh = unique.filter((card) => !seen.has(card.id));
    if (fresh.length) {
      await sql.query(
        `INSERT INTO tcg_card_catalog(card_id,card) SELECT x.id,x.card FROM jsonb_to_recordset($1::jsonb) AS x(id text,card jsonb) ORDER BY x.id
    ON CONFLICT(card_id) DO UPDATE SET card=EXCLUDED.card,updated_at=now()`,
        [JSON.stringify(fresh.map((card) => ({ id: card.id, card })))],
      );
      await sql.query(
        `INSERT INTO tcg_card_feed_items(snapshot_id,position,card_id,card) SELECT $1,$2+x.n::int-1,x.card->>'id',x.card
    FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY x(card,n)`,
        [snapshot.id, current.next_position, JSON.stringify(fresh)],
      );
    }
    await sql.query(
      "UPDATE tcg_card_feed_snapshots SET offer_offset=$2,catalog_state=$3,next_position=next_position+$4,version=version+1 WHERE id=$1",
      [snapshot.id, offerOffset, JSON.stringify(state), fresh.length],
    );
    return true;
  });
}
function done(s: Snapshot) {
  return s.offer_offset >= s.offer_card_ids.length && s.catalog_state.done;
}
async function fill(
  user: string,
  initial: Snapshot,
  offset: number,
  q: string,
  cardId?: string,
) {
  let current = initial,
    calls = 0,
    unavailable = false;
  const deadline = Date.now() + 23_000;
  for (
    let tries = 0;
    tries < 8 && current.next_position < offset + PAGE + 1 && !done(current);
    tries++
  ) {
    if (current.offer_offset < current.offer_card_ids.length) {
      const ids = current.offer_card_ids.slice(
        current.offer_offset,
        current.offer_offset + offset + PAGE + 1 - current.next_position,
      );
      await append(
        current,
        await marketCards(ids),
        current.offer_offset + ids.length,
        current.catalog_state,
      );
    } else {
      if (calls >= 2 || deadline - Date.now() < 1000) break;
      calls++;
      const state = structuredClone(current.catalog_state);
      let selectedIndex = state.turn % state.streams.length,
        appending = false;
      try {
        if (cardId) {
          const known = (
            await pool.query(
              "SELECT card FROM tcg_card_catalog WHERE card_id=$1",
              [cardId],
            )
          ).rows[0];
          const cards = known
            ? [known.card]
            : [
                detailCard(
                  await readCatalog(
                    "/api/mobile/v1/cards/detail",
                    { id: cardId },
                    Math.min(12000, deadline - Date.now()),
                  ),
                  cardId,
                ),
              ];
          state.done = true;
          appending = true;
          await append(current, cards, current.offer_offset, state);
        } else {
          let index = state.turn % state.streams.length;
          for (
            let n = 0;
            n < state.streams.length && state.streams[index].done;
            n++
          )
            index = (index + 1) % state.streams.length;
          selectedIndex = index;
          const stream = state.streams[index];
          if (stream.done) {
            state.done = true;
            appending = true;
            await append(current, [], current.offer_offset, state);
          } else {
            const page =
              stream.pages === null
                ? 1
                : catalogPage(
                    current.seed,
                    stream.market,
                    stream.pages,
                    stream.visited,
                  );
            const data = await readCatalog(
              "/api/mobile/v1/cards",
              { q, market: stream.market, game: "", page: String(page) },
              Math.min(12000, deadline - Date.now()),
            );
            demand(
              Array.isArray(data?.items) &&
                Number.isSafeInteger(data.pages) &&
                data.pages >= 0 &&
                data.pages <= 1_000_000,
              503,
              "카탈로그 응답을 확인하지 못했습니다.",
            );
            // Fix each market's page count for this browsing session. Newly indexed
            // cards become visible on refresh rather than reshuffling existing pages.
            if (stream.pages === null) stream.pages = data.pages;
            stream.visited++;
            stream.done = stream.pages === 0 || stream.visited >= stream.pages!;
            state.turn = (index + 1) % state.streams.length;
            state.done = state.streams.every((s) => s.done);
            const cards = ordered(
              data.items.map(normalCard).filter(Boolean) as Card[],
              current.seed,
              (x) => x.id,
            );
            appending = true;
            await append(current, cards, current.offer_offset, state);
          }
        }
      } catch (error: any) {
        if (error.status === 410 || appending) throw error;
        unavailable = true;
        // Rotate a failed market so a healthy market may still supply cards. Its
        // visited count never advances until that exact source page succeeds.
        state.turn = (selectedIndex + 1) % state.streams.length;
        await append(current, [], current.offer_offset, state);
      }
    }
    current = await snapshot(user, current.id, q, cardId);
  }
  return { current, unavailable };
}
async function enrich(user: string, rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.card_id);
  const counts = (
    await pool.query(
      `SELECT c.card_id,count(*)::int AS n FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id WHERE ${visible} AND c.card_id=ANY($2::text[]) GROUP BY c.card_id`,
      [user, ids],
    )
  ).rows;
  const listings = (
    await pool.query(
      `WITH ranked AS(SELECT l.id,row_number() OVER(PARTITION BY c.card_id ORDER BY l.created_at DESC,l.id DESC) AS n FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id WHERE ${visible} AND c.card_id=ANY($2::text[])), page AS MATERIALIZED(SELECT id FROM ranked WHERE n<=3)
 ${listingSelect} JOIN page ON page.id=l.id ORDER BY l.created_at DESC,l.id DESC`,
      [user, ids],
    )
  ).rows;
  const social = (
    await pool.query(
      `SELECT x.card_id,
 (SELECT count(*)::int FROM tcg_card_likes a WHERE a.card_id=x.card_id) AS like_count,
 (SELECT count(*)::int FROM tcg_card_comments a WHERE a.card_id=x.card_id AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=a.owner_id) OR (b.blocker_user_id=a.owner_id AND b.blocked_user_id=$1))) AS comment_count,
 EXISTS(SELECT 1 FROM tcg_card_likes a WHERE a.card_id=x.card_id AND a.owner_id=$1) AS liked_by_me,
 EXISTS(SELECT 1 FROM tcg_collection c WHERE c.card_id=x.card_id AND c.owner_id=$1 AND c.quantity>0) AS owned_by_me
 FROM unnest($2::text[]) x(card_id)`,
      [user, ids],
    )
  ).rows;
  return rows.map((row) => {
    const stats = social.find((v) => v.card_id === row.card_id);
    return {
      id: row.card_id,
      card: row.card,
      available_listing_count:
        counts.find((v) => v.card_id === row.card_id)?.n ?? 0,
      available_listings: listings.filter((v) => v.card_id === row.card_id),
      like_count: stats.like_count,
      comment_count: stats.comment_count,
      liked_by_me: stats.liked_by_me,
      owned_by_me: stats.owned_by_me,
    };
  });
}
export async function cardFeed(
  user: string,
  input: { cursor?: string; q?: string; cardId?: string },
) {
  const q = (input.q ?? "").trim(),
    cursor = readCursor(input.cursor),
    offset = cursor?.offset ?? 0;
  let current = cursor
    ? await snapshot(user, cursor.snapshotId, q, input.cardId)
    : await createSnapshot(user, q, input.cardId);
  demand(offset <= current.next_position, 400, "피드를 새로고침해 주세요.");
  let cached = (
    await pool.query(
      "SELECT * FROM tcg_card_feed_pages WHERE snapshot_id=$1 AND page_offset=$2",
      [current.id, offset],
    )
  ).rows[0];
  let unavailable = false;
  if (!cached) {
    ({ current, unavailable } = await fill(
      user,
      current,
      offset,
      q,
      input.cardId,
    ));
    const count = Math.min(PAGE, current.next_position - offset),
      finished = done(current) && offset + count >= current.next_position;
    unavailable = unavailable && count < PAGE && !finished;
    if (count || finished) {
      cached = await transaction(async (sql) => {
        const live = (
          await sql.query(
            "SELECT id FROM tcg_card_feed_snapshots WHERE id=$1 AND expires_at>now() FOR UPDATE",
            [current.id],
          )
        ).rows[0];
        demand(live, 410, "피드가 만료됐습니다. 새 카드를 불러와 주세요.");
        await sql.query(
          "INSERT INTO tcg_card_feed_pages(snapshot_id,page_offset,item_count,finished,catalog_unavailable) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [current.id, offset, count, finished, unavailable],
        );
        return (
          await sql.query(
            "SELECT * FROM tcg_card_feed_pages WHERE snapshot_id=$1 AND page_offset=$2",
            [current.id, offset],
          )
        ).rows[0];
      });
    } else
      cached = {
        item_count: 0,
        finished: false,
        catalog_unavailable: unavailable,
      };
  }
  const rows = (
    await pool.query(
      "SELECT card_id,card FROM tcg_card_feed_items WHERE snapshot_id=$1 AND position>=$2 AND position<$3 ORDER BY position",
      [current.id, offset, offset + cached.item_count],
    )
  ).rows;
  return {
    items: await enrich(user, rows),
    nextCursor: cached.finished
      ? null
      : encoded({
          v: 1,
          snapshotId: current.id,
          offset: offset + cached.item_count,
          ...(!cached.item_count ? { progress: current.version } : {}),
        }),
    ...(cached.catalog_unavailable ? { catalogUnavailable: true } : {}),
  };
}
async function ensureCard(id: string) {
  demand(cardKey(id), 400, "카드 식별 정보를 확인해 주세요.");
  if (
    (
      await pool.query(
        "SELECT card_id FROM tcg_card_catalog WHERE card_id=$1",
        [id],
      )
    ).rows[0]
  )
    return;
  demand(tradingCardId.safeParse(id).success, 404, "카드를 찾지 못했습니다.");
  const data = detailCard(
    await readCatalog("/api/mobile/v1/cards/detail", { id }, 12000),
    id,
  );
  await pool.query(
    "INSERT INTO tcg_card_catalog(card_id,card) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [id, JSON.stringify(data)],
  );
}
export async function cardOffers(user: string, id: string, cursor?: string) {
  const page: any = cursor
    ? decoded(cursor)
    : {
        asOf: (await pool.query(`SELECT ${timestamp("now()")} AS as_of`))
          .rows[0].as_of,
      };
  if (cursor)
    demand(
      page.v === 1 &&
        page.cardId === id &&
        page.user === user &&
        time.test(page.asOf) &&
        time.test(page.createdAt) &&
        uuid.test(page.id) &&
        Number.isFinite(Date.parse(page.createdAt)) &&
        Number.isFinite(Date.parse(page.asOf)),
      400,
      "오퍼를 다시 불러와 주세요.",
    );
  const rows = (
    await pool.query(
      `${listingSelect.replace("SELECT l.*", `SELECT ${timestamp("l.created_at")} AS cursor_at,l.*`)} WHERE ${visible} AND c.card_id=$2 AND l.created_at<=$3 AND ($4::timestamptz IS NULL OR (l.created_at,l.id)<($4::timestamptz,$5::uuid)) ORDER BY l.created_at DESC,l.id DESC LIMIT 21`,
      [user, id, page.asOf, page.createdAt ?? null, page.id ?? null],
    )
  ).rows;
  const items = rows.slice(0, PAGE),
    last = items.at(-1);
  return {
    items: items.map(({ cursor_at, ...item }) => item),
    nextCursor:
      rows.length > PAGE && last
        ? encoded({
            v: 1,
            user,
            cardId: id,
            asOf: page.asOf,
            createdAt: last.cursor_at,
            id: last.id,
          })
        : null,
  };
}
export async function setCardLike(user: string, id: string, liked: boolean) {
  await ensureCard(id);
  return transaction(async (sql) => {
    await sql.query(
      "SELECT card_id FROM tcg_card_catalog WHERE card_id=$1 FOR UPDATE",
      [id],
    );
    if (liked)
      await sql.query(
        "INSERT INTO tcg_card_likes(card_id,owner_id,source) VALUES($1,$2,'card') ON CONFLICT(card_id,owner_id) DO UPDATE SET source='card'",
        [id, user],
      );
    else {
      await sql.query(
        "DELETE FROM tcg_card_likes WHERE card_id=$1 AND owner_id=$2",
        [id, user],
      );
      await sql.query(
        "DELETE FROM tcg_listing_likes a USING tcg_listings l,tcg_collection c WHERE a.listing_id=l.id AND l.collection_id=c.id AND c.card_id=$1 AND a.owner_id=$2",
        [id, user],
      );
    }
    return {
      liked_by_me: liked,
      like_count: (
        await sql.query(
          "SELECT count(*)::int AS n FROM tcg_card_likes WHERE card_id=$1",
          [id],
        )
      ).rows[0].n,
    };
  });
}
const commentVisible = `a.card_id=$1 AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$2 AND b.blocked_user_id=a.owner_id) OR (b.blocker_user_id=a.owner_id AND b.blocked_user_id=$2))`;
export async function cardComments(
  user: string,
  id: string,
  cursor?: string,
  sql: Sql = pool,
) {
  const before = cursor ? decoded(cursor) : null;
  if (before)
    demand(
      uuid.test(before.id) &&
        time.test(before.createdAt) &&
        Number.isFinite(Date.parse(before.createdAt)),
      400,
      "댓글을 다시 불러와 주세요.",
    );
  const rows = (
    await sql.query(
      `SELECT a.id,a.card_id,a.owner_id,u.nickname AS owner_name,a.body,a.created_at,${timestamp("a.created_at")} AS cursor_at FROM tcg_card_comments a JOIN users u ON u.id=a.owner_id WHERE ${commentVisible} AND ($3::timestamptz IS NULL OR (a.created_at,a.id)<($3::timestamptz,$4::uuid)) ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,
      [id, user, before?.createdAt ?? null, before?.id ?? null],
    )
  ).rows;
  const items = rows.slice(0, 50),
    last = items.at(-1);
  return {
    items: items.map(({ cursor_at, ...item }) => item),
    comment_count: (
      await sql.query(
        `SELECT count(*)::int AS n FROM tcg_card_comments a WHERE ${commentVisible}`,
        [id, user],
      )
    ).rows[0].n,
    nextCursor:
      rows.length > 50 && last
        ? encoded({ id: last.id, createdAt: last.cursor_at })
        : null,
  };
}
export async function addCardComment(
  user: string,
  id: string,
  input: { body: string; requestKey: string },
) {
  demand(
    input.body.trim().length > 0 && [...input.body.trim()].length <= 500,
    400,
    "댓글은 1~500자로 입력해 주세요.",
  );
  await ensureCard(id);
  return transaction(async (sql) => {
    await sql.query(
      "SELECT card_id FROM tcg_card_catalog WHERE card_id=$1 FOR UPDATE",
      [id],
    );
    const prior = (
      await sql.query(
        "SELECT * FROM tcg_card_comments WHERE owner_id=$1 AND request_key=$2",
        [user, input.requestKey],
      )
    ).rows[0];
    demand(
      !prior || prior.card_id === id,
      409,
      "다른 댓글에 사용한 요청입니다. 다시 시도해 주세요.",
    );
    const item =
      prior ??
      (
        await sql.query(
          "INSERT INTO tcg_card_comments(card_id,owner_id,body,request_key) VALUES($1,$2,$3,$4) RETURNING *",
          [id, user, input.body.trim(), input.requestKey],
        )
      ).rows[0];
    const author = (
      await sql.query("SELECT nickname FROM users WHERE id=$1", [user])
    ).rows[0];
    return {
      item: {
        id: item.id,
        card_id: id,
        owner_id: user,
        owner_name: author.nickname,
        body: item.body,
        created_at: item.created_at,
      },
      comment_count: (await cardComments(user, id, undefined, sql))
        .comment_count,
    };
  });
}
