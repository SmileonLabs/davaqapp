/** Version 1 pool is append/reorder frozen so assignments survive renames and reinstalls. */
export const DEFAULT_CARD_AVATARS = ["https://assets.tcgdex.net/en/base/base1/1/high.webp", "https://assets.tcgdex.net/en/base/base1/2/high.webp", "https://assets.tcgdex.net/en/base/base1/3/high.webp", "https://assets.tcgdex.net/en/base/base1/4/high.webp", "https://assets.tcgdex.net/en/base/base1/6/high.webp", "https://assets.tcgdex.net/en/base/base1/9/high.webp", "https://assets.tcgdex.net/en/base/base1/25/high.webp", "https://assets.tcgdex.net/en/base/base1/58/high.webp", "https://assets.tcgdex.net/en/base/base1/63/high.webp", "https://assets.tcgdex.net/en/base/base1/65/high.webp", "https://assets.tcgdex.net/en/base/base1/94/high.webp", "https://assets.tcgdex.net/en/base/base1/16/high.webp"] as const;
export function defaultCardAvatar(identity: string): string {
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  return DEFAULT_CARD_AVATARS[(hash >>> 0) % DEFAULT_CARD_AVATARS.length];
}
export function isDefaultCardAvatar(value: string): boolean {
  return (DEFAULT_CARD_AVATARS as readonly string[]).includes(value);
}
