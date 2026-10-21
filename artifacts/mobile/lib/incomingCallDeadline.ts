const RING_WINDOW_MS = 45_000;
/** Missing deadlines support old servers; malformed explicit deadlines fail closed. */
export function incomingCallDeadline(value: unknown, now = Date.now()): number {
  if (value === undefined || value === null || value === "")
    return now + RING_WINDOW_MS;
  const deadline = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(deadline) || deadline <= 0) return 0;
  return Math.min(deadline, now + RING_WINDOW_MS);
}
export function incomingCallRemaining(
  deadline: number,
  displayedAt: number,
  now = Date.now(),
): number {
  return Math.max(0, Math.min(deadline, displayedAt + RING_WINDOW_MS) - now);
}
