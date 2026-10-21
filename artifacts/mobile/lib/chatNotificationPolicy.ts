export type DisplayedChatNotification = {
  id?: string;
  date?: number | string;
  notification?: {
    id?: string;
    data?: Record<string, unknown>;
    android?: { tag?: string; timestamp?: number };
  };
};
export type ChatNotificationRead = {
  readThroughSeq?: number;
  readThroughAt?: string;
  allowLegacy?: boolean;
  observedBefore?: number;
  ownerId?: string;
};
export function shouldClearChatNotification(
  item: DisplayedChatNotification,
  roomId: string | null | undefined,
  read: ChatNotificationRead = {},
): boolean {
  const data = item.notification?.data ?? {};
  const type = String(data.type ?? "");
  if (
    type === "call" ||
    type === "incoming_call" ||
    type.startsWith("call_") ||
    data.callId
  )
    return false;
  if (
    read.ownerId &&
    data.recipientUserId &&
    data.recipientUserId !== read.ownerId
  )
    return false;
  const tag = item.notification?.android?.tag ?? data.tag;
  const url = typeof data.url === "string" ? data.url : "";
  const actualRoom =
    typeof data.roomId === "string"
      ? data.roomId
      : typeof data.chatRoomId === "string"
        ? data.chatRoomId
        : url.match(/^\/chat\/([^/?#]+)(?:[/?#]|$)/)?.[1];
  if (
    roomId
      ? actualRoom !== roomId && tag !== `room-${roomId}`
      : !actualRoom && !(typeof tag === "string" && tag.startsWith("room-"))
  )
    return false;
  const seq = Number(data.messageSeq);
  if (Number.isSafeInteger(seq) && seq > 0 && read.readThroughSeq != null)
    return seq <= read.readThroughSeq;
  const created =
    typeof data.messageCreatedAt === "string"
      ? Date.parse(data.messageCreatedAt)
      : NaN;
  const cutoff = read.readThroughAt ? Date.parse(read.readThroughAt) : NaN;
  if (Number.isFinite(created) && Number.isFinite(cutoff))
    return created <= cutoff;
  if (!read.allowLegacy) return false;
  const rawDate = item.date ?? item.notification?.android?.timestamp;
  const delivered =
    typeof rawDate === "string"
      ? Number(rawDate) || Date.parse(rawDate)
      : rawDate;
  return !delivered || !read.observedBefore || delivered <= read.observedBefore;
}
