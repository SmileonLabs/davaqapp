import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { ensurePersona, levelProgress, recentGrowthEvents } from "../lib/growth";
import { analyzePersona } from "../lib/personaAnalysis";
import { getPersonaCard } from "../lib/personaIdentity";
import { getPersonaOntologyProfile } from "../lib/personaOntology";
import {
  getRankings,
  getServiceRankings,
  ARCHETYPE_KEYS,
  RANKING_TYPES,
  SERVICE_RANKING_SCOPES,
  RANKING_LIMIT_DEFAULT,
  type ArchetypeKey,
  type RankingType,
  type ServiceRankingScope,
} from "../lib/ranking";
import type { Persona } from "@workspace/db";

const router: IRouter = Router();

/** Serialize FAN growth plus the ontology profile. Legacy AI analysis fields are intentionally not exposed. */
async function serializePersona(persona: Persona) {
  const progress = levelProgress(persona.xp);
  const [events, ontologyProfile] = await Promise.all([
    recentGrowthEvents(persona.userId, 20),
    getPersonaOntologyProfile(persona.userId),
  ]);
  return {
    id: persona.id,
    userId: persona.userId,
    level: progress.level,
    xp: persona.xp,
    xpIntoLevel: progress.xpIntoLevel,
    xpForNextLevel: progress.xpForNextLevel,
    stats: persona.stats,
    recentEvents: events.map((e) => ({
      id: e.id,
      sourceType: e.sourceType,
      eventType: e.eventType,
      sourceId: e.sourceId ?? null,
      expDelta: e.expDelta,
      statChanges: e.statChanges ?? {},
      reason: e.reason ?? null,
      beforeLevel: e.beforeLevel,
      afterLevel: e.afterLevel,
      beforeExp: e.beforeExp,
      afterExp: e.afterExp,
      createdAt: e.createdAt.toISOString(),
    })),
    lastAnalyzedAt: persona.lastAnalyzedAt ? persona.lastAnalyzedAt.toISOString() : null,
    ontologyProfile,
    createdAt: persona.createdAt.toISOString(),
  };
}

router.get("/users/me/persona", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;
  const persona = await ensurePersona(user.id);
  if (!persona) {
    res.status(500).json({ error: "Failed to load persona" });
    return;
  }
  res.json(await serializePersona(persona));
});

/**
 * The Persona Card is ontology-only. If no ontology snapshot exists yet, return
 * 404 so stale legacy persona values cannot look like a valid DavaQ state.
 */
router.get("/users/me/persona/card", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;
  const displayName = user.nickname?.trim() || "나";
  const card = await getPersonaCard(user.id, displayName);
  if (!card) {
    res.status(404).json({ error: "persona_ontology_not_found", message: "DavaQ ontology profile has not been created yet." });
    return;
  }
  res.json(card);
});

/**
 * On-demand AI analysis. Triggered only by the user pressing "분석 업데이트".
 * Enforces a 10-minute cooldown and degrades gracefully: a missing API key, too
 * little activity, or an AI failure each return a friendly Korean message
 * without ever mutating the existing persona analysis.
 */
router.post("/users/me/persona/analyze", requireAuth, rateLimit({ name: "persona-analyze-minute", limit: 5, windowSeconds: 60, requireRedis: true }), rateLimit({ name: "persona-analyze-daily", limit: 20, windowSeconds: 86400, requireRedis: true }), async (req, res): Promise<void> => {
  const user = req.dbUser!;
  const outcome = await analyzePersona(user.id, req.log);

  if (outcome.ok) {
    res.json(await serializePersona(outcome.persona));
    return;
  }

  switch (outcome.code) {
    case "cooldown":
      res.status(429).json({
        error: "cooldown",
        retryAfterSec: outcome.retryAfterSec,
        message: `분석은 10분에 한 번만 할 수 있어요. 약 ${Math.ceil(
          outcome.retryAfterSec / 60,
        )}분 후에 다시 시도해 주세요.`,
      });
      return;
    case "no_api_key":
      res.status(503).json({
        error: "no_api_key",
        message: "지금은 AI 분석을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.",
      });
      return;
    case "insufficient_data":
      res.status(422).json({
        error: "insufficient_data",
        message: "분석할 활동이 아직 부족해요. 채팅·배틀·성장RPG로 조금 더 활동해 보세요.",
      });
      return;
    case "ai_failed":
    default:
      res.status(502).json({
        error: "ai_failed",
        message: "분석에 실패했어요. 잠시 후 다시 시도해 주세요.",
      });
      return;
  }
});

/**
 * Persona leaderboard. Read-only — never mutates XP, AI analysis, or persona-card
 * history. Supports overall, per-stat, and per-archetype rankings. Exposes only
 * non-sensitive fields (name, avatar, level, title, archetype, score, primary
 * stat); no AI detail, chat/battle/dungeon content, or contact info is returned.
 */
router.get("/users/persona/rankings", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;

  const rawType = String(req.query.type ?? "overall");
  const type: RankingType = (RANKING_TYPES as readonly string[]).includes(rawType)
    ? (rawType as RankingType)
    : "overall";

  const rawArchetype = req.query.archetype ? String(req.query.archetype) : null;
  const archetype: ArchetypeKey | null =
    rawArchetype && (ARCHETYPE_KEYS as readonly string[]).includes(rawArchetype)
      ? (rawArchetype as ArchetypeKey)
      : null;

  const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : RANKING_LIMIT_DEFAULT;

  const result = await getRankings({ type, archetype, limit, meUserId: user.id });
  res.json(result);
});

/** Unified personal ranking for the current service structure: persona, FAN, STAR, and talk-battle. */
router.get("/users/rankings", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;

  const rawScope = String(req.query.scope ?? "fan");
  const scope: ServiceRankingScope = (SERVICE_RANKING_SCOPES as readonly string[]).includes(rawScope)
    ? (rawScope as ServiceRankingScope)
    : "persona";

  const rawArchetype = req.query.archetype ? String(req.query.archetype) : null;
  const archetype: ArchetypeKey | null =
    rawArchetype && (ARCHETYPE_KEYS as readonly string[]).includes(rawArchetype)
      ? (rawArchetype as ArchetypeKey)
      : null;

  const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : RANKING_LIMIT_DEFAULT;

  res.json(
    await getServiceRankings({
      scope,
      type: req.query.type ? String(req.query.type) : null,
      archetype,
      limit,
      meUserId: user.id,
    }),
  );
});

export default router;
