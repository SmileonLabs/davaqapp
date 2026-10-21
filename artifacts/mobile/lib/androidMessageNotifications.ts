import notifee, { AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import { AppState } from "react-native";
import type { FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import { nativePushMatchesCurrentOwner } from "./nativePushOwner";

export const GENERAL_NOTIFICATION_CHANNEL_ID = "general-notifications";
export async function ensureMessageNotificationChannel(): Promise<void> {
  await notifee.createChannel({
    id: GENERAL_NOTIFICATION_CHANNEL_ID,
    name: "메시지 및 일반 알림",
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
    sound: "default",
    vibration: true,
  });
}
export function notificationUrlFromData(data?: Record<string, unknown>): string | null {
  const url = data?.url;
  return typeof url === "string" && /^\/(?![\/\\])[^\\\r\n]*$/.test(url) ? url : null;
}
export type ForegroundNotificationContext = { pathname: string; enabled: boolean };
// Android only auto-displays FCM notifications in the background.
const delivered = new Set<string>();
export async function displayForegroundMessage(
  message: FirebaseMessagingTypes.RemoteMessage,
  getContext: () => ForegroundNotificationContext,
): Promise<void> {
  const data = message.data;
  if (!message.notification || !getContext().enabled) return;
  if (data?.type === "incoming_call" || String(data?.type ?? "").startsWith("call_")) return;
  if (!(await nativePushMatchesCurrentOwner(data?.recipientUserId))) return;
  const url = notificationUrlFromData(data);
  const id = message.messageId;
  if (id && delivered.has(id)) return;
  await ensureMessageNotificationChannel();
  // Account, preference or room may have changed during asynchronous work.
  const context = getContext();
  if (!context.enabled || !(await nativePushMatchesCurrentOwner(data?.recipientUserId))) return;
  if (AppState.currentState === "active" && url?.startsWith("/chat/") && context.pathname === url) return;
  if (id && delivered.has(id)) return;
  if (id) {
    delivered.add(id);
    if (delivered.size > 200) delivered.delete(delivered.values().next().value!);
  }
  try {
    await notifee.displayNotification({
      id: typeof data?.tag === "string" ? data.tag : id,
      title: message.notification.title ?? "DavaQ",
      body: message.notification.body ?? "새 알림이 도착했습니다.",
      data: data as Record<string, string>,
      android: {
        channelId: GENERAL_NOTIFICATION_CHANNEL_ID,
        pressAction: { id: "default", launchActivity: "default" },
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PRIVATE,
        sound: "default",
        autoCancel: true,
      },
    });
  } catch (error) {
    if (id) delivered.delete(id);
    throw error;
  }
}
