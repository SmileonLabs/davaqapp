import { describe, expect, it } from "vitest";
import {
  hasMatchingMessagePayload,
  parseMessagePage,
  validateUserMessage,
} from "./chatMessagePolicy";

describe("chat message policy", () => {
  const jpegPreview = (bytes = 6000) => "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(bytes), Buffer.from([0xff, 0xd9])]).toString("base64");
  const photo = { type: "image", content: "/objects/uploads/test-image" };
  const video = { type: "file", content: JSON.stringify({ path: "/objects/uploads/test-video", name: "clip.mp4", size: 1024, mime: "video/mp4" }) };

  it("accepts client-sized photo and video previews with album and caption metadata", () => {
    expect(validateUserMessage({ ...photo, metadata: { imageThumbnail: jpegPreview(), albumId: "album-1", albumIndex: 0, albumTotal: 2, caption: "사진", imageWidth: 2048, imageHeight: 1536 } })).toMatchObject({ ok: true });
    expect(validateUserMessage({ ...video, metadata: { videoThumbnail: jpegPreview(), videoDurationSec: 3, caption: "영상" } })).toMatchObject({ ok: true });
  });

  it("keeps preview exceptions limited to bounded JPEGs on the matching media type", () => {
    for (const thumbnail of [jpegPreview(8000), "data:image/svg+xml;base64,PHN2Zy8+", "data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,!!!!"]) {
      expect(validateUserMessage({ ...photo, metadata: { imageThumbnail: thumbnail } })).toMatchObject({ ok: false });
    }
    expect(validateUserMessage({ content: "text", metadata: { imageThumbnail: jpegPreview() } })).toMatchObject({ ok: false });
    expect(validateUserMessage({ ...photo, metadata: { videoThumbnail: jpegPreview() } })).toMatchObject({ ok: false });
    expect(validateUserMessage({ ...photo, metadata: { imageThumbnail: jpegPreview(), caption: "x".repeat(1001) } })).toMatchObject({ ok: false });
    expect(validateUserMessage({ ...photo, metadata: { imageThumbnail: jpegPreview(), a: "x".repeat(1000), b: "x".repeat(1000), c: "x".repeat(1000), d: "x".repeat(1000), e: "x".repeat(1000) } })).toMatchObject({ ok: false });
  });
  it("accepts only bounded user-authored message shapes", () => {
    expect(validateUserMessage({ content: "  hello  ", clientMessageId: "m-1" })).toEqual({
      ok: true,
      value: {
        content: "hello",
        type: "text",
        replyToMessageId: null,
        metadata: null,
        clientMessageId: "m-1",
      },
    });
    expect(validateUserMessage({ content: "x", type: "system" })).toMatchObject({ ok: false });
    expect(validateUserMessage({ content: "/objects/../../secrets", type: "image" })).toMatchObject({ ok: false });
    expect(validateUserMessage({ content: "1f600_zz", type: "sticker" })).toMatchObject({ ok: false });
    expect(validateUserMessage({ content: "a".repeat(4_001) })).toMatchObject({ ok: false });
  });

  it("validates file claims and bounded metadata", () => {
    const file = JSON.stringify({
      path: "/objects/uploads/123e4567-e89b-12d3-a456-426614174000",
      name: "notes.pdf",
      size: 1024,
      mime: "application/pdf",
    });
    expect(validateUserMessage({ content: file, type: "file", metadata: { source: "share" } })).toMatchObject({ ok: true });
    expect(validateUserMessage({ content: JSON.stringify({ path: "/objects/x", name: "x", size: 26 * 1024 * 1024 }), type: "file" })).toMatchObject({ ok: false });
    expect(validateUserMessage({ content: "hello", metadata: { nested: { a: { b: { c: { d: true } } } } } })).toMatchObject({ ok: false });
  });

  it("uses a bounded positive roomSeq cursor", () => {
    expect(parseMessagePage({})).toEqual({
      ok: true,
      limit: 50,
      beforeSeq: null,
      afterSeq: null,
    });
    expect(parseMessagePage({ beforeSeq: "45", limit: "25" })).toEqual({
      ok: true,
      limit: 25,
      beforeSeq: 45,
      afterSeq: null,
    });
    expect(parseMessagePage({ afterSeq: "0", limit: "100" })).toEqual({
      ok: true,
      limit: 100,
      beforeSeq: null,
      afterSeq: 0,
    });
    expect(parseMessagePage({ beforeSeq: "0" })).toMatchObject({ ok: false });
    expect(parseMessagePage({ afterSeq: "-1" })).toMatchObject({ ok: false });
    expect(parseMessagePage({ beforeSeq: "45", afterSeq: "10" })).toMatchObject({ ok: false });
    expect(parseMessagePage({ limit: "101" })).toMatchObject({ ok: false });
  });

  it("does not let a reused client key represent a different payload", () => {
    const parsed = validateUserMessage({ content: "hello", metadata: { b: 2, a: 1 }, clientMessageId: "m-1" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(hasMatchingMessagePayload({
      content: "hello",
      type: "text",
      replyToMessageId: null,
      metadata: { a: 1, b: 2 },
    }, parsed.value)).toBe(true);
    expect(hasMatchingMessagePayload({
      content: "changed",
      type: "text",
      replyToMessageId: null,
      metadata: { a: 1, b: 2 },
    }, parsed.value)).toBe(false);
  });
});
