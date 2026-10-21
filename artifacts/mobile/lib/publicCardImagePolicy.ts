const CATALOG_ORIGIN = "https://tcgindex.org";
const IMAGE_PROXY_PATH = "/api/mobile/v1/cards/image";
export const CARD_IMAGE_ATTEMPT_TIMEOUT_MS = 5_000;

export type CardImageSources = {
  kind: "private" | "public" | "local" | "missing";
  primary?: string;
  fallback?: string;
};

function publicUrl(value: string): URL | undefined {
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))
    return;
  try {
    const url = new URL(value, CATALOG_ORIGIN);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443")
    )
      return;
    // Account media always uses its authenticated DavaQ media resolver.
    if (
      url.pathname.startsWith("/objects/") ||
      url.pathname.startsWith("/api/mobile/v1/images/") ||
      url.pathname.startsWith("/api/storage/")
    )
      return;
    return url;
  } catch {
    return;
  }
}

function proxySupports(url: URL) {
  if (url.origin === CATALOG_ORIGIN)
    return (
      !url.search &&
      /^\/(?:api\/catalog\/images\/[a-f0-9]{64}|market\/images\/kream\/[a-f0-9]{64}|cardmarket\/(?:images\/[a-z_]+\/\d+|review-images\/[a-f0-9]{64}))$/.test(
        url.pathname,
      )
    );
  // Match the upstream converter's supported public providers. Other HTTPS
  // catalog images can load directly without a guaranteed-to-fail proxy hop.
  return (
    [
      "assets.tcgdex.net",
      "images.ygoprodeck.com",
      "cards.scryfall.io",
      "cmsassets.rgpub.io",
    ].includes(url.hostname) ||
    (url.hostname === "tcgplayer-cdn.tcgplayer.com" &&
      /^\/product\/[1-9]\d{0,9}_in_1000x1000\.jpg$/.test(url.pathname))
  );
}

/** Stable public originals are already cached by their providers. Do not put
 * every first image behind the converter's cold, four-worker thumbnail queue. */
export function publicCardImageSources(
  source: string | null | undefined,
): CardImageSources {
  if (!source) return { kind: "missing" };
  if (source.startsWith("/objects/"))
    return { kind: "private", primary: source };
  if (
    /^(?:blob:|file:\/\/|content:\/\/|data:image\/(?:jpeg|png|webp|gif|heic|heif);)/i.test(
      source,
    )
  )
    return { kind: "local", primary: source };
  const url = publicUrl(source);
  if (!url) return { kind: "missing" };
  if (url.origin === CATALOG_ORIGIN && url.pathname === IMAGE_PROXY_PATH) {
    // Existing metadata may already contain a converter URL. Unwrap only one
    // valid public source; never recursively wrap or expose private media.
    const original = publicUrl(url.searchParams.get("src") ?? "");
    if (
      url.searchParams.getAll("src").length !== 1 ||
      !original ||
      original.pathname === IMAGE_PROXY_PATH
    )
      return { kind: "missing" };
    return { kind: "public", primary: original.href, fallback: url.href };
  }
  return {
    kind: "public",
    primary: url.href,
    ...(proxySupports(url)
      ? {
          fallback: `${CATALOG_ORIGIN}${IMAGE_PROXY_PATH}?v=2&src=${encodeURIComponent(url.href)}`,
        }
      : {}),
  };
}

/** One exact cache identity for the home, feed, renderer and background warmup. */
export const publicCardImageUri = (source: string | null | undefined) =>
  publicCardImageSources(source).primary;

export function selectPublicCardImageUris(
  sources: readonly (string | null | undefined)[],
  limit = 4,
) {
  return [
    ...new Set(
      sources.flatMap((source) => {
        const image = publicCardImageSources(source);
        return image.kind === "public" && image.primary ? [image.primary] : [];
      }),
    ),
  ].slice(0, Math.min(4, Math.max(0, Math.floor(limit) || 0)));
}
