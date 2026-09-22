import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { handle } from "./exchange";
import { categories } from "../lib/exchangeRules";
import { coordinateInput, searchBounds } from "../lib/geoRules";
import { listingDto } from "../lib/exchangeService";
const router: IRouter = Router();
router.use("/exchange/map", requireAuth);
router.get(
  "/exchange/map/config",
  handle(async (_req, res) => {
    const configured = process.env.DAVAQ_MAP_TILE_URL;
    const tileUrl =
      configured && /^https:\/\/[^/]+\/.+\{z\}.+/.test(configured)
        ? configured
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    res.json({
      tileUrl,
      attribution:
        process.env.DAVAQ_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors",
    });
  }),
);
const inputSchema = coordinateInput
  .extend({
    radiusKm: z.number().min(1).max(50).default(5),
    q: z.string().trim().max(80).default(""),
    mode: z.enum(["offer", "want"]).default("offer"),
    kind: z.enum(["goods", "service", "experience"]).optional(),
    category: z.enum(categories).optional(),
  })
  .strict();
router.post(
  "/exchange/map/search",
  rateLimit({ name: "map-search", limit: 60, windowSeconds: 60 }),
  handle(async (req, res) => {
    const i = inputSchema.parse(req.body),
      lat = Number(i.lat.toFixed(2)),
      lng = Number(i.lng.toFixed(2)),
      b = searchBounds(lat, lng, i.radiusKm);
    const params: any[] = [
      req.dbUser!.id,
      lat,
      lng,
      i.radiusKm,
      b.south,
      b.north,
      b.deltaLng,
      i.mode,
    ];
    const conditions = [
      "l.status='published'",
      "l.delivery<>'online'",
      "l.map_lat IS NOT NULL",
      "l.map_lat BETWEEN $5 AND $6",
      "(abs(l.map_lng-$3)<=$7 OR abs(l.map_lng-$3)>=360-$7)",
      "l.mode=$8",
      "NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=l.owner_id))",
      "NOT EXISTS(SELECT 1 FROM exchange_reservations r WHERE r.active AND r.listing_id=l.id AND l.kind='goods')",
      "NOT EXISTS(SELECT 1 FROM exchange_relay_reservations r WHERE r.active AND r.listing_id=l.id AND l.kind='goods')",
    ];
    const bind = (v: any) => {
      params.push(v);
      return "$" + params.length;
    };
    if (i.q) {
      const p = bind("%" + i.q.replace(/[\\%_]/g, "\\$&") + "%");
      conditions.push(`(l.title ILIKE ${p} OR l.description ILIKE ${p})`);
    }
    if (i.kind) conditions.push("l.kind=" + bind(i.kind));
    if (i.category) conditions.push("l.category=" + bind(i.category));
    const rows = (
      await pool.query(
        `WITH nearby AS (SELECT l.*,u.nickname owner_name,EXISTS(SELECT 1 FROM exchange_favorites f WHERE f.user_id=$1 AND f.listing_id=l.id) favorite,
  6371*2*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(l.map_lat-$2)/2),2)+cos(radians($2))*cos(radians(l.map_lat))*power(sin(radians(l.map_lng-$3)/2),2))))) distance_km
  FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE ${conditions.join(" AND ")}) SELECT * FROM nearby WHERE distance_km<=$4 ORDER BY distance_km,id LIMIT 81`,
        params,
      )
    ).rows;
    res.json({
      items: rows
        .slice(0, 80)
        .map((r) => ({
          ...listingDto(r),
          distanceKm: Math.round(Number(r.distance_km) * 10) / 10,
        })),
      limited: rows.length > 80,
      center: { lat, lng },
      radiusKm: i.radiusKm,
    });
  }),
);
export default router;
