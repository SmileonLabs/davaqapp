import { useAuth as useClerkAuth } from "@clerk/expo";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { getApiBase } from "./apiBase";
import { encodeSocialVerifier } from "./socialVerifier";

type Session = { accessToken: string; expiresAt: number; sessionId: string; userId: string; dbUserId: string; refreshToken?: string };
type Pending = { state: string; verifier: string };
const SESSION_KEY = "davaq.social.session.v1", PENDING_KEY = "davaq.social.pending.v1";
let snapshot: { loaded: boolean; session: Session | null } = { loaded: false, session: null };
const listeners = new Set<() => void>();
let hydration: Promise<void> | undefined, refreshing: Promise<Session | null> | undefined;
let completing: Promise<boolean> | undefined, generation = 0;
let startingGeneration: number | undefined;
let storageWrites: Promise<unknown> = Promise.resolve();
export function socialSessionIdentity() { return snapshot.session; }
const publish = (session: Session | null) => { snapshot = { loaded: true, session }; listeners.forEach(f => f()); };
async function read(key: string) { return Platform.OS === "web" ? sessionStorage.getItem(key) : SecureStore.getItemAsync(key); }
async function write(key: string, value: unknown, expectedGeneration?: number) {
  // SecureStore operations cannot be cancelled. Preserve their order so an old
  // refresh write cannot finish after a newer login or logout write.
  const operation = storageWrites.then(async () => {
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return;
    if (Platform.OS === "web") { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, JSON.stringify(value)); }
    else if (value == null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, JSON.stringify(value));
  });
  storageWrites = operation.catch(() => {});
  await operation;
}
async function request(path: string, body: unknown, token?: string | null, signal?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${getApiBase()}/api/auth/social/${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: controller.signal });
    if (response.status === 204) return null;
    const value = await response.json().catch(error => { if (controller.signal.aborted) throw error; return {}; });
    if (!response.ok) throw Object.assign(new Error(value.error ?? "로그인 서버에 연결하지 못했어요."), { status: response.status });
    return value;
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
}
async function accept(session: Session, expectedGeneration: number) {
  if (expectedGeneration !== generation) return null;
  // Web refresh tokens stay in a Secure HttpOnly cookie, not browser storage.
  if (Platform.OS !== "web") await write(SESSION_KEY, { refreshToken: session.refreshToken }, expectedGeneration);
  if (expectedGeneration !== generation) return null;
  publish(session);
  return session;
}
async function refresh(): Promise<Session | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const startedGeneration = generation;
    let refreshToken: string | undefined;
    try {
      if (Platform.OS !== "web") {
        refreshToken = JSON.parse(await read(SESSION_KEY) ?? "null")?.refreshToken;
        if (generation !== startedGeneration) return null;
        if (!refreshToken) { publish(null); return null; }
      }
      const result = await request("refresh", { web: Platform.OS === "web", refreshToken });
      if (generation !== startedGeneration) return null;
      return await accept({ ...result, refreshToken }, startedGeneration);
    } catch (e: any) {
      if (generation !== startedGeneration) return null;
      if (e.status === 401) {
        await write(SESSION_KEY, null, startedGeneration);
        if (generation === startedGeneration) publish(null);
      }
      else if (!snapshot.loaded) publish(null);
      return null;
    } finally { refreshing = undefined; }
  })();
  return refreshing;
}
export async function getSocialToken() {
  const session = snapshot.session;
  if (session && session.expiresAt > Date.now() + 60_000) return session.accessToken;
  return (await refresh())?.accessToken ?? null;
}
export async function socialSignOut() {
  const startedGeneration = ++generation;
  const pendingCompletion = Platform.OS === "web" ? completing : undefined;
  const refreshToken = snapshot.session?.refreshToken;
  await write(PENDING_KEY, null, startedGeneration);
  try {
    // A completed web login sets its HttpOnly cookie outside JavaScript's
    // generation guard. Clear it after any earlier completion response arrives.
    await pendingCompletion?.catch(() => {});
    if (generation !== startedGeneration) return;
    await request("logout", { web: Platform.OS === "web", refreshToken });
  }
  finally {
    await write(SESSION_KEY, null, startedGeneration);
    if (generation === startedGeneration) publish(null);
  }
}
const validSecret = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
function trustedSocialUrl(value: unknown, state: unknown): string {
  if (typeof value !== "string" || !validSecret(state)) throw new Error("로그인 주소를 확인하지 못했어요.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("로그인 주소를 확인하지 못했어요."); }
  const returnTo = url.searchParams.get("returnTo");
  if (!["https://davaq.app", "https://davaq.anothermeai.app"].includes(url.origin) ||
      url.pathname !== "/api/auth/social/browser" || value.includes("@") || value.includes("#") ||
      url.username || url.password || url.hash ||
      url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state ||
      url.searchParams.getAll("returnTo").length > 1 ||
      (returnTo !== null && !["web", "legacy-web", "app"].includes(returnTo)) ||
      [...url.searchParams.keys()].some(key => key !== "state" && key !== "returnTo")) {
    throw new Error("로그인 주소를 확인하지 못했어요.");
  }
  return url.toString();
}
const cancelledStart = () => Object.assign(new Error("로그인을 취소했어요."), { name: "AbortError" });
export async function startSocial(provider: "google" | "apple", token?: string | null, { signal }: { signal?: AbortSignal } = {}) {
  if (signal?.aborted) throw cancelledStart();
  const startedGeneration = ++generation;
  startingGeneration = startedGeneration;
  // Supersede the old result in memory, but keep its HTTP completion serialized:
  // a late Set-Cookie must arrive before the next login creates its web session.
  const check = () => { if (signal?.aborted || generation !== startedGeneration) throw cancelledStart(); };
  try {
    await write(PENDING_KEY, null, startedGeneration);
    check();
    const verifier = Crypto.getRandomBytes(32);
    const secret = encodeSocialVerifier(verifier);
    check();
    const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, secret);
    check();
    const result = await request(token ? "link" : "start", { provider, challenge }, token, signal);
    check();
    const url = trustedSocialUrl(result?.url, result?.state);
    check();
    await write(PENDING_KEY, { state: result.state, verifier: secret }, startedGeneration);
    check();
    return url;
  } catch (error) {
    if (generation === startedGeneration) {
      const cleanupGeneration = ++generation;
      await write(PENDING_KEY, null, cleanupGeneration).catch(() => {});
    }
    throw error;
  } finally {
    if (startingGeneration === startedGeneration) startingGeneration = undefined;
  }
}
async function readPendingSocial(expectedGeneration: number): Promise<Pending | null> {
  const raw = await read(PENDING_KEY);
  let pending: Pending | null;
  try { pending = JSON.parse(raw ?? "null"); } catch { pending = null; }
  if (generation !== expectedGeneration) return null;
  if (raw && (!pending || !validSecret(pending.state) || !validSecret(pending.verifier))) {
    await write(PENDING_KEY, null, expectedGeneration);
    return null;
  }
  return pending;
}
async function completePendingSocial() {
  let startedGeneration = generation;
  if (startingGeneration === startedGeneration) return false;
  const pending = await readPendingSocial(startedGeneration);
  if (generation !== startedGeneration) return false;
  if (!pending) return false;
  try {
    const result = await request("complete", { ...pending, web: Platform.OS === "web" });
    if (result.pending) return false;
    if (startedGeneration !== generation) return false;
    // A newly completed login supersedes refreshes started with an old or
    // absent session. Their late 401/success responses must not replace it.
    startedGeneration = ++generation;
    if (!await accept(result, startedGeneration)) return false;
    await write(PENDING_KEY, null, startedGeneration);
    return startedGeneration === generation;
  } catch (e: any) {
    if (startedGeneration !== generation) return false;
    if (e.status && e.status !== 500) await write(PENDING_KEY, null, startedGeneration);
    const messages: Record<string, string> = {
      INVALID_ATTEMPT: "로그인 요청이 만료됐어요. 로그인 화면에서 다시 시작해 주세요.",
      AUTH_FAILED: "로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      EXISTING_ACCOUNT_LINK_REQUIRED: "기존 계정 연결을 위해 로그인 서버 업데이트가 필요합니다. 잠시 후 다시 시도해 주세요.",
      AMBIGUOUS_EMAIL_ACCOUNT: "같은 이메일의 계정이 여러 개 있어 자동 연결하지 않았어요. 계정 확인을 요청해 주세요.",
      VERIFIED_EMAIL_REQUIRED: "이메일이 확인된 Google 또는 Apple 계정으로 다시 시도해 주세요.",
      ACCOUNT_ALREADY_LINKED: "이미 다른 계정에 연결된 SNS 계정입니다.",
      PROVIDER_UNAVAILABLE: "이 로그인 방식은 잠시 사용할 수 없어요. 다른 로그인 방식을 선택하거나 잠시 후 다시 시도해 주세요.",
      PROVIDER_FAILED: "SNS 인증을 완료하지 못했어요. 다시 시도해 주세요.",
    };
    throw new Error(messages[e.message] ?? e.message);
  }
}
export function completeSocial() {
  if (!completing) {
    const operation = completePendingSocial().finally(() => { if (completing === operation) completing = undefined; });
    completing = operation;
  }
  return completing;
}
export async function waitForSocialCompletion({ signal, timeoutMs = 15_000 }: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
  if (signal?.aborted) return false;
  const duration = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(timeoutMs, 60_000)) : 15_000;
  if (!duration) return false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, duration);
  const stopped = new Promise<false>(resolve => controller.signal.addEventListener("abort", () => resolve(false), { once: true }));
  if (signal?.aborted) cancel();
  const pause = () => new Promise<void>(resolve => {
    const stop = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", stop); resolve(); };
    const timer = setTimeout(stop, 500);
    controller.signal.addEventListener("abort", stop, { once: true });
    if (controller.signal.aborted) stop();
  });
  const poll = async () => {
    while (!controller.signal.aborted) {
      const pending = await readPendingSocial(generation);
      if (controller.signal.aborted) return false;
      // An AppState check may finish before the callback screen mounts. The
      // accepted session remains authoritative after its pending data is gone.
      if (!pending) return snapshot.session !== null;
      if (await completeSocial()) return true;
      if (controller.signal.aborted) return false;
      await pause();
    }
    return false;
  };
  try { return await Promise.race([poll(), stopped]); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); controller.abort(); }
}
export function useAuth() {
  const legacy = useClerkAuth();
  const legacyGetToken = useRef(legacy.getToken);
  // Clerk Expo creates a new wrapper every render. Update its delegate after
  // commit while keeping the API bridge's token getter identity stable.
  useEffect(() => { legacyGetToken.current = legacy.getToken; }, [legacy.getToken]);
  const state = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => snapshot, () => snapshot);
  useEffect(() => { hydration ??= refresh().then(() => undefined); }, []);
  const getToken = useCallback(async (options?: any) => snapshot.session ? getSocialToken() : legacyGetToken.current(options), []);
  const signOut = useCallback(async (_options?: any) => { await socialSignOut(); if (legacy.isSignedIn) await legacy.signOut(); }, [legacy.isSignedIn, legacy.signOut]);
  if (state.session) return { ...legacy, isLoaded: state.loaded, isSignedIn: true, userId: state.session.userId, sessionId: state.session.sessionId,
    getToken, signOut };
  return { ...legacy, isLoaded: state.loaded && legacy.isLoaded, getToken, signOut };
}
