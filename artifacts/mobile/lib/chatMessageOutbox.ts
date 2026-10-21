import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ChatDeliveryLeaseRegistry,
  pruneChatOutbox,
  upsertChatOutboxEntries,
  type ChatOutboxEntry,
} from "./chatOutboxPolicy";
import {
  chatOutboxStorageKey,
  clearChatOutboxStorageForOwner,
  sweepChatOutboxStorage,
  type ChatOutboxSweepResult,
} from "./chatOutboxStorageSweep";

const outboxListeners = new Set<(ownerId: string) => void>();
export function subscribeChatOutboxChanges(listener: (ownerId: string) => void): () => void {
  outboxListeners.add(listener);
  return () => { outboxListeners.delete(listener); };
}

const locks = new Map<string, Promise<unknown>>();
const deliveryLeases = new ChatDeliveryLeaseRegistry();
let activeRetentionSweep: Promise<ChatOutboxSweepResult> | null = null;

function storageKey(userId: string): string {
  return chatOutboxStorageKey(userId);
}

async function readUnlocked(userId: string): Promise<ChatOutboxEntry[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return pruneChatOutbox(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

async function writeUnlocked(userId: string, entries: ChatOutboxEntry[]): Promise<void> {
  const pruned = pruneChatOutbox(entries);
  if (pruned.length === 0) {
    await AsyncStorage.removeItem(storageKey(userId));
    return;
  }
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(pruned));
}

function withUserLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  locks.set(userId, next);
  void next.then(
    () => {
      if (locks.get(userId) === next) locks.delete(userId);
    },
    () => {
      if (locks.get(userId) === next) locks.delete(userId);
    },
  );
  return next;
}

export function loadChatOutbox(userId: string): Promise<ChatOutboxEntry[]> {
  // Reads are frequent while a retry is pending. Avoid rewriting AsyncStorage
  // on every five-second check; writes already prune by age and capacity.
  return withUserLock(userId, () => readUnlocked(userId));
}

/** Remove only this account's pending plaintext during logout/account switch. */
export function clearChatOutboxForOwner(userId: string): Promise<void> {
  return clearChatOutboxStorageForOwner(
    AsyncStorage,
    userId,
    withUserLock,
  );
}

/**
 * Removes expired rows from every account namespace left on this device.
 * This runs at app startup and whenever the authenticated session changes, so
 * an account that is no longer active cannot retain plaintext indefinitely.
 */
export function sweepExpiredChatOutboxes(
  now = Date.now(),
): Promise<ChatOutboxSweepResult> {
  if (activeRetentionSweep) return activeRetentionSweep;
  const sweep = sweepChatOutboxStorage(
    AsyncStorage,
    now,
    pruneChatOutbox,
    withUserLock,
  );
  activeRetentionSweep = sweep;
  const clearActiveSweep = () => {
    if (activeRetentionSweep === sweep) activeRetentionSweep = null;
  };
  // Use both branches instead of `.finally()`: ignoring the promise returned
  // by finally would turn a handled storage rejection into an unhandled one.
  void sweep.then(clearActiveSweep, clearActiveSweep);
  return sweep;
}

export function upsertChatOutboxEntry(
  userId: string,
  entry: ChatOutboxEntry,
): Promise<ChatOutboxEntry[]> {
  return withUserLock(userId, async () => {
    const entries = await readUnlocked(userId);
    const next = upsertChatOutboxEntries(entries, entry);
    await writeUnlocked(userId, next);
    const previous = entries.find(row => row.clientMessageId === entry.clientMessageId);
    if (!previous || (previous.deliveryState !== "pending" && entry.deliveryState === "pending")) {
      outboxListeners.forEach(listener => listener(userId));
    }
    return next;
  });
}

export function removeChatOutboxEntry(
  userId: string,
  clientMessageId: string,
): Promise<void> {
  return withUserLock(userId, async () => {
    const entries = await readUnlocked(userId);
    await writeUnlocked(
      userId,
      entries.filter((entry) => entry.clientMessageId !== clientMessageId),
    );
  });
}

export function tryAcquireChatOutboxDelivery(
  userId: string,
  clientMessageId: string,
): (() => void) | null {
  return deliveryLeases.tryAcquire(userId, clientMessageId);
}
