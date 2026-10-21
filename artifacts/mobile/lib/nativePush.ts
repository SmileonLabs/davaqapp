import {notifyShopPush} from './shopPushRefresh';
import { notifyChatPush, chatRoomFromPush } from "./chatPushRefresh";
import { getApplePushCredentials } from "./applePush";
import { endSystemCall } from "./systemCalls";
import { incomingCallDeadline } from "./incomingCallDeadline";
// Native push via @react-native-firebase/messaging (Android FCM). Device-token
// registration + FOREGROUND message handling live here; the killed/background
// handler is registered at the app entry (index.js → lib/fcmBackground.ts).
// notifee renders the actual full-screen incoming-call UI (callNotifications.ts).
// Metro picks nativePush.web.ts on web.

import messaging from "@react-native-firebase/messaging";
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
} from "@notifee/react-native";
import { PermissionsAndroid, Platform } from "react-native";
import {
  cancelIncomingCallNotification,
  clearPendingCallIntent,
  terminalCallIdFromData,
  type IncomingCallIntent,
} from "@/lib/callNotifications";
import { stashNotificationRoute, consumeNotificationRoute } from "./notificationIntent";
import { getCurrentNativePushOwner, nativePushMatchesCurrentOwner } from "@/lib/nativePushOwner";

export const nativePushSupported = Platform.OS !== "web";
export const GENERAL_NOTIFICATION_CHANNEL_ID = "general-notifications";

export type NativePushState = {
  supported: boolean;
  permission: "default" | "granted" | "denied";
  tokenAvailable: boolean;
};

function hasNotificationPermissionStatus(status: AuthorizationStatus): boolean {
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

async function requestAndroidPostNotificationsPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) return true;
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function setupNotificationHandler(): void {
  void (async () => {
    try {
      await notifee.createChannel({
        id: GENERAL_NOTIFICATION_CHANNEL_ID,
        name: "일반 알림",
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        sound: "default",
        vibration: true,
      });
    } catch {}
  })();
}

export async function registerForPushTokenAsync(): Promise<string | null> {
  try {
    if (!(await requestAndroidPostNotificationsPermission())) return null;

    const notifeeSettings = await notifee.requestPermission();
    if (!hasNotificationPermissionStatus(notifeeSettings.authorizationStatus))
      return null;

    if (Platform.OS !== "android") {
      const status = await messaging().requestPermission();
      const granted =
        status === messaging.AuthorizationStatus.AUTHORIZED ||
        status === messaging.AuthorizationStatus.PROVISIONAL;
      if (!granted) return null;
    }

    if (Platform.OS === "ios") {
      await messaging().registerDeviceForRemoteMessages();
    }
    const token = await messaging().getToken();
    return token || null;
  } catch {
    return null;
  }
}

export async function getExistingNativePushToken(): Promise<string | null> {
  try {
    return (await messaging().getToken()) || null;
  } catch {
    return null;
  }
}

export async function getNativePushState(): Promise<NativePushState> {
  if (!nativePushSupported) {
    return { supported: false, permission: "default", tokenAvailable: false };
  }

  try {
    const settings = await notifee.getNotificationSettings();
    const permission = hasNotificationPermissionStatus(
      settings.authorizationStatus,
    )
      ? "granted"
      : settings.authorizationStatus === AuthorizationStatus.DENIED
        ? "denied"
        : "default";

    let tokenAvailable = false;
    if (permission === "granted") {
      try {
        tokenAvailable = Platform.OS === "ios"
          ? (await getApplePushCredentials()).some(token => token.startsWith("apns:"))
          : Boolean(await messaging().getToken());
      } catch {
        tokenAvailable = false;
      }
    }

    return { supported: true, permission, tokenAvailable };
  } catch {
    return { supported: true, permission: "default", tokenAvailable: false };
  }
}

function intentFromData(
  data: Record<string, string | object> | undefined,
): IncomingCallIntent | null {
  if (!data) return null;
  if (data.type !== "incoming_call") return null;
  const callId = typeof data.callId === "string" ? data.callId : null;
  if (!callId) return null;
  return {
    callId,
    callerName:
      typeof data.callerName === "string" ? data.callerName : "수신 전화",
    chatRoomId:
      typeof data.chatRoomId === "string" && data.chatRoomId
        ? data.chatRoomId
        : null,
    media: data.media === "video" ? "video" : "audio",
    expiresAt: incomingCallDeadline(data.expiresAt),
  };
}

function notificationUrlFromData(
  data: Record<string, string | object> | undefined,
): string | null {
  const url = data?.url;
  if (typeof url !== "string") return null;
  // Only route in-app paths. External URLs should not be opened from push data.
  return url.startsWith("/") ? url : null;
}

// Foreground-only: messages that arrive while the app is open. Killed/background
// delivery is handled by lib/fcmBackground.ts.
export function subscribeForegroundIncomingCall(
  handler: (intent: IncomingCallIntent) => void,
): () => void {
  return messaging().onMessage(async (remoteMessage) => {
    if (
      !(await nativePushMatchesCurrentOwner(
        remoteMessage.data?.recipientUserId,
      ))
    )
      return;
    notifyChatPush(chatRoomFromPush(remoteMessage.data));
    notifyShopPush(remoteMessage.data);
    const terminalCallId = terminalCallIdFromData(remoteMessage.data);
    if (terminalCallId) {
      await endSystemCall(terminalCallId);
      await cancelIncomingCallNotification(terminalCallId);
      await clearPendingCallIntent(terminalCallId);
      return;
    }
    const intent = intentFromData(remoteMessage.data);
    if (intent) {
      handler(intent);
    } else if (Platform.OS === "android" && remoteMessage.notification) {
      // FCM notification payloads are displayed by Android only while the app
      // is backgrounded. Render foreground messages after the same owner fence.
      try {
        await notifee.displayNotification({
          id: typeof remoteMessage.data?.tag === "string" ? remoteMessage.data.tag : remoteMessage.messageId,
          title: remoteMessage.notification.title ?? "새 메시지",
          body: remoteMessage.notification.body,
          data: remoteMessage.data,
          android: {
            channelId: GENERAL_NOTIFICATION_CHANNEL_ID,
            sound: "default",
            pressAction: { id: "default", launchActivity: "default" },
          },
        });
      } catch (error) {
        console.warn("Foreground notification display failed", error instanceof Error ? error.message : "unknown");
      }
    }
  });
}

export function subscribePushTokenRefresh(
  handler: (token: string) => void,
): () => void {
  return messaging().onTokenRefresh((token) => {
    if (token) handler(token);
  });
}

const notificationOpenHandlers = new Set<(url: string) => void>();
export function subscribeNotificationOpen(
  handler: (url: string) => void,
): () => void {
  notificationOpenHandlers.add(handler);
  const messagingListener = messaging().onNotificationOpenedApp(async (remoteMessage) => {
    if (
      !(await nativePushMatchesCurrentOwner(
        remoteMessage.data?.recipientUserId,
      ))
    )
      return;
    const url = notificationUrlFromData(remoteMessage.data);
    if (url) handler(url);
  });
  return () => { messagingListener(); notificationOpenHandlers.delete(handler); };
}

// iOS emits notification presses as foreground events, including cold launches.
// Capture before auth hydration; consume only after matching the signed-in owner.
notifee.onForegroundEvent(async ({ type, detail }) => {
  if (type !== EventType.PRESS) return;
  const data = detail.notification?.data;
  if (typeof data?.url !== "string" || !data.url.startsWith("/")) return;
  if (notificationOpenHandlers.size && await nativePushMatchesCurrentOwner(data.recipientUserId)) {
    notificationOpenHandlers.forEach(handler => handler(data.url as string));
  } else {
    await stashNotificationRoute(data);
  }
});

export async function getInitialNotificationUrl(): Promise<string | null> {
  try {
    const stored = await consumeNotificationRoute(await getCurrentNativePushOwner());
    if (stored) return stored;
    const remoteMessage = await messaging().getInitialNotification();
    if (
      !(await nativePushMatchesCurrentOwner(
        remoteMessage?.data?.recipientUserId,
      ))
    ) {
      return null;
    }
    return notificationUrlFromData(remoteMessage?.data);
  } catch {
    return null;
  }
}
