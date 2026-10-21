/** Owner-checked native push adapters publish only room identifiers. */
const listeners = new Set<(roomId: string) => void>();
export function notifyChatPush(roomId: unknown) {
  if (typeof roomId !== "string" || !roomId) return;
  for (const listener of listeners) listener(roomId);
}
export function subscribeChatPush(listener: (roomId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function chatRoomFromPush(data: Record<string, unknown> | undefined) {
  if (typeof data?.roomId === "string") return data.roomId;
  const match = typeof data?.url === "string" ? data.url.match(/^\/(?:app\/)?chat\/([^/?#]+)/) : null;
  return match?.[1] ?? null;
}
