import notifee, { EventType } from "@notifee/react-native";
import { NativeModules, Platform } from "react-native";
import { getCurrentNativePushOwner } from "./nativePushOwner";
import {
  shouldClearChatNotification,
  type ChatNotificationRead,
  type DisplayedChatNotification,
} from "./chatNotificationPolicy";
export type { ChatNotificationRead } from "./chatNotificationPolicy";

type DeliveredApi = {
  getDeliveredNotifications?: () => Promise<DisplayedChatNotification[]>;
  removeDeliveredNotifications?: (ids: string[]) => Promise<void>;
};
export async function clearChatNotifications(
  roomId?: string | null,
  read: ChatNotificationRead = {},
): Promise<void> {
  await clearChatNotificationReads([{ roomId, read }]);
}
export async function clearChatNotificationReads(
  reads: { roomId?: string | null; read: ChatNotificationRead }[],
): Promise<void> {
  if (!reads.length) return;
  const ownerId = reads.find((item) => item.read.ownerId)?.read.ownerId;
  try {
    if (ownerId && (await getCurrentNativePushOwner()) !== ownerId) return;
    const native =
      Platform.OS === "ios"
        ? (NativeModules.DavaQSystemCalls as DeliveredApi | undefined)
        : undefined;
    const displayed = native?.getDeliveredNotifications
      ? await native.getDeliveredNotifications()
      : await notifee.getDisplayedNotifications();
    const selected = displayed.filter((item) =>
      reads.some((entry) =>
        shouldClearChatNotification(item, entry.roomId, entry.read),
      ),
    );
    if (ownerId && (await getCurrentNativePushOwner()) !== ownerId) return;
    if (native?.removeDeliveredNotifications) {
      await native.removeDeliveredNotifications(
        selected
          .map((item) => item.id ?? item.notification?.id)
          .filter((id): id is string => !!id),
      );
    } else {
      await Promise.all(
        selected.map(async (item) => {
          const id = item.id ?? item.notification?.id;
          if (id)
            await notifee.cancelDisplayedNotification(
              id,
              item.notification?.android?.tag ??
                (typeof item.notification?.data?.tag === "string"
                  ? item.notification.data.tag
                  : undefined),
            );
        }),
      );
    }
  } catch {
    // OS notification failures must not interrupt the conversation.
  }
}
let badgeRevision = 0;
export async function syncUnreadNotificationBadge(
  count: number,
  ownerId?: string,
): Promise<void> {
  const revision = ++badgeRevision;
  try {
    if (!ownerId || (await getCurrentNativePushOwner()) !== ownerId) return;
    if (revision !== badgeRevision) return;
    await notifee.setBadgeCount(Math.max(0, Math.floor(count)));
  } catch {
    /* Device/launcher badge support varies. */
  }
}

export function subscribeChatNotificationDelivery(handler: () => void): () => void {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type !== EventType.DELIVERED) return;
    if (shouldClearChatNotification({ notification: detail.notification }, null, { allowLegacy: true })) handler();
  });
}
