export type DurableCallAction = {
  id: string;
  action: "accept" | "decline" | "end";
  ownerId: string;
  callId: string;
  expiresAt: number;
};
type ServerCall = { status: string; callerId: string; calleeId: string; attemptId?: string | null; participants?: { userId: string; state: string }[] };
type Auth = { bearer: string; isCurrent: () => boolean };
type Dependencies = {
  pending: () => Promise<DurableCallAction[]>;
  authenticate: (ownerId: string) => Promise<Auth | null>;
  ownerMatches: (ownerId: string) => Promise<boolean>;
  getCall: (id: string, auth: Auth) => Promise<ServerCall | null>;
  control: (action: DurableCallAction, call: ServerCall, auth: Auth) => Promise<boolean>;
  acknowledge: (id: string) => Promise<void>;
  now?: () => number;
};
/** Accept belongs to the visible media flow; only terminal actions run headless.
 * Never acknowledge network/auth failures, or carry an old account's action
 * across a session change. Server operation IDs survive retries unchanged. */
export async function deliverTerminalCallActions(deps: Dependencies): Promise<void> {
  const now = deps.now ?? Date.now;
  for (const action of await deps.pending()) {
    if (action.action === "accept") continue;
    if (action.expiresAt <= now()) { await deps.acknowledge(action.id); continue; }
    const auth = await deps.authenticate(action.ownerId);
    if (!auth || !auth.isCurrent() || !(await deps.ownerMatches(action.ownerId))) continue;
    const call = await deps.getCall(action.callId, auth);
    const ownGroupParticipant = call?.participants?.find(p => p.userId === action.ownerId);
    if (!auth.isCurrent() || !(await deps.ownerMatches(action.ownerId)) || action.expiresAt <= now()) continue;
    if (!call || (!ownGroupParticipant && call.callerId !== action.ownerId && call.calleeId !== action.ownerId)) {
      await deps.acknowledge(action.id);
      continue;
    }
    const terminal = ["ended", "declined", "missed", "cancelled", "failed"].includes(call.status);
    // A late reject from another device must never hang up an answered call.
    if (terminal || (action.action === "decline" && (ownGroupParticipant ? ownGroupParticipant.state !== "invited" : call.status !== "ringing"))) {
      await deps.acknowledge(action.id);
      continue;
    }
    if (await deps.control(action, call, auth)) await deps.acknowledge(action.id);
  }
}
