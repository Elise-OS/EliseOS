import {
  HEATWAVE_REGISTRY_URL,
  type HeatwaveSettings,
  type HeatwaveStatus,
} from '@elise/contracts';
import {
  AlertTriangle,
  CloudSun,
  ExternalLink,
  GlassWater,
  House,
  Landmark,
  Power,
  SlidersHorizontal,
  ThermometerSun,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { subscribeRealtime } from '../realtime';
import { HeatwaveSettingsDialog } from './HeatwaveSettingsDialog';
import { celsius, clockTime, heatwaveStateText } from './heatwave-text';
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

/** Heatwave card of the home page: state of the mode, heat of the day and drink reminders. */
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
      <section className="heatwave-card is-loading" aria-busy={!failed} aria-live="polite">
        <span className="heatwave-card__icon">
          <ThermometerSun aria-hidden="true" />
        </span>
        <div className="heatwave-card__lead">
          <h3>{t('heatwave.card.title')}</h3>
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
      </section>
    );

  const { indoor, forecast, reminders } = status;
  const paused = !status.active && status.manual === 'OFF';
  const stateLabel = status.active
    ? t('heatwave.card.statusOn')
    : paused
      ? t('heatwave.card.statusPaused')
      : t('heatwave.card.statusOff');
  const forecastText = forecast.available
    ? [
        forecast.todayMax !== null
          ? t('heatwave.card.forecastToday', { value: celsius(forecast.todayMax) })
          : null,
        forecast.tomorrowMax !== null
          ? t('heatwave.card.forecastTomorrow', { value: celsius(forecast.tomorrowMax) })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('heatwave.card.forecastUnavailable');
  const indoorText =
    indoor.sensors === 0
      ? t('heatwave.card.indoorNoSensor')
      : indoor.maxToday === null
        ? t('heatwave.card.indoorNoData')
        : indoor.maxTodayRoom
          ? t('heatwave.card.indoorMaxRoom', {
              value: celsius(indoor.maxToday),
              room: indoor.maxTodayRoom,
            })
          : t('heatwave.card.indoorMax', { value: celsius(indoor.maxToday) });
  const remindersText = !status.settings.reminders.enabled
    ? t('heatwave.card.remindersOff')
    : [
        t('heatwave.card.remindersConfirmed', { count: reminders.confirmed }),
        t('heatwave.card.remindersMissed', { count: reminders.missed }),
      ].join(' · ');

  return (
    <section
      className={`heatwave-card ${status.active ? 'is-active' : paused ? 'is-paused' : 'is-idle'}`}
      aria-labelledby="heatwave-card-title"
    >
      <span className="heatwave-card__icon">
        <ThermometerSun aria-hidden="true" />
      </span>
      <div className="heatwave-card__lead">
        <div className="heatwave-card__title-row">
          <h3 id="heatwave-card-title">{t('heatwave.card.title')}</h3>
          <span className="heatwave-pill">
            <Power aria-hidden="true" />
            {stateLabel}
          </span>
        </div>
        <p>{heatwaveStateText(status)}</p>
      </div>
      <dl className="heatwave-card__facts">
        <div>
          <dt>
            <House aria-hidden="true" />
            {t('heatwave.card.indoorLabel')}
          </dt>
          <dd>{indoorText}</dd>
        </div>
        <div>
          <dt>
            <CloudSun aria-hidden="true" />
            {forecast.city
              ? t('heatwave.card.forecastLabelCity', { city: forecast.city })
              : t('heatwave.card.forecastLabel')}
          </dt>
          <dd>{forecastText}</dd>
        </div>
        <div>
          <dt>
            <GlassWater aria-hidden="true" />
            {t('heatwave.card.remindersLabel')}
          </dt>
          <dd>
            {remindersText}
            {status.active && reminders.next && (
              <small>
                {t('heatwave.card.nextReminder', {
                  time: clockTime(reminders.next, status.timezone),
                })}
              </small>
            )}
          </dd>
        </div>
      </dl>
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
      {actionError && (
        <p className="heatwave-card__error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </p>
      )}
      {status.registry.due && (
        <aside className="heatwave-registry" aria-label={t('heatwave.registry.title')}>
          <Landmark aria-hidden="true" />
          <div>
            <strong>{t('heatwave.registry.title')}</strong>
            <p>{t('heatwave.registry.text')}</p>
            <div className="heatwave-registry__actions">
              <a href={HEATWAVE_REGISTRY_URL} target="_blank" rel="noreferrer">
                {t('heatwave.registry.link')}
                <ExternalLink aria-hidden="true" />
              </a>
              {status.canToggle && (
                <button
                  type="button"
                  className="heatwave-link"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      statusRequest('/registry', 'POST', {
                        year: status.registry.year,
                      }),
                    )
                  }
                >
                  {t('heatwave.registry.done')}
                </button>
              )}
            </div>
          </div>
        </aside>
      )}
      <p className="heatwave-card__disclaimer">{t('heatwave.notMedical')}</p>
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
