import type { QueryClient } from "@tanstack/react-query";
import { getFetchRoomMessagesQueryKey, type Message } from "@workspace/api-client-react";
import { fetchChatMessages } from "./chatTransport";
import { mergeConcurrentChatWrites, reconcileLatestMessageWindow } from "./chatMessageReliability";

/** Publish latest rows independently of durable contiguous cursor recovery. */
export async function refreshLatestRoomMessages(client: QueryClient, roomId: string, signal: AbortSignal) {
  if (!roomId || signal.aborted) return;
  const key = getFetchRoomMessagesQueryKey(roomId);
  const snapshot = client.getQueryData<Message[]>(key) ?? [];
  const latest = await fetchChatMessages(roomId, { limit: 50 }, { signal });
  if (signal.aborted) return;
  client.setQueryData<Message[]>(key, live => mergeConcurrentChatWrites(snapshot, live ?? [], reconcileLatestMessageWindow(snapshot, latest, 50)) as Message[]);
  // This projection neither marks messages read nor advances the receive cursor.
}
