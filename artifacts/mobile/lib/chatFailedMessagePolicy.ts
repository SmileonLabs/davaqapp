export interface FailedMessageCandidate {
  id: string;
  clientMessageId?: string | null;
  senderId: string;
  _deliveryState?: string;
}
/** Only local, failed operations owned by the active sender may be discarded. */
export function canDiscardFailedMessage(message: FailedMessageCandidate, clientMessageId: string, senderId: string): boolean {
  return message.senderId === senderId && message.clientMessageId === clientMessageId && message.id.startsWith("temp-") && message._deliveryState === "failed";
}
