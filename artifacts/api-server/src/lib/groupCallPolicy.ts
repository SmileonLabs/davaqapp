export const GROUP_CALL_LIMIT = 16;
export const GROUP_INVITE_MS = 45_000;
export const GROUP_HEARTBEAT_GRACE_MS = 120_000;
export function isGroupCallId(id: string): boolean {
  return /^da7a0001-/i.test(id);
}
export function canJoinGroupCall(status: string, member: boolean): boolean {
  return status === "active" && member;
}
