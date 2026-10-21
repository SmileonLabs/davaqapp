import type { Message } from '@workspace/api-client-react';
export const CHAT_HISTORY_LIMIT = 500;
export const CHAT_HISTORY_ROOM_LIMIT = 20;
export const CHAT_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export interface ChatHistorySnapshot {
  version: 1; userId: string; profileId: string; roomId: string;
  revision: string; snapshotRoomSeq: number; savedAt: number; messages: Message[];
}
export function parseChatHistory(raw: string | null, userId: string, profileId: string, roomId: string, now = Date.now()): ChatHistorySnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as ChatHistorySnapshot;
    if (s.version !== 1 || s.userId !== userId || s.profileId !== profileId || s.roomId !== roomId ||
      !/^(0|[1-9][0-9]{0,18})$/.test(s.revision) || BigInt(s.revision) > 9223372036854775807n ||
      !Number.isSafeInteger(s.snapshotRoomSeq) || s.snapshotRoomSeq < 0 ||
      !Number.isSafeInteger(s.savedAt) || s.savedAt > now + 60000 || now - s.savedAt > CHAT_HISTORY_RETENTION_MS ||
      !Array.isArray(s.messages) || s.messages.length > CHAT_HISTORY_LIMIT ||
      s.messages.some(m => !m || typeof m.id !== 'string' || typeof m.content !== 'string' || typeof m.senderId !== 'string' || typeof m.type !== 'string' || typeof m.authorKind !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || m.id.startsWith('temp-') || m.roomId !== roomId || !Number.isSafeInteger(m.roomSeq) || m.roomSeq <= 0 || m.roomSeq > s.snapshotRoomSeq)) return null;
    return s;
  } catch { return null; }
}
