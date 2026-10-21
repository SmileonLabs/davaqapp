import type { ChatNotificationRead } from "./chatNotificationPolicy";
export async function syncUnreadNotificationBadge(
  _count: number,
  _ownerId?: string,
): Promise<void> {}
export async function clearChatNotifications(
  roomId?: string | null,
  read: ChatNotificationRead = {},
): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return;
    const registration = await navigator.serviceWorker.getRegistration();
    const target = navigator.serviceWorker.controller || registration?.active;
    if (!target) return;
    target.postMessage(
      roomId
        ? {
            type: "clear-room-notifications",
            read,
            roomId,
            tag: `room-${roomId}`,
          }
        : { type: "clear-chat-notifications", read },
    );
  } catch {
    // Best-effort: stale OS notifications should never break app UX.
  }
}

export async function clearChatNotificationReads(
  reads: { roomId?: string | null; read: ChatNotificationRead }[],
): Promise<void> {
  await Promise.all(
    reads.map((entry) => clearChatNotifications(entry.roomId, entry.read)),
  );
}

export function subscribeChatNotificationDelivery(_handler: () => void): () => void { return () => {}; }
