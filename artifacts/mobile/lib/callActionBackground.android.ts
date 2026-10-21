import { isGroupCallId } from "./groupCallActions";
import { AppRegistry } from "react-native";
import { telecom } from "./androidTelecom.android";
import { getApiBase } from "./apiBase";
import { getHeadlessPushAuth } from "./headlessPushAuth.android";
import { nativePushMatchesOwnerWithRenewal } from "./nativePushOwner";
import { deliverTerminalCallActions } from "./callActionDelivery";

let inFlight: Promise<void> | null = null;
export function flushBackgroundCallActions(): Promise<void> {
  if (inFlight) return inFlight;
  const run = async () => {
    const native = telecom;
    if (!native) return;
    const request = async (path: string, bearer: string, init: RequestInit = {}) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6_000);
      try {
        return await fetch(`${getApiBase()}/api${path}`, {
          ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }
    };
    await deliverTerminalCallActions({
      pending: async () => JSON.parse(await native.pendingActions()),
      authenticate: getHeadlessPushAuth,
      ownerMatches: (id) => nativePushMatchesOwnerWithRenewal(id,
        async (owner) => Boolean(await getHeadlessPushAuth(owner))),
      getCall: async (id, auth) => {
        const response = await request(`/${isGroupCallId(id) ? "group-calls" : "calls"}/${encodeURIComponent(id)}`, auth.bearer);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("call_status_unavailable");
        const value = await response.json();
        if (isGroupCallId(id)) return { ...value, callerId: value.creatorId, calleeId: value.creatorId, participants: value.participants };
        return value;
      },
      control: async (action, call, auth) => {
        if (!auth.isCurrent()) return false;
        const response = await request(`/${isGroupCallId(action.callId) ? "group-calls" : "calls"}/${encodeURIComponent(action.callId)}/${isGroupCallId(action.callId) ? (action.action === "decline" ? "decline" : "leave") : action.action}`, auth.bearer, {
          method: "POST",
          headers: { "x-idempotency-key": action.id, ...(call.attemptId ? { "x-call-attempt-id": call.attemptId } : {}) },
        });
        return response.ok;
      },
      acknowledge: (id) => native.acknowledge(id),
    });
  };
  inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}
AppRegistry.registerHeadlessTask("DavaqCallActions", () => async () => {
  // Actions remain in native storage when the network/session is unavailable.
  await flushBackgroundCallActions().catch(() => {
    console.warn("[calls] Background action retained for retry");
  });
});
