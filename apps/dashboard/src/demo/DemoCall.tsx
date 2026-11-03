import { useEffect, useRef, useState } from 'react';

/** Sent by the demo API when the caregiver space starts a call to the resident's TV. */
export const DEMO_CALL_EVENT = 'elise-demo-call';

const copy = {
  fr: {
    title: 'Appel vidéo vers la télévision de Jeanne',
    ringing: 'La télévision de Jeanne sonne…',
    connected: 'Jeanne a décroché',
    you: 'Vous',
    mute: 'Couper le micro',
    unmute: 'Réactiver le micro',
    cameraOff: 'Couper la caméra',
    cameraOn: 'Réactiver la caméra',
    hangUp: 'Raccrocher',
    howTitle: 'Chez vous, ça se passe comment ?',
    how: 'Avec une caméra et un micro branchés sur le boîtier Élise OS, l’appel décroche tout seul sur la télévision de Jeanne : elle n’a ni bouton à trouver ni télécommande à prendre. Elle vous voit et vous entend tout de suite.',
    simulated: 'Ici, l’appel est simulé : aucune image ni aucun son ne quitte votre navigateur.',
  },
  en: {
    title: 'Video call to Jeanne’s TV',
    ringing: 'Jeanne’s TV is ringing…',
    connected: 'Jeanne picked up',
    you: 'You',
    mute: 'Mute microphone',
    unmute: 'Unmute microphone',
    cameraOff: 'Turn camera off',
    cameraOn: 'Turn camera on',
    hangUp: 'Hang up',
    howTitle: 'How does it work at home?',
    how: 'With a camera and a microphone plugged into the Élise OS box, the call is answered automatically on Jeanne’s TV: no button to find, no remote to pick up. She sees and hears you right away.',
    simulated: 'Here the call is simulated: no picture or sound leaves your browser.',
  },
} as const;

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** A pretend call: it rings, Jeanne's TV answers on its own, and the visitor can hang up. */
export function DemoCall({ lang }: { lang: 'fr' | 'en' }) {
  const t = copy[lang];
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const hangUpButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const start = () => {
      setConnected(false);
      setSeconds(0);
      setMuted(false);
      setCameraOff(false);
      setOpen(true);
    };
    window.addEventListener(DEMO_CALL_EVENT, start);
    return () => window.removeEventListener(DEMO_CALL_EVENT, start);
  }, []);

  useEffect(() => {
    if (!open) return;
    hangUpButton.current?.focus();
    const answer = window.setTimeout(() => setConnected(true), 2600);
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.clearTimeout(answer);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !connected) return;
    const tick = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [open, connected]);

  if (!open) return null;
  return (
    <div className="demo-call-backdrop">
      <div className="demo-call" role="dialog" aria-modal="true" aria-labelledby="demo-call-title">
        <header>
          <h2 id="demo-call-title">{t.title}</h2>
          <span className={`demo-call-state ${connected ? 'is-live' : ''}`} role="status">
            {connected ? `${t.connected} · ${clock(seconds)}` : t.ringing}
          </span>
        </header>

        <div className={`demo-call-stage ${connected ? 'is-live' : 'is-ringing'}`}>
          <img src="/welcome-home.jpg" alt="" />
          <span className="demo-call-avatar" aria-hidden="true">
            JM
          </span>
          <strong>Jeanne Martin</strong>
          <span className="demo-call-self" aria-label={t.you}>
            {cameraOff ? '—' : t.you}
          </span>
        </div>

        <div className="demo-call-controls">
          <button type="button" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
            {muted ? t.unmute : t.mute}
          </button>
          <button
            type="button"
            aria-pressed={cameraOff}
            onClick={() => setCameraOff((value) => !value)}
          >
            {cameraOff ? t.cameraOn : t.cameraOff}
          </button>
          <button
            ref={hangUpButton}
            type="button"
            className="demo-call-hangup"
            onClick={() => setOpen(false)}
          >
            {t.hangUp}
          </button>
        </div>

        <aside className="demo-call-how">
          <strong>{t.howTitle}</strong>
          <p>{t.how}</p>
          <small>{t.simulated}</small>
        </aside>
      </div>
    </div>
  );
}
