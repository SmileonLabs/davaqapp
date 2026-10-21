import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { publicDavaqAvatar } from "../lib/davaqAvatarPolicy";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();
const pageSize = 20;
const uuid = z.uuid();
const cursorTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorSchema = z.object({
  v: z.literal(1),
  viewerId: uuid,
  userId: uuid,
  createdAt: z.string().regex(cursorTime).refine((value) => Number.isFinite(Date.parse(value))),
  id: uuid,
}).strict();
const querySchema = z.object({ cursor: z.string().min(1).max(500).optional() }).strict();

const publicListing = `l.status='active' AND l.quantity>0 AND c.quantity-c.reserved>0
  AND c.owner_id=l.owner_id AND l.mode IN ('swap','both','gift','sale')`;
const unblocked = `($1::uuid=$2::uuid OR NOT EXISTS(
  SELECT 1 FROM blocked_users b WHERE
  (b.blocker_user_id=$1 AND b.blocked_user_id=$2) OR
  (b.blocker_user_id=$2 AND b.blocked_user_id=$1)))`;

// This endpoint deliberately uses DavaQ account text, not the legacy active
// STAR/FAN name, introduction, growth, follows or private collection history.
router.get("/tcg/users/:userId/profile", requireAuth, rateLimit({ name: "davaq-profile", limit: 60, windowSeconds: 60 }), async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const userId = uuid.safeParse(req.params.userId);
  const query = querySchema.safeParse(req.query);
  if (!userId.success || !query.success) {
    res.status(400).json({ error: "invalid", message: "Invalid profile request" });
    return;
  }
  const viewerId = req.dbUser!.id;
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (query.data.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.data.cursor, "base64url").toString("utf8")));
      if (cursor.viewerId !== viewerId || cursor.userId !== userId.data) throw new Error("Cursor scope differs");
    } catch {
      res.status(400).json({ error: "invalid", message: "Invalid profile cursor" });
      return;
    }
  }
  try {
    const user = (await pool.query(
      `SELECT u.id,u.nickname,u.status_message,u.created_at,
       cp.id AS avatar_profile_id,CASE WHEN cp.profile_image_url IS DISTINCT FROM u.profile_image_url THEN cp.profile_image_url ELSE NULL END AS public_avatar_url,cp.metadata AS avatar_metadata,
       (SELECT count(DISTINCT c.card_id)::int FROM tcg_listings l
        JOIN tcg_collection c ON c.id=l.collection_id WHERE l.owner_id=u.id AND ${publicListing}) AS public_cards,
       (SELECT count(*)::int FROM tcg_listings l
        JOIN tcg_collection c ON c.id=l.collection_id WHERE l.owner_id=u.id AND ${publicListing}) AS public_offers,
       (SELECT count(*)::int FROM tcg_card_comments a
        JOIN tcg_card_catalog card ON card.card_id=a.card_id WHERE a.owner_id=u.id) AS comments
       FROM users u
       LEFT JOIN active_character_profiles ap ON ap.user_id=u.id
       LEFT JOIN character_profiles cp ON cp.id=ap.active_profile_id AND cp.owner_user_id=u.id
        AND cp.type='fan' AND cp.status='active' AND cp.archived_at IS NULL
       WHERE u.id=$2 AND ${unblocked}`,
      [viewerId, userId.data],
    )).rows[0];
    if (!user) {
      res.status(404).json({ error: "not_found", message: "Profile not found" });
      return;
    }
    // Select public listing fields explicitly. Never return c.*, request keys,
    // purchase prices, private notes/folders, reservations or trade histories.
    const rows = (await pool.query(
      `SELECT l.id,l.owner_id,u.nickname AS owner_name,l.collection_id,
       c.card_id,c.card_name,c.condition,c.photos,l.quantity,
       LEAST(l.quantity,c.quantity-c.reserved) AS available,l.price,l.mode,
       l.wanted_card_ids,COALESCE((SELECT jsonb_agg(w.card_name) FROM tcg_wants w
         WHERE w.owner_id=l.owner_id AND w.active AND l.wanted_card_ids ? w.card_id),'[]'::jsonb) AS wanted_card_names,
       l.region,l.delivery,l.description,l.status,l.version,l.map_lat,l.map_lng,
       to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
       FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id JOIN users u ON u.id=l.owner_id
       WHERE l.owner_id=$2 AND ${publicListing} AND ${unblocked}
       AND ($3::timestamptz IS NULL OR (l.created_at,l.id)<($3::timestamptz,$4::uuid))
       ORDER BY l.created_at DESC,l.id DESC LIMIT ${pageSize + 1}`,
      [viewerId, userId.data, cursor?.createdAt ?? null, cursor?.id ?? null],
    )).rows;
    const offers = rows.slice(0, pageSize).map(({ cursor_created_at, ...listing }) => listing);
    const last = rows[pageSize - 1];
    const nextCursor = rows.length > pageSize
      ? Buffer.from(JSON.stringify({ v: 1, viewerId, userId: userId.data, createdAt: last.cursor_created_at, id: last.id })).toString("base64url")
      : null;
    res.json({
      id: user.id,
      nickname: user.nickname,
      profileImageUrl: publicDavaqAvatar(user.public_avatar_url, user.avatar_metadata, user.avatar_profile_id ?? user.id),
      statusMessage: user.status_message ?? null,
      createdAt: new Date(user.created_at).toISOString(),
      stats: { publicCards: user.public_cards, publicOffers: user.public_offers, comments: user.comments },
      offers,
      nextCursor,
    });
  } catch (error) {
    logger.error({ err: error }, "DavaQ public profile request failed");
    res.status(503).json({ error: "unavailable", message: "프로필을 잠시 후 다시 확인해 주세요." });
  }
});

export default router;
