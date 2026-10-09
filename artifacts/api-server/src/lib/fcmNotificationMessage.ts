import type { Message } from "firebase-admin/messaging";
export interface FcmNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  channelId?: string;
  tag?: string;
}
/** Match the audible channel created by Android; never use FCM's fallback channel. */
export function buildFcmNotificationMessage(userId: string, token: string, payload: FcmNotificationPayload): Message {
  return {
    token,
    notification: { title: payload.title, body: payload.body },
    data: { ...(payload.data ?? {}), recipientUserId: userId },
    android: {
      priority: "high",
      notification: {
        channelId: payload.channelId ?? "general-notifications",
        sound: "default",
        defaultVibrateTimings: true,
        visibility: "private",
        ...(payload.tag ? { tag: payload.tag } : {}),
      },
    },
  };
}
