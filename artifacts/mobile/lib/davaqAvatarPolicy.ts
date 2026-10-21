import { isDefaultCardAvatar } from "./defaultCardAvatar";
/** Only DavaQ-owned object paths cross the avatar boundary. Legacy recipes and external account photos are rejected. */
export function davaqAvatarUri(value: string | null | undefined): string | null {
  return typeof value === "string" && (/^\/objects\/[^?#]+$/.test(value) || isDefaultCardAvatar(value)) ? value : null;
}
