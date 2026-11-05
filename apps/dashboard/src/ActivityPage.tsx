import { homeSummarySchema } from '@elise/contracts';
import type {
  ActivityEvent,
  ActivitySequence,
  ActivitySummary,
  HomeSummary,
} from '@elise/contracts';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BatteryMedium,
  BedDouble,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Clock3,
  DoorOpen,
  Droplets,
  Flame,
  Footprints,
  Gauge,
  Home,
  Leaf,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sun,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DataLoadingScreen } from './DataLoadingScreen';
import { presenceText } from './WelcomePage';
import './activity-page.css';
import { dateLocale, t } from './i18n';

type ActivityPageProps = {
  locale: 'fr' | 'en';
  homeName: string;
  timeZone: string;
  residentName: string;
  reassurance: 'NORMAL' | 'LEARNING' | 'ATTENTION' | 'INSUFFICIENT_DATA';
  openAlerts: number;
  canManage: boolean;
  onOpenAlerts: () => void;
  onOpenRoom: (roomId: string) => void;
  onOpenStair: (stairId: string) => void;
};

const capabilityIcons: Record<string, typeof Activity> = {
  motion: Activity,
  occupancy: Footprints,
  person_presence: Footprints,
  contact: DoorOpen,
  dry_contact: DoorOpen,
  button: Bell,
  temperature: Thermometer,
  humidity: Droplets,
  power: Zap,
  energy: Gauge,
  switch: Zap,
  current: Zap,
  voltage: Zap,
  battery: BatteryMedium,
  water_leak: Droplets,
  smoke: Flame,
  carbon_monoxide: Wind,
  co2: Wind,
  voc: Leaf,
  pm25: Wind,
  air_quality: Leaf,
  illuminance: Sun,
  vibration: Activity,
  fall_detection: ShieldAlert,
  signal_strength: Radio,
};

const capabilityLabels: Record<string, () => string> = {
  motion: () => t('activityPage.capabilityLabels.motion'),
  occupancy: () => t('activityPage.capabilityLabels.occupancy'),
  person_presence: () => t('activityPage.capabilityLabels.person_presence'),
  contact: () => t('activityPage.capabilityLabels.contact'),
  dry_contact: () => t('activityPage.capabilityLabels.dry_contact'),
  button: () => t('activityPage.capabilityLabels.button'),
  temperature: () => t('activityPage.capabilityLabels.temperature'),
  humidity: () => t('activityPage.capabilityLabels.humidity'),
  power: () => t('activityPage.capabilityLabels.power'),
  energy: () => t('activityPage.capabilityLabels.energy'),
  switch: () => t('activityPage.capabilityLabels.switch'),
  current: () => t('activityPage.capabilityLabels.current'),
  voltage: () => t('activityPage.capabilityLabels.voltage'),
  battery: () => t('activityPage.capabilityLabels.battery'),
  water_leak: () => t('activityPage.capabilityLabels.water_leak'),
  smoke: () => t('activityPage.capabilityLabels.smoke'),
  carbon_monoxide: () => t('activityPage.capabilityLabels.carbon_monoxide'),
  co2: () => t('activityPage.capabilityLabels.co2'),
  voc: () => t('activityPage.capabilityLabels.voc'),
  pm25: () => t('activityPage.capabilityLabels.pm25'),
  air_quality: () => t('activityPage.capabilityLabels.air_quality'),
  illuminance: () => t('activityPage.capabilityLabels.illuminance'),
  vibration: () => t('activityPage.capabilityLabels.vibration'),
  fall_detection: () => t('activityPage.capabilityLabels.fall_detection'),
  signal_strength: () => t('activityPage.capabilityLabels.signal_strength'),
};

function capabilityLabel(capability: string) {
  return capabilityLabels[capability]?.() ?? capability;
}

function clock(value: string, locale: 'fr' | 'en', timeZone: string) {
  return new Intl.DateTimeFormat(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return t('activityPage.justNow');
  if (minutes < 60) return t('activityPage.minAgo', { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('activityPage.hAgo', { hours });
  const days = Math.round(hours / 24);
  return t('activityPage.dAgo', { days });
}

function readableDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ${t('activityPage.hr')}${rest ? ` ${rest} min` : ''}`;
}

function dayLabel(value: string, locale: 'fr' | 'en', timeZone: string) {
  const formatted = new Intl.DateTimeFormat(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(value));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function currentDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shiftDateKey(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function dateKeyLabel(value: string, locale: 'fr' | 'en', timeZone: string) {
  return dayLabel(`${value}T12:00:00.000Z`, locale, timeZone);
}

function comparisonDelta(value: number, unit: string) {
  if (value === 0) return t('activityPage.same');
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value)} ${unit}`;
}

function eventDescription(event: ActivityEvent) {
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const context =
    payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)
      ? (payload.context as Record<string, unknown>)
      : {};
  const raw = payload.open ?? payload.active ?? payload.value ?? payload.state;
  const value =
    typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
      ? String(raw)
      : null;
  const unit = event.unit ? ` ${event.unit}` : '';
  if (
    event.capability === 'contact' ||
    event.capability === 'dry_contact' ||
    (event.capability === 'occupancy' && context.role === 'BED')
  ) {
    const open =
      raw === true || raw === 'open' || raw === 'contact_open' || raw === 'on' || raw === 1;
    if (context.role === 'BED') {
      const occupied =
        open === (context.bedOccupiedWhen === 'OPEN' || event.capability === 'occupancy');
      return occupied ? t('activityPage.bedOccupied') : t('activityPage.bedUnoccupied');
    }
    if (event.capability === 'dry_contact')
      return open ? t('activityPage.contactOpen') : t('activityPage.contactClosed');
    return open ? t('activityPage.openingDetected') : t('activityPage.closingDetected');
  }
  if (event.capability === 'motion') return t('activityPage.movementDetected');
  if (['occupancy', 'person_presence'].includes(event.capability))
    return t('activityPage.presenceDetected');
  if (event.capability === 'button') return t('activityPage.callButtonActivated');
  return value
    ? `${capabilityLabel(event.capability)} · ${value}${unit}`
    : capabilityLabel(event.capability);
}

function sequenceSentence(sequence: ActivitySequence) {
  const passage = sequence.passages[0];
  if (passage)
    return t('activityPage.movementBetweenAnd', {
      fromLevelName: passage.fromLevelName,
      toLevelName: passage.toLevelName,
    });
  if (sequence.roomNames.length > 1) {
    const firstRoom = sequence.roomNames[0]!;
    const lastRoom = sequence.roomNames.at(-1)!;
    if (firstRoom === lastRoom) return t('activityPage.movementWithAReturnTo', { firstRoom });
    return t('activityPage.movementFromTo', { firstRoom, lastRoom });
  }
  const room = sequence.roomNames[0] ?? t('activityPage.theHome');
  return t('activityPage.activityObservedIn', { room });
}

export function ActivityPage({ locale, timeZone }: ActivityPageProps) {
  const todayKey = currentDateKey(timeZone);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visibleSequences, setVisibleSequences] = useState(8);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonDate, setComparisonDate] = useState('');
  const [comparisonSummary, setComparisonSummary] = useState<ActivitySummary | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      const query = new URLSearchParams({ period: '24h', date: selectedDate });
      try {
        const [summaryResponse, homeResponse] = await Promise.all([
          fetch(`/api/v1/analytics/activity?${query}`, { cache: 'no-store' }),
          fetch('/api/v1/home-summary', { cache: 'no-store' }),
        ]);
        if (!summaryResponse.ok) throw new Error('activity');
        setSummary((await summaryResponse.json()) as ActivitySummary);
        if (homeResponse.ok) {
          const homeResult = homeSummarySchema.safeParse(await homeResponse.json());
          if (homeResult.success) setHomeSummary(homeResult.data);
        }
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [selectedDate],
  );

  useEffect(() => void refresh(true), [refresh]);
  useEffect(() => {
    setVisibleSequences(8);
  }, [selectedDate]);

  useEffect(() => {
    if (!isComparing || !comparisonDate) {
      setComparisonSummary(null);
      setComparisonLoading(false);
      return;
    }

    let alive = true;
    setComparisonLoading(true);
    fetch(`/api/v1/analytics/activity?period=24h&date=${encodeURIComponent(comparisonDate)}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('comparison');
        return (await response.json()) as ActivitySummary;
      })
      .then((value) => {
        if (alive) setComparisonSummary(value);
      })
      .catch(() => {
        if (alive) setComparisonSummary(null);
      })
      .finally(() => {
        if (alive) setComparisonLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [comparisonDate, isComparing]);
  useEffect(() => {
    const events = new EventSource('/api/v1/events');
    const refreshInterval = setInterval(() => void refresh(false), 60_000);
    events.onmessage = (event) => {
      try {
        const type = (JSON.parse(String(event.data)) as { type?: string }).type;
        if (!['activity', 'presence', 'household', 'alerts'].includes(type ?? '')) return;
      } catch {
        // Unknown events are treated as potentially relevant.
      }
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(false), 450);
    };
    return () => {
      events.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      clearInterval(refreshInterval);
    };
  }, [refresh]);

  const allSequences = summary?.sequences ?? [];
  const filteredSequences = allSequences;
  const momentsCount = filteredSequences.length;
  const usedRoomsCount = new Set(filteredSequences.flatMap((sequence) => sequence.roomNames)).size;
  const activityDuration = readableDuration(summary?.observedSeconds ?? 0);
  const availableDates = Array.from({ length: 7 }, (_, index) => shiftDateKey(todayKey, -index));
  const selectedDateLabel = dateKeyLabel(selectedDate, locale, timeZone);
  const selectedDateTitle =
    selectedDate === todayKey
      ? `${t('activityPage.today')} · ${selectedDateLabel}`
      : selectedDateLabel;
  const comparisonSequences = comparisonSummary?.sequences ?? [];
  const comparisonMomentsCount = comparisonSequences.length;
  const comparisonRoomsCount = new Set(
    comparisonSequences.flatMap((sequence) => sequence.roomNames),
  ).size;
  const currentDurationMinutes = Math.round((summary?.observedSeconds ?? 0) / 60);
  const comparisonDurationMinutes = Math.round((comparisonSummary?.observedSeconds ?? 0) / 60);
  const liveMoment =
    selectedDate === todayKey && homeSummary ? presenceText(homeSummary, locale) : null;
  const liveMomentAt =
    selectedDate === todayKey
      ? (homeSummary?.latestPresence?.occurredAt ??
        homeSummary?.presence.lastEvidenceAt ??
        homeSummary?.presence.lastConfirmedAt ??
        homeSummary?.presence.detectedAt ??
        null)
      : null;
  const lastReliableActivity = summary?.lastReliableActivity
    ? t('activityPage.theLatestReliableActivityWas', {
        roomName: summary.lastReliableActivity.roomName,
        clock: clock(summary.lastReliableActivity.occurredAt, locale, timeZone),
      })
    : t('activityPage.noReliableActivityIsAvailable');

  if (loading && !summary)
    return <DataLoadingScreen locale={locale} message={t('activityPage.preparingHomeActivity')} />;

  return (
    <section className="activity-overview-page">
      <header className="page-hero activity-overview-hero">
        <div className="page-hero__copy activity-overview-hero-content">
          <h2 className="page-hero__title">{t('activityPage.activity')}</h2>
          <div className="activity-hero-last-activity" role="status">
            <CircleCheck aria-hidden="true" />
            <span>{lastReliableActivity}</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="activity-refresh-banner" role="status">
          <AlertTriangle />
          <span>{t('activityPage.theLatestInformationRemainsVisible')}</span>
          <button onClick={() => void refresh(true)}>
            <RefreshCw /> {t('activityPage.retry')}
          </button>
        </div>
      )}

      <article className="activity-surface-card activity-sequences-card">
        <header className="activity-moments-header">
          <div>
            <h2>{t('activityPage.dailyMoments')}</h2>
            <p>{t('activityPage.anOverviewOfActivityAnd')}</p>
          </div>
          <div className="activity-moments-actions">
            <div className="activity-date-picker">
              <button
                className="activity-moments-date"
                type="button"
                aria-expanded={isDatePickerOpen}
                aria-haspopup="listbox"
                onClick={() => setIsDatePickerOpen((value) => !value)}
              >
                <CalendarDays />
                <span>{selectedDateTitle}</span>
                <ChevronDown />
              </button>
              {isDatePickerOpen && (
                <div
                  className="activity-date-menu"
                  role="listbox"
                  aria-label={t('activityPage.chooseADay')}
                >
                  {availableDates.map((date) => (
                    <button
                      className={`activity-date-option${date === selectedDate ? ' is-selected' : ''}`}
                      key={date}
                      type="button"
                      role="option"
                      aria-selected={date === selectedDate}
                      onClick={() => {
                        setSelectedDate(date);
                        setIsDatePickerOpen(false);
                        if (date === comparisonDate) setComparisonDate('');
                      }}
                    >
                      <span>
                        <strong>
                          {date === todayKey
                            ? t('activityPage.today')
                            : dateKeyLabel(date, locale, timeZone)}
                        </strong>
                        <small>{date}</small>
                      </span>
                      {date === selectedDate && <CircleCheck aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className={`activity-compare-toggle${isComparing ? ' is-active' : ''}`}
              type="button"
              aria-pressed={isComparing}
              onClick={() => setIsComparing((value) => !value)}
            >
              <ArrowLeftRight />
              <span>{t('activityPage.compare')}</span>
            </button>
          </div>
        </header>

        {isComparing && (
          <div className="activity-comparison-panel">
            <div className="activity-comparison-picker">
              <ArrowLeftRight aria-hidden="true" />
              <label htmlFor="activity-comparison-date">{t('activityPage.compareWith')}</label>
              <select
                id="activity-comparison-date"
                value={comparisonDate}
                onChange={(event) => setComparisonDate(event.target.value)}
              >
                <option value="">{t('activityPage.chooseADay')}</option>
                {availableDates
                  .filter((date) => date !== selectedDate)
                  .map((date) => (
                    <option value={date} key={date}>
                      {dateKeyLabel(date, locale, timeZone)}
                    </option>
                  ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
            {comparisonDate && (
              <div className="activity-comparison-result" aria-live="polite">
                {comparisonLoading ? (
                  <span className="activity-comparison-loading">{t('activityPage.comparing')}</span>
                ) : comparisonSummary ? (
                  <>
                    <span className="activity-comparison-caption">
                      {t('activityPage.differenceFrom')}{' '}
                      {dateKeyLabel(comparisonDate, locale, timeZone)}
                    </span>
                    <div className="activity-comparison-stat">
                      <strong>
                        {comparisonDelta(
                          momentsCount - comparisonMomentsCount,
                          t('activityPage.moments'),
                        )}
                      </strong>
                      <small>{t('activityPage.detectedMoments')}</small>
                    </div>
                    <div className="activity-comparison-stat">
                      <strong>
                        {comparisonDelta(
                          currentDurationMinutes - comparisonDurationMinutes,
                          t('activityPage.min'),
                        )}
                      </strong>
                      <small>{t('activityPage.ofActivity')}</small>
                    </div>
                    <div className="activity-comparison-stat">
                      <strong>
                        {comparisonDelta(
                          usedRoomsCount - comparisonRoomsCount,
                          t('activityPage.roomS'),
                        )}
                      </strong>
                      <small>{t('activityPage.roomsUsed')}</small>
                    </div>
                  </>
                ) : (
                  <span className="activity-comparison-loading">
                    {t('activityPage.comparisonUnavailableForThisDay')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="activity-moments-toolbar">
          <div className="activity-moment-stat activity-moment-stat--blue">
            <span className="activity-moment-stat-icon">
              <Footprints />
            </span>
            <div>
              <strong>{momentsCount}</strong>
              <small>{t('activityPage.momentsDetected')}</small>
            </div>
          </div>
          <div className="activity-moment-stat activity-moment-stat--green">
            <span className="activity-moment-stat-icon">
              <Clock3 />
            </span>
            <div>
              <strong>{activityDuration}</strong>
              <small>{t('activityPage.ofActivity')}</small>
            </div>
          </div>
          <div className="activity-moment-stat activity-moment-stat--orange">
            <span className="activity-moment-stat-icon">
              <Home />
            </span>
            <div>
              <strong>{usedRoomsCount}</strong>
              <small>{t('activityPage.roomsUsed')}</small>
            </div>
          </div>
        </div>

        <div className="activity-sequence-list activity-timeline">
          {liveMoment && liveMomentAt && (
            <article className="activity-sequence activity-current-sequence" role="status">
              <div className="activity-current-sequence-summary">
                <time className="activity-sequence-time">
                  <strong>{clock(liveMomentAt, locale, timeZone)}</strong>
                  <small>{t('activityPage.rightNow')}</small>
                </time>
                <span className="activity-timeline-dot" aria-hidden="true" />
                <span className="activity-sequence-summary-card activity-current-sequence-card">
                  <span className="activity-sequence-summary-icon">
                    <Footprints />
                  </span>
                  <span className="activity-sequence-copy">
                    <strong>{liveMoment}</strong>
                    <small>{t('activityPage.currentSituation')}</small>
                  </span>
                  <span aria-hidden="true" />
                </span>
              </div>
            </article>
          )}
          {filteredSequences.slice(0, visibleSequences).map((sequence) => (
            <details className="activity-sequence" key={sequence.id}>
              <summary>
                <time className="activity-sequence-time">
                  <strong>{clock(sequence.startedAt, locale, timeZone)}</strong>
                  <small>{relativeTime(sequence.startedAt)}</small>
                </time>
                <span className="activity-timeline-dot" aria-hidden="true" />
                <span className="activity-sequence-summary-card">
                  <span className="activity-sequence-summary-icon">
                    <Footprints />
                  </span>
                  <span className="activity-sequence-copy">
                    <strong>{sequenceSentence(sequence)}</strong>
                    <small>
                      {sequence.totalEventCount} {t('activityPage.events')} ·{' '}
                      {sequence.durationSeconds
                        ? `${t('activityPage.activityFor')} ${readableDuration(sequence.durationSeconds)}`
                        : relativeTime(sequence.startedAt)}
                    </small>
                  </span>
                  <ChevronDown />
                </span>
              </summary>
              <div className="activity-sequence-events">
                {sequence.hiddenEventCount > 0 && (
                  <p>
                    {t('activityPage.repetitiveEventsWereGrouped', {
                      hiddenEventCount: sequence.hiddenEventCount,
                    })}
                  </p>
                )}
                {sequence.events.map((event) => {
                  const payload =
                    event.payload &&
                    typeof event.payload === 'object' &&
                    !Array.isArray(event.payload)
                      ? (event.payload as Record<string, unknown>)
                      : {};
                  const context =
                    payload.context && typeof payload.context === 'object'
                      ? (payload.context as Record<string, unknown>)
                      : {};
                  const Icon =
                    context.role === 'BED'
                      ? BedDouble
                      : (capabilityIcons[event.capability] ?? Activity);
                  return (
                    <div className="activity-event-row" key={event.id}>
                      <time className="activity-event-time">
                        {clock(event.occurredAt, locale, timeZone)}
                      </time>
                      <span className="activity-event-icon">
                        <Icon />
                      </span>
                      <div className="activity-event-copy">
                        <strong>{eventDescription(event)}</strong>
                        <small>
                          {event.roomName} · {event.sensorName ?? t('activityPage.homeSensor')}
                        </small>
                      </div>
                      <span
                        className={`activity-reliability-badge${event.quality === 'good' ? '' : ' is-muted'}`}
                      >
                        {event.quality === 'good' ? <CircleCheck /> : <CircleDashed />}
                        {event.quality === 'good'
                          ? t('activityPage.reliable')
                          : t('activityPage.toConfirm')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
          {!filteredSequences.length && !liveMoment && (
            <div className="activity-sequences-empty">
              <CircleDashed />
              <p>{t('activityPage.noReliableMomentMatchesThis')}</p>
            </div>
          )}
        </div>
        {visibleSequences < filteredSequences.length && (
          <button
            className="activity-show-more"
            onClick={() => setVisibleSequences((value) => value + 8)}
          >
            {t('activityPage.showEarlierMoments')}
          </button>
        )}
        {summary?.hasMoreSequences && visibleSequences >= filteredSequences.length && (
          <small className="activity-history-limit">
            {t('activityPage.olderEventsRemainAvailableIn')}
          </small>
        )}
      </article>
    </section>
  );
}
