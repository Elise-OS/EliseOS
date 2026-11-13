import type { CallNetworkLevel } from '@elise/contracts';

/**
 * State of an Élise video call as the call bar shows it, rebuilt only from what Jitsi reports
 * through its External API (and the browser's network status). Pure: tested without Jitsi.
 */

/** What the screen shows, in order of precedence. */
export type CallPhase =
  | 'loading' // Jitsi's script is not there yet
  | 'connecting' // the Jitsi room is opening
  | 'waiting' // in the room, the other person is not (or no longer) there
  | 'live' // both are in the call
  | 'reconnecting' // the network dropped: Jitsi tries again
  | 'ended' // hung up (by either side)
  | 'failed'; // Jitsi could not be reached or opened in time

export type CallFailure = 'unreachable' | 'timeout' | 'join';
export type CallDevice = 'camera' | 'microphone';
/** Same levels as the mobile call screen (call-quality.ts). */
export type CallQuality = CallNetworkLevel;

export interface CallState {
  scriptLoaded: boolean;
  joined: boolean;
  /** Jitsi ids of the other people in the room. */
  remotes: string[];
  /** Display name Jitsi gives for the other person, when it has one. */
  remoteName: string | null;
  /** When the other person was first seen in this call: the duration counts from here. */
  connectedAt: number | null;
  /** The other person was there and left (dropped or hung up). */
  remoteLeft: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  /** A device missing or refused: its button is shown as unavailable. */
  unavailable: Partial<Record<CallDevice, true>>;
  /** A device the browser refused or that failed (as opposed to one that is simply absent). */
  refused: Partial<Record<CallDevice, true>>;
  /** The browser has no network. */
  offline: boolean;
  /** Jitsi left the room on its own (connection lost) and is rejoining. */
  rejoining: boolean;
  /** Last time the media connection struggled (peer connection failure, suspend…). */
  troubleAt: number | null;
  failure: CallFailure | null;
  endedAt: number | null;
  /** Hang-up requested here: Jitsi is leaving the room. */
  hangingUp: boolean;
}

export type CallAction =
  | { type: 'scriptLoaded' }
  | { type: 'failed'; failure: CallFailure }
  | { type: 'retry' }
  | { type: 'joined'; at: number }
  | { type: 'left'; at: number }
  | { type: 'participantJoined'; id: string; name?: string | undefined; at: number }
  | { type: 'participantLeft'; id: string }
  | { type: 'audioMuted'; muted: boolean }
  | { type: 'videoMuted'; muted: boolean }
  | { type: 'deviceAvailable'; device: CallDevice; available: boolean }
  | { type: 'deviceError'; device: CallDevice }
  | { type: 'network'; online: boolean }
  | { type: 'trouble'; at: number }
  | { type: 'hangup' }
  | { type: 'ended'; at: number };

export function initialCallState(
  options: { camera?: boolean; microphone?: boolean; online?: boolean } = {},
): CallState {
  const unavailable: CallState['unavailable'] = {};
  if (options.camera === false) unavailable.camera = true;
  if (options.microphone === false) unavailable.microphone = true;
  return {
    scriptLoaded: false,
    joined: false,
    remotes: [],
    remoteName: null,
    connectedAt: null,
    remoteLeft: false,
    // A missing device starts muted: Jitsi is told not to open it.
    audioMuted: options.microphone === false,
    videoMuted: options.camera === false,
    unavailable,
    refused: {},
    offline: options.online === false,
    rejoining: false,
    troubleAt: null,
    failure: null,
    endedAt: null,
    hangingUp: false,
  };
}

const withoutDevice = (state: CallState, device: CallDevice): CallState['unavailable'] => {
  const next = { ...state.unavailable };
  delete next[device];
  return next;
};

export function callReducer(state: CallState, action: CallAction): CallState {
  // Once the call is over nothing brings it back (late Jitsi events are ignored).
  if (state.endedAt !== null && action.type !== 'retry') return state;
  switch (action.type) {
    case 'scriptLoaded':
      return { ...state, scriptLoaded: true };
    case 'failed':
      return state.joined && action.failure === 'timeout'
        ? state
        : { ...state, failure: action.failure };
    case 'retry':
      return {
        ...initialCallState(),
        unavailable: state.unavailable,
        refused: state.refused,
        audioMuted: state.audioMuted,
        videoMuted: state.videoMuted,
        offline: state.offline,
        connectedAt: state.connectedAt,
        remoteName: state.remoteName,
      };
    case 'joined':
      return { ...state, joined: true, rejoining: false, failure: null };
    case 'left':
      // Jitsi leaves the room by itself when its connection breaks; it then rejoins.
      return state.hangingUp
        ? { ...state, joined: false, endedAt: action.at }
        : { ...state, joined: false, rejoining: true, remotes: [] };
    case 'participantJoined':
      return state.remotes.includes(action.id)
        ? state
        : {
            ...state,
            remotes: [...state.remotes, action.id],
            remoteName: action.name || state.remoteName,
            connectedAt: state.connectedAt ?? action.at,
            remoteLeft: false,
          };
    case 'participantLeft': {
      if (!state.remotes.includes(action.id)) return state;
      const remotes = state.remotes.filter((id) => id !== action.id);
      return { ...state, remotes, remoteLeft: remotes.length === 0 };
    }
    case 'audioMuted':
      return { ...state, audioMuted: action.muted };
    case 'videoMuted':
      return { ...state, videoMuted: action.muted };
    case 'deviceAvailable':
      return action.available
        ? { ...state, unavailable: withoutDevice(state, action.device) }
        : { ...state, unavailable: { ...state.unavailable, [action.device]: true } };
    case 'deviceError':
      return {
        ...state,
        unavailable: { ...state.unavailable, [action.device]: true },
        refused: { ...state.refused, [action.device]: true },
        ...(action.device === 'camera' ? { videoMuted: true } : { audioMuted: true }),
      };
    case 'network':
      return { ...state, offline: !action.online };
    case 'trouble':
      return { ...state, troubleAt: action.at };
    case 'hangup':
      return { ...state, hangingUp: true };
    case 'ended':
      return { ...state, endedAt: action.at, hangingUp: false };
  }
}

export function callPhase(state: CallState): CallPhase {
  if (state.endedAt !== null || state.hangingUp) return 'ended';
  if (state.failure) return 'failed';
  if (state.offline || state.rejoining) return 'reconnecting';
  if (!state.scriptLoaded) return 'loading';
  if (!state.joined) return 'connecting';
  return state.remotes.length > 0 ? 'live' : 'waiting';
}

/** A struggling connection is shown for this long after Jitsi last reported trouble. */
export const CALL_TROUBLE_MS = 15_000;

/**
 * Connection level for the caregiver window. The TV's Jitsi iframe is on another origin, so its
 * statistics are out of reach: the level comes from what the External API and the browser report
 * (network lost, media connection failures, rejoining).
 */
export function callQuality(state: CallState, now: number): CallQuality {
  const phase = callPhase(state);
  if (phase === 'reconnecting' || phase === 'failed') return 'poor';
  if (phase !== 'live' && phase !== 'waiting') return 'unknown';
  if (state.troubleAt !== null && now - state.troubleAt < CALL_TROUBLE_MS) return 'fair';
  return 'good';
}

/** "4:05", "1:02:09". */
export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Initials for the avatar: "Jeanne Martin" → "JM". */
export function initialsOf(name: string, locale?: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => [...word][0]?.toLocaleUpperCase(locale) ?? '')
      .join('') || 'É'
  );
}

/** Jitsi error events that mean the connection itself is in trouble. */
export function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, type } = error as { name?: unknown; type?: unknown };
  return [name, type].some(
    (value) =>
      typeof value === 'string' && /connection|conference\.(left|failed)|network/i.test(value),
  );
}
