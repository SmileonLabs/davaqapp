import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  object: vi.fn(),
  download: vi.fn(),
  ai: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("./objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = mocks.object;
    downloadObject = mocks.download;
  },
}));
vi.mock("./aiClient", () => ({
  getOpenAI: () => ({ chat: { completions: { create: mocks.ai } } }),
}));
vi.mock("./realtime", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("./wishMatching", () => ({ findWishCandidates: vi.fn() }));
import { draftWish, imageDataForWish } from "./wishService";
import { createWishInput, updateWishInput, wishDraftInput } from "./wishInput";

const user = "28f02e30-f113-4620-9441-55a8b17f696c";
const path = "/objects/davaq/uploads/owned-image";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WoAAAAASUVORK5CYII=",
  "base64",
);
const draft = {
  title: "WH-1000XM5 헤드폰",
  description: "확인할 상품 초안",
  keywords: ["헤드폰", "WH-1000XM5"],
  kind: "goods",
  category: "goods",
  questions: [],
};
const completion = (content: string | null) => ({
  choices: [{ message: { content } }],
});
function response(
  bytes: Uint8Array,
  type = "image/png",
  headers: Record<string, string> = {},
) {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": type, ...headers },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [{ allowed: 1 }], rowCount: 1 });
  mocks.object.mockResolvedValue({
    backend: "s3",
    key: "davaq/uploads/owned-image",
  });
  mocks.download.mockImplementation(() => Promise.resolve(response(png)));
  mocks.ai.mockResolvedValue(completion(JSON.stringify(draft)));
});

describe("private wish image boundary", () => {
  it("rejects a photo not owned by the user before opening storage or contacting AI", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      draftWish(user, { text: "이 상품", imageKey: path }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("owner_id=$1 AND object_path=$2"),
      [user, path],
    );
    expect(mocks.object).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("checks ownership first and builds a data URL from the owned stored bytes", async () => {
    await expect(imageDataForWish(user, path)).resolves.toBe(
      "data:image/png;base64," + png.toString("base64"),
    );
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.object.mock.invocationCallOrder[0],
    );
    expect(mocks.object).toHaveBeenCalledWith(path);
    expect(mocks.download).toHaveBeenCalledWith(
      { backend: "s3", key: "davaq/uploads/owned-image" },
      0,
    );
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("rejects an oversized declared length and cancels the response without reading its bytes", async () => {
    const pull = vi.fn(),
      cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    mocks.download.mockResolvedValueOnce(
      new Response(stream, {
        headers: {
          "content-type": "image/png",
          "content-length": String(8 * 1024 * 1024 + 1),
        },
      }),
    );
    await expect(
      draftWish(user, { text: "사진", imageKey: path }),
    ).rejects.toMatchObject({ status: 400 });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it.each([undefined, "1"])(
    "enforces the streaming limit even with missing or understated length (%s)",
    async (length) => {
      let emitted = 0;
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (emitted < 4) {
              const chunk = new Uint8Array(2 * 1024 * 1024);
              if (emitted === 0) chunk.set(png);
              controller.enqueue(chunk);
            } else controller.enqueue(new Uint8Array([0]));
            emitted++;
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      mocks.download.mockResolvedValueOnce(
        new Response(stream, {
          headers: {
            "content-type": "image/png",
            ...(length ? { "content-length": length } : {}),
          },
        }),
      );
      await expect(
        draftWish(user, { text: "사진", imageKey: path }),
      ).rejects.toMatchObject({ status: 400 });
      expect(emitted).toBe(5);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(mocks.ai).not.toHaveBeenCalled();
    },
  );
  it.each(["image/svg+xml", "text/html", "application/octet-stream"])(
    "does not send an unsupported MIME type to AI (%s)",
    async (mime) => {
      mocks.download.mockResolvedValueOnce(response(png, mime));
      await expect(
        draftWish(user, { text: "사진", imageKey: path }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.ai).not.toHaveBeenCalled();
    },
  );
  it.each(["image/jpeg", "image/webp"])(
    "rejects a PNG body disguised as %s",
    async (mime) => {
      mocks.download.mockResolvedValueOnce(response(png, mime));
      await expect(
        draftWish(user, { text: "사진", imageKey: path }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.ai).not.toHaveBeenCalled();
    },
  );
  it("rejects truncated or absent image bodies before AI inference", async () => {
    mocks.download.mockResolvedValueOnce(response(png.subarray(0, 8)));
    await expect(
      draftWish(user, { text: "사진", imageKey: path }),
    ).rejects.toMatchObject({ status: 400 });
    mocks.download.mockResolvedValueOnce(
      new Response(null, { headers: { "content-type": "image/png" } }),
    );
    await expect(
      draftWish(user, { text: "사진", imageKey: path }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("propagates a interrupted image read and releases the stream lock without invoking AI", async () => {
    const fault = new Error("storage read interrupted");
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(fault);
        },
      },
      { highWaterMark: 0 },
    );
    mocks.download.mockResolvedValueOnce(
      new Response(stream, { headers: { "content-type": "image/png" } }),
    );
    await expect(
      draftWish(user, { text: "사진", imageKey: path }),
    ).rejects.toBe(fault);
    expect(stream.locked).toBe(false);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});

describe("wish input image references", () => {
  it.each([
    "https://shop.example/image.png",
    "http://127.0.0.1/private",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "/objects/../private",
    "/objects/%2e%2e/private",
  ])("accepts no external or traversal image reference (%s)", (imageKey) => {
    expect(wishDraftInput.safeParse({ text: "헤드폰", imageKey }).success).toBe(
      false,
    );
    expect(
      createWishInput.safeParse({
        title: draft.title,
        description: draft.description,
        keywords: draft.keywords,
        kind: draft.kind,
        category: draft.category,
        imageKey,
        requestKey: "wish-image-test",
      }).success,
    ).toBe(false);
    expect(updateWishInput.safeParse({ version: 1, imageKey }).success).toBe(
      false,
    );
  });
  it("accepts the internal owned-object reference for an image-only draft", () => {
    const { questions: _questions, ...fields } = draft;
    expect(
      createWishInput.safeParse({
        ...fields,
        imageKey: path,
        requestKey: "wish-image-test",
      }).success,
    ).toBe(true);
    expect(
      updateWishInput.safeParse({ version: 1, imageKey: path }).success,
    ).toBe(true);
    expect(wishDraftInput.parse({ imageKey: path })).toEqual({
      text: "",
      imageKey: path,
    });
  });
});

describe("AI draft output boundary", () => {
  it("passes only the verified image data to AI, disables provider storage, and returns an editable parsed draft", async () => {
    await expect(
      draftWish(user, { text: "상품을 확인해 주세요", imageKey: path }),
    ).resolves.toEqual(draft);
    expect(mocks.ai).toHaveBeenCalledTimes(1);
    const [request, options] = mocks.ai.mock.calls[0];
    expect(request.store).toBe(false);
    expect(options).toMatchObject({ timeout: 35000, maxRetries: 0 });
    expect(request.messages[1].content).toEqual([
      { type: "text", text: "상품을 확인해 주세요" },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64," + png.toString("base64"),
          detail: "high",
        },
      },
    ]);
    expect(JSON.stringify(request)).not.toContain(path);
    expect(
      mocks.query.mock.calls.every(([sql]) => String(sql).startsWith("SELECT")),
    ).toBe(true);
  });
  it("supports a text-only draft without accessing private image storage", async () => {
    await expect(
      draftWish(user, { text: "헤드폰을 찾고 싶어요" }),
    ).resolves.toEqual(draft);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.object).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.ai.mock.calls[0][0].messages[1].content).toBe(
      "헤드폰을 찾고 싶어요",
    );
  });
  it("rejects malformed model JSON instead of returning an unverified draft", async () => {
    mocks.ai.mockResolvedValueOnce(completion("```json\n{}\n```"));
    await expect(draftWish(user, { text: "헤드폰" })).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });
  it.each([
    { ...draft, kind: "money" },
    { ...draft, category: "unknown" },
    { ...draft, keywords: ["WH-1000XM5", 7] },
    { ...draft, orderUrl: "https://example.invalid/buy" },
    {},
  ])(
    "rejects AI output that violates the confirmed draft shape",
    async (invalid) => {
      mocks.ai.mockResolvedValueOnce(completion(JSON.stringify(invalid)));
      await expect(draftWish(user, { text: "헤드폰" })).rejects.toMatchObject({
        name: "ZodError",
      });
    },
  );
  it("does not fabricate a result when the model returns no content or fails", async () => {
    mocks.ai.mockResolvedValueOnce({ choices: [] });
    await expect(draftWish(user, { text: "헤드폰" })).rejects.toMatchObject({
      name: "ZodError",
    });
    const fault = new Error("AI request timed out");
    mocks.ai.mockRejectedValueOnce(fault);
    await expect(draftWish(user, { text: "헤드폰" })).rejects.toBe(fault);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
