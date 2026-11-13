import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  RotateCcw,
  Video,
  VideoOff,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { dateLocale, t } from '../i18n';
import {
  formatCallDuration,
  initialsOf,
  type CallDevice,
  type CallPhase,
  type CallQuality,
} from './call-state';
import './call.css';

export type CallVariant = 'tv' | 'web';

export interface CallScreenProps {
  variant: CallVariant;
  /** Who is on the other side: "Paul", "Jeanne Martin". */
  peerName: string;
  phase: CallPhase;
  audioMuted: boolean;
  videoMuted: boolean;
  unavailable: Partial<Record<CallDevice, true>>;
  refused?: Partial<Record<CallDevice, true>> | undefined;
  /** The other person was there and dropped. */
  peerLeft?: boolean | undefined;
  connectedAt: number | null;
  endedAt?: number | null | undefined;
  quality?: CallQuality | undefined;
  /** The Jitsi iframe host (or the demo's picture). */
  stage: ReactNode;
  /** Small picture of oneself, shown during the call. */
  selfView?: ReactNode | undefined;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onHangup: () => void;
  onRetry?: (() => void) | undefined;
  fullscreen?: boolean | undefined;
  onToggleFullscreen?: (() => void) | undefined;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function Avatar({ name, pulse = false }: { name: string; pulse?: boolean }) {
  return (
    <span className={`call-avatar${pulse ? ' call-avatar--pulse' : ''}`} aria-hidden="true">
      <span>{initialsOf(name, dateLocale())}</span>
    </span>
  );
}

function QualityMeter({ quality }: { quality: CallQuality }) {
  if (quality === 'unknown') return null;
  const label =
    quality === 'good'
      ? t('callScreen.qualityGood')
      : quality === 'fair'
        ? t('callScreen.qualityWeak')
        : t('callScreen.qualityLost');
  return (
    <span className={`call-quality call-quality--${quality}`} role="status" title={label}>
      {quality === 'poor' ? (
        <WifiOff aria-hidden="true" />
      ) : (
        <span className="call-quality__bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

/** Full-stage message shown instead of the video (never one's own mirror image). */
function Veil({
  phase,
  peerName,
  peerLeft,
  variant,
  duration,
  onRetry,
  onHangup,
}: {
  phase: CallPhase;
  peerName: string;
  peerLeft: boolean;
  variant: CallVariant;
  duration: string | null;
  onRetry: (() => void) | undefined;
  onHangup: () => void;
}) {
  const name = peerName;
  let title: string;
  let hint: string;
  switch (phase) {
    case 'waiting':
      title = peerLeft ? t('callScreen.peerLeft', { name }) : t('callScreen.waitingFor', { name });
      hint = peerLeft ? t('callScreen.peerLeftHint') : t('callScreen.waitingHint', { name });
      break;
    case 'reconnecting':
      title = t('callScreen.reconnecting');
      hint = t('callScreen.reconnectingHint');
      break;
    case 'failed':
      title = t('callScreen.failedTitle');
      hint = t('callScreen.failedHint');
      break;
    case 'ended':
      title = t('callScreen.ended');
      hint = duration
        ? t('callScreen.endedWith', { name, duration })
        : t('callScreen.endedWithShort', { name });
      break;
    default:
      title = t('callScreen.connecting');
      hint = t('callScreen.connectingHint');
  }
  const busy = phase === 'loading' || phase === 'connecting' || phase === 'waiting';
  return (
    <div className={`call-veil call-veil--${phase}`} role="status" aria-live="polite">
      <div className="call-veil__glow" aria-hidden="true" />
      <div className="call-veil__content">
        {phase === 'reconnecting' || phase === 'failed' ? (
          <span className="call-veil__icon" aria-hidden="true">
            <WifiOff />
          </span>
        ) : (
          <Avatar name={name} pulse={busy} />
        )}
        <h2>{title}</h2>
        <p>{hint}</p>
        {phase === 'ended' && (
          <p className="call-veil__note">
            {variant === 'tv' ? t('callScreen.endedBackHome') : t('callScreen.endedClosing')}
          </p>
        )}
        {busy && (
          <span className="call-veil__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        {phase === 'failed' && (
          <div className="call-veil__actions">
            {onRetry && (
              <button type="button" className="call-button call-button--retry" onClick={onRetry}>
                <RotateCcw aria-hidden="true" />
                <span>{t('callScreen.retry')}</span>
              </button>
            )}
            <button type="button" className="call-button call-button--hangup" onClick={onHangup}>
              <PhoneOff aria-hidden="true" />
              <span>{t('callScreen.hangUp')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The single Élise call screen: the other person's video in large, one bar with the controls.
 * Shared by the resident TV, the caregiver web window and the demo.
 */
export function CallScreen({
  variant,
  peerName,
  phase,
  audioMuted,
  videoMuted,
  unavailable,
  refused = {},
  peerLeft = false,
  connectedAt,
  endedAt = null,
  quality,
  stage,
  selfView,
  onToggleAudio,
  onToggleVideo,
  onHangup,
  onRetry,
  fullscreen = false,
  onToggleFullscreen,
}: CallScreenProps) {
  const live = phase === 'live';
  const now = useNow(connectedAt !== null && phase !== 'ended');
  const duration = connectedAt === null ? null : formatCallDuration((endedAt ?? now) - connectedAt);
  const root = useRef<HTMLElement>(null);
  const hangupButton = useRef<HTMLButtonElement>(null);
  const tv = variant === 'tv';

  // The TV remote lands on "Hang up" first; the web window too, so Escape-free users can leave.
  useEffect(() => {
    if (phase === 'failed') {
      root.current
        ?.querySelector<HTMLButtonElement>('.call-veil .call-button')
        ?.focus({ preventScroll: true });
      return;
    }
    if (phase !== 'ended') hangupButton.current?.focus({ preventScroll: true });
  }, [phase === 'failed', phase === 'ended']);
  // A button that becomes disabled (reconnection) drops the focus: give it back to "Hang up".
  useEffect(() => {
    if (!tv || phase === 'failed' || phase === 'ended') return;
    if (!root.current?.contains(document.activeElement))
      hangupButton.current?.focus({ preventScroll: true });
  }, [tv, phase]);

  // Arrow keys move between the buttons (TV remote); focus comes back if it got lost.
  useEffect(() => {
    if (!tv) return;
    const listener = (event: globalThis.KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      if (root.current && !root.current.contains(document.activeElement)) {
        event.preventDefault();
        hangupButton.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [tv]);

  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + step + buttons.length) % buttons.length];
    next?.focus();
  };

  const micMissing = !!unavailable.microphone;
  const cameraMissing = !!unavailable.camera;
  const controlsReady = phase === 'live' || phase === 'waiting';
  const banner =
    live && (refused.camera || refused.microphone)
      ? refused.camera && refused.microphone
        ? t('callScreen.refusedBoth', { name: peerName })
        : refused.camera
          ? t('callScreen.refusedCamera', { name: peerName })
          : t('callScreen.refusedMicrophone', { name: peerName })
      : live && audioMuted && !micMissing
        ? t('callScreen.micMutedBanner', { name: peerName })
        : live && videoMuted && !cameraMissing
          ? t('callScreen.cameraOffBanner', { name: peerName })
          : '';

  const status =
    phase === 'live'
      ? duration
        ? `${t('callScreen.inCall')} · ${duration}`
        : t('callScreen.inCall')
      : phase === 'waiting'
        ? peerLeft
          ? t('callScreen.statusPeerLeft')
          : t('callScreen.statusWaiting')
        : phase === 'reconnecting'
          ? t('callScreen.reconnecting')
          : t('callScreen.connecting');

  return (
    <section
      ref={root}
      className={`call call--${variant} call--${phase}${fullscreen ? ' is-fullscreen' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('callScreen.callWith', { name: peerName })}
    >
      <div className="call__stage">
        <div className={`call__video${live ? ' is-visible' : ''}`}>{stage}</div>
        {live && selfView && !videoMuted && !cameraMissing && (
          <div className="call__self" aria-label={t('callScreen.you')} role="img">
            {selfView}
          </div>
        )}
        {!live && (
          <Veil
            phase={phase}
            peerName={peerName}
            peerLeft={peerLeft}
            variant={variant}
            duration={duration}
            onRetry={onRetry}
            onHangup={onHangup}
          />
        )}
        {banner && (
          <p className="call__banner" role="status">
            {audioMuted && !refused.microphone && !refused.camera ? (
              <MicOff aria-hidden="true" />
            ) : (
              <VideoOff aria-hidden="true" />
            )}
            {banner}
          </p>
        )}
      </div>
      {phase !== 'ended' && phase !== 'failed' && (
        <footer className="call__bar">
          <div className="call__who">
            <Avatar name={peerName} />
            <div>
              <strong>{peerName}</strong>
              <span className={`call__status call__status--${phase}`}>
                <i aria-hidden="true" />
                {status}
              </span>
            </div>
          </div>
          {quality && !tv && <QualityMeter quality={quality} />}
          <div
            className="call__controls"
            role="toolbar"
            aria-label={t('callScreen.controls')}
            onKeyDown={moveFocus}
          >
            <button
              type="button"
              className={`call-button${audioMuted || micMissing ? ' is-off' : ''}`}
              onClick={onToggleAudio}
              disabled={micMissing || !controlsReady}
              aria-pressed={micMissing ? undefined : audioMuted}
              aria-label={
                micMissing
                  ? t('callScreen.micMissing')
                  : audioMuted
                    ? t('callScreen.unmuteMic')
                    : t('callScreen.muteMic')
              }
            >
              {audioMuted || micMissing ? (
                <MicOff aria-hidden="true" />
              ) : (
                <Mic aria-hidden="true" />
              )}
              <span>
                {micMissing
                  ? t('callScreen.micMissing')
                  : audioMuted
                    ? t('callScreen.micMuted')
                    : t('callScreen.mic')}
              </span>
            </button>
            <button
              type="button"
              className={`call-button${videoMuted || cameraMissing ? ' is-off' : ''}`}
              onClick={onToggleVideo}
              disabled={cameraMissing || !controlsReady}
              aria-pressed={cameraMissing ? undefined : videoMuted}
              aria-label={
                cameraMissing
                  ? t('callScreen.cameraMissing')
                  : videoMuted
                    ? t('callScreen.unmuteCamera')
                    : t('callScreen.muteCamera')
              }
            >
              {videoMuted || cameraMissing ? (
                <VideoOff aria-hidden="true" />
              ) : (
                <Video aria-hidden="true" />
              )}
              <span>
                {cameraMissing
                  ? t('callScreen.cameraMissing')
                  : videoMuted
                    ? t('callScreen.cameraOff')
                    : t('callScreen.camera')}
              </span>
            </button>
            {onToggleFullscreen && (
              <button
                type="button"
                className="call-button"
                onClick={onToggleFullscreen}
                aria-pressed={fullscreen}
              >
                {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                <span>
                  {fullscreen ? t('callScreen.exitFullscreen') : t('callScreen.fullscreen')}
                </span>
              </button>
            )}
            <button
              ref={hangupButton}
              type="button"
              className="call-button call-button--hangup"
              onClick={onHangup}
              aria-label={t('callScreen.hangUp')}
            >
              <PhoneOff aria-hidden="true" />
              <span>{t('callScreen.hangUp')}</span>
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
