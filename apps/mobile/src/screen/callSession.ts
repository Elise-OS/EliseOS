import { callNetworkLevel, type CallNetworkLevel } from '@elise/contracts';

/**
 * Call screen logic, without React Native: what the Jitsi page inside the WebView reports
 * (callPage.ts posts one JSON message per event) and what the screen shows from it.
 * The buttons only ever show what Jitsi reported: nothing is changed optimistically.
 */

export type DeviceKind = 'camera' | 'microphone';
export type DeviceProblem = 'permission' | 'unavailable';

export type CallMessage =
  | { type: 'unreachable' }
  | { type: 'joined' }
  | { type: 'left' }
  | { type: 'media'; audioMuted: boolean; videoMuted: boolean }
  | { type: 'availability'; kind: DeviceKind; available: boolean }
  | {
      type: 'remote';
      ids: string[];
      audioMuted: boolean;
      videoMuted: boolean;
      /** The camera is on but no picture has arrived yet. */
      videoPending?: boolean;
    }
  | { type: 'participant-joined'; id: string }
  | { type: 'participant-left'; id: string }
  | { type: 'camera-switch'; available: boolean }
  | { type: 'camera-switch-error' }
  | { type: 'device-error'; kind: DeviceKind; problem: DeviceProblem }
  | { type: 'interrupted' }
  | { type: 'restored' }
  | { type: 'quality'; quality: number | null; packetLoss: number | null }
  | { type: 'failed' };

const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length < 200;
const percent = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

/** Validates a message posted by the WebView page; anything unexpected is ignored. */
export function parseCallMessage(data: string): CallMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'unreachable':
    case 'joined':
    case 'left':
    case 'camera-switch-error':
    case 'interrupted':
    case 'restored':
    case 'failed':
      return { type: message.type };
    case 'media':
      return isBool(message.audioMuted) && isBool(message.videoMuted)
        ? { type: 'media', audioMuted: message.audioMuted, videoMuted: message.videoMuted }
        : null;
    case 'availability':
      return (message.kind === 'camera' || message.kind === 'microphone') &&
        isBool(message.available)
        ? { type: 'availability', kind: message.kind, available: message.available }
        : null;
    case 'remote':
      return Array.isArray(message.ids) &&
        message.ids.length <= 10 &&
        message.ids.every(isId) &&
        isBool(message.audioMuted) &&
        isBool(message.videoMuted)
        ? {
            type: 'remote',
            ids: [...new Set(message.ids)],
            audioMuted: message.audioMuted,
            videoMuted: message.videoMuted,
            videoPending: message.videoPending === true,
          }
        : null;
    case 'participant-joined':
    case 'participant-left':
      return isId(message.id) ? { type: message.type, id: message.id } : null;
    case 'camera-switch':
      return isBool(message.available)
        ? { type: 'camera-switch', available: message.available }
        : null;
    case 'device-error':
      return (message.kind === 'camera' || message.kind === 'microphone') &&
        (message.problem === 'permission' || message.problem === 'unavailable')
        ? { type: 'device-error', kind: message.kind, problem: message.problem }
        : null;
    case 'quality':
      return {
        type: 'quality',
        quality: percent(message.quality),
        packetLoss: percent(message.packetLoss),
      };
    default:
      return null;
  }
}

export type CallFailure =
  | 'unreachable'
  | 'failed'
  | 'microphone-permission'
  | 'microphone-unavailable'
  | 'timeout'
  | 'no-answer'
  | 'connection-lost'
  | 'crashed';

export interface CallState {
  /** This phone is in the Jitsi room. */
  joined: boolean;
  /** Jitsi left the room (hang-up done, or the conference ended). */
  left: boolean;
  remoteIds: string[];
  /** When the other person first appeared: the call duration starts here, not on our join. */
  connectedAt: number | null;
  /** When the other person disappeared (null while present). */
  remoteLeftAt: number | null;
  remoteAudioMuted: boolean;
  remoteVideoMuted: boolean;
  remoteVideoPending: boolean;
  /** Unknown (null) until Jitsi reports it. */
  audioMuted: boolean | null;
  videoMuted: boolean | null;
  audioAvailable: boolean;
  videoAvailable: boolean;
  cameraSwitch: boolean;
  /** Jitsi lost its media/signalling connection and is reconnecting. */
  interrupted: boolean;
  /** The phone has no network at all (NetInfo). */
  offline: boolean;
  interruptedAt: number | null;
  network: CallNetworkLevel;
  cameraProblem: DeviceProblem | null;
  failure: CallFailure | null;
}

export const initialCallState: CallState = {
  joined: false,
  left: false,
  remoteIds: [],
  connectedAt: null,
  remoteLeftAt: null,
  remoteAudioMuted: false,
  remoteVideoMuted: false,
  remoteVideoPending: false,
  audioMuted: null,
  videoMuted: null,
  audioAvailable: true,
  videoAvailable: true,
  cameraSwitch: false,
  interrupted: false,
  offline: false,
  interruptedAt: null,
  network: 'unknown',
  cameraProblem: null,
  failure: null,
};

export type CallAction =
  CallMessage | { type: 'network'; online: boolean } | { type: 'fail'; failure: CallFailure };

const withRemotes = (state: CallState, ids: string[], now: number): CallState => {
  if (ids.length > 0)
    return { ...state, remoteIds: ids, connectedAt: state.connectedAt ?? now, remoteLeftAt: null };
  return {
    ...state,
    remoteIds: [],
    remoteLeftAt: state.connectedAt === null ? null : (state.remoteLeftAt ?? now),
  };
};

export function reduceCall(state: CallState, action: CallAction, now: number): CallState {
  if (state.failure && action.type !== 'left') return state;
  switch (action.type) {
    case 'unreachable':
      return state.joined ? state : { ...state, failure: 'unreachable' };
    case 'failed':
      return { ...state, failure: 'failed' };
    case 'fail':
      return { ...state, failure: action.failure };
    case 'joined':
      return { ...state, joined: true, left: false };
    case 'left':
      return { ...state, joined: false, left: true };
    case 'media':
      return { ...state, audioMuted: action.audioMuted, videoMuted: action.videoMuted };
    case 'availability':
      return action.kind === 'camera'
        ? { ...state, videoAvailable: action.available }
        : { ...state, audioAvailable: action.available };
    case 'remote':
      return {
        ...withRemotes(state, action.ids, now),
        remoteAudioMuted: action.ids.length > 0 && action.audioMuted,
        remoteVideoMuted: action.ids.length > 0 && action.videoMuted,
        remoteVideoPending: action.ids.length > 0 && action.videoPending === true,
      };
    case 'participant-joined':
      return withRemotes(
        state,
        state.remoteIds.includes(action.id) ? state.remoteIds : [...state.remoteIds, action.id],
        now,
      );
    case 'participant-left':
      return withRemotes(
        state,
        state.remoteIds.filter((id) => id !== action.id),
        now,
      );
    case 'camera-switch':
      return { ...state, cameraSwitch: action.available };
    case 'camera-switch-error':
      return state;
    case 'device-error':
      if (action.kind === 'microphone')
        return {
          ...state,
          failure:
            action.problem === 'permission' ? 'microphone-permission' : 'microphone-unavailable',
        };
      return { ...state, cameraProblem: action.problem };
    case 'interrupted':
      return { ...state, interrupted: true, interruptedAt: state.interruptedAt ?? now };
    case 'restored':
      return {
        ...state,
        interrupted: false,
        interruptedAt: state.offline ? state.interruptedAt : null,
        // Participants come back after a reconnection: give them the grace period again.
        remoteLeftAt: state.remoteLeftAt === null ? null : now,
      };
    case 'network':
      if (action.online)
        return {
          ...state,
          offline: false,
          interruptedAt: state.interrupted ? state.interruptedAt : null,
          remoteLeftAt: state.remoteLeftAt === null ? null : now,
        };
      return { ...state, offline: true, interruptedAt: state.interruptedAt ?? now };
    case 'quality': {
      const network = callNetworkLevel({
        quality: action.quality,
        packetLoss: action.packetLoss,
      });
      return network === state.network ? state : { ...state, network };
    }
  }
}

/** The other person may drop for a second (TV reloading, Wi-Fi hiccup) before it really ends. */
export const REMOTE_LEFT_GRACE_MS = 4000;
/** Our own connection to the room (WebView loaded, Jitsi script running) must be up by then. */
export const JOIN_TIMEOUT_MS = 30_000;
/** The TV answers by itself: if it never shows up, say so instead of waiting forever. */
export const ANSWER_TIMEOUT_MS = 60_000;
/** A reconnection that lasts longer than this is reported as a lost call. */
export const RECONNECT_TIMEOUT_MS = 45_000;

export type CallPhase =
  'ringing' | 'connecting' | 'waiting' | 'in-call' | 'reconnecting' | 'ended' | 'failed';

export function callPhase(
  state: CallState,
  context: { accepted: boolean; hasJoin: boolean; error: boolean },
  now: number,
): CallPhase {
  if (context.error || state.failure) return 'failed';
  if (state.left) return state.connectedAt === null ? 'failed' : 'ended';
  if (state.offline || state.interrupted) return state.joined ? 'reconnecting' : 'connecting';
  if (state.remoteLeftAt !== null)
    return now - state.remoteLeftAt >= REMOTE_LEFT_GRACE_MS ? 'ended' : 'reconnecting';
  if (!context.hasJoin) return context.accepted ? 'connecting' : 'ringing';
  if (!state.joined) return 'connecting';
  return state.remoteIds.length > 0 ? 'in-call' : 'waiting';
}

/** The next moment the phase may change by itself (grace period or timeout), if any. */
export function nextDeadline(
  state: CallState,
  phase: CallPhase,
  since: { phaseStartedAt: number },
): { at: number; failure: CallFailure | null } | null {
  if (
    phase === 'reconnecting' &&
    state.remoteLeftAt !== null &&
    !state.offline &&
    !state.interrupted
  )
    return { at: state.remoteLeftAt + REMOTE_LEFT_GRACE_MS, failure: null };
  if (phase === 'reconnecting' && state.interruptedAt !== null)
    return { at: state.interruptedAt + RECONNECT_TIMEOUT_MS, failure: 'connection-lost' };
  if (phase === 'connecting')
    return { at: since.phaseStartedAt + JOIN_TIMEOUT_MS, failure: 'timeout' };
  if (phase === 'waiting' && state.connectedAt === null)
    return { at: since.phaseStartedAt + ANSWER_TIMEOUT_MS, failure: 'no-answer' };
  return null;
}

export function formatCallDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = String(value % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => Array.from(part)[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'É'
  );
}

/** Text shown when a call cannot go on: the key of mobileCallOverlay in the locales. */
export function failureMessageKey(failure: CallFailure | null, privateVideoServer: boolean) {
  switch (failure) {
    case 'unreachable':
      return privateVideoServer ? 'turnOnTailscale' : 'theVideoCallIsTemporarily';
    case 'microphone-permission':
      return 'microphonePermission';
    case 'microphone-unavailable':
      return 'microphoneUnavailable';
    case 'timeout':
      return 'connectionTimeout';
    case 'no-answer':
      return 'noAnswer';
    case 'connection-lost':
      return 'connectionLost';
    case 'crashed':
      return 'videoStopped';
    default:
      return 'theVideoCallIsTemporarily';
  }
}
