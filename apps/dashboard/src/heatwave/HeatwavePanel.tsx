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
  CirclePause,
  Clock3,
  CloudSun,
  ExternalLink,
  GlassWater,
  Hand,
  House,
  Landmark,
  Lightbulb,
  LoaderCircle,
  PowerOff,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  ThermometerSnowflake,
  ThermometerSun,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { subscribeRealtime } from '../realtime';
import { HeatwaveSettingsDialog } from './HeatwaveSettingsDialog';
import {
  celsius,
  heatwaveChips,
  heatwaveReason,
  heatwaveSince,
  heatwaveStateTitle,
  heatwaveSteps,
  heatwaveThresholds,
  heatwaveToday,
  heatwaveTone,
  type HeatwaveChipKey,
  type HeatwaveStepKey,
  type HeatwaveThresholdKey,
  type HeatwaveTone,
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

/** A box too old to know the heatwave mode answers 404 or something else. */
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
const chipIcons: Record<HeatwaveChipKey, LucideIcon> = {
  banner: Tv,
  reminders: GlassWater,
  tips: Lightbulb,
  family: Bell,
  indoor: House,
  forecast: CloudSun,
  manual: Hand,
  rearm: RotateCcw,
};
const thresholdIcons: Record<HeatwaveThresholdKey, LucideIcon> = {
  indoor: House,
  forecast: CloudSun,
  stop: ThermometerSnowflake,
  reminders: GlassWater,
  tips: Lightbulb,
  alert: Bell,
};
const verdictIcons: Record<HeatwaveTone, LucideIcon> = {
  active: Sun,
  paused: CirclePause,
  idle: ThermometerSun,
};

/** Title block of the tab, in the family of the « Santé de la box » and Zigbee key tabs. */
function Intro() {
  return (
    <header className="heatwave-intro">
      <span className="heatwave-intro__icon" aria-hidden="true">
        <ThermometerSun />
      </span>
      <div>
        <span className="eyebrow">{t('heatwave.card.settingsEyebrow')}</span>
        <h2 id="heatwave-panel-title">{t('heatwave.card.settingsTitle')}</h2>
        <p>{t('heatwave.card.settingsIntro')}</p>
      </div>
    </header>
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
  // Every hour is written under its dot while they fit; otherwise only the first and last.
  const hours = timeline.length <= 8;
  const position = (minute: number) => `${((minute - start) / span) * 100}%`;
  const reached = timeline.filter(({ state }) => state === 'shown' || state === 'past').at(-1);
  return (
    <figure
      className={`heatwave-timeline${hours ? ' has-hours' : ''}${
        timeline.some(({ state }) => state === 'next') ? ' has-next' : ''
      }`}
      aria-label={label}
    >
      <div className="heatwave-timeline__track">
        <span className="heatwave-timeline__line" aria-hidden="true" />
        {reached && (
          <span
            className="heatwave-timeline__progress"
            aria-hidden="true"
            style={{ width: position(reached.minute) }}
          />
        )}
        <ol>
          {timeline.map(({ minute, state }) => (
            <li
              key={minute}
              className={`heatwave-timeline__dot is-${state}`}
              style={{ left: position(minute) }}
            >
              <span className="sr-only">{`${hour(minute)} · ${timelineLabel(state)}`}</span>
              {state === 'next' && (
                <span className="heatwave-timeline__tag" aria-hidden="true">
                  {t('heatwave.today.next')}
                </span>
              )}
              {hours && (
                <span className="heatwave-timeline__hour" aria-hidden="true">
                  {hour(minute)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <figcaption>
        {!hours && <span>{hour(start)}</span>}
        <span className="heatwave-timeline__legend" aria-hidden="true">
          <i className="is-shown" />
          {t('heatwave.today.shown')}
          <i className="is-next" />
          {t('heatwave.today.next')}
          <i className="is-later" />
          {t('heatwave.today.later')}
        </span>
        {!hours && <span>{hour(settings.reminders.endHour * 60)}</span>}
      </figcaption>
    </figure>
  );
}

function Loading({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="heatwave-verdict is-idle heatwave-verdict--loading" aria-live="polite">
      <span className="heatwave-verdict__icon" aria-hidden="true">
        {failed ? <AlertTriangle /> : <LoaderCircle className="heatwave-spin" />}
      </span>
      <div className="heatwave-verdict__copy">
        {failed ? (
          <p role="status" className="heatwave-verdict__reason">
            {t('heatwave.card.error')}{' '}
            <button type="button" className="heatwave-link" onClick={onRetry}>
              {t('heatwave.card.retry')}
            </button>
          </p>
        ) : (
          <p className="heatwave-verdict__reason" aria-busy="true">
            {t('heatwave.card.loading')}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * « Canicule » tab of the Settings page: a strong state banner (amber when on, calm otherwise)
 * with the reason in plain words and what Élise is doing, today's figures and the reminders of
 * the day on a timeline, how the mode works in four illustrated steps, the saved thresholds, the
 * town hall register and a discreet medical notice. Every member reads it; owners and
 * administrators turn the mode on or off and open the settings window.
 */
export function HeatwavePanel() {
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

  if (unsupported && !status)
    return (
      <section className="heatwave-panel is-idle" aria-labelledby="heatwave-panel-title">
        <Intro />
        <div className="heatwave-empty" role="status">
          <span className="heatwave-empty__icon" aria-hidden="true">
            <ThermometerSun />
          </span>
          <div>
            <strong>{t('heatwave.panel.unsupportedTitle')}</strong>
            <p>{t('heatwave.panel.unsupported')}</p>
          </div>
        </div>
      </section>
    );
  if (!status)
    return (
      <section className="heatwave-panel is-idle" aria-labelledby="heatwave-panel-title">
        <Intro />
        <Loading failed={failed} onRetry={() => void load()} />
      </section>
    );

  const tone = heatwaveTone(status);
  const stateLabel =
    tone === 'active'
      ? t('heatwave.card.statusOn')
      : tone === 'paused'
        ? t('heatwave.card.statusPaused')
        : t('heatwave.card.statusOff');
  const today = heatwaveToday(status);
  const gauge = today.indoor.gauge;
  const since = heatwaveSince(status);
  const VerdictIcon = verdictIcons[tone];

  return (
    <section className={`heatwave-panel is-${tone}`} aria-labelledby="heatwave-panel-title">
      <Intro />

      <div className={`heatwave-verdict is-${tone}`}>
        <span className="heatwave-verdict__icon" aria-hidden="true">
          <VerdictIcon />
        </span>
        <div className="heatwave-verdict__copy" role="status" aria-live="polite">
          <span className={`heatwave-pill is-${tone}`}>
            <span className="heatwave-pill__dot" aria-hidden="true" />
            {stateLabel}
          </span>
          <h3>{heatwaveStateTitle(status)}</h3>
          <p className="heatwave-verdict__reason">{heatwaveReason(status)}</p>
          {since && (
            <p className="heatwave-verdict__meta">
              <Clock3 aria-hidden="true" />
              {since}
            </p>
          )}
          <ul className="heatwave-chips" aria-label={t('heatwave.panel.nowTitle')}>
            {heatwaveChips(status).map((chip) => {
              const Icon = chipIcons[chip.key];
              return (
                <li key={chip.key}>
                  <Icon aria-hidden="true" />
                  {chip.text}
                </li>
              );
            })}
          </ul>
        </div>
        {(status.canToggle || status.canManage) && (
          <div className="heatwave-verdict__actions">
            {status.canToggle && (
              <button
                type="button"
                className={`heatwave-button ${status.active ? '' : 'heatwave-button--primary'}`}
                disabled={busy}
                onClick={() =>
                  void act(() => statusRequest('/manual', 'POST', { active: !status.active }))
                }
              >
                {busy ? (
                  <LoaderCircle className="heatwave-spin" aria-hidden="true" />
                ) : status.active ? (
                  <PowerOff aria-hidden="true" />
                ) : (
                  <Sun aria-hidden="true" />
                )}
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
                {t('heatwave.panel.edit')}
              </button>
            )}
          </div>
        )}
      </div>
      {actionError && (
        <p className="heatwave-panel__error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </p>
      )}

      <section className="heatwave-block" aria-labelledby="heatwave-today-title">
        <h3 className="heatwave-block__title" id="heatwave-today-title">
          {t('heatwave.card.todayTitle')}
        </h3>
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
      </section>

      <div className="heatwave-columns">
        <section className="heatwave-block heatwave-how" aria-labelledby="heatwave-how-title">
          <h3 className="heatwave-block__title" id="heatwave-how-title">
            {t('heatwave.how.title')}
          </h3>
          <p className="heatwave-block__intro">{t('heatwave.panel.howIntro')}</p>
          <ol className="heatwave-steps">
            {heatwaveSteps(status).map((step, index) => {
              const Icon = stepIcons[step.key];
              return (
                <li key={step.key} className={`heatwave-step heatwave-step--${step.key}`}>
                  <span className="heatwave-step__icon" aria-hidden="true">
                    <Icon />
                    <b>{index + 1}</b>
                  </span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="heatwave-side">
          <section className="heatwave-thresholds" aria-labelledby="heatwave-thresholds-title">
            <header>
              <span className="heatwave-thresholds__icon" aria-hidden="true">
                <SlidersHorizontal />
              </span>
              <div>
                <h3 id="heatwave-thresholds-title">{t('heatwave.panel.settingsTitle')}</h3>
                <p>{t('heatwave.panel.settingsIntro')}</p>
              </div>
              {status.canManage && (
                <button
                  type="button"
                  className="heatwave-button heatwave-button--small"
                  aria-label={t('heatwave.panel.edit')}
                  onClick={() => setSettingsOpen(true)}
                >
                  {t('heatwave.panel.editShort')}
                </button>
              )}
            </header>
            <dl>
              {heatwaveThresholds(status.settings).map((row) => {
                const Icon = thresholdIcons[row.key];
                return (
                  <div
                    key={row.key}
                    className={`heatwave-threshold heatwave-threshold--${row.key}${row.off ? ' is-off' : ''}`}
                  >
                    <dt>
                      <Icon aria-hidden="true" />
                      {row.label}
                    </dt>
                    <dd>{row.value}</dd>
                  </div>
                );
              })}
            </dl>
            {!status.canManage && (
              <p className="heatwave-thresholds__note">{t('heatwave.how.readOnly')}</p>
            )}
          </section>

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
        </div>
      </div>

      <p className="heatwave-medical">
        <ShieldCheck aria-hidden="true" />
        <span>{t('heatwave.notMedical')}</span>
      </p>

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
    </section>
  );
}
