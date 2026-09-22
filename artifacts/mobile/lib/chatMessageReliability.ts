/**
 * Pure message reconciliation primitives shared by the chat query and outbox.
 *
 * Keep this module free of React/React Native dependencies: the merge and cursor
 * rules are exercised with Node's built-in test runner, including response-loss
 * and >50-message reconnect scenarios.
 */

export type MessageDeliveryState = "pending" | "failed";

export interface ChatMessageLike {
  id: string;
  roomId: string;
  roomSeq: number;
  senderId: string;
  clientMessageId?: string | null;
  createdAt: string;
  _deliveryState?: MessageDeliveryState;
}

export type ReliableMessage<T extends ChatMessageLike = ChatMessageLike> = T & {
  _deliveryState?: MessageDeliveryState;
};

const CATCH_UP_PAGE_SIZE = 100;
// One sync is deliberately bounded. If a room is more than 1,000 messages
// behind, the next normal refetch continues from the last merged roomSeq rather
// than monopolising the radio/network indefinitely.
const MAX_CATCH_UP_PAGES_PER_SYNC = 10;
export const MAX_PERSISTED_CHAT_CURSORS_PER_SCOPE = 128;
export const PERSISTED_CHAT_CURSOR_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

function operationKey(message: ChatMessageLike): string | null {
  if (!message.clientMessageId) return null;
  return `${message.roomId}:${message.senderId}:${message.clientMessageId}`;
}

function isConfirmed(message: ChatMessageLike): boolean {
  return message.roomSeq > 0 && !message.id.startsWith("temp-");
}

function findEquivalentMessage<T extends ChatMessageLike>(
  messages: ReadonlyArray<T>,
  candidate: ChatMessageLike,
): T | undefined {
  const candidateOperation = operationKey(candidate);
  return messages.find((message) => {
    if (message.id === candidate.id) return true;
    const messageOperation = operationKey(message);
    return candidateOperation !== null && messageOperation === candidateOperation;
  });
}

function compareMessages(a: ChatMessageLike, b: ChatMessageLike): number {
  const aConfirmed = isConfirmed(a);
  const bConfirmed = isConfirmed(b);
  if (aConfirmed && bConfirmed && a.roomSeq !== b.roomSeq) {
    return a.roomSeq - b.roomSeq;
  }
  if (aConfirmed !== bConfirmed) return aConfirmed ? -1 : 1;

  const time = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (Number.isFinite(time) && time !== 0) return time;
  return a.id.localeCompare(b.id);
}

/**
 * Merge optimistic, acknowledgement, realtime and catch-up copies into one
 * ordered list. A server-confirmed row always replaces the optimistic row with
 * the same client operation ID, even if the original HTTP response was lost.
 */
export function mergeChatMessages<T extends ChatMessageLike>(
  ...batches: ReadonlyArray<ReadonlyArray<T>>
): Array<ReliableMessage<T>> {
  const byId = new Map<string, ReliableMessage<T>>();
  const idByOperation = new Map<string, string>();

  for (const batch of batches) {
    for (const raw of batch) {
      const incoming = raw as ReliableMessage<T>;
      const opKey = operationKey(incoming);
      const operationMatchId = opKey ? idByOperation.get(opKey) : undefined;
      const matchedId = byId.has(incoming.id) ? incoming.id : operationMatchId;
      const previous = matchedId ? byId.get(matchedId) : undefined;

      if (previous && isConfirmed(previous) && !isConfirmed(incoming)) {
        // A delayed optimistic/outbox hydration must never replace an acked row.
        continue;
      }

      if (previous && matchedId && matchedId !== incoming.id) {
        byId.delete(matchedId);
      }

      const next = {
        ...(previous ?? {}),
        ...incoming,
        // Delivery state is local-only. A positive roomSeq is the server ack.
        ...(isConfirmed(incoming) ? { _deliveryState: undefined } : {}),
      } as ReliableMessage<T>;
      byId.set(next.id, next);

      const nextOperationKey = operationKey(next);
      if (nextOperationKey) idByOperation.set(nextOperationKey, next.id);
    }
  }

  return Array.from(byId.values()).sort(compareMessages);
}

export function maxConfirmedRoomSeq(messages: ReadonlyArray<ChatMessageLike>): number {
  let max = 0;
  for (const message of messages) {
    if (isConfirmed(message) && message.roomSeq > max) max = message.roomSeq;
  }
  return max;
}

/**
 * A catch-up cursor may advance only after every row used to bridge that gap is
 * present in the committed query cache. React Query performs structural
 * sharing, so comparing the returned array by reference is not a valid commit
 * signal. Matching immutable server identity + roomSeq is both cheaper than a
 * deep comparison and safe when a realtime event independently committed the
 * same rows first.
 */
export function confirmedCatchUpIsCommitted(
  cached: ReadonlyArray<ChatMessageLike>,
  catchUp: ReadonlyArray<ChatMessageLike>,
): boolean {
  if (catchUp.length === 0) return true;
  const committed = new Set(
    cached
      .filter(isConfirmed)
      .map((message) => `${message.roomId}\u0000${message.roomSeq}\u0000${message.id}`),
  );
  return catchUp.every(
    (message) =>
      isConfirmed(message) &&
      committed.has(`${message.roomId}\u0000${message.roomSeq}\u0000${message.id}`),
  );
}

/**
 * Safe fallback when there is no proven, persisted contiguous cursor.
 *
 * A cache row is not proof that every lower sequence was synchronized: it may
 * have arrived through realtime or an outbox acknowledgement. Starting before
 * that row could permanently skip older messages, so a cold/evicted room must
 * replay from zero. The catch-up loop is bounded and resumes from its committed
 * cursor, which limits radio use without trading away correctness.
 */
export function safeCatchUpStartFromCache(
  _messages: ReadonlyArray<ChatMessageLike>,
): number {
  return 0;
}

export interface PersistedConfirmedCursor {
  roomId: string;
  roomSeq: number;
  touchedAt: number;
}

function isPersistedConfirmedCursor(
  value: unknown,
): value is PersistedConfirmedCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<PersistedConfirmedCursor>;
  return (
    typeof record.roomId === "string" &&
    record.roomId.length > 0 &&
    record.roomId.length <= 128 &&
    Number.isSafeInteger(record.roomSeq) &&
    (record.roomSeq ?? -1) >= 0 &&
    Number.isSafeInteger(record.touchedAt) &&
    (record.touchedAt ?? -1) >= 0
  );
}

export function normalizePersistedConfirmedCursors(
  values: unknown,
  now = Date.now(),
  maxRooms = MAX_PERSISTED_CHAT_CURSORS_PER_SCOPE,
): PersistedConfirmedCursor[] {
  if (!Number.isSafeInteger(maxRooms) || maxRooms < 1) {
    throw new TypeError("maxRooms must be a positive safe integer");
  }
  if (!Array.isArray(values)) return [];

  const newestByRoom = new Map<string, PersistedConfirmedCursor>();
  for (const value of values) {
    if (!isPersistedConfirmedCursor(value)) continue;
    if (now - value.touchedAt > PERSISTED_CHAT_CURSOR_RETENTION_MS) continue;
    const previous = newestByRoom.get(value.roomId);
    if (
      !previous ||
      value.touchedAt > previous.touchedAt ||
      (value.touchedAt === previous.touchedAt && value.roomSeq > previous.roomSeq)
    ) {
      newestByRoom.set(value.roomId, value);
    }
  }
  return Array.from(newestByRoom.values())
    .sort((left, right) => left.touchedAt - right.touchedAt)
    .slice(-maxRooms);
}

export function upsertPersistedConfirmedCursor(
  values: unknown,
  roomId: string,
  roomSeq: number,
  now = Date.now(),
  maxRooms = MAX_PERSISTED_CHAT_CURSORS_PER_SCOPE,
): PersistedConfirmedCursor[] {
  if (!roomId || roomId.length > 128) throw new TypeError("invalid roomId");
  if (!Number.isSafeInteger(roomSeq) || roomSeq < 0) {
    throw new TypeError("roomSeq must be a non-negative safe integer");
  }
  const current = normalizePersistedConfirmedCursors(values, now, maxRooms);
  const previous = current.find((record) => record.roomId === roomId);
  const nextSeq = Math.max(previous?.roomSeq ?? 0, roomSeq);
  return normalizePersistedConfirmedCursors(
    [
      ...current.filter((record) => record.roomId !== roomId),
      { roomId, roomSeq: nextSeq, touchedAt: now },
    ],
    now,
    maxRooms,
  );
}

/**
 * A high-water mark advanced only by successful server synchronisation. It must
 * not be recomputed from query cache on every refetch: an outbox HTTP ack can
 * insert sequence 200 while sequences 101..199 are still missing.
 */
export class ConfirmedCatchUpCursor {
  private value: number;

  constructor(initialSynchronizedSeq = 0) {
    if (
      !Number.isSafeInteger(initialSynchronizedSeq) ||
      initialSynchronizedSeq < 0
    ) {
      throw new TypeError(
        "initialSynchronizedSeq must be a non-negative safe integer",
      );
    }
    this.value = initialSynchronizedSeq;
  }

  get current(): number {
    return this.value;
  }

  advance(lastSynchronizedSeq: number): void {
    if (
      !Number.isSafeInteger(lastSynchronizedSeq) ||
      lastSynchronizedSeq < this.value
    ) {
      return;
    }
    this.value = lastSynchronizedSeq;
  }
}

/**
 * Keeps the server-confirmed cursor alive while a room screen unmounts and is
 * later opened again. Query cache is deliberately not an input: realtime or an
 * outbox acknowledgement can insert a high roomSeq before the missing interval
 * has been paged from the server.
 *
 * The map is LRU bounded so visiting rooms cannot create an unbounded
 * process-lifetime allocation. An evicted room safely restarts from the
 * server's latest baseline instead of trusting an arbitrary cache high-water.
 */
export class ConfirmedCatchUpCursorRegistry {
  private readonly cursors = new Map<string, ConfirmedCatchUpCursor>();
  private readonly maxRooms: number;

  constructor(maxRooms = 128) {
    if (!Number.isSafeInteger(maxRooms) || maxRooms < 1) {
      throw new TypeError("maxRooms must be a positive safe integer");
    }
    this.maxRooms = maxRooms;
  }

  forRoom(roomId: string): ConfirmedCatchUpCursor {
    if (!roomId) throw new TypeError("roomId is required");
    const existing = this.cursors.get(roomId);
    if (existing) {
      // Map insertion order is the LRU order.
      this.cursors.delete(roomId);
      this.cursors.set(roomId, existing);
      return existing;
    }

    const cursor = new ConfirmedCatchUpCursor();
    this.cursors.set(roomId, cursor);
    while (this.cursors.size > this.maxRooms) {
      const oldestRoomId = this.cursors.keys().next().value as
        | string
        | undefined;
      if (oldestRoomId === undefined) break;
      this.cursors.delete(oldestRoomId);
    }
    return cursor;
  }

  get size(): number {
    return this.cursors.size;
  }
}

/**
 * Treats the server's latest page as authoritative for its visible window.
 * A merge-only refresh would keep a message forever after "delete for me"
 * because the server intentionally omits that row. Rows older than a full
 * latest page remain cached; pending outbox rows always remain cached.
 */
export function reconcileLatestMessageWindow<T extends ChatMessageLike>(
  current: ReadonlyArray<T>,
  latest: ReadonlyArray<T>,
  windowSize: number,
): Array<ReliableMessage<T>> {
  if (!Number.isSafeInteger(windowSize) || windowSize < 1) {
    throw new TypeError("windowSize must be a positive safe integer");
  }

  const confirmedLatest = latest.filter(isConfirmed);
  const oldestLatestSeq = confirmedLatest.reduce(
    (minimum, message) => Math.min(minimum, message.roomSeq),
    Number.POSITIVE_INFINITY,
  );
  const latestIds = new Set(confirmedLatest.map((message) => message.id));
  const latestOperations = new Set(
    confirmedLatest
      .map(operationKey)
      .filter((key): key is string => key !== null),
  );
  const pageIsFull = latest.length >= windowSize;

  const preserved = current.filter((message) => {
    if (!isConfirmed(message)) return true;
    if (latestIds.has(message.id)) return false;
    const key = operationKey(message);
    if (key && latestOperations.has(key)) return false;
    return pageIsFull && message.roomSeq < oldestLatestSeq;
  });
  return mergeChatMessages(preserved, latest);
}

/**
 * Preserve writes that reached the query cache while a server refresh was in
 * flight. Without this commit-time reconciliation, a slower HTTP response can
 * replace a newly queued optimistic row, its acknowledgement, or a realtime
 * message with the stale array captured when the request started.
 *
 * Confirmed rows that already existed in `snapshot` are deliberately not
 * preserved when the authoritative result omits them: that omission may be a
 * legitimate "delete for me". Only new rows, pending/failed rows, and an ack
 * that upgraded an optimistic snapshot row are carried forward.
 */
export function mergeConcurrentChatWrites<T extends ChatMessageLike>(
  snapshot: ReadonlyArray<T>,
  committedCurrent: ReadonlyArray<T>,
  authoritativeResult: ReadonlyArray<T>,
): Array<ReliableMessage<T>> {
  const concurrent = committedCurrent.filter((message) => {
    if (!isConfirmed(message)) return true;
    const before = findEquivalentMessage(snapshot, message);
    if (!before) return true;
    return !isConfirmed(before);
  });
  return mergeChatMessages(authoritativeResult, concurrent);
}

export interface CatchUpResult<T extends ChatMessageLike> {
  messages: T[];
  lastSeq: number;
  complete: boolean;
  pages: number;
}

/**
 * `latest` and `afterSeq` are independent HTTP snapshots. Even an empty,
 * complete catch-up is no longer complete if the later latest-window response
 * proves that newer sequences exist; schedule another bounded pass to fill the
 * interval between the two snapshots.
 */
export function latestWindowCoversCursor<T extends ChatMessageLike>(latest:ReadonlyArray<T>,cursor:number,windowSize:number):boolean {
 return latest.length<windowSize || latest.some(m=>Number(m.roomSeq)>0&&Number(m.roomSeq)<=cursor);
}

export function catchUpCoversLatestWindow<T extends ChatMessageLike>(
  catchUp: Pick<CatchUpResult<T>, "lastSeq" | "complete">,
  latest: ReadonlyArray<T>,
): boolean {
  return catchUp.complete && maxConfirmedRoomSeq(latest) <= catchUp.lastSeq;
}

/**
 * Fetch every visible message after a sequence cursor. Pagination advances by
 * roomSeq rather than timestamps, so equal timestamps and realtime overlap do
 * not create gaps or reorder rows.
 */
export async function fetchAllMessagesAfter<T extends ChatMessageLike>(
  afterSeq: number,
  fetchPage: (afterSeq: number, limit: number) => Promise<T[]>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<CatchUpResult<T>> {
  const pageSize = options.pageSize ?? CATCH_UP_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_CATCH_UP_PAGES_PER_SYNC;
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new TypeError("afterSeq must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError("pageSize must be between 1 and 100");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new TypeError("maxPages must be a positive safe integer");
  }

  const received: T[] = [];
  let cursor = afterSeq;
  let pages = 0;
  let complete = false;

  while (pages < maxPages) {
    const page = await fetchPage(cursor, pageSize);
    pages += 1;
    if (page.length === 0) {
      complete = true;
      break;
    }

    let nextCursor = cursor;
    for (const message of page) {
      if (message.roomSeq <= cursor) {
        throw new Error("catch-up page did not advance beyond its cursor");
      }
      nextCursor = Math.max(nextCursor, message.roomSeq);
      received.push(message);
    }
    if (nextCursor <= cursor) {
      throw new Error("catch-up cursor did not advance");
    }
    cursor = nextCursor;

    // Do not infer completion from a short page. Per-viewer filtering may make
    // a server page shorter than the requested limit while later sequences are
    // still visible. One empty probe is required to confirm the end.
  }

  return { messages: received, lastSeq: cursor, complete, pages };
}
