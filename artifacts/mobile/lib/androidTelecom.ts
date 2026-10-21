import type { Call } from "@workspace/api-client-react";
export type SystemCallEvent = { kind: string; callId: string; value: string };
export type AudioEndpoint = { id: string; name: string; type: number };
export type SystemCallSnapshot = {
  callId?: string;
  currentEndpoint?: string;
  endpoints?: AudioEndpoint[];
};
export type FullScreenCallAccess = { supported: boolean; granted: boolean };
export async function getFullScreenCallAccess(): Promise<FullScreenCallAccess> {
  return { supported: false, granted: false };
}
export async function openFullScreenCallSettings(): Promise<boolean> {
  return false;
}
export const systemCallingSupported = false;
export async function registerSystemCall(
  _call: Call,
  _name: string,
): Promise<void> {}
export async function activateSystemCall(
  _call: Call,
  _name: string,
): Promise<void> {}
export async function endSystemCall(_id: string): Promise<void> {}
export async function systemCallSnapshot(): Promise<SystemCallSnapshot> {
  return {};
}
export async function selectSystemAudioEndpoint(
  _id: string,
  _endpoint: string,
): Promise<void> {}
export function subscribeSystemCall(
  _handler: (event: SystemCallEvent) => void,
): () => void {
  return () => {};
}
