import { sendMessage, fetchRoomMessages, fetchRoomChanges } from "@workspace/api-client-react";
export const sendChatMessage: typeof sendMessage = sendMessage;
export const fetchChatMessages: typeof fetchRoomMessages = fetchRoomMessages;
export const isAgentConversation = (_id: string) => false;

export function fetchChatChanges(roomId: string, afterRevision: string | null, signal: AbortSignal) {
  return fetchRoomChanges(roomId, afterRevision === null ? undefined : { afterRevision }, { signal });
}
