export function countMessageReaders(message: { roomSeq: number; senderId: string }, members: readonly {
  userId: string; lastReadSeq: number; isReadReceiptParticipant: boolean;
}[]): number {
  if (!Number.isSafeInteger(message.roomSeq) || message.roomSeq <= 0) return 0;
  return members.filter((member) => member.isReadReceiptParticipant &&
    member.userId !== message.senderId && member.lastReadSeq >= message.roomSeq).length;
}
