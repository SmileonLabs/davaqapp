import {
  mergeChatMessages,
  type ChatMessageLike,
} from "./chatMessageReliability.ts";
import {
  projectReadCursors,
  type ReadCursor,
} from "./chatRealtimeProjection.ts";

export interface ChatChangePage<T> {
  protocol: 1;
  revision: string;
  snapshotRoomSeq: number;
  reset: boolean;
  hasMore: boolean;
  messages: T[];
  removedMessageIds: string[];
  readCursors: ReadCursor[];
}
/** Receive cursor belongs to this in-memory cache, never to a cache lost at restart. */
export class ChatChangeRecovery<
  T extends ChatMessageLike & { readCount?: number },
> {
  revision: string | null = null;
  snapshotRoomSeq = 0;
  private upserts = new Map<string, T>();
  private removed = new Set<string>();
  private readers: ReadCursor[] = [];
  private baselineHead = -1;
  private baselineIds = new Set<string>();
  // Shared only within one reset epoch. Backward pages do not advance revision.
  private historyIds = new Set<string>();
  get historyEpoch(): object { return this.historyIds; }
  admitHistory(messages: readonly T[]): void {
    if (messages.some(m => m.roomId !== this.roomId || !Number.isSafeInteger(m.roomSeq) || m.roomSeq <= 0)) {
      throw new Error("Invalid room history page");
    }
    for (const message of messages) this.historyIds.add(message.id);
  }
  readonly roomId: string;
  constructor(roomId: string) {
    this.roomId = roomId;
  }

  project(current: readonly T[]): T[] {
    // Overlay stale rows, but do not recreate a row deliberately removed by a
    // local delete action while its server operation is still in flight.
    const overlaid = current.map(
      (message) => this.upserts.get(message.id) ?? message,
    );
    return projectReadCursors(
      mergeChatMessages(current, overlaid) as T[],
      this.readers,
    ).filter(
      (message) =>
        !this.removed.has(message.id) &&
        !(
          message.roomSeq > 0 &&
          message.roomSeq <= this.baselineHead &&
          !this.historyIds.has(message.id) &&
          !this.baselineIds.has(message.id)
        ),
    );
  }

  prepare(current: readonly T[], page: ChatChangePage<T>) {
    if (
      page.protocol !== 1 ||
      !Number.isSafeInteger(page.snapshotRoomSeq) ||
      page.snapshotRoomSeq < 0 ||
      (this.revision === null && !page.reset) ||
      (page.reset && page.hasMore) ||
      !/^(0|[1-9][0-9]{0,18})$/.test(page.revision) ||
      BigInt(page.revision) > 9223372036854775807n ||
      (this.revision !== null &&
        !page.reset &&
        (BigInt(page.revision) < BigInt(this.revision) ||
          (page.hasMore && page.revision === this.revision))) ||
      page.messages.some((message) => message.roomId !== this.roomId)
    ) {
      throw new Error("Invalid room change page");
    }
    const next = new ChatChangeRecovery<T>(this.roomId);
    next.revision = page.revision;
    next.snapshotRoomSeq = page.snapshotRoomSeq;
    next.upserts = new Map(page.reset ? [] : this.upserts);
    next.removed = new Set(page.reset ? [] : this.removed);
    next.readers = page.readCursors;
    next.baselineHead = page.reset ? page.snapshotRoomSeq : this.baselineHead;
    next.historyIds = page.reset ? new Set() : this.historyIds;
    next.baselineIds = new Set(page.reset ? [] : this.baselineIds);
    for (const message of page.messages) {
      next.baselineIds.add(message.id);
      next.removed.delete(message.id);
      next.upserts.set(message.id, message);
    }
    for (const id of page.removedMessageIds) {
      next.upserts.delete(id);
      next.removed.add(id);
    }
    const knownIds = new Set(current.map((message) => message.id));
    const projectedMessages = page.messages.filter(
      (message) =>
        page.reset ||
        message.roomSeq > this.baselineHead ||
        knownIds.has(message.id) ||
        this.upserts.has(message.id),
    );
    return {
      next,
      data: next.project(mergeChatMessages(current, projectedMessages) as T[]),
      hasMore: page.hasMore,
    };
  }
}
