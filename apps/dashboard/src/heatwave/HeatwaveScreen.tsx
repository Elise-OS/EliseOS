import type { HeatwaveScreenView } from '@elise/contracts';
import { Check, GlassWater, ThermometerSun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import './heatwave-screen.css';

const POLL_MS = 15_000;

async function screenHeatwaveRequest(
  token: string,
  path = '',
  method = 'GET',
): Promise<HeatwaveScreenView> {
  // The paired TV speaks with its screen token; the preview opened by the family uses its session.
  const response = await fetch(
    token ? `/api/v1/screen-device/heatwave${path}` : `/api/v1/heatwave/screen${path}`,
    { method, headers: token ? { 'x-screen-token': token } : {} },
  );
  if (!response.ok) throw new Error(`heatwave ${response.status}`);
  return (await response.json()) as HeatwaveScreenView;
}

/** Heatwave state of the TV, refreshed every 15 s; the last one is kept while the box is unreachable. */
export function useHeatwaveScreen(token: string) {
  const [view, setView] = useState<HeatwaveScreenView | null>(null);
  const [thanked, setThanked] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setView(await screenHeatwaveRequest(token));
    } catch {
      /* Keep showing the last state. */
    }
  }, [token]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const confirm = useCallback(
    async (id: string) => {
      setThanked(id);
      setView((current) => (current ? { ...current, reminder: null } : current));
      window.setTimeout(() => setThanked((value) => (value === id ? null : value)), 4_000);
      try {
        const response = await fetch(
          token
            ? `/api/v1/screen-device/heatwave/reminders/${encodeURIComponent(id)}/confirm`
            : `/api/v1/heatwave/reminders/${encodeURIComponent(id)}/confirm`,
          { method: 'POST', headers: token ? { 'x-screen-token': token } : {} },
        );
        if (response.ok) setView((await response.json()) as HeatwaveScreenView);
      } catch {
        /* The reminder simply expires on the box; the TV already thanked the resident. */
      }
    },
    [token],
  );
  return { view, thanked, confirm };
}

/** Soft three-note chime, much quieter than the call ringtone. */
export function playHydrationChime(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  let context: AudioContext;
  try {
    context = new window.AudioContext();
  } catch {
    return;
  }
  const play = () => {
    const start = context.currentTime + 0.05;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const at = start + index * 0.38;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(0.16, at + 0.06);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      oscillator.connect(envelope);
      envelope.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.95);
    });
    window.setTimeout(() => void context.close().catch(() => undefined), 2_500);
  };
  if (context.state === 'suspended')
    void context
      .resume()
      .then(play)
      .catch(() => undefined);
  else play();
}

/** Soft amber band at the top of the TV, above the family message. */
export function HeatwaveBanner({ view }: { view: HeatwaveScreenView }) {
  return (
    <section className="tv-heatwave-banner" role="status" aria-live="polite">
      <ThermometerSun aria-hidden="true" />
      <div>
        <p>{t('heatwave.tv.banner')}</p>
        {view.tip && <small>{t(`heatwave.tv.tips.${view.tip}`)}</small>}
      </div>
    </section>
  );
}

/**
 * "Time for a glass of water": a melody, a big "Done" button that the remote button (or OK)
 * presses, and the reminder leaves on its own when its time is over.
 */
export function HydrationReminderOverlay({
  reminder,
  thanked,
  onConfirm,
}: {
  reminder: HeatwaveScreenView['reminder'];
  thanked: boolean;
  onConfirm: (id: string) => void;
}) {
  const [, setTick] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chimed = useRef<string | null>(null);
  const reminderId = reminder?.id ?? null;
  const expiresAt = reminder ? new Date(reminder.expiresAt).getTime() : 0;
  const visible = reminder !== null && expiresAt > Date.now();

  useEffect(() => {
    if (!reminderId || !visible) return;
    if (chimed.current !== reminderId) {
      chimed.current = reminderId;
      playHydrationChime();
    }
    buttonRef.current?.focus();
    // Leave the screen at the end of the reminder even if the box cannot be reached.
    const timer = window.setTimeout(() => setTick((value) => value + 1), expiresAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [reminderId, visible, expiresAt]);

  useEffect(() => {
    if (!reminderId || !visible) return;
    // Captured before the screen's own button handling: while the reminder shows, the remote
    // button means "Done", not "answer" or "sleep".
    const onKey = (event: KeyboardEvent) => {
      if (!['Space', 'F13', 'Enter', 'NumpadEnter'].includes(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onConfirm(reminderId);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [reminderId, visible, onConfirm]);

  if (thanked)
    return (
      <section className="tv-hydration tv-hydration--thanks" role="status" aria-live="polite">
        <span className="tv-hydration__icon">
          <Check aria-hidden="true" />
        </span>
        <h1>{t('heatwave.tv.thanks')}</h1>
      </section>
    );
  if (!reminder || !visible) return null;
  return (
    <section
      className="tv-hydration"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="tv-hydration-title"
    >
      <span className="tv-hydration__icon">
        <GlassWater aria-hidden="true" />
      </span>
      <p className="tv-hydration__eyebrow">{t('heatwave.tv.reminderEyebrow')}</p>
      <h1 id="tv-hydration-title">{t('heatwave.tv.reminderTitle')}</h1>
      <button ref={buttonRef} type="button" onClick={() => onConfirm(reminder.id)}>
        <Check aria-hidden="true" />
        {t('heatwave.tv.reminderDone')}
      </button>
      <p className="tv-hydration__hint">{t('heatwave.tv.reminderHint')}</p>
    </section>
  );
}
