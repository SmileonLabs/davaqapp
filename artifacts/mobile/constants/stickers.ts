import { ANIMATED_STICKERS } from "./animatedStickers";
// Animated stickers powered by Google's Noto Animated Emoji set (CC BY 4.0),
// bundled as optimized animated WebP; legacy codes can use the public CDN. A sticker message stores
// the Noto codepoint (e.g. "1f600" or "2764_fe0f") as `content` with type
// "sticker" — no DB migration needed (mirrors the image-message pattern).

export const STICKER_CODES: readonly string[] = ANIMATED_STICKERS.map(
  (item) => item.code,
);

const STICKER_SET = new Set(STICKER_CODES);

/** Whether a string is one of our known Noto sticker codepoints. */
export function isStickerCode(code: string): boolean {
  return STICKER_SET.has(code);
}

/** Animated WebP URL for a given Noto codepoint. */
export function stickerUri(code: string): string {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.webp`;
}

/** Server-side shape guard: lowercase hex groups joined by "_". */
export const STICKER_CODE_PATTERN = /^[0-9a-f]+(_[0-9a-f]+)*$/;
