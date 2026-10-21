export interface ReadableMessage { id: string; roomSeq: number }

/** A receipt requires a focused foreground conversation and an actually visible row. */
export function visibleReadTarget<T extends ReadableMessage>(
  messages: readonly T[], visibleIds: ReadonlySet<string>,
  gate: { active: boolean; focused: boolean; ready: boolean },
): T | null {
  if (!gate.active || !gate.focused || !gate.ready) return null;
  let target: T | null = null;
  for (const message of messages) {
    if (!visibleIds.has(message.id) || message.id.startsWith("temp-") || message.roomSeq <= 0) continue;
    if (!target || message.roomSeq > target.roomSeq) target = message;
  }
  return target;
}
