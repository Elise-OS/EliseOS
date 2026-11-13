import { describe, expect, it } from 'vitest';
import {
  CALL_TROUBLE_MS,
  callPhase,
  callQuality,
  callReducer,
  formatCallDuration,
  initialCallState,
  initialsOf,
  isConnectionError,
  type CallAction,
  type CallState,
} from './call-state';

const run = (actions: CallAction[], state: CallState = initialCallState()) =>
  actions.reduce(callReducer, state);

describe('call state rebuilt from Jitsi events', () => {
  it('goes from loading to connecting, waiting and live', () => {
    let state = initialCallState();
    expect(callPhase(state)).toBe('loading');
    state = callReducer(state, { type: 'scriptLoaded' });
    expect(callPhase(state)).toBe('connecting');
    state = callReducer(state, { type: 'joined', at: 1000 });
    expect(callPhase(state)).toBe('waiting');
    state = callReducer(state, { type: 'participantJoined', id: 'p1', name: 'Paul', at: 4000 });
    expect(callPhase(state)).toBe('live');
    expect(state.remoteName).toBe('Paul');
    // The duration counts from the other person's arrival, not from our own join.
    expect(state.connectedAt).toBe(4000);
  });

  it('keeps the first arrival time and ignores duplicate joins', () => {
    const state = run([
      { type: 'scriptLoaded' },
      { type: 'joined', at: 0 },
      { type: 'participantJoined', id: 'p1', at: 10 },
      { type: 'participantJoined', id: 'p1', at: 20 },
      { type: 'participantLeft', id: 'p1' },
      { type: 'participantJoined', id: 'p2', at: 30 },
    ]);
    expect(state.remotes).toEqual(['p2']);
    expect(state.connectedAt).toBe(10);
    expect(state.remoteLeft).toBe(false);
  });

  it('shows that the other person dropped instead of the mirror image', () => {
    const state = run([
      { type: 'scriptLoaded' },
      { type: 'joined', at: 0 },
      { type: 'participantJoined', id: 'p1', at: 10 },
      { type: 'participantLeft', id: 'p1' },
    ]);
    expect(callPhase(state)).toBe('waiting');
    expect(state.remoteLeft).toBe(true);
    // A participant we never saw leaving changes nothing.
    expect(callReducer(state, { type: 'participantLeft', id: 'ghost' })).toBe(state);
  });

  it('reflects the real mute states reported by Jitsi', () => {
    let state = run([{ type: 'audioMuted', muted: true }]);
    expect(state.audioMuted).toBe(true);
    state = callReducer(state, { type: 'audioMuted', muted: false });
    state = callReducer(state, { type: 'videoMuted', muted: true });
    expect(state).toMatchObject({ audioMuted: false, videoMuted: true });
  });

  it('starts with absent devices muted and unavailable', () => {
    const state = initialCallState({ camera: false, microphone: true });
    expect(state).toMatchObject({ videoMuted: true, audioMuted: false });
    expect(state.unavailable).toEqual({ camera: true });
    expect(state.refused).toEqual({});
  });

  it('marks a refused or failing device', () => {
    const state = run([{ type: 'deviceError', device: 'microphone' }]);
    expect(state.unavailable.microphone).toBe(true);
    expect(state.refused.microphone).toBe(true);
    expect(state.audioMuted).toBe(true);
    const back = callReducer(state, {
      type: 'deviceAvailable',
      device: 'microphone',
      available: true,
    });
    expect(back.unavailable.microphone).toBeUndefined();
  });

  it('shows a reconnection while offline or while Jitsi rejoins', () => {
    const live = run([
      { type: 'scriptLoaded' },
      { type: 'joined', at: 0 },
      { type: 'participantJoined', id: 'p1', at: 1 },
    ]);
    const offline = callReducer(live, { type: 'network', online: false });
    expect(callPhase(offline)).toBe('reconnecting');
    expect(callPhase(callReducer(offline, { type: 'network', online: true }))).toBe('live');
    // Jitsi leaving the room on its own (connection lost) is not a hang-up.
    const dropped = callReducer(live, { type: 'left', at: 5 });
    expect(callPhase(dropped)).toBe('reconnecting');
    expect(dropped.endedAt).toBeNull();
    expect(callPhase(callReducer(dropped, { type: 'joined', at: 6 }))).toBe('waiting');
  });

  it('ends once after a hang-up and ignores late events', () => {
    const state = run([
      { type: 'scriptLoaded' },
      { type: 'joined', at: 0 },
      { type: 'participantJoined', id: 'p1', at: 1 },
      { type: 'hangup' },
    ]);
    expect(callPhase(state)).toBe('ended');
    const left = callReducer(state, { type: 'left', at: 9 });
    expect(left.endedAt).toBe(9);
    expect(callReducer(left, { type: 'participantJoined', id: 'p2', at: 10 })).toBe(left);
    expect(callReducer(left, { type: 'ended', at: 11 })).toBe(left);
  });

  it('fails clearly, unless the room is already open, and can retry', () => {
    const failed = run([{ type: 'failed', failure: 'unreachable' }]);
    expect(callPhase(failed)).toBe('failed');
    const retried = callReducer(failed, { type: 'retry' });
    expect(callPhase(retried)).toBe('loading');
    const joined = run([{ type: 'scriptLoaded' }, { type: 'joined', at: 0 }]);
    expect(callReducer(joined, { type: 'failed', failure: 'timeout' })).toBe(joined);
  });

  it('rates the connection for the caregiver window', () => {
    const live = run([
      { type: 'scriptLoaded' },
      { type: 'joined', at: 0 },
      { type: 'participantJoined', id: 'p1', at: 1 },
    ]);
    expect(callQuality(live, 100)).toBe('good');
    const trouble = callReducer(live, { type: 'trouble', at: 1000 });
    expect(callQuality(trouble, 2000)).toBe('fair');
    expect(callQuality(trouble, 1000 + CALL_TROUBLE_MS)).toBe('good');
    expect(callQuality(callReducer(live, { type: 'network', online: false }), 0)).toBe('poor');
    expect(callQuality(initialCallState(), 0)).toBe('unknown');
  });
});

describe('call helpers', () => {
  it('formats durations', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(65_400)).toBe('1:05');
    expect(formatCallDuration(3_729_000)).toBe('1:02:09');
    expect(formatCallDuration(-5)).toBe('0:00');
  });

  it('builds avatar initials', () => {
    expect(initialsOf('Jeanne Martin')).toBe('JM');
    expect(initialsOf('  paul ')).toBe('P');
    expect(initialsOf('Élodie de la Tour')).toBe('ÉD');
    expect(initialsOf('')).toBe('É');
  });

  it('recognises connection errors', () => {
    expect(isConnectionError({ name: 'connection.droppedError' })).toBe(true);
    expect(isConnectionError({ type: 'CONFERENCE', name: 'conference.failed' })).toBe(true);
    expect(isConnectionError({ name: 'gum.permission_denied' })).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});
