import { Router, type IRouter, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { requireAuth } from "../lib/auth";
import { hasAdminRole } from "../lib/adminRbac";
import { isKnowledgeAdmin } from "../lib/knowledge/validation";
import { rateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { TcgError } from "../lib/tcgCatalog";
import { createContentReport, inspectContentReport, listContentReports, reviewContentReport } from "../lib/contentReports";
import { publishRealtimeEvent } from "../lib/realtime";

const router: IRouter = Router();
const reason = z.string().trim().refine((value) => [...value].length >= 5 && [...value].length <= 2000);
const handle = (run: RequestHandler): RequestHandler => async (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  try { await run(req, res, next); }
  catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input", message: "입력 내용을 확인해 주세요." }); return; }
    if (error instanceof TcgError) {
      const code = error.status === 404 ? "target_unavailable" : error.status === 429 ? "rate_limited" : error.status === 400 ? "invalid_input" : error.status === 409 ? "already_reviewed" : "forbidden";
      if (error.status === 429) res.set("Retry-After", "3600");
      res.status(error.status).json({ error: code, message: error.message }); return;
    }
    // Do not log report text, inspected messages or request bodies.
    logger.error({ code: (error as { code?: string })?.code }, "Content report request failed");
    res.status(503).json({ error: "unavailable", message: "잠시 후 다시 시도해 주세요." });
  }
};
const moderator: RequestHandler = async (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  try {
    if (!req.dbUser || !(isKnowledgeAdmin(req.dbUser) || await hasAdminRole(req.dbUser.id, ["support", "operations", "super_admin"]))) {
      res.status(403).json({ error: "admin_required", message: "신고 검토 권한이 필요합니다." }); return;
    }
    next();
  } catch { res.status(503).json({ error: "unavailable", message: "잠시 후 다시 시도해 주세요." }); }
};
router.post("/tcg/content-reports", requireAuth, rateLimit({ name: "content-report", limit: 30, windowSeconds: 3600 }), handle(async (req, res) => {
  const input = z.object({ targetType: z.enum(["user", "card_comment", "listing_comment", "message"]), targetId: z.uuid(), reason }).strict().parse(req.body);
  res.status(201).json(await createContentReport(req.dbUser!.id, input));
}));
router.get("/tcg/admin/content-reports", requireAuth, moderator, handle(async (req, res) => {
  const query = z.object({ status: z.enum(["pending", "resolved", "dismissed"]).default("pending"), cursor: z.uuid().optional() }).parse(req.query);
  res.json(await listContentReports(query.status, query.cursor ?? null));
}));
router.get("/tcg/admin/content-reports/:id", requireAuth, moderator, handle(async (req, res) => {
  res.json(await inspectContentReport(z.uuid().parse(req.params.id)));
}));
router.patch("/tcg/admin/content-reports/:id", requireAuth, moderator, handle(async (req, res) => {
  const input = z.object({ status: z.enum(["resolved", "dismissed"]), action: z.enum(["reviewed", "remove_content"]), note: reason }).strict().refine((v) => v.status !== "dismissed" || v.action === "reviewed").parse(req.body);
  const updated = await reviewContentReport(req.dbUser!.id, z.uuid().parse(req.params.id), input);
  if (updated.changedRoom) {
    const { roomId, messageId } = updated.changedRoom;
    // Moderation is committed even if a subscriber is offline or Redis fails.
    void (async () => {
      const members = (await pool.query("SELECT user_id FROM chat_room_members WHERE room_id=$1", [roomId])).rows;
      const userIds = members.map((m) => m.user_id as string);
      await Promise.all(["message.updated", "room.updated"].map((type) => publishRealtimeEvent({ type: type as "message.updated" | "room.updated", userIds, roomId, actorUserId: req.dbUser!.id, data: { messageId, scope: "everyone" } })));
    })().catch(() => logger.warn("Content removal realtime refresh unavailable"));
  }
  const { changedRoom: _, ...response } = updated;
  res.json(response);
}));
export default router;
