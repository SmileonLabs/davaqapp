import type { Call } from '@workspace/api-client-react';
import { isTerminalCallStatus } from './callLifecycle';
const statuses = new Set(['ringing', 'active', 'ended', 'declined', 'missed', 'cancelled', 'failed']);
/** Apply an authenticated server event without reviving an ended generation. */
export function projectRealtimeCall(current: Call | undefined, callId: string, payload: unknown): Call | undefined {
  if (!payload || typeof payload !== 'object') return current;
  const next = payload as Call;
  if (next.id !== callId || !statuses.has(next.status) ||
      typeof next.callerId !== 'string' || !next.callerId ||
      typeof next.calleeId !== 'string' || !next.calleeId ||
      typeof next.roomName !== 'string' || typeof next.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(next.createdAt)) ||
      (next.media !== 'audio' && next.media !== 'video')) return current;
  if (current && (current.id !== next.id || (current.attemptId ?? null) !== (next.attemptId ?? null) ||
      current.callerId !== next.callerId || current.calleeId !== next.calleeId ||
      isTerminalCallStatus(current.status) ||
      (current.status === 'active' && next.status === 'ringing'))) return current;
  return next;
}
