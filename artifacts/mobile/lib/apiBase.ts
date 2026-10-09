import { Platform } from "react-native";

/**
 * Resolve the API host. On native we talk to the remote API server via an
 * absolute URL (mirrors setBaseUrl in _layout.tsx); on web requests are
 * same-origin so a relative path is enough.
 */
export function getApiBase(): string {
  // The PWA is served behind the same Caddy origin that proxies /api. Keeping
  // browser requests same-origin removes a second DNS/TLS/CORS failure surface.
  // Native exposes window too; it must still use the explicit remote API host.
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : "";
}

/**
 * Build a displayable URL for an image message. Image messages store the
 * canonical object path (`/objects/<id>`) in `content`; the server serves it
 * under `/api/storage/objects/<id>`.
 */
export function mediaUri(content: string): string {
  if (!content) return content;
  if (/^https?:\/\//.test(content) || content.startsWith("blob:") || content.startsWith("data:")) {
    return content;
  }
  const path = content.startsWith("/objects/") ? `/api/storage${content}` : content;
  return `${getApiBase()}${path}`;
}
