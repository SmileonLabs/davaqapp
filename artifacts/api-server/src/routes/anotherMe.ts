import { Router, type IRouter, type Response } from "express";
import { z } from "zod/v4";
import {
  AnotherMeError,
  dismissAnotherMeSession,
  generateAnotherMeToneProfile,
  getAnotherMeRoomSettings,
  getAnotherMeSettings,
  getAnotherMeSummonStatus,
  summonAnotherMe,
  updateAnotherMeRoomSettings,
  updateAnotherMeSettings,
} from "../lib/anotherMe";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();

const toneLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const relationshipTypeSchema = z.enum(["FRIEND", "FAMILY", "WORK", "PARTNER", "UNKNOWN", "CUSTOM"]);

const settingsPatchSchema = z.object({
  summonEnabled: z.boolean().optional(),
  defaultWaitMinutes: z.number().int().min(1).max(60).optional(),
  allowFriends: z.boolean().optional(),
  allowFamily: z.boolean().optional(),
  allowWork: z.boolean().optional(),
  allowUnknown: z.boolean().optional(),
  autoReplyEnabled: z.boolean().optional(),
  sensitiveReplyBlocked: z.boolean().optional(),
  toneSyncEnabled: z.boolean().optional(),
  defaultToneSyncLevel: toneLevelSchema.optional(),
});

const roomSettingsPatchSchema = z.object({
  summonEnabled: z.boolean().nullable().optional(),
  waitMinutes: z.number().int().min(1).max(60).nullable().optional(),
  toneSyncLevel: toneLevelSchema.nullable().optional(),
  relationshipType: relationshipTypeSchema.optional(),
  autoReplyLevel: z.string().trim().min(1).max(40).optional(),
});

const summonSchema = z.object({
  roomId: z.string().uuid(),
  targetUserId: z.string().uuid(),
});

const toneProfileSchema = z.object({
  relationshipType: relationshipTypeSchema.default("FRIEND"),
});

function sendAnotherMeError(res: Response, err: unknown): void {
  if (!(err instanceof AnotherMeError)) {
    res.status(500).json({ error: "internal", message: "DavaQ 처리 중 오류가 발생했어요." });
    return;
  }
  if (err.code === "not_member" || err.code === "not_found") {
    res.status(404).json({ error: err.code, message: err.message, ...err.details });
    return;
  }
  if (err.code === "forbidden" || err.code === "not_allowed") {
    res.status(403).json({ error: err.code, message: err.message, ...err.details });
    return;
  }
  if (err.code === "waiting" || err.code === "already_active") {
    res.status(409).json({ error: err.code, message: err.message, ...err.details });
    return;
  }
  res.status(400).json({ error: err.code, message: err.message, ...err.details });
}

router.get("/another-me/settings", requireAuth, async (req, res): Promise<void> => {
  res.json(await getAnotherMeSettings(req.dbUser!.id));
});

router.patch("/another-me/settings", requireAuth, async (req, res): Promise<void> => {
  const parsed = settingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "설정 값을 확인해 주세요." });
    return;
  }
  try {
    res.json(await updateAnotherMeSettings(req.dbUser!.id, parsed.data));
  } catch (err) {
    sendAnotherMeError(res, err);
  }
});

router.get("/another-me/rooms/:roomId/settings", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await getAnotherMeRoomSettings(req.dbUser!.id, String(req.params.roomId)));
  } catch (err) {
    sendAnotherMeError(res, err);
  }
});

router.patch("/another-me/rooms/:roomId/settings", requireAuth, async (req, res): Promise<void> => {
  const parsed = roomSettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "채팅방 설정 값을 확인해 주세요." });
    return;
  }
  try {
    res.json(await updateAnotherMeRoomSettings(req.dbUser!.id, String(req.params.roomId), parsed.data));
  } catch (err) {
    sendAnotherMeError(res, err);
  }
});

router.get("/another-me/summon/status", requireAuth, async (req, res): Promise<void> => {
  const roomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
  const targetUserId = typeof req.query.targetUserId === "string" ? req.query.targetUserId : "";
  const parsed = summonSchema.safeParse({ roomId, targetUserId });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "roomId와 targetUserId가 필요합니다." });
    return;
  }
  try {
    res.json(await getAnotherMeSummonStatus(req.dbUser!.id, parsed.data.roomId, parsed.data.targetUserId));
  } catch (err) {
    sendAnotherMeError(res, err);
  }
});

router.post("/another-me/summon", requireAuth, rateLimit({ name: "another-me-summon-minute", limit: 10, windowSeconds: 60, requireRedis: true }), rateLimit({ name: "another-me-summon-daily", limit: 100, windowSeconds: 86400, requireRedis: true }), async (req, res): Promise<void> => {
  const parsed = summonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "소환할 대상을 확인해 주세요." });
    return;
  }
  try {
    res.status(201).json(await summonAnotherMe(req.dbUser!.id, parsed.data, req.log));
  } catch (err) {
    req.log.error({ err }, "DavaQ summon failed");
    sendAnotherMeError(res, err);
  }
});

router.post("/another-me/summon/:sessionId/dismiss", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await dismissAnotherMeSession(req.dbUser!.id, String(req.params.sessionId), req.log));
  } catch (err) {
    sendAnotherMeError(res, err);
  }
});

router.post("/another-me/tone-profile/generate", requireAuth, rateLimit({ name: "tone-profile-minute", limit: 5, windowSeconds: 60, requireRedis: true }), rateLimit({ name: "tone-profile-daily", limit: 30, windowSeconds: 86400, requireRedis: true }), async (req, res): Promise<void> => {
  const parsed = toneProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "말투 프로필 설정을 확인해 주세요." });
    return;
  }
  res.json(await generateAnotherMeToneProfile(req.dbUser!.id, parsed.data.relationshipType));
});

export default router;
