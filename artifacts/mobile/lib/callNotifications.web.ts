// Web no-op stub. Android alone uses the full-screen Notifee call notification;
// iOS remains a standard notification without PushKit/CallKit. Web/PWA shows the
// in-app CallProvider modal instead. Metro picks this file on web.

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

export const callNotificationsSupported = false;

export async function setupCallNotifications(): Promise<void> {}

export async function displayIncomingCallNotification(
  _intent: IncomingCallIntent,
): Promise<void> {}

export async function cancelIncomingCallNotification(_callId?: string): Promise<void> {}

export function terminalCallIdFromData(_data: Record<string, unknown> | undefined): string | null {
  return null;
}

export async function getTrackedIncomingCalls(): Promise<TrackedIncomingCall[]> {
  return [];
}

export async function cancelExpiredIncomingCallNotifications(): Promise<void> {}

export function subscribeCallActions(_handlers: {
  onAccept: (intent: IncomingCallIntent) => void | Promise<void>;
  onDecline: (intent: IncomingCallIntent) => void | Promise<void>;
}): () => void {
  return () => {};
}

export async function clearPendingCallIntent(_callId?: string): Promise<void> {}

export async function consumePendingCallIntent(): Promise<PendingCallAction | null> {
  return null;
}
