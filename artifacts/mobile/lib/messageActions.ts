import { customFetch, type Message } from "@workspace/api-client-react";

export type DeleteMessageScope = "me" | "everyone";

function newClientMessageId(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `m-${randomId}`;
}

export function deleteMessage(
  roomId: string,
  messageId: string,
  scope: DeleteMessageScope,
): Promise<void> {
  return customFetch<void>(
    `/api/rooms/${roomId}/messages/${messageId}/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    },
  );
}

export function pinMessage(roomId: string, messageId: string): Promise<void> {
  return customFetch<void>(`/api/rooms/${roomId}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId }),
  });
}

export function unpinMessage(roomId: string): Promise<void> {
  return customFetch<void>(`/api/rooms/${roomId}/pin`, { method: "DELETE" });
}

export function forwardMessage(
  roomId: string,
  messageId: string,
  targetRoomId: string,
  clientMessageId = newClientMessageId(),
): Promise<Message> {
  return customFetch<Message>(
    `/api/rooms/${roomId}/messages/${messageId}/forward`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetRoomId, clientMessageId }),
    },
  );
}

export function addMessageStickerBadge(
  roomId: string,
  messageId: string,
  code: string,
  remove = false,
): Promise<void> {
  return customFetch<void>(
    `/api/rooms/${roomId}/messages/${messageId}/sticker`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, remove }),
    },
  );
}
