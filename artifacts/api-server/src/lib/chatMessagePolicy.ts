export const MAX_MESSAGE_PAGE_SIZE = 100;
export const DEFAULT_MESSAGE_PAGE_SIZE = 50;
export const MAX_TEXT_MESSAGE_LENGTH = 4_000;
export const MAX_MESSAGE_CONTENT_LENGTH = 4_096;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const USER_MESSAGE_TYPES = new Set(["text", "image", "file", "sticker"]);
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_MIME_PATTERN = /^[^\s/;]+\/[^\s;]+(?:;[^\r\n]{1,64})?$/;

export type UserMessageType = "text" | "image" | "file" | "sticker";

export interface ValidatedUserMessage {
  content: string;
  type: UserMessageType;
  replyToMessageId: string | null;
  metadata: Record<string, unknown> | null;
  clientMessageId: string | null;
}

export type MessageValidationResult =
  | { ok: true; value: ValidatedUserMessage }
  | { ok: false; error: string };

export type MessagePageResult =
  | {
      ok: true;
      limit: number;
      beforeSeq: number | null;
      afterSeq: number | null;
    }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isInternalObjectPath(value: string): boolean {
  if (!value.startsWith("/objects/") || value.length > 1_024) return false;
  const parts = value.slice("/objects/".length).split("/");
  return parts.length > 0 && parts.every((part) =>
    part !== "." && part !== ".." && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part),
  );
}

export function isValidStickerCode(value: string): boolean {
  const parts = value.split("_");
  return (
    parts.length > 0 &&
    parts.length <= 8 &&
    parts.every((part) => {
      if (!/^[0-9a-f]{1,6}$/.test(part)) return false;
      const codePoint = Number.parseInt(part, 16);
      return codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
    })
  );
}

function isSafeMetadataValue(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 1_000;
  if (depth >= 4) return false;
  if (Array.isArray(value)) return value.length <= 20 && value.every((item) => isSafeMetadataValue(item, depth + 1));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 20 &&
    entries.every(([key, item]) =>
      key.length > 0 &&
      key.length <= 64 &&
      key !== "__proto__" &&
      key !== "constructor" &&
      key !== "prototype" &&
      isSafeMetadataValue(item, depth + 1),
    )
  );
}

const MAX_PREVIEW_LENGTH = 10_000;

function isJpegPreview(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_PREVIEW_LENGTH) return false;
  const prefix = "data:image/jpeg;base64,";
  if (!value.startsWith(prefix)) return false;
  const encoded = value.slice(prefix.length);
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length >= 5 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

function isValidMetadata(value: unknown, type: string): value is Record<string, unknown> | null {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  // Client previews are bounded JPEG data URLs, larger than ordinary metadata.
  // Keep the existing limits for every other field and message type.
  const previewKey = type === "image" ? "imageThumbnail" : type === "file" ? "videoThumbnail" : undefined;
  const ordinary = { ...value };
  if (previewKey && Object.hasOwn(value, previewKey)) {
    if (!isJpegPreview(value[previewKey])) return false;
    delete ordinary[previewKey];
  }
  if (Object.keys(value).length > 20 || !isSafeMetadataValue(ordinary)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(ordinary), "utf8") <= 4_096 &&
      Buffer.byteLength(JSON.stringify(value), "utf8") <= 16_384;
  } catch {
    return false;
  }
}

function isValidFileContent(content: string): boolean {
  try {
    const file = JSON.parse(content) as unknown;
    if (!isRecord(file)) return false;
    const keys = Object.keys(file);
    if (!keys.every((key) => ["path", "name", "size", "mime"].includes(key))) return false;
    return (
      typeof file.path === "string" &&
      isInternalObjectPath(file.path) &&
      typeof file.name === "string" &&
      file.name.length > 0 &&
      file.name.length <= 255 &&
      !/[\u0000-\u001f\u007f]/.test(file.name) &&
      typeof file.size === "number" &&
      Number.isSafeInteger(file.size) &&
      file.size >= 0 &&
      file.size <= MAX_FILE_BYTES &&
      (file.mime === undefined || (typeof file.mime === "string" && file.mime.length <= 128 && FILE_MIME_PATTERN.test(file.mime)))
    );
  } catch {
    return false;
  }
}

export function validateClientMessageId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && CLIENT_MESSAGE_ID_PATTERN.test(value) ? value : undefined;
}

export function validateUserMessage(input: unknown): MessageValidationResult {
  if (!isRecord(input)) return { ok: false, error: "invalid message" };
  if (!Object.keys(input).every((key) => ["content", "type", "replyToMessageId", "metadata", "clientMessageId"].includes(key))) {
    return { ok: false, error: "invalid message" };
  }

  const type = input.type === undefined ? "text" : input.type;
  if (typeof type !== "string" || !USER_MESSAGE_TYPES.has(type)) return { ok: false, error: "unsupported message type" };
  if (typeof input.content !== "string" || input.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    return { ok: false, error: "invalid message content" };
  }

  const content = type === "text" ? input.content.trim() : input.content;
  if ((type === "text" && (!content || content.length > MAX_TEXT_MESSAGE_LENGTH)) ||
      (type === "image" && !isInternalObjectPath(content)) ||
      (type === "sticker" && !isValidStickerCode(content)) ||
      (type === "file" && !isValidFileContent(content))) {
    return { ok: false, error: "invalid message content" };
  }

  const replyToMessageId = input.replyToMessageId ?? null;
  if (replyToMessageId !== null && (typeof replyToMessageId !== "string" || !UUID_PATTERN.test(replyToMessageId))) {
    return { ok: false, error: "invalid replyToMessageId" };
  }
  if (!isValidMetadata(input.metadata, type)) return { ok: false, error: "invalid metadata" };

  const clientMessageId = validateClientMessageId(input.clientMessageId);
  if (clientMessageId === undefined) return { ok: false, error: "invalid clientMessageId" };

  return {
    ok: true,
    value: {
      content,
      type: type as UserMessageType,
      replyToMessageId,
      metadata: input.metadata ?? null,
      clientMessageId,
    },
  };
}

function singleQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parsePositiveInteger(value: string | undefined, max: number): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined, max: number): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : undefined;
}

export function parseMessagePage(query: Record<string, unknown>): MessagePageResult {
  const rawLimit = singleQueryValue(query.limit);
  const rawBeforeSeq = singleQueryValue(query.beforeSeq);
  const rawAfterSeq = singleQueryValue(query.afterSeq);
  const limit = rawLimit === undefined ? DEFAULT_MESSAGE_PAGE_SIZE : parsePositiveInteger(rawLimit, MAX_MESSAGE_PAGE_SIZE);
  if (!limit) return { ok: false, error: `limit must be between 1 and ${MAX_MESSAGE_PAGE_SIZE}` };
  if (rawBeforeSeq !== undefined && rawAfterSeq !== undefined) {
    return { ok: false, error: "beforeSeq and afterSeq are mutually exclusive" };
  }
  if (rawBeforeSeq !== undefined) {
    const beforeSeq = parsePositiveInteger(rawBeforeSeq, Number.MAX_SAFE_INTEGER);
    if (!beforeSeq) return { ok: false, error: "beforeSeq must be a positive integer" };
    return { ok: true, limit, beforeSeq, afterSeq: null };
  }
  if (rawAfterSeq !== undefined) {
    const afterSeq = parseNonNegativeInteger(rawAfterSeq, Number.MAX_SAFE_INTEGER);
    if (afterSeq === undefined) return { ok: false, error: "afterSeq must be a non-negative integer" };
    return { ok: true, limit, beforeSeq: null, afterSeq };
  }
  return { ok: true, limit, beforeSeq: null, afterSeq: null };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function hasMatchingMessagePayload(
  message: { content: string; type: string; replyToMessageId: string | null; metadata: Record<string, unknown> | null },
  input: ValidatedUserMessage,
): boolean {
  return (
    message.content === input.content &&
    message.type === input.type &&
    message.replyToMessageId === input.replyToMessageId &&
    canonicalize(message.metadata ?? null) === canonicalize(input.metadata)
  );
}
