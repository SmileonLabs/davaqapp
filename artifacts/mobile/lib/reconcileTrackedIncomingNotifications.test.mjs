import { describe, expect, it, vi } from 'vitest';
import { reconcileTrackedIncomingNotifications } from './reconcileTrackedIncomingNotifications';
function harness(getStatus) {
  return {
    isCurrent: () => true,
    getTracked: async () => [{ intent: { callId: 'test-incoming' } }],
    getStatus,
    end: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
}
describe('foreground notification reconciliation during Answer', () => {
  it('preserves an accepted call when a ringing lookup completes after Answer', async () => {
    let resolve;
    const read = new Promise(done => { resolve = done; });
    const deps = harness(() => read);
    const pending = reconcileTrackedIncomingNotifications(deps);
    await Promise.resolve();
    resolve('active');
    await pending;
    expect(deps.end).not.toHaveBeenCalled();
    expect(deps.dismiss).not.toHaveBeenCalled();
    expect(deps.clear).not.toHaveBeenCalled();
  });
  it.each(['ended', 'declined', 'missed', 'cancelled', 'failed'])('cleans an authoritative %s result', async status => {
    const deps = harness(async () => status);
    await reconcileTrackedIncomingNotifications(deps);
    expect(deps.end).toHaveBeenCalledWith('test-incoming');
    expect(deps.dismiss).toHaveBeenCalledWith('test-incoming');
    expect(deps.clear).toHaveBeenCalledWith('test-incoming');
  });
  it.each(['ringing', 'unknown'])('preserves a nonterminal %s result', async status => {
    const deps = harness(async () => status);
    await reconcileTrackedIncomingNotifications(deps);
    expect(deps.end).not.toHaveBeenCalled();
  });
  it('preserves a call on failed status read', async () => {
    const deps = harness(async () => { throw new Error('network unavailable'); });
    await reconcileTrackedIncomingNotifications(deps);
    expect(deps.end).not.toHaveBeenCalled();
  });
  it('discards a delayed result after its authenticated owner unmounts', async () => {
    let resolve;
    const read = new Promise(done => { resolve = done; });
    let current = true;
    const deps = { ...harness(() => read), isCurrent: () => current };
    const pending = reconcileTrackedIncomingNotifications(deps);
    await Promise.resolve();
    current = false;
    resolve('ended');
    await pending;
    expect(deps.end).not.toHaveBeenCalled();
  });
});
