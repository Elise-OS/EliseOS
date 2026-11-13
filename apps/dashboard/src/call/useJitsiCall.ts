import {
  ELISE_CALL_COMMANDS,
  eliseCallConfig,
  eliseCallUiConfig,
  eliseCallUiInterfaceConfig,
  type ScreenJoin,
} from '@elise/contracts';
import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import {
  callPhase,
  callReducer,
  initialCallState,
  isConnectionError,
  type CallAction,
  type CallFailure,
  type CallState,
} from './call-state';

export type JitsiApi = {
  dispose: () => void;
  addEventListener: (event: string, listener: (payload: unknown) => void) => void;
  executeCommand: (command: string, ...args: unknown[]) => void;
  isAudioMuted?: () => Promise<boolean>;
  isVideoMuted?: () => Promise<boolean>;
  getParticipantsInfo?: () => Array<{ participantId?: string; displayName?: string }>;
  getIFrame?: () => HTMLIFrameElement;
};
type JitsiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiApi;
declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiConstructor;
  }
}

/** Jitsi's script must arrive within this delay, and the room must open within JOIN_TIMEOUT_MS. */
export const SCRIPT_TIMEOUT_MS = 15_000;
export const JOIN_TIMEOUT_MS = 30_000;
/** Jitsi rejoins by itself after a network drop; past this delay Élise offers to try again. */
export const RECONNECT_TIMEOUT_MS = 60_000;
/** A hang-up waits this long for Jitsi to confirm it left the room. */
export const HANGUP_GRACE_MS = 2_000;

let script: Promise<void> | undefined;
function loadExternalApi(origin: string): Promise<void> {
  // One Jitsi server per home: its External API is loaded once.
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (script) return script;
  script = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = `${origin}/external_api.js`;
    element.async = true;
    const timer = window.setTimeout(() => fail(), SCRIPT_TIMEOUT_MS);
    const fail = () => {
      window.clearTimeout(timer);
      element.remove();
      script = undefined;
      reject(new Error('unreachable'));
    };
    element.onload = () => {
      window.clearTimeout(timer);
      if (window.JitsiMeetExternalAPI) resolve();
      else fail();
    };
    element.onerror = fail;
    document.head.append(element);
  });
  return script;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** Translates the External API events of one Jitsi instance into call actions. */
export function wireJitsiEvents(api: JitsiApi, dispatch: (action: CallAction) => void): void {
  const now = () => Date.now();
  api.addEventListener('videoConferenceJoined', () => {
    dispatch({ type: 'joined', at: now() });
    // Mute states and people already in the room, in case their events came before ours.
    void api
      .isAudioMuted?.()
      .then((muted) => dispatch({ type: 'audioMuted', muted }))
      .catch(() => undefined);
    void api
      .isVideoMuted?.()
      .then((muted) => dispatch({ type: 'videoMuted', muted }))
      .catch(() => undefined);
  });
  api.addEventListener('videoConferenceLeft', () => dispatch({ type: 'left', at: now() }));
  api.addEventListener('readyToClose', () => dispatch({ type: 'ended', at: now() }));
  api.addEventListener('participantJoined', (payload) => {
    const { id, displayName } = record(payload);
    if (typeof id === 'string')
      dispatch({
        type: 'participantJoined',
        id,
        name: typeof displayName === 'string' ? displayName : undefined,
        at: now(),
      });
  });
  api.addEventListener('participantLeft', (payload) => {
    const { id } = record(payload);
    if (typeof id === 'string') dispatch({ type: 'participantLeft', id });
  });
  api.addEventListener('audioMuteStatusChanged', (payload) =>
    dispatch({ type: 'audioMuted', muted: !!record(payload).muted }),
  );
  api.addEventListener('videoMuteStatusChanged', (payload) =>
    dispatch({ type: 'videoMuted', muted: !!record(payload).muted }),
  );
  api.addEventListener('audioAvailabilityChanged', (payload) =>
    dispatch({
      type: 'deviceAvailable',
      device: 'microphone',
      available: !!record(payload).available,
    }),
  );
  api.addEventListener('videoAvailabilityChanged', (payload) =>
    dispatch({ type: 'deviceAvailable', device: 'camera', available: !!record(payload).available }),
  );
  api.addEventListener('cameraError', () => dispatch({ type: 'deviceError', device: 'camera' }));
  api.addEventListener('micError', () => dispatch({ type: 'deviceError', device: 'microphone' }));
  api.addEventListener('peerConnectionFailure', () => dispatch({ type: 'trouble', at: now() }));
  api.addEventListener('suspendDetected', () => dispatch({ type: 'trouble', at: now() }));
  api.addEventListener('errorOccurred', (payload) => {
    const error = record(payload);
    if (isConnectionError(error.error ?? error)) dispatch({ type: 'trouble', at: now() });
  });
}

export interface JitsiCallOptions {
  join: ScreenJoin | undefined;
  host: RefObject<HTMLDivElement | null>;
  devices: { camera: boolean; microphone: boolean };
  /** Called once Jitsi has left the room after a hang-up (or right away if it never joined). */
  onHungUp: () => void;
}

export function useJitsiCall({ join, host, devices, onHungUp }: JitsiCallOptions) {
  const [state, dispatch] = useReducer(callReducer, undefined, (): CallState =>
    initialCallState({
      ...devices,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    }),
  );
  const [attempt, setAttempt] = useState(0);
  const api = useRef<JitsiApi | undefined>(undefined);
  const hungUp = useRef(onHungUp);
  hungUp.current = onHungUp;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!join) return;
    let disposed = false;
    const url = new URL(join.url);
    const fail = (failure: CallFailure) => !disposed && dispatch({ type: 'failed', failure });
    const joinTimer = window.setTimeout(() => {
      if (!stateRef.current.joined) fail('timeout');
    }, JOIN_TIMEOUT_MS);
    loadExternalApi(url.origin)
      .then(() => {
        if (disposed || !host.current || !window.JitsiMeetExternalAPI) return;
        dispatch({ type: 'scriptLoaded' });
        host.current.replaceChildren();
        const instance = new window.JitsiMeetExternalAPI(url.host, {
          roomName: join.room,
          jwt: join.jwt,
          parentNode: host.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName: join.name },
          configOverwrite: {
            ...eliseCallConfig,
            ...eliseCallUiConfig,
            startWithAudioMuted: !devices.microphone,
            startWithVideoMuted: !devices.camera,
          },
          interfaceConfigOverwrite: eliseCallUiInterfaceConfig,
        });
        api.current = instance;
        // The TV remote and the keyboard drive Élise's bar, never the Jitsi page.
        const frame = instance.getIFrame?.();
        if (frame) {
          frame.tabIndex = -1;
          frame.setAttribute('aria-hidden', 'true');
          frame.title = '';
        }
        wireJitsiEvents(instance, dispatch);
      })
      .catch(() => fail('unreachable'));
    return () => {
      disposed = true;
      window.clearTimeout(joinTimer);
      api.current?.dispose();
      api.current = undefined;
    };
  }, [join?.url, join?.room, join?.jwt, join?.name, devices.camera, devices.microphone, attempt]);

  // Network drops reported by the browser.
  useEffect(() => {
    const online = () => dispatch({ type: 'network', online: true });
    const offline = () => dispatch({ type: 'network', online: false });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // A reconnection that never ends becomes a clear failure with "Try again".
  const phase = callPhase(state);
  useEffect(() => {
    if (phase !== 'reconnecting') return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'failed', failure: 'timeout' }),
      RECONNECT_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Once hung up, hand over to the caller (end of the Élise call) exactly once.
  const handedOver = useRef(false);
  useEffect(() => {
    if (state.endedAt === null || handedOver.current) return;
    handedOver.current = true;
    hungUp.current();
  }, [state.endedAt]);

  // An ended call never stays in the room while "Call ended" is shown: a room still opening
  // would otherwise join with the camera and microphone. A joined one gets time to leave.
  useEffect(() => {
    if (state.endedAt === null) return;
    const timer = window.setTimeout(
      () => {
        api.current?.dispose();
        api.current = undefined;
      },
      stateRef.current.joined ? HANGUP_GRACE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [state.endedAt]);

  const hangupTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hangupTimer.current), []);

  const toggleAudio = useCallback(() => {
    if (stateRef.current.unavailable.microphone || !stateRef.current.joined) return;
    api.current?.executeCommand(ELISE_CALL_COMMANDS.toggleAudio);
  }, []);
  const toggleVideo = useCallback(() => {
    if (stateRef.current.unavailable.camera || !stateRef.current.joined) return;
    api.current?.executeCommand(ELISE_CALL_COMMANDS.toggleVideo);
  }, []);
  const hangup = useCallback(() => {
    const current = stateRef.current;
    if (current.hangingUp || current.endedAt !== null) return;
    if (!api.current || !current.joined) {
      dispatch({ type: 'ended', at: Date.now() });
      return;
    }
    dispatch({ type: 'hangup' });
    api.current.executeCommand(ELISE_CALL_COMMANDS.hangup);
    // Jitsi normally answers with videoConferenceLeft/readyToClose; never wait for it forever.
    hangupTimer.current = window.setTimeout(
      () => dispatch({ type: 'ended', at: Date.now() }),
      HANGUP_GRACE_MS,
    );
  }, []);
  const retry = useCallback(() => {
    api.current?.dispose();
    api.current = undefined;
    dispatch({ type: 'retry' });
    setAttempt((value) => value + 1);
  }, []);
  /** The call ended elsewhere (the other person hung up): leave the room quietly. */
  const finish = useCallback(() => {
    if (stateRef.current.endedAt !== null) return;
    handedOver.current = true;
    api.current?.executeCommand(ELISE_CALL_COMMANDS.hangup);
    dispatch({ type: 'ended', at: Date.now() });
  }, []);

  return { state, phase, toggleAudio, toggleVideo, hangup, retry, finish };
}
