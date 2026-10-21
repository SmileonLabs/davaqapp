import type { IncomingCallIntent } from "./callNotifications";
export type SystemCallAction = {
  action: "accept" | "decline" | "end" | "mute" | "audioActivated";
  intent: IncomingCallIntent;
  muted?: boolean;
};
export const systemCallsSupported = false;
export async function reportSystemIncomingCall(
  _intent: IncomingCallIntent,
): Promise<boolean> {
  return false;
}
export async function endSystemCall(_id?: string): Promise<void> {}
export function subscribeSystemCallActions(
  _handler: (event: SystemCallAction) => void,
): () => void {
  return () => {};
}

export async function markSystemCallActive(_id: string): Promise<void> {}

export async function getApplePushInfo() { return null; }
export async function setApplePushOwner(_owner: string | null): Promise<void> {}
export function subscribeApplePushToken(_handler: () => void): () => void { return () => {}; }

export async function clearApplePushOwner(_owner: string): Promise<void> {}
