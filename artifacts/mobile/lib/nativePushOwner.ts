import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearNativePushOwnerLease,
  readNativePushOwnerLease,
  writeNativePushOwnerLease,
  parseNativePushOwnerRecord,
  NATIVE_PUSH_OWNER_STORAGE_KEY,
} from "./nativePushOwnerPolicy";
export { NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS } from "./nativePushOwnerPolicy";

let ownerWriteQueue: Promise<void> = Promise.resolve();

function withOwnerStorageQueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = ownerWriteQueue.catch(() => undefined).then(operation);
  ownerWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Serialised so delayed logout cleanup cannot clear a newer account owner. */
export function setCurrentNativePushOwner(userId: string | null): Promise<void> {
  return withOwnerStorageQueue(() =>
    writeNativePushOwnerLease(AsyncStorage, userId),
  );
}

export function clearCurrentNativePushOwner(ownerId: string): Promise<boolean> {
  return withOwnerStorageQueue(() =>
    clearNativePushOwnerLease(AsyncStorage, ownerId),
  );
}

export function getCurrentNativePushOwner(now?: number): Promise<string | null> {
  // Read the clock inside the queue: an earlier queued write may create a
  // newer lease. A timestamp captured by the caller would invalidate and erase it.
  return withOwnerStorageQueue(async () => {
    try {
      return (await readNativePushOwnerLease(AsyncStorage, now ?? Date.now()))?.ownerId ?? null;
    } catch {
      return null;
    }
  });
}

export async function nativePushMatchesCurrentOwner(
  recipientUserId: unknown,
  now?: number,
): Promise<boolean> {
  if (typeof recipientUserId !== "string") return false;
  return (await getCurrentNativePushOwner(now)) === recipientUserId;
}

/** An expired lease is renewed only after live authenticated identity verification.
 * Keep renewal and logout in the same queue so an in-flight check cannot resurrect
 * a binding that logout has already removed. Never create a missing owner here.
 */
export function nativePushMatchesOwnerWithRenewal(
  recipientUserId: unknown,
  verifyOwner: (ownerId: string) => Promise<boolean>,
): Promise<boolean> {
  if (typeof recipientUserId !== "string") return Promise.resolve(false);
  return withOwnerStorageQueue(async () => {
    const raw = await AsyncStorage.getItem(NATIVE_PUSH_OWNER_STORAGE_KEY);
    const record = parseNativePushOwnerRecord(raw, Date.now(), true);
    if (!record || record.ownerId !== recipientUserId) return false;
    if (record.expiresAt > Date.now()) return true;
    if (!(await verifyOwner(record.ownerId).catch(() => false))) return false;
    await writeNativePushOwnerLease(AsyncStorage, record.ownerId);
    return true;
  });
}
