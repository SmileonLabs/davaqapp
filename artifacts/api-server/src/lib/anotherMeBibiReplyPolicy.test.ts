import { describe, expect, it } from "vitest";
import { normalizeBibiOfficialReply } from "./anotherMeBibiReplyPolicy";
import { createAiReplyResult } from "./anotherMeReplyPolicy";

function reply(replyMessages: string[]) {
  return createAiReplyResult({
    replyMessages,
    safetyLevel: "SAFE",
    requiresOwnerConfirmation: false,
    blockedReason: null,
    toneSyncScore: 60,
  });
}

describe("BIBI official reply policy", () => {
  it("uses the public persona introduction instead of AI-proxy wording", () => {
    const normalized = normalizeBibiOfficialReply(reply(["나는 DavaQ라서 대신 응대해"]), "너 누구야?");
    expect(normalized.replyText).toContain("나는 BIBI");
    expect(normalized.replyText).not.toMatch(/Another\s*Me|대신\s*응대/i);
  });

  it("removes assistant-service tone while retaining a usable reply", () => {
    const normalized = normalizeBibiOfficialReply(
      reply(["안내해 드릴 수 있어요. 오늘 하루는 어땠어?"]),
      "오늘 뭐 했어?",
    );
    expect(normalized.replyText).toBe("오늘 하루는 어땠어?");
  });
});
