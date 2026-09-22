// @ts-nocheck -- exercised by the API workspace Vitest runner.
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  customFetch: vi.fn(),
  sendMessage: vi.fn(),
  fetchRoomMessages: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => api);
import {
  agentConversationId,
  fetchChatMessages,
  sendChatMessage,
} from "./chatTransport";
const user = "a71b73ce-9149-4cf1-bd5e-883c43423210";
describe("shared messenger transport", () => {
  beforeEach(() => vi.resetAllMocks());
  it("keeps normal room delivery and its options unchanged", async () => {
    const input = {
        type: "text" as const,
        content: "hello",
        clientMessageId: "m-operation",
      },
      options = {
        signal: new AbortController().signal,
        headers: { "x-character-profile-id": "profile" },
      };
    api.sendMessage.mockResolvedValue({ id: "normal" });
    expect(await sendChatMessage("room", input, options)).toEqual({
      id: "normal",
    });
    expect(api.sendMessage).toHaveBeenCalledWith("room", input, options);
    expect(api.customFetch).not.toHaveBeenCalled();
  });
  it("uses the same durable operation ID and owner headers for Q", async () => {
    const input = {
      type: "image" as const,
      content: "/objects/uploads/photo",
      clientMessageId: "m-operation",
      replyToMessageId: null,
    };
    const options = {
      signal: new AbortController().signal,
      headers: { "x-character-profile-id": "profile" },
    };
    await sendChatMessage(agentConversationId(user), input, options);
    expect(api.customFetch).toHaveBeenCalledWith(
      "/api/agents/me/conversation/messages",
      { ...options, method: "POST", body: JSON.stringify(input) },
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
  it("passes catch-up cursors without changing normal room reads", async () => {
    const options = { signal: new AbortController().signal };
    await fetchChatMessages(
      agentConversationId(user),
      { afterSeq: 0, limit: 100 },
      options,
    );
    expect(api.customFetch).toHaveBeenCalledWith(
      "/api/agents/me/conversation/messages?limit=100&afterSeq=0",
      options,
    );
    await fetchChatMessages("room", { afterSeq: 4, limit: 50 }, options);
    expect(api.fetchRoomMessages).toHaveBeenCalledWith(
      "room",
      { afterSeq: 4, limit: 50 },
      options,
    );
  });
  it("does not disguise rejected ownership or network failures as successful delivery", async () => {
    const denied = Object.assign(new Error("denied"), { status: 403 });
    api.customFetch.mockRejectedValue(denied);
    await expect(
      sendChatMessage(agentConversationId(user), {
        content: "private",
        clientMessageId: "m-operation",
      }),
    ).rejects.toBe(denied);
  });
});
