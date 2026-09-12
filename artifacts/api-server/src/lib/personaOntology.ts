import { eq } from "drizzle-orm";
import {
  db,
  personaProfilesTable,
  userAiMemoriesTable,
  type BattleEvaluation,
  type PersonaProfile,
  type PersonaProfileSourceCounts,
  type PrivacyScope,
  type UserAiMemory,
} from "@workspace/db";
import type { Logger } from "pino";
import { logger as defaultLogger } from "./logger";
import {
  graphTenantId,
  retrieveUserPersonaPromptContext,
  upsertGraphTenant,
  upsertOntologySchema,
  upsertPersonaEvidence,
  upsertPersonaSignal,
  upsertUserPersona,
} from "./knowledgeGraph/core";
import type { PersonaSignalKind } from "./knowledgeGraph/types";

export const USER_PERSONA_SCHEMA_ID = "user_persona_ontology_v1";

const MAX_PROFILE_ITEMS = 8;
const MAX_PROFILE_SOURCE_KEYS = 200;
const BATTLE_SIGNAL_THRESHOLD = 7;
const TALK_SIGNAL_THRESHOLD = 70;

export interface PersonaProfileView {
  archetypeKey: string;
  archetypeLabel: string;
  summary: string | null;
  traitTags: string[];
  communicationStyles: string[];
  preferences: string[];
  capabilities: string[];
  conflictStyles: string[];
  evidenceSummary: string[];
  sourceCounts: PersonaProfileSourceCounts;
  confidence: number;
  status: string;
  updatedAt: string;
}

interface PersonaSignalObservation {
  kind: PersonaSignalKind;
  key: string;
  label: string;
  weight: number;
  confidence: number;
}

interface DailyTalkScores {
  empathy: number;
  communication: number;
  trust: number;
  positivity: number;
  contribution: number;
  spamRisk: number;
  qualityScore: number;
}

interface DailyTalkAbuseSignals {
  messageCount: number;
  userMessageCount: number;
  otherMessageCount: number;
  counterpartCount: number;
  repeatedMessageRatio: number;
  shortMessageRatio: number;
  selfMessageRatio: number;
  rewardMultiplier: number;
  reductions: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clip(value: string, max = 180): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function uniqueMerge(existing: string[] | null | undefined, incoming: string[]): string[] {
  return Array.from(new Set([...incoming, ...(existing ?? [])].map((item) => item.trim()).filter(Boolean))).slice(0, MAX_PROFILE_ITEMS);
}

function uniqueSourceKeys(existing: string[] | null | undefined, incoming: string): string[] {
  return Array.from(new Set([incoming, ...(existing ?? [])].map((item) => item.trim()).filter(Boolean))).slice(0, MAX_PROFILE_SOURCE_KEYS);
}

export function userPersonaTenantId(userId: string): string {
  return graphTenantId("user_private", userId);
}

export function userPersonaGraphId(userId: string): string {
  return `user_persona:${userId}`;
}

export function serializePersonaProfile(row: PersonaProfile): PersonaProfileView {
  return {
    archetypeKey: row.archetypeKey,
    archetypeLabel: row.archetypeLabel,
    summary: row.summary ?? null,
    traitTags: row.traitTags ?? [],
    communicationStyles: row.communicationStyles ?? [],
    preferences: row.preferences ?? [],
    capabilities: row.capabilities ?? [],
    conflictStyles: row.conflictStyles ?? [],
    evidenceSummary: row.evidenceSummary ?? [],
    sourceCounts: row.sourceCounts ?? {},
    confidence: row.confidence,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getPersonaOntologyProfile(userId: string): Promise<PersonaProfileView | null> {
  const [row] = await db.select().from(personaProfilesTable).where(eq(personaProfilesTable.userId, userId));
  return row ? serializePersonaProfile(row) : null;
}

async function ensureUserPersonaGraph(userId: string): Promise<{ tenantId: string; personaId: string }> {
  const tenantId = userPersonaTenantId(userId);
  const personaId = userPersonaGraphId(userId);
  await upsertOntologySchema({ id: USER_PERSONA_SCHEMA_ID, name: "User Persona Ontology", version: "1" });
  await upsertGraphTenant({
    id: tenantId,
    type: "user_private",
    ownerId: userId,
    ontologySchemaId: USER_PERSONA_SCHEMA_ID,
    status: "inferred",
  });
  await upsertUserPersona({ id: personaId, tenantId, userId, status: "inferred" });
  return { tenantId, personaId };
}

function battleObservations(evaluation: BattleEvaluation): PersonaSignalObservation[] {
  if (evaluation.violation) return [];
  const out: PersonaSignalObservation[] = [];
  const add = (score: number, kind: PersonaSignalKind, key: string, label: string) => {
    if (score < BATTLE_SIGNAL_THRESHOLD) return;
    out.push({
      kind,
      key,
      label,
      weight: clamp(score / 10, 0.1, 1),
      confidence: clamp(0.45 + score / 20, 0.5, 0.95),
    });
  };

  add(evaluation.logic, "Capability", "structured_argument", "근거를 구조화해 설명함");
  add(evaluation.persuasiveness, "Capability", "persuasive_expression", "상대를 설득하는 표현을 사용함");
  add(evaluation.rebuttal, "Capability", "rebuttal_handling", "상대 주장에 반박을 구성함");
  add(evaluation.wit, "CommunicationStyle", "playful_wit", "재치 있는 표현을 섞음");
  add(evaluation.manners, "ConflictStyle", "respectful_rebuttal", "반대 상황에서도 예의를 유지함");

  if (evaluation.logic >= BATTLE_SIGNAL_THRESHOLD && evaluation.manners >= BATTLE_SIGNAL_THRESHOLD) {
    out.push({
      kind: "Trait",
      key: "calm_debater",
      label: "차분한 토론형",
      weight: clamp((evaluation.logic + evaluation.manners) / 20, 0.1, 1),
      confidence: 0.75,
    });
  }

  return out;
}

function talkObservationConfidence(score: number, spamRisk: number): number {
  const spamPenalty = spamRisk >= 60 ? 0.2 : spamRisk >= 30 ? 0.1 : 0;
  return clamp(0.45 + score / 200 - spamPenalty, 0.35, 0.9);
}

function dailyTalkObservations(scores: DailyTalkScores, abuse?: DailyTalkAbuseSignals | null): PersonaSignalObservation[] {
  if (scores.spamRisk >= 80 || (abuse?.rewardMultiplier ?? 1) <= 0) return [];

  const out: PersonaSignalObservation[] = [];
  const add = (score: number, kind: PersonaSignalKind, key: string, label: string) => {
    if (score < TALK_SIGNAL_THRESHOLD) return;
    out.push({
      kind,
      key,
      label,
      weight: clamp(score / 100, 0.1, 1),
      confidence: talkObservationConfidence(score, scores.spamRisk),
    });
  };

  add(scores.empathy, "RelationshipStyle", "empathetic_response", "상대 감정에 공감적으로 반응함");
  add(scores.communication, "CommunicationStyle", "smooth_conversation_flow", "대화를 부드럽게 이어감");
  add(scores.trust, "Trait", "trust_building_interaction", "신뢰를 쌓는 상호작용을 함");
  add(scores.positivity, "CommunicationStyle", "positive_tone", "긍정적인 표현을 사용함");
  add(scores.contribution, "Habit", "relationship_contributor", "관계에 기여하는 대화를 이어감");

  if (out.length === 0 && scores.qualityScore >= 50) {
    out.push({
      kind: "Habit",
      key: "daily_reflection_participation",
      label: "대화 기록을 돌아보고 동기화함",
      weight: clamp(scores.qualityScore / 100, 0.1, 0.7),
      confidence: talkObservationConfidence(scores.qualityScore, scores.spamRisk),
    });
  }

  return out;
}

function memoryObservation(memory: Pick<UserAiMemory, "id" | "memoryType" | "text" | "confidence">): PersonaSignalObservation {
  const confidence = clamp((memory.confidence ?? 100) / 100, 0.35, 1);
  const text = clip(memory.text, 120);
  const key = `manual_${memory.memoryType}:${memory.id}`;
  if (memory.memoryType === "tone") {
    return { kind: "CommunicationStyle", key, label: `직접 저장한 말투: ${text}`, weight: confidence, confidence };
  }
  if (memory.memoryType === "habit") {
    return { kind: "Habit", key, label: `직접 저장한 습관: ${text}`, weight: confidence, confidence };
  }
  if (memory.memoryType === "preference") {
    return { kind: "Preference", key, label: `직접 저장한 선호: ${text}`, weight: confidence, confidence };
  }
  return { kind: "Trait", key, label: `직접 저장한 기억: ${text}`, weight: confidence, confidence };
}

function analysisObservation(args: {
  analysisId: string;
  field: "languageStyle" | "personalityTraits" | "valuesBeliefs" | "knowledgeDomains" | "emotionalPatterns" | "decisionStyle";
  text: string | null | undefined;
  confidence: number;
}): PersonaSignalObservation | null {
  const text = clip(args.text ?? "", 120);
  if (!text || text.includes("데이터 부족") || text.includes("근거 부족")) return null;
  const key = `analysis_${args.field}:${args.analysisId}`;
  if (args.field === "languageStyle") return { kind: "CommunicationStyle", key, label: `AI 분석 말투: ${text}`, weight: args.confidence, confidence: args.confidence };
  if (args.field === "personalityTraits") return { kind: "Trait", key, label: `AI 분석 성향: ${text}`, weight: args.confidence, confidence: args.confidence };
  if (args.field === "valuesBeliefs") return { kind: "Preference", key, label: `AI 분석 가치/선호: ${text}`, weight: args.confidence, confidence: args.confidence };
  if (args.field === "knowledgeDomains") return { kind: "Capability", key, label: `AI 분석 관심/지식: ${text}`, weight: args.confidence, confidence: args.confidence };
  if (args.field === "emotionalPatterns") return { kind: "RelationshipStyle", key, label: `AI 분석 감정 표현: ${text}`, weight: args.confidence, confidence: args.confidence };
  return { kind: "Habit", key, label: `AI 분석 결정 방식: ${text}`, weight: args.confidence, confidence: args.confidence };
}

function memoryEligibleForPersonaOntology(memory: Pick<UserAiMemory, "status" | "privacyScope" | "subjectUserId">): boolean {
  if (memory.status !== "approved") return false;
  if (memory.subjectUserId) return false;
  return (["user_private", "public_profile"] as PrivacyScope[]).includes(memory.privacyScope);
}

function splitObservations(observations: PersonaSignalObservation[]) {
  return {
    traitTags: observations.filter((item) => item.kind === "Trait").map((item) => item.label),
    communicationStyles: observations.filter((item) => item.kind === "CommunicationStyle" || item.kind === "Habit" || item.kind === "RelationshipStyle").map((item) => item.label),
    preferences: observations.filter((item) => item.kind === "Preference").map((item) => item.label),
    capabilities: observations.filter((item) => item.kind === "Capability").map((item) => item.label),
    conflictStyles: observations.filter((item) => item.kind === "ConflictStyle").map((item) => item.label),
  };
}

function chooseArchetype(parts: ReturnType<typeof splitObservations>, existing?: PersonaProfile | null): { key: string; label: string } {
  const capabilities = new Set([...(existing?.capabilities ?? []), ...parts.capabilities]);
  const styles = new Set([...(existing?.communicationStyles ?? []), ...parts.communicationStyles]);
  const conflicts = new Set([...(existing?.conflictStyles ?? []), ...parts.conflictStyles]);

  if (capabilities.has("근거를 구조화해 설명함") && conflicts.has("반대 상황에서도 예의를 유지함")) {
    return { key: "calm_persuader", label: "차분한 설득가" };
  }
  if (styles.has("재치 있는 표현을 섞음")) {
    return { key: "witty_communicator", label: "재치형 커뮤니케이터" };
  }
  if (capabilities.has("상대를 설득하는 표현을 사용함")) {
    return { key: "persuasive_speaker", label: "설득형 스피커" };
  }
  return existing
    ? { key: existing.archetypeKey, label: existing.archetypeLabel }
    : { key: "forming", label: "형성 중인 자아" };
}

async function updatePersonaProfileSnapshot(args: {
  userId: string;
  observations: PersonaSignalObservation[];
  evidenceSummary: string;
  sourceType: keyof PersonaProfileSourceCounts;
  sourceKey: string;
}): Promise<void> {
  const [existing] = await db.select().from(personaProfilesTable).where(eq(personaProfilesTable.userId, args.userId));
  const parts = splitObservations(args.observations);
  const archetype = chooseArchetype(parts, existing ?? null);
  const sourceCounts: PersonaProfileSourceCounts = { ...(existing?.sourceCounts ?? {}) };
  const alreadyApplied = (existing?.sourceKeys ?? []).includes(args.sourceKey);
  if (!alreadyApplied) sourceCounts[args.sourceType] = (sourceCounts[args.sourceType] ?? 0) + 1;
  const sourceKeys = uniqueSourceKeys(existing?.sourceKeys, args.sourceKey);
  const avgConfidence = args.observations.length
    ? Math.round(args.observations.reduce((sum, item) => sum + item.confidence, 0) / args.observations.length * 100)
    : 0;
  const confidence = Math.max(existing?.confidence ?? 0, avgConfidence);
  const evidenceSummary = uniqueMerge(existing?.evidenceSummary, [args.evidenceSummary]);
  const summary = evidenceSummary[0]
    ? `DavaQ가 참고할 ${evidenceSummary[0]}`
    : existing?.summary ?? null;

  await db.insert(personaProfilesTable).values({
    userId: args.userId,
    archetypeKey: archetype.key,
    archetypeLabel: archetype.label,
    summary,
    traitTags: uniqueMerge(existing?.traitTags, parts.traitTags),
    communicationStyles: uniqueMerge(existing?.communicationStyles, parts.communicationStyles),
    preferences: uniqueMerge(existing?.preferences, parts.preferences),
    capabilities: uniqueMerge(existing?.capabilities, parts.capabilities),
    conflictStyles: uniqueMerge(existing?.conflictStyles, parts.conflictStyles),
    evidenceSummary,
    sourceCounts,
    sourceKeys,
    confidence,
    status: "inferred",
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: personaProfilesTable.userId,
    set: {
      archetypeKey: archetype.key,
      archetypeLabel: archetype.label,
      summary,
      traitTags: uniqueMerge(existing?.traitTags, parts.traitTags),
      communicationStyles: uniqueMerge(existing?.communicationStyles, parts.communicationStyles),
      preferences: uniqueMerge(existing?.preferences, parts.preferences),
      capabilities: uniqueMerge(existing?.capabilities, parts.capabilities),
      conflictStyles: uniqueMerge(existing?.conflictStyles, parts.conflictStyles),
      evidenceSummary,
      sourceCounts,
      sourceKeys,
      confidence,
      status: "inferred",
      updatedAt: new Date(),
    },
  });
}

export async function recordBattlePersonaEvidence(args: {
  userId: string;
  roomId: string;
  matchSeq: number;
  turnIndex: number;
  round: number;
  topic: string;
  side: string;
  content?: string;
  evaluation: BattleEvaluation;
  throwOnFailure?: boolean;
  log?: Logger;
}): Promise<void> {
  const log = args.log ?? defaultLogger;
  try {
    if (args.content !== undefined && !args.content.trim()) return;
    if (args.evaluation.violation) return;
    const observations = battleObservations(args.evaluation);
    if (observations.length === 0) return;
    const evidenceSummary = `토크배틀에서 ${observations.slice(0, 3).map((item) => item.label).join(", ")} 패턴이 관찰됨`;
    const { tenantId, personaId } = await ensureUserPersonaGraph(args.userId);
    const evidenceId = `${personaId}:battle:${args.roomId}:${args.matchSeq}:${args.turnIndex}`;
    const evidenceWritten = await upsertPersonaEvidence({
      id: evidenceId,
      tenantId,
      userId: args.userId,
      sourceType: "battle_turn",
      sourceId: args.roomId,
      title: `토크배틀 ${args.round}라운드`,
      summary: `${evidenceSummary}. 주제: ${clip(args.topic)}. 심판 피드백: ${clip(args.evaluation.feedback)}`,
      status: "inferred",
      visibility: "user_private",
    });
    const signalWrites = await Promise.all(observations.map((observation) => upsertPersonaSignal({
      tenantId,
      userId: args.userId,
      personaId,
      ...observation,
      status: "inferred",
      evidenceId,
    })));

    if (args.throwOnFailure && (!evidenceWritten || signalWrites.some((ok) => !ok))) {
      throw new Error("battle persona ontology graph write failed");
    }

    await updatePersonaProfileSnapshot({
      userId: args.userId,
      observations,
      evidenceSummary,
      sourceType: "battle",
      sourceKey: `battle_turn:${args.roomId}:${args.matchSeq}:${args.turnIndex}:${args.userId}`,
    });
  } catch (err) {
    log.error({ err, userId: args.userId, roomId: args.roomId }, "Failed to record battle persona evidence");
    if (args.throwOnFailure) throw err;
  }
}

export async function recordDailyTalkRewardPersonaEvidence(args: {
  userId: string;
  rewardId: string;
  rewardDate: string;
  title: string;
  mood: string;
  keywords: string[];
  summary: string;
  scores: DailyTalkScores;
  abuse?: DailyTalkAbuseSignals | null;
  pvtAmount: number;
  throwOnFailure?: boolean;
  log?: Logger;
}): Promise<void> {
  const log = args.log ?? defaultLogger;
  try {
    if (args.scores.qualityScore < 40 || args.scores.spamRisk >= 80 || (args.abuse?.rewardMultiplier ?? 1) <= 0) {
      return;
    }
    const observations = dailyTalkObservations(args.scores, args.abuse);
    const topSignals = observations.slice(0, 3).map((item) => item.label).join(", ");
    const evidenceSummary = topSignals
      ? `톡 리워드에서 ${topSignals} 패턴이 관찰됨`
      : "톡 리워드에서 대화 요약을 DavaQ 동기화 데이터로 제공함";
    const keywordText = args.keywords.slice(0, 5).join(", ");
    const qualityText = `품질 ${args.scores.qualityScore}점, 스팸위험 ${args.scores.spamRisk}점, PVT ${args.pvtAmount}`;
    const { tenantId, personaId } = await ensureUserPersonaGraph(args.userId);
    const evidenceId = `${personaId}:daily_talk_reward:${args.rewardId}`;

    const evidenceWritten = await upsertPersonaEvidence({
      id: evidenceId,
      tenantId,
      userId: args.userId,
      sourceType: "daily_talk_reward",
      sourceId: args.rewardId,
      title: `톡 리워드 ${args.rewardDate}`,
      summary: `${evidenceSummary}. ${qualityText}. 기분: ${clip(args.mood, 60)}.${keywordText ? ` 키워드: ${clip(keywordText, 100)}.` : ""} 요약: ${clip(args.summary || args.title, 180)}`,
      status: "inferred",
      visibility: "user_private",
    });

    const signalWrites = await Promise.all(observations.map((observation) => upsertPersonaSignal({
      tenantId,
      userId: args.userId,
      personaId,
      ...observation,
      status: "inferred",
      evidenceId,
    })));

    if (args.throwOnFailure && (!evidenceWritten || signalWrites.some((ok) => !ok))) {
      throw new Error("daily talk reward ontology graph write failed");
    }

    await updatePersonaProfileSnapshot({
      userId: args.userId,
      observations,
      evidenceSummary,
      sourceType: "chat",
      sourceKey: `daily_talk_reward:${args.rewardId}`,
    });
  } catch (err) {
    log.error({ err, userId: args.userId, rewardId: args.rewardId }, "Failed to record daily talk reward persona evidence");
    if (args.throwOnFailure) throw err;
  }
}

export async function recordUserAiMemoryPersonaEvidence(args: {
  userId: string;
  memoryId: string;
  throwOnFailure?: boolean;
  log?: Logger;
}): Promise<void> {
  const log = args.log ?? defaultLogger;
  try {
    const [memory] = await db
      .select()
      .from(userAiMemoriesTable)
      .where(eq(userAiMemoriesTable.id, args.memoryId));
    if (!memory || memory.userId !== args.userId || !memoryEligibleForPersonaOntology(memory)) return;

    const observation = memoryObservation(memory);
    const observations = [observation];
    const evidenceSummary = `${observation.label} 기억을 DavaQ 동기화 데이터로 제공함`;
    const { tenantId, personaId } = await ensureUserPersonaGraph(args.userId);
    const evidenceId = `${personaId}:user_ai_memory:${memory.id}`;

    const evidenceWritten = await upsertPersonaEvidence({
      id: evidenceId,
      tenantId,
      userId: args.userId,
      sourceType: "user_ai_memory",
      sourceId: memory.id,
      title: "직접 저장한 AI 기억",
      summary: evidenceSummary,
      status: "approved",
      visibility: memory.privacyScope,
    });
    const signalWrites = await Promise.all(observations.map((item) => upsertPersonaSignal({
      tenantId,
      userId: args.userId,
      personaId,
      ...item,
      status: "approved",
      evidenceId,
    })));

    if (args.throwOnFailure && (!evidenceWritten || signalWrites.some((ok) => !ok))) {
      throw new Error("user AI memory ontology graph write failed");
    }

    await db
      .update(userAiMemoriesTable)
      .set({ graphMemoryId: evidenceId, updatedAt: new Date() })
      .where(eq(userAiMemoriesTable.id, memory.id));

    await updatePersonaProfileSnapshot({
      userId: args.userId,
      observations,
      evidenceSummary,
      sourceType: "memory",
      sourceKey: `user_ai_memory:${memory.id}`,
    });
  } catch (err) {
    log.error({ err, userId: args.userId, memoryId: args.memoryId }, "Failed to record user AI memory persona evidence");
    if (args.throwOnFailure) throw err;
  }
}

export async function recordPersonaAnalysisPersonaEvidence(args: {
  userId: string;
  analysisId: string;
  analyzedAt: string;
  summary: string | null;
  languageStyle: string | null;
  personalityTraits: string | null;
  valuesBeliefs: string | null;
  knowledgeDomains: string | null;
  emotionalPatterns: string | null;
  decisionStyle: string | null;
  confidence: number;
  dataCounts?: { chat?: number; battle?: number; dungeon?: number; growth?: number } | null;
  model?: string | null;
  throwOnFailure?: boolean;
  log?: Logger;
}): Promise<void> {
  const log = args.log ?? defaultLogger;
  try {
    const confidence = clamp(args.confidence, 0.35, 0.95);
    const observations = [
      analysisObservation({ analysisId: args.analysisId, field: "languageStyle", text: args.languageStyle, confidence }),
      analysisObservation({ analysisId: args.analysisId, field: "personalityTraits", text: args.personalityTraits, confidence }),
      analysisObservation({ analysisId: args.analysisId, field: "valuesBeliefs", text: args.valuesBeliefs, confidence }),
      analysisObservation({ analysisId: args.analysisId, field: "knowledgeDomains", text: args.knowledgeDomains, confidence }),
      analysisObservation({ analysisId: args.analysisId, field: "emotionalPatterns", text: args.emotionalPatterns, confidence }),
      analysisObservation({ analysisId: args.analysisId, field: "decisionStyle", text: args.decisionStyle, confidence }),
    ].filter((item): item is PersonaSignalObservation => item !== null);
    if (observations.length === 0) return;

    const evidenceSummary = `AI 분석에서 ${observations.slice(0, 3).map((item) => item.label).join(", ")} 정보를 DavaQ 동기화 데이터로 제공함`;
    const countText = args.dataCounts
      ? `입력 수: 채팅 ${args.dataCounts.chat ?? 0}, 배틀 ${args.dataCounts.battle ?? 0}, 성장RPG ${args.dataCounts.dungeon ?? 0}, 활동 ${args.dataCounts.growth ?? 0}.`
      : "";
    const { tenantId, personaId } = await ensureUserPersonaGraph(args.userId);
    const evidenceId = `${personaId}:persona_analysis:${args.analysisId}`;

    const evidenceWritten = await upsertPersonaEvidence({
      id: evidenceId,
      tenantId,
      userId: args.userId,
      sourceType: "persona_analysis",
      sourceId: args.analysisId,
      title: "마이페이지 AI 분석 업데이트",
      summary: `${evidenceSummary}. ${countText}${args.model ? ` 모델: ${clip(args.model, 40)}.` : ""} 요약: ${clip(args.summary ?? "", 180)}`,
      status: "inferred",
      visibility: "user_private",
    });
    const signalWrites = await Promise.all(observations.map((item) => upsertPersonaSignal({
      tenantId,
      userId: args.userId,
      personaId,
      ...item,
      status: "inferred",
      evidenceId,
    })));

    if (args.throwOnFailure && (!evidenceWritten || signalWrites.some((ok) => !ok))) {
      throw new Error("persona analysis ontology graph write failed");
    }

    await updatePersonaProfileSnapshot({
      userId: args.userId,
      observations,
      evidenceSummary,
      sourceType: "analysis",
      sourceKey: `persona_analysis:${args.userId}:${args.analysisId}`,
    });
  } catch (err) {
    log.error({ err, userId: args.userId, analysisId: args.analysisId }, "Failed to record persona analysis evidence");
    if (args.throwOnFailure) throw err;
  }
}

function snapshotPromptLines(profile: PersonaProfileView | null): string[] {
  if (!profile) return [];
  return [
    profile.archetypeLabel ? `대표 자아: ${profile.archetypeLabel}` : null,
    ...profile.traitTags.slice(0, 4).map((item) => `대표 성향: ${item}`),
    ...profile.communicationStyles.slice(0, 4).map((item) => `말투/표현: ${item}`),
    ...profile.preferences.slice(0, 4).map((item) => `선호: ${item}`),
    ...profile.capabilities.slice(0, 4).map((item) => `표현 역량: ${item}`),
    ...profile.conflictStyles.slice(0, 4).map((item) => `갈등/반박 스타일: ${item}`),
  ].filter((line): line is string => !!line);
}

export async function getPersonaOntologyPromptLines(userId: string): Promise<string[]> {
  const [profile, graph] = await Promise.all([
    getPersonaOntologyProfile(userId),
    retrieveUserPersonaPromptContext({ tenantId: userPersonaTenantId(userId), userId }).catch(() => null),
  ]);
  const graphLines = graph
    ? [
        ...graph.traitLines,
        ...graph.styleLines,
        ...graph.preferenceLines,
        ...graph.capabilityLines,
        ...graph.conflictStyleLines,
      ]
    : [];
  return Array.from(new Set([...graphLines, ...snapshotPromptLines(profile)])).slice(0, 16);
}
