import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  callMediaAccessFromError,
  eliseCallEventFromJitsi,
  eliseCallEventFromNetwork,
  eliseCallReconnectDelay,
  initialEliseCallRuntime,
  reduceEliseCallRuntime,
} from '../dist/index.js';

const dispatch = (events) =>
  events.reduce(reduceEliseCallRuntime, initialEliseCallRuntime(events[0]?.at ?? 0));

test('exposes denied camera and microphone independently while keeping receive-only calls alive', () => {
  const state = dispatch([
    { type: 'start', at: 1 },
    { type: 'camera-error', error: { type: 'PERMISSION_DENIED' }, at: 2 },
    { type: 'microphone-error', error: { message: 'NotAllowedError' }, at: 3 },
    { type: 'conference-joined', at: 4 },
  ]);
  assert.equal(state.phase, 'connected');
  assert.equal(state.camera, 'denied');
  assert.equal(state.microphone, 'denied');
});

test('distinguishes missing hardware from refused permission', () => {
  assert.equal(callMediaAccessFromError({ type: 'DEVICE_NOT_FOUND' }), 'unavailable');
  assert.equal(callMediaAccessFromError({ message: 'Permission denied' }), 'denied');
});

test('exposes the remote participant hanging up', () => {
  const state = dispatch([
    { type: 'start', at: 1 },
    { type: 'conference-joined', at: 2 },
    { type: 'participant-joined', at: 3 },
    { type: 'participant-left', at: 4 },
  ]);
  assert.equal(state.phase, 'ended');
  assert.equal(state.remote, 'left');
  assert.equal(state.endReason, 'remote-hangup');
});

test('exposes a concurrent incoming call as busy without replacing the active call', () => {
  const state = dispatch([
    { type: 'start', at: 1 },
    { type: 'conference-joined', at: 2 },
    { type: 'participant-joined', at: 2 },
    { type: 'busy', at: 3 },
  ]);
  assert.equal(state.phase, 'connected');
  assert.equal(state.remote, 'connected');
  assert.equal(state.endReason, null);
  assert.equal(state.concurrentIncoming, 'rejected-busy');
});

test('schedules bounded automatic reconnects after a network switch', () => {
  let state = dispatch([
    { type: 'start', at: 1 },
    { type: 'conference-joined', at: 2 },
    { type: 'network-offline', at: 3 },
    { type: 'network-online', at: 100 },
  ]);
  assert.equal(state.phase, 'reconnecting');
  assert.equal(state.nextReconnectAt, 1100);
  for (let attempt = 1; attempt < 5; attempt += 1)
    state = reduceEliseCallRuntime(state, { type: 'reconnect-timer-fired', at: 200 + attempt });
  assert.equal(state.reconnectAttempt, 5);
  state = reduceEliseCallRuntime(state, { type: 'reconnect-timer-fired', at: 300 });
  assert.equal(state.phase, 'failed');
  assert.equal(state.endReason, 'reconnect-exhausted');
});

test('a successful reconnection clears retry state', () => {
  const state = dispatch([
    { type: 'start', at: 1 },
    { type: 'network-offline', at: 2 },
    { type: 'network-online', at: 3 },
    { type: 'conference-joined', at: 4 },
  ]);
  assert.equal(state.phase, 'connected');
  assert.equal(state.network, 'online');
  assert.equal(state.reconnectAttempt, 0);
  assert.equal(state.nextReconnectAt, null);
});

test('Jitsi permission and lifecycle events map to the stable contract', () => {
  assert.deepEqual(eliseCallEventFromJitsi('micError', { type: 'denied' }, 10), {
    type: 'microphone-error',
    error: { type: 'denied' },
    at: 10,
  });
  assert.deepEqual(eliseCallEventFromJitsi('peerConnectionFailure', {}, 11), {
    type: 'peer-connection-failed',
    at: 11,
  });
  assert.deepEqual(eliseCallEventFromNetwork(false, 12), { type: 'network-offline', at: 12 });
  assert.deepEqual(eliseCallEventFromNetwork(true, 13), { type: 'network-online', at: 13 });
  assert.equal(eliseCallReconnectDelay(0), 1000);
  assert.equal(eliseCallReconnectDelay(5), null);
});

test('late Jitsi close events do not overwrite the real end reason', () => {
  const remote = dispatch([
    { type: 'start', at: 1 },
    { type: 'participant-left', at: 2 },
    { type: 'conference-left', at: 3 },
  ]);
  assert.equal(remote.endReason, 'remote-hangup');

  const local = dispatch([
    { type: 'start', at: 1 },
    { type: 'local-hangup', at: 2 },
    { type: 'conference-left', at: 3 },
  ]);
  assert.equal(local.endReason, 'local-hangup');
});
