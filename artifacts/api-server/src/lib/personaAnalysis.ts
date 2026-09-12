import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { Logger } from "pino";
import { z } from "zod/v4";
import {
  db,
  battleTurnsTable,
  messagesTable,
  personasTable,
  xpEventsTable,
  type Persona,
} from "@workspace/db";
import { getOpenAI } from "./aiClient";
import { ensurePersona } from "./growth";
import { logger as defaultLogger } from "./logger";
import { enqueuePersonaAnalysisOntologySync } from "./ontologySync";

const ANALYSIS_MODEL = "gpt-5-mini";

/** Minimum gap between two successful analyses for one user. */
export const ANALYSIS_COOLDOWN_MS = 10 * 60 * 1000;

/** How many recent items of each kind feed the prompt. Keeps cost bounded. */
const MAX_CHAT = 30;
const MAX_BATTLE = 12;
const MAX_DUNGEON = 12;
const MAX_GROWTH = 20;

/** Skip trivial chat messages so the model sees signal, not "ㅇㅇ" / "ㅋㅋ". */
const MIN_CHAT_CHARS = 4;

/** Need at least this many total items before analysis is worthwhile. */
const MIN_TOTAL_ITEMS = 3;

/** Truncate any single text fed to the model. */
const MAX_ITEM_CHARS = 280;

function clip(s: string, max = MAX_ITEM_CHARS): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

interface CollectedActivity {
  chat: string[];
  battle: string[];
  dungeon: string[];
  growth: string[];
  counts: { chat: number; battle: number; dungeon: number; growth: number };
  total: number;
}

/**
 * Gather a bounded, recent slice of the user's app activity for analysis. Only
 * reads — never mutates. Each source is independently limited and trivially
 * short text is dropped to keep the prompt cheap and meaningful.
 */
export async function collectActivity(userId: string): Promise<CollectedActivity> {
  const [chatRows, battleRows, dungeonRows, growthRows] = await Promise.all([
    db
      .select({ content: messagesTable.content, createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(and(eq(messagesTable.senderId, userId), eq(messagesTable.type, "text"), eq(messagesTable.authorKind, "user")))
      .orderBy(desc(messagesTable.createdAt))
      .limit(MAX_CHAT * 2),
    db
      .select({ content: battleTurnsTable.content, evaluation: battleTurnsTable.evaluation })
      .from(battleTurnsTable)
      .where(eq(battleTurnsTable.speakerId, userId))
      .orderBy(desc(battleTurnsTable.createdAt))
      .limit(MAX_BATTLE),
    db
      .select({
        eventType: xpEventsTable.eventType,
        reason: xpEventsTable.reason,
        metadata: xpEventsTable.metadata,
      })
      .from(xpEventsTable)
      .where(and(eq(xpEventsTable.userId, userId), eq(xpEventsTable.sourceType, "dungeon")))
      .orderBy(desc(xpEventsTable.createdAt))
      .limit(MAX_DUNGEON),
    db
      .select({
        reason: xpEventsTable.reason,
        statChanges: xpEventsTable.statChanges,
        createdAt: xpEventsTable.createdAt,
      })
      .from(xpEventsTable)
      .where(eq(xpEventsTable.userId, userId))
      .orderBy(desc(xpEventsTable.createdAt))
      .limit(MAX_GROWTH),
  ]);

  const chat = chatRows
    .map((r) => clip(r.content))
    .filter((c) => c.length >= MIN_CHAT_CHARS)
    .slice(0, MAX_CHAT);

  const battle = battleRows.map((r) => {
    const total = r.evaluation?.total;
    const score = typeof total === "number" ? ` (심판 점수 ${total}/40)` : "";
    return `${clip(r.content)}${score}`;
  });

  const dungeon = dungeonRows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const action = typeof meta.action === "string" ? meta.action : null;
    const goal = typeof meta.goal === "string" ? meta.goal : null;
    if (r.eventType === "dungeon_result" && goal) return `목표 달성: ${clip(goal)}`;
    if (action) return `행동: ${clip(action)}`;
    return r.reason ?? "성장RPG 활동";
  });

  const growth = growthRows.map((r) => {
    const changes = r.statChanges
      ? Object.entries(r.statChanges)
          .filter(([, v]) => (v ?? 0) !== 0)
          .map(([k, v]) => `${k}+${v}`)
          .join(",")
      : "";
    return `${r.reason ?? "성장"}${changes ? ` [${changes}]` : ""}`;
  });

  const counts = {
    chat: chat.length,
    battle: battle.length,
    dungeon: dungeon.length,
    growth: growth.length,
  };
  return {
    chat,
    battle,
    dungeon,
    growth,
    counts,
    total: counts.chat + counts.battle + counts.dungeon + counts.growth,
  };
}

const SYSTEM_PROMPT = [
  "당신은 소셜 앱 'DavaQ'의 인격 분석 도우미입니다.",
  "당신의 임무는 사용자가 앱 안에서 남긴 활동을 바탕으로, 그 사람의 '또 다른 자아(분신)'를 성장형 관점에서 부드럽게 묘사하는 것입니다.",
  "",
  "절대 규칙:",
  "- 아래 활동 데이터는 사용자의 전체 인격이 아니라 앱 안에서 관찰된 일부 행동입니다. 따라서 모든 설명은 '추정' 또는 '경향'으로 표현해야 합니다.",
  "- 부족한 데이터는 '데이터 부족'이라고 표시하세요.",
  "- 이것은 확정적인 심리 진단이 아닙니다. 단정적인 표현을 피하세요.",
  "- 정치 성향, 종교, 건강/질병, 성적 지향, 범죄 이력 같은 민감한 속성은 추정하거나 단정하지 마세요. 관련 내용은 다루지 마세요.",
  "- 사용자를 낙인찍거나 모욕하지 말고, 항상 따뜻하고 성장 지향적인 어조로 작성하세요.",
  "- 각 항목은 모바일 화면에서 읽기 좋게 1~2문장으로 짧게 요약하세요.",
  "- 모든 출력은 한국어로 작성하세요.",
  "- 반드시 지정된 JSON 형식으로만 답하세요.",
].join("\n");

function buildUserPrompt(data: CollectedActivity): string {
  const section = (title: string, items: string[]) =>
    items.length > 0
      ? `## ${title} (${items.length}개)\n${items.map((s) => `- ${s}`).join("\n")}`
      : `## ${title}\n(데이터 부족)`;

  return [
    "다음은 한 사용자의 최근 앱 활동입니다. 이를 바탕으로 분신의 인격을 추정해 주세요.",
    "",
    section("최근 채팅 메시지", data.chat),
    "",
    section("최근 토크배틀 발언/결과", data.battle),
    "",
    section("최근 성장RPG 행동/결과", data.dungeon),
    "",
    section("최근 성장 기록", data.growth),
    "",
    "각 필드를 한국어로 1~2문장씩 작성하고, 근거가 부족한 필드는 '데이터 부족'이라고 적으세요.",
    "confidence는 0.0~1.0 사이로, 데이터 양과 일관성에 따른 분석 신뢰도를 나타냅니다.",
  ].join("\n");
}

/** Shape the model must return. Mirrors the requested JSON contract. */
export const analysisResultSchema = z.object({
  persona_summary: z.string().min(1),
  language_style: z.string().min(1),
  personality_traits: z.string().min(1),
  values_beliefs: z.string().min(1),
  knowledge_domains: z.string().min(1),
  emotional_patterns: z.string().min(1),
  decision_style: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    persona_summary: { type: "string" },
    language_style: { type: "string" },
    personality_traits: { type: "string" },
    values_beliefs: { type: "string" },
    knowledge_domains: { type: "string" },
    emotional_patterns: { type: "string" },
    decision_style: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "persona_summary",
    "language_style",
    "personality_traits",
    "values_beliefs",
    "knowledge_domains",
    "emotional_patterns",
    "decision_style",
    "confidence",
  ],
} as const;

/**
 * Isolated OpenAI call. Returns a validated result or null on any failure
 * (network, empty content, unparseable JSON, schema mismatch). Never throws for
 * a bad model response — only `getOpenAI()` may throw when no key is set, which
 * the caller catches separately to distinguish "no key" from "AI failed".
 */
async function callAnalysisAI(
  data: CollectedActivity,
  log: Logger,
): Promise<AnalysisResult | null> {
  const completion = await getOpenAI().chat.completions.create({
    model: ANALYSIS_MODEL,
    max_completion_tokens: 2000,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(data) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "persona_analysis", strict: true, schema: RESPONSE_JSON_SCHEMA },
    },
  });

  const choice = completion.choices[0];
  const raw = choice?.message?.content;
  if (!raw) {
    log.error(
      { finishReason: choice?.finish_reason, usage: completion.usage },
      "Persona analysis AI returned empty content",
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error({ err, rawLength: raw.length }, "Persona analysis JSON parse failed");
    return null;
  }

  const validated = analysisResultSchema.safeParse(parsed);
  if (!validated.success) {
    log.error({ issues: validated.error.issues }, "Persona analysis failed Zod validation");
    return null;
  }
  return validated.data;
}

export type AnalyzeOutcome =
  | { ok: true; persona: Persona }
  | { ok: false; code: "cooldown"; retryAfterSec: number }
  | { ok: false; code: "no_api_key" }
  | { ok: false; code: "insufficient_data" }
  | { ok: false; code: "ai_failed" };

/**
 * Run an on-demand AI analysis for a user and persist the qualitative fields.
 *
 * Safety: this is invoked only from the explicit analyze endpoint (never per
 * message). It enforces a per-user cooldown, returns a friendly code when the
 * API key is missing, and on ANY AI failure it leaves the existing persona
 * analysis untouched (no partial ontology writes). It only refreshes
 * `lastAnalyzedAt` for cooldown and sends the model result to the ontology
 * outbox — it never touches level, xp, stats, or the xp_events log.
 */
export async function analyzePersona(
  userId: string,
  log: Logger = defaultLogger,
): Promise<AnalyzeOutcome> {
  const persona = await ensurePersona(userId);
  if (!persona) return { ok: false, code: "ai_failed" };

  // Fast, friendly pre-check (gives an accurate retry time without a write).
  if (persona.lastAnalyzedAt) {
    const elapsed = Date.now() - persona.lastAnalyzedAt.getTime();
    if (elapsed < ANALYSIS_COOLDOWN_MS) {
      return {
        ok: false,
        code: "cooldown",
        retryAfterSec: Math.ceil((ANALYSIS_COOLDOWN_MS - elapsed) / 1000),
      };
    }
  }

  // Collect first (read-only) so an "insufficient data" result never consumes
  // the cooldown slot.
  const data = await collectActivity(userId);
  if (data.total < MIN_TOTAL_ITEMS) {
    return { ok: false, code: "insufficient_data" };
  }

  // Atomically claim the cooldown slot BEFORE the (costly) AI call. The
  // conditional UPDATE only matches a row whose cooldown has elapsed, so two
  // concurrent requests can never both proceed — the row lock serializes them
  // and the loser matches zero rows. We remember the previous timestamp so we
  // can release the slot if the analysis ultimately fails.
  const previousLastAnalyzedAt = persona.lastAnalyzedAt;
  const cutoff = new Date(Date.now() - ANALYSIS_COOLDOWN_MS);
  const claimed = await db
    .update(personasTable)
    .set({ lastAnalyzedAt: new Date() })
    .where(
      and(
        eq(personasTable.userId, userId),
        or(isNull(personasTable.lastAnalyzedAt), lt(personasTable.lastAnalyzedAt, cutoff)),
      ),
    )
    .returning({ id: personasTable.id });

  if (claimed.length === 0) {
    // Lost a concurrent race — another request just claimed the slot.
    return { ok: false, code: "cooldown", retryAfterSec: Math.ceil(ANALYSIS_COOLDOWN_MS / 1000) };
  }

  // Release the claimed slot so a failed analysis does not lock the user out for
  // the full cooldown.
  const releaseSlot = async () => {
    try {
      await db
        .update(personasTable)
        .set({ lastAnalyzedAt: previousLastAnalyzedAt ?? null })
        .where(eq(personasTable.userId, userId));
    } catch (err) {
      log.error({ err, userId }, "Failed to release persona analysis cooldown slot");
    }
  };

  let result: AnalysisResult | null;
  try {
    result = await callAnalysisAI(data, log);
  } catch (err) {
    await releaseSlot();
    // getOpenAI() throws when no key is configured — surface as a friendly code.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("API key")) {
      return { ok: false, code: "no_api_key" };
    }
    log.error({ err, userId }, "Persona analysis AI call threw");
    return { ok: false, code: "ai_failed" };
  }

  if (!result) {
    await releaseSlot();
    return { ok: false, code: "ai_failed" };
  }

  // Do not persist legacy AI-analysis detail fields anymore. The model output is
  // used only as ontology evidence through the outbox job below.
  const [updated] = await db
    .update(personasTable)
    .set({
      lastAnalyzedAt: new Date(),
    })
    .where(eq(personasTable.userId, userId))
    .returning();

  if (!updated) {
    await releaseSlot();
    return { ok: false, code: "ai_failed" };
  }
  const analyzedAt = updated.lastAnalyzedAt ?? new Date();
  await enqueuePersonaAnalysisOntologySync({
    userId,
    analysisId: analyzedAt.toISOString(),
    analyzedAt: analyzedAt.toISOString(),
    summary: result.persona_summary,
    languageStyle: result.language_style,
    personalityTraits: result.personality_traits,
    valuesBeliefs: result.values_beliefs,
    knowledgeDomains: result.knowledge_domains,
    emotionalPatterns: result.emotional_patterns,
    decisionStyle: result.decision_style,
    confidence: result.confidence,
    dataCounts: data.counts,
    model: ANALYSIS_MODEL,
    log,
  });

  return { ok: true, persona: updated };
}
