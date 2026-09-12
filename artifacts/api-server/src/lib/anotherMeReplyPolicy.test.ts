import { describe, expect, it } from "vitest";
import {
  classifySafety,
  clip,
  createAiReplyResult,
  normalizeReplyMessages,
  replaceReplyMessages,
} from "./anotherMeReplyPolicy";

describe("DavaQ reply policy", () => {
  it("redacts prompt-sensitive text before clipping", () => {
    const clipped = clip("mail@example.com 010-1234-5678 서울로 12", 200);
    expect(clipped).toContain("[이메일]");
    expect(clipped).toContain("[연락처]");
    expect(clipped).toContain("[주소]");
  });

  it("prioritizes blocked requests over caution and normalizes reply chunks", () => {
    expect(classifySafety("계좌로 입금해줘, 오늘 가능해?")).toMatchObject({ level: "BLOCKED" });
    expect(classifySafety("내일 몇 시에 만날 수 있어?")).toMatchObject({ level: "CAUTION" });
    expect(normalizeReplyMessages("x".repeat(250))).toHaveLength(3);

    const result = createAiReplyResult({
      replyMessages: ["첫 줄", "둘째 줄"],
      safetyLevel: "SAFE",
      requiresOwnerConfirmation: false,
      blockedReason: null,
      toneSyncScore: 50,
    });
    expect(replaceReplyMessages(result, "바꾼 응답").replyText).toBe("바꾼 응답");
  });
});
