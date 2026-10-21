import { stashNotificationRoute } from "./notificationIntent";
// Android incoming-call notifications use Notifee. iOS reports CallKit calls;
// native PushKit starts that UI before React on a background/cold launch.
// Notifee is an alert fallback when CallKit is unavailable. Metro uses the web
// implementation for browsers.

import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  EventType,
  type Event,
} from "@notifee/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { incomingCallDeadline, incomingCallRemaining } from "./incomingCallDeadline";
import { reportSystemIncomingCall } from "./systemCalls";

export interface IncomingCallIntent {
  callId: string;
  callerName: string;
  chatRoomId: string | null;
  media: "audio" | "video";
  expiresAt?: number;
}

export interface PendingCallAction {
  action: "accept" | "decline";
  intent: IncomingCallIntent;
  expiresAt?: number;
}

export interface TrackedIncomingCall {
  intent: IncomingCallIntent;
  displayedAt: number;
}

export const callNotificationsSupported = true;

const CHANNEL_ID = "incoming-calls";
const LEGACY_NOTIFICATION_ID = "incoming-call";
const PENDING_KEY = "pendingCallAction";
const TRACKED_CALLS_KEY = "trackedIncomingCallNotifications";
const RING_TIMEOUT_MS = 45_000;

type StoredIncomingCalls = Record<string, TrackedIncomingCall>;

const TERMINAL_CALL_TYPES = new Set([
  "call_ended",
  "call_declined",
  "call_missed",
  "call_cancelled",
  "call_failed",
  "call_terminated",
]);
const TERMINAL_CALL_STATUSES = new Set([
  "ended",
  "declined",
  "missed",
  "cancelled",
  "failed",
]);

function notificationId(callId: string): string {
  // Each call owns its notification so a terminal event for one call cannot
  // dismiss a different device's/newer incoming call.
  return `incoming-call:${encodeURIComponent(callId)}`;
}

// An accept/decline tapped while the app was killed/backgrounded is handled by
// notifee.onBackgroundEvent, which runs in a SEPARATE headless JS context with
// no access to React navigation — and, crucially, no shared module state with
// the main app process. So the action must be persisted durably (AsyncStorage),
// not in a module-level variable, for the app to consume it on cold start.
async function stashPendingCallAction(action: PendingCallAction): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...action, expiresAt: incomingCallDeadline(action.intent.expiresAt) }),
    );
  } catch {}
}

function intentFromData(data: Record<string, unknown> | undefined): IncomingCallIntent | null {
  if (!data) return null;
  const callId = typeof data.callId === "string" ? data.callId : null;
  if (!callId) return null;
  return {
    callId,
    callerName: typeof data.callerName === "string" ? data.callerName : "수신 전화",
    chatRoomId: typeof data.chatRoomId === "string" ? data.chatRoomId : null,
    media: data.media === "video" ? "video" : "audio",
    expiresAt: incomingCallDeadline(data.expiresAt),
  };
}

function isTrackedIncomingCall(value: unknown): value is TrackedIncomingCall {
  const candidate = value as TrackedIncomingCall | null;
  return (
    !!candidate &&
    typeof candidate.displayedAt === "number" &&
    Number.isFinite(candidate.displayedAt) &&
    !!candidate.intent &&
    typeof candidate.intent.callId === "string" &&
    candidate.intent.callId.length > 0
  );
}

async function readTrackedIncomingCalls(): Promise<StoredIncomingCalls> {
  try {
    const raw = await AsyncStorage.getItem(TRACKED_CALLS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isTrackedIncomingCall(value)),
    ) as StoredIncomingCalls;
  } catch {
    return {};
  }
}

async function writeTrackedIncomingCalls(calls: StoredIncomingCalls): Promise<void> {
  try {
    if (Object.keys(calls).length === 0) {
      await AsyncStorage.removeItem(TRACKED_CALLS_KEY);
    } else {
      await AsyncStorage.setItem(TRACKED_CALLS_KEY, JSON.stringify(calls));
    }
  } catch {}
}

async function trackIncomingCall(intent: IncomingCallIntent, displayedAt: number): Promise<void> {
  const calls = await readTrackedIncomingCalls();
  calls[intent.callId] = { intent, displayedAt };
  await writeTrackedIncomingCalls(calls);
}

async function untrackIncomingCall(callId: string): Promise<void> {
  const calls = await readTrackedIncomingCalls();
  if (!(callId in calls)) return;
  delete calls[callId];
  await writeTrackedIncomingCalls(calls);
}

export function terminalCallIdFromData(data: Record<string, unknown> | undefined): string | null {
  if (!data || typeof data.callId !== "string" || !data.callId) return null;
  const type = typeof data.type === "string" ? data.type : "";
  const status = typeof data.status === "string" ? data.status : "";
  if (
    TERMINAL_CALL_TYPES.has(type) ||
    TERMINAL_CALL_STATUSES.has(status)
  ) {
    return data.callId;
  }
  return null;
}

type CallActionHandlers = {
  onAccept: (intent: IncomingCallIntent) => void | Promise<void>;
  onDecline: (intent: IncomingCallIntent) => void | Promise<void>;
};

async function handleEvent(
  event: Event,
  handlers?: CallActionHandlers,
): Promise<void> {
  const { type, detail } = event;
  if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;
  const intent = intentFromData(
    detail.notification?.data as Record<string, unknown> | undefined,
  );
  if (!intent) {
    await stashNotificationRoute(detail.notification?.data);
    return;
  }
  const actionId = detail.pressAction?.id ?? "default";
  const action: "accept" | "decline" = actionId === "decline" ? "decline" : "accept";
  await cancelIncomingCallNotification(intent.callId);
  if (handlers) {
    if (action === "decline") await handlers.onDecline(intent);
    else await handlers.onAccept(intent);
  } else {
    await stashPendingCallAction({ action, intent });
  }
}

// Background/quit-state taps. Must be registered exactly once at module load,
// before React renders — this runs in a headless JS context with no navigation.
notifee.onBackgroundEvent(async (event) => {
  await handleEvent(event);
});

export async function setupCallNotifications(): Promise<void> {
  try {
    await notifee.requestPermission();
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: "수신 전화",
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: "default",
      vibration: true,
    });
    // Remove the fixed ID used by builds before per-call IDs were introduced.
    await notifee.cancelNotification(LEGACY_NOTIFICATION_ID);
  } catch {}
}

export async function displayIncomingCallNotification(
  intent: IncomingCallIntent,
): Promise<void> {
  try {
    const tracked = await readTrackedIncomingCalls();
    const displayedAt = tracked[intent.callId]?.displayedAt ?? Date.now();
    const deadline = incomingCallDeadline(intent.expiresAt);
    const remaining = incomingCallRemaining(deadline, displayedAt);
    if (remaining <= 0) {
      await cancelIncomingCallNotification(intent.callId);
      return;
    }
    if (await reportSystemIncomingCall({ ...intent, expiresAt: deadline })) return;
    await notifee.displayNotification({
      id: notificationId(intent.callId),
      title: intent.callerName,
      body: intent.media === "video" ? "영상통화 수신…" : "수신 전화…",
      data: {
        callId: intent.callId,
        callerName: intent.callerName,
        chatRoomId: intent.chatRoomId ?? "",
        media: intent.media,
        expiresAt: String(deadline),
      },
      android: {
        channelId: CHANNEL_ID,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        // Launch the app full-screen over the lock screen.
        fullScreenAction: { id: "default", launchActivity: "default" },
        pressAction: { id: "default", launchActivity: "default" },
        actions: [
          // A headless background handler has no authenticated Clerk session.
          // Launch the app, persist the action, then replay it after auth is ready.
          { title: "거절", pressAction: { id: "decline", launchActivity: "default" } },
          { title: "수락", pressAction: { id: "accept", launchActivity: "default" } },
        ],
        // Keep it sticky so it behaves like a ringing call, not a dismissible
        // banner. Android still removes it after the server's maximum ring window.
        ongoing: true,
        autoCancel: false,
        loopSound: true,
        timeoutAfter: remaining,
      },
      ios: {
        critical: true,
        sound: "default",
        interruptionLevel: "timeSensitive",
      },
    });
    await trackIncomingCall(intent, displayedAt);
  } catch {}
}

export async function cancelIncomingCallNotification(callId?: string): Promise<void> {
  try {
    if (callId) {
      await notifee.cancelNotification(notificationId(callId));
      await untrackIncomingCall(callId);
      return;
    }
    const calls = await readTrackedIncomingCalls();
    await Promise.all(
      Object.keys(calls).map((id) => notifee.cancelNotification(notificationId(id)).catch(() => {})),
    );
    await notifee.cancelNotification(LEGACY_NOTIFICATION_ID);
    await writeTrackedIncomingCalls({});
  } catch {}
}

export async function getTrackedIncomingCalls(): Promise<TrackedIncomingCall[]> {
  return Object.values(await readTrackedIncomingCalls());
}

export async function cancelExpiredIncomingCallNotifications(): Promise<void> {
  const calls = await readTrackedIncomingCalls();
  const now = Date.now();
  const expired = Object.entries(calls).filter(([, call]) => call.displayedAt + RING_TIMEOUT_MS <= now);
  if (expired.length === 0) return;
  await Promise.all(
    expired.map(([callId]) => notifee.cancelNotification(notificationId(callId)).catch(() => {})),
  );
  expired.forEach(([callId]) => delete calls[callId]);
  await writeTrackedIncomingCalls(calls);
}

export function subscribeCallActions(handlers: {
  onAccept: (intent: IncomingCallIntent) => void | Promise<void>;
  onDecline: (intent: IncomingCallIntent) => void | Promise<void>;
}): () => void {
  return notifee.onForegroundEvent((event) => {
    void handleEvent(event, handlers);
  });
}

export async function clearPendingCallIntent(callId?: string): Promise<void> {
  try {
    if (callId) {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingCallAction;
      if (pending?.intent?.callId !== callId) return;
    }
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {}
}

export async function consumePendingCallIntent(): Promise<PendingCallAction | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCallAction;
    const intent = intentFromData(
      (parsed?.intent ?? undefined) as unknown as Record<string, unknown> | undefined,
    );
    if (parsed?.expiresAt != null && parsed.expiresAt <= Date.now()) {
      await clearPendingCallIntent();
      return null;
    }
    if (intent && (parsed.action === "accept" || parsed.action === "decline")) {
      return { action: parsed.action, intent, expiresAt: parsed.expiresAt };
    }
    await clearPendingCallIntent();
    return null;
  } catch {
    return null;
  }
}
