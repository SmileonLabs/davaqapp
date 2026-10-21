import { callActionDisposition } from "./androidCallPolicy";

import { NativeModules, NativeEventEmitter } from "react-native";
import type { Call } from "@workspace/api-client-react";
import { getCurrentNativePushOwner } from "./nativePushOwner";
export type SystemCallEvent = { kind: string; callId: string; value: string };
export type AudioEndpoint = { id: string; name: string; type: number };
export type SystemCallSnapshot = {
  callId?: string;
  currentEndpoint?: string;
  endpoints?: AudioEndpoint[];
};
export type FullScreenCallAccess = { supported: boolean; granted: boolean };
export type NativeCallAction = {
  id: string;
  action: "accept" | "decline" | "end";
  callId: string;
  callerName: string;
  media: "audio" | "video";
  chatRoomId?: string;
  ownerId: string;
  expiresAt: number;
};
type Telecom = {
  fullScreenIntentAccess?: () => Promise<FullScreenCallAccess>;
  openFullScreenIntentSettings?: () => Promise<boolean>;
  mediaStarted: (callId: string, media: string) => Promise<void>;
  startCall: (descriptor: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  end: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  snapshot: () => Promise<string>;
  selectEndpoint: (id: string, endpoint: string) => Promise<void>;
  pendingActions: () => Promise<string>;
  acknowledge: (id: string) => Promise<void>;
  addListener: (name: string) => void;
  removeListeners: (count: number) => void;
};
export const telecom = NativeModules.DavaqTelecom as Telecom | undefined;
export const systemCallingSupported = Boolean(telecom);
/** Query only: never opens special-access settings or requests a permission. */
export async function getFullScreenCallAccess(): Promise<FullScreenCallAccess> {
  if (typeof telecom?.fullScreenIntentAccess !== "function") {
    return { supported: false, granted: false };
  }
  const access = await telecom.fullScreenIntentAccess();
  return { supported: access?.supported === true, granted: access?.granted === true };
}
/** Call only from an explicit user tap; older native builds safely return false. */
export async function openFullScreenCallSettings(): Promise<boolean> {
  if (typeof telecom?.openFullScreenIntentSettings !== "function") return false;
  return (await telecom.openFullScreenIntentSettings()) === true;
}
function required(): Telecom {
  if (!telecom) throw new Error("android_telecom_unavailable");
  return telecom;
}
export async function registerSystemCall(
  call: Call,
  name: string,
): Promise<void> {
  console.info("[call-system] owner_read_start");
  const ownerId = await getCurrentNativePushOwner();
  console.info("[call-system] owner_read_done", Boolean(ownerId));
  if (!ownerId) throw new Error("call_owner_unavailable");
  console.info("[call-system] register_start");
  await required().startCall(
    JSON.stringify({
      callId: call.id,
      callerName: name || "DavaQ",
      media: call.media ?? "audio",
      ownerId,
      chatRoomId: call.chatRoomId ?? "",
      direction: ownerId === call.callerId ? "outgoing" : "incoming",
      expiresAt:
        call.status === "ringing"
          ? new Date(call.createdAt).getTime() + 45_000
          : Date.now() + 45_000,
    }),
  );
  console.info("[call-system] register_done");
}
export async function activateSystemCall(
  call: Call,
  name: string,
): Promise<void> {
  await registerSystemCall(call, name);
  console.info("[call-system] activate_start");
  await required().activate(call.id);
  console.info("[call-system] activate_done");
}
export async function endSystemCall(id: string): Promise<void> {
  await telecom?.end(id);
}
export async function systemCallSnapshot(): Promise<SystemCallSnapshot> {
  return JSON.parse((await telecom?.snapshot()) ?? "{}");
}
export async function selectSystemAudioEndpoint(
  id: string,
  endpoint: string,
): Promise<void> {
  await required().selectEndpoint(id, endpoint);
}
export function subscribeSystemCall(
  handler: (event: SystemCallEvent) => void,
): () => void {
  if (!telecom) return () => {};
  const sub = new NativeEventEmitter(telecom).addListener(
    "DavaqTelecom",
    handler,
  );
  return () => sub.remove();
}
export async function pendingSystemActions(): Promise<NativeCallAction[]> {
  const owner = await getCurrentNativePushOwner();
  const actions: NativeCallAction[] = JSON.parse(
    (await telecom?.pendingActions()) ?? "[]",
  );
  const valid: NativeCallAction[] = [];
  for (const action of actions) {
    const disposition = callActionDisposition(
      owner,
      action.ownerId,
      action.expiresAt,
      Date.now(),
    );
    if (disposition === "deliver") valid.push(action);
    else if (disposition === "discard") await telecom?.acknowledge(action.id);
  }
  return valid;
}
