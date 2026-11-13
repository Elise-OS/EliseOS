export const ELISE_CALL_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 20_000] as const;

export type EliseCallPhase =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';
export type EliseCallMediaAccess = 'unknown' | 'available' | 'denied' | 'unavailable';
export type EliseCallNetwork = 'online' | 'offline' | 'recovering';
export type EliseCallRemote = 'waiting' | 'connected' | 'left';
export type EliseCallConcurrentIncoming = 'none' | 'rejected-busy';
export type EliseCallEndReason =
  | 'local-hangup'
  | 'remote-hangup'
  | 'conference-ended'
  | 'server-unreachable'
  | 'reconnect-exhausted'
  | null;

export interface EliseCallRuntimeState {
  phase: EliseCallPhase;
  camera: EliseCallMediaAccess;
  microphone: EliseCallMediaAccess;
  network: EliseCallNetwork;
  remote: EliseCallRemote;
  concurrentIncoming: EliseCallConcurrentIncoming;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
  endReason: EliseCallEndReason;
  changedAt: number;
}

export type EliseCallRuntimeEvent =
  | { type: 'start'; at: number }
  | { type: 'conference-joined'; at: number }
  | { type: 'participant-joined'; at: number }
  | { type: 'participant-left'; at: number }
  | { type: 'camera-ready'; at: number }
  | { type: 'microphone-ready'; at: number }
  | { type: 'camera-error'; at: number; error?: unknown }
  | { type: 'microphone-error'; at: number; error?: unknown }
  | { type: 'network-offline'; at: number }
  | { type: 'network-online'; at: number }
  | { type: 'peer-connection-failed'; at: number }
  | { type: 'reconnect-timer-fired'; at: number }
  | { type: 'server-unreachable'; at: number }
  | { type: 'busy'; at: number }
  | { type: 'local-hangup'; at: number }
  | { type: 'conference-left'; at: number };

export const initialEliseCallRuntime = (at = 0): EliseCallRuntimeState => ({
  phase: 'idle',
  camera: 'unknown',
  microphone: 'unknown',
  network: 'online',
  remote: 'waiting',
  concurrentIncoming: 'none',
  reconnectAttempt: 0,
  nextReconnectAt: null,
  endReason: null,
  changedAt: at,
});

export function callMediaAccessFromError(error: unknown): EliseCallMediaAccess {
  const value =
    typeof error === 'object' && error !== null
      ? `${'type' in error ? String(error.type) : ''} ${'message' in error ? String(error.message) : ''}`
      : String(error ?? '');
  return /denied|notallowed|permission|security/i.test(value) ? 'denied' : 'unavailable';
}

/** Permission API state takes precedence because Jitsi may wrap denials as a generic GUM error. */
export function callMediaAccessFromPermission(
  permission: 'granted' | 'prompt' | 'denied' | 'unsupported',
  error?: unknown,
): EliseCallMediaAccess {
  if (permission === 'denied') return 'denied';
  if (permission === 'granted' && error === undefined) return 'available';
  return error === undefined ? 'unknown' : callMediaAccessFromError(error);
}

export function eliseCallReconnectDelay(attempt: number): number | null {
  return ELISE_CALL_RECONNECT_DELAYS_MS[attempt] ?? null;
}

function reconnect(state: EliseCallRuntimeState, at: number): EliseCallRuntimeState {
  if (state.phase === 'idle' || state.phase === 'ended' || state.phase === 'failed') return state;
  const delay = eliseCallReconnectDelay(state.reconnectAttempt);
  if (delay === null)
    return {
      ...state,
      phase: 'failed',
      network: 'offline',
      nextReconnectAt: null,
      endReason: 'reconnect-exhausted',
      changedAt: at,
    };
  return {
    ...state,
    phase: 'reconnecting',
    network: 'recovering',
    reconnectAttempt: state.reconnectAttempt + 1,
    nextReconnectAt: at + delay,
    changedAt: at,
  };
}

/** Pure state machine consumed by the dashboard, resident screen and mobile call UI. */
export function reduceEliseCallRuntime(
  state: EliseCallRuntimeState,
  event: EliseCallRuntimeEvent,
): EliseCallRuntimeState {
  const terminal = state.phase === 'ended' || state.phase === 'failed';
  switch (event.type) {
    case 'start':
      return { ...initialEliseCallRuntime(event.at), phase: 'connecting' };
    case 'conference-joined':
      if (terminal) return state;
      return {
        ...state,
        phase: 'connected',
        network: 'online',
        reconnectAttempt: 0,
        nextReconnectAt: null,
        endReason: null,
        changedAt: event.at,
      };
    case 'participant-joined':
      if (terminal) return state;
      return { ...state, remote: 'connected', changedAt: event.at };
    case 'participant-left':
      if (terminal) return state;
      return {
        ...state,
        phase: 'ended',
        remote: 'left',
        nextReconnectAt: null,
        endReason: 'remote-hangup',
        changedAt: event.at,
      };
    case 'camera-ready':
      return { ...state, camera: 'available', changedAt: event.at };
    case 'microphone-ready':
      return { ...state, microphone: 'available', changedAt: event.at };
    case 'camera-error':
      return { ...state, camera: callMediaAccessFromError(event.error), changedAt: event.at };
    case 'microphone-error':
      return { ...state, microphone: callMediaAccessFromError(event.error), changedAt: event.at };
    case 'network-offline':
      if (terminal || state.phase === 'idle') return state;
      return {
        ...state,
        phase: 'reconnecting',
        network: 'offline',
        nextReconnectAt: null,
        changedAt: event.at,
      };
    case 'network-online':
      if (state.phase !== 'reconnecting') return state;
      return reconnect(state, event.at);
    case 'peer-connection-failed':
      if (terminal || state.phase === 'idle') return state;
      return reconnect(state, event.at);
    case 'reconnect-timer-fired':
      if (state.phase !== 'reconnecting') return state;
      return reconnect(state, event.at);
    case 'busy':
      return {
        ...state,
        concurrentIncoming: 'rejected-busy',
        changedAt: event.at,
      };
    case 'server-unreachable':
      if (terminal) return state;
      return {
        ...state,
        phase: 'failed',
        nextReconnectAt: null,
        endReason: 'server-unreachable',
        changedAt: event.at,
      };
    case 'local-hangup':
      if (terminal) return state;
      return {
        ...state,
        phase: 'ended',
        nextReconnectAt: null,
        endReason: 'local-hangup',
        changedAt: event.at,
      };
    case 'conference-left':
      if (terminal) return state;
      return {
        ...state,
        phase: 'ended',
        nextReconnectAt: null,
        endReason: 'conference-ended',
        changedAt: event.at,
      };
  }
}

export type EliseJitsiEventName =
  | 'videoConferenceJoined'
  | 'participantJoined'
  | 'participantLeft'
  | 'cameraError'
  | 'micError'
  | 'peerConnectionFailure'
  | 'errorOccurred'
  | 'readyToClose'
  | 'videoConferenceLeft';

/** Converts Jitsi iframe events to the stable events used by Élise UI code. */
export function eliseCallEventFromJitsi(
  name: EliseJitsiEventName,
  payload: unknown,
  at = Date.now(),
): EliseCallRuntimeEvent {
  switch (name) {
    case 'videoConferenceJoined':
      return { type: 'conference-joined', at };
    case 'participantJoined':
      return { type: 'participant-joined', at };
    case 'participantLeft':
      return { type: 'participant-left', at };
    case 'cameraError':
      return { type: 'camera-error', error: payload, at };
    case 'micError':
      return { type: 'microphone-error', error: payload, at };
    case 'peerConnectionFailure':
      return { type: 'peer-connection-failed', at };
    case 'errorOccurred':
      return { type: 'server-unreachable', at };
    case 'readyToClose':
    case 'videoConferenceLeft':
      return { type: 'conference-left', at };
  }
}

/** Maps browser connectivity events without depending on DOM types in the shared package. */
export function eliseCallEventFromNetwork(online: boolean, at = Date.now()): EliseCallRuntimeEvent {
  return { type: online ? 'network-online' : 'network-offline', at };
}
