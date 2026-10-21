export function selectPreloadRooms<T extends { id: string; unreadCount?: number | null; lastMessageAt?: string | null }>(rooms: readonly T[], limit = 6): T[] {
  const time = (value?: string | null) => { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? parsed : 0; };
  return [...rooms].sort((a, b) => Number((b.unreadCount ?? 0) > 0) - Number((a.unreadCount ?? 0) > 0) || time(b.lastMessageAt) - time(a.lastMessageAt)).slice(0, limit);
}
