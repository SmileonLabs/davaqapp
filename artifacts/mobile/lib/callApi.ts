import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  customFetch,
  type Call,
  type CallMedia,
  type CallSession,
  type CustomFetchOptions,
} from "@workspace/api-client-react";
import { durableCallAttemptId } from "./callAttemptPolicy";

const DIAGNOSTIC_QUEUE_KEY = "anotherme.call-diagnostics.v2";
const TERMINATION_OUTBOX_KEY = "anotherme.call-termination-outbox.v2";

const DIAGNOSTIC_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINATION_TTL_MS = 48 * 60 * 60 * 1000;
const DIAGNOSTIC_TIMEOUT_MS = 4_000;
const CALL_CONTROL_TIMEOUT_MS = 12_000;
const MAX_DIAGNOSTICS = 120;
const MAX_TERMINATIONS = 20;
const MAX_DETAIL_KEYS = 20;
const MAX_DETAIL_STRING_LENGTH = 200;

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|credential|message(body)?|content|text|sdp|candidate|url|identity|email|phone|profile|handle/i;
const URL_OR_BEARER_VALUE = /(?:bearer\s+|https?:\/\/|wss?:\/\/|eyJ[A-Za-z0-9_-]{8,}\.)/i;

type DiagnosticDetails = Record<string, unknown>;

interface QueuedDiagnostic {
  eventId: string;
  attemptId: string;
  callId?: string;
  phase: string;
  platform: string;
  role?: string;
  occurredAt: string;
  details?: DiagnosticDetails;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

interface QueuedTermination {
  operationId: string;
  attemptId?: string;
  callId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

let storageChain: Promise<unknown> = Promise.resolve();
let reliabilityOwnerId: string | null = null;
let reliabilityOwnerGeneration = 0;
const ownerAbortControllers = new Set<AbortController>();
let diagnosticFlush: Promise<void> | null = null;
let terminationFlush: Promise<void> | null = null;
let diagnosticRetryTimer: ReturnType<typeof setTimeout> | null = null;
let terminationRetryTimer: ReturnType<typeof setTimeout> | null = null;

function ownerStorageKey(base: string, ownerId = reliabilityOwnerId): string | null {
  return ownerId ? `${base}.${encodeURIComponent(ownerId)}` : null;
}

/**
 * Prevent a queued request created by account A from being sent under account
 * B after logout/login on the same device. Queues remain isolated and expire
 * naturally; returning to A resumes only A's queue.
 */
export function configureCallReliabilityOwner(ownerId?: string | null): void {
  const normalized = ownerId?.trim() || null;
  if (normalized === reliabilityOwnerId) return;
  reliabilityOwnerId = normalized;
  reliabilityOwnerGeneration += 1;
  for (const controller of ownerAbortControllers) controller.abort();
  ownerAbortControllers.clear();
  if (diagnosticRetryTimer) clearTimeout(diagnosticRetryTimer);
  if (terminationRetryTimer) clearTimeout(terminationRetryTimer);
  diagnosticRetryTimer = null;
  terminationRetryTimer = null;
  // Do not reuse an old owner's single-flight promise. Each in-flight flush
  // checks the captured owner again before sending its next network request.
  diagnosticFlush = null;
  terminationFlush = null;
  if (normalized) flushPendingCallReliability();
}

function uuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createCallAttemptId(): string {
  return uuid();
}

function attemptHeaders(attemptId?: string, operationId?: string): HeadersInit {
  return {
    ...(attemptId ? { "X-Call-Attempt-Id": attemptId } : {}),
    ...(operationId ? { "X-Idempotency-Key": operationId } : {}),
  };
}

function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const result = storageChain.then(task, task);
  storageChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeArray<T>(key: string, value: T[]): Promise<void> {
  if (value.length === 0) {
    await AsyncStorage.removeItem(key);
  } else {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  }
}

export function callReliabilityRetryDelay(attempts: number): number {
  const capped = Math.min(Math.max(attempts, 1), 8);
  return Math.min(60_000, 1_000 * 2 ** (capped - 1));
}

function errorStatus(err: unknown): number | null {
  const value = err as { status?: unknown } | null;
  return typeof value?.status === "number" ? value.status : null;
}

function retryableControlFailure(err: unknown): boolean {
  const status = errorStatus(err);
  return status === null || status === 408 || status === 429 || status >= 500;
}

function permanentDiagnosticFailure(err: unknown): boolean {
  const status = errorStatus(err);
  return status === 400 || status === 403 || status === 404 || status === 413;
}

function scheduleDiagnosticRetry(delayMs: number, ownerId: string): void {
  if (diagnosticRetryTimer) clearTimeout(diagnosticRetryTimer);
  diagnosticRetryTimer = setTimeout(() => {
    diagnosticRetryTimer = null;
    if (reliabilityOwnerId !== ownerId) return;
    void flushCallDiagnostics().catch(() => {});
  }, delayMs);
}

function scheduleTerminationRetry(delayMs: number, ownerId: string): void {
  if (terminationRetryTimer) clearTimeout(terminationRetryTimer);
  terminationRetryTimer = setTimeout(() => {
    terminationRetryTimer = null;
    if (reliabilityOwnerId !== ownerId) return;
    void flushCallTerminationOutbox().catch(() => {});
  }, delayMs);
}

function sanitizeString(value: string): string | undefined {
  if (URL_OR_BEARER_VALUE.test(value)) return undefined;
  return value.slice(0, MAX_DETAIL_STRING_LENGTH);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 10)
      .map(sanitizeValue)
      .filter((item) => item !== undefined);
  }
  // Nested objects make it too easy to accidentally persist SDP, candidates,
  // auth payloads, or message bodies. Lifecycle diagnostics only need scalars.
  return undefined;
}

export function sanitizeCallDiagnosticDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(details).slice(0, MAX_DETAIL_KEYS)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const value = sanitizeValue(raw);
    if (value !== undefined) safe[key.slice(0, 64)] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

async function requestWithTimeout<T>(
  path: string,
  init: CustomFetchOptions,
  timeoutMs: number,
): Promise<T> {
  const ownerId = reliabilityOwnerId;
  const ownerGeneration = reliabilityOwnerGeneration;
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromOwner = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromOwner, { once: true });
  ownerAbortControllers.add(controller);
  try {
    if (
      controller.signal.aborted ||
      ownerId !== reliabilityOwnerId ||
      ownerGeneration !== reliabilityOwnerGeneration
    ) throw new Error("call_owner_changed");
    const result = await customFetch<T>(path, {
      ...init,
      signal: controller.signal,
      timeoutMs,
    });
    if (ownerId !== reliabilityOwnerId || ownerGeneration !== reliabilityOwnerGeneration) {
      throw new Error("call_owner_changed");
    }
    return result;
  } finally {
    ownerAbortControllers.delete(controller);
    externalSignal?.removeEventListener("abort", abortFromOwner);
  }
}

async function callControlWithRetry<T>(request: () => Promise<T>): Promise<T> {
  const ownerId = reliabilityOwnerId;
  const ownerGeneration = reliabilityOwnerGeneration;
  try {
    return await request();
  } catch (err) {
    if (ownerId !== reliabilityOwnerId || ownerGeneration !== reliabilityOwnerGeneration) throw err;
    if (!retryableControlFailure(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (ownerId !== reliabilityOwnerId || ownerGeneration !== reliabilityOwnerGeneration) throw err;
    return request();
  }
}

export async function createTrackedCall(
  input: { calleeId: string; roomId?: string; media?: CallMedia },
  attemptId: string,
): Promise<CallSession> {
  return callControlWithRetry(() =>
    requestWithTimeout<CallSession>("/api/calls", {
      method: "POST",
      responseType: "json",
      headers: attemptHeaders(attemptId),
      body: JSON.stringify(input),
    }, CALL_CONTROL_TIMEOUT_MS),
  );
}

export async function acceptTrackedCall(callId: string, attemptId?: string): Promise<CallSession> {
  return callControlWithRetry(() =>
    requestWithTimeout<CallSession>(`/api/calls/${callId}/accept`, {
      method: "POST",
      responseType: "json",
      headers: attemptHeaders(attemptId),
    }, CALL_CONTROL_TIMEOUT_MS),
  );
}

export async function joinTrackedCall(callId: string, attemptId?: string): Promise<CallSession> {
  return callControlWithRetry(() =>
    requestWithTimeout<CallSession>(`/api/calls/${callId}/join`, {
      method: "POST",
      responseType: "json",
      headers: attemptHeaders(attemptId),
    }, CALL_CONTROL_TIMEOUT_MS),
  );
}

export async function declineTrackedCall(callId: string, attemptId?: string): Promise<Call> {
  const operationId = uuid();
  return callControlWithRetry(() =>
    requestWithTimeout<Call>(`/api/calls/${callId}/decline`, {
      method: "POST",
      responseType: "json",
      headers: attemptHeaders(attemptId, operationId),
    }, CALL_CONTROL_TIMEOUT_MS),
  );
}

export async function getTrackedCall(callId: string, attemptId?: string): Promise<Call> {
  return requestWithTimeout<Call>(`/api/calls/${callId}`, {
    method: "GET",
    responseType: "json",
    headers: attemptHeaders(attemptId),
  }, CALL_CONTROL_TIMEOUT_MS);
}

export async function resolveTrackedCallAttempt(
  callId: string,
): Promise<{ call: Call; attemptId?: string }> {
  // Deliberately header-free: this read resolves the durable generation needed
  // by card actions and cannot itself mutate or join the call.
  const call = await requestWithTimeout<Call>(`/api/calls/${callId}`, {
    method: "GET",
    responseType: "json",
  }, CALL_CONTROL_TIMEOUT_MS);
  return { call, attemptId: durableCallAttemptId(call) };
}

async function persistDiagnostic(event: QueuedDiagnostic): Promise<void> {
  const key = ownerStorageKey(DIAGNOSTIC_QUEUE_KEY);
  if (!key) return;
  await runSerialized(async () => {
    const now = Date.now();
    const queue = (await readArray<QueuedDiagnostic>(key))
      .filter((item) => now - item.createdAt <= DIAGNOSTIC_TTL_MS)
      .filter((item) => item.eventId !== event.eventId);
    queue.push(event);
    await writeArray(key, queue.slice(-MAX_DIAGNOSTICS));
  });
}

async function removeOrRescheduleDiagnostic(
  eventId: string,
  failed: boolean,
  permanent: boolean,
  ownerId: string,
): Promise<void> {
  const key = ownerStorageKey(DIAGNOSTIC_QUEUE_KEY, ownerId);
  if (!key) return;
  await runSerialized(async () => {
    const now = Date.now();
    const queue = await readArray<QueuedDiagnostic>(key);
    const next = queue.flatMap((item) => {
      if (item.eventId !== eventId) {
        return now - item.createdAt <= DIAGNOSTIC_TTL_MS ? [item] : [];
      }
      if (!failed || permanent || now - item.createdAt > DIAGNOSTIC_TTL_MS) return [];
      const attempts = item.attempts + 1;
      return [{ ...item, attempts, nextAttemptAt: now + callReliabilityRetryDelay(attempts) }];
    });
    await writeArray(key, next.slice(-MAX_DIAGNOSTICS));
  });
}

export function flushCallDiagnostics(): Promise<void> {
  if (diagnosticFlush) return diagnosticFlush;
  const ownerId = reliabilityOwnerId;
  const ownerGeneration = reliabilityOwnerGeneration;
  const key = ownerStorageKey(DIAGNOSTIC_QUEUE_KEY, ownerId);
  if (!ownerId || !key) return Promise.resolve();
  const ownerController = new AbortController();
  ownerAbortControllers.add(ownerController);
  const ownerIsCurrent = () =>
    reliabilityOwnerId === ownerId && reliabilityOwnerGeneration === ownerGeneration;
  const work = (async () => {
    if (diagnosticRetryTimer) {
      clearTimeout(diagnosticRetryTimer);
      diagnosticRetryTimer = null;
    }
    const queue = await runSerialized(() => readArray<QueuedDiagnostic>(key));
    if (!ownerIsCurrent()) return;
    const now = Date.now();
    let nextRetryDelay: number | null = null;
    let authUnavailable = false;
    for (const event of queue) {
      if (!ownerIsCurrent()) return;
      if (now - event.createdAt > DIAGNOSTIC_TTL_MS) {
        await removeOrRescheduleDiagnostic(event.eventId, false, true, ownerId);
        continue;
      }
      if (event.nextAttemptAt > now) {
        const delay = event.nextAttemptAt - now;
        nextRetryDelay = nextRetryDelay == null ? delay : Math.min(nextRetryDelay, delay);
        continue;
      }
      try {
        const payload = {
          eventId: event.eventId,
          attemptId: event.attemptId,
          callId: event.callId,
          phase: event.phase,
          platform: event.platform,
          role: event.role,
          occurredAt: event.occurredAt,
          details: event.details,
        };
        await requestWithTimeout("/api/calls/diagnostics", {
          method: "POST",
          responseType: "text",
          headers: { "X-Call-Attempt-Id": event.attemptId },
          signal: ownerController.signal,
          body: JSON.stringify(payload),
        }, DIAGNOSTIC_TIMEOUT_MS);
        if (!ownerIsCurrent()) return;
        await removeOrRescheduleDiagnostic(event.eventId, false, false, ownerId);
      } catch (err) {
        if (!ownerIsCurrent()) return;
        const permanent = permanentDiagnosticFailure(err);
        await removeOrRescheduleDiagnostic(event.eventId, true, permanent, ownerId);
        // Preserve ordering and stop when the network/auth path is unavailable.
        if (!permanent) {
          // An expired/sign-out auth session is retried by the next app/online
          // activation, not a background timer that would wake forever.
          if (errorStatus(err) === 401) authUnavailable = true;
          else {
            const delay = callReliabilityRetryDelay(event.attempts + 1);
            nextRetryDelay = nextRetryDelay == null ? delay : Math.min(nextRetryDelay, delay);
          }
          break;
        }
      }
    }
    // A persisted future retry can survive a process reload with no in-memory
    // timer. Re-arm it here so the queue does not depend on another user action.
    if (!authUnavailable && nextRetryDelay != null && ownerIsCurrent()) {
      scheduleDiagnosticRetry(Math.max(0, nextRetryDelay), ownerId);
    }
  });
  const tracked = work().finally(() => {
    ownerAbortControllers.delete(ownerController);
    if (diagnosticFlush === tracked) diagnosticFlush = null;
  });
  diagnosticFlush = tracked;
  return tracked;
}

export function reportCallDiagnostic(
  callId: string | null | undefined,
  payload: {
    attemptId?: string;
    phase: string;
    platform: string;
    role?: string;
    details?: Record<string, unknown>;
  },
): void {
  const attemptId = payload.attemptId ?? createCallAttemptId();
  const now = Date.now();
  const event: QueuedDiagnostic = {
    eventId: uuid(),
    attemptId,
    callId: callId || undefined,
    phase: payload.phase.slice(0, 100),
    platform: payload.platform.slice(0, 50),
    role: payload.role?.slice(0, 50),
    occurredAt: new Date(now).toISOString(),
    details: sanitizeCallDiagnosticDetails(payload.details),
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
  };
  void persistDiagnostic(event)
    .then(async () => {
      // If a flush had already snapshotted the queue, the first await joins that
      // run and the second pass picks up this newly persisted event.
      await flushCallDiagnostics();
      await flushCallDiagnostics();
    })
    .catch(() => {});
}

async function persistTermination(event: QueuedTermination): Promise<void> {
  const key = ownerStorageKey(TERMINATION_OUTBOX_KEY);
  if (!key) return;
  await runSerialized(async () => {
    const now = Date.now();
    const queue = (await readArray<QueuedTermination>(key))
      .filter((item) => now - item.createdAt <= TERMINATION_TTL_MS)
      .filter((item) => item.operationId !== event.operationId);
    queue.push(event);
    await writeArray(key, queue.slice(-MAX_TERMINATIONS));
  });
}

async function updateTermination(
  operationId: string,
  outcome: "success" | "permanent-failure" | "retry",
  ownerId: string,
): Promise<void> {
  const key = ownerStorageKey(TERMINATION_OUTBOX_KEY, ownerId);
  if (!key) return;
  await runSerialized(async () => {
    const now = Date.now();
    const queue = await readArray<QueuedTermination>(key);
    const next = queue.flatMap((item) => {
      if (item.operationId !== operationId) {
        return now - item.createdAt <= TERMINATION_TTL_MS ? [item] : [];
      }
      if (outcome !== "retry" || now - item.createdAt > TERMINATION_TTL_MS) return [];
      const attempts = item.attempts + 1;
      return [{ ...item, attempts, nextAttemptAt: now + callReliabilityRetryDelay(attempts) }];
    });
    await writeArray(key, next.slice(-MAX_TERMINATIONS));
  });
}

export function flushCallTerminationOutbox(): Promise<void> {
  if (terminationFlush) return terminationFlush;
  const ownerId = reliabilityOwnerId;
  const ownerGeneration = reliabilityOwnerGeneration;
  const key = ownerStorageKey(TERMINATION_OUTBOX_KEY, ownerId);
  if (!ownerId || !key) return Promise.resolve();
  const ownerController = new AbortController();
  ownerAbortControllers.add(ownerController);
  const ownerIsCurrent = () =>
    reliabilityOwnerId === ownerId && reliabilityOwnerGeneration === ownerGeneration;
  const work = (async () => {
    if (terminationRetryTimer) {
      clearTimeout(terminationRetryTimer);
      terminationRetryTimer = null;
    }
    const queue = await runSerialized(() => readArray<QueuedTermination>(key));
    if (!ownerIsCurrent()) return;
    const now = Date.now();
    let nextRetryDelay: number | null = null;
    let authUnavailable = false;
    for (const event of queue) {
      if (!ownerIsCurrent()) return;
      if (now - event.createdAt > TERMINATION_TTL_MS) {
        await updateTermination(event.operationId, "permanent-failure", ownerId);
        continue;
      }
      if (event.nextAttemptAt > now) {
        const delay = event.nextAttemptAt - now;
        nextRetryDelay = nextRetryDelay == null ? delay : Math.min(nextRetryDelay, delay);
        continue;
      }
      try {
        await requestWithTimeout<Call>(`/api/calls/${event.callId}/end`, {
          method: "POST",
          responseType: "json",
          headers: {
            ...(event.attemptId ? { "X-Call-Attempt-Id": event.attemptId } : {}),
            "X-Idempotency-Key": event.operationId,
          },
          signal: ownerController.signal,
        }, CALL_CONTROL_TIMEOUT_MS);
        if (!ownerIsCurrent()) return;
        await updateTermination(event.operationId, "success", ownerId);
      } catch (err) {
        if (!ownerIsCurrent()) return;
        const status = errorStatus(err);
        const permanent = status === 400 || status === 403 || status === 404 || status === 409;
        await updateTermination(event.operationId, permanent ? "permanent-failure" : "retry", ownerId);
        if (!permanent) {
          if (status === 401) authUnavailable = true;
          else {
            const delay = callReliabilityRetryDelay(event.attempts + 1);
            nextRetryDelay = nextRetryDelay == null ? delay : Math.min(nextRetryDelay, delay);
          }
          break;
        }
      }
    }
    if (!authUnavailable && nextRetryDelay != null && ownerIsCurrent()) {
      scheduleTerminationRetry(Math.max(0, nextRetryDelay), ownerId);
    }
  });
  const tracked = work().finally(() => {
    ownerAbortControllers.delete(ownerController);
    if (terminationFlush === tracked) terminationFlush = null;
  });
  terminationFlush = tracked;
  return tracked;
}

/**
 * Persist before attempting the network request. The server remains the source
 * of truth; this outbox only reduces the window before server reconciliation.
 */
export async function enqueueCallTermination(callId: string, attemptId?: string): Promise<string> {
  const now = Date.now();
  const operationId = uuid();
  await persistTermination({
    operationId,
    attemptId,
    callId,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
  });
  void (async () => {
    await flushCallTerminationOutbox();
    await flushCallTerminationOutbox();
  })().catch(() => {});
  return operationId;
}

export function installCallReliabilityFlushTriggers(): () => void {
  const flush = () => {
    void flushCallDiagnostics().catch(() => {});
    void flushCallTerminationOutbox().catch(() => {});
  };
  flush();
  const onOnline = () => flush();
  // React Native exposes window, but it is not a DOM event target.
  const browserWindow =
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function"
      ? window
      : null;
  browserWindow?.addEventListener("online", onOnline);
  return () => {
    browserWindow?.removeEventListener("online", onOnline);
  };
}

export function flushPendingCallReliability(): void {
  void flushCallDiagnostics().catch(() => {});
  void flushCallTerminationOutbox().catch(() => {});
}

export async function markCallFailed(
  callId: string,
  attemptId?: string,
): Promise<Call | null> {
  const operationId = uuid();
  try {
    return await requestWithTimeout<Call>(`/api/calls/${callId}/failed`, {
      method: "POST",
      responseType: "json",
      headers: {
        ...(attemptId ? { "X-Call-Attempt-Id": attemptId } : {}),
        "X-Idempotency-Key": operationId,
      },
    }, CALL_CONTROL_TIMEOUT_MS);
  } catch {
    return null;
  }
}
