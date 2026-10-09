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
function required(): Telecom {
  if (!telecom) throw new Error("새 Android 앱으로 업데이트해 주세요.");
  return telecom;
}
export async function registerSystemCall(
  call: Call,
  name: string,
): Promise<void> {
  const ownerId = await getCurrentNativePushOwner();
  if (!ownerId) throw new Error("로그인 상태를 확인한 후 다시 통화해 주세요.");
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
}
export async function activateSystemCall(
  call: Call,
  name: string,
): Promise<void> {
  await registerSystemCall(call, name);
  await required().activate(call.id);
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
