import { useEffect, useState } from 'react';
import { CallScreen } from '../call/CallScreen';
import type { CallPhase } from '../call/call-state';
import { textBlock } from '../i18n';

/** Sent by the demo API when the caregiver space starts a call to the resident's TV. */
export const DEMO_CALL_EVENT = 'elise-demo-call';

/** Demo timings: the room opens, Jeanne's TV rings and answers on its own. */
const OPEN_MS = 900;
const ANSWER_MS = 2600;
const CLOSE_MS = 2600;

/**
 * A pretend call with the real Élise call screen: same window, same bar, same states as a real
 * call, but no camera, microphone or network is used.
 */
export function DemoCall() {
  const t = textBlock('demoCall.copy');
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);

  useEffect(() => {
    const start = () => {
      setPhase('connecting');
      setConnectedAt(null);
      setEndedAt(null);
      setAudioMuted(false);
      setVideoMuted(false);
      setOpen(true);
    };
    window.addEventListener(DEMO_CALL_EVENT, start);
    return () => window.removeEventListener(DEMO_CALL_EVENT, start);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timers = [
      window.setTimeout(() => setPhase((p) => (p === 'connecting' ? 'waiting' : p)), OPEN_MS),
      window.setTimeout(() => {
        setPhase((p) => (p === 'waiting' ? 'live' : p));
        setConnectedAt((at) => at ?? Date.now());
      }, OPEN_MS + ANSWER_MS),
    ];
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  useEffect(() => {
    if (phase !== 'ended') return;
    const timer = window.setTimeout(() => setOpen(false), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (!open) return null;
  const hangUp = () => {
    setEndedAt(Date.now());
    setPhase('ended');
  };
  return (
    <div className="screen-call-window demo-call-window">
      <div className="screen-call-window__panel">
        <CallScreen
          variant="web"
          peerName="Jeanne Martin"
          phase={phase}
          audioMuted={audioMuted}
          videoMuted={videoMuted}
          unavailable={{}}
          connectedAt={connectedAt}
          endedAt={endedAt}
          quality="good"
          stage={
            <div className="demo-call-picture">
              <img src="/welcome-home.jpg" alt="" />
            </div>
          }
          selfView={<span className="demo-call-self" aria-hidden="true" />}
          onToggleAudio={() => setAudioMuted((value) => !value)}
          onToggleVideo={() => setVideoMuted((value) => !value)}
          onHangup={hangUp}
        />
      </div>
      <aside className="demo-call-how">
        <strong>{t.howTitle}</strong>
        <p>{t.how}</p>
        <small>{t.simulated}</small>
      </aside>
    </div>
  );
}
