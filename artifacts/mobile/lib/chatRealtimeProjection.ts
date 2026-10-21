import {
  mergeChatMessages,
  type ChatMessageLike,
} from "./chatMessageReliability.ts";

type LiveMessage = ChatMessageLike & { readCount?: number };
export type ReadCursor = {
  userId: string;
  lastReadSeq: number;
  isReadReceiptParticipant: boolean;
};

/** Only authenticated server payloads enter this projection. Never advance the catch-up cursor here. */
export function projectCreatedMessage<T extends LiveMessage>(
  current: T[],
  incoming: T,
  roomId: string,
): T[] {
  if (
    !incoming || typeof incoming.id !== "string" || typeof incoming.senderId !== "string" ||
    incoming.roomId !== roomId ||
    !Number.isSafeInteger(incoming.roomSeq) ||
    incoming.roomSeq <= 0
  )
    return current;
  return mergeChatMessages(current, [incoming]) as T[];
}

export function projectReadCursors<T extends LiveMessage>(
  current: T[],
  cursors: ReadCursor[],
): T[] {
  return current.map((message) => {
    if (message.roomSeq <= 0) return message;
    const count = new Set(cursors.filter(
      (reader) =>
        reader.isReadReceiptParticipant &&
        reader.userId !== message.senderId &&
        reader.lastReadSeq >= message.roomSeq,
    ).map(reader => reader.userId)).size;
    return count > (message.readCount ?? 0)
      ? { ...message, readCount: count }
      : message;
  });
}
