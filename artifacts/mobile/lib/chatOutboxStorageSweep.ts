export const CHAT_OUTBOX_STORAGE_KEY_PREFIX = "anotherme:chat-outbox:v1:";

export interface ChatOutboxKeyValueStorage {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ChatOutboxSweepResult {
  examined: number;
  removed: number;
  rewritten: number;
}

export type ChatOutboxOwnerLock = <T>(
  ownerId: string,
  operation: () => Promise<T>,
) => Promise<T>;

export type ChatOutboxPruner = (
  values: readonly unknown[],
  now: number,
) => readonly unknown[];

export function chatOutboxStorageKey(ownerId: string): string {
  return `${CHAT_OUTBOX_STORAGE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

/**
 * Physically removes exactly one authenticated owner's durable message body.
 * The optional owner lock is shared with normal outbox writes so a logout
 * deletion cannot be overtaken by a write that was already queued for A, and
 * it can never touch a newly signed-in owner B's namespace.
 */
export async function clearChatOutboxStorageForOwner(
  storage: ChatOutboxKeyValueStorage,
  ownerId: string,
  withOwnerLock: ChatOutboxOwnerLock = async (_ownerId, operation) => operation(),
): Promise<void> {
  if (!ownerId || ownerId.length > 128) return;
  await withOwnerLock(ownerId, () =>
    storage.removeItem(chatOutboxStorageKey(ownerId)),
  );
}

function ownerIdFromStorageKey(key: string): string | null {
  if (!key.startsWith(CHAT_OUTBOX_STORAGE_KEY_PREFIX)) return null;
  const encodedOwnerId = key.slice(CHAT_OUTBOX_STORAGE_KEY_PREFIX.length);
  if (!encodedOwnerId) return null;
  try {
    const ownerId = decodeURIComponent(encodedOwnerId);
    if (!ownerId || chatOutboxStorageKey(ownerId) !== key) return null;
    return ownerId;
  } catch {
    return null;
  }
}

function parseEntries(raw: string): readonly unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Applies the 30-day retention policy to every account namespace on the
 * device, not only the account that happens to be signed in. The optional
 * owner lock prevents a startup/session-transition sweep from racing a send.
 */
export async function sweepChatOutboxStorage(
  storage: ChatOutboxKeyValueStorage,
  now: number,
  pruneEntries: ChatOutboxPruner,
  withOwnerLock: ChatOutboxOwnerLock = async (_ownerId, operation) => operation(),
): Promise<ChatOutboxSweepResult> {
  const keys = await storage.getAllKeys();
  const result: ChatOutboxSweepResult = {
    examined: 0,
    removed: 0,
    rewritten: 0,
  };

  for (const key of keys) {
    const ownerId = ownerIdFromStorageKey(key);
    if (!ownerId) continue;
    result.examined += 1;
    await withOwnerLock(ownerId, async () => {
      const raw = await storage.getItem(key);
      if (raw === null) return;

      const pruned = pruneEntries(parseEntries(raw), now);
      if (pruned.length === 0) {
        await storage.removeItem(key);
        result.removed += 1;
        return;
      }

      const serialized = JSON.stringify(pruned);
      if (serialized !== raw) {
        await storage.setItem(key, serialized);
        result.rewritten += 1;
      }
    });
  }

  return result;
}
