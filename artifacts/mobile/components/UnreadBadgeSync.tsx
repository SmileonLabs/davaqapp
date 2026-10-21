import React from "react";
import { Platform } from "react-native";
import {
  clearChatNotificationReads,
  syncUnreadNotificationBadge,
  subscribeChatNotificationDelivery,
} from "@/lib/chatNotifications";
import { useUnreadMessageCount } from "@/hooks/useUnreadMessageCount";

type BadgingNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function UnreadBadgeSync() {
  const { count, rooms, ownerId, ready, dataUpdatedAt, refetch } =
    useUnreadMessageCount();

  React.useEffect(() => {
    if (!ready || !ownerId) return;
    return subscribeChatNotificationDelivery(refetch);
  }, [ready, ownerId, refetch]);

  React.useEffect(() => {
    if (!ready || !ownerId) return;
    const snapshot = dataUpdatedAt;
    void clearChatNotificationReads(
      rooms
        .filter((room) => room.unreadCount === 0)
        .map((room) => ({
          roomId: room.id,
          read: {
            readThroughSeq: room.lastMessageSeq,
            readThroughAt: room.lastMessageAt ?? undefined,
            allowLegacy: true,
            observedBefore: snapshot,
            ownerId,
          },
        })),
    );
    void syncUnreadNotificationBadge(count, ownerId);
  }, [ready, ownerId, rooms, count, dataUpdatedAt]);

  React.useEffect(() => {
    if (!ready) return;
    if (Platform.OS !== "web" || typeof navigator === "undefined") return;
    const nav = navigator as BadgingNavigator;
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    if (count > 0) {
      void nav.setAppBadge(count).catch(() => {});
    } else {
      void nav.clearAppBadge().catch(() => {});
    }
  }, [count, ready]);

  return null;
}
