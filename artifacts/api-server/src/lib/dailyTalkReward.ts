import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { z } from "zod/v4";
import {
  dailyTalkRewardsTable,
  db,
  friendshipsTable,
  ontologySyncJobsTable,
  starFeedPostsTable,
  usersTable,
  type DailyTalkReward,
  type DailyTalkRewardAbuseSignals,
  type DailyTalkRewardScores,
  type DailyTalkRewardVisibility,
  type OntologySyncJob,
} from "@workspace/db";
import { getOpenAI } from "./aiClient";
import { logger as defaultLogger } from "./logger";
import { dailyTalkRewardOntologySourceKey, enqueueOntologySyncJob, type DailyTalkRewardOntologyPayload } from "./ontologySync";
import { grantPvtInTransaction } from "./pvt";

const TALK_REWARD_MODEL = "gpt-5-mini";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIN_MESSAGE_COUNT = 10;
const MAX_PROMPT_MESSAGES = 120;
const MAX_PROMPT_CHARS_PER_MESSAGE = 220;
const MAX_DIARY_CHARS = 1200;
const MAX_TITLE_CHARS = 80;
const MAX_KEYWORDS = 5;

export class DailyTalkRewardError extends Error {
  constructor(
    public code:
      | "analysis_disabled"
      | "already_claimed"
      | "insufficient_messages"
      | "not_found"
      | "not_ready"
      | "no_api_key"
      | "ai_failed"
      | "invalid",
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface RawTalkMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

interface CollectedTalk {
  messages: RawTalkMessage[];
  abuse: DailyTalkRewardAbuseSignals;
}

export interface DailyTalkRewardStatusView {
  canClaim: boolean;
  reason: string | null;
  claimedToday: boolean;
  messageCount: number;
  minMessageCount: number;
  streak: number;
  rewardId: string | null;
  status: string | null;
}

export type DailyTalkRewardOntologySyncStatus = "none" | "pending" | "processing" | "processed" | "retrying" | "failed";

export interface DailyTalkRewardView {
  id: string;
  rewardDate: string;
  status: string;
  title: string;
  mood: string;
  keywords: string[];
  diary: string;
  summary: string;
  scores: DailyTalkRewardScores;
  grade: string;
  qualityScore: number;
  spamRisk: number;
  pvtAmount: number;
  estimatedPvtAmount: number;
  visibility: DailyTalkRewardVisibility;
  feedPostId: string | null;
  abuse: DailyTalkRewardAbuseSignals | null;
  ontologySyncStatus: DailyTalkRewardOntologySyncStatus;
  ontologySyncedAt: string | null;
  rewardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OntologySyncState {
  status: DailyTalkRewardOntologySyncStatus;
  syncedAt: string | null;
}

const aiScoresSchema = z.object({
  empathy: z.number().min(0).max(100),
  communication: z.number().min(0).max(100),
  trust: z.number().min(0).max(100),
  positivity: z.number().min(0).max(100),
  contribution: z.number().min(0).max(100),
  spamRisk: z.number().min(0).max(100),
  qualityScore: z.number().min(0).max(100),
});

const aiResultSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  mood: z.string().min(1).max(40),
  keywords: z.array(z.string().min(1).max(20)).max(MAX_KEYWORDS),
  diary: z.string().min(1).max(MAX_DIARY_CHARS),
  summary: z.string().min(1).max(500),
  scores: aiScoresSchema,
  grade: z.string().min(1).max(4),
  safetyFiltered: z.boolean(),
});

type AiTalkRewardResult = z.infer<typeof aiResultSchema>;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    mood: { type: "string" },
    keywords: { type: "array", items: { type: "string" }, maxItems: MAX_KEYWORDS },
    diary: { type: "string" },
    summary: { type: "string" },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        empathy: { type: "number" },
        communication: { type: "number" },
        trust: { type: "number" },
        positivity: { type: "number" },
        contribution: { type: "number" },
        spamRisk: { type: "number" },
        qualityScore: { type: "number" },
      },
      required: ["empathy", "communication", "trust", "positivity", "contribution", "spamRisk", "qualityScore"],
    },
    grade: { type: "string" },
    safetyFiltered: { type: "boolean" },
  },
  required: ["title", "mood", "keywords", "diary", "summary", "scores", "grade", "safetyFiltered"],
} as const;

const SYSTEM_PROMPT = [
  "You are an AI diary and conversation quality evaluator for DavaQ.",
  "Analyze the user's daily conversations and create a short reflective diary in Korean.",
  "Do not reveal private information, real names, phone numbers, addresses, account numbers, exact locations, or sensitive secrets.",
  "Do not quote original messages directly.",
  "Summarize the emotional tone, communication quality, and relationship contribution.",
  "Evaluate empathy, communication, trust, positivity, contribution, spamRisk, and qualityScore from 0 to 100.",
  "Do not decide the final reward amount. The server calculates PVT Point.",
  "Return strict JSON only.",
].join("\n");

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rewardDateKey(now = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function kstDayRange(dateKey: string): { start: Date; end: Date } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function idempotencyKey(userId: string, dateKey: string): string {
  return `daily_talk_reward:${userId}:${dateKey.replace(/-/g, "")}`;
}

function rowDate(row: DailyTalkReward): string {
  const value = row.rewardDate as unknown;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function ontologySourceKey(rewardId: string): string {
  return dailyTalkRewardOntologySourceKey(rewardId);
}

function ontologyMaxAttempts(): number {
  const value = Number(process.env.ONTOLOGY_SYNC_MAX_ATTEMPTS);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

function syncStateFromJob(job: Pick<OntologySyncJob, "status" | "attempts" | "processedAt"> | undefined | null): OntologySyncState {
  if (!job) return { status: "none", syncedAt: null };
  const status = job.status === "failed" && job.attempts < ontologyMaxAttempts() ? "retrying" : job.status;
  return {
    status,
    syncedAt: job.processedAt?.toISOString() ?? null,
  };
}

async function getOntologySyncState(rewardId: string): Promise<OntologySyncState> {
  const [job] = await db
    .select({ status: ontologySyncJobsTable.status, attempts: ontologySyncJobsTable.attempts, processedAt: ontologySyncJobsTable.processedAt })
    .from(ontologySyncJobsTable)
    .where(eq(ontologySyncJobsTable.sourceKey, ontologySourceKey(rewardId)));
  return syncStateFromJob(job);
}

async function getOntologySyncStates(rewardIds: string[]): Promise<Map<string, OntologySyncState>> {
  if (rewardIds.length === 0) return new Map();
  const keys = rewardIds.map(ontologySourceKey);
  const rows = await db
    .select({ sourceKey: ontologySyncJobsTable.sourceKey, status: ontologySyncJobsTable.status, attempts: ontologySyncJobsTable.attempts, processedAt: ontologySyncJobsTable.processedAt })
    .from(ontologySyncJobsTable)
    .where(inArray(ontologySyncJobsTable.sourceKey, keys));
  const byId = new Map<string, OntologySyncState>();
  for (const row of rows) {
    const rewardId = row.sourceKey.replace(/^daily_talk_reward:/, "").replace(/:persona_ontology$/, "");
    byId.set(rewardId, syncStateFromJob(row));
  }
  return byId;
}

function sanitizeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
    .replace(/\b\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[연락처]")
    .replace(/\b\d{2,6}[-.\s]\d{2,6}[-.\s]\d{2,8}\b/g, "[번호]")
    .replace(/([가-힣A-Za-z0-9]+(로|길)\s?\d{1,4}[^\s]*)/g, "[주소]")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max = MAX_PROMPT_CHARS_PER_MESSAGE): string {
  const safe = sanitizeText(value);
  return safe.length > max ? `${safe.slice(0, max)}...` : safe;
}

function normalizeForRepeat(value: string): string {
  return sanitizeText(value).toLowerCase().replace(/[\sㅋㅎㅠㅜ~!?.。！？.,]/g, "");
}

function computeAbuseSignals(userId: string, messages: RawTalkMessage[]): DailyTalkRewardAbuseSignals {
  const userMessages = messages.filter((message) => message.senderId === userId);
  const otherMessages = messages.filter((message) => message.senderId !== userId);
  const counterpartCount = new Set(otherMessages.map((message) => message.senderId)).size;
  const normalized = userMessages
    .map((message) => normalizeForRepeat(message.content))
    .filter((value) => value.length > 0);
  const uniqueCount = new Set(normalized).size;
  const repeatedMessageRatio = normalized.length > 0 ? 1 - uniqueCount / normalized.length : 0;
  const shortMessageRatio = userMessages.length > 0
    ? userMessages.filter((message) => normalizeForRepeat(message.content).length <= 3).length / userMessages.length
    : 0;
  const selfMessageRatio = messages.length > 0 ? userMessages.length / messages.length : 0;

  const reductions: string[] = [];
  let rewardMultiplier = 1;
  if (counterpartCount < 1 || otherMessages.length < 1) {
    reductions.push("상호작용 부족");
    rewardMultiplier = 0;
  }
  if (repeatedMessageRatio >= 0.5) {
    reductions.push("반복 메시지 비율 높음");
    rewardMultiplier *= repeatedMessageRatio >= 0.75 ? 0.2 : 0.5;
  }
  if (shortMessageRatio >= 0.7) {
    reductions.push("짧은 메시지 비율 높음");
    rewardMultiplier *= 0.5;
  }
  if (selfMessageRatio >= 0.85) {
    reductions.push("본인 메시지 비율 과다");
    rewardMultiplier *= selfMessageRatio >= 0.95 ? 0 : 0.5;
  }

  return {
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    otherMessageCount: otherMessages.length,
    counterpartCount,
    repeatedMessageRatio,
    shortMessageRatio,
    selfMessageRatio,
    rewardMultiplier,
    reductions,
  };
}

async function collectDailyTalk(userId: string, dateKey: string): Promise<CollectedTalk> {
  const { start, end } = kstDayRange(dateKey);
  const result = await db.execute(sql`
    SELECT
      m.id,
      m.room_id AS "roomId",
      m.sender_id AS "senderId",
      m.content,
      m.created_at AS "createdAt"
    FROM messages m
    INNER JOIN chat_room_members mine
      ON mine.room_id = m.room_id AND mine.user_id = ${userId}
    INNER JOIN chat_rooms r
      ON r.id = m.room_id
    INNER JOIN users sender
      ON sender.id = m.sender_id
    WHERE m.created_at >= ${start}
      AND m.created_at < ${end}
      AND m.type = 'text'
      AND coalesce(m.author_kind, 'user') = 'user'
      AND m.deleted_at IS NULL
      AND r.type IN ('direct', 'group')
      AND coalesce(sender.clerk_id, '') NOT LIKE 'system:%'
      AND NOT EXISTS (
        SELECT 1 FROM message_deletions md
        WHERE md.message_id = m.id AND md.user_id = ${userId}
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocked_users b
        WHERE (b.blocker_user_id = ${userId} AND b.blocked_user_id = m.sender_id)
           OR (b.blocker_user_id = m.sender_id AND b.blocked_user_id = ${userId})
      )
    ORDER BY m.created_at ASC
    LIMIT 300
  `);
  const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
  const messages = rows.map((row) => ({
    id: String(row.id),
    roomId: String(row.roomId),
    senderId: String(row.senderId),
    content: String(row.content ?? ""),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
  }));
  return { messages, abuse: computeAbuseSignals(userId, messages) };
}

function buildUserPrompt(userId: string, messages: RawTalkMessage[], abuse: DailyTalkRewardAbuseSignals): string {
  const counterpartLabels = new Map<string, string>();
  let next = 1;
  const lines = messages.slice(-MAX_PROMPT_MESSAGES).map((message) => {
    const speaker = message.senderId === userId
      ? "나"
      : counterpartLabels.get(message.senderId) ?? `상대${next++}`;
    if (message.senderId !== userId && !counterpartLabels.has(message.senderId)) {
      counterpartLabels.set(message.senderId, speaker);
    }
    const time = message.createdAt.toISOString().slice(11, 16);
    return `[${time}] ${speaker}: ${clip(message.content)}`;
  });

  return [
    "다음은 사용자가 오늘 DavaQ 메신저에서 나눈 대화입니다.",
    "실명/전화번호/주소/계좌번호/상세 위치/민감정보/원문 직접 인용은 일기에 포함하지 마세요.",
    "상대 이름은 친구, 가까운 사람, 동료, 지인처럼 일반화하세요.",
    "대화의 양보다 공감력, 소통력, 신뢰도, 긍정성, 관계 기여도, 스팸/반복 위험도를 평가하세요.",
    "",
    `메시지 수: ${abuse.messageCount}`,
    `실제 대화 상대 수: ${abuse.counterpartCount}`,
    `반복 비율: ${Math.round(abuse.repeatedMessageRatio * 100)}%`,
    `짧은 메시지 비율: ${Math.round(abuse.shortMessageRatio * 100)}%`,
    "",
    "대화:",
    ...lines,
  ].join("\n");
}

async function callTalkRewardAI(
  userId: string,
  messages: RawTalkMessage[],
  abuse: DailyTalkRewardAbuseSignals,
  log: Logger,
): Promise<AiTalkRewardResult | null> {
  const completion = await getOpenAI().chat.completions.create({
    model: TALK_REWARD_MODEL,
    max_completion_tokens: 2500,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(userId, messages, abuse) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "daily_talk_reward", strict: true, schema: RESPONSE_JSON_SCHEMA },
    },
  });

  const choice = completion.choices[0];
  const raw = choice?.message?.content;
  if (!raw) {
    log.error({ finishReason: choice?.finish_reason, usage: completion.usage }, "Talk reward AI returned empty content");
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error({ err, rawLength: raw.length }, "Talk reward AI JSON parse failed");
    return null;
  }

  const validated = aiResultSchema.safeParse(parsed);
  if (!validated.success) {
    log.error({ issues: validated.error.issues }, "Talk reward AI failed Zod validation");
    return null;
  }
  return validated.data;
}

export function computeQualityScore(scores: Omit<DailyTalkRewardScores, "qualityScore">): number {
  return clampScore(
    scores.empathy * 0.25 +
      scores.communication * 0.25 +
      scores.trust * 0.2 +
      scores.positivity * 0.15 +
      scores.contribution * 0.15,
  );
}

function basePvtForQuality(qualityScore: number): number {
  if (qualityScore < 40) return 0;
  if (qualityScore < 50) return 3;
  if (qualityScore < 60) return 5;
  if (qualityScore < 70) return 10;
  if (qualityScore < 80) return 20;
  if (qualityScore < 90) return 35;
  return 50;
}

export function calculatePvtAmount(scores: DailyTalkRewardScores, abuse: DailyTalkRewardAbuseSignals): number {
  if (scores.spamRisk >= 80) return 0;
  let amount = basePvtForQuality(scores.qualityScore);
  if (scores.spamRisk >= 60) amount = Math.floor(amount * 0.2);
  else if (scores.spamRisk >= 30) amount = Math.floor(amount * 0.5);
  amount = Math.floor(amount * abuse.rewardMultiplier);
  return Math.max(0, Math.min(50, amount));
}

function normalizeScores(aiScores: DailyTalkRewardScores): DailyTalkRewardScores {
  const partial = {
    empathy: clampScore(aiScores.empathy),
    communication: clampScore(aiScores.communication),
    trust: clampScore(aiScores.trust),
    positivity: clampScore(aiScores.positivity),
    contribution: clampScore(aiScores.contribution),
    spamRisk: clampScore(aiScores.spamRisk),
  };
  return { ...partial, qualityScore: computeQualityScore(partial) };
}

function fallbackScores(abuse: DailyTalkRewardAbuseSignals): DailyTalkRewardScores {
  const spamRisk = abuse.rewardMultiplier === 0
    ? 90
    : clampScore(abuse.repeatedMessageRatio * 45 + abuse.shortMessageRatio * 35 + Math.max(0, abuse.selfMessageRatio - 0.7) * 100);
  const base = spamRisk >= 80 ? 25 : 45;
  return {
    empathy: base,
    communication: base,
    trust: base,
    positivity: base,
    contribution: base,
    spamRisk,
    qualityScore: base,
  };
}

export function serializeDailyTalkReward(row: DailyTalkReward, sync?: OntologySyncState): DailyTalkRewardView {
  const scores = row.scoresJson ?? fallbackScores(row.abuseJson ?? {
    messageCount: 0,
    userMessageCount: 0,
    otherMessageCount: 0,
    counterpartCount: 0,
    repeatedMessageRatio: 0,
    shortMessageRatio: 0,
    selfMessageRatio: 0,
    rewardMultiplier: 0,
    reductions: [],
  });
  return {
    id: row.id,
    rewardDate: rowDate(row),
    status: row.status,
    title: row.title ?? "오늘의 대화 일기",
    mood: row.mood ?? "차분함",
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    diary: row.diary ?? "",
    summary: row.summary ?? "",
    scores,
    grade: row.grade ?? "-",
    qualityScore: row.qualityScore,
    spamRisk: row.spamRisk,
    pvtAmount: row.pvtAmount,
    estimatedPvtAmount: row.pvtAmount,
    visibility: row.visibility,
    feedPostId: row.feedPostId ?? null,
    abuse: row.abuseJson ?? null,
    ontologySyncStatus: sync?.status ?? "none",
    ontologySyncedAt: sync?.syncedAt ?? null,
    rewardedAt: row.rewardedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function enqueueDailyTalkRewardOntology(row: DailyTalkReward): Promise<void> {
  const scores = row.scoresJson ?? fallbackScores(row.abuseJson ?? {
    messageCount: 0,
    userMessageCount: 0,
    otherMessageCount: 0,
    counterpartCount: 0,
    repeatedMessageRatio: 0,
    shortMessageRatio: 0,
    selfMessageRatio: 0,
    rewardMultiplier: 0,
    reductions: [],
  });

  const payload: DailyTalkRewardOntologyPayload = {
    kind: "daily_talk_reward",
    userId: row.userId,
    rewardId: row.id,
    rewardDate: rowDate(row),
    title: row.title ?? "오늘의 대화 일기",
    mood: row.mood ?? "차분함",
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    summary: row.summary ?? row.diary ?? "",
    scores,
    abuse: row.abuseJson ?? null,
    pvtAmount: row.pvtAmount,
    consentVersion: "talk_to_earn_sync_v1",
    sourceVersion: "daily_talk_reward_v1",
  };

  await enqueueOntologySyncJob({
    userId: row.userId,
    sourceType: "daily_talk_reward",
    sourceId: row.id,
    sourceKey: ontologySourceKey(row.id),
    payload: payload as unknown as Record<string, unknown>,
  });
}

async function enqueueDailyTalkRewardOntologySafe(row: DailyTalkReward, log: Logger = defaultLogger): Promise<OntologySyncState | null> {
  try {
    await enqueueDailyTalkRewardOntology(row);
    return getOntologySyncState(row.id);
  } catch (err) {
    log.warn({ err, rewardId: row.id, userId: row.userId }, "Failed to enqueue daily talk reward ontology sync");
    return null;
  }
}

async function getTodayReward(userId: string, dateKey: string): Promise<DailyTalkReward | null> {
  const [row] = await db
    .select()
    .from(dailyTalkRewardsTable)
    .where(and(eq(dailyTalkRewardsTable.userId, userId), eq(dailyTalkRewardsTable.rewardDate, dateKey)));
  return row ?? null;
}

async function rewardStreak(userId: string, todayKey: string): Promise<number> {
  const rows = await db
    .select({ rewardDate: dailyTalkRewardsTable.rewardDate })
    .from(dailyTalkRewardsTable)
    .where(and(eq(dailyTalkRewardsTable.userId, userId), sql`${dailyTalkRewardsTable.rewardedAt} IS NOT NULL`))
    .orderBy(desc(dailyTalkRewardsTable.rewardDate))
    .limit(60);

  const rewarded = new Set(rows.map((row) => String(row.rewardDate)));
  let streak = 0;
  const cursor = new Date(`${todayKey}T00:00:00.000Z`);
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!rewarded.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export async function getDailyTalkRewardStatus(userId: string, now = new Date()): Promise<DailyTalkRewardStatusView> {
  const [user] = await db
    .select({ talkAnalysisEnabled: usersTable.talkAnalysisEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const dateKey = rewardDateKey(now);
  const [existing, collected, streak] = await Promise.all([
    getTodayReward(userId, dateKey),
    collectDailyTalk(userId, dateKey),
    rewardStreak(userId, dateKey),
  ]);
  const claimedToday = !!existing?.rewardedAt;
  const messageCount = collected.abuse.messageCount;

  let reason: string | null = null;
  if (!user?.talkAnalysisEnabled) reason = "analysis_disabled";
  else if (claimedToday) reason = "claimed";
  else if (messageCount < MIN_MESSAGE_COUNT) reason = "insufficient_messages";
  else if (collected.abuse.counterpartCount < 1) reason = "insufficient_counterparts";

  return {
    canClaim: reason == null,
    reason,
    claimedToday,
    messageCount,
    minMessageCount: MIN_MESSAGE_COUNT,
    streak,
    rewardId: existing?.id ?? null,
    status: existing?.status ?? null,
  };
}

export async function generateDailyTalkReward(
  userId: string,
  log: Logger = defaultLogger,
  now = new Date(),
): Promise<DailyTalkRewardView> {
  const [user] = await db
    .select({ talkAnalysisEnabled: usersTable.talkAnalysisEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user?.talkAnalysisEnabled) {
    throw new DailyTalkRewardError("analysis_disabled", "대화 분석이 꺼져 있어요.");
  }

  const dateKey = rewardDateKey(now);
  const key = idempotencyKey(userId, dateKey);
  await db
    .insert(dailyTalkRewardsTable)
    .values({ userId, rewardDate: dateKey, idempotencyKey: key, status: "PENDING" })
    .onConflictDoNothing({ target: [dailyTalkRewardsTable.userId, dailyTalkRewardsTable.rewardDate] });

  const existing = await getTodayReward(userId, dateKey);
  if (!existing) throw new DailyTalkRewardError("ai_failed", "리워드 초안을 만들지 못했어요.");
  if (existing.rewardedAt) throw new DailyTalkRewardError("already_claimed", "오늘은 이미 리워드를 받았어요.");
  if (existing.status === "GENERATED" && existing.diary) return serializeDailyTalkReward(existing);

  const collected = await collectDailyTalk(userId, dateKey);
  if (collected.abuse.messageCount < MIN_MESSAGE_COUNT || collected.abuse.counterpartCount < 1) {
    await db
      .update(dailyTalkRewardsTable)
      .set({ abuseJson: collected.abuse, updatedAt: new Date() })
      .where(eq(dailyTalkRewardsTable.id, existing.id));
    throw new DailyTalkRewardError("insufficient_messages", "분석할 수 있는 대화가 아직 부족해요.", {
      messageCount: collected.abuse.messageCount,
      minMessageCount: MIN_MESSAGE_COUNT,
    });
  }

  let ai: AiTalkRewardResult | null = null;
  try {
    ai = await callTalkRewardAI(userId, collected.messages, collected.abuse, log);
  } catch (err) {
    if (err instanceof Error && /OpenAI API key is not configured/.test(err.message)) {
      throw new DailyTalkRewardError("no_api_key", "AI 설정이 아직 준비되지 않았어요.");
    }
    throw err;
  }
  if (!ai) {
    await db
      .update(dailyTalkRewardsTable)
      .set({ status: "FAILED", abuseJson: collected.abuse, updatedAt: new Date() })
      .where(eq(dailyTalkRewardsTable.id, existing.id));
    throw new DailyTalkRewardError("ai_failed", "AI 일기를 생성하지 못했어요.");
  }

  const scores = normalizeScores(ai.scores);
  const pvtAmount = calculatePvtAmount(scores, collected.abuse);
  const [updated] = await db
    .update(dailyTalkRewardsTable)
    .set({
      status: "GENERATED",
      title: ai.title.trim(),
      mood: ai.mood.trim(),
      keywords: ai.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, MAX_KEYWORDS),
      diary: ai.diary.trim(),
      summary: ai.summary.trim(),
      scoresJson: scores,
      abuseJson: collected.abuse,
      grade: ai.grade.trim(),
      qualityScore: scores.qualityScore,
      spamRisk: scores.spamRisk,
      pvtAmount,
      visibility: "PRIVATE",
      updatedAt: new Date(),
    })
    .where(and(eq(dailyTalkRewardsTable.id, existing.id), isNull(dailyTalkRewardsTable.rewardedAt)))
    .returning();

  if (!updated) throw new DailyTalkRewardError("already_claimed", "오늘은 이미 리워드를 받았어요.");
  return serializeDailyTalkReward(updated);
}

export async function updateDailyTalkReward(
  userId: string,
  rewardId: string,
  input: { title?: string; diary?: string; visibility?: DailyTalkRewardVisibility },
): Promise<DailyTalkRewardView> {
  const updates: Partial<typeof dailyTalkRewardsTable.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) updates.title = input.title.trim().slice(0, MAX_TITLE_CHARS);
  if (input.diary !== undefined) updates.diary = input.diary.trim().slice(0, MAX_DIARY_CHARS);
  if (input.visibility !== undefined) updates.visibility = input.visibility;

  const [updated] = await db
    .update(dailyTalkRewardsTable)
    .set(updates)
    .where(and(eq(dailyTalkRewardsTable.id, rewardId), eq(dailyTalkRewardsTable.userId, userId), isNull(dailyTalkRewardsTable.rewardedAt)))
    .returning();

  if (!updated) throw new DailyTalkRewardError("not_found", "리워드 일기를 찾을 수 없어요.");
  return serializeDailyTalkReward(updated);
}

async function markRewardedInTransaction(tx: any, row: DailyTalkReward): Promise<DailyTalkReward> {
  const now = new Date();
  const [updated] = await tx
    .update(dailyTalkRewardsTable)
    .set({ status: "REWARDED", rewardedAt: now, updatedAt: now })
    .where(and(eq(dailyTalkRewardsTable.id, row.id), isNull(dailyTalkRewardsTable.rewardedAt)))
    .returning();
  if (!updated) throw new DailyTalkRewardError("already_claimed", "이미 지급된 리워드예요.");

  if (updated.pvtAmount > 0) {
    await grantPvtInTransaction(tx, {
      userId: updated.userId,
      amount: updated.pvtAmount,
      source: "DAILY_TALK_REWARD",
      sourceId: updated.id,
      description: "Talk to Earn 일일 리워드",
    });
  }
  return updated;
}

async function loadRewardForMutation(userId: string, rewardId: string): Promise<DailyTalkReward> {
  const [row] = await db
    .select()
    .from(dailyTalkRewardsTable)
    .where(and(eq(dailyTalkRewardsTable.id, rewardId), eq(dailyTalkRewardsTable.userId, userId)));
  if (!row) throw new DailyTalkRewardError("not_found", "리워드 일기를 찾을 수 없어요.");
  if (!row.diary || !row.title) throw new DailyTalkRewardError("not_ready", "먼저 AI 일기를 생성해 주세요.");
  if (row.rewardedAt) throw new DailyTalkRewardError("already_claimed", "이미 지급된 리워드예요.");
  return row;
}

export async function saveDailyTalkReward(userId: string, rewardId: string, log: Logger = defaultLogger): Promise<DailyTalkRewardView> {
  const row = await loadRewardForMutation(userId, rewardId);
  const rewarded = await db.transaction(async (tx) => markRewardedInTransaction(tx, row));
  const sync = await enqueueDailyTalkRewardOntologySafe(rewarded, log);
  return serializeDailyTalkReward(rewarded, sync ?? undefined);
}

export async function postDailyTalkRewardToFeed(userId: string, rewardId: string, log: Logger = defaultLogger): Promise<DailyTalkRewardView> {
  const row = await loadRewardForMutation(userId, rewardId);
  const rewarded = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(starFeedPostsTable)
      .values({
        authorUserId: userId,
        kind: "talk_diary",
        sourceKey: `daily_talk_reward:${row.id}`,
        title: row.title ?? "오늘의 대화 일기",
        body: row.diary ?? "",
        visibility: row.visibility,
        metadata: {
          type: "talk_diary",
          dailyTalkRewardId: row.id,
          mood: row.mood,
          keywords: row.keywords,
          qualityScore: row.qualityScore,
          pvtAmount: row.pvtAmount,
          aiGenerated: true,
        },
      })
      .onConflictDoNothing({ target: starFeedPostsTable.sourceKey })
      .returning({ id: starFeedPostsTable.id });

    let feedPostId = post?.id ?? row.feedPostId;
    if (!feedPostId) {
      const [existingPost] = await tx
        .select({ id: starFeedPostsTable.id })
        .from(starFeedPostsTable)
        .where(eq(starFeedPostsTable.sourceKey, `daily_talk_reward:${row.id}`));
      feedPostId = existingPost?.id ?? null;
    }
    const [withPost] = await tx
      .update(dailyTalkRewardsTable)
      .set({ status: "POSTED", feedPostId, updatedAt: new Date() })
      .where(and(eq(dailyTalkRewardsTable.id, row.id), isNull(dailyTalkRewardsTable.rewardedAt)))
      .returning();
    if (!withPost) throw new DailyTalkRewardError("already_claimed", "이미 지급된 리워드예요.");
    return markRewardedInTransaction(tx, withPost);
  });
  const sync = await enqueueDailyTalkRewardOntologySafe(rewarded, log);
  return serializeDailyTalkReward(rewarded, sync ?? undefined);
}

export async function listDailyTalkRewardHistory(userId: string): Promise<DailyTalkRewardView[]> {
  const rows = await db
    .select()
    .from(dailyTalkRewardsTable)
    .where(eq(dailyTalkRewardsTable.userId, userId))
    .orderBy(desc(dailyTalkRewardsTable.rewardDate))
    .limit(100);
  const syncStates = await getOntologySyncStates(rows.map((row) => row.id));
  return rows.map((row) => serializeDailyTalkReward(row, syncStates.get(row.id)));
}

export async function getDailyTalkReward(userId: string, rewardId: string): Promise<DailyTalkRewardView> {
  const [row] = await db
    .select()
    .from(dailyTalkRewardsTable)
    .where(and(eq(dailyTalkRewardsTable.id, rewardId), eq(dailyTalkRewardsTable.userId, userId)));
  if (!row) throw new DailyTalkRewardError("not_found", "리워드 일기를 찾을 수 없어요.");
  return serializeDailyTalkReward(row, await getOntologySyncState(row.id));
}

export async function hasFriendship(userId: string, otherUserId: string): Promise<boolean> {
  const [friendship] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      sql`(${friendshipsTable.userAId} = ${userId} AND ${friendshipsTable.userBId} = ${otherUserId}) OR (${friendshipsTable.userAId} = ${otherUserId} AND ${friendshipsTable.userBId} = ${userId})`,
    )
    .limit(1);
  return !!friendship;
}

export async function userCanSeeFeedPost(meUserId: string, authorUserId: string | null, visibility: string): Promise<boolean> {
  if (!authorUserId) return visibility === "PUBLIC";
  if (authorUserId === meUserId) return true;
  if (visibility === "PUBLIC") return true;
  if (visibility === "FRIENDS") return hasFriendship(meUserId, authorUserId);
  return false;
}

export { MIN_MESSAGE_COUNT as DAILY_TALK_REWARD_MIN_MESSAGE_COUNT };
