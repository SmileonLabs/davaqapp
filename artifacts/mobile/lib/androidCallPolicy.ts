/** Pure policy shared by foreground and headless Android call delivery. */
export function callActionDisposition(
  owner: string | null,
  actionOwner: string,
  expiresAt: number,
  now: number,
): "deliver" | "retain" | "discard" {
  if (!Number.isFinite(expiresAt) || expiresAt <= now || !actionOwner)
    return "discard";
  if (!owner) return "retain"; // Authentication restoration must not consume a cold-start tap.
  return owner === actionOwner ? "deliver" : "discard";
}
export function incomingCallExpiry(
  sentTime: number | undefined,
  now = Date.now(),
): number | null {
  if (!Number.isFinite(sentTime) || !sentTime || sentTime > now + 60_000)
    return null;
  const expiry = Math.min(sentTime + 45_000, now + 45_000);
  return expiry > now ? expiry : null;
}
