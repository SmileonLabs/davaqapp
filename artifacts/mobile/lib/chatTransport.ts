import {
  customFetch,
  sendMessage,
  fetchRoomMessages,
  type Message,
} from "@workspace/api-client-react";

/** Q has private memory/AI storage, but shares the messenger outbox and cursors. */
export const agentConversationId = (userId: string) => `davaq-agent:${userId}`;
export const isAgentConversation = (id: string) =>
  id.startsWith("davaq-agent:");
const endpoint = "/api/agents/me/conversation/messages";

export const sendChatMessage: typeof sendMessage = (id, input, options) => {
  if (!isAgentConversation(id)) return sendMessage(id, input, options);
  return customFetch<Message>(endpoint, {
    ...options,
    method: "POST",
    body: JSON.stringify(input),
  });
};

export const fetchChatMessages: typeof fetchRoomMessages = (
  id,
  params,
  options,
) => {
  if (!isAgentConversation(id)) return fetchRoomMessages(id, params, options);
  const search = new URLSearchParams();
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.afterSeq != null) search.set("afterSeq", String(params.afterSeq));
  return customFetch<Message[]>(`${endpoint}?${search}`, options);
};
