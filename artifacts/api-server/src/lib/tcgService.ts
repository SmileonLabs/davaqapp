import { pool } from "@workspace/db";
import { demand } from "./tcgCatalog";
import { mirrorListingLike, mirrorListingComment, registerListingCard } from "./tcgCardSocialBridge";
export interface Sql {
  query(
    text: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount: number | null }>;
}
export async function transaction<T>(
  run: (sql: Sql) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function blocked(sql: Sql, a: string, b: string) {
  return !!(
    await sql.query(
      "SELECT 1 FROM blocked_users WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)",
      [a, b],
    )
  ).rows.length;
}
export const listingSelect = `SELECT l.*,COALESCE((SELECT jsonb_agg(w.card_name) FROM tcg_wants w WHERE w.owner_id=l.owner_id AND w.active AND l.wanted_card_ids ? w.card_id),'[]'::jsonb) AS wanted_card_names,c.card_id,c.card_name,c.condition,c.photos,LEAST(l.quantity,c.quantity-c.reserved) AS available,u.nickname AS owner_name FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id JOIN users u ON u.id=l.owner_id`;

const notBlockedListing = `NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocker_user_id=l.owner_id AND b.blocked_user_id=$1))`;
const cursorTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/;
const cursorId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampText = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function readFeedCursor(cursor?: string) {
  if (!cursor) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    demand(false, 400, "피드를 새로고침해 주세요.");
  }
  demand(
    parsed?.v === 2 && cursorId.test(parsed.snapshotId) && cursorTime.test(parsed.createdAt) &&
      Number.isFinite(Date.parse(parsed.createdAt)) && cursorId.test(parsed.id) &&
      (parsed.bucket === 0 || parsed.bucket === 1),
    400,
    "피드를 새로고침해 주세요.",
  );
  return parsed as { v: 2; snapshotId: string; createdAt: string; id: string; bucket: number };
}

export async function feedListings(user: string, input: { cursor?: string; q?: string; cardId?: string }) {
  const cursor = readFeedCursor(input.cursor);
  let snapshotId = cursor?.snapshotId;
  if (!snapshotId) {
    // Bound maintenance work to one small batch per newly opened feed.
    await pool.query(`DELETE FROM tcg_feed_snapshots WHERE id IN (
      SELECT id FROM tcg_feed_snapshots WHERE expires_at<=now() ORDER BY expires_at,id LIMIT 50
    )`);
    snapshotId = (await pool.query(
      `INSERT INTO tcg_feed_snapshots(owner_id,q,card_id,as_of,offer_listing_ids,expires_at)
       SELECT $1,$2,$3,now(),ARRAY(
         SELECT l.id FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id
         WHERE l.status='active' AND l.mode IN('swap','both','gift') AND l.quantity>0 AND c.quantity-c.reserved>0
         AND ($2='' OR c.card_name ILIKE '%'||$2||'%') AND ($3::text IS NULL OR c.card_id=$3)
         AND ${notBlockedListing}
         AND EXISTS(SELECT 1 FROM tcg_trades t WHERE t.listing_id=l.id AND t.status='proposed' AND t.expires_at>now())
       ),now()+interval '30 minutes' RETURNING id`,
      [user, input.q ?? "", input.cardId ?? null],
    )).rows[0].id;
  } else {
    const snapshot = (await pool.query(
      `SELECT id FROM tcg_feed_snapshots WHERE id=$1 AND owner_id=$2 AND q=$3
       AND card_id IS NOT DISTINCT FROM $4::text AND expires_at>now()`,
      [snapshotId, user, input.q ?? "", input.cardId ?? null],
    )).rows[0];
    demand(snapshot, 410, "피드가 만료됐습니다. 새 카드를 불러와 주세요.");
  }
  // The persisted bucket reflects genuinely open offers on the first request.
  // Later acceptance, cancellation or expiry cannot move a card across pages.
  const fields = `,
    (SELECT count(*)::int FROM tcg_trades t WHERE t.listing_id=l.id AND t.status='proposed' AND t.expires_at>now()) AS offer_count,
    (SELECT count(*)::int FROM tcg_listing_likes a WHERE a.listing_id=l.id) AS like_count,
    (SELECT count(*)::int FROM tcg_listing_comments a WHERE a.listing_id=l.id
      AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=a.owner_id) OR (b.blocker_user_id=a.owner_id AND b.blocked_user_id=$1))) AS comment_count,
    EXISTS(SELECT 1 FROM tcg_listing_likes a WHERE a.listing_id=l.id AND a.owner_id=$1) AS liked_by_me,
    (l.owner_id<>$1 AND (l.mode='gift' OR EXISTS(
      SELECT 1 FROM tcg_collection own WHERE own.owner_id=$1 AND own.quantity-own.reserved>0
      AND (jsonb_array_length(l.wanted_card_ids)=0 OR l.wanted_card_ids ? own.card_id)
      AND NOT EXISTS(SELECT 1 FROM tcg_listings own_listing WHERE own_listing.collection_id=own.id
        AND own_listing.status='active' AND (own_listing.mode NOT IN('swap','both') OR own_listing.quantity<=0))
    ))) AS can_offer,
    page.offer_bucket,
    ${timestampText("page.as_of")} AS feed_as_of,
    ${timestampText("page.created_at")} AS feed_created_at`;
  // Limit before joining details: counts, desired-card names and inventory
  // eligibility run for at most 21 cards, regardless of total feed size.
  const result = await pool.query(
    `WITH feed_snapshot AS (SELECT as_of,offer_listing_ids FROM tcg_feed_snapshots WHERE id=$4 AND owner_id=$1), ranked AS (
      SELECT l.id,l.created_at,feed_snapshot.as_of,
        CASE WHEN l.id=ANY(feed_snapshot.offer_listing_ids) THEN 1 ELSE 0 END AS offer_bucket
      FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id CROSS JOIN feed_snapshot
      WHERE l.status='active' AND l.mode IN('swap','both','gift') AND l.quantity>0 AND c.quantity-c.reserved>0
      AND l.created_at<=feed_snapshot.as_of AND ($2='' OR c.card_name ILIKE '%'||$2||'%')
      AND ($3::text IS NULL OR c.card_id=$3) AND ${notBlockedListing}
    ), page AS MATERIALIZED (
      SELECT * FROM ranked WHERE $5::int IS NULL OR (offer_bucket,created_at,id)<($5::int,$6::timestamptz,$7::uuid)
      ORDER BY offer_bucket DESC,created_at DESC,id DESC LIMIT 21
    )
    ${listingSelect.replace(" FROM tcg_listings l", fields + " FROM tcg_listings l")}
    JOIN page ON page.id=l.id
    ORDER BY page.offer_bucket DESC,page.created_at DESC,page.id DESC`,
    [user, input.q ?? "", input.cardId ?? null, snapshotId, cursor?.bucket ?? null, cursor?.createdAt ?? null, cursor?.id ?? null],
  );
  const page = result.rows.slice(0, 20);
  const last = page.at(-1);
  return {
    items: page.map(({ feed_as_of, feed_created_at, offer_bucket, ...item }) => item),
    nextCursor: result.rows.length > 20 && last ? Buffer.from(JSON.stringify({
      v: 2, snapshotId, bucket: last.offer_bucket, createdAt: last.feed_created_at, id: last.id,
    })).toString("base64url") : null,
  };
}

export async function setListingLike(user: string, id: string, liked: boolean) {
  const initial = await visibleListing(pool, id, user);
  return transaction(async (sql) => {
    await registerListingCard(sql, initial);
    await sql.query("SELECT card_id FROM tcg_card_catalog WHERE card_id=$1 FOR UPDATE", [initial.card_id]);
    await sql.query("SELECT id FROM tcg_listings WHERE id=$1 FOR UPDATE", [id]);
    const listing = await visibleListing(sql, id, user);
    demand(listing.card_id === initial.card_id, 409, "카드가 변경됐습니다. 다시 시도해 주세요.");
    demand(listing.status === "active", 409, "종료된 거래입니다.");
    if (liked) await sql.query("INSERT INTO tcg_listing_likes(listing_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, user]);
    else await sql.query("DELETE FROM tcg_listing_likes WHERE listing_id=$1 AND owner_id=$2", [id, user]);
    await mirrorListingLike(sql, listing, user, liked);
    const count = (await sql.query("SELECT count(*)::int AS like_count FROM tcg_listing_likes WHERE listing_id=$1", [id])).rows[0].like_count;
    return { liked_by_me: liked, like_count: count };
  });
}

export async function listingComments(user: string, id: string, cursor?: string, sql: Sql = pool) {
  await visibleListing(sql, id, user);
  let before: { id: string; createdAt: string } | undefined;
  if (cursor) {
    try { before = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { /* validated below */ }
    demand(before && cursorId.test(before.id) && cursorTime.test(before.createdAt) && Number.isFinite(Date.parse(before.createdAt)), 400, "댓글을 다시 불러와 주세요.");
  }
  const visible = `listing_id=$1 AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$2 AND b.blocked_user_id=a.owner_id) OR (b.blocker_user_id=a.owner_id AND b.blocked_user_id=$2))`;
  const rows = (await sql.query(
    `SELECT a.id,a.listing_id,a.owner_id,a.body,a.created_at,u.nickname AS owner_name,${timestampText("a.created_at")} AS cursor_at
     FROM tcg_listing_comments a JOIN users u ON u.id=a.owner_id WHERE ${visible}
     AND ($3::timestamptz IS NULL OR (a.created_at,a.id)<($3::timestamptz,$4::uuid)) ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,
    [id, user, before?.createdAt ?? null, before?.id ?? null],
  )).rows;
  const items = rows.slice(0, 50);
  const last = items.at(-1);
  return {
    items: items.map(({ cursor_at, ...item }) => item),
    comment_count: (await sql.query(`SELECT count(*)::int AS n FROM tcg_listing_comments a WHERE ${visible}`, [id, user])).rows[0].n,
    nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.cursor_at })).toString("base64url") : null,
  };
}

export async function addListingComment(user: string, id: string, input: { body: string; requestKey: string }) {
  demand(input.body.trim().length > 0 && [...input.body.trim()].length <= 500, 400, "댓글은 1~500자로 입력해 주세요.");
  const initial = await visibleListing(pool, id, user);
  return transaction(async (sql) => {
    await registerListingCard(sql, initial);
    await sql.query("SELECT card_id FROM tcg_card_catalog WHERE card_id=$1 FOR UPDATE", [initial.card_id]);
    await sql.query("SELECT id FROM tcg_listings WHERE id=$1 FOR UPDATE", [id]);
    const listing = await visibleListing(sql, id, user);
    demand(listing.card_id === initial.card_id, 409, "카드가 변경됐습니다. 다시 시도해 주세요.");
    demand(listing.status === "active", 409, "종료된 거래입니다.");
    const prior = (await sql.query("SELECT * FROM tcg_listing_comments WHERE owner_id=$1 AND request_key=$2", [user, input.requestKey])).rows[0];
    demand(!prior || prior.listing_id === id, 409, "다른 댓글에 사용한 요청입니다. 다시 시도해 주세요.");
    const item = prior ?? (await sql.query(
      "INSERT INTO tcg_listing_comments(listing_id,owner_id,body,request_key) VALUES($1,$2,$3,$4) RETURNING id,listing_id,owner_id,body,created_at",
      [id, user, input.body.trim(), input.requestKey],
    )).rows[0];
    await mirrorListingComment(sql, listing, { ...item, request_key: input.requestKey });
    const author = (await sql.query("SELECT nickname FROM users WHERE id=$1", [user])).rows[0];
    return { item: { id: item.id, listing_id: item.listing_id, owner_id: item.owner_id, body: item.body, created_at: item.created_at, owner_name: author.nickname }, comment_count: (await listingComments(user, id, undefined, sql)).comment_count };
  });
}
export async function visibleListing(sql: Sql, id: string, user: string) {
  const row = (await sql.query(listingSelect + " WHERE l.id=$1", [id])).rows[0];
  demand(row, 404, "매물을 찾지 못했습니다.");
  demand(
    row.status === "active" ||
      row.owner_id === user ||
      (
        await sql.query(
          "SELECT 1 FROM tcg_trades WHERE (listing_id=$1 OR offered_listing_id=$1) AND (buyer_id=$2 OR seller_id=$2)",
          [id, user],
        )
      ).rows.length,
    404,
    "매물을 찾지 못했습니다.",
  );
  demand(
    !(await blocked(sql, user, row.owner_id)),
    404,
    "매물을 찾지 못했습니다.",
  );
  return row;
}
export async function validatePhotos(sql: Sql, user: string, photos: string[]) {
  for (const path of photos)
    demand(
      (
        await sql.query(
          "SELECT 1 FROM chat_upload_owners WHERE user_id=$1 AND object_path=$2 AND content_type LIKE 'image/%'",
          [user, path],
        )
      ).rows.length,
      403,
      "내가 업로드한 사진만 사용할 수 있습니다.",
    );
}
export async function matches(user: string) {
  return (
    await pool.query(
      `${listingSelect} JOIN tcg_wants w ON w.card_id=c.card_id AND w.owner_id=$1 AND w.active
 WHERE l.owner_id<>$1 AND l.status='active' AND c.quantity-c.reserved>=w.quantity AND l.quantity>=w.quantity AND w.conditions ? c.condition
 AND (w.delivery='either' OR l.delivery='either' OR w.delivery=l.delivery)
 AND (w.region='' OR l.region=w.region OR (w.delivery<>'meet' AND l.delivery<>'meet'))
 AND ((w.mode IN('buy','either') AND l.mode IN('sale','both') AND (w.max_price IS NULL OR l.price<=w.max_price))
 OR (w.mode IN('swap','either') AND l.mode IN('swap','both') AND EXISTS(
 SELECT 1 FROM tcg_listings own JOIN tcg_collection oc ON oc.id=own.collection_id WHERE own.owner_id=$1 AND own.status='active' AND own.mode IN('swap','both')
 AND own.quantity>0 AND oc.quantity-oc.reserved>0 AND l.wanted_card_ids ? oc.card_id
 AND own.wanted_card_ids ? c.card_id
 AND (own.delivery='either' OR l.delivery='either' OR own.delivery=l.delivery))))
 AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocker_user_id=l.owner_id AND b.blocked_user_id=$1))
 ORDER BY l.updated_at DESC,l.id LIMIT 100`,
      [user],
    )
  ).rows;
}
export async function createTrade(user: string, input: any) {
  return transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      user + ":" + input.requestKey,
    ]);
    const prior = (
      await sql.query(
        "SELECT * FROM tcg_trades WHERE buyer_id=$1 AND request_key=$2",
        [user, input.requestKey],
      )
    ).rows[0];
    if (prior) return prior;
    // Collection locks are ordered for purchase and swap alike.
    const ids = [
      input.listingId,
      ...(input.offeredListingId ? [input.offeredListingId] : []),
    ].sort();
    await sql.query(
      "SELECT id FROM tcg_listings WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    const target = await visibleListing(sql, input.listingId, user);
    demand(target.owner_id !== user, 400, "내 매물에는 제안할 수 없습니다.");
    demand(
      target.status === "active" &&
        target.available >= input.quantity &&
        target.quantity >= input.quantity,
      409,
      "거래 가능한 수량이 부족합니다.",
    );
    demand(
      target.version === input.listingVersion,
      409,
      "매물이 변경됐습니다. 다시 확인해 주세요.",
    );
    let offered: any = null;
    if (input.kind === "swap") {
      demand(["swap", "both"].includes(target.mode), 400, "교환 가능한 카드를 선택해 주세요.");
      offered = await visibleListing(sql, input.offeredListingId, user);
      demand(
        offered.owner_id === user &&
          offered.status === "active" &&
          ["swap", "both"].includes(offered.mode),
        403,
        "내 교환 매물을 선택해 주세요.",
      );
      demand(
        offered.available >= input.offeredQuantity &&
          offered.quantity >= input.offeredQuantity,
        409,
        "내 카드 수량이 부족합니다.",
      );
      demand(
        offered.version === input.offeredVersion,
        409,
        "내 매물이 변경됐습니다.",
      );
      demand(
        !target.wanted_card_ids.length || target.wanted_card_ids.includes(offered.card_id),
        400,
        "상대가 원하는 카드로 제안해 주세요.",
      );
    } else if (input.kind === "gift") {
      demand(target.mode === "gift", 400, "무료 나눔 카드를 선택해 주세요.");
      demand(!input.offeredListingId && !input.cash, 400, "무료 나눔에는 교환 카드나 금액을 추가할 수 없습니다.");
    } else {
      demand(input.kind === "buy" && ["sale", "both"].includes(target.mode), 400, "구매 가능한 매물을 선택해 주세요.");
    }
    const cash =
      input.kind === "gift" ? 0 : input.kind === "buy" ? target.price * input.quantity : input.cash;
    demand(
      Number.isSafeInteger(cash) && cash >= 0 && cash <= 100000000,
      400,
      "총 거래 금액은 1억 원 이하로 입력해 주세요.",
    );
    const room = (
      await sql.query(
        "INSERT INTO chat_rooms(type,category,visibility,owner_id) VALUES('direct','casual','private',$1) RETURNING id",
        [user],
      )
    ).rows[0].id;
    await sql.query(
      "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2),($1,$3)",
      [room, user, target.owner_id],
    );
    const trade = (
      await sql.query(
        `INSERT INTO tcg_trades(buyer_id,seller_id,listing_id,offered_listing_id,room_id,kind,quantity,offered_quantity,cash,note,snapshot,request_key)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          user,
          target.owner_id,
          target.id,
          offered?.id ?? null,
          room,
          input.kind,
          input.quantity,
          offered ? input.offeredQuantity : 0,
          cash,
          input.note,
          JSON.stringify({ target, offered }),
          input.requestKey,
        ],
      )
    ).rows[0];
    await sql.query(
      "INSERT INTO tcg_trade_actions(trade_id,user_id,version,kind) VALUES($1,$2,1,'accept')",
      [trade.id, user],
    );
    await sql.query(
      "UPDATE chat_rooms SET last_message_seq=last_message_seq+1,last_message=$2,last_message_at=now(),updated_at=now() WHERE id=$1 RETURNING last_message_seq",
      [room, "TCG 거래 제안: " + target.card_name],
    );
    await sql.query(
      "INSERT INTO messages(room_id,sender_id,author_kind,type,content,metadata,room_seq) SELECT $1,$2,'system','text',$3,$4,last_message_seq FROM chat_rooms WHERE id=$1",
      [
        room,
        user,
        "TCG 거래 제안: " + target.card_name,
        JSON.stringify({ tcgTradeId: trade.id }),
      ],
    );
    await sql.query(
      "INSERT INTO tcg_notifications(owner_id,kind,dedupe_key,title,body,trade_id) VALUES($1,'trade',$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        target.owner_id,
        "trade:" + trade.id,
        "새 카드 거래 제안",
        target.card_name,
        trade.id,
      ],
    );
    return trade;
  });
}
export async function tradeDetail(user: string, id: string, sql: Sql = pool) {
  const row = (
    await sql.query(
      "SELECT * FROM tcg_trades WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)",
      [id, user],
    )
  ).rows[0];
  demand(row, 404, "거래를 찾지 못했습니다.");
  return {
    ...row,
    actions: (
      await sql.query(
        "SELECT user_id,kind,version,created_at FROM tcg_trade_actions WHERE trade_id=$1 AND version=$2",
        [id, row.version],
      )
    ).rows,
  };
}
export async function tradeAction(
  user: string,
  id: string,
  kind: string,
  version: number,
) {
  return transaction(async (sql) => {
    const t = (
      await sql.query("SELECT * FROM tcg_trades WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    demand(
      t && (t.buyer_id === user || t.seller_id === user),
      404,
      "거래를 찾지 못했습니다.",
    );
    demand(t.version === version, 409, "거래 조건이 변경됐습니다.");
    demand(t.kind !== "gift" || kind !== "accept" || user === t.seller_id, 403, "나눔 등록자만 신청을 수락할 수 있습니다.");
    if (
      (
        await sql.query(
          "SELECT 1 FROM tcg_trade_actions WHERE trade_id=$1 AND user_id=$2 AND version=$3 AND kind=$4",
          [id, user, version, kind],
        )
      ).rows.length
    )
      return tradeDetail(user, id, sql);
    demand(
      !["completed", "cancelled", "declined", "disputed"].includes(t.status),
      409,
      "종료됐거나 확인이 필요한 거래입니다.",
    );
    const opposite = user === t.buyer_id ? t.seller_id : t.buyer_id;
    if (kind === "decline") {
      demand(t.status === "proposed", 409, "이미 확정된 거래입니다.");
      await sql.query(
        "UPDATE tcg_trades SET status='declined',updated_at=now() WHERE id=$1",
        [id],
      );
      return tradeDetail(user, id, sql);
    }
    if (kind === "dispute") {
      demand(t.status === "confirmed", 409, "확정 거래만 신고할 수 있습니다.");
      await sql.query(
        "UPDATE tcg_trades SET status='disputed',updated_at=now() WHERE id=$1",
        [id],
      );
      await sql.query(
        "INSERT INTO tcg_reports(owner_id,trade_id,reason) VALUES($1,$2,$3)",
        [user, id, "거래 분쟁 확인 요청"],
      );
      return tradeDetail(user, id, sql);
    }
    if (kind === "accept") {
      demand(
        t.status === "proposed" && new Date(t.expires_at) > new Date(),
        409,
        "제안이 만료됐거나 이미 확정됐습니다.",
      );
      demand(
        !(await blocked(sql, user, opposite)),
        403,
        "차단한 상대와 확정할 수 없습니다.",
      );
    } else if (kind === "sent" || kind === "received") {
      demand(t.status === "confirmed", 409, "먼저 거래 조건을 확정해 주세요.");
      demand(
        t.kind === "swap" ||
          (kind === "sent" ? user === t.seller_id : user === t.buyer_id),
        403,
        "이 동작을 수행할 수 없습니다.",
      );
      if (kind === "received")
        demand(
          (
            await sql.query(
              "SELECT 1 FROM tcg_trade_actions WHERE trade_id=$1 AND user_id=$2 AND version=$3 AND kind='sent'",
              [id, opposite, version],
            )
          ).rows.length,
          409,
          "상대의 전달 기록을 먼저 확인해 주세요.",
        );
    } else if (kind === "cancel") {
      demand(
        !(
          await sql.query(
            "SELECT 1 FROM tcg_trade_actions WHERE trade_id=$1 AND version=$2 AND kind IN('sent','received')",
            [id, version],
          )
        ).rows.length,
        409,
        "전달 이후에는 분쟁 확인을 요청해 주세요.",
      );
    }
    await sql.query(
      "INSERT INTO tcg_trade_actions(trade_id,user_id,version,kind) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [id, user, version, kind],
    );
    const count = async (k: string) =>
      (
        await sql.query(
          "SELECT count(*)::int n FROM tcg_trade_actions WHERE trade_id=$1 AND version=$2 AND kind=$3",
          [id, version, k],
        )
      ).rows[0].n;
    const ids = [
      t.listing_id,
      ...(t.offered_listing_id ? [t.offered_listing_id] : []),
    ].sort();
    await sql.query(
      "SELECT id FROM tcg_listings WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    const listings = (
      await sql.query("SELECT * FROM tcg_listings WHERE id=ANY($1::uuid[])", [
        ids,
      ])
    ).rows;
    await sql.query(
      "SELECT id FROM tcg_collection WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [listings.map((l) => l.collection_id).sort()],
    );
    const quantity = (l: any) =>
      l.id === t.listing_id ? t.quantity : t.offered_quantity;
    if (kind === "accept" && (await count("accept")) === 2) {
      for (const l of listings) {
        const expected =
          l.id === t.listing_id ? t.snapshot.target : t.snapshot.offered;
        demand(
          l.status === "active" && l.version === expected.version,
          409,
          "매물이 변경됐습니다. 새 제안을 보내 주세요.",
        );
        demand(l.quantity >= quantity(l), 409, "매물 수량이 부족합니다.");
        const updated = await sql.query(
          "UPDATE tcg_collection SET reserved=reserved+$2,updated_at=now() WHERE id=$1 AND quantity-reserved>=$2 RETURNING id",
          [l.collection_id, quantity(l)],
        );
        demand(updated.rowCount, 409, "카드가 다른 거래에 예약됐습니다.");
        await sql.query(
          "UPDATE tcg_listings SET quantity=quantity-$2,updated_at=now() WHERE id=$1",
          [l.id, quantity(l)],
        );
      }
      await sql.query(
        "UPDATE tcg_trades SET status='confirmed',updated_at=now() WHERE id=$1",
        [id],
      );
    }
    if (
      kind === "received" &&
      (await count("received")) === (t.kind === "swap" ? 2 : 1)
    ) {
      for (const l of listings)
        await sql.query(
          "UPDATE tcg_collection SET quantity=quantity-$2,reserved=reserved-$2,updated_at=now() WHERE id=$1",
          [l.collection_id, quantity(l)],
        );
      await sql.query(
        "UPDATE tcg_listings SET status='closed',updated_at=now() WHERE id=ANY($1::uuid[]) AND quantity=0",
        [ids],
      );
      await sql.query(
        "UPDATE tcg_trades SET status='completed',updated_at=now() WHERE id=$1",
        [id],
      );
    }
    if (
      kind === "cancel" &&
      (t.status === "proposed" || (await count("cancel")) === 2)
    ) {
      if (t.status === "confirmed")
        for (const l of listings) {
          await sql.query(
            "UPDATE tcg_collection SET reserved=reserved-$2,updated_at=now() WHERE id=$1",
            [l.collection_id, quantity(l)],
          );
          await sql.query(
            "UPDATE tcg_listings SET quantity=quantity+$2,updated_at=now() WHERE id=$1",
            [l.id, quantity(l)],
          );
        }
      await sql.query(
        "UPDATE tcg_trades SET status='cancelled',updated_at=now() WHERE id=$1",
        [id],
      );
    }
    await sql.query(
      "INSERT INTO tcg_notifications(owner_id,kind,dedupe_key,title,body,trade_id) VALUES($1,'trade',$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        opposite,
        "trade:" + id + ":" + version + ":" + kind + ":" + user,
        "카드 거래 진행이 바뀌었어요",
        kind,
        id,
      ],
    );
    return tradeDetail(user, id, sql);
  });
}
export async function reviseTrade(
  user: string,
  id: string,
  input: {
    version: number;
    quantity: number;
    offeredQuantity: number;
    cash: number;
    note: string;
  },
) {
  return transaction(async (sql) => {
    const t = (
      await sql.query("SELECT * FROM tcg_trades WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    demand(
      t && (t.buyer_id === user || t.seller_id === user),
      404,
      "거래를 찾지 못했습니다.",
    );
    demand(
      t.status === "proposed" && new Date(t.expires_at) > new Date(),
      409,
      "협의 중인 제안만 수정할 수 있습니다.",
    );
    demand(t.version === input.version, 409, "조건이 변경됐습니다.");
    demand(t.kind !== "gift" || (user === t.buyer_id && input.cash === 0), 403, "나눔 신청자만 수량과 메모를 수정할 수 있습니다.");
    demand(
      !(await blocked(sql, t.buyer_id, t.seller_id)),
      403,
      "차단한 상대와 협의할 수 없습니다.",
    );
    const target = await visibleListing(sql, t.listing_id, user),
      offered = t.offered_listing_id
        ? await visibleListing(sql, t.offered_listing_id, user)
        : null;
    demand(
      target.status === "active" &&
        target.quantity >= input.quantity &&
        target.available >= input.quantity,
      409,
      "받을 카드 수량이 부족합니다.",
    );
    if (offered)
      demand(
        offered.status === "active" &&
          offered.quantity >= input.offeredQuantity &&
          offered.available >= input.offeredQuantity,
        409,
        "제공 카드 수량이 부족합니다.",
      );
    await sql.query(
      "UPDATE tcg_trades SET quantity=$2,offered_quantity=$3,cash=$4,note=$5,snapshot=$6,version=version+1,expires_at=now()+interval '7 days',updated_at=now() WHERE id=$1",
      [
        id,
        input.quantity,
        offered ? input.offeredQuantity : 0,
        input.cash,
        input.note,
        JSON.stringify({ target, offered }),
      ],
    );
    await sql.query(
      "INSERT INTO tcg_trade_actions(trade_id,user_id,version,kind) VALUES($1,$2,$3,'accept')",
      [id, user, input.version + 1],
    );
    return tradeDetail(user, id, sql);
  });
}
export async function resolveDispute(
  actor: string,
  id: string,
  action: "resume" | "cancel",
  reason: string,
) {
  return transaction(async (sql) => {
    const t = (
      await sql.query("SELECT * FROM tcg_trades WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    demand(
      t?.status === "disputed",
      409,
      "분쟁 확인 중인 거래만 처리할 수 있습니다.",
    );
    if (action === "cancel") {
      const ids = [
        t.listing_id,
        ...(t.offered_listing_id ? [t.offered_listing_id] : []),
      ].sort();
      const listings = (
        await sql.query(
          "SELECT * FROM tcg_listings WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [ids],
        )
      ).rows;
      await sql.query(
        "SELECT id FROM tcg_collection WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [listings.map((l) => l.collection_id).sort()],
      );
      for (const l of listings) {
        const qty = l.id === t.listing_id ? t.quantity : t.offered_quantity;
        await sql.query(
          "UPDATE tcg_collection SET reserved=reserved-$2 WHERE id=$1",
          [l.collection_id, qty],
        );
        await sql.query(
          "UPDATE tcg_listings SET quantity=quantity+$2 WHERE id=$1",
          [l.id, qty],
        );
      }
    }
    await sql.query(
      "UPDATE tcg_trades SET status=$2,updated_at=now() WHERE id=$1",
      [id, action === "resume" ? "confirmed" : "cancelled"],
    );
    await sql.query(
      "INSERT INTO tcg_operation_events(actor_id,target_id,action,reason,data) VALUES($1,$2,$3,$4,$5)",
      [
        actor,
        id,
        "dispute_" + action,
        reason,
        JSON.stringify({ previousStatus: t.status }),
      ],
    );
    await sql.query(
      "UPDATE tcg_reports SET status='resolved' WHERE trade_id=$1",
      [id],
    );
    return { ok: true };
  });
}

export async function mapListings(user:string,b:{lat:number;lng:number;q:string}){
    const lat = Math.round(b.lat * 100) / 100,
      lng = Math.round(b.lng * 100) / 100;
    const items = (
      await pool.query(
        `${listingSelect} WHERE l.status='active' AND l.mode IN ('swap','both') AND l.delivery IN ('meet','either') AND l.quantity>0 AND c.quantity-c.reserved>0 AND l.map_lat BETWEEN $2-0.3 AND $2+0.3 AND l.map_lng BETWEEN $3-0.4 AND $3+0.4 AND ($4='' OR c.card_name ILIKE '%'||$4||'%') AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocker_user_id=l.owner_id AND b.blocked_user_id=$1)) ORDER BY (l.map_lat-$2)^2+(l.map_lng-$3)^2,l.id LIMIT 81`,
        [user, lat, lng, b.q],
      )
    ).rows;
  return {items:items.slice(0,80),truncated:items.length>80};
}
