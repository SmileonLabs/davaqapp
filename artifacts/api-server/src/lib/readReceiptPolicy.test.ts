import { describe, expect, it } from "vitest";
import { countMessageReaders } from "./readReceiptPolicy";

describe("actual recipient read receipts", () => {
  const sender = { userId: "sender", lastReadSeq: 30, isReadReceiptParticipant: true };
  const recipient = { userId: "recipient", lastReadSeq: 4, isReadReceiptParticipant: true };
  it("does not count the sender or a recipient who has only read older messages", () => {
    expect(countMessageReaders({ roomSeq: 5, senderId: "sender" }, [sender, recipient])).toBe(0);
    expect(countMessageReaders({ roomSeq: 4, senderId: "sender" }, [sender, recipient])).toBe(1);
  });
  it("never treats an unsequenced message as already read", () => {
    expect(countMessageReaders({ roomSeq: 0, senderId: "sender" }, [recipient])).toBe(0);
  });
  it("excludes AI/system participants from group reader counts", () => {
    expect(countMessageReaders({ roomSeq: 4, senderId: "sender" }, [
      sender, recipient, { userId: "ai", lastReadSeq: 50, isReadReceiptParticipant: false },
    ])).toBe(1);
  });
});
