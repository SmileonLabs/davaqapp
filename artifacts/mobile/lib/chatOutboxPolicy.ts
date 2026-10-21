import type { MessageDeliveryState } from "./chatMessageReliability";

export type OutboxMessageType = "text" | "sticker" | "image" | "file";

export interface ChatOutboxEntry {
  clientMessageId: string;
  tempId: string;
  roomId: string;
  senderId: string;
  senderProfileId: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  type: OutboxMessageType;
  replyToMessageId: string | null;
  createdAt: number;
  retryStartedAt?: number;
  attempts: number;
  nextAttemptAt: number;
  deliveryState: MessageDeliveryState;
  retryable: boolean;
}

export const CHAT_OUTBOX_MAX_ENTRIES = 100;
export const CHAT_OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const CHAT_OUTBOX_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const CHAT_OUTBOX_MAX_ATTEMPTS = 4096;

export class ChatOutboxCapacityError extends Error {
  readonly name = "ChatOutboxCapacityError";
}

export class ChatDeliveryLeaseRegistry {
  private readonly active = new Set<string>();

  tryAcquire(userId: string, clientMessageId: string): (() => void) | null {
    const key = `${userId}\u0000${clientMessageId}`;
    if (!userId || !clientMessageId || this.active.has(key)) return null;
    this.active.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(key);
    };
  }

  get size(): number {
    return this.active.size;
  }
}

export interface ChatOutboxDrainToken {
  ownerId: string;
  generation: number;
}

/** Fences an app-level drain across logout/login while an old send is pending. */
export class ChatOutboxDrainOwnerFence {
  private ownerId: string | null = null;
  private generation = 0;
  private running: ChatOutboxDrainToken | null = null;
  private rerunRequested = false;

  setOwner(ownerId: string | null): void {
    if (ownerId === this.ownerId) return;
    this.ownerId = ownerId;
    this.generation += 1;
    if (this.running) this.rerunRequested = true;
  }

  tryBegin(): ChatOutboxDrainToken | null {
    if (!this.ownerId) return null;
    if (this.running) {
      this.rerunRequested = true;
      return null;
    }
    this.running = { ownerId: this.ownerId, generation: this.generation };
    return this.running;
  }

  isCurrent(token: ChatOutboxDrainToken): boolean {
    return token.ownerId === this.ownerId && token.generation === this.generation;
  }

  finish(token: ChatOutboxDrainToken): boolean {
    if (this.running === token) this.running = null;
    const shouldRerun =
      Boolean(this.ownerId) && (this.rerunRequested || !this.isCurrent(token));
    this.rerunRequested = false;
    return shouldRerun;
  }
}

export interface ChatSendOwnerToken {
  ownerId: string;
  profileId: string;
  scopeId: string;
  generation: number;
}

/**
 * Fences every continuation owned by a mounted room across logout, profile
 * switch, room unmount and remount. Tokens are intentionally explicit so a
 * continuation cannot consult whichever global auth/profile happens to be
 * current after an AsyncStorage, picker or upload await.
 */
export class ChatSendOwnerFence {
  private ownerId: string | null = null;
  private profileId: string | null = null;
  private scopeId: string | null = null;
  private generation = 0;

  setOwner(ownerId: string | null, profileId: string | null, scopeId: string | null): void {
    if (
      ownerId === this.ownerId &&
      profileId === this.profileId &&
      scopeId === this.scopeId
    ) return;
    this.ownerId = ownerId;
    this.profileId = profileId;
    this.scopeId = scopeId;
    this.generation += 1;
  }

  capture(): ChatSendOwnerToken | null {
    if (!this.ownerId || !this.profileId || !this.scopeId) return null;
    return {
      ownerId: this.ownerId,
      profileId: this.profileId,
      scopeId: this.scopeId,
      generation: this.generation,
    };
  }

  isCurrent(token: ChatSendOwnerToken | null): token is ChatSendOwnerToken {
    return Boolean(
      token &&
        token.ownerId === this.ownerId &&
        token.profileId === this.profileId &&
        token.scopeId === this.scopeId &&
        token.generation === this.generation,
    );
  }

  matchesEntry(token: ChatSendOwnerToken | null, entry: ChatOutboxEntry): boolean {
    return Boolean(
      this.isCurrent(token) &&
        entry.senderId === token.ownerId &&
        entry.senderProfileId === token.profileId,
    );
  }

  invalidate(token: ChatSendOwnerToken | null): void {
    if (!this.isCurrent(token)) return;
    this.ownerId = null;
    this.profileId = null;
    this.scopeId = null;
    this.generation += 1;
  }
}

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
const CLIENT_MESSAGE_ID_PATTERN = /^m-[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/;

function isMessageType(value: unknown): value is OutboxMessageType {
  return value === "text" || value === "sticker" || value === "image" || value === "file";
}

export function isChatOutboxEntry(value: unknown): value is ChatOutboxEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ChatOutboxEntry>;
  return (
    typeof entry.clientMessageId === "string" &&
    CLIENT_MESSAGE_ID_PATTERN.test(entry.clientMessageId) &&
    entry.tempId === `temp-${entry.clientMessageId}` &&
    typeof entry.roomId === "string" && entry.roomId.length > 0 && entry.roomId.length <= 128 &&
    typeof entry.senderId === "string" && entry.senderId.length > 0 && entry.senderId.length <= 128 &&
    (entry.senderProfileId === null || typeof entry.senderProfileId === "string") &&
    typeof entry.content === "string" && entry.content.length <= 4_096 &&
    isMessageType(entry.type) &&
    (entry.replyToMessageId === null || typeof entry.replyToMessageId === "string") &&
    typeof entry.createdAt === "number" && Number.isSafeInteger(entry.createdAt) &&
    (entry.retryStartedAt === undefined || (Number.isSafeInteger(entry.retryStartedAt) && entry.retryStartedAt! >= entry.createdAt!)) &&
    typeof entry.attempts === "number" && Number.isSafeInteger(entry.attempts) && entry.attempts >= 0 &&
    typeof entry.nextAttemptAt === "number" && Number.isSafeInteger(entry.nextAttemptAt) &&
    (entry.deliveryState === "pending" || entry.deliveryState === "failed") &&
    typeof entry.retryable === "boolean"
  );
}

export function pruneChatOutbox(
  values: readonly unknown[],
  now = Date.now(),
): ChatOutboxEntry[] {
  const newestByOperation = new Map<string, ChatOutboxEntry>();
  for (const value of values) {
    if (!isChatOutboxEntry(value)) continue;
    if (now - value.createdAt > CHAT_OUTBOX_RETENTION_MS) continue;
    const previous = newestByOperation.get(value.clientMessageId);
    if (!previous || previous.createdAt <= value.createdAt) {
      newestByOperation.set(value.clientMessageId, value);
    }
  }
  return Array.from(newestByOperation.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-CHAT_OUTBOX_MAX_ENTRIES);
}

/**
 * Adds or updates one durable operation without silently evicting an older,
 * still-unconfirmed message. A full outbox rejects the new send so the composer
 * can restore its text instead of showing a pending message that can never run.
 */
export function upsertChatOutboxEntries(
  values: readonly unknown[],
  entry: ChatOutboxEntry,
  now = Date.now(),
): ChatOutboxEntry[] {
  const entries = pruneChatOutbox(values, now);
  const existing = entries.some(
    (item) => item.clientMessageId === entry.clientMessageId,
  );
  if (!existing && entries.length >= CHAT_OUTBOX_MAX_ENTRIES) {
    throw new ChatOutboxCapacityError(
      "Too many messages are waiting for acknowledgement",
    );
  }
  return pruneChatOutbox(
    [
      ...entries.filter(
        (item) => item.clientMessageId !== entry.clientMessageId,
      ),
      entry,
    ],
    now,
  );
}

export function nextChatRetryAt(entry: ChatOutboxEntry, now: number): number {
  const delayIndex = Math.min(Math.max(0, entry.attempts - 1), RETRY_DELAYS_MS.length - 1);
  return now + RETRY_DELAYS_MS[delayIndex];
}

export function canRetryChatOutboxEntry(entry: ChatOutboxEntry, now: number): boolean {
  return (
    entry.retryable &&
    entry.deliveryState === "pending" &&
    entry.attempts < CHAT_OUTBOX_MAX_ATTEMPTS &&
    now - (entry.retryStartedAt ?? entry.createdAt) <= CHAT_OUTBOX_RETRY_WINDOW_MS &&
    now >= entry.nextAttemptAt
  );
}

export function markChatOutboxAttempt(entry: ChatOutboxEntry, now: number): ChatOutboxEntry {
  return {
    ...entry,
    attempts: entry.attempts + 1,
    nextAttemptAt: now,
    deliveryState: "pending",
  };
}

export function markChatOutboxFailure(
  entry: ChatOutboxEntry,
  now: number,
  retryable: boolean,
): ChatOutboxEntry {
  const exhausted =
    !retryable ||
    entry.attempts >= CHAT_OUTBOX_MAX_ATTEMPTS ||
    now - (entry.retryStartedAt ?? entry.createdAt) > CHAT_OUTBOX_RETRY_WINDOW_MS;
  return {
    ...entry,
    nextAttemptAt: exhausted ? now : nextChatRetryAt(entry, now),
    deliveryState: exhausted ? "failed" : "pending",
    retryable: !exhausted,
  };
}

export function isRetryableChatDeliveryError(error: unknown): boolean {
  const rawStatus =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  const status =
    typeof rawStatus === "number" && Number.isFinite(rawStatus)
      ? rawStatus
      : null;
  return (
    status === null ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}
