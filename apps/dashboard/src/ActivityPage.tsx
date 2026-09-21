import { homeSummarySchema } from '@michel/contracts';
import type {
  ActivityEvent,
  ActivitySequence,
  ActivitySummary,
  HomeSummary,
} from '@michel/contracts';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BatteryMedium,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleHelp,
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

const capabilityLabels: Record<string, [string, string]> = {
  motion: ['Mouvement', 'Motion'],
  occupancy: ['Présence', 'Occupancy'],
  person_presence: ['Présence', 'Presence'],
  contact: ['Ouverture', 'Opening'],
  button: ['Bouton d’appel', 'Call button'],
  temperature: ['Température', 'Temperature'],
  humidity: ['Humidité', 'Humidity'],
  power: ['Puissance', 'Power'],
  energy: ['Énergie', 'Energy'],
  switch: ['Appareil', 'Device'],
  current: ['Courant', 'Current'],
  voltage: ['Tension', 'Voltage'],
  battery: ['Batterie', 'Battery'],
  water_leak: ['Détection d’eau', 'Water detection'],
  smoke: ['Fumée', 'Smoke'],
  carbon_monoxide: ['Monoxyde de carbone', 'Carbon monoxide'],
  co2: ['CO₂', 'CO₂'],
  voc: ['Composés volatils', 'Volatile compounds'],
  pm25: ['Particules fines', 'Fine particles'],
  air_quality: ['Qualité de l’air', 'Air quality'],
  illuminance: ['Luminosité', 'Illuminance'],
  vibration: ['Vibration', 'Vibration'],
  fall_detection: ['Chute détectée', 'Fall detection'],
  signal_strength: ['Signal', 'Signal'],
};

function capabilityLabel(capability: string, locale: 'fr' | 'en') {
  return capabilityLabels[capability]?.[locale === 'fr' ? 0 : 1] ?? capability;
}

function clock(value: string, locale: 'fr' | 'en', timeZone: string) {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

function relativeTime(value: string, locale: 'fr' | 'en') {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return locale === 'fr' ? 'à l’instant' : 'just now';
  if (minutes < 60) return locale === 'fr' ? `il y a ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return locale === 'fr' ? `il y a ${hours} h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return locale === 'fr' ? `il y a ${days} j` : `${days}d ago`;
}

function readableDuration(seconds: number, locale: 'fr' | 'en') {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ${locale === 'fr' ? 'h' : 'hr'}${rest ? ` ${rest} min` : ''}`;
}

function dayLabel(value: string, locale: 'fr' | 'en', timeZone: string) {
  const formatted = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
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

function comparisonDelta(value: number, unit: string, locale: 'fr' | 'en') {
  if (value === 0) return locale === 'fr' ? 'Identique' : 'Same';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value)} ${unit}`;
}

function eventDescription(event: ActivityEvent, locale: 'fr' | 'en') {
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const raw = payload.value ?? payload.state;
  const value =
    typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
      ? String(raw)
      : null;
  const unit = event.unit ? ` ${event.unit}` : '';
  if (event.capability === 'contact') {
    const open = raw === true || raw === 'open' || raw === 'on' || raw === 1;
    return locale === 'fr'
      ? open
        ? 'Ouverture détectée'
        : 'Fermeture détectée'
      : open
        ? 'Opening detected'
        : 'Closing detected';
  }
  if (event.capability === 'motion')
    return locale === 'fr' ? 'Mouvement détecté' : 'Movement detected';
  if (['occupancy', 'person_presence'].includes(event.capability))
    return locale === 'fr' ? 'Présence détectée' : 'Presence detected';
  if (event.capability === 'button')
    return locale === 'fr' ? 'Bouton d’appel activé' : 'Call button activated';
  return value
    ? `${capabilityLabel(event.capability, locale)} · ${value}${unit}`
    : capabilityLabel(event.capability, locale);
}

function sequenceSentence(sequence: ActivitySequence, locale: 'fr' | 'en') {
  const duration =
    sequence.durationSeconds >= 60 ? readableDuration(sequence.durationSeconds, locale) : '';
  const passage = sequence.passages[0];
  if (passage)
    return locale === 'fr'
      ? `Passage entre ${passage.fromLevelName} et ${passage.toLevelName}${duration ? `, puis activité pendant ${duration}` : ''}.`
      : `Movement between ${passage.fromLevelName} and ${passage.toLevelName}${duration ? `, followed by ${duration} of activity` : ''}.`;
  if (sequence.roomNames.length > 1)
    return locale === 'fr'
      ? `Passage de ${sequence.roomNames[0]} à ${sequence.roomNames.at(-1)}${duration ? `, puis activité pendant ${duration}` : ''}.`
      : `Movement from ${sequence.roomNames[0]} to ${sequence.roomNames.at(-1)}${duration ? `, followed by ${duration} of activity` : ''}.`;
  const room = sequence.roomNames[0] ?? (locale === 'fr' ? 'le logement' : 'the home');
  return locale === 'fr'
    ? `Activité observée dans ${room}${duration ? ` pendant ${duration}` : ''}.`
    : `Activity observed in ${room}${duration ? ` for ${duration}` : ''}.`;
}

export function ActivityPage({ locale, timeZone }: ActivityPageProps) {
  const fr = locale === 'fr';
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
  const activityDuration = readableDuration(summary?.observedSeconds ?? 0, locale);
  const availableDates = Array.from({ length: 7 }, (_, index) => shiftDateKey(todayKey, -index));
  const selectedDateLabel = dateKeyLabel(selectedDate, locale, timeZone);
  const selectedDateTitle =
    selectedDate === todayKey
      ? `${fr ? 'Aujourd’hui' : 'Today'} · ${selectedDateLabel}`
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
    ? fr
      ? `La dernière activité fiable a été observée dans ${summary.lastReliableActivity.roomName} à ${clock(summary.lastReliableActivity.occurredAt, locale, timeZone)}.`
      : `The latest reliable activity was observed in ${summary.lastReliableActivity.roomName} at ${clock(summary.lastReliableActivity.occurredAt, locale, timeZone)}.`
    : fr
      ? 'Aucune activité fiable ne permet encore de résumer cette période.'
      : 'No reliable activity is available to summarize this period yet.';

  if (loading && !summary)
    return (
      <DataLoadingScreen
        locale={locale}
        message={fr ? 'Préparation de l’activité du logement…' : 'Preparing home activity…'}
      />
    );

  return (
    <section className="activity-overview-page">
      <header className="activity-overview-hero">
        <div className="activity-overview-hero-content">
          <h2>{fr ? 'Activité' : 'Activity'}</h2>
          <div className="activity-hero-last-activity" role="status">
            <CircleCheck aria-hidden="true" />
            <span>{lastReliableActivity}</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="activity-refresh-banner" role="status">
          <AlertTriangle />
          <span>
            {fr
              ? 'Les dernières informations restent affichées. La mise à jour a échoué.'
              : 'The latest information remains visible. The update failed.'}
          </span>
          <button onClick={() => void refresh(true)}>
            <RefreshCw /> {fr ? 'Réessayer' : 'Retry'}
          </button>
        </div>
      )}

      <article className="activity-surface-card activity-sequences-card">
        <header className="activity-moments-header">
          <div>
            <h2>{fr ? 'Moments du quotidien' : 'Daily moments'}</h2>
            <p>
              {fr
                ? 'Une vue d’ensemble des activités et déplacements au fil de la journée.'
                : 'An overview of activity and movement throughout the day.'}
            </p>
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
                  aria-label={fr ? 'Choisir une journée' : 'Choose a day'}
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
                            ? fr
                              ? 'Aujourd’hui'
                              : 'Today'
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
              <span>{fr ? 'Comparer' : 'Compare'}</span>
            </button>
          </div>
        </header>

        {isComparing && (
          <div className="activity-comparison-panel">
            <div className="activity-comparison-picker">
              <ArrowLeftRight aria-hidden="true" />
              <label htmlFor="activity-comparison-date">
                {fr ? 'Comparer avec' : 'Compare with'}
              </label>
              <select
                id="activity-comparison-date"
                value={comparisonDate}
                onChange={(event) => setComparisonDate(event.target.value)}
              >
                <option value="">{fr ? 'Choisir une journée' : 'Choose a day'}</option>
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
                  <span className="activity-comparison-loading">
                    {fr ? 'Comparaison…' : 'Comparing…'}
                  </span>
                ) : comparisonSummary ? (
                  <>
                    <span className="activity-comparison-caption">
                      {fr ? 'Écart avec' : 'Difference from'}{' '}
                      {dateKeyLabel(comparisonDate, locale, timeZone)}
                    </span>
                    <div className="activity-comparison-stat">
                      <strong>
                        {comparisonDelta(
                          momentsCount - comparisonMomentsCount,
                          fr ? 'moments' : 'moments',
                          locale,
                        )}
                      </strong>
                      <small>{fr ? 'moments détectés' : 'detected moments'}</small>
                    </div>
                    <div className="activity-comparison-stat">
                      <strong>
                        {comparisonDelta(
                          currentDurationMinutes - comparisonDurationMinutes,
                          fr ? 'min' : 'min',
                          locale,
                        )}
                      </strong>
                      <small>{fr ? 'd’activité' : 'of activity'}</small>
                    </div>
                    <div className="activity-comparison-stat">
                      <strong>
                        {comparisonDelta(
                          usedRoomsCount - comparisonRoomsCount,
                          fr ? 'pièce(s)' : 'room(s)',
                          locale,
                        )}
                      </strong>
                      <small>{fr ? 'pièces utilisées' : 'rooms used'}</small>
                    </div>
                  </>
                ) : (
                  <span className="activity-comparison-loading">
                    {fr
                      ? 'Comparaison indisponible pour cette journée.'
                      : 'Comparison unavailable for this day.'}
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
              <small>{fr ? 'moments détectés' : 'moments detected'}</small>
            </div>
            <CircleHelp />
          </div>
          <div className="activity-moment-stat activity-moment-stat--green">
            <span className="activity-moment-stat-icon">
              <Clock3 />
            </span>
            <div>
              <strong>{activityDuration}</strong>
              <small>{fr ? 'd’activité' : 'of activity'}</small>
            </div>
          </div>
          <div className="activity-moment-stat activity-moment-stat--orange">
            <span className="activity-moment-stat-icon">
              <Home />
            </span>
            <div>
              <strong>{usedRoomsCount}</strong>
              <small>{fr ? 'pièces utilisées' : 'rooms used'}</small>
            </div>
          </div>
        </div>

        <div className="activity-sequence-list activity-timeline">
          {liveMoment && liveMomentAt && (
            <article className="activity-sequence activity-current-sequence" role="status">
              <div className="activity-current-sequence-summary">
                <time className="activity-sequence-time">
                  <strong>{clock(liveMomentAt, locale, timeZone)}</strong>
                  <small>{fr ? 'En ce moment' : 'Right now'}</small>
                </time>
                <span className="activity-timeline-dot" aria-hidden="true" />
                <span className="activity-sequence-summary-card activity-current-sequence-card">
                  <span className="activity-sequence-summary-icon">
                    <Footprints />
                  </span>
                  <span className="activity-sequence-copy">
                    <strong>{liveMoment}</strong>
                    <small>{fr ? 'Situation actuelle' : 'Current situation'}</small>
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
                  <small>{relativeTime(sequence.startedAt, locale)}</small>
                </time>
                <span className="activity-timeline-dot" aria-hidden="true" />
                <span className="activity-sequence-summary-card">
                  <span className="activity-sequence-summary-icon">
                    <Footprints />
                  </span>
                  <span className="activity-sequence-copy">
                    <strong>{sequenceSentence(sequence, locale)}</strong>
                    <small>
                      {sequence.totalEventCount} {fr ? 'événements' : 'events'} ·{' '}
                      {sequence.durationSeconds
                        ? `${fr ? 'activité pendant' : 'activity for'} ${readableDuration(sequence.durationSeconds, locale)}`
                        : relativeTime(sequence.startedAt, locale)}
                    </small>
                  </span>
                  <ChevronDown />
                </span>
              </summary>
              <div className="activity-sequence-events">
                {sequence.hiddenEventCount > 0 && (
                  <p>
                    {fr
                      ? `${sequence.hiddenEventCount} événements répétitifs ont été regroupés.`
                      : `${sequence.hiddenEventCount} repetitive events were grouped.`}
                  </p>
                )}
                {sequence.events.map((event) => {
                  const Icon = capabilityIcons[event.capability] ?? Activity;
                  return (
                    <div className="activity-event-row" key={event.id}>
                      <time className="activity-event-time">
                        {clock(event.occurredAt, locale, timeZone)}
                      </time>
                      <span className="activity-event-icon">
                        <Icon />
                      </span>
                      <div className="activity-event-copy">
                        <strong>{eventDescription(event, locale)}</strong>
                        <small>
                          {event.roomName} ·{' '}
                          {event.sensorName ?? (fr ? 'Capteur du logement' : 'Home sensor')}
                        </small>
                      </div>
                      <span
                        className={`activity-reliability-badge${event.quality === 'good' ? '' : ' is-muted'}`}
                      >
                        {event.quality === 'good' ? <CircleCheck /> : <CircleDashed />}
                        {event.quality === 'good'
                          ? fr
                            ? 'Fiable'
                            : 'Reliable'
                          : fr
                            ? 'À confirmer'
                            : 'To confirm'}
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
              <p>
                {fr
                  ? 'Aucun moment fiable ne correspond à cette sélection.'
                  : 'No reliable moment matches this selection.'}
              </p>
            </div>
          )}
        </div>
        {visibleSequences < filteredSequences.length && (
          <button
            className="activity-show-more"
            onClick={() => setVisibleSequences((value) => value + 8)}
          >
            {fr ? 'Afficher les moments précédents' : 'Show earlier moments'}
          </button>
        )}
        {summary?.hasMoreSequences && visibleSequences >= filteredSequences.length && (
          <small className="activity-history-limit">
            {fr
              ? 'Les événements les plus anciens restent disponibles dans le journal local.'
              : 'Older events remain available in the local journal.'}
          </small>
        )}
      </article>
    </section>
  );
}
