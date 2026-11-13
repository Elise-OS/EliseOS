import { describe, expect, it } from 'vitest';
import {
  ANSWER_TIMEOUT_MS,
  type CallAction,
  callPhase,
  callStage,
  type CallState,
  failureMessageKey,
  formatCallDuration,
  initialCallState,
  initials,
  JOIN_TIMEOUT_MS,
  nextDeadline,
  parseCallMessage,
  RECONNECT_TIMEOUT_MS,
  reduceCall,
  REMOTE_LEFT_GRACE_MS,
} from './callSession';

const run = (actions: [CallAction, number][], state: CallState = initialCallState) =>
  actions.reduce((current, [action, now]) => reduceCall(current, action, now), state);
const context = { accepted: true, hasJoin: true, error: false };

describe('parseCallMessage', () => {
  it('reads every message the call page posts', () => {
    expect(parseCallMessage('{"type":"joined"}')).toEqual({ type: 'joined' });
    expect(parseCallMessage('{"type":"media","audioMuted":true,"videoMuted":false}')).toEqual({
      type: 'media',
      audioMuted: true,
      videoMuted: false,
    });
    expect(
      parseCallMessage(
        '{"type":"remote","ids":["a","a","b"],"audioMuted":false,"videoMuted":true}',
      ),
    ).toEqual({
      type: 'remote',
      ids: ['a', 'b'],
      audioMuted: false,
      videoMuted: true,
      videoPending: false,
    });
    expect(parseCallMessage('{"type":"participant-left","id":"tv"}')).toEqual({
      type: 'participant-left',
      id: 'tv',
    });
    expect(
      parseCallMessage('{"type":"device-error","kind":"microphone","problem":"permission"}'),
    ).toEqual({ type: 'device-error', kind: 'microphone', problem: 'permission' });
    expect(parseCallMessage('{"type":"quality","quality":140,"packetLoss":"x"}')).toEqual({
      type: 'quality',
      quality: 100,
      packetLoss: null,
    });
  });

  it('ignores anything malformed or unknown', () => {
    expect(parseCallMessage('joined')).toBeNull();
    expect(parseCallMessage('null')).toBeNull();
    expect(parseCallMessage('{"type":"eval"}')).toBeNull();
    expect(parseCallMessage('{"type":"media","audioMuted":"yes","videoMuted":false}')).toBeNull();
    expect(
      parseCallMessage('{"type":"remote","ids":[1],"audioMuted":false,"videoMuted":false}'),
    ).toBeNull();
    expect(parseCallMessage('{"type":"participant-joined","id":""}')).toBeNull();
    expect(
      parseCallMessage('{"type":"device-error","kind":"speaker","problem":"permission"}'),
    ).toBeNull();
  });
});

describe('call state', () => {
  it('starts the clock when the TV joins, not when the phone enters the room', () => {
    const joined = run([[{ type: 'joined' }, 1000]]);
    expect(joined.connectedAt).toBeNull();
    expect(callPhase(joined, context, 2000)).toBe('waiting');
    const talking = run([[{ type: 'participant-joined', id: 'tv' }, 5000]], joined);
    expect(talking.connectedAt).toBe(5000);
    expect(callPhase(talking, context, 6000)).toBe('in-call');
    // The store snapshot confirming the same participant keeps the original start.
    const synced = run(
      [[{ type: 'remote', ids: ['tv'], audioMuted: true, videoMuted: false }, 9000]],
      talking,
    );
    expect(synced.connectedAt).toBe(5000);
    expect(synced.remoteAudioMuted).toBe(true);
  });

  it('tells a camera still starting apart from a camera switched off', () => {
    const arriving = run([
      [
        { type: 'remote', ids: ['tv'], audioMuted: false, videoMuted: false, videoPending: true },
        1,
      ],
    ]);
    expect(arriving.remoteVideoPending).toBe(true);
    expect(arriving.remoteVideoMuted).toBe(false);
    const gone = run(
      [[{ type: 'remote', ids: [], audioMuted: true, videoMuted: true }, 2]],
      arriving,
    );
    expect(gone.remoteVideoPending).toBe(false);
    expect(gone.remoteVideoMuted).toBe(false);
  });

  it('only shows what Jitsi reports for the microphone and camera', () => {
    expect(initialCallState.audioMuted).toBeNull();
    const muted = run([[{ type: 'media', audioMuted: true, videoMuted: false }, 1]]);
    expect(muted.audioMuted).toBe(true);
    expect(muted.videoMuted).toBe(false);
  });

  it('ends the call once the TV has been gone for the grace period', () => {
    const talking = run([
      [{ type: 'joined' }, 0],
      [{ type: 'participant-joined', id: 'tv' }, 1000],
      [{ type: 'participant-left', id: 'tv' }, 10_000],
    ]);
    expect(talking.remoteLeftAt).toBe(10_000);
    expect(callPhase(talking, context, 11_000)).toBe('reconnecting');
    expect(nextDeadline(talking, 'reconnecting', { phaseStartedAt: 10_000 })).toEqual({
      at: 10_000 + REMOTE_LEFT_GRACE_MS,
      failure: null,
    });
    expect(callPhase(talking, context, 10_000 + REMOTE_LEFT_GRACE_MS)).toBe('ended');
    const back = run([[{ type: 'participant-joined', id: 'tv' }, 12_000]], talking);
    expect(callPhase(back, context, 20_000)).toBe('in-call');
    expect(back.connectedAt).toBe(1000);
  });

  it('does not end the call while this phone itself is reconnecting', () => {
    const lost = run([
      [{ type: 'joined' }, 0],
      [{ type: 'participant-joined', id: 'tv' }, 1000],
      [{ type: 'interrupted' }, 5000],
      [{ type: 'participant-left', id: 'tv' }, 6000],
    ]);
    expect(callPhase(lost, context, 60_000)).toBe('reconnecting');
    expect(nextDeadline(lost, 'reconnecting', { phaseStartedAt: 5000 })).toEqual({
      at: 5000 + RECONNECT_TIMEOUT_MS,
      failure: 'connection-lost',
    });
    const restored = run([[{ type: 'restored' }, 20_000]], lost);
    expect(callPhase(restored, context, 21_000)).toBe('reconnecting');
    expect(restored.remoteLeftAt).toBe(20_000);
    const offline = run([[{ type: 'network', online: false }, 30_000]], restored);
    expect(callPhase(offline, context, 90_000)).toBe('reconnecting');
  });

  it('turns a refused microphone into a blocking error and a refused camera into a notice', () => {
    const mic = run([[{ type: 'device-error', kind: 'microphone', problem: 'permission' }, 1]]);
    expect(mic.failure).toBe('microphone-permission');
    expect(callPhase(mic, context, 2)).toBe('failed');
    const camera = run([
      [{ type: 'joined' }, 0],
      [{ type: 'device-error', kind: 'camera', problem: 'permission' }, 1],
    ]);
    expect(camera.failure).toBeNull();
    expect(camera.cameraProblem).toBe('permission');
  });

  it('keeps the first failure and ignores late messages', () => {
    const failed = run([
      [{ type: 'unreachable' }, 0],
      [{ type: 'joined' }, 1],
    ]);
    expect(failed.failure).toBe('unreachable');
    expect(failed.joined).toBe(false);
  });

  it('leaving the room before anyone answered is a failure, after a talk it is the end', () => {
    expect(callPhase(run([[{ type: 'left' }, 1]]), context, 2)).toBe('failed');
    const talked = run([
      [{ type: 'joined' }, 0],
      [{ type: 'participant-joined', id: 'tv' }, 1],
      [{ type: 'left' }, 2],
    ]);
    expect(callPhase(talked, context, 3)).toBe('ended');
  });

  it('names each step before the conversation', () => {
    expect(callPhase(initialCallState, { accepted: false, hasJoin: false, error: false }, 0)).toBe(
      'ringing',
    );
    expect(callPhase(initialCallState, { accepted: true, hasJoin: false, error: false }, 0)).toBe(
      'connecting',
    );
    expect(callPhase(initialCallState, { ...context, error: true }, 0)).toBe('failed');
  });

  it('gives up on a join or an answer that never comes', () => {
    expect(nextDeadline(initialCallState, 'connecting', { phaseStartedAt: 100 })).toEqual({
      at: 100 + JOIN_TIMEOUT_MS,
      failure: 'timeout',
    });
    const waiting = run([[{ type: 'joined' }, 0]]);
    expect(nextDeadline(waiting, 'waiting', { phaseStartedAt: 0 })).toEqual({
      at: ANSWER_TIMEOUT_MS,
      failure: 'no-answer',
    });
    expect(nextDeadline(waiting, 'in-call', { phaseStartedAt: 0 })).toBeNull();
  });

  it('maps network statistics to a level and skips unchanged levels', () => {
    const good = run([[{ type: 'quality', quality: 90, packetLoss: 0 }, 0]]);
    expect(good.network).toBe('good');
    expect(reduceCall(good, { type: 'quality', quality: 80, packetLoss: 1 }, 1)).toBe(good);
    expect(reduceCall(good, { type: 'quality', quality: 5, packetLoss: 0 }, 1).network).toBe(
      'poor',
    );
  });
});

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(75.9)).toBe('1:15');
    expect(formatCallDuration(3725)).toBe('1:02:05');
    expect(formatCallDuration(-4)).toBe('0:00');
  });

  it('builds initials', () => {
    expect(initials('Jeanne Martin')).toBe('JM');
    expect(initials('  élise ')).toBe('É');
    expect(initials('')).toBe('É');
  });

  it('explains the Tailscale case only for a private video server', () => {
    expect(failureMessageKey('unreachable', true)).toBe('turnOnTailscale');
    expect(failureMessageKey('unreachable', false)).toBe('theVideoCallIsTemporarily');
    expect(failureMessageKey('microphone-permission', false)).toBe('microphonePermission');
  });
});

describe('call screen layout', () => {
  const iphone = { top: 59, right: 0, bottom: 34, left: 0 };

  it('puts the video between the self-view and the control bar when upright', () => {
    const stage = callStage({ width: 390, height: 844, insets: iphone, barHeight: 160 });
    // Self-view: 12 px under the safe area, 144 px high, then 12 px of air.
    expect(stage).toEqual({ top: 59 + 168, right: 0, bottom: 168, left: 0 });
    // Before the bar has been measured the home indicator is still kept free.
    expect(callStage({ width: 390, height: 844, insets: iphone, barHeight: 0 }).bottom).toBe(42);
  });

  it('keeps the self-view column free when sideways', () => {
    const insets = { top: 0, right: 59, bottom: 21, left: 59 };
    expect(callStage({ width: 844, height: 390, insets, barHeight: 120 })).toEqual({
      top: 0,
      right: 59 + 148 + 28,
      bottom: 0,
      left: 59,
    });
  });
});
