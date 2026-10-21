import { incomingCallDeadline } from "./incomingCallDeadline";
import { incomingCallExpiry } from "./androidCallPolicy";
import { getApps } from "@react-native-firebase/app";
import { endSystemCall } from "./androidTelecom";
// Registered before Expo Router for headless Android FCM delivery.
// The native Telecom service owns the incoming notification and durable actions.

import messaging from "@react-native-firebase/messaging";
import {
  cancelIncomingCallNotification,
  clearPendingCallIntent,
  displayIncomingCallNotification,
  terminalCallIdFromData,
} from "./callNotifications.android";
import { nativePushMatchesOwnerWithRenewal } from "./nativePushOwner";
import { getHeadlessPushAuth } from "./headlessPushAuth.android";
import { flushBackgroundCallActions } from "./callActionBackground.android";

if (getApps().length > 0)
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    const data = remoteMessage.data;
    if (!data) return;
    if (!(await nativePushMatchesOwnerWithRenewal(data.recipientUserId,
      async (ownerId) => Boolean(await getHeadlessPushAuth(ownerId))))) return;
    // A later push is another opportunity to retry a durable reject/hangup.
    // Keep this independent so a failed cleanup never prevents incoming ringing.
    void flushBackgroundCallActions().catch(() => undefined);
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
    const sentDeadline = incomingCallExpiry(remoteMessage.sentTime);
    const expiresAt = sentDeadline && Math.min(sentDeadline, incomingCallDeadline(data.expiresAt));
    if (!expiresAt) return;
    const callId = typeof data.callId === "string" ? data.callId : null;
    if (!callId) return;
    await displayIncomingCallNotification({
      callId,
      expiresAt,
      callerName:
        typeof data.callerName === "string" ? data.callerName : "수신 전화",
      chatRoomId:
        typeof data.chatRoomId === "string" && data.chatRoomId
          ? data.chatRoomId
          : null,
      media: data.media === "video" ? "video" : "audio",
    });
  });
