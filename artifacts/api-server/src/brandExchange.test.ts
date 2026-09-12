import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptCode,
  decryptCode,
  fingerprint,
  inside,
  answerMap,
} from "./lib/brandRules";
import { brandMp4Info } from "./lib/brandMp4";
describe("Brand reward and playback boundaries", () => {
  beforeEach(() => {
    process.env.BRAND_REWARD_ENCRYPTION_KEY = "c".repeat(64);
  });
  it("encrypts identical codes with unique IVs and authenticates ciphertext", () => {
    const a = encryptCode("private-code"),
      b = encryptCode("private-code");
    expect(a).not.toEqual(b);
    expect(decryptCode(a)).toBe("private-code");
    const parts = a.split(".");
    parts[1] = Buffer.alloc(16).toString("base64");
    expect(() => decryptCode(parts.join("."))).toThrow();
  });
  it("rejects missing dedicated reward keys", () => {
    delete process.env.BRAND_REWARD_ENCRYPTION_KEY;
    expect(() => encryptCode("never store plaintext")).toThrow();
  });
  it("deduplicates codes within normalized issuers", () => {
    expect(fingerprint("Brand", "1234")).toBe(fingerprint(" brand ", "1234"));
    expect(fingerprint("Other", "1234")).not.toBe(fingerprint("Brand", "1234"));
  });
  it("requires time and space to match together", () => {
    const d = { start: 10, end: 20, x: 0.1, y: 0.2, w: 0.2, h: 0.3 };
    expect(inside(d, 15, 0.2, 0.3)).toBe(true);
    expect(inside(d, 9, 0.2, 0.3)).toBe(false);
    expect(inside(d, 15, 0.9, 0.3)).toBe(false);
  });
  it("rejects answer regions outside the video or reversed times", () => {
    expect(
      answerMap.safeParse([
        { start: 20, end: 10, x: 0.9, y: 0.9, w: 0.2, h: 0.2 },
        { start: 0, end: 30, x: 0, y: 0, w: 0.2, h: 0.2 },
      ]).success,
    ).toBe(false);
  });
  it("rejects disguised HTML and truncated MP4 metadata", () => {
    expect(() =>
      brandMp4Info(Buffer.from("<html>not a video</html>")),
    ).toThrow();
    const b = Buffer.alloc(16);
    b.writeUInt32BE(1000, 0);
    b.write("ftyp", 4);
    expect(() => brandMp4Info(b)).toThrow();
  });
});
