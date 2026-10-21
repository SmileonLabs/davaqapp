import { endSystemCall } from "./systemCalls";
import { incomingCallDeadline } from "./incomingCallDeadline";
// FCM background/quit-state handler. Imported by the app entry (index.js) BEFORE
// React renders, so it is registered in the headless JS context Android spins up
// for a killed/backgrounded app. A high-priority DATA-ONLY FCM message (sent by
// the server — see api-server lib/fcm.ts) wakes this handler, which renders the
// notifee full-screen incoming call over the lock screen. Importing
// callNotifications also registers notifee.onBackgroundEvent so accept/decline
// taps work in this same headless context. Metro picks fcmBackground.web.ts
// (no-op) on web.

import messaging from "@react-native-firebase/messaging";
import {
  cancelIncomingCallNotification,
  clearPendingCallIntent,
  displayIncomingCallNotification,
  terminalCallIdFromData,
} from "./callNotifications";
import { nativePushMatchesCurrentOwner } from "./nativePushOwner";

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  const data = remoteMessage.data;
  if (!data) return;
  if (!(await nativePushMatchesCurrentOwner(data.recipientUserId))) return;
  // The current backend only emits incoming_call here. If an existing FCM call
  // lifecycle payload reaches a device later, clear only that call's notification.
  const terminalCallId = terminalCallIdFromData(data);
  if (terminalCallId) {
    await endSystemCall(terminalCallId);
    await cancelIncomingCallNotification(terminalCallId);
    await clearPendingCallIntent(terminalCallId);
    return;
  }
  if (data.type !== "incoming_call") return;
  const callId = typeof data.callId === "string" ? data.callId : null;
  if (!callId) return;
  await displayIncomingCallNotification({
    callId,
    callerName:
      typeof data.callerName === "string" ? data.callerName : "수신 전화",
    chatRoomId:
      typeof data.chatRoomId === "string" && data.chatRoomId
        ? data.chatRoomId
        : null,
    media: data.media === "video" ? "video" : "audio",
    expiresAt: incomingCallDeadline(data.expiresAt),
  });
});
