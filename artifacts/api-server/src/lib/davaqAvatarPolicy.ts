import { defaultCardAvatar } from "./defaultCardAvatar";
/** A photo is public only after a DavaQ-owned upload was explicitly selected. */
export function publicDavaqAvatar(
  url: string | null | undefined,
  metadata?: Record<string, unknown> | null,
  identity?: string,
): string | null {
  return metadata?.avatarSource === "davaq" &&
    typeof url === "string" &&
    /^\/objects\/[^?#]+$/.test(url)
    ? url
    : identity ? defaultCardAvatar(identity) : null;
}
