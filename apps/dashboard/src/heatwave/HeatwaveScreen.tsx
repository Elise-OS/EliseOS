import type { HeatwaveScreenView } from '@elise/contracts';
import { ThermometerSun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '../i18n';
import './heatwave-screen.css';

const POLL_MS = 15_000;

async function screenHeatwaveRequest(token: string): Promise<HeatwaveScreenView> {
  // The paired TV speaks with its screen token; the preview opened by the family uses its session.
  const response = await fetch(
    token ? '/api/v1/screen-device/heatwave' : '/api/v1/heatwave/screen',
    { headers: token ? { 'x-screen-token': token } : {} },
  );
  if (!response.ok) throw new Error(`heatwave ${response.status}`);
  return (await response.json()) as HeatwaveScreenView;
}

/** Heatwave state of the TV, refreshed every 15 s; the last one is kept while the box is unreachable. */
export function useHeatwaveScreen(token: string) {
  const [view, setView] = useState<HeatwaveScreenView | null>(null);
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
  return view;
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
      <span className="tv-heatwave-banner__icon" aria-hidden="true">
        <ThermometerSun />
      </span>
      <div className="tv-heatwave-banner__copy">
        <p>{t('heatwave.tv.banner')}</p>
        {view.tip && <small>{t(`heatwave.tv.tips.${view.tip}`)}</small>}
      </div>
    </section>
  );
}

/** A glass of fresh water, drawn for the TV: calm, friendly, readable from the sofa. */
function GlassIllustration() {
  return (
    <svg className="tv-hydration__glass" viewBox="0 0 120 140" aria-hidden="true">
      <defs>
        <linearGradient id="tv-hydration-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#9fd0e6" />
          <stop offset="1" stopColor="#5aa3c4" />
        </linearGradient>
        <clipPath id="tv-hydration-inside">
          <path d="M26 22h68l-8 100a8 8 0 0 1-8 7H42a8 8 0 0 1-8-7z" />
        </clipPath>
      </defs>
      <g clipPath="url(#tv-hydration-inside)">
        <path
          className="tv-hydration__water"
          d="M0 62c14-7 26-7 40 0s26 7 40 0 26-7 40 0v80H0z"
          fill="url(#tv-hydration-water)"
        />
        <circle cx="52" cy="96" r="4" fill="#fff" opacity="0.55" />
        <circle cx="68" cy="108" r="3" fill="#fff" opacity="0.45" />
        <circle cx="60" cy="80" r="2.5" fill="#fff" opacity="0.5" />
      </g>
      <path
        d="M26 22h68l-8 100a8 8 0 0 1-8 7H42a8 8 0 0 1-8-7z"
        fill="none"
        stroke="#376884"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M38 34l4 74" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

const RING_RADIUS = 66;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
/** How long the reminder takes to fade in and out. */
const FADE_MS = 700;

/**
 * "Time for a glass of water": a soft chime and a message, nothing else. The resident has nothing
 * to press: no button, no key is listened to, nothing takes the focus. A thin ring around the
 * glass shows that the message leaves by itself, and it fades away at the end of its time, even
 * if the box cannot be reached.
 */
export function HydrationReminderOverlay({
  reminder,
}: {
  reminder: HeatwaveScreenView['reminder'];
}) {
  const [, setTick] = useState(0);
  const chimed = useRef<string | null>(null);
  const reminderId = reminder?.id ?? null;
  const startsAt = reminder ? new Date(reminder.scheduledFor).getTime() : 0;
  const expiresAt = reminder ? new Date(reminder.expiresAt).getTime() : 0;
  const now = Date.now();
  const visible = reminder !== null && expiresAt > now;
  const leaving = visible && expiresAt - now <= FADE_MS;

  useEffect(() => {
    if (!reminderId || !visible) return;
    if (chimed.current !== reminderId) {
      chimed.current = reminderId;
      playHydrationChime();
    }
    // One re-render when the fade-out starts, one when the reminder is over.
    const timers = [expiresAt - FADE_MS, expiresAt]
      .map((at) => at - Date.now())
      .filter((delay) => delay > 0)
      .map((delay) => window.setTimeout(() => setTick((value) => value + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reminderId, visible, expiresAt]);

  if (!reminder || !visible) return null;
  const total = Math.max(1, expiresAt - startsAt);
  const elapsed = Math.min(1, Math.max(0, (now - startsAt) / total));
  return (
    <section
      className={`tv-hydration ${leaving ? 'is-leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="tv-hydration__visual">
        <svg className="tv-hydration__ring" viewBox="0 0 150 150" aria-hidden="true">
          <circle cx="75" cy="75" r={RING_RADIUS} className="tv-hydration__ring-track" />
          <circle
            cx="75"
            cy="75"
            r={RING_RADIUS}
            className="tv-hydration__ring-time"
            style={
              {
                '--ring-length': RING_LENGTH,
                '--ring-from': RING_LENGTH * elapsed,
                strokeDasharray: RING_LENGTH,
                strokeDashoffset: RING_LENGTH * elapsed,
                animationDuration: `${Math.max(0, expiresAt - now)}ms`,
              } as CSSProperties
            }
          />
        </svg>
        <GlassIllustration />
      </span>
      <p className="tv-hydration__eyebrow">{t('heatwave.tv.reminderEyebrow')}</p>
      <h1>{t('heatwave.tv.reminderTitle')}</h1>
      <p className="tv-hydration__text">{t('heatwave.tv.reminderText')}</p>
      <p className="tv-hydration__fades">{t('heatwave.tv.reminderFades')}</p>
    </section>
  );
}
