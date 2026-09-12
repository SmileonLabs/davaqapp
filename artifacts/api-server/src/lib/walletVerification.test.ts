import { describe, expect, it } from "vitest";
import { buildChallengeMessage } from "./walletChallenge";

describe("wallet verification challenge", () => {
  it("binds the signature request to domain, chain, nonce, expiry and request id", async () => {
    const message = buildChallengeMessage({
      walletAddress: "0x1111111111111111111111111111111111111111",
      requestId: "4d63e4d6-76ae-4d62-a075-5811f24df52d",
      nonce: "0123456789abcdef",
      domain: "davaq.anothermeai.app",
      uri: "https://davaq.anothermeai.app",
      chainId: 56,
      issuedAt: new Date("2026-07-18T00:00:00.000Z"),
      expiresAt: new Date("2026-07-18T00:10:00.000Z"),
    });

    expect(message).toContain("davaq.anothermeai.app wants you to sign in");
    expect(message).toContain("Chain ID: 56");
    expect(message).toContain("Nonce: 0123456789abcdef");
    expect(message).toContain("Expiration Time: 2026-07-18T00:10:00.000Z");
    expect(message).toContain("Request ID: 4d63e4d6-76ae-4d62-a075-5811f24df52d");
    expect(message).toContain("does not grant token transfer permission");
  });
});
