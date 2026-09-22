import { pool } from "@workspace/db";
import { z } from "zod/v4";
import {
  categoryEligible,
  matchPair,
  categories,
  type MatchListing,
} from "./exchangeRules";
import { listingDto, demand, type Sql } from "./exchangeService";
import {
  relayEdge,
  findRelayCycles,
  relayEligible,
  type RelayListing,
} from "./relayRules";

export type WishGoal = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  keywords: string[];
  kind: string;
  category: string;
};
export const wishGoalContextInput = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    title: z.string().min(2).max(120),
    keywords: z.array(z.string().min(1).max(80)).max(16),
    kind: z.enum(["goods", "service", "experience"]),
    category: z.enum(categories),
  })
  .strict();
export type WishGoalContext = z.infer<typeof wishGoalContextInput>;
export type WishMatch = { reason: string; pending: string; score: number };
export type WishRelayCandidate = {
  id: string;
  listings: ReturnType<typeof listingDto>[];
  reasons: string[];
  pending: string[];
};
const ignored = new Set([
  "갖고",
  "싶은",
  "싶어요",
  "싶다",
  "원하는",
  "원해요",
  "원합니다",
  "찾아요",
  "구해요",
  "받고",
  "교환",
  "교환하고",
  "중고",
  "상품",
  "물건",
  "좋은",
  "상태",
  "정품",
  "주세요",
  "구합니다",
  "합니다",
  "하고",
  "있는",
  "구하고",
  "새상품",
  "새제품",
  "삽니다",
]);
const compact = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
function tokens(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => (t.length >= 2 || /\d/u.test(t)) && !ignored.has(t));
}
function identityTerms(goal: Pick<WishGoal, "title" | "keywords">) {
  return [
    ...new Set([...tokens(goal.title), ...goal.keywords.flatMap(tokens)]),
  ].slice(0, 32);
}
function containsTerm(text: string, term: string) {
  const haystack = compact(text),
    needle = compact(term);
  if (!needle) return false;
  let offset = 0;
  for (;;) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) return false;
    // Numeric model suffixes must not turn generation 2 into 20 or XM5 into XM50.
    const before = haystack[index - 1] ?? "",
      after = haystack[index + needle.length] ?? "";
    if (
      !(/^\d/u.test(needle) && /\d/u.test(before)) &&
      !(/\d$/u.test(needle) && /[a-z0-9]/u.test(after))
    )
      return true;
    offset = index + 1;
  }
}
/** A conservative text candidate, never a product-identification guarantee. */
export function matchesWish(
  goal: Pick<WishGoal, "title" | "keywords" | "kind" | "category">,
  listing: MatchListing,
): WishMatch | null {
  if (
    listing.kind !== goal.kind ||
    listing.category !== goal.category ||
    !categoryEligible({
      category: listing.category,
      title: listing.title,
      description: listing.description,
      wantedText: listing.wanted_text,
    })
  )
    return null;
  const terms = identityTerms(goal);
  if (!terms.length) return null;
  // A model-compatible case or an empty box is not the product being sought.
  const accessory =
    /(케이스|파우치|박스|상자|스킨|필름|스트랩|거치대|케이블|충전기|이어팁|부품|이어패드|리모컨|case|cover|box|cable|charger)/i;
  const offeredText = listing.title + " " + listing.description;
  if (!accessory.test(goal.title)) {
    if (/(본체|본품)\s*(없|미포함|제외)/u.test(offeredText)) return null;
    if (
      accessory.test(listing.title) &&
      !/(본체|본품|풀세트|풀구성)/u.test(listing.title)
    )
      return null;
  }
  const titleHits = terms.filter((t) => containsTerm(listing.title, t));
  // A matching category or an incidental mention in a description is insufficient.
  if (!titleHits.some((t) => !/^\d+$/u.test(t))) return null;
  if (
    !terms.every((t) =>
      containsTerm(listing.title + " " + listing.description, t),
    )
  )
    return null;
  // Model identifiers must be visible in the offered item's title, not just its wanted text or a comparison.
  if (
    !terms
      .filter((t) => /\d/u.test(t))
      .every((t) => containsTerm(listing.title, t))
  )
    return null;
  return {
    reason: "확인한 목표의 상품명·검색어와 연결되는 등록이에요",
    pending:
      "글을 기준으로 찾은 후보예요. 사진·정확한 모델·구성·상태와 교환 조건을 상대와 확인해 주세요",
    score: titleHits.length * 2,
  };
}
export function goalRelayEdge(
  goal: WishGoalContext,
  giver: RelayListing,
  receiver: RelayListing,
) {
  if (receiver.owner_id !== goal.ownerId) return relayEdge(giver, receiver);
  const match = matchesWish(goal, giver);
  if (!match) return null;
  const edge = relayEdge(giver, {
    ...receiver,
    wanted_categories: [goal.category],
    wanted_text: goal.title,
  });
  return edge
    ? {
        score: edge.score + match.score,
        reason: match.reason,
        pending: match.pending,
      }
    : null;
}
export async function loadActiveWishContext(
  sql: Sql,
  userId: string,
  id: string,
): Promise<WishGoalContext> {
  const row = (
    await sql.query(
      "SELECT id,user_id,title,keywords,kind,category FROM exchange_wishes WHERE id=$1 AND user_id=$2 AND status='active'",
      [id, userId],
    )
  ).rows[0];
  demand(
    row,
    404,
    "찾고 있는 목표를 확인할 수 없어요. 내 활성 목표에서 다시 시작해 주세요.",
  );
  const context = wishGoalContextInput.parse({
    id: row.id,
    ownerId: row.user_id,
    title: row.title,
    keywords: row.keywords,
    kind: row.kind,
    category: row.category,
  });
  demand(
    categoryEligible({
      category: context.category,
      title: context.title,
      description: context.keywords.join(" "),
    }),
    400,
    "이 목표는 자동 연결을 지원하지 않아요.",
  );
  return context;
}
const available = `l.mode='offer' AND l.status='published'
 AND NOT EXISTS(SELECT 1 FROM exchange_relay_reservations r WHERE r.active AND r.listing_id=l.id AND r.kind='goods')
 AND NOT EXISTS(SELECT 1 FROM exchange_reservations r WHERE r.active AND r.listing_id=l.id AND l.kind='goods')`;
const visible = `NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=l.owner_id))`;
export async function findWishCandidates(
  userId: string,
  goal: WishGoal,
  sql: Sql = pool,
) {
  demand(goal.ownerId === userId, 404, "내 목표만 찾을 수 있어요.");
  const context = wishGoalContextInput.parse({
    id: goal.id,
    ownerId: goal.ownerId,
    title: goal.title,
    keywords: goal.keywords,
    kind: goal.kind,
    category: goal.category,
  });
  const none = {
    direct: [] as any[],
    relays: [] as WishRelayCandidate[],
    targets: [] as ReturnType<typeof listingDto>[],
    offersCount: 0,
    targetCount: 0,
    scannedCount: 0,
    limited: false,
    searchedAt: new Date().toISOString(),
  };
  const terms = identityTerms(goal);
  if (
    !terms.length ||
    !categoryEligible({
      category: goal.category,
      title: goal.title,
      description: goal.keywords.join(" "),
    })
  )
    return none;
  const mineRows = (
    await sql.query(
      `SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.owner_id=$1 AND ${available} ORDER BY l.updated_at DESC,l.id LIMIT 21`,
      [userId],
    )
  ).rows;
  const mine = mineRows.slice(0, 20).filter(relayEligible);
  // Search the goal first so a popular unrelated category cannot evict the wanted item.
  const targetRows = (
    await sql.query(
      `SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.owner_id<>$1 AND ${available} AND ${visible} AND l.kind=$3 AND l.category=$4
 AND lower(regexp_replace(l.title || ' ' || l.description,'[^[:alnum:]가-힣]','','g')) LIKE ANY($2::text[])
 ORDER BY l.updated_at DESC,l.id LIMIT 161`,
      [
        userId,
        terms.slice(0, 16).map((t) => "%" + compact(t) + "%"),
        goal.kind,
        goal.category,
      ],
    )
  ).rows;
  const targets = targetRows.slice(0, 160).filter((l) => matchesWish(goal, l));
  if (!mine.length)
    return {
      ...none,
      targets: targets.slice(0, 8).map(listingDto),
      offersCount: 0,
      targetCount: targets.length,
      scannedCount: mineRows.length + targetRows.length,
      limited: mineRows.length > 20 || targetRows.length > 160,
    };
  const otherRows = (
    await sql.query(
      `SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.owner_id<>$1 AND ${available} AND ${visible}
 ORDER BY CASE WHEN l.id=ANY($2::uuid[]) THEN 0 ELSE 1 END,l.updated_at DESC,l.id LIMIT 301`,
      [userId, targets.map((l) => l.id)],
    )
  ).rows;
  const others = otherRows.slice(0, 300),
    all = [...mine, ...others];
  const owners = [...new Set(all.map((l) => l.owner_id))];
  const blocks = (
    await sql.query(
      "SELECT blocker_user_id,blocked_user_id FROM blocked_users WHERE blocker_user_id=ANY($1::uuid[]) AND blocked_user_id=ANY($1::uuid[])",
      [owners],
    )
  ).rows;
  const excluded = new Set(
    blocks.flatMap((b) => [
      b.blocker_user_id + ":" + b.blocked_user_id,
      b.blocked_user_id + ":" + b.blocker_user_id,
    ]),
  );
  const graph = findRelayCycles(
    all,
    userId,
    (a, b) => excluded.has(a.owner_id + ":" + b.owner_id),
    (a, b) => goalRelayEdge(context, a, b),
  );
  const relays = graph.items.map((c) => ({
    id: c.id,
    listings: c.listings.map(listingDto),
    reasons: c.listings.map(
      (l, i) =>
        goalRelayEdge(context, l, c.listings[(i + 1) % c.listings.length])!
          .reason,
    ),
    pending: [
      ...new Set(
        c.listings.map(
          (l, i) =>
            goalRelayEdge(context, l, c.listings[(i + 1) % c.listings.length])!
              .pending,
        ),
      ),
    ],
  }));
  const best = new Map<string, any>();
  for (const target of targets)
    for (const offer of mine) {
      const match = matchPair(
        {
          ...offer,
          wanted_categories: [goal.category],
          wanted_text: goal.title,
        },
        target,
      );
      const identity = matchesWish(goal, target);
      if (!match || !identity) continue;
      const candidate = {
        id: target.id,
        offer: listingDto(offer),
        target: listingDto(target),
        reasons: [identity.reason, ...match.reasons],
        pending: [identity.pending, ...match.pending],
        score: match.score + identity.score,
      };
      if (!best.has(target.id) || best.get(target.id).score < candidate.score)
        best.set(target.id, candidate);
    }
  const direct = [...best.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 24)
    .map(({ score, ...rest }) => rest);
  const connected = new Set([
    ...direct.map((d) => d.target.id),
    ...relays.map((r) => r.listings[r.listings.length - 1].id),
  ]);
  return {
    direct,
    relays,
    targets: targets
      .filter((t) => !connected.has(t.id))
      .slice(0, 8)
      .map(listingDto),
    offersCount: mine.length,
    targetCount: targets.length,
    scannedCount: all.length,
    limited:
      mineRows.length > 20 ||
      targetRows.length > 160 ||
      otherRows.length > 300 ||
      graph.capped,
    searchedAt: new Date().toISOString(),
  };
}
