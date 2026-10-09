import { AppState } from "react-native";
import {
  telecom,
  pendingSystemActions,
  subscribeSystemCall,
} from "./androidTelecom.android";
import { getCurrentNativePushOwner } from "./nativePushOwner";
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
export const callNotificationsSupported = Boolean(telecom);
export function terminalCallIdFromData(
  data?: Record<string, unknown>,
): string | null {
  if (typeof data?.callId !== "string") return null;
  return /^(call_)?(ended|declined|missed|cancelled|failed|terminated)$/.test(
    String(data.type),
  ) || /^(ended|declined|missed|cancelled|failed)$/.test(String(data.status))
    ? data.callId
    : null;
}
export async function setupCallNotifications(): Promise<void> {}
export async function displayIncomingCallNotification(
  intent: IncomingCallIntent,
): Promise<void> {
  const ownerId = await getCurrentNativePushOwner();
  if (!ownerId || !telecom) return;
  await telecom
    .startCall(
      JSON.stringify({
        ...intent,
        ownerId,
        direction: "incoming",
        expiresAt: intent.expiresAt ?? Date.now() + 45_000,
      }),
    )
    .catch(() => {});
}
// Hiding a ring notification on accept must never disconnect the Telecom session.
export async function cancelIncomingCallNotification(
  callId?: string,
): Promise<void> {
  const id = callId ?? JSON.parse((await telecom?.snapshot()) ?? "{}").callId;
  if (id) await telecom?.dismiss(id);
}
export async function getTrackedIncomingCalls(): Promise<
  TrackedIncomingCall[]
> {
  const state = JSON.parse((await telecom?.snapshot()) ?? "{}");
  if (!state.callId || state.active || state.direction !== "incoming")
    return [];
  return [
    {
      intent: {
        callId: state.callId,
        callerName: state.callerName,
        chatRoomId: state.chatRoomId || null,
        media: state.media,
      },
      displayedAt: state.expiresAt - 45_000,
    },
  ];
}
export async function cancelExpiredIncomingCallNotifications(): Promise<void> {} // Native service owns expiry.
function intentOf(
  action: Awaited<ReturnType<typeof pendingSystemActions>>[number],
): IncomingCallIntent {
  return {
    callId: action.callId,
    callerName: action.callerName,
    chatRoomId: action.chatRoomId || null,
    media: action.media,
  };
}
export function subscribeCallActions(handlers: {
  onAccept: (intent: IncomingCallIntent) => void | Promise<void>;
  onDecline: (intent: IncomingCallIntent) => void | Promise<void>;
}): () => void {
  let running = false,
    disposed = false;
  const drain = async () => {
    if (running || disposed) return;
    running = true;
    try {
      for (const action of await pendingSystemActions()) {
        if (disposed) break;
        if (action.action === "end") continue; // Provider performs durable authenticated termination.
        await (action.action === "accept"
          ? handlers.onAccept(intentOf(action))
          : handlers.onDecline(intentOf(action)));
        // The owner consumes/acknowledges only after the server confirms via clearPendingCallIntent.
      }
    } finally {
      running = false;
    }
  };
  const run = () => {
    void drain().catch(() => {});
  };
  const unsubscribe = subscribeSystemCall((event) => {
    if (event.kind === "action") run();
  });
  const app = AppState.addEventListener("change", (state) => {
    if (state === "active") run();
  });
  const retry = setInterval(() => {
    if (AppState.currentState === "active") run();
  }, 5_000);
  run();
  return () => {
    disposed = true;
    clearInterval(retry);
    unsubscribe();
    app.remove();
  };
}
export async function clearPendingCallIntent(
  callId?: string,
  kind?: "accept" | "decline",
): Promise<void> {
  for (const action of await pendingSystemActions()) {
    if (
      (!callId || action.callId === callId) &&
      (!kind || action.action === kind)
    )
      await telecom?.acknowledge(action.id);
  }
}
export async function consumePendingCallIntent(): Promise<PendingCallAction | null> {
  // Native subscription drains cold-start and foreground actions through the same path.
  return null;
}
