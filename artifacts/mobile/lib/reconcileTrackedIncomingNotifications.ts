/** A foreground status read may finish after the user answers the call.
 * Only an authoritative terminal result can tear down native Telecom. An
 * active result belongs to the accepted call, not a stale ringing alert.
 */
interface TrackedIntent { callId: string }
interface Reconciliation<T extends TrackedIntent> {
  isCurrent: () => boolean;
  getTracked: () => Promise<Array<{ intent: T }>>;
  getStatus: (intent: T) => Promise<string>;
  end: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  clear: (id: string) => Promise<void>;
}
const terminal = new Set(["ended", "declined", "missed", "cancelled", "failed"]);
export async function reconcileTrackedIncomingNotifications<T extends TrackedIntent>(
  deps: Reconciliation<T>,
): Promise<void> {
  const tracked = await deps.getTracked();
  if (!deps.isCurrent()) return;
  await Promise.all(tracked.map(async ({ intent }) => {
    try {
      const status = await deps.getStatus(intent);
      if (!deps.isCurrent() || !terminal.has(status)) return;
      await deps.end(intent.callId);
      if (!deps.isCurrent()) return;
      await deps.dismiss(intent.callId);
      await deps.clear(intent.callId);
    } catch {
      // Failed or ambiguous status reads must not terminate a live call.
    }
  }));
}
