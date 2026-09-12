import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { AccessToken, RoomServiceClient, WebhookReceiver } from "livekit-server-sdk";
import {
  db,
  callsTable,
  callControlOperationsTable,
  callUserLocksTable,
  usersTable,
  messagesTable,
  chatRoomsTable,
  chatRoomMembersTable,
  blockedUsersTable,
  characterProfilesTable,
} from "@workspace/db";
import type { Call } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { toPublicUser } from "../lib/publicUser";
import { rateLimit } from "../lib/rateLimit";
import { sendCallPush, sendCallTerminalPush, incomingCallData } from "../lib/push";
import { logger } from "../lib/logger";
import { publishRealtimeEvent } from "../lib/realtime";
import { allocateRoomMessageSeq, setMemberReadSeq } from "../lib/readReceipts";
import {
  CALL_TOKEN_TTL_SECONDS,
  callTokenGrant,
  callDurationSec,
  isTerminalCallStatus,
  terminalCallStatuses,
  type CallMedia,
  type TerminalCallStatus,
} from "../lib/callLifecycle";
import {
  applyCallControlOperation,
  CallControlAccessError,
  CallAttemptConflictError,
  CallOperationConflictError,
  callAttemptMatches,
  transitionCallToTerminal,
  type CallControlAction,
} from "../lib/callControl";
import {
  classifyLiveKitRoomLookupError,
  decideCallPresence,
  DEFAULT_CALL_PRESENCE_POLICY,
  type CallPresencePolicy,
} from "../lib/callReconciliation";
import {
  callDiagnosticPhaseSchema,
  callDiagnosticPlatformSchema,
  callDiagnosticRoleSchema,
  sanitizeCallDiagnosticDetails,
} from "../lib/callDiagnostics";
import { ensureCharacterProfileState, resolveCharacterProfileActor } from "../lib/characterProfiles";

const router: IRouter = Router();
const createCallSchema = z.object({
  calleeId: z.uuid(),
  roomId: z.uuid().optional(),
  media: z.enum(["audio", "video"]).optional(),
}).strict();
const callDiagnosticSchema = z.object({
  phase: callDiagnosticPhaseSchema,
  platform: callDiagnosticPlatformSchema.optional(),
  role: callDiagnosticRoleSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();
const queuedCallDiagnosticSchema = z.object({
  eventId: z.uuid(),
  attemptId: z.uuid(),
  callId: z.uuid().optional(),
  phase: callDiagnosticPhaseSchema,
  platform: callDiagnosticPlatformSchema.optional(),
  role: callDiagnosticRoleSchema.optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  details: z.record(z.string().trim().min(1).max(50), z.unknown()).optional(),
}).strict();

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

const RING_TIMEOUT_MS = 45_000;
const ROOM_TERMINATION_RETRY_MS = 30_000;
const DEFAULT_CALL_WORKER_BATCH_SIZE = 25;
const DEFAULT_RECONCILIATION_POLL_MS = 15_000;
const DEFAULT_RECONCILIATION_LEASE_MS = 60_000;
const DEFAULT_LIVEKIT_ADMIN_TIMEOUT_SECONDS = 8;
const DEFAULT_CALL_OPERATION_RETENTION_DAYS = 30;
const DEFAULT_CALL_OPERATION_CLEANUP_BATCH_SIZE = 250;
const CALL_IDEMPOTENCY_HEADER = "x-idempotency-key";
const CALL_ATTEMPT_HEADER = "x-call-attempt-id";
const callControlRateLimit = rateLimit({ name: "call-control", limit: 120, windowSeconds: 60 });
const callDiagnosticRateLimit = rateLimit({ name: "call-diagnostics", limit: 240, windowSeconds: 60 });

function configuredAttemptHeaderCutoff(): Date | null {
  const raw = process.env.CALL_ATTEMPT_HEADER_ENFORCE_AFTER?.trim();
  if (!raw) {
    logger.warn(
      "CALL_ATTEMPT_HEADER_ENFORCE_AFTER is unset; missing call attempt headers remain temporarily compatible",
    );
    return null;
  }
  const parsed = z.iso.datetime({ offset: true }).safeParse(raw);
  if (!parsed.success) {
    logger.error(
      "CALL_ATTEMPT_HEADER_ENFORCE_AFTER is invalid; missing call attempt headers remain temporarily compatible",
    );
    return null;
  }
  return new Date(parsed.data);
}

// This is intentionally an operator-selected release cutoff, not a hard-coded
// calendar date. Existing legacy rows (attempt_id IS NULL) always remain usable.
const CALL_ATTEMPT_HEADER_ENFORCE_AFTER = configuredAttemptHeaderCutoff();

function livekitConfigured(): boolean {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return false;
  try {
    new URL(LIVEKIT_URL);
    return true;
  } catch {
    return false;
  }
}

function normalizeCallMedia(value: unknown): CallMedia {
  return value === "video" ? "video" : "audio";
}

function mediaFromCall(call: Pick<Call, "media">): CallMedia {
  return normalizeCallMedia(call.media);
}

function livekitServiceUrl(): string {
  const url = new URL(LIVEKIT_URL!);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.toString().replace(/\/$/, "");
}

function livekitRoomService(): RoomServiceClient {
  return new RoomServiceClient(livekitServiceUrl(), LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, {
    requestTimeout: envNumberInRange(
      "LIVEKIT_ADMIN_REQUEST_TIMEOUT_SECONDS",
      DEFAULT_LIVEKIT_ADMIN_TIMEOUT_SECONDS,
      2,
      30,
    ),
  });
}

function isNotFoundError(err: unknown): boolean {
  const value = err as { code?: unknown; status?: unknown; message?: unknown } | null;
  return (
    value?.code === 5 ||
    value?.status === 404 ||
    (typeof value?.message === "string" && /not found/i.test(value.message))
  );
}

function envPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envNumberInRange(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function optionalUuidHeader(req: Request, name: string): string | undefined | null {
  const value = req.get(name)?.trim();
  if (!value) return undefined;
  return z.uuid().safeParse(value).success ? value : null;
}

function callPresencePolicy(): CallPresencePolicy {
  return {
    initialConnectionGraceMs: envNumberInRange(
      "CALL_INITIAL_CONNECTION_GRACE_MS",
      DEFAULT_CALL_PRESENCE_POLICY.initialConnectionGraceMs,
      30_000,
      300_000,
    ),
    emptyRoomGraceMs: envNumberInRange(
      "CALL_EMPTY_ROOM_GRACE_MS",
      DEFAULT_CALL_PRESENCE_POLICY.emptyRoomGraceMs,
      30_000,
      600_000,
    ),
    singleParticipantGraceMs: envNumberInRange(
      "CALL_SINGLE_PARTICIPANT_GRACE_MS",
      DEFAULT_CALL_PRESENCE_POLICY.singleParticipantGraceMs,
      60_000,
      900_000,
    ),
  };
}

async function findCall(id: string): Promise<Call | undefined> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, id));
  return call;
}

// Acceptance is a ringing-only compare-and-set. Terminal transitions and their
// call-specific lock release live in callControl.ts.
async function activateCall(callId: string): Promise<Call | undefined> {
  const [updated] = await db
    .update(callsTable)
    .set({ status: "active", acceptedAt: new Date() })
    .where(and(eq(callsTable.id, callId), eq(callsTable.status, "ringing")))
    .returning();
  return updated;
}

async function createToken(
  roomName: string,
  identity: string,
  name: string,
  media: CallMedia,
  canPublish: boolean,
): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, {
    identity,
    name,
    ttl: CALL_TOKEN_TTL_SECONDS,
  });
  at.addGrant(callTokenGrant(roomName, media, canPublish));
  return at.toJwt();
}

async function activeCallSession(callId: string, userId: string, name: string): Promise<{
  call: Call;
  token: string;
} | null> {
  return db.transaction(async (tx) => {
    // Serialize token issuance with terminal updates. A transition cannot delete
    // the participant lock until this active-state check and signature complete.
    const [call] = await tx
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.id, callId),
          eq(callsTable.status, "active"),
          or(eq(callsTable.callerId, userId), eq(callsTable.calleeId, userId)),
        ),
      )
      .for("update");
    if (!call) return null;
    const locks = await tx
      .select({ userId: callUserLocksTable.userId })
      .from(callUserLocksTable)
      .where(eq(callUserLocksTable.callId, call.id));
    const lockedUsers = new Set(locks.map((lock) => lock.userId));
    if (!lockedUsers.has(call.callerId) || !lockedUsers.has(call.calleeId)) return null;
    return {
      call,
      token: await createToken(call.roomName, userId, name, mediaFromCall(call), true),
    };
  });
}

async function terminateLiveKitRoom(call: Call, log = logger, force = false): Promise<boolean> {
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - ROOM_TERMINATION_RETRY_MS);
  const [claimed] = await db
    .update(callsTable)
    .set({ roomTerminationAttemptedAt: now })
    .where(
      and(
        eq(callsTable.id, call.id),
        isNull(callsTable.roomTerminatedAt),
        ...(force
          ? []
          : [
              or(
                isNull(callsTable.roomTerminationAttemptedAt),
                lt(callsTable.roomTerminationAttemptedAt, retryCutoff),
              ),
            ]),
      ),
    )
    .returning();
  if (!claimed) return true;

  if (!livekitConfigured()) {
    log.warn({ callId: call.id }, "LiveKit is unavailable; room termination will be retried");
    return false;
  }

  try {
    await livekitRoomService().deleteRoom(claimed.roomName);
  } catch (err) {
    if (!isNotFoundError(err)) {
      log.warn({ err, callId: call.id }, "Failed to terminate LiveKit call room");
      return false;
    }
  }

  await db
    .update(callsTable)
    .set({ roomTerminatedAt: new Date() })
    .where(and(eq(callsTable.id, call.id), isNull(callsTable.roomTerminatedAt)));
  return true;
}

async function settleTerminalCall(
  call: Call,
  actorUserId?: string | null,
  log = logger,
): Promise<void> {
  const media = mediaFromCall(call);
  const [messageResult, roomResult, pushResult] = await Promise.allSettled([
    endCallMessage(
      call.id,
      call.status as TerminalCallStatus,
      call.status === "ended" ? callDurationSec(call.acceptedAt, call.endedAt) : undefined,
      media,
    ),
    terminateLiveKitRoom(call, log, true).then((completed) => {
      if (!completed) throw new Error("LiveKit room termination deferred");
    }),
    sendCallTerminalPush([call.callerId, call.calleeId], {
      callId: call.id,
      status: call.status as TerminalCallStatus,
      chatRoomId: call.chatRoomId ?? null,
      media,
    }),
  ]);
  if (messageResult.status === "rejected") {
    log.error({ err: messageResult.reason, callId: call.id }, "Failed to finalize call message");
  }
  if (roomResult.status === "rejected") {
    log.error({ err: roomResult.reason, callId: call.id }, "Failed to schedule LiveKit room termination");
  }
  if (pushResult.status === "rejected") {
    log.error({ err: pushResult.reason, callId: call.id }, "Failed to send terminal call push");
  }
  publishCallRealtimeEvent(call, "call.updated", actorUserId, media);
}

async function listExpectedLiveKitParticipants(call: Call): Promise<number> {
  try {
    const participants = await livekitRoomService().listParticipants(call.roomName);
    const expected = new Set([call.callerId, call.calleeId]);
    return new Set(participants.map((participant) => participant.identity).filter((id) => expected.has(id))).size;
  } catch (err) {
    // A missing room is an authoritative zero-participant observation. Network,
    // auth and rate-limit errors are not evidence that a live call ended.
    if (classifyLiveKitRoomLookupError(err) === "missing") return 0;
    throw err;
  }
}

export async function recordParticipantObservation(
  call: Call,
  participantCount: number,
  observedAt: Date,
): Promise<{ decision: ReturnType<typeof decideCallPresence>; call: Call } | null> {
  const claim = call.livekitReconciliationClaimedAt;
  if (!claim) return null;
  const decision = decideCallPresence({
    acceptedAt: call.acceptedAt ?? call.createdAt,
    observedAt,
    expectedParticipantCount: participantCount,
    previousParticipantCount: call.livekitParticipantCount,
    previousDeficitSince: call.livekitParticipantDeficitAt,
    policy: callPresencePolicy(),
  });
  const [updated] = await db
    .update(callsTable)
    .set({
      livekitParticipantCount: decision.participantCount,
      livekitParticipantDeficitAt: decision.deficitSince,
      livekitLastObservedAt: observedAt,
      ...(participantCount > 0 ? { livekitLastParticipantAt: observedAt } : {}),
    })
    .where(
      and(
        eq(callsTable.id, call.id),
        eq(callsTable.status, "active"),
        eq(callsTable.livekitReconciliationClaimedAt, claim),
      ),
    )
    .returning();
  return updated ? { decision, call: updated } : null;
}

async function claimActiveCallForReconciliation(
  callId: string,
  options: { observationCutoff?: Date; claimCutoff?: Date } = {},
): Promise<Call | undefined> {
  const claimedAt = new Date();
  const claimCutoff = options.claimCutoff ?? new Date(
    claimedAt.getTime() - envNumberInRange(
      "CALL_RECONCILIATION_LEASE_MS",
      DEFAULT_RECONCILIATION_LEASE_MS,
      15_000,
      300_000,
    ),
  );
  const [claimed] = await db
    .update(callsTable)
    .set({ livekitReconciliationClaimedAt: claimedAt })
    .where(
      and(
        eq(callsTable.id, callId),
        eq(callsTable.status, "active"),
        ...(options.observationCutoff
          ? [
              or(
                isNull(callsTable.livekitLastObservedAt),
                lt(callsTable.livekitLastObservedAt, options.observationCutoff),
              ),
            ]
          : []),
        or(
          isNull(callsTable.livekitReconciliationClaimedAt),
          lt(callsTable.livekitReconciliationClaimedAt, claimCutoff),
        ),
      ),
    )
    .returning();
  return claimed;
}

async function releaseReconciliationClaim(call: Call): Promise<void> {
  if (!call.livekitReconciliationClaimedAt) return;
  await db
    .update(callsTable)
    .set({ livekitReconciliationClaimedAt: null })
    .where(
      and(
        eq(callsTable.id, call.id),
        eq(callsTable.status, "active"),
        eq(callsTable.livekitReconciliationClaimedAt, call.livekitReconciliationClaimedAt),
      ),
    );
}

async function reconcileActiveCall(call: Call, log = logger): Promise<"observed" | "terminated" | "skipped"> {
  if (
    call.status !== "active" ||
    !call.livekitReconciliationClaimedAt ||
    !livekitConfigured()
  ) return "skipped";
  try {
    const locks = await db
      .select({ userId: callUserLocksTable.userId })
      .from(callUserLocksTable)
      .where(eq(callUserLocksTable.callId, call.id));
    const lockedUsers = new Set(locks.map((lock) => lock.userId));
    if (!lockedUsers.has(call.callerId) || !lockedUsers.has(call.calleeId) || lockedUsers.size !== 2) {
      // Missing participant locks can allow overlapping calls. Fail this exact
      // generation rather than trying to steal a lock that may belong to a newer
      // call. The claim token prevents an expired worker from acting later.
      const updated = await transitionCallToTerminal(call.id, ["active"], "failed", {
        reconciliationClaimedAt: call.livekitReconciliationClaimedAt,
      });
      if (!updated) return "skipped";
      log.error({ callId: call.id, lockCount: lockedUsers.size }, "Recovered call with inconsistent locks");
      await settleTerminalCall(updated, undefined, log);
      return "terminated";
    }
    const observedAt = new Date();
    const participantCount = await listExpectedLiveKitParticipants(call);
    const recorded = await recordParticipantObservation(call, participantCount, observedAt);
    if (!recorded) return "skipped";
    const { decision } = recorded;
    log.debug(
      {
        callId: call.id,
        attemptId: call.attemptId,
        participantCount,
        reconciliationReason: decision.reason,
        deficitSince: decision.deficitSince?.toISOString() ?? null,
      },
      "Call room reconciled",
    );
    if (!decision.shouldTerminate) return "observed";

    // Fence the terminal transition with a second authoritative observation.
    // The same claim token must still own the row, so a newer healthy observation
    // can never be overwritten by this older reconciliation generation.
    const confirmedCount = await listExpectedLiveKitParticipants(recorded.call);
    if (confirmedCount !== participantCount) {
      return (await recordParticipantObservation(recorded.call, confirmedCount, new Date()))
        ? "observed"
        : "skipped";
    }

    const updated = await transitionCallToTerminal(call.id, ["active"], "ended", {
      reconciliationClaimedAt: call.livekitReconciliationClaimedAt,
    });
    if (!updated) return "skipped";
    log.warn(
      {
        callId: updated.id,
        attemptId: updated.attemptId,
        participantCount,
        reconciliationReason: "persistent-livekit-participant-deficit",
      },
      "Recovered stale active call",
    );
    await settleTerminalCall(updated, undefined, log);
    return "terminated";
  } finally {
    await releaseReconciliationClaim(call);
  }
}

let webhookReceiver: WebhookReceiver | undefined;

/** Raw-body endpoint mounted before express.json() in app.ts. */
export async function handleLiveKitWebhook(req: Request, res: Response): Promise<void> {
  if (!livekitConfigured()) {
    res.status(503).json({ error: "LiveKit is not configured" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Raw webhook body is required" });
    return;
  }
  webhookReceiver ??= new WebhookReceiver(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!);
  let event: Awaited<ReturnType<WebhookReceiver["receive"]>>;
  try {
    event = await webhookReceiver.receive(req.body.toString("utf8"), req.get("Authorization"));
  } catch (err) {
    req.log.warn(
      { errorName: err instanceof Error ? err.name : "unknown" },
      "Rejected LiveKit webhook signature",
    );
    res.status(401).json({ error: "Invalid LiveKit webhook" });
    return;
  }
  try {
    const roomName = event.room?.name;
    if (!roomName) {
      res.status(204).end();
      return;
    }
    const [call] = await db.select().from(callsTable).where(eq(callsTable.roomName, roomName));
    if (!call || call.status !== "active") {
      res.status(204).end();
      return;
    }
    // Webhooks reduce detection latency but never directly terminate a call.
    // The same authoritative room listing and persisted grace policy used by
    // the periodic worker remains the source of truth if webhooks are lost,
    // duplicated or delivered late.
    if (
      event.event === "room_finished" ||
      event.event === "participant_joined" ||
      event.event === "participant_left" ||
      event.event === "participant_connection_aborted"
    ) {
      // Webhook and periodic observations share the same fenced lease. Duplicate
      // or concurrent events therefore cannot overwrite a newer healthy sample.
      const claimed = await claimActiveCallForReconciliation(call.id);
      if (claimed) await reconcileActiveCall(claimed, req.log);
    }
    res.status(204).end();
  } catch (err) {
    req.log.warn({ err }, "LiveKit webhook processing failed");
    res.status(503).json({ error: "LiveKit webhook processing failed" });
  }
}

// Reads may still expire a call promptly, but the worker below performs this
// transition even when neither participant polls the API.
async function maybeExpire(call: Call): Promise<Call> {
  if (call.status !== "ringing" || Date.now() - call.createdAt.getTime() <= RING_TIMEOUT_MS) {
    return call;
  }
  const updated = await transitionCallToTerminal(call.id, ["ringing"], "missed");
  if (updated) {
    await settleTerminalCall(updated);
    return updated;
  }
  return (await findCall(call.id)) ?? call;
}

/** Whether either user has blocked the other (calls are mutually disallowed). */
async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ id: blockedUsersTable.blockerUserId })
    .from(blockedUsersTable)
    .where(
      or(
        and(
          eq(blockedUsersTable.blockerUserId, a),
          eq(blockedUsersTable.blockedUserId, b),
        ),
        and(
          eq(blockedUsersTable.blockerUserId, b),
          eq(blockedUsersTable.blockedUserId, a),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// Posts the in-chat "call" card (a messages row of type "call") so both parties
// can join the call straight from the conversation. The content carries the
// callId + status so the card can render a "통화 참여" button and later flip to
// "ended". Its foreign key binds the card to this exact call row.
export async function ensureCallMessage(call: Call): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Serialize create-path delivery and worker repair on this exact call. The
    // unique messages.call_id index is the final duplicate guard.
    const [current] = await tx
      .select()
      .from(callsTable)
      .where(eq(callsTable.id, call.id))
      .for("update");
    if (!current?.chatRoomId) return false;
    const [existing] = await tx
      .select({ createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(eq(messagesTable.callId, current.id));
    if (existing) {
      await tx
        .update(callsTable)
        .set({ callMessageCreatedAt: existing.createdAt })
        .where(eq(callsTable.id, current.id));
      return false;
    }

    const media = mediaFromCall(current);
    const terminal = isTerminalCallStatus(current.status);
    const payload: { callId: string; status: string; media: CallMedia; durationSec?: number } = {
      callId: current.id,
      // Keep the original joinable card contract for ringing/active calls. A
      // delayed repair after termination is born in the correct final state.
      status: terminal ? current.status : "ringing",
      media,
    };
    if (current.status === "ended") {
      const durationSec = callDurationSec(current.acceptedAt, current.endedAt);
      if (typeof durationSec === "number") payload.durationSec = durationSec;
    }
    const content = JSON.stringify(payload);
    const roomSeq = await allocateRoomMessageSeq(tx, current.chatRoomId);
    const [message] = await tx
      .insert(messagesTable)
      .values({
        roomId: current.chatRoomId,
        senderId: current.callerId,
        senderProfileId: current.callerProfileId,
        type: "call",
        content,
        callId: current.id,
        roomSeq,
      })
      .returning();
    await tx
      .update(chatRoomsTable)
      .set({ lastMessage: media === "video" ? "📹 영상통화" : "📞 보이스톡", lastMessageAt: new Date() })
      .where(
        and(
          eq(chatRoomsTable.id, current.chatRoomId),
          or(isNull(chatRoomsTable.lastMessageAt), lt(chatRoomsTable.lastMessageAt, current.createdAt)),
        ),
      );
    if (!terminal) {
      // A live call resurfaces the room for anyone who previously hid it. A
      // delayed repair for an already-finished call must not reopen the room.
      await tx
        .update(chatRoomMembersTable)
        .set({ hiddenAt: null })
        .where(eq(chatRoomMembersTable.roomId, current.chatRoomId));
    }
    // The caller has implicitly read their own call card so it never counts as
    // unread for them.
    await setMemberReadSeq(tx, current.chatRoomId, current.callerId, { id: message.id, roomSeq });
    await tx
      .update(callsTable)
      .set({ callMessageCreatedAt: message.createdAt })
      .where(eq(callsTable.id, current.id));
    return true;
  });
}

// Flips the in-chat call card to its FINAL state so the "통화 참여" button
// disappears and the card can render a distinct result (ended / missed /
// declined / cancelled / failed) with an optional duration. The card is located by its
// callId foreign key so only the matching server-created call card changes.
async function endCallMessage(
  callId: string,
  status: "ended" | "missed" | "declined" | "cancelled" | "failed",
  durationSec?: number | null,
  media?: CallMedia,
): Promise<void> {
  const payload: { callId: string; status: string; media: CallMedia; durationSec?: number } = {
    callId,
    status,
    media: media ?? "audio",
  };
  if (typeof durationSec === "number") payload.durationSec = durationSec;
  await db.transaction(async (tx) => {
    await tx
      .update(messagesTable)
      .set({ content: JSON.stringify(payload) })
      .where(and(eq(messagesTable.type, "call"), eq(messagesTable.callId, callId)));
    await tx
      .update(callsTable)
      .set({ terminalMessageFinalizedAt: new Date() })
      .where(and(eq(callsTable.id, callId), inArray(callsTable.status, terminalCallStatuses)));
  });
}

function serializeCall(c: Call, media: CallMedia = "audio") {
  return {
    id: c.id,
    attemptId: c.attemptId ?? null,
    roomName: c.roomName,
    callerId: c.callerId,
    callerProfileId: c.callerProfileId ?? null,
    calleeId: c.calleeId,
    calleeProfileId: c.calleeProfileId ?? null,
    chatRoomId: c.chatRoomId ?? null,
    media,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    acceptedAt: c.acceptedAt?.toISOString() ?? null,
    declinedAt: c.declinedAt?.toISOString() ?? null,
    missedAt: c.missedAt?.toISOString() ?? null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: callDurationSec(c.acceptedAt, c.endedAt),
  };
}

async function serializeCallWithMedia(c: Call) {
  return serializeCall(c, mediaFromCall(c));
}

function publishCallRealtimeEvent(
  call: Call,
  type: "call.created" | "call.updated",
  actorUserId?: string | null,
  media: CallMedia = "audio",
): void {
  void publishRealtimeEvent({
    type,
    callId: call.id,
    roomId: call.chatRoomId ?? null,
    actorUserId: actorUserId ?? null,
    userIds: [call.callerId, call.calleeId],
    data: { call: serializeCall(call, media) },
  }).catch((err) => logger.error({ err, callId: call.id, type }, "Failed to publish call realtime event"));
}

async function respondToCreateReplay(args: {
  req: Request;
  res: Response;
  call: Call;
  callerName: string;
  requestedCalleeId: string;
  requestedMedia: CallMedia;
}): Promise<void> {
  const { req, res, call, callerName, requestedCalleeId, requestedMedia } = args;
  if (call.calleeId !== requestedCalleeId || mediaFromCall(call) !== requestedMedia) {
    res.status(409).json({ error: "Call attempt identifier already used with different parameters" });
    return;
  }
  if (isTerminalCallStatus(call.status)) {
    res.status(409).json({ error: "이미 종료된 통화입니다", call: serializeCall(call, requestedMedia) });
    return;
  }
  const session = call.status === "active"
    ? await activeCallSession(call.id, call.callerId, callerName)
    : {
        call,
        token: await createToken(call.roomName, call.callerId, callerName, requestedMedia, false),
      };
  if (!session) {
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  req.log.info(
    { callId: call.id, attemptId: call.attemptId, phase: "call_create_replayed", media: requestedMedia },
    "Call create attempt replayed",
  );
  if (call.attemptId) res.set(CALL_ATTEMPT_HEADER, call.attemptId);
  res.json({ call: serializeCall(session.call, requestedMedia), token: session.token, url: LIVEKIT_URL });
}

router.post("/calls", requireAuth, rateLimit({ name: "create-call", limit: 10, windowSeconds: 60 }), async (req, res): Promise<void> => {
  const attemptId = optionalUuidHeader(req, CALL_ATTEMPT_HEADER);
  if (attemptId === null) {
    res.status(400).json({ error: "Invalid call attempt identifier" });
    return;
  }
  if (
    !attemptId &&
    CALL_ATTEMPT_HEADER_ENFORCE_AFTER &&
    new Date() >= CALL_ATTEMPT_HEADER_ENFORCE_AFTER
  ) {
    res.status(400).json({ error: "Call attempt identifier is required" });
    return;
  }
  if (!livekitConfigured()) {
    res.status(503).json({ error: "음성 통화 서버가 설정되지 않았습니다" });
    return;
  }
  const userId = req.dbUser!.id;
  const parsed = createCallSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.calleeId === userId) {
    res.status(400).json({ error: "calleeId is required" });
    return;
  }
  const { calleeId, roomId } = parsed.data;
  const media = parsed.data.media ?? "audio";
  const callerProfile = await resolveCharacterProfileActor(userId, req.header("x-character-profile-id"));

  if (attemptId) {
    const [existing] = await db
      .select()
      .from(callsTable)
      .where(and(eq(callsTable.callerId, userId), eq(callsTable.attemptId, attemptId)));
    if (existing) {
      await respondToCreateReplay({
        req,
        res,
        call: existing,
        callerName: callerProfile.displayName,
        requestedCalleeId: calleeId,
        requestedMedia: media,
      });
      return;
    }
  }

  const [callee] = await db.select().from(usersTable).where(eq(usersTable.id, calleeId));
  if (!callee) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const calleeProfile = (await ensureCharacterProfileState(calleeId)).activeProfile;

  // Block list is mutual for calls: if either side blocked the other, the call
  // is refused. 403 (not 404) so the caller gets a clear, honest failure.
  if (await isBlockedBetween(userId, calleeId)) {
    res.status(403).json({ error: "차단된 상대에게는 전화를 걸 수 없습니다" });
    return;
  }

  // Validate the originating 1:1 room up front (used both to store chatRoomId on
  // the call row and to post the in-chat card). Only a "direct" room where BOTH
  // parties are members is trusted — otherwise an authenticated user could inject
  // a call card / mutate room metadata (lastMessage/hiddenAt) in arbitrary rooms.
  let validRoomId: string | null = null;
  if (roomId) {
    try {
      const [room] = await db
        .select({ type: chatRoomsTable.type })
        .from(chatRoomsTable)
        .where(eq(chatRoomsTable.id, roomId));
      const members = await db
        .select({ userId: chatRoomMembersTable.userId })
        .from(chatRoomMembersTable)
        .where(eq(chatRoomMembersTable.roomId, roomId));
      const memberIds = new Set(members.map((m) => m.userId));
      if (room?.type === "direct" && memberIds.has(userId) && memberIds.has(calleeId)) {
        validRoomId = roomId;
      } else {
        req.log.warn({ roomId, userId, calleeId }, "Skipped call card for invalid room");
      }
    } catch (err) {
      req.log.error({ err, roomId }, "Failed to validate call room");
    }
  }

  const roomName = `davaq_call_${crypto.randomUUID()}`;
  let call: Call;
  try {
    call = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(callsTable)
        .values({
          attemptId,
          roomName,
          callerId: userId,
          callerProfileId: callerProfile.id,
          calleeId,
          calleeProfileId: calleeProfile.id,
          chatRoomId: validRoomId,
          callMessageRepairEligibleAt: validRoomId ? new Date() : null,
          media,
          status: "ringing",
        })
        .returning();
      const participantIds = [userId, calleeId].sort();
      await tx.insert(callUserLocksTable).values(
        participantIds.map((participantId) => ({ userId: participantId, callId: created.id })),
      );
      return created;
    });
  } catch (err) {
    const cause = err as { cause?: { constraint?: unknown; code?: unknown }; constraint?: unknown; code?: unknown };
    const constraint = cause.constraint ?? cause.cause?.constraint;
    const code = cause.code ?? cause.cause?.code;
    if (
      code === "23505" &&
      attemptId &&
      typeof constraint === "string" &&
      constraint.includes("calls_caller_attempt")
    ) {
      const [existing] = await db
        .select()
        .from(callsTable)
        .where(and(eq(callsTable.callerId, userId), eq(callsTable.attemptId, attemptId)));
      if (existing) {
        await respondToCreateReplay({
          req,
          res,
          call: existing,
          callerName: callerProfile.displayName,
          requestedCalleeId: calleeId,
          requestedMedia: media,
        });
        return;
      }
    }
    if (code === "23505" && typeof constraint === "string" && constraint.includes("call_user_locks")) {
      res.status(409).json({ error: "통화 중인 사용자가 있어 전화를 걸 수 없습니다" });
      return;
    }
    throw err;
  }

  // Post the in-chat call card so both parties can join from the conversation.
  if (validRoomId) {
    try {
      await ensureCallMessage(call);
    } catch (err) {
      req.log.error({ err, roomId: validRoomId, callId: call.id }, "Failed to post call message");
    }
  }

  // Always-on voice-call push: ignores focus/away gating AND the user's
  // notification toggle so an incoming call is never silently missed. The data
  // payload lets the service worker route a tap straight to the incoming screen.
  void sendCallPush(calleeId, {
    title: media === "video" ? "영상통화" : "보이스톡",
    body:
      media === "video"
        ? `${callerProfile.displayName}님이 영상 통화를 걸었습니다`
        : `${callerProfile.displayName}님이 음성 통화를 걸었습니다`,
    url: validRoomId ? `/chat/${validRoomId}` : "/",
    tag: `call-${call.id}`,
    data: incomingCallData({
      callId: call.id,
      chatRoomId: validRoomId,
      callerUserId: userId,
      callerName: callerProfile.displayName,
      media,
    }),
  });

  // The initial session remains subscribe-only while ringing. The caller gets
  // media publish permission only through the active-only join endpoint.
  const token = await createToken(roomName, userId, callerProfile.displayName, media, false);
  if (attemptId) res.set(CALL_ATTEMPT_HEADER, attemptId);
  req.log.info({ callId: call.id, attemptId, phase: "call_created", media }, "Call attempt created");
  publishCallRealtimeEvent(call, "call.created", userId, media);
  res.status(201).json({ call: serializeCall(call, media), token, url: LIVEKIT_URL });
});

router.get("/calls/incoming", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const since = new Date(Date.now() - 60_000);
  const rows = await db
    .select()
    .from(callsTable)
    .where(
      and(
        eq(callsTable.calleeId, userId),
        eq(callsTable.status, "ringing"),
        gt(callsTable.createdAt, since),
      ),
    )
    .orderBy(desc(callsTable.createdAt));

  const result = await Promise.all(
    rows.map(async (c) => {
      // Authoritatively expire a >45s ringing call so it never surfaces as a
      // fresh incoming ring (the 60s query window is wider than the timeout).
      const fresh = await maybeExpire(c);
      if (fresh.status !== "ringing") return null;
      const [[caller], [callerProfile]] = await Promise.all([
        db.select().from(usersTable).where(eq(usersTable.id, fresh.callerId)),
        fresh.callerProfileId
          ? db.select().from(characterProfilesTable).where(eq(characterProfilesTable.id, fresh.callerProfileId))
          : Promise.resolve([]),
      ]);
      return caller ? {
        ...(await serializeCallWithMedia(fresh)),
        caller: {
          ...toPublicUser(caller),
          nickname: callerProfile?.displayName ?? caller.nickname,
          profileImageUrl: callerProfile?.profileImageUrl ?? null,
          profile: callerProfile ? {
            id: callerProfile.id,
            type: callerProfile.type,
            handle: callerProfile.handle,
            displayName: callerProfile.displayName,
            profileImageUrl: callerProfile.profileImageUrl,
          } : null,
        },
      } : null;
    }),
  );
  res.json(result.filter((r) => r !== null));
});

router.get("/calls/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, raw));
  if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const fresh = await maybeExpire(call);
  res.json(await serializeCallWithMedia(fresh));
});

router.post("/calls/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const attemptId = optionalUuidHeader(req, CALL_ATTEMPT_HEADER);
  if (attemptId === null) {
    res.status(400).json({ error: "Invalid call attempt identifier" });
    return;
  }
  if (!livekitConfigured()) {
    res.status(503).json({ error: "음성 통화 서버가 설정되지 않았습니다" });
    return;
  }
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, raw));
  if (!call || call.calleeId !== userId) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!callAttemptMatches(call, attemptId, CALL_ATTEMPT_HEADER_ENFORCE_AFTER)) {
    res.status(409).json({ error: "Call attempt identifier does not match this call" });
    return;
  }
  const fresh = await maybeExpire(call);
  if (fresh.status === "active") {
    const session = await activeCallSession(raw, userId, req.dbUser!.nickname);
    if (session) {
      res.json({ call: await serializeCallWithMedia(session.call), token: session.token, url: LIVEKIT_URL });
      return;
    }
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  if (fresh.status !== "ringing") {
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  const updated = await activateCall(raw);
  if (!updated) {
    const latest = await findCall(raw);
    if (latest?.status === "active") {
      const session = await activeCallSession(raw, userId, req.dbUser!.nickname);
      if (session) {
        res.json({ call: await serializeCallWithMedia(session.call), token: session.token, url: LIVEKIT_URL });
        return;
      }
    }
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  const session = await activeCallSession(raw, userId, req.dbUser!.nickname);
  if (!session) {
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  const media = mediaFromCall(updated);
  req.log.info({ callId: raw, attemptId, phase: "call_accepted", media }, "Call attempt accepted");
  publishCallRealtimeEvent(updated, "call.updated", userId, media);
  res.json({ call: serializeCall(updated, media), token: session.token, url: LIVEKIT_URL });
});

async function handleCallControl(
  req: Request,
  res: Response,
  action: CallControlAction,
): Promise<void> {
  const userId = req.dbUser!.id;
  const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const operationId = optionalUuidHeader(req, CALL_IDEMPOTENCY_HEADER);
  const attemptId = optionalUuidHeader(req, CALL_ATTEMPT_HEADER);
  if (operationId === null || attemptId === null) {
    res.status(400).json({ error: "Invalid call operation identifier" });
    return;
  }
  try {
    const result = await applyCallControlOperation({
      callId,
      actorUserId: userId,
      action,
      operationId,
      attemptId,
      enforceAttemptHeaderAfter: CALL_ATTEMPT_HEADER_ENFORCE_AFTER,
    });
    req.log.info(
      {
        callId,
        attemptId,
        operationId,
        action,
        replayed: result.replayed,
        transitioned: result.transitioned,
        resultStatus: result.call.status,
      },
      "Call control operation",
    );
    if (result.transitioned) {
      await settleTerminalCall(result.call, userId, req.log);
    }
    res.json(await serializeCallWithMedia(result.call));
  } catch (err) {
    if (err instanceof CallControlAccessError) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    if (err instanceof CallAttemptConflictError) {
      res.status(409).json({ error: "Call attempt identifier does not match this call" });
      return;
    }
    if (err instanceof CallOperationConflictError) {
      res.status(409).json({ error: "Idempotency key already used for another operation" });
      return;
    }
    throw err;
  }
}

router.post("/calls/:id/decline", requireAuth, callControlRateLimit, async (req, res): Promise<void> => {
  await handleCallControl(req, res, "decline");
});

// Cancel an outgoing call before it is answered. Caller-only; only a still-
// ringing call can be cancelled (once accepted, use /end instead).
router.post("/calls/:id/cancel", requireAuth, callControlRateLimit, async (req, res): Promise<void> => {
  await handleCallControl(req, res, "cancel");
});

router.post("/calls/:id/end", requireAuth, callControlRateLimit, async (req, res): Promise<void> => {
  await handleCallControl(req, res, "end");
});

router.post("/calls/:id/failed", requireAuth, callControlRateLimit, async (req, res): Promise<void> => {
  await handleCallControl(req, res, "failed");
});

router.post(
  "/calls/diagnostics",
  requireAuth,
  callDiagnosticRateLimit,
  async (req, res): Promise<void> => {
    const parsed = queuedCallDiagnosticSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid call diagnostic" });
      return;
    }
    const userId = req.dbUser!.id;
    const body = parsed.data;
    let call: Call | undefined;
    if (body.callId) {
      call = await findCall(body.callId);
      if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
        res.status(404).json({ error: "Call not found" });
        return;
      }
      if (!callAttemptMatches(call, body.attemptId, CALL_ATTEMPT_HEADER_ENFORCE_AFTER)) {
        res.status(409).json({ error: "Call attempt identifier does not match this call" });
        return;
      }
    }
    req.log.info(
      {
        eventId: body.eventId,
        attemptId: body.attemptId,
        callId: body.callId ?? null,
        media: call ? mediaFromCall(call) : undefined,
        callStatus: call?.status,
        phase: body.phase,
        platform: body.platform,
        role: body.role,
        occurredAt: body.occurredAt,
        details: sanitizeCallDiagnosticDetails(body.details),
      },
      "Call diagnostic",
    );
    res.status(204).end();
  },
);

router.post("/calls/:id/diagnostics", requireAuth, callDiagnosticRateLimit, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const attemptId = optionalUuidHeader(req, CALL_ATTEMPT_HEADER);
  if (attemptId === null) {
    res.status(400).json({ error: "Invalid call attempt identifier" });
    return;
  }
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, raw));
  if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!callAttemptMatches(call, attemptId, CALL_ATTEMPT_HEADER_ENFORCE_AFTER)) {
    res.status(409).json({ error: "Call attempt identifier does not match this call" });
    return;
  }
  const parsed = callDiagnosticSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid call diagnostic" });
    return;
  }
  const body = parsed.data;
  req.log.info(
    {
      callId: raw,
      media: mediaFromCall(call),
      callStatus: call.status,
      phase: body.phase,
      platform: body.platform,
      role: body.role,
      attemptId,
      details: sanitizeCallDiagnosticDetails(body.details),
    },
    "Call diagnostic",
  );
  res.status(204).end();
});

// Join an active call from its in-chat card. A callee can accept by joining a
// ringing call; callers cannot obtain a media token until that transition wins.
router.post("/calls/:id/join", requireAuth, async (req, res): Promise<void> => {
  const attemptId = optionalUuidHeader(req, CALL_ATTEMPT_HEADER);
  if (attemptId === null) {
    res.status(400).json({ error: "Invalid call attempt identifier" });
    return;
  }
  if (!livekitConfigured()) {
    res.status(503).json({ error: "음성 통화 서버가 설정되지 않았습니다" });
    return;
  }
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [found] = await db.select().from(callsTable).where(eq(callsTable.id, raw));
  if (!found || (found.callerId !== userId && found.calleeId !== userId)) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!callAttemptMatches(found, attemptId, CALL_ATTEMPT_HEADER_ENFORCE_AFTER)) {
    res.status(409).json({ error: "Call attempt identifier does not match this call" });
    return;
  }
  // Lazily expire a long-unanswered ringing call so a stale card can't be joined.
  const call = await maybeExpire(found);
  if (isTerminalCallStatus(call.status)) {
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  let current = call;
  if (call.status === "ringing") {
    if (call.callerId === userId) {
      res.status(409).json({ error: "상대방의 수락을 기다리는 중입니다" });
      return;
    }
    const updated = await activateCall(raw);
    if (!updated) {
      const latest = await findCall(raw);
      if (latest?.status !== "active") {
        res.status(409).json({ error: "이미 종료된 통화입니다" });
        return;
      }
      current = latest;
    } else {
      current = updated;
      publishCallRealtimeEvent(updated, "call.updated", userId, mediaFromCall(updated));
    }
  }
  if (current.status !== "active") {
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  const session = await activeCallSession(raw, userId, req.dbUser!.nickname);
  if (!session) {
    // A terminal transition that won after the local read removes the lock, so
    // this guard prevents issuing a token for that now-invalid call.
    res.status(409).json({ error: "이미 종료된 통화입니다" });
    return;
  }
  req.log.info(
    { callId: raw, attemptId, phase: "call_join_token_issued", media: mediaFromCall(session.call) },
    "Call join token issued",
  );
  res.json({ call: await serializeCallWithMedia(session.call), token: session.token, url: LIVEKIT_URL });
});

export async function pruneExpiredCallControlOperations(now = new Date()): Promise<number> {
  const retentionDays = envNumberInRange(
    "CALL_OPERATION_RETENTION_DAYS",
    DEFAULT_CALL_OPERATION_RETENTION_DAYS,
    1,
    365,
  );
  const batchSize = Math.trunc(envNumberInRange(
    "CALL_OPERATION_CLEANUP_BATCH_SIZE",
    DEFAULT_CALL_OPERATION_CLEANUP_BATCH_SIZE,
    10,
    2_000,
  ));
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
  const expired = await db
    .select({ operationId: callControlOperationsTable.operationId })
    .from(callControlOperationsTable)
    .where(lt(callControlOperationsTable.createdAt, cutoff))
    .orderBy(asc(callControlOperationsTable.createdAt))
    .limit(batchSize);
  if (expired.length === 0) return 0;
  const removed = await db
    .delete(callControlOperationsTable)
    .where(inArray(callControlOperationsTable.operationId, expired.map((row) => row.operationId)))
    .returning({ operationId: callControlOperationsTable.operationId });
  return removed.length;
}

export async function processCallLifecycleBatch(log = logger): Promise<number> {
  const batchSize = envPositiveNumber("CALL_LIFECYCLE_WORKER_BATCH_SIZE", DEFAULT_CALL_WORKER_BATCH_SIZE);
  const expiryCutoff = new Date(Date.now() - RING_TIMEOUT_MS);
  const expired = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.status, "ringing"), lt(callsTable.createdAt, expiryCutoff)))
    .orderBy(callsTable.createdAt)
    .limit(batchSize);

  let processed = 0;
  for (const call of expired) {
    const updated = await transitionCallToTerminal(call.id, ["ringing"], "missed");
    if (!updated) continue;
    processed += 1;
    await settleTerminalCall(updated, undefined, log);
  }

  // Repair historical/manual inconsistencies as well. This never deletes by
  // user id, so a lock belonging to a newer call generation is untouchable.
  const staleLockCalls = await db
    .selectDistinct({ callId: callUserLocksTable.callId })
    .from(callUserLocksTable)
    .innerJoin(callsTable, eq(callsTable.id, callUserLocksTable.callId))
    .where(inArray(callsTable.status, terminalCallStatuses))
    .limit(batchSize);
  for (const { callId } of staleLockCalls) {
    const removed = await db
      .delete(callUserLocksTable)
      .where(eq(callUserLocksTable.callId, callId))
      .returning({ userId: callUserLocksTable.userId });
    if (removed.length > 0) {
      processed += 1;
      log.warn({ callId, lockCount: removed.length }, "Removed stale terminal call locks");
    }
  }

  if (livekitConfigured()) {
    const now = Date.now();
    const observationCutoff = new Date(
      now - envNumberInRange("CALL_RECONCILIATION_POLL_MS", DEFAULT_RECONCILIATION_POLL_MS, 5_000, 60_000),
    );
    const claimCutoff = new Date(
      now - envNumberInRange("CALL_RECONCILIATION_LEASE_MS", DEFAULT_RECONCILIATION_LEASE_MS, 15_000, 300_000),
    );
    const active = await db
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.status, "active"),
          or(
            isNull(callsTable.livekitLastObservedAt),
            lt(callsTable.livekitLastObservedAt, observationCutoff),
          ),
          or(
            isNull(callsTable.livekitReconciliationClaimedAt),
            lt(callsTable.livekitReconciliationClaimedAt, claimCutoff),
          ),
        ),
      )
      .orderBy(asc(callsTable.livekitLastObservedAt), asc(callsTable.acceptedAt))
      .limit(batchSize);
    for (const call of active) {
      try {
        // Both API replicas run this worker. Atomically lease one call so only
        // one replica spends a LiveKit admin request on the same generation.
        const claimed = await claimActiveCallForReconciliation(call.id, {
          observationCutoff,
          claimCutoff,
        });
        if (!claimed) continue;
        const result = await reconcileActiveCall(claimed, log);
        if (result !== "skipped") processed += 1;
      } catch (err) {
        // An unavailable LiveKit admin API must never be interpreted as an empty
        // room or release a call lock. Continue reconciling other calls.
        log.warn({ err, callId: call.id }, "Call room reconciliation failed");
      }
    }
  }

  // Creating the durable call row and delivering its in-chat card cannot be a
  // single transaction. Repair the bounded, idempotent side effect after a
  // process crash or response loss; messages.call_id prevents duplicates.
  const pendingCallMessages = await db
    .select()
    .from(callsTable)
    .where(
      and(
        isNotNull(callsTable.callMessageRepairEligibleAt),
        isNotNull(callsTable.chatRoomId),
        isNull(callsTable.callMessageCreatedAt),
      ),
    )
    .orderBy(asc(callsTable.callMessageRepairEligibleAt))
    .limit(batchSize);
  for (const call of pendingCallMessages) {
    try {
      if (await ensureCallMessage(call)) processed += 1;
    } catch (err) {
      log.warn({ err, callId: call.id }, "Call message creation retry failed");
    }
  }

  // The state transition commits before external side effects. If the process
  // exits in that gap, repair the durable in-chat call card after restart. The
  // update is idempotent and scoped by call_id.
  const pendingMessageFinalization = await db
    .select()
    .from(callsTable)
    .where(
      and(
        inArray(callsTable.status, terminalCallStatuses),
        isNotNull(callsTable.terminalMessageRepairEligibleAt),
        isNull(callsTable.terminalMessageFinalizedAt),
      ),
    )
    .orderBy(asc(callsTable.terminalMessageRepairEligibleAt))
    .limit(batchSize);
  for (const call of pendingMessageFinalization) {
    try {
      await endCallMessage(
        call.id,
        call.status as TerminalCallStatus,
        call.status === "ended" ? callDurationSec(call.acceptedAt, call.endedAt) : undefined,
        mediaFromCall(call),
      );
      processed += 1;
    } catch (err) {
      log.warn({ err, callId: call.id }, "Call message finalization retry failed");
    }
  }

  const retryCutoff = new Date(Date.now() - ROOM_TERMINATION_RETRY_MS);
  const pendingTermination = await db
    .select()
    .from(callsTable)
    .where(
      and(
        inArray(callsTable.status, terminalCallStatuses),
        isNull(callsTable.roomTerminatedAt),
        or(
          isNull(callsTable.roomTerminationAttemptedAt),
          lt(callsTable.roomTerminationAttemptedAt, retryCutoff),
        ),
      ),
    )
    .orderBy(callsTable.endedAt)
    .limit(batchSize);
  for (const call of pendingTermination) {
    if (await terminateLiveKitRoom(call, log)) processed += 1;
  }
  try {
    processed += await pruneExpiredCallControlOperations();
  } catch (err) {
    // Retention is maintenance, never a reason to interrupt call recovery.
    log.warn({ err }, "Call operation retention cleanup failed");
  }
  return processed;
}

let callLifecycleWorkerStarted = false;
let callLifecycleWorkerRunning = false;

export function startCallLifecycleWorker(log = logger): void {
  if (callLifecycleWorkerStarted || process.env.CALL_LIFECYCLE_WORKER_ENABLED === "false") return;
  callLifecycleWorkerStarted = true;
  const intervalMs = envPositiveNumber("CALL_LIFECYCLE_WORKER_INTERVAL_MS", 5_000);
  const tick = () => {
    if (callLifecycleWorkerRunning) return;
    callLifecycleWorkerRunning = true;
    void processCallLifecycleBatch(log)
      .catch((err) => log.warn({ err }, "Call lifecycle worker tick failed"))
      .finally(() => {
        callLifecycleWorkerRunning = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

export default router;
