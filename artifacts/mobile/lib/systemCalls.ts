import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { IncomingCallIntent } from "./callNotifications";

export type SystemCallAction = {
  action: "accept" | "decline" | "end" | "mute" | "audioActivated";
  intent: IncomingCallIntent;
  muted?: boolean;
};
type SystemCallModule = {
  getPushInfo: () => Promise<{ voipToken: string | null; environment: "sandbox" | "production" }>;
  clearPushOwner: (owner: string) => Promise<void>;
  setPushOwner: (owner: string | null) => Promise<void>;
  reportIncoming: (intent: IncomingCallIntent) => Promise<boolean>;
  markActive: (id: string) => Promise<void>;
  end: (id: string) => Promise<void>;
  endAll: () => Promise<void>;
  drainEvents: () => Promise<SystemCallAction[]>;
  addListener: (name: string) => void;
  removeListeners: (count: number) => void;
};
const native =
  Platform.OS === "ios"
    ? (NativeModules.DavaQSystemCalls as SystemCallModule | undefined)
    : undefined;
export const systemCallsSupported = Boolean(native);
export async function reportSystemIncomingCall(
  intent: IncomingCallIntent,
): Promise<boolean> {
  if (!native) return false;
  try {
    await native.reportIncoming(intent);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    // A suppressed stale call must not fall back to a fresh ringing notification.
    return ["expired_call", "ended_call", "cancelled_call"].includes(reason);
  }
}
export async function markSystemCallActive(id: string): Promise<void> {
  await native?.markActive(id);
}
export async function endSystemCall(id?: string): Promise<void> {
  if (!native) return;
  if (id) await native.end(id);
  else await native.endAll();
}
const handlers = new Set<(event: SystemCallAction) => void>();
let subscription: { remove: () => void } | null = null;
let listenerGeneration = 0;
function dispatch(event: SystemCallAction): void {
  handlers.forEach((handler) => handler(event));
}
export function subscribeSystemCallActions(
  handler: (event: SystemCallAction) => void,
): () => void {
  if (!native) return () => {};
  handlers.add(handler);
  if (!subscription) {
    const generation = ++listenerGeneration;
    subscription = new NativeEventEmitter(native).addListener(
      "DavaQSystemCallAction",
      dispatch,
    );
    void native
      .drainEvents()
      .then((events) => {
        if (generation === listenerGeneration) events.forEach(dispatch);
      })
      .catch(() => {});
  }
  return () => {
    handlers.delete(handler);
    if (!handlers.size) {
      ++listenerGeneration;
      subscription?.remove();
      subscription = null;
    }
  };
}

export async function getApplePushInfo() { return native?.getPushInfo() ?? null; }
export async function setApplePushOwner(owner: string | null): Promise<void> { await native?.setPushOwner(owner); }
export function subscribeApplePushToken(handler: () => void): () => void {
  if (!native) return () => {};
  const listener = new NativeEventEmitter(native).addListener("DavaQPushToken", handler);
  return () => listener.remove();
}

export async function clearApplePushOwner(owner: string): Promise<void> { await native?.clearPushOwner(owner); }
