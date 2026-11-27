import {
  HEATWAVE_REGISTRY_URL,
  type HeatwaveLevel,
  type HeatwaveSettings,
  type HeatwaveStatus,
  type HeatwaveTimelineState,
} from '@elise/contracts';
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  CloudSun,
  ExternalLink,
  GlassWater,
  House,
  Landmark,
  PowerOff,
  ShieldCheck,
  SlidersHorizontal,
  ThermometerSun,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { subscribeRealtime } from '../realtime';
import { HeatwaveSettingsDialog } from './HeatwaveSettingsDialog';
import {
  celsius,
  heatwaveReason,
  heatwaveSteps,
  heatwaveToday,
  type HeatwaveStepKey,
} from './heatwave-text';
import './heatwave.css';

export class HeatwaveRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`heatwave ${status}`);
  }
}

export async function heatwaveRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/heatwave${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new HeatwaveRequestError(response.status);
  return (await response.json()) as T;
}

/** A box too old to know the heatwave mode answers 404 or something else: the card hides. */
export function isHeatwaveStatus(value: unknown): value is HeatwaveStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<HeatwaveStatus>;
  return (
    typeof status.active === 'boolean' &&
    !!status.settings &&
    !!status.indoor &&
    !!status.forecast &&
    !!status.reminders &&
    !!status.registry
  );
}

async function statusRequest(path: string, method = 'GET', body?: unknown) {
  const value = await heatwaveRequest<unknown>(path, method, body);
  if (!isHeatwaveStatus(value)) throw new HeatwaveRequestError(404);
  return value;
}

const stepIcons: Record<HeatwaveStepKey, LucideIcon> = {
  detect: ThermometerSun,
  tv: Tv,
  family: Bell,
  stop: PowerOff,
};

type Tone = 'active' | 'paused' | 'idle';

/** Frame of the card, in the style of the other cards of the Settings page. */
function SettingsFrame({
  tone,
  pill,
  reason,
  children,
}: {
  tone: Tone;
  pill?: ReactNode;
  reason: string;
  children: ReactNode;
}) {
  return (
    <details
      className={`elise-card settings-section-card settings-disclosure heatwave-settings-card is-${tone}`}
      open
    >
      <summary className="settings-section-heading heatwave-hero">
        <span className="heatwave-hero__badge" aria-hidden="true">
          <ThermometerSun />
        </span>
        <div className="heatwave-hero__copy">
          <span className="eyebrow">{t('heatwave.card.settingsEyebrow')}</span>
          <div className="heatwave-hero__title">
            <h2 id="heatwave-card-title">{t('heatwave.card.settingsTitle')}</h2>
            {pill}
          </div>
          <p className="heatwave-hero__reason">{reason}</p>
        </div>
        <span className="settings-disclosure-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </summary>
      {children}
    </details>
  );
}

/** "29,4 °C" with a large figure and a small unit. */
function Degrees({ value }: { value: number }) {
  return (
    <span className="heatwave-figure">
      {celsius(value)}
      <small>°C</small>
    </span>
  );
}

function LevelChip({ level }: { level: HeatwaveLevel | null }) {
  if (!level) return null;
  return (
    <span className={`heatwave-level heatwave-level--${level}`}>
      {t(`heatwave.level.${level}`)}
    </span>
  );
}

const timelineLabel = (state: HeatwaveTimelineState): string =>
  ({
    shown: t('heatwave.today.shown'),
    past: t('heatwave.today.past'),
    next: t('heatwave.today.next'),
    later: t('heatwave.today.later'),
  })[state];

/** The reminders of the day from the first to the last hour: purely informative. */
function ReminderTimeline({
  settings,
  timeline,
}: {
  settings: HeatwaveSettings;
  timeline: ReturnType<typeof heatwaveToday>['reminders']['timeline'];
}) {
  const start = settings.reminders.startHour * 60;
  const span = Math.max(60, settings.reminders.endHour * 60 - start);
  const hour = (minute: number) => t('heatwave.today.hour', { hour: Math.floor(minute / 60) });
  const label = t('heatwave.today.timeline', {
    start: settings.reminders.startHour,
    end: settings.reminders.endHour,
  });
  return (
    <figure className="heatwave-timeline" aria-label={label}>
      <div className="heatwave-timeline__track">
        <span className="heatwave-timeline__line" aria-hidden="true" />
        <ol>
          {timeline.map(({ minute, state }) => (
            <li
              key={minute}
              className={`heatwave-timeline__dot is-${state}`}
              style={{ left: `${((minute - start) / span) * 100}%` }}
            >
              <span className="sr-only">{`${hour(minute)} · ${timelineLabel(state)}`}</span>
              {state === 'next' && (
                <span className="heatwave-timeline__tag" aria-hidden="true">
                  {hour(minute)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <figcaption>
        <span>{hour(start)}</span>
        <span className="heatwave-timeline__legend" aria-hidden="true">
          <i className="is-shown" />
          {t('heatwave.today.shown')}
          <i className="is-next" />
          {t('heatwave.today.next')}
          <i className="is-later" />
          {t('heatwave.today.later')}
        </span>
        <span>{hour(settings.reminders.endHour * 60)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * « Canicule » card of the Settings page: the state of the mode and why, today's figures on a
 * calm heat scale, the reminders of the day, how the mode works in four steps written from the
 * saved settings, the town hall register and the medical notice. Owners and administrators open
 * the settings window; every member reads the card.
 */
export function HeatwaveCard() {
  const [status, setStatus] = useState<HeatwaveStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await statusRequest(''));
      setFailed(false);
      setUnsupported(false);
    } catch (error) {
      if (error instanceof HeatwaveRequestError && error.status === 404) setUnsupported(true);
      else setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const stop = subscribeRealtime((data) => {
      try {
        if ((JSON.parse(data) as { type?: string }).type === 'heatwave') void load();
      } catch {
        /* A heartbeat or another event: nothing to do. */
      }
    });
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, [load]);

  const act = async (work: () => Promise<HeatwaveStatus>) => {
    setBusy(true);
    setActionError('');
    try {
      setStatus(await work());
    } catch {
      setActionError(t('heatwave.card.actionError'));
    } finally {
      setBusy(false);
    }
  };

  if (unsupported && !status) return null;
  if (!status)
    return (
      <SettingsFrame tone="idle" reason={t('heatwave.card.settingsIntro')}>
        <div className="heatwave-card is-loading" aria-busy={!failed} aria-live="polite">
          {failed ? (
            <p role="status">
              {t('heatwave.card.error')}{' '}
              <button type="button" className="heatwave-link" onClick={() => void load()}>
                {t('heatwave.card.retry')}
              </button>
            </p>
          ) : (
            <p>{t('heatwave.card.loading')}</p>
          )}
        </div>
      </SettingsFrame>
    );

  const paused = !status.active && status.manual === 'OFF';
  const tone: Tone = status.active ? 'active' : paused ? 'paused' : 'idle';
  const stateLabel = status.active
    ? t('heatwave.card.statusOn')
    : paused
      ? t('heatwave.card.statusPaused')
      : t('heatwave.card.statusOff');
  const today = heatwaveToday(status);
  const gauge = today.indoor.gauge;

  return (
    <SettingsFrame
      tone={tone}
      reason={heatwaveReason(status)}
      pill={
        <span className={`heatwave-pill is-${tone}`}>
          <span className="heatwave-pill__dot" aria-hidden="true" />
          {stateLabel}
        </span>
      }
    >
      <section className={`heatwave-card is-${tone}`} aria-labelledby="heatwave-card-title">
        {(status.canToggle || status.canManage) && (
          <div className="heatwave-card__actions">
            {status.canToggle && (
              <button
                type="button"
                className={`heatwave-button ${status.active ? '' : 'heatwave-button--primary'}`}
                disabled={busy}
                onClick={() =>
                  void act(() => statusRequest('/manual', 'POST', { active: !status.active }))
                }
              >
                {status.active ? t('heatwave.card.deactivate') : t('heatwave.card.activate')}
              </button>
            )}
            {status.canManage && (
              <button
                type="button"
                className="heatwave-button heatwave-button--quiet"
                onClick={() => setSettingsOpen(true)}
              >
                <SlidersHorizontal aria-hidden="true" />
                {t('heatwave.card.settings')}
              </button>
            )}
          </div>
        )}
        {actionError && (
          <p className="heatwave-card__error" role="alert">
            <AlertTriangle aria-hidden="true" />
            {actionError}
          </p>
        )}

        <h3 className="heatwave-card__heading">{t('heatwave.card.todayTitle')}</h3>
        <div className="heatwave-tiles">
          <article className={`heatwave-tile heatwave-tile--${today.indoor.level ?? 'none'}`}>
            <header>
              <span className="heatwave-tile__icon">
                <House aria-hidden="true" />
              </span>
              <h4>{t('heatwave.today.indoorTitle')}</h4>
              <LevelChip level={today.indoor.level} />
            </header>
            {today.indoor.value !== null && <Degrees value={today.indoor.value} />}
            <p>{today.indoor.caption}</p>
            {gauge && (
              <div
                className="heatwave-gauge"
                role="img"
                aria-label={t('heatwave.today.gauge', {
                  min: gauge.min,
                  max: gauge.max,
                  trigger: celsius(status.settings.indoorTrigger.celsius),
                  alert: celsius(
                    status.settings.alert.enabled
                      ? status.settings.alert.celsius
                      : status.settings.indoorTrigger.celsius + 3,
                  ),
                })}
              >
                <span className="heatwave-gauge__fill" style={{ width: `${gauge.value * 100}%` }} />
                <span
                  className="heatwave-gauge__mark"
                  style={{ left: `${gauge.trigger * 100}%` }}
                />
                <span
                  className="heatwave-gauge__mark is-alert"
                  style={{ left: `${gauge.alert * 100}%` }}
                />
              </div>
            )}
          </article>
          <article className={`heatwave-tile heatwave-tile--${today.forecast.level ?? 'none'}`}>
            <header>
              <span className="heatwave-tile__icon">
                <CloudSun aria-hidden="true" />
              </span>
              <h4>{today.forecast.title}</h4>
              <LevelChip level={today.forecast.level} />
            </header>
            {today.forecast.value !== null && <Degrees value={today.forecast.value} />}
            <p>{today.forecast.caption}</p>
          </article>
          <article className="heatwave-tile heatwave-tile--reminders">
            <header>
              <span className="heatwave-tile__icon">
                <GlassWater aria-hidden="true" />
              </span>
              <h4>{t('heatwave.today.remindersTitle')}</h4>
              {today.reminders.next && (
                <span className="heatwave-tile__next">{today.reminders.next}</span>
              )}
            </header>
            <div className="heatwave-tile__row">
              {today.reminders.figure !== null && (
                <span className="heatwave-figure">{today.reminders.figure}</span>
              )}
              <p>{today.reminders.caption}</p>
            </div>
            {today.reminders.enabled && (
              <ReminderTimeline settings={status.settings} timeline={today.reminders.timeline} />
            )}
          </article>
        </div>

        <h3 className="heatwave-card__heading">{t('heatwave.how.title')}</h3>
        <ol className="heatwave-steps">
          {heatwaveSteps(status).map((step, index) => {
            const Icon = stepIcons[step.key];
            return (
              <li key={step.key} className={`heatwave-step heatwave-step--${step.key}`}>
                <span className="heatwave-step__icon" aria-hidden="true">
                  <Icon />
                  <b>{index + 1}</b>
                </span>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </li>
            );
          })}
        </ol>

        <div className="heatwave-callouts">
          <aside
            className={`heatwave-callout heatwave-callout--registry ${status.registry.due ? 'is-due' : ''}`}
            aria-labelledby="heatwave-registry-title"
          >
            <span className="heatwave-callout__icon" aria-hidden="true">
              <Landmark />
            </span>
            <div>
              <div className="heatwave-callout__title">
                <strong id="heatwave-registry-title">{t('heatwave.registry.title')}</strong>
                {status.registry.due && (
                  <span className="heatwave-callout__badge">
                    {t('heatwave.callout.registryDue')}
                  </span>
                )}
              </div>
              <p>{t('heatwave.registry.text')}</p>
              <div className="heatwave-callout__actions">
                <a href={HEATWAVE_REGISTRY_URL} target="_blank" rel="noreferrer">
                  {t('heatwave.registry.link')}
                  <ExternalLink aria-hidden="true" />
                </a>
                {status.registry.due && status.canToggle && (
                  <button
                    type="button"
                    className="heatwave-link"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        statusRequest('/registry', 'POST', { year: status.registry.year }),
                      )
                    }
                  >
                    {t('heatwave.registry.done')}
                  </button>
                )}
              </div>
            </div>
          </aside>
          <aside
            className="heatwave-callout heatwave-callout--medical"
            aria-labelledby="heatwave-medical-title"
          >
            <span className="heatwave-callout__icon" aria-hidden="true">
              <ShieldCheck />
            </span>
            <div>
              <div className="heatwave-callout__title">
                <strong id="heatwave-medical-title">{t('heatwave.how.medicalTitle')}</strong>
              </div>
              <p>{t('heatwave.notMedical')}</p>
            </div>
          </aside>
        </div>
        {!status.canManage && <p className="heatwave-card__note">{t('heatwave.how.readOnly')}</p>}
      </section>
      {settingsOpen && (
        <HeatwaveSettingsDialog
          settings={status.settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async (settings: HeatwaveSettings) => {
            const next = await statusRequest('/settings', 'PUT', settings);
            setStatus(next);
            setSettingsOpen(false);
          }}
        />
      )}
    </SettingsFrame>
  );
}
