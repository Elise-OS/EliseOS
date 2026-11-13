import type { ScreenJoin } from '@elise/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallScreen, type CallVariant } from './CallScreen';
import { callQuality } from './call-state';
import { useJitsiCall } from './useJitsiCall';

/**
 * Safari and iOS hand the camera to a single page at a time: a second capture next to Jitsi's
 * would freeze the call picture there, so they get no self view.
 */
const sharesCamera = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  !/^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(navigator.userAgent);

/**
 * Small picture of oneself. Jitsi's own thumbnail lives inside its (cross-origin) iframe and
 * cannot be styled, so Élise shows the camera itself, only while it is on: Chromium shares the
 * device already opened by Jitsi, at a small size.
 */
function SelfView({ active }: { active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active || !sharesCamera()) return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 15 } },
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video.current) video.current.srcObject = media;
      })
      .catch(() => setReady(false));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      setReady(false);
    };
  }, [active]);
  return (
    <video
      ref={video}
      className={ready ? 'is-ready' : undefined}
      autoPlay
      muted
      playsInline
      onPlaying={() => setReady(true)}
    />
  );
}

export interface JitsiCallProps {
  variant: CallVariant;
  /** Undefined while the Élise API prepares the room. */
  join: ScreenJoin | undefined;
  peerName: string;
  devices?: { camera: boolean; microphone: boolean };
  /** The Élise call is over (hung up elsewhere): show "Call ended" and leave the room. */
  ended?: boolean;
  /** The room could not be prepared by the Élise API. */
  joinFailed?: boolean;
  onRetryJoin?: () => void;
  /** Ends the Élise call; called once Jitsi has left the room. */
  onHangup: () => void;
  selfView?: boolean;
}

/** The Élise call screen driving a Jitsi room through its External API. */
export function JitsiCall({
  variant,
  join,
  peerName,
  devices = { camera: true, microphone: true },
  ended = false,
  joinFailed = false,
  onRetryJoin,
  onHangup,
  selfView = true,
}: JitsiCallProps) {
  const host = useRef<HTMLDivElement>(null);
  const call = useJitsiCall({ join, host, devices, onHungUp: onHangup });
  const { finish } = call;
  useEffect(() => {
    if (ended) finish();
  }, [ended, finish]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (variant !== 'web' || call.state.troubleAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [variant, call.state.troubleAt]);

  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const target = host.current?.closest<HTMLElement>('.call');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void target?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const phase = joinFailed && call.phase !== 'ended' ? 'failed' : call.phase;
  const retry = joinFailed ? onRetryJoin : call.retry;
  return (
    <CallScreen
      variant={variant}
      peerName={peerName}
      phase={phase}
      audioMuted={call.state.audioMuted}
      videoMuted={call.state.videoMuted}
      unavailable={call.state.unavailable}
      refused={call.state.refused}
      peerLeft={call.state.remoteLeft}
      connectedAt={call.state.connectedAt}
      endedAt={call.state.endedAt}
      quality={variant === 'web' ? callQuality(call.state, now) : undefined}
      stage={<div ref={host} className="call__jitsi" />}
      selfView={
        selfView && devices.camera ? (
          <SelfView active={phase === 'live' && !call.state.videoMuted} />
        ) : undefined
      }
      onToggleAudio={call.toggleAudio}
      onToggleVideo={call.toggleVideo}
      onHangup={call.hangup}
      onRetry={retry}
      fullscreen={fullscreen}
      onToggleFullscreen={variant === 'web' ? toggleFullscreen : undefined}
    />
  );
}
