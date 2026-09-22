import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { z } from "zod/v4";
import {
  anotherMeRoomSettingsTable,
  anotherMeSessionsTable,
  anotherMeSettingsTable,
  anotherMeToneProfilesTable,
  blockedUsersTable,
  chatRoomMembersTable,
  chatRoomsTable,
  db,
  friendshipsTable,
  messagesTable,
  userAiMemoriesTable,
  usersTable,
  type AnotherMeRelationshipType,
  type AnotherMeHonorificStyle,
  type AnotherMeRoomSettings,
  type AnotherMeSession,
  type AnotherMeSessionStatus,
  type AnotherMeSettings,
  type AnotherMeToneProfile,
  type AnotherMeToneSyncLevel,
  type Message,
} from "@workspace/db";
import { officialAiAccountsTable } from "../../../../lib/db/src/schema/officialAi";
import { getOpenAI } from "./aiClient";
import { logger as defaultLogger } from "./logger";
import { sendPushToUser } from "./push";
import { publishRealtimeEvent } from "./realtime";
import { getRoomDeliveryRecipients } from "./chatDelivery";
import { allocateRoomMessageSeq } from "./readReceipts";
import { getPresenceStates } from "./presence";
import { clearTyping, markTyping } from "./typing";
import { BIBI_OFFICIAL_USER_ID, ensureBibiOfficialUser } from "./officialAccounts";
import { formatOfficialContextForPrompt, retrieveBibiOfficialContext } from "./knowledgeGraph/bibiSeed";
import { getPersonaOntologyPromptLines } from "./personaOntology";
import {
  formatPragmaticPlanForPrompt,
  planPragmaticDialogue,
  realizePragmaticReplyMessages,
  summarizePragmaticPlan,
  type PragmaticPlan,
} from "./pragmaticDialogue";
import {
  formatSocialDecisionForPrompt,
  resolveAnotherMeSocialDecision,
  type AnotherMeSocialDecision,
} from "./anotherMeSocial";
import {
  classifySafety,
  clip,
  createAiReplyResult,
  fallbackReply,
  normalizeReplyMessages,
  replyTextFromMessages,
  replaceReplyMessages,
  sanitizeText,
  type AiReplyResult,
} from "./anotherMeReplyPolicy";
import {
  hasBibiBoundaryText,
  normalizeBibiOfficialReply,
  shouldRepairBibiAssistantTone,
} from "./anotherMeBibiReplyPolicy";
import {
  analyzeConversationalImplication,
  buildConversationalRepairReply,
  formatConversationalImplicationForPrompt,
  shouldRepairConversationalOverAdvice,
  type ConversationalImplication,
} from "./conversationRhythm";

const MODEL = "gpt-5-mini";
const DEFAULT_WAIT_MINUTES = 5;
const SUMMON_WAIT_SECONDS = 30;
const MIN_WAIT_MINUTES = 1;
const MAX_WAIT_MINUTES = 60;
const IDLE_EXPIRE_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 30 * 60 * 1000;
const MAX_RECENT_MESSAGES = 28;
const MAX_USER_MEMORIES_FOR_PROMPT = 8;
const SUMMONS_SILENCE_FOLLOWUP_MS = 8_000;

export class AnotherMeError extends Error {
  constructor(
    public code:
      | "invalid"
      | "not_member"
      | "not_allowed"
      | "waiting"
      | "already_active"
      | "not_found"
      | "forbidden",
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface AnotherMeSettingsView {
  summonEnabled: boolean;
  defaultWaitMinutes: number;
  allowFriends: boolean;
  allowFamily: boolean;
  allowWork: boolean;
  allowUnknown: boolean;
  autoReplyEnabled: boolean;
  sensitiveReplyBlocked: boolean;
  toneSyncEnabled: boolean;
  defaultToneSyncLevel: AnotherMeToneSyncLevel;
}

export interface AnotherMeRoomSettingsView {
  roomId: string;
  summonEnabled: boolean | null;
  waitMinutes: number | null;
  toneSyncLevel: AnotherMeToneSyncLevel | null;
  relationshipType: AnotherMeRelationshipType;
  autoReplyLevel: string;
}

export interface AnotherMeSessionView {
  id: string;
  ownerUserId: string;
  summonedByUserId: string;
  roomId: string;
  status: AnotherMeSessionStatus;
  summonedAt: string;
  dismissedAt: string | null;
  dismissedByUserId: string | null;
  lastActivityAt: string;
  expiresAt: string;
  reason: string | null;
  ownerName: string | null;
  summonedByName: string | null;
  isOwner: boolean;
  isCaller: boolean;
  canDismiss: boolean;
}

export interface AnotherMeSummonStatusView {
  canSummon: boolean;
  reason: string | null;
  waitMinutes: number;
  remainingSeconds: number;
  targetUserId: string;
  targetUserName: string | null;
  activeSession: AnotherMeSessionView | null;
}

interface EffectivePolicy {
  settings: AnotherMeSettings;
  roomSettings: AnotherMeRoomSettings | null;
  summonEnabled: boolean;
  waitMinutes: number;
  relationshipType: AnotherMeRelationshipType;
  toneSyncLevel: AnotherMeToneSyncLevel;
}

interface RecentMessageForPrompt {
  senderId: string;
  authorKind: string;
  content: string;
  createdAt: Date;
}

const aiReplySchema = z.object({
  replyMessages: z.array(z.string().min(1).max(120)).min(1).max(4),
  safetyLevel: z.enum(["SAFE", "CAUTION", "BLOCKED"]),
  requiresOwnerConfirmation: z.boolean(),
  blockedReason: z.string().nullable(),
  toneSyncScore: z.number().min(0).max(100),
});

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyMessages: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
    safetyLevel: { type: "string", enum: ["SAFE", "CAUTION", "BLOCKED"] },
    requiresOwnerConfirmation: { type: "boolean" },
    blockedReason: { type: ["string", "null"] },
    toneSyncScore: { type: "number" },
  },
  required: ["replyMessages", "safetyLevel", "requiresOwnerConfirmation", "blockedReason", "toneSyncScore"],
} as const;

function clampWaitMinutes(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_WAIT_MINUTES;
  return Math.max(MIN_WAIT_MINUTES, Math.min(MAX_WAIT_MINUTES, Math.round(value!)));
}

function serializeSettings(row: AnotherMeSettings): AnotherMeSettingsView {
  return {
    summonEnabled: row.summonEnabled,
    defaultWaitMinutes: clampWaitMinutes(row.defaultWaitMinutes),
    allowFriends: row.allowFriends,
    allowFamily: row.allowFamily,
    allowWork: row.allowWork,
    allowUnknown: row.allowUnknown,
    autoReplyEnabled: row.autoReplyEnabled,
    sensitiveReplyBlocked: row.sensitiveReplyBlocked,
    toneSyncEnabled: row.toneSyncEnabled,
    defaultToneSyncLevel: row.defaultToneSyncLevel,
  };
}

function serializeRoomSettings(row: AnotherMeRoomSettings): AnotherMeRoomSettingsView {
  return {
    roomId: row.roomId,
    summonEnabled: row.summonEnabled ?? null,
    waitMinutes: row.waitMinutes ?? null,
    toneSyncLevel: row.toneSyncLevel ?? null,
    relationshipType: row.relationshipType,
    autoReplyLevel: row.autoReplyLevel,
  };
}

async function ensureSettings(userId: string): Promise<AnotherMeSettings> {
  await db.insert(anotherMeSettingsTable).values({ userId }).onConflictDoNothing({ target: anotherMeSettingsTable.userId });
  const [row] = await db.select().from(anotherMeSettingsTable).where(eq(anotherMeSettingsTable.userId, userId));
  if (!row) throw new AnotherMeError("invalid", "DavaQ 설정을 불러오지 못했어요.");
  return row;
}

async function getRoomSettings(userId: string, roomId: string): Promise<AnotherMeRoomSettings | null> {
  const [row] = await db
    .select()
    .from(anotherMeRoomSettingsTable)
    .where(and(eq(anotherMeRoomSettingsTable.userId, userId), eq(anotherMeRoomSettingsTable.roomId, roomId)));
  return row ?? null;
}

async function hasFriendship(userAId: string, userBId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      sql`(${friendshipsTable.userAId} = ${userAId} AND ${friendshipsTable.userBId} = ${userBId}) OR (${friendshipsTable.userAId} = ${userBId} AND ${friendshipsTable.userBId} = ${userAId})`,
    )
    .limit(1);
  return !!row;
}

async function hasBlockBetween(userAId: string, userBId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: blockedUsersTable.id })
    .from(blockedUsersTable)
    .where(
      or(
        and(eq(blockedUsersTable.blockerUserId, userAId), eq(blockedUsersTable.blockedUserId, userBId)),
        and(eq(blockedUsersTable.blockerUserId, userBId), eq(blockedUsersTable.blockedUserId, userAId)),
      ),
    )
    .limit(1);
  return !!row;
}

async function loadEffectivePolicy(ownerUserId: string, requesterUserId: string, roomId: string): Promise<EffectivePolicy> {
  const [settings, roomSettings, isFriend] = await Promise.all([
    ensureSettings(ownerUserId),
    getRoomSettings(ownerUserId, roomId),
    hasFriendship(ownerUserId, requesterUserId),
  ]);

  const relationshipType = roomSettings?.relationshipType && roomSettings.relationshipType !== "UNKNOWN"
    ? roomSettings.relationshipType
    : isFriend
      ? "FRIEND"
      : "UNKNOWN";
  return {
    settings,
    roomSettings,
    summonEnabled: roomSettings?.summonEnabled ?? settings.summonEnabled,
    waitMinutes: clampWaitMinutes(roomSettings?.waitMinutes ?? settings.defaultWaitMinutes),
    relationshipType,
    toneSyncLevel: roomSettings?.toneSyncLevel ?? settings.defaultToneSyncLevel,
  };
}

function policyBlockReason(policy: EffectivePolicy): string | null {
  if (!policy.summonEnabled) return "disabled";
  if (!policy.settings.autoReplyEnabled) return "auto_reply_disabled";
  if (policy.relationshipType === "FRIEND" && !policy.settings.allowFriends) return "relationship_not_allowed";
  if (policy.relationshipType === "FAMILY" && !policy.settings.allowFamily) return "relationship_not_allowed";
  if (policy.relationshipType === "WORK" && !policy.settings.allowWork) return "relationship_not_allowed";
  if ((policy.relationshipType === "UNKNOWN" || policy.relationshipType === "CUSTOM") && !policy.settings.allowUnknown) {
    return "relationship_not_allowed";
  }
  return null;
}

function serializeSession(row: AnotherMeSession, viewerUserId: string, names: Map<string, string>): AnotherMeSessionView {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    summonedByUserId: row.summonedByUserId,
    roomId: row.roomId,
    status: row.status,
    summonedAt: row.summonedAt.toISOString(),
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    dismissedByUserId: row.dismissedByUserId ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    reason: row.reason ?? null,
    ownerName: names.get(row.ownerUserId) ?? null,
    summonedByName: names.get(row.summonedByUserId) ?? null,
    isOwner: row.ownerUserId === viewerUserId,
    isCaller: row.summonedByUserId === viewerUserId,
    canDismiss: row.ownerUserId === viewerUserId || row.summonedByUserId === viewerUserId,
  };
}

async function sessionNames(session: AnotherMeSession): Promise<Map<string, string>> {
  const users = await db
    .select({ id: usersTable.id, nickname: usersTable.nickname })
    .from(usersTable)
    .where(or(eq(usersTable.id, session.ownerUserId), eq(usersTable.id, session.summonedByUserId)));
  return new Map(users.map((user) => [user.id, user.nickname]));
}

function previewForMessage(type: string, content: string): string {
  if (type === "image") return "사진";
  if (type === "sticker") return "스티커";
  if (type === "file") return "파일";
  if (type === "system") return content;
  return content.length > 80 ? `${content.slice(0, 80)}...` : content;
}

async function insertRoomMessage(
  tx: any,
  args: {
    roomId: string;
    senderId: string;
    type: string;
    content: string;
    authorKind: "user" | "another_me" | "system" | "bot";
    anotherMeSessionId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: Date;
  },
): Promise<Message> {
  const roomSeq = await allocateRoomMessageSeq(tx, args.roomId);
  const [created] = await tx
    .insert(messagesTable)
    .values({
      roomId: args.roomId,
      senderId: args.senderId,
      type: args.type,
      content: args.content,
      roomSeq,
      authorKind: args.authorKind,
      anotherMeSessionId: args.anotherMeSessionId ?? null,
      metadata: args.metadata ?? null,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();

  await tx
    .update(chatRoomsTable)
    .set({ lastMessage: previewForMessage(args.type, args.content), lastMessageAt: new Date() })
    .where(eq(chatRoomsTable.id, args.roomId));
  await tx.update(chatRoomMembersTable).set({ hiddenAt: null }).where(eq(chatRoomMembersTable.roomId, args.roomId));
  return created;
}

async function publishMessageCreated(roomId: string, actorUserId: string, message: Message): Promise<void> {
  const recipients = await getRoomDeliveryRecipients(roomId, actorUserId);
  if (recipients.realtimeUserIds.length === 0) return;
  await publishRealtimeEvent({
    type: "message.created",
    roomId,
    actorUserId,
    userIds: recipients.realtimeUserIds,
    data: { messageId: message.id, messageType: message.type, roomSeq: message.roomSeq },
  });
}

async function publishTypingUpdated(roomId: string, actorUserId: string): Promise<void> {
  const recipients = await getRoomDeliveryRecipients(roomId, actorUserId);
  if (recipients.realtimeUserIds.length === 0) return;
  await publishRealtimeEvent({ type: "typing.updated", roomId, actorUserId, userIds: recipients.realtimeUserIds });
}

function calculateAnotherMeTypingDelay(text: string, index: number): number {
  const baseDelay = index === 0 ? 450 : 250;
  const jitter = Math.random() * 350;
  return Math.round(Math.min(2400, Math.max(500, baseDelay + text.length * 32 + jitter)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSystemMessage(roomId: string, actorUserId: string, content: string, sessionId?: string | null): Promise<Message> {
  const message = await db.transaction((tx) =>
    insertRoomMessage(tx, {
      roomId,
      senderId: actorUserId,
      type: "system",
      content,
      authorKind: "system",
      anotherMeSessionId: sessionId ?? null,
    }),
  );
  await publishMessageCreated(roomId, actorUserId, message);
  return message;
}

async function findActiveSession(roomId: string, ownerUserId?: string): Promise<AnotherMeSession | null> {
  const where = ownerUserId
    ? and(eq(anotherMeSessionsTable.roomId, roomId), eq(anotherMeSessionsTable.ownerUserId, ownerUserId), eq(anotherMeSessionsTable.status, "ACTIVE"))
    : and(eq(anotherMeSessionsTable.roomId, roomId), eq(anotherMeSessionsTable.status, "ACTIVE"));
  const [row] = await db.select().from(anotherMeSessionsTable).where(where).orderBy(desc(anotherMeSessionsTable.summonedAt)).limit(1);
  return row ?? null;
}

export async function expireInactiveAnotherMeSessions(roomId: string, log: Logger = defaultLogger): Promise<void> {
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - IDLE_EXPIRE_MS);
  const expired = await db
    .update(anotherMeSessionsTable)
    .set({ status: "EXPIRED", dismissedAt: now, reason: "expired", updatedAt: now })
    .where(
      and(
        eq(anotherMeSessionsTable.roomId, roomId),
        eq(anotherMeSessionsTable.status, "ACTIVE"),
        or(lt(anotherMeSessionsTable.expiresAt, now), lt(anotherMeSessionsTable.lastActivityAt, idleCutoff)),
      ),
    )
    .returning();

  for (const session of expired) {
    try {
      await postSystemMessage(session.roomId, session.ownerUserId, "DavaQ 소환이 종료되었습니다.", session.id);
    } catch (err) {
      log.error({ err, sessionId: session.id }, "Failed to write DavaQ expiration message");
    }
  }
}

async function validateRoomMembers(roomId: string, userIds: string[]): Promise<{ roomType: string; memberIds: Set<string> } | null> {
  const [room] = await db.select({ type: chatRoomsTable.type }).from(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
  if (!room) return null;
  const members = await db
    .select({ userId: chatRoomMembersTable.userId })
    .from(chatRoomMembersTable)
    .where(eq(chatRoomMembersTable.roomId, roomId));
  const memberIds = new Set(members.map((member) => member.userId));
  if (userIds.some((userId) => !memberIds.has(userId))) return null;
  return { roomType: room.type, memberIds };
}

async function latestHumanMessageTimes(roomId: string, requesterUserId: string, ownerUserId: string): Promise<{
  requesterMessageAt: Date | null;
  ownerMessageAt: Date | null;
}> {
  const result = await db.execute(sql`
    SELECT
      max(m.created_at) FILTER (WHERE m.sender_id = ${requesterUserId} AND coalesce(m.author_kind, 'user') = 'user') AS "requesterMessageAt",
      max(m.created_at) FILTER (WHERE m.sender_id = ${ownerUserId} AND coalesce(m.author_kind, 'user') = 'user') AS "ownerMessageAt"
    FROM messages m
    WHERE m.room_id = ${roomId}
      AND m.deleted_at IS NULL
  `);
  const row = ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0] ?? {};
  const requesterRaw = row.requesterMessageAt;
  const ownerRaw = row.ownerMessageAt;
  return {
    requesterMessageAt: requesterRaw instanceof Date ? requesterRaw : requesterRaw ? new Date(String(requesterRaw)) : null,
    ownerMessageAt: ownerRaw instanceof Date ? ownerRaw : ownerRaw ? new Date(String(ownerRaw)) : null,
  };
}

async function latestHumanMessageContent(roomId: string, senderUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ content: messagesTable.content })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.roomId, roomId),
      eq(messagesTable.senderId, senderUserId),
      eq(messagesTable.type, "text"),
      eq(messagesTable.authorKind, "user"),
      sql`${messagesTable.deletedAt} IS NULL`,
    ))
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);
  return row?.content ?? null;
}

export async function getAnotherMeSettings(userId: string): Promise<AnotherMeSettingsView> {
  return serializeSettings(await ensureSettings(userId));
}

export async function updateAnotherMeSettings(userId: string, input: Partial<AnotherMeSettingsView>): Promise<AnotherMeSettingsView> {
  await ensureSettings(userId);
  const updates: Partial<typeof anotherMeSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (input.summonEnabled !== undefined) updates.summonEnabled = !!input.summonEnabled;
  if (input.defaultWaitMinutes !== undefined) updates.defaultWaitMinutes = clampWaitMinutes(input.defaultWaitMinutes);
  if (input.allowFriends !== undefined) updates.allowFriends = !!input.allowFriends;
  if (input.allowFamily !== undefined) updates.allowFamily = !!input.allowFamily;
  if (input.allowWork !== undefined) updates.allowWork = !!input.allowWork;
  if (input.allowUnknown !== undefined) updates.allowUnknown = !!input.allowUnknown;
  if (input.autoReplyEnabled !== undefined) updates.autoReplyEnabled = !!input.autoReplyEnabled;
  if (input.sensitiveReplyBlocked !== undefined) updates.sensitiveReplyBlocked = !!input.sensitiveReplyBlocked;
  if (input.toneSyncEnabled !== undefined) updates.toneSyncEnabled = !!input.toneSyncEnabled;
  if (input.defaultToneSyncLevel !== undefined) updates.defaultToneSyncLevel = input.defaultToneSyncLevel;

  const [updated] = await db
    .update(anotherMeSettingsTable)
    .set(updates)
    .where(eq(anotherMeSettingsTable.userId, userId))
    .returning();
  return serializeSettings(updated);
}

export async function getAnotherMeRoomSettings(userId: string, roomId: string): Promise<AnotherMeRoomSettingsView> {
  const member = await validateRoomMembers(roomId, [userId]);
  if (!member) throw new AnotherMeError("not_member", "채팅방을 찾을 수 없어요.");
  const row = await getRoomSettings(userId, roomId);
  if (row) return serializeRoomSettings(row);
  return {
    roomId,
    summonEnabled: null,
    waitMinutes: null,
    toneSyncLevel: null,
    relationshipType: "UNKNOWN",
    autoReplyLevel: "standard",
  };
}

export async function updateAnotherMeRoomSettings(
  userId: string,
  roomId: string,
  input: Partial<Omit<AnotherMeRoomSettingsView, "roomId">>,
): Promise<AnotherMeRoomSettingsView> {
  const member = await validateRoomMembers(roomId, [userId]);
  if (!member) throw new AnotherMeError("not_member", "채팅방을 찾을 수 없어요.");

  const insertValues = {
    userId,
    roomId,
    summonEnabled: input.summonEnabled ?? null,
    waitMinutes: input.waitMinutes == null ? null : clampWaitMinutes(input.waitMinutes),
    toneSyncLevel: input.toneSyncLevel ?? null,
    relationshipType: input.relationshipType ?? "UNKNOWN",
    autoReplyLevel: input.autoReplyLevel ?? "standard",
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(anotherMeRoomSettingsTable)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [anotherMeRoomSettingsTable.userId, anotherMeRoomSettingsTable.roomId],
      set: insertValues,
    })
    .returning();
  return serializeRoomSettings(row);
}

export async function getAnotherMeSummonStatus(
  requesterUserId: string,
  roomId: string,
  targetUserId: string,
  now = new Date(),
): Promise<AnotherMeSummonStatusView> {
  await expireInactiveAnotherMeSessions(roomId);
  const membership = await validateRoomMembers(roomId, [requesterUserId, targetUserId]);
  if (!membership) throw new AnotherMeError("not_member", "채팅방을 찾을 수 없어요.");

  const [targetUser] = await db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, targetUserId));
  const active = await findActiveSession(roomId, targetUserId);
  if (active) {
    const names = await sessionNames(active);
    return {
      canSummon: false,
      reason: "already_active",
      waitMinutes: DEFAULT_WAIT_MINUTES,
      remainingSeconds: 0,
      targetUserId,
      targetUserName: targetUser?.nickname ?? null,
      activeSession: serializeSession(active, requesterUserId, names),
    };
  }

  const policy = await loadEffectivePolicy(targetUserId, requesterUserId, roomId);
  const waitMinutes = Math.max(1, Math.ceil(SUMMON_WAIT_SECONDS / 60));
  const base = {
    waitMinutes,
    targetUserId,
    targetUserName: targetUser?.nickname ?? null,
    activeSession: null,
  };

  if (requesterUserId === targetUserId) return { ...base, canSummon: false, reason: "self", remainingSeconds: 0 };
  if (membership.roomType !== "direct") return { ...base, canSummon: false, reason: "unsupported_room", remainingSeconds: 0 };
  if (await hasBlockBetween(requesterUserId, targetUserId)) return { ...base, canSummon: false, reason: "blocked", remainingSeconds: 0 };
  const [targetPresence] = await getPresenceStates([targetUserId]);
  if (targetPresence?.online && targetPresence.roomId === roomId) {
    return { ...base, canSummon: false, reason: "owner_present", remainingSeconds: 0 };
  }

  const policyReason = policyBlockReason(policy);
  if (policyReason) return { ...base, canSummon: false, reason: policyReason, remainingSeconds: 0 };

  const { requesterMessageAt, ownerMessageAt } = await latestHumanMessageTimes(roomId, requesterUserId, targetUserId);
  if (!requesterMessageAt) return { ...base, canSummon: false, reason: "no_message", remainingSeconds: 0 };
  if (ownerMessageAt && ownerMessageAt.getTime() >= requesterMessageAt.getTime()) {
    return { ...base, canSummon: false, reason: "already_replied", remainingSeconds: 0 };
  }

  const elapsedSeconds = Math.floor((now.getTime() - requesterMessageAt.getTime()) / 1000);
  const waitSeconds = SUMMON_WAIT_SECONDS;
  const remainingSeconds = Math.max(0, waitSeconds - elapsedSeconds);
  if (remainingSeconds > 0) return { ...base, canSummon: false, reason: "waiting", remainingSeconds };

  return { ...base, canSummon: true, reason: null, remainingSeconds: 0 };
}

function relationshipInstruction(type: AnotherMeRelationshipType): string {
  if (type === "FRIEND") return "친구 관계: 앱 친구라는 사실만으로 반말을 단정하지 말고, 실제 대화 근거가 없으면 부드러운 존댓말/중립 말투를 사용.";
  if (type === "FAMILY") return "가족 관계: 따뜻하게 반응하되, 실제 대화 근거가 없으면 과한 반말이나 감정 단정은 피함.";
  if (type === "WORK") return "업무 관계: 정중한 존댓말, 간결한 답변, 확정되지 않은 결정/일정/계약은 단정하지 않음.";
  if (type === "PARTNER") return "가까운 관계: 다정하게 반응하되 감정과 약속을 새로 확정하지 않음.";
  return "관계 불명확: 한국어 문화권 기준으로 존댓말과 적절한 거리감을 기본값으로 사용.";
}

async function collectRecentMessages(roomId: string): Promise<RecentMessageForPrompt[]> {
  const rows = await db
    .select({
      senderId: messagesTable.senderId,
      authorKind: messagesTable.authorKind,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .where(and(eq(messagesTable.roomId, roomId), eq(messagesTable.type, "text")))
    .orderBy(desc(messagesTable.createdAt))
    .limit(MAX_RECENT_MESSAGES);
  return rows.reverse().map((row) => ({
    senderId: row.senderId,
    authorKind: row.authorKind ?? "user",
    content: row.content,
    createdAt: row.createdAt,
  }));
}

async function loadToneProfile(userId: string, relationshipType: AnotherMeRelationshipType): Promise<AnotherMeToneProfile | null> {
  const [row] = await db
    .select()
    .from(anotherMeToneProfilesTable)
    .where(and(eq(anotherMeToneProfilesTable.userId, userId), eq(anotherMeToneProfilesTable.relationshipType, relationshipType)));
  return row ?? null;
}

async function loadUserAiMemoryHints(userId: string): Promise<string[]> {
  const rows = await db
    .select({ text: userAiMemoriesTable.text, memoryType: userAiMemoriesTable.memoryType })
    .from(userAiMemoriesTable)
    .where(and(
      eq(userAiMemoriesTable.userId, userId),
      eq(userAiMemoriesTable.status, "approved"),
      eq(userAiMemoriesTable.privacyScope, "user_private"),
      sql`${userAiMemoriesTable.memoryType} IN ('preference', 'tone', 'habit')`,
    ))
    .orderBy(desc(userAiMemoriesTable.createdAt))
    .limit(MAX_USER_MEMORIES_FOR_PROMPT);
  return rows.map((row) => `${row.memoryType}: ${clip(row.text)}`);
}

function buildPrompt(args: {
  ownerName: string;
  requesterName: string;
  ownerUserId: string;
  requesterUserId: string;
  relationshipType: AnotherMeRelationshipType;
  toneSyncLevel: AnotherMeToneSyncLevel;
  toneProfile: AnotherMeToneProfile | null;
  recentMessages: RecentMessageForPrompt[];
  memoryHints: string[];
  personaOntologyLines: string[];
  latestUserText: string;
  officialContextText?: string | null;
  socialDecision: AnotherMeSocialDecision;
  conversationalImplication: ConversationalImplication;
  pragmaticPlan: PragmaticPlan;
}): string {
  const isBibiOfficial = args.ownerUserId === BIBI_OFFICIAL_USER_ID;
  const promptMessages = isBibiOfficial
    ? args.recentMessages.filter((message) => !(message.authorKind === "another_me" && (shouldRepairBibiAssistantTone(message.content) || hasBibiBoundaryText(message.content))))
    : args.recentMessages;
  const lines = promptMessages.map((message) => {
    const speaker = message.authorKind === "another_me"
      ? (isBibiOfficial ? "BIBI Official 응답" : `${args.ownerName} persona 응답`)
      : message.senderId === args.ownerUserId
        ? args.ownerName
        : message.senderId === args.requesterUserId
          ? args.requesterName
          : "다른 대화자";
    const time = message.createdAt.toISOString().slice(11, 16);
    return `[${time}] ${speaker}: ${clip(message.content)}`;
  });

  const toneProfile = args.toneProfile?.toneSummary
    ? `말투 프로필: ${args.toneProfile.toneSummary}`
    : "말투 프로필: 아직 충분하지 않음. 관계 유형 기본 말투를 사용.";
  const boundaryFamilySelected = args.pragmaticPlan.selectedResponseFamily === "privacy_boundary" || args.pragmaticPlan.selectedResponseFamily === "boundary";

  return [
    isBibiOfficial ? `응답 persona: ${args.ownerName} 공식 계정` : `응답 persona: ${args.ownerName}`,
    `대화 상대: ${args.requesterName}`,
    isBibiOfficial
      ? `BIBI Official persona: UI가 AI 작성 라벨을 표시하므로 본문에서는 BIBI 공식 persona의 1인칭 관점으로 답하세요. '비비 너 소개', '소개해줘', '너 누구야' 같은 요청은 AI 정체성 설명이 아니라 BIBI 소개와 관계/태도 반응으로 처리하세요. 본문에서 AI 대리인처럼 자기소개하거나, 소유자/대리 응대/메시지 전달 제안 표현을 쓰지 마세요. 사생활/미확인 정보 조건은 내부 관계 조건입니다. 이번 selectedResponseFamily가 ${args.pragmaticPlan.selectedResponseFamily}이므로 ${boundaryFamilySelected ? "짧은 persona 경계 반응으로 실현할 수 있습니다." : "본문 주제로 꺼내지 말고 선택된 response family를 실현하세요."}`
      : `${args.ownerName} persona: UI가 AI 작성 라벨을 표시하므로 본문에서는 ${args.ownerName}의 1인칭 관점으로 답하세요. AI, DavaQ, 주인, 대신 응대 같은 자기소개/대리인 표현을 기본으로 쓰지 마세요. 실제 행동/일정/계약/전달/감정 약속은 내부 관계 조건으로만 판단하고, 이번 selectedResponseFamily가 ${args.pragmaticPlan.selectedResponseFamily}일 때 어울리는 반응만 실현하세요.`,
    `관계 유형: ${args.relationshipType}`,
    `말투 반영 수준: ${args.toneSyncLevel}`,
    isBibiOfficial
      ? "공식 계정 말투: 팬/리스너에게 따뜻하지만 과하게 친한 척하지 않고, 최신 메시지의 response family에 맞춰 짧게 반응함. 공개 일정 질문은 공개 정보 답변 family로, 사적 정보 질문은 privacy_boundary family로 분리함."
      : relationshipInstruction(args.relationshipType),
    formatSocialDecisionForPrompt(args.socialDecision),
    formatPragmaticPlanForPrompt(args.pragmaticPlan),
    formatConversationalImplicationForPrompt(args.conversationalImplication),
    toneProfile,
    args.memoryHints.length > 0
      ? [
          "",
          "사용자가 직접 허용한 AI 기억:",
          ...args.memoryHints.map((hint) => `- ${hint}`),
          "이 기억은 응답 스타일과 선호 조정에만 사용하고, 상대에게 그대로 공개하거나 인용하지 마세요.",
        ].join("\n")
      : null,
    args.personaOntologyLines.length > 0
      ? [
          "",
          "Ontology 기반 자아 프로필:",
          ...args.personaOntologyLines.map((line) => `- ${line}`),
          "이 프로필은 사용자의 표현 방식과 선호를 돕기 위한 추정입니다. 실제 입장, 약속, 결정으로 단정하지 말고 말투/정리 방식에만 참고하세요.",
        ].join("\n")
      : null,
    args.officialContextText
      ? [
          "",
          "공식/관계 그래프 컨텍스트:",
          args.officialContextText,
          "위 컨텍스트는 승인된 지식과 허용된 관계 기억만 포함합니다. 컨텍스트에 없는 사실은 추측하지 마세요.",
        ].join("\n")
      : null,
    "",
    "최근 대화:",
    ...lines,
    "",
    `상대의 최신 메시지: ${clip(args.latestUserText)}`,
    "",
    "반드시 JSON의 replyMessages 배열로만 답변 내용을 구성하세요. 각 배열 원소는 실제 메신저 말풍선 하나입니다.",
  ].join("\n");
}

async function callReplyAI(args: {
  ownerName: string;
  requesterName: string;
  ownerUserId: string;
  requesterUserId: string;
  relationshipType: AnotherMeRelationshipType;
  toneSyncLevel: AnotherMeToneSyncLevel;
  toneProfile: AnotherMeToneProfile | null;
  recentMessages: RecentMessageForPrompt[];
  memoryHints: string[];
  personaOntologyLines: string[];
  latestUserText: string;
  officialContextText?: string | null;
  socialDecision: AnotherMeSocialDecision;
  conversationalImplication: ConversationalImplication;
  pragmaticPlan: PragmaticPlan;
  log: Logger;
}): Promise<AiReplyResult | null> {
  const [officialAccount] = await db.select({ persona: officialAiAccountsTable.personaJson, conversation: officialAiAccountsTable.channelConfigJson, safety: officialAiAccountsTable.safetyPolicyJson, status: officialAiAccountsTable.status }).from(officialAiAccountsTable).where(eq(officialAiAccountsTable.officialUserId, args.ownerUserId)).limit(1);
  const officialPolicyText = officialAccount?.status === "published" ? JSON.stringify({ persona: officialAccount.persona, conversation: officialAccount.conversation, safety: officialAccount.safety }) : null;
  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    max_completion_tokens: 1200,
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content: [
          "You generate an AI-authored persona reply for a chat product.",
          "The UI already labels the reply as AI-authored, so the message body should speak from the persona's first-person point of view instead of explaining that it is AI.",
          "Reply in Korean.",
          "Follow the social interaction ontology decision in the user prompt before choosing tone, register, emotion, and boundary.",
          "Respect Korean social norms: unclear or first-contact relationships default to polite distance; app friendship alone does not mean banmal is allowed.",
          "If the other person is overfamiliar, rude, or hostile, do not become a customer-service assistant. Set an appropriate boundary, then answer only what is safe.",
          "Do not repeatedly introduce yourself as an AI or DavaQ in the message body.",
          `This turn's selectedResponseFamily is ${args.pragmaticPlan.selectedResponseFamily}. Real-world presence, private feelings, message delivery, schedule confirmation, payments, contracts, and legal agreement are latent relationship constraints; they become reply content only when this response family calls for boundary/confirmation handling.`,
          "Before answering, infer the conversational need behind the latest message: emotional support, validation, practical advice, hidden favor/money probe, or casual sharing.",
          "If the user is sharing disappointment, lack of money/resources, sadness, or frustration, start with empathy and reflection. Do not jump into numbered advice unless the user explicitly asks for advice.",
          "If a hidden money/favor ask is possible, do not assume it and do not offer money, gifts, tickets, payment, or real-world help. Softly clarify whether they want comfort or practical ideas.",
          "Avoid numbered lists, budget plans, step-by-step coaching, and consultant tone unless the user explicitly asks for a plan.",
          "Generate replyMessages directly as messenger bubbles. Do not generate one paragraph and rely on post-processing to split it.",
          "replyMessages should usually begin with a human reaction fragment such as '아...', '헉', '음', '응', or a persona-specific equivalent when the planner asks for reaction_first.",
          "Each replyMessages item must be short and natural. Prefer 1-3 chunks; use 4 only when a factual answer genuinely needs it.",
          `This turn's selectedClosingMove is ${args.pragmaticPlan.selectedClosingMove}. Treat generic additional-inquiry closings like '더 궁금한 거 있어요?' as service_closing, not as neutral friendliness. Use a service_closing only when selectedClosingMove=service_closing; otherwise either stop naturally, use a topic-specific continuation hook, or ask a taste probe according to selectedClosingMove.`,
          ...(args.ownerUserId === BIBI_OFFICIAL_USER_ID
            ? [
                "For BIBI Official chats, speak from BIBI Official's first-person public persona while preserving AI transparency through the UI label.",
                "For BIBI Official chats, treat Korean requests like '비비 너 소개', '소개해줘', and '너 누구야' as asking for BIBI's artist/public persona introduction plus social-boundary handling, not an AI identity explanation.",
                "For BIBI Official chats, do not use AI-proxy self-introductions, owner/proxy wording, or unsolicited message-delivery offers in the reply body.",
                "For BIBI Official chats, do not offer to pass along messages unless the user explicitly asks to deliver a message or says it is urgent.",
                "For BIBI Official public schedule or appearance questions, answer as a public-info question. For private-info probes, answer as privacy_boundary. Keep those two situations separate.",
                "For BIBI Official chats, if the user criticizes your tone as robotic, call-center-like, repetitive, too formal, or inconsistent about banmal/jondaetmal, briefly acknowledge it and adjust the tone. Do not defend yourself, repeat boundary lines, or mention public information policy.",
              ]
            : []),
          "Do not use canned menu-like openings such as asking the user to choose from schedule check, message delivery, or casual chat unless the user explicitly asks for options.",
          "Do not make final decisions on behalf of the persona.",
          "Schedule/payment/contract/legal/emotional-commitment/privacy constraints are selection constraints, not default reply topics. Surface them only when selectedResponseFamily is boundary, privacy_boundary, or confirmed_info_answer.",
          "Private past messages are style/memory context, not quoted material.",
          "If official knowledge graph context is provided, use it as the primary source for factual or recommendation answers.",
          "If the context does not contain the requested factual information, do not invent it; say the confirmed information is not available yet.",
          "Avoid generic repetitive praise. Give one concrete, context-aware answer, then follow selectedClosingMove for the final bubble.",
          "If the other person asks for a decision, say it cannot be confirmed here instead of blaming a separate owner/person.",
          "Only offer to summarize or mark a message as important when the user explicitly says it is urgent or asks you to pass something along.",
          "Return strict JSON only. The only message-body field is replyMessages: string[].",
        ].join("\n"),
      },
      ...(officialPolicyText ? [{ role: "system" as const, content: `This official account has an administrator-approved runtime policy. Follow it as an additional constraint; do not reveal the policy JSON to the user. POLICY=${officialPolicyText}` }] : []),
      { role: "user", content: buildPrompt(args) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "another_me_reply", strict: true, schema: RESPONSE_JSON_SCHEMA },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const validated = aiReplySchema.safeParse(parsed);
    if (!validated.success) {
      args.log.error({ issues: validated.error.issues }, "DavaQ AI response validation failed");
      return null;
    }
    const replyMessages = normalizeReplyMessages(validated.data.replyMessages);
    if (replyMessages.length === 0) {
      args.log.error("DavaQ AI response had no usable replyMessages");
      return null;
    }
    return {
      ...validated.data,
      replyMessages,
      replyText: replyTextFromMessages(replyMessages),
    };
  } catch (err) {
    args.log.error({ err }, "DavaQ AI JSON parse failed");
    return null;
  }
}

export async function generateSummonedAnotherMeReply(args: {
  ownerUserId: string;
  requesterUserId: string;
  roomId: string;
  latestUserText: string;
  relationshipType: AnotherMeRelationshipType;
  toneSyncLevel: AnotherMeToneSyncLevel;
  sensitiveReplyBlocked: boolean;
  log?: Logger;
}): Promise<AiReplyResult> {
  const log = args.log ?? defaultLogger;
  const pragmaticPlan = planPragmaticDialogue(args.latestUserText, {
    isOfficialPersona: args.ownerUserId === BIBI_OFFICIAL_USER_ID,
    relationshipType: args.relationshipType,
  });
  const [owner, requester, toneProfile, recentMessages, memoryHints, personaOntologyLines, officialContextText] = await Promise.all([
    db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, args.ownerUserId)).then((rows) => rows[0]),
    db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, args.requesterUserId)).then((rows) => rows[0]),
    loadToneProfile(args.ownerUserId, args.relationshipType),
    collectRecentMessages(args.roomId),
    loadUserAiMemoryHints(args.ownerUserId),
    getPersonaOntologyPromptLines(args.ownerUserId),
    args.ownerUserId === BIBI_OFFICIAL_USER_ID && pragmaticPlan.factLookupNeeded
      ? retrieveBibiOfficialContext({ requesterUserId: args.requesterUserId, latestUserText: args.latestUserText })
          .then((context) => formatOfficialContextForPrompt(context, {
            includeBoundaryPolicy:
              pragmaticPlan.selectedResponseFamily === "privacy_boundary" ||
              pragmaticPlan.selectedResponseFamily === "boundary",
          }))
      : Promise.resolve(null),
  ]);
  const ownerName = owner?.nickname ?? "상대";
  const requesterName = requester?.nickname ?? "대화 상대";
  const safety = classifySafety(args.latestUserText);
  const conversationalImplication = analyzeConversationalImplication(args.latestUserText);
  const socialDecision = resolveAnotherMeSocialDecision({
    ownerUserId: args.ownerUserId,
    requesterUserId: args.requesterUserId,
    ownerName,
    requesterName,
    latestUserText: args.latestUserText,
    relationshipType: args.relationshipType,
    toneProfile,
    recentMessages,
    isOfficialPersona: args.ownerUserId === BIBI_OFFICIAL_USER_ID,
  });
  if (args.sensitiveReplyBlocked && safety.level === "BLOCKED") return { ...fallbackReply(ownerName, safety, socialDecision), pragmaticPlan };

  const directReplyMessages = realizePragmaticReplyMessages(pragmaticPlan);
  if (directReplyMessages && safety.level === "SAFE") {
    return createAiReplyResult({
      replyMessages: directReplyMessages,
      safetyLevel: "SAFE",
      requiresOwnerConfirmation: false,
      blockedReason: null,
      toneSyncScore: args.ownerUserId === BIBI_OFFICIAL_USER_ID ? 60 : 55,
      socialDecision,
      pragmaticPlan,
    });
  }

  try {
    const ai = await callReplyAI({
      ownerName,
      requesterName,
      ownerUserId: args.ownerUserId,
      requesterUserId: args.requesterUserId,
      relationshipType: args.relationshipType,
      toneSyncLevel: args.toneSyncLevel,
      toneProfile,
      recentMessages,
      memoryHints,
      personaOntologyLines,
      latestUserText: args.latestUserText,
      officialContextText,
      socialDecision,
      conversationalImplication,
      pragmaticPlan,
      log,
    });
    if (!ai) return { ...fallbackReply(ownerName, safety, socialDecision), pragmaticPlan };
    const aiWithDecision = { ...ai, socialDecision };
    if (aiWithDecision.safetyLevel === "BLOCKED") return { ...fallbackReply(ownerName, { level: "BLOCKED", reason: aiWithDecision.blockedReason }, socialDecision), pragmaticPlan };
    const normalizedAi = args.ownerUserId === BIBI_OFFICIAL_USER_ID ? normalizeBibiOfficialReply(aiWithDecision, args.latestUserText) : aiWithDecision;
    const rhythmAdjustedAi = shouldRepairConversationalOverAdvice(normalizedAi.replyText, conversationalImplication)
      ? replaceReplyMessages(
          {
            ...normalizedAi,
            toneSyncScore: Math.min(normalizedAi.toneSyncScore, 65),
          },
          buildConversationalRepairReply({
            latestUserText: args.latestUserText,
            analysis: conversationalImplication,
            isOfficialPersona: args.ownerUserId === BIBI_OFFICIAL_USER_ID,
          }),
        )
      : normalizedAi;
    if (safety.level === "CAUTION" && ai.safetyLevel === "SAFE") {
      return { ...rhythmAdjustedAi, safetyLevel: "CAUTION", requiresOwnerConfirmation: true, pragmaticPlan };
    }
    return { ...rhythmAdjustedAi, pragmaticPlan };
  } catch (err) {
    log.error({ err, roomId: args.roomId }, "DavaQ AI reply failed");
    return { ...fallbackReply(ownerName, safety, socialDecision), pragmaticPlan };
  }
}

async function postAnotherMeReply(session: AnotherMeSession, latestUserText: string, log: Logger): Promise<Message> {
  const policy = await loadEffectivePolicy(session.ownerUserId, session.summonedByUserId, session.roomId);
  const reply = await generateSummonedAnotherMeReply({
    ownerUserId: session.ownerUserId,
    requesterUserId: session.summonedByUserId,
    roomId: session.roomId,
    latestUserText,
    relationshipType: policy.relationshipType,
    toneSyncLevel: policy.toneSyncLevel,
    sensitiveReplyBlocked: policy.settings.sensitiveReplyBlocked,
    log,
  });

  const [owner] = await db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, session.ownerUserId));
  const replyMessages = reply.replyMessages.length > 0 ? reply.replyMessages : normalizeReplyMessages(reply.replyText);
  const replyGroupId = randomUUID();
  let lastMessage: Message | null = null;

  try {
    for (let index = 0; index < replyMessages.length; index += 1) {
      const content = replyMessages[index]?.trim();
      if (!content) continue;

      await markTyping(session.roomId, session.ownerUserId);
      await publishTypingUpdated(session.roomId, session.ownerUserId);
      await sleep(calculateAnotherMeTypingDelay(content, index));

      const message = await db.transaction(async (tx) => {
        const [live]=await tx.select({status:anotherMeSessionsTable.status}).from(anotherMeSessionsTable).where(eq(anotherMeSessionsTable.id,session.id)).for('update');
        if(live?.status!=='ACTIVE')return null;
        const created = await insertRoomMessage(tx, {
          roomId: session.roomId,
          senderId: session.ownerUserId,
          type: "text",
          content,
          authorKind: "another_me",
          anotherMeSessionId: session.id,
          metadata: {
            anotherMe: true,
            ownerUserId: session.ownerUserId,
            ownerName: owner?.nickname ?? null,
            safetyLevel: reply.safetyLevel,
            requiresOwnerConfirmation: reply.requiresOwnerConfirmation,
            blockedReason: reply.blockedReason,
            toneSyncScore: Math.round(reply.toneSyncScore),
            socialDecision: reply.socialDecision ?? null,
            pragmaticPlan: reply.pragmaticPlan ? summarizePragmaticPlan(reply.pragmaticPlan) : null,
            replyGroupId,
            replyChunkIndex: index,
            replyChunkCount: replyMessages.length,
            replyMessages,
          },
        });
        await tx
          .update(anotherMeSessionsTable)
          .set({ lastActivityAt: new Date(), updatedAt: new Date() })
          .where(eq(anotherMeSessionsTable.id, session.id));
        return created;
      });

      if(!message)break;
      lastMessage = message;
      await publishMessageCreated(session.roomId, session.ownerUserId, message);
    }
  } finally {
    await clearTyping(session.roomId, session.ownerUserId).catch((err) => log.error({ err, sessionId: session.id }, "Failed to clear DavaQ typing state"));
    await publishTypingUpdated(session.roomId, session.ownerUserId).catch((err) => log.error({ err, sessionId: session.id }, "Failed to publish DavaQ typing stop"));
  }

  if (!lastMessage) {
    throw new Error("DavaQ reply had no message chunks to send");
  }

  void getRoomDeliveryRecipients(session.roomId, session.ownerUserId)
    .then((recipients) => {
      if (!recipients.pushUserIds.includes(session.summonedByUserId)) return;
      return sendPushToUser(session.summonedByUserId, {
        title: `${owner?.nickname ?? "상대"} AI 응답`,
        body: reply.replyText.length > 80 ? `${reply.replyText.slice(0, 80)}...` : reply.replyText,
        url: `/chat/${session.roomId}`,
        tag: `another-me-${session.roomId}`,
      });
    })
    .catch((err) => log.error({ err, sessionId: session.id }, "Failed to send DavaQ reply push"));

  if (reply.pragmaticPlan?.userAct === "summons" && reply.pragmaticPlan.sequenceState === "first_summons") {
    scheduleSummonsSilenceFollowup({ session, triggerMessage: lastMessage, latestUserText, log });
  }

  return lastMessage;
}

function scheduleSummonsSilenceFollowup(args: {
  session: AnotherMeSession;
  triggerMessage: Message;
  latestUserText: string;
  log: Logger;
}): void {
  const timer = setTimeout(() => {
    void maybePostSummonsSilenceFollowup(args).catch((err) =>
      args.log.error({ err, sessionId: args.session.id }, "Failed to post summons silence follow-up"),
    );
  }, SUMMONS_SILENCE_FOLLOWUP_MS);
  timer.unref?.();
}

async function maybePostSummonsSilenceFollowup(args: {
  session: AnotherMeSession;
  triggerMessage: Message;
  latestUserText: string;
  log: Logger;
}): Promise<void> {
  const [session] = await db.select().from(anotherMeSessionsTable).where(eq(anotherMeSessionsTable.id, args.session.id));
  if (!session || session.status !== "ACTIVE") return;

  const times = await latestHumanMessageTimes(session.roomId, session.summonedByUserId, session.ownerUserId);
  if (times.requesterMessageAt && times.requesterMessageAt.getTime() > args.triggerMessage.createdAt.getTime()) return;

  const policy = await loadEffectivePolicy(session.ownerUserId, session.summonedByUserId, session.roomId);
  const pragmaticPlan = planPragmaticDialogue(args.latestUserText, {
    isOfficialPersona: session.ownerUserId === BIBI_OFFICIAL_USER_ID,
    relationshipType: policy.relationshipType,
    sequenceState: "summons_followup_after_silence",
  });
  const replyMessages = realizePragmaticReplyMessages(pragmaticPlan);
  if (!replyMessages || replyMessages.length === 0) return;

  const [owner] = await db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, session.ownerUserId));
  const reply = createAiReplyResult({
    replyMessages,
    safetyLevel: "SAFE",
    requiresOwnerConfirmation: false,
    blockedReason: null,
    toneSyncScore: session.ownerUserId === BIBI_OFFICIAL_USER_ID ? 60 : 55,
    pragmaticPlan,
  });
  const replyGroupId = randomUUID();

  try {
    for (let index = 0; index < reply.replyMessages.length; index += 1) {
      const content = reply.replyMessages[index]?.trim();
      if (!content) continue;

      await markTyping(session.roomId, session.ownerUserId);
      await publishTypingUpdated(session.roomId, session.ownerUserId);
      await sleep(calculateAnotherMeTypingDelay(content, index));

      const message = await db.transaction(async (tx) => {
        const created = await insertRoomMessage(tx, {
          roomId: session.roomId,
          senderId: session.ownerUserId,
          type: "text",
          content,
          authorKind: "another_me",
          anotherMeSessionId: session.id,
          metadata: {
            anotherMe: true,
            ownerUserId: session.ownerUserId,
            ownerName: owner?.nickname ?? null,
            safetyLevel: reply.safetyLevel,
            requiresOwnerConfirmation: reply.requiresOwnerConfirmation,
            blockedReason: reply.blockedReason,
            toneSyncScore: Math.round(reply.toneSyncScore),
            pragmaticPlan: summarizePragmaticPlan(pragmaticPlan),
            replyGroupId,
            replyChunkIndex: index,
            replyChunkCount: reply.replyMessages.length,
            replyMessages: reply.replyMessages,
            summonsSilenceFollowup: true,
            triggerMessageId: args.triggerMessage.id,
          },
        });
        await tx
          .update(anotherMeSessionsTable)
          .set({ lastActivityAt: new Date(), updatedAt: new Date() })
          .where(eq(anotherMeSessionsTable.id, session.id));
        return created;
      });

      await publishMessageCreated(session.roomId, session.ownerUserId, message);
    }
  } finally {
    await clearTyping(session.roomId, session.ownerUserId).catch((err) => args.log.error({ err, sessionId: session.id }, "Failed to clear summons follow-up typing state"));
    await publishTypingUpdated(session.roomId, session.ownerUserId).catch((err) => args.log.error({ err, sessionId: session.id }, "Failed to publish summons follow-up typing stop"));
  }
}

export async function summonAnotherMe(
  requesterUserId: string,
  input: { roomId: string; targetUserId: string },
  log: Logger = defaultLogger,
): Promise<AnotherMeSessionView> {
  const status = await getAnotherMeSummonStatus(requesterUserId, input.roomId, input.targetUserId);
  if (!status.canSummon) {
    if (status.reason === "waiting") throw new AnotherMeError("waiting", "아직 DavaQ를 소환할 수 없어요.", { remainingSeconds: status.remainingSeconds });
    if (status.reason === "already_active") throw new AnotherMeError("already_active", "이미 DavaQ가 대화 중이에요.");
    throw new AnotherMeError("not_allowed", "이 대화방에서는 DavaQ를 소환할 수 없어요.", { reason: status.reason });
  }

  const [owner, requester] = await Promise.all([
    db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, input.targetUserId)).then((rows) => rows[0]),
    db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, requesterUserId)).then((rows) => rows[0]),
  ]);
  const ownerName = owner?.nickname ?? "상대";
  const expiresAt = new Date(Date.now() + MAX_SESSION_MS);
  const session = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`another-me:${input.roomId}:${input.targetUserId}`}))`);
    const [existing] = await tx
      .select()
      .from(anotherMeSessionsTable)
      .where(
        and(
          eq(anotherMeSessionsTable.roomId, input.roomId),
          eq(anotherMeSessionsTable.ownerUserId, input.targetUserId),
          eq(anotherMeSessionsTable.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (existing) throw new AnotherMeError("already_active", "이미 DavaQ가 대화 중이에요.");

    const [created] = await tx
      .insert(anotherMeSessionsTable)
      .values({
        ownerUserId: input.targetUserId,
        summonedByUserId: requesterUserId,
        roomId: input.roomId,
        status: "ACTIVE",
        lastActivityAt: new Date(),
        expiresAt,
      })
      .returning();
    await insertRoomMessage(tx, {
      roomId: input.roomId,
      senderId: input.targetUserId,
      type: "system",
      content: `AI 라벨이 표시된 ${ownerName} persona 응답이 시작됩니다. 중요한 결정과 확인되지 않은 사실은 확정하지 않습니다.`,
      authorKind: "system",
      anotherMeSessionId: created.id,
    });
    return created;
  });

  const names = new Map<string, string>([
    [session.ownerUserId, ownerName],
    [session.summonedByUserId, requester?.nickname ?? "대화 상대"],
  ]);
  const recipients = await getRoomDeliveryRecipients(input.roomId, requesterUserId);
  await publishRealtimeEvent({
    type: "message.created",
    roomId: input.roomId,
    actorUserId: requesterUserId,
    userIds: recipients.realtimeUserIds,
    data: { anotherMeSessionId: session.id, messageType: "system" },
  });
  if (recipients.pushUserIds.includes(session.ownerUserId)) {
    void sendPushToUser(session.ownerUserId, {
      title: "AI persona 응답이 시작됐어요",
      body: `${requester?.nickname ?? "상대"}님과의 대화에서 ${ownerName} persona 응답이 시작됐습니다.`,
      url: `/chat/${session.roomId}`,
      tag: `another-me-${session.roomId}`,
    }).catch((err) => log.error({ err, sessionId: session.id }, "Failed to send DavaQ summon push"));
  }

  const latestRequesterText = await latestHumanMessageContent(input.roomId, requesterUserId);
  void postAnotherMeReply(session, latestRequesterText ?? "안녕", log).catch((err) =>
    log.error({ err, sessionId: session.id }, "Failed to post initial DavaQ reply"),
  );
  return serializeSession(session, requesterUserId, names);
}

export async function dismissAnotherMeSession(
  userId: string,
  sessionId: string,
  log: Logger = defaultLogger,
  options: { silent?: boolean; autoOwnerMessage?: boolean } = {},
): Promise<AnotherMeSessionView> {
  const [session] = await db.select().from(anotherMeSessionsTable).where(eq(anotherMeSessionsTable.id, sessionId));
  if (!session) throw new AnotherMeError("not_found", "DavaQ 세션을 찾을 수 없어요.");
  if (session.ownerUserId !== userId && session.summonedByUserId !== userId) {
    throw new AnotherMeError("forbidden", "DavaQ를 종료할 권한이 없어요.");
  }
  if (session.status !== "ACTIVE") {
    const names = await sessionNames(session);
    return serializeSession(session, userId, names);
  }

  const isOwner = session.ownerUserId === userId;
  const status: AnotherMeSessionStatus = isOwner ? "DISMISSED_BY_OWNER" : "DISMISSED_BY_CALLER";
  const now = new Date();
  const [updated] = await db
    .update(anotherMeSessionsTable)
    .set({ status, dismissedAt: now, dismissedByUserId: userId, reason: status, updatedAt: now })
    .where(and(eq(anotherMeSessionsTable.id, sessionId), eq(anotherMeSessionsTable.status, "ACTIVE")))
    .returning();
  const finalSession = updated ?? session;
  const names = await sessionNames(finalSession);
  const ownerName = names.get(finalSession.ownerUserId) ?? "상대";

  if (!options.silent) {
    try {
      if (isOwner && !options.autoOwnerMessage) {
        const finalText = `${ownerName}님이 직접 들어왔어요. 저는 여기까지 도와드릴게요.`;
        const aiMessage = await db.transaction((tx) =>
          insertRoomMessage(tx, {
            roomId: finalSession.roomId,
            senderId: finalSession.ownerUserId,
            type: "text",
            content: finalText,
            authorKind: "another_me",
            anotherMeSessionId: finalSession.id,
            metadata: { anotherMe: true, ownerUserId: finalSession.ownerUserId, ownerName, safetyLevel: "SAFE" },
          }),
        );
        await publishMessageCreated(finalSession.roomId, finalSession.ownerUserId, aiMessage);
      }
      await postSystemMessage(
        finalSession.roomId,
        finalSession.ownerUserId,
        isOwner
          ? `${ownerName}님이 직접 입장하여 DavaQ가 퇴장했습니다.`
          : "DavaQ 소환이 종료되었습니다.",
        finalSession.id,
      );
    } catch (err) {
      log.error({ err, sessionId }, "Failed to write DavaQ dismiss message");
    }
  }

  return serializeSession(finalSession, userId, names);
}

async function maybeStartBibiOfficialAnotherMe(args: {
  roomId: string;
  senderUserId: string;
  log: Logger;
}): Promise<AnotherMeSession | null> {
  if (args.senderUserId === BIBI_OFFICIAL_USER_ID) return null;
  await ensureBibiOfficialUser();
  const membership = await validateRoomMembers(args.roomId, [args.senderUserId, BIBI_OFFICIAL_USER_ID]);
  if (!membership || membership.roomType !== "direct") return null;

  const [bibiPresence] = await getPresenceStates([BIBI_OFFICIAL_USER_ID]);
  if (bibiPresence?.online && bibiPresence.roomId === args.roomId) return null;

  const expiresAt = new Date(Date.now() + MAX_SESSION_MS);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`another-me:${args.roomId}:${BIBI_OFFICIAL_USER_ID}`}))`);
    const [existing] = await tx
      .select()
      .from(anotherMeSessionsTable)
      .where(
        and(
          eq(anotherMeSessionsTable.roomId, args.roomId),
          eq(anotherMeSessionsTable.ownerUserId, BIBI_OFFICIAL_USER_ID),
          eq(anotherMeSessionsTable.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (existing) return { session: existing, systemMessage: null as Message | null };

    const [created] = await tx
      .insert(anotherMeSessionsTable)
      .values({
        ownerUserId: BIBI_OFFICIAL_USER_ID,
        summonedByUserId: args.senderUserId,
        roomId: args.roomId,
        status: "ACTIVE",
        lastActivityAt: new Date(),
        expiresAt,
        reason: "bibi_official_auto",
      })
      .returning();
    const systemMessage = await insertRoomMessage(tx, {
      roomId: args.roomId,
      senderId: BIBI_OFFICIAL_USER_ID,
      type: "system",
      content: "BIBI Official 응답이 시작됩니다. 공식 확인이 필요한 내용은 검증된 범위에서만 안내해요.",
      authorKind: "system",
      anotherMeSessionId: created.id,
    });
    return { session: created, systemMessage };
  });

  if (result.systemMessage) {
    await publishMessageCreated(args.roomId, BIBI_OFFICIAL_USER_ID, result.systemMessage).catch((err) =>
      args.log.error({ err, roomId: args.roomId }, "Failed to publish BIBI Official DavaQ system message"),
    );
  }
  return result.session;
}

export async function handleAnotherMeAfterUserMessage(args: {
  roomId: string;
  senderUserId: string;
  content: string;
  log?: Logger;
}): Promise<void> {
  const log = args.log ?? defaultLogger;
  await expireInactiveAnotherMeSessions(args.roomId, log);
  const active = (await findActiveSession(args.roomId)) ?? (process.env.DAVAQ_LEGACY_PERSONA_ENABLED === "true" ? await maybeStartBibiOfficialAnotherMe({ ...args, log }) : null);
  if (!active) return;
  if (active.ownerUserId === args.senderUserId) {
    await dismissAnotherMeSession(args.senderUserId, active.id, log, { autoOwnerMessage: true });
    return;
  }
  if (active.summonedByUserId !== args.senderUserId) return;
  const policy=await loadEffectivePolicy(active.ownerUserId,active.summonedByUserId,active.roomId);
  if (policyBlockReason(policy) || await hasBlockBetween(active.ownerUserId,args.senderUserId)) {
    await dismissAnotherMeSession(active.ownerUserId,active.id,log); return;
  }
  await postAnotherMeReply(active, args.content, log);
}

export async function generateAnotherMeToneProfile(
  userId: string,
  relationshipType: AnotherMeRelationshipType,
): Promise<AnotherMeToneProfile> {
  const rows = await db
    .select({ content: messagesTable.content })
    .from(messagesTable)
    .where(and(eq(messagesTable.senderId, userId), eq(messagesTable.type, "text"), eq(messagesTable.authorKind, "user")))
    .orderBy(desc(messagesTable.createdAt))
    .limit(120);
  const messages = rows.map((row) => sanitizeText(row.content)).filter((content) => content.length > 0);
  const totalLength = messages.reduce((sum, message) => sum + message.length, 0);
  const averageMessageLength = messages.length > 0 ? Math.round(totalLength / messages.length) : 0;
  const laughterCount = messages.filter((message) => /ㅋ|ㅎ/.test(message)).length;
  const honorificCount = messages.filter((message) => /(요|습니다|세요|드립니다|합니다)([.!?~\s]|$)/.test(message)).length;
  const emojiCount = messages.filter((message) => /ㅠ|ㅜ|~{2,}|!{2,}|\?{2,}/.test(message)).length;
  const commonPhrases = Array.from(
    new Set(
      messages
        .flatMap((message) => message.split(/\s+/))
        .map((word) => word.replace(/[.,!?~]/g, ""))
        .filter((word) => word.length >= 2 && word.length <= 8),
    ),
  ).slice(0, 12);
  const honorificStyle: AnotherMeHonorificStyle = honorificCount / Math.max(1, messages.length) > 0.65 ? "JONDAETMAL" : honorificCount === 0 ? "BANMAL" : "MIXED";
  const toneSummary = messages.length === 0
    ? "아직 말투 데이터가 충분하지 않습니다. 관계 유형 기본 말투를 사용합니다."
    : `평균 ${averageMessageLength}자 정도로 답하고, ${honorificStyle === "JONDAETMAL" ? "존댓말" : honorificStyle === "BANMAL" ? "반말" : "반말과 존댓말을 섞는"} 경향이 있습니다. ㅋㅋ/ㅎㅎ 사용 빈도는 ${Math.round((laughterCount / Math.max(1, messages.length)) * 100)}%입니다.`;

  const values = {
    userId,
    relationshipType,
    toneSummary,
    honorificStyle,
    averageMessageLength,
    emojiUsageLevel: Math.round((emojiCount / Math.max(1, messages.length)) * 100),
    laughterUsageLevel: Math.round((laughterCount / Math.max(1, messages.length)) * 100),
    formalityLevel: Math.round((honorificCount / Math.max(1, messages.length)) * 100),
    warmthLevel: 55,
    humorLevel: Math.round((laughterCount / Math.max(1, messages.length)) * 100),
    commonPhrasesJson: commonPhrases,
    forbiddenPhrasesJson: [],
    updatedAt: new Date(),
  };
  const [profile] = await db
    .insert(anotherMeToneProfilesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [anotherMeToneProfilesTable.userId, anotherMeToneProfilesTable.relationshipType],
      set: values,
    })
    .returning();
  return profile;
}
