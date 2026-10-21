export const NATIVE_PUSH_OWNER_RECORD_VERSION = 2 as const;
export const NATIVE_PUSH_OWNER_LEASE_MS = 24 * 60 * 60 * 1_000;
export const NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const NATIVE_PUSH_OWNER_STORAGE_KEY = "anotherme:native-push-owner:v2";
export const LEGACY_NATIVE_PUSH_OWNER_STORAGE_KEY = "anotherme:native-push-owner:v1";

export interface NativePushOwnerRecord {
  version: typeof NATIVE_PUSH_OWNER_RECORD_VERSION;
  ownerId: string;
  refreshedAt: number;
  expiresAt: number;
}

export interface NativePushOwnerStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function validOwnerId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function createNativePushOwnerRecord(
  ownerId: string,
  now = Date.now(),
): NativePushOwnerRecord | null {
  if (!validOwnerId(ownerId) || !validTimestamp(now)) return null;
  const expiresAt = now + NATIVE_PUSH_OWNER_LEASE_MS;
  if (!Number.isSafeInteger(expiresAt)) return null;
  return {
    version: NATIVE_PUSH_OWNER_RECORD_VERSION,
    ownerId,
    refreshedAt: now,
    expiresAt,
  };
}

/** Legacy bare IDs, malformed JSON and clock-invalid/expired leases fail closed. */
export function parseNativePushOwnerRecord(
  raw: string | null,
  now = Date.now(),
  allowExpired = false,
): NativePushOwnerRecord | null {
  if (!raw || !validTimestamp(now)) return null;
  try {
    const value = JSON.parse(raw) as Partial<NativePushOwnerRecord> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.version !== NATIVE_PUSH_OWNER_RECORD_VERSION) return null;
    if (!validOwnerId(value.ownerId)) return null;
    if (!validTimestamp(value.refreshedAt) || !validTimestamp(value.expiresAt)) return null;
    if (value.refreshedAt > now || (!allowExpired && value.expiresAt <= now)) return null;
    if (value.expiresAt - value.refreshedAt !== NATIVE_PUSH_OWNER_LEASE_MS) return null;
    return value as NativePushOwnerRecord;
  } catch {
    return null;
  }
}

export function nativePushOwnerNeedsRefresh(
  record: NativePushOwnerRecord,
  now = Date.now(),
): boolean {
  return now - record.refreshedAt >= NATIVE_PUSH_OWNER_REFRESH_INTERVAL_MS;
}

export async function writeNativePushOwnerLease(
  storage: NativePushOwnerStorage,
  ownerId: string | null,
  now = Date.now(),
): Promise<void> {
  const record = ownerId ? createNativePushOwnerRecord(ownerId, now) : null;
  if (!record) {
    await storage.removeItem(NATIVE_PUSH_OWNER_STORAGE_KEY);
    await storage.removeItem(LEGACY_NATIVE_PUSH_OWNER_STORAGE_KEY);
    return;
  }
  await storage.setItem(NATIVE_PUSH_OWNER_STORAGE_KEY, JSON.stringify(record));
  // A v1 bare ID must never remain as an alternate authorization source.
  await storage.removeItem(LEGACY_NATIVE_PUSH_OWNER_STORAGE_KEY);
}

export async function readNativePushOwnerLease(
  storage: NativePushOwnerStorage,
  now = Date.now(),
): Promise<NativePushOwnerRecord | null> {
  const raw = await storage.getItem(NATIVE_PUSH_OWNER_STORAGE_KEY);
  const record = parseNativePushOwnerRecord(raw, now);
  const cleanup: Promise<unknown>[] = [
    storage.removeItem(LEGACY_NATIVE_PUSH_OWNER_STORAGE_KEY),
  ];
  if (!record && raw !== null) cleanup.push(storage.removeItem(NATIVE_PUSH_OWNER_STORAGE_KEY));
  await Promise.allSettled(cleanup);
  return record;
}

/** Respect a structurally valid newer owner even when its lease needs renewal. */
export async function clearNativePushOwnerLease(
  storage: NativePushOwnerStorage,
  expectedOwnerId: string | null = null,
  now = Date.now(),
): Promise<boolean> {
  const raw = await storage.getItem(NATIVE_PUSH_OWNER_STORAGE_KEY);
  const current = parseNativePushOwnerRecord(raw, now, true);
  await storage.removeItem(LEGACY_NATIVE_PUSH_OWNER_STORAGE_KEY);
  if (expectedOwnerId && current && current.ownerId !== expectedOwnerId) return false;
  await storage.removeItem(NATIVE_PUSH_OWNER_STORAGE_KEY);
  return raw !== null;
}
