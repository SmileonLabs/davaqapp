import { incomingCallExpiry } from "./androidCallPolicy";
import { getApps } from "@react-native-firebase/app";
import { endSystemCall } from "./androidTelecom";
// Native push via @react-native-firebase/messaging (Android FCM). Device-token
// registration + FOREGROUND message handling live here; the killed/background
// handler is registered at the app entry (index.js → lib/fcmBackground.ts).
// Core-Telecom renders Android incoming calls; Notifee handles ordinary notifications.
// Metro picks nativePush.web.ts on web.

import messaging from "@react-native-firebase/messaging";
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
} from "@notifee/react-native";
import { PermissionsAndroid, Platform } from "react-native";
import {
  cancelIncomingCallNotification,
  clearPendingCallIntent,
  terminalCallIdFromData,
  type IncomingCallIntent,
} from "@/lib/callNotifications.android";
import { nativePushMatchesCurrentOwner } from "@/lib/nativePushOwner";

export const nativePushSupported = getApps().length > 0;
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
        tokenAvailable = Boolean(await messaging().getToken());
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
  if (!nativePushSupported) return () => {};
  return messaging().onMessage(async (remoteMessage) => {
    if (
      !(await nativePushMatchesCurrentOwner(
        remoteMessage.data?.recipientUserId,
      ))
    )
      return;
    const terminalCallId = terminalCallIdFromData(remoteMessage.data);
    if (terminalCallId) {
      await endSystemCall(terminalCallId);
      await cancelIncomingCallNotification(terminalCallId);
      await clearPendingCallIntent(terminalCallId);
      return;
    }
    const expiresAt = incomingCallExpiry(remoteMessage.sentTime);
    const intent = intentFromData(remoteMessage.data);
    if (intent && expiresAt) handler({ ...intent, expiresAt });
  });
}

export function subscribePushTokenRefresh(
  handler: (token: string) => void,
): () => void {
  if (!nativePushSupported) return () => {};
  return messaging().onTokenRefresh((token) => {
    if (token) handler(token);
  });
}

export function subscribeNotificationOpen(
  handler: (url: string) => void,
): () => void {
  if (!nativePushSupported) return () => {};
  return messaging().onNotificationOpenedApp(async (remoteMessage) => {
    if (
      !(await nativePushMatchesCurrentOwner(
        remoteMessage.data?.recipientUserId,
      ))
    )
      return;
    const url = notificationUrlFromData(remoteMessage.data);
    if (url) handler(url);
  });
}

export async function getInitialNotificationUrl(): Promise<string | null> {
  try {
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
