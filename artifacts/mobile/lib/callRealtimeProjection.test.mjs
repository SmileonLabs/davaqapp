import { describe, it, expect } from 'vitest';
import { projectRealtimeCall } from './callRealtimeProjection';
const call = { id:'call-a', attemptId:'attempt-a', callerId:'caller', calleeId:'callee', roomName:'room-a', createdAt:'2026-10-16T00:00:00Z', media:'video', status:'active' };
describe('authenticated realtime call state', () => {
  it('projects terminal hangup without another GET', () => {
    expect(projectRealtimeCall(call,call.id,{...call,status:'ended'}).status).toBe('ended');
  });
  it('does not revive a terminal call on a delayed active event', () => {
    const ended={...call,status:'ended'};
    expect(projectRealtimeCall(ended,call.id,call)).toBe(ended);
  });
  it('does not regress active state to ringing', () => {
    expect(projectRealtimeCall(call,call.id,{...call,status:'ringing'})).toBe(call);
  });
  it.each([{...call,id:'other'}, {...call,status:'unknown'}, {...call,media:'invalid'}, {...call,createdAt:'invalid'}])('rejects mismatched or incomplete state', bad => {
    expect(projectRealtimeCall(call,call.id,bad)).toBe(call);
  });
  it('rejects another durable call attempt', () => {
    expect(projectRealtimeCall(call,call.id,{...call,attemptId:'attempt-b',status:'ended'})).toBe(call);
  });
  it('accepts compatible legacy null/absent attempts', () => {
    const legacy={...call,attemptId:undefined};
    expect(projectRealtimeCall(legacy,call.id,{...call,attemptId:null,status:'ended'}).status).toBe('ended');
  });
  it('seeds a currently unwatched call from its complete server event', () => {
    expect(projectRealtimeCall(undefined,call.id,call)).toBe(call);
  });
});
