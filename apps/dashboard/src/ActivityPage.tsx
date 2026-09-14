import type {
  ActivityEvent,
  ActivityRoomOverview,
  ActivitySequence,
  ActivitySummary,
  DashboardPeriod,
  HomePlan,
  RoutinesSummary,
} from '@michel/contracts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BatteryMedium,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDashed,
  CircleDot,
  Clock3,
  DoorOpen,
  Droplets,
  Flame,
  Footprints,
  Gauge,
  Leaf,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataLoadingScreen } from './DataLoadingScreen';
import { roomIcon } from './home-visuals';
import './activity-page.css';

type ActivityMode = 'LIFE' | 'ENVIRONMENT';

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

function currentDateKey(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date());
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

function roomStateCopy(
  state: ActivityRoomOverview['state'],
  locale: 'fr' | 'en',
  mode: ActivityMode = 'LIFE',
) {
  const copy: Record<ActivityRoomOverview['state'], [string, string]> = {
    NOT_EQUIPPED: ['Pas encore équipée', 'Not equipped yet'],
    EQUIPMENT_ISSUE: ['Équipement à vérifier', 'Equipment to check'],
    LEARNING: ['Apprentissage en cours', 'Learning in progress'],
    NO_ACTIVITY: ['Aucune activité récente', 'No recent activity'],
    OBSERVED: ['Activité observée', 'Activity observed'],
  };
  if (mode === 'ENVIRONMENT' && state === 'NO_ACTIVITY')
    return locale === 'fr' ? 'Aucune mesure récente' : 'No recent reading';
  if (mode === 'ENVIRONMENT' && state === 'OBSERVED')
    return locale === 'fr' ? 'Mesures disponibles' : 'Readings available';
  return copy[state][locale === 'fr' ? 0 : 1];
}

function statusContent(
  reassurance: ActivityPageProps['reassurance'],
  residentName: string,
  locale: 'fr' | 'en',
) {
  if (reassurance === 'ATTENTION')
    return {
      title:
        locale === 'fr'
          ? `Une situation demande votre attention pour ${residentName}.`
          : `A situation needs your attention for ${residentName}.`,
      label: locale === 'fr' ? 'À vérifier' : 'Needs attention',
      icon: AlertTriangle,
      tone: 'attention',
    };
  if (reassurance === 'INSUFFICIENT_DATA')
    return {
      title:
        locale === 'fr'
          ? `Élise manque encore de données fiables pour ${residentName}.`
          : `Élise still lacks reliable data for ${residentName}.`,
      label: locale === 'fr' ? 'Données insuffisantes' : 'Insufficient data',
      icon: CircleDashed,
      tone: 'insufficient',
    };
  if (reassurance === 'LEARNING')
    return {
      title:
        locale === 'fr'
          ? `Élise apprend le rythme quotidien de ${residentName}.`
          : `Élise is learning ${residentName}’s daily rhythm.`,
      label: locale === 'fr' ? 'Apprentissage' : 'Learning',
      icon: Sparkles,
      tone: 'learning',
    };
  return {
    title:
      locale === 'fr'
        ? `La journée de ${residentName} suit son rythme habituel.`
        : `${residentName}’s day is following its usual rhythm.`,
    label: locale === 'fr' ? 'Rythme habituel' : 'Usual rhythm',
    icon: ShieldCheck,
    tone: 'normal',
  };
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

function MiniTrend({ points, label }: { points: Array<{ value: number }>; label: string }) {
  if (points.length < 2) return <span className="activity-trend-empty" aria-hidden="true" />;
  const values = points.map(({ value }) => value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(1, maximum - minimum);
  const path = points
    .map(({ value }, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 25 - ((value - minimum) / spread) * 21;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="activity-mini-trend" viewBox="0 0 100 30" role="img" aria-label={label}>
      <polyline points={path} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ActivityPage({
  locale,
  homeName,
  timeZone,
  residentName,
  reassurance,
  openAlerts,
  canManage,
  onOpenAlerts,
  onOpenRoom,
  onOpenStair,
}: ActivityPageProps) {
  const fr = locale === 'fr';
  const [period, setPeriod] = useState<DashboardPeriod>('24h');
  const [selectedDate, setSelectedDate] = useState('');
  const [mode, setMode] = useState<ActivityMode>('LIFE');
  const [selectedLevelId, setSelectedLevelId] = useState('all');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [plan, setPlan] = useState<HomePlan | null>(null);
  const [routines, setRoutines] = useState<RoutinesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visibleSequences, setVisibleSequences] = useState(8);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      const query = new URLSearchParams({ period });
      if (selectedDate) query.set('date', selectedDate);
      try {
        const [summaryResponse, planResponse, routinesResponse] = await Promise.all([
          fetch(`/api/v1/analytics/activity?${query}`, { cache: 'no-store' }),
          fetch('/api/v1/household/plan', { cache: 'no-store' }),
          fetch('/api/v1/analytics/routines', { cache: 'no-store' }),
        ]);
        if (!summaryResponse.ok || !planResponse.ok) throw new Error('activity');
        setSummary((await summaryResponse.json()) as ActivitySummary);
        setPlan((await planResponse.json()) as HomePlan);
        if (routinesResponse.ok) setRoutines((await routinesResponse.json()) as RoutinesSummary);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [period, selectedDate],
  );

  useEffect(() => void refresh(true), [refresh]);
  useEffect(() => {
    const events = new EventSource('/api/v1/events');
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
    };
  }, [refresh]);

  useEffect(() => setVisibleSequences(8), [period, selectedDate, selectedRoomId]);

  const status = statusContent(reassurance, residentName, locale);
  const StatusIcon = status.icon;
  const summaryByRoom = useMemo(
    () => new Map(summary?.rooms.map((room) => [room.id, room]) ?? []),
    [summary],
  );
  const levels = useMemo(
    () => [...(plan?.levels ?? [])].sort((left, right) => left.order - right.order),
    [plan],
  );
  const roomEntries = useMemo(
    () =>
      levels.flatMap((level) =>
        level.rooms.map((room) => ({
          room,
          level,
          activity:
            summaryByRoom.get(room.id) ??
            ({
              id: room.id,
              name: room.name,
              kind: room.kind,
              floor: level.floor,
              state: 'NOT_EQUIPPED',
              environmentState: 'NOT_EQUIPPED',
              sensorCount: 0,
              lastActivity: null,
              environment: [],
              safety: [],
            } satisfies ActivityRoomOverview),
        })),
      ),
    [levels, summaryByRoom],
  );
  const visibleRooms = roomEntries.filter(
    ({ level }) => selectedLevelId === 'all' || level.id === selectedLevelId,
  );
  const selectedRoom = selectedRoomId ? (summaryByRoom.get(selectedRoomId) ?? null) : null;
  const selectedRoomState = selectedRoom
    ? mode === 'LIFE'
      ? selectedRoom.state
      : selectedRoom.environmentState
    : null;
  const selectedRoomEntry = roomEntries.find(({ room }) => room.id === selectedRoomId) ?? null;
  const dwell = summary?.dwellByRoom.find(({ id }) => id === selectedRoomId) ?? null;
  const chartBuckets = summary?.reliableBuckets ?? [];
  const chartValues = chartBuckets.map((bucket) =>
    selectedRoomId ? (bucket.byRoom[selectedRoomId] ?? 0) : bucket.seconds,
  );
  const chartMaximum = Math.max(1, ...chartValues);
  const filteredSequences = (summary?.sequences ?? []).filter(
    (sequence) => !selectedRoomId || sequence.roomIds.includes(selectedRoomId),
  );
  const allStairs = [
    ...new Map(levels.flatMap(({ stairs }) => stairs).map((stair) => [stair.id, stair])).values(),
  ].filter(
    (stair) =>
      selectedLevelId === 'all' ||
      stair.fromFloorId === selectedLevelId ||
      stair.toFloorId === selectedLevelId,
  );
  const levelName = (id: string) => levels.find((level) => level.id === id)?.name ?? id;
  const confirmedChanges =
    routines?.coverageSufficient && routines.learningDays >= routines.requiredLearningDays
      ? routines.changes.filter((change) => !selectedRoomId || change.roomId === selectedRoomId)
      : [];

  if (loading && !summary)
    return (
      <DataLoadingScreen
        locale={locale}
        message={fr ? 'Préparation de l’activité du logement…' : 'Preparing home activity…'}
      />
    );

  return (
    <section className="activity-overview-page">
      <header className={`activity-overview-hero activity-overview-hero--${status.tone}`}>
        <div className="activity-overview-hero-copy">
          <span className="activity-overview-status-icon" aria-hidden="true">
            <StatusIcon />
          </span>
          <div>
            <span className="eyebrow">{homeName}</span>
            <h2>{status.title}</h2>
            <div className="activity-overview-meta">
              <span className={`activity-state-pill activity-state-pill--${status.tone}`}>
                <CircleDot /> {status.label}
              </span>
              {summary?.lastReliableActivity ? (
                <span className="activity-last-reliable">
                  <Clock3 />
                  <span>
                    <strong>{summary.lastReliableActivity.roomName}</strong>
                    {clock(summary.lastReliableActivity.occurredAt, locale, timeZone)} ·{' '}
                    {relativeTime(summary.lastReliableActivity.occurredAt, locale)}
                  </span>
                </span>
              ) : (
                <span className="activity-last-reliable activity-last-reliable--empty">
                  <CircleDashed />
                  {fr ? 'Pas encore d’activité fiable' : 'No reliable activity yet'}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="activity-overview-hero-actions">
          {openAlerts > 0 && (
            <button className="activity-alert-link" onClick={onOpenAlerts}>
              <AlertTriangle />
              {fr
                ? `${openAlerts} alerte${openAlerts > 1 ? 's' : ''} à consulter`
                : `${openAlerts} alert${openAlerts > 1 ? 's' : ''} to review`}
              <ArrowRight />
            </button>
          )}
          <div
            className="activity-period-switch"
            role="group"
            aria-label={fr ? 'Période d’analyse' : 'Analysis period'}
          >
            {(['24h', '7d', '28d'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={period === value}
                onClick={() => {
                  setPeriod(value);
                  if (value !== '24h') setSelectedDate('');
                }}
              >
                {value === '24h'
                  ? fr
                    ? 'Aujourd’hui'
                    : 'Today'
                  : value === '7d'
                    ? fr
                      ? '7 jours'
                      : '7 days'
                    : fr
                      ? '28 jours'
                      : '28 days'}
              </button>
            ))}
          </div>
          <label className="activity-date-control">
            <CalendarDays />
            <span>{fr ? 'Autre jour' : 'Another day'}</span>
            <input
              type="date"
              value={selectedDate}
              max={currentDateKey(timeZone)}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                if (event.target.value) setPeriod('24h');
              }}
            />
          </label>
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

      <div
        className="activity-mode-tabs"
        role="tablist"
        aria-label={fr ? 'Type d’activité' : 'Activity view'}
      >
        <button role="tab" aria-selected={mode === 'LIFE'} onClick={() => setMode('LIFE')}>
          <Footprints /> {fr ? 'Vie du domicile' : 'Home life'}
        </button>
        <button
          role="tab"
          aria-selected={mode === 'ENVIRONMENT'}
          onClick={() => setMode('ENVIRONMENT')}
        >
          <Thermometer /> {fr ? 'Environnement & équipements' : 'Environment & equipment'}
        </button>
      </div>

      <div className="activity-overview-main-grid">
        <div className="activity-overview-primary">
          <article className="activity-surface-card activity-rhythm-card">
            <header className="activity-card-heading">
              <div>
                <span className="eyebrow">{fr ? 'Rythme observé' : 'Observed rhythm'}</span>
                <h3>
                  {selectedRoomEntry
                    ? selectedRoomEntry.room.name
                    : fr
                      ? 'Présence fiable dans le logement'
                      : 'Reliable presence in the home'}
                </h3>
              </div>
              <span className="activity-duration-pill">
                <Clock3 />{' '}
                {readableDuration(
                  selectedRoomId ? (dwell?.totalSeconds ?? 0) : (summary?.observedSeconds ?? 0),
                  locale,
                )}
              </span>
            </header>
            <div
              className="activity-rhythm-bars"
              aria-label={fr ? 'Temps de présence fiable' : 'Reliable presence time'}
            >
              {chartBuckets.map((bucket, index) => {
                const value = chartValues[index] ?? 0;
                return (
                  <div key={bucket.start}>
                    <span className="activity-rhythm-track">
                      <i
                        style={{
                          height: value ? `${Math.max(6, (value / chartMaximum) * 100)}%` : '3px',
                        }}
                        title={`${bucket.label} · ${readableDuration(value, locale)}`}
                      />
                    </span>
                    <small>{bucket.label}</small>
                  </div>
                );
              })}
            </div>
            <footer className="activity-rhythm-legend">
              <span>
                <i className="observed" /> {fr ? 'Présence fiable' : 'Reliable presence'}
              </span>
              {!selectedRoomId && (
                <span>
                  <i className="unknown" />{' '}
                  {readableDuration(summary?.unobservedSeconds ?? 0, locale)}{' '}
                  {fr ? 'sans donnée fiable' : 'without reliable data'}
                </span>
              )}
            </footer>
          </article>

          <article className="activity-surface-card activity-spaces-card">
            <header className="activity-card-heading activity-spaces-heading">
              <div>
                <span className="eyebrow">{fr ? 'Pièce par pièce' : 'Room by room'}</span>
                <h3>{fr ? 'Tout le logement reste visible' : 'The whole home stays visible'}</h3>
              </div>
              {selectedRoomId && (
                <button className="activity-clear-filter" onClick={() => setSelectedRoomId('')}>
                  {fr ? 'Tout le logement' : 'Whole home'}
                </button>
              )}
            </header>
            <div
              className="activity-floor-tabs"
              role="tablist"
              aria-label={fr ? 'Niveaux du logement' : 'Home levels'}
            >
              <button
                aria-selected={selectedLevelId === 'all'}
                onClick={() => {
                  setSelectedLevelId('all');
                  setSelectedRoomId('');
                }}
              >
                {fr ? 'Tous les niveaux' : 'All levels'}
              </button>
              {levels.map((level) => (
                <button
                  key={level.id}
                  aria-selected={selectedLevelId === level.id}
                  onClick={() => {
                    setSelectedLevelId(level.id);
                    setSelectedRoomId('');
                  }}
                >
                  {level.name}
                </button>
              ))}
            </div>
            <div className="activity-room-grid">
              {visibleRooms.map(({ room, level, activity: roomActivity }) => {
                const RoomIcon = roomIcon(room);
                const selected = selectedRoomId === room.id;
                const primaryReading = roomActivity.environment[0];
                const displayState =
                  mode === 'LIFE' ? roomActivity.state : roomActivity.environmentState;
                const needsAction = ['NOT_EQUIPPED', 'EQUIPMENT_ISSUE'].includes(displayState);
                return (
                  <article
                    className={`activity-room-card${selected ? ' is-selected' : ''}`}
                    key={room.id}
                  >
                    <button
                      className="activity-room-select"
                      aria-pressed={selected}
                      onClick={() => setSelectedRoomId(selected ? '' : room.id)}
                    >
                      <span
                        className="activity-room-icon"
                        style={{ background: room.geometry.color }}
                      >
                        <RoomIcon />
                      </span>
                      <span className="activity-room-copy">
                        <strong>{room.name}</strong>
                        <small>{level.name}</small>
                        {mode === 'LIFE' ? (
                          roomActivity.lastActivity ? (
                            <span>
                              {eventDescription(roomActivity.lastActivity, locale)} ·{' '}
                              {clock(roomActivity.lastActivity.occurredAt, locale, timeZone)}
                            </span>
                          ) : (
                            <span>{roomStateCopy(displayState, locale, mode)}</span>
                          )
                        ) : primaryReading ? (
                          <span>
                            {capabilityLabel(primaryReading.capability, locale)} ·{' '}
                            {primaryReading.latestValue}
                            {primaryReading.unit ? ` ${primaryReading.unit}` : ''}
                          </span>
                        ) : (
                          <span>{fr ? 'Aucune mesure disponible' : 'No reading available'}</span>
                        )}
                      </span>
                      <span
                        className={`activity-room-state activity-room-state--${displayState.toLowerCase()}`}
                      >
                        {roomStateCopy(displayState, locale, mode)}
                      </span>
                    </button>
                    {needsAction && canManage && (
                      <button className="activity-room-manage" onClick={() => onOpenRoom(room.id)}>
                        {displayState === 'NOT_EQUIPPED'
                          ? fr
                            ? 'Équiper cette pièce'
                            : 'Equip this room'
                          : fr
                            ? 'Vérifier l’équipement'
                            : 'Check equipment'}
                        <ArrowRight />
                      </button>
                    )}
                  </article>
                );
              })}
            </div>

            {allStairs.length > 0 && (
              <div className="activity-passages">
                <span className="eyebrow">
                  {fr ? 'Passages entre niveaux' : 'Between-floor passages'}
                </span>
                <div>
                  {allStairs.map((stair) => (
                    <button
                      key={stair.id}
                      onClick={() => canManage && onOpenStair(stair.id)}
                      disabled={!canManage}
                    >
                      <ChartNoAxesCombined />
                      <span>
                        <strong>
                          {levelName(stair.fromFloorId)} ↔ {levelName(stair.toFloorId)}
                        </strong>
                        <small>{fr ? 'Passage entre niveaux' : 'Between-floor passage'}</small>
                      </span>
                      {canManage && <ArrowRight />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedRoom && selectedRoomEntry && (
              <section className="activity-room-detail">
                <header>
                  <div>
                    <span className="eyebrow">{fr ? 'Détail de la pièce' : 'Room details'}</span>
                    <h4>{selectedRoom.name}</h4>
                  </div>
                  {canManage && (
                    <button onClick={() => onOpenRoom(selectedRoom.id)}>
                      {fr ? 'Ouvrir dans Mon logement' : 'Open in My home'} <ArrowRight />
                    </button>
                  )}
                </header>
                <div className="activity-room-metrics">
                  <span>
                    <small>{fr ? 'Temps observé' : 'Observed time'}</small>
                    <strong>{readableDuration(dwell?.totalSeconds ?? 0, locale)}</strong>
                  </span>
                  <span>
                    <small>{fr ? 'Séjour médian' : 'Median stay'}</small>
                    <strong>{readableDuration(dwell?.medianSeconds ?? 0, locale)}</strong>
                  </span>
                  <span>
                    <small>{fr ? 'Sessions fiables' : 'Reliable sessions'}</small>
                    <strong>{dwell ? `${dwell.reliableSessions}/${dwell.sessions}` : '—'}</strong>
                  </span>
                </div>
                {mode === 'ENVIRONMENT' && (
                  <div className="activity-environment-grid">
                    {selectedRoom.environment.map((reading) => {
                      const Icon = capabilityIcons[reading.capability] ?? Gauge;
                      return (
                        <article key={reading.capability}>
                          <header>
                            <Icon />
                            <span>{capabilityLabel(reading.capability, locale)}</span>
                          </header>
                          <strong>
                            {reading.latestValue}
                            {reading.unit ? ` ${reading.unit}` : ''}
                          </strong>
                          <MiniTrend
                            points={reading.points}
                            label={`${capabilityLabel(reading.capability, locale)} · ${selectedRoom.name}`}
                          />
                          <small>
                            {reading.minimum === null || reading.maximum === null
                              ? fr
                                ? 'Pas assez de recul'
                                : 'Not enough history'
                              : `${fr ? 'Min.' : 'Min'} ${reading.minimum}${reading.unit ? ` ${reading.unit}` : ''} · ${fr ? 'Max.' : 'Max'} ${reading.maximum}${reading.unit ? ` ${reading.unit}` : ''}`}
                          </small>
                        </article>
                      );
                    })}
                    {!selectedRoom.environment.length && (
                      <p className="activity-inline-empty">
                        {fr
                          ? 'Aucune mesure d’ambiance dans cette pièce.'
                          : 'No environmental reading in this room.'}
                      </p>
                    )}
                  </div>
                )}
                {selectedRoom.safety.length > 0 && (
                  <div className="activity-safety-row">
                    {selectedRoom.safety.map((event) => {
                      const Icon = capabilityIcons[event.capability] ?? ShieldAlert;
                      return (
                        <span key={event.id}>
                          <Icon /> {eventDescription(event, locale)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </article>
        </div>

        <aside className="activity-overview-side-column">
          <article className="activity-side-card activity-summary-card">
            <header>
              <div>
                <span className="eyebrow">{fr ? 'En bref' : 'At a glance'}</span>
                <h3>{fr ? 'Ce qu’il faut retenir' : 'What matters'}</h3>
              </div>
              <ShieldCheck />
            </header>
            <p>
              {selectedRoom
                ? selectedRoomState === 'NOT_EQUIPPED'
                  ? fr
                    ? mode === 'LIFE'
                      ? `${selectedRoom.name} n’est pas encore équipée pour observer la vie du domicile. Élise ne peut pas interpréter son silence.`
                      : `${selectedRoom.name} ne dispose pas encore de mesure d’environnement ou d’équipement.`
                    : mode === 'LIFE'
                      ? `${selectedRoom.name} is not equipped to observe home life yet. Élise cannot interpret its silence.`
                      : `${selectedRoom.name} does not have environmental or equipment readings yet.`
                  : selectedRoomState === 'EQUIPMENT_ISSUE'
                    ? fr
                      ? `Une donnée de ${selectedRoom.name} mérite d’être vérifiée avant toute conclusion.`
                      : `Data from ${selectedRoom.name} should be checked before drawing a conclusion.`
                    : mode === 'ENVIRONMENT'
                      ? selectedRoom.environment.length > 0
                        ? fr
                          ? `Les dernières mesures utiles de ${selectedRoom.name} sont disponibles ci-contre.`
                          : `The latest useful readings for ${selectedRoom.name} are available alongside.`
                        : fr
                          ? `Aucune mesure récente n’est disponible dans ${selectedRoom.name}, avec une couverture existante.`
                          : `No recent reading is available in ${selectedRoom.name}, with coverage available.`
                      : selectedRoom.lastActivity
                        ? fr
                          ? `La dernière activité fiable dans ${selectedRoom.name} a été observée à ${clock(selectedRoom.lastActivity.occurredAt, locale, timeZone)}.`
                          : `The latest reliable activity in ${selectedRoom.name} was observed at ${clock(selectedRoom.lastActivity.occurredAt, locale, timeZone)}.`
                        : fr
                          ? `Aucune activité récente n’a été observée dans ${selectedRoom.name}, avec une couverture disponible.`
                          : `No recent activity was observed in ${selectedRoom.name}, with coverage available.`
                : summary?.lastReliableActivity
                  ? fr
                    ? `La dernière activité fiable a été observée dans ${summary.lastReliableActivity.roomName} à ${clock(summary.lastReliableActivity.occurredAt, locale, timeZone)}.`
                    : `The latest reliable activity was observed in ${summary.lastReliableActivity.roomName} at ${clock(summary.lastReliableActivity.occurredAt, locale, timeZone)}.`
                  : fr
                    ? 'Aucune activité fiable ne permet encore de résumer cette période.'
                    : 'No reliable activity is available to summarize this period yet.'}
            </p>
            {confirmedChanges.map((change) => (
              <div className="activity-routine-change" key={change.roomId}>
                <Sparkles />
                <span>
                  {fr
                    ? `${change.roomName} est ${change.direction === 'HIGHER' ? 'plus active' : 'plus calme'} que d’habitude aujourd’hui.`
                    : `${change.roomName} is ${change.direction === 'HIGHER' ? 'more active' : 'quieter'} than usual today.`}
                </span>
              </div>
            ))}
          </article>

          {routines && routines.learningDays < routines.requiredLearningDays ? (
            <article className="activity-side-card activity-learning-card">
              <header>
                <div>
                  <span className="eyebrow">{fr ? 'Habitudes locales' : 'Local routines'}</span>
                  <h3>{fr ? 'Élise apprend progressivement' : 'Élise is learning gradually'}</h3>
                </div>
                <Sparkles />
              </header>
              <p>
                {fr
                  ? 'Les données restent visibles, mais Élise attend suffisamment de recul avant de comparer les habitudes.'
                  : 'Data remains visible, but Élise waits for enough history before comparing routines.'}
              </p>
              <div
                className="activity-learning-progress"
                aria-label={`${routines.learningDays}/${routines.requiredLearningDays}`}
              >
                <i style={{ width: `${Math.round(routines.progress * 100)}%` }} />
              </div>
              <small>
                {fr
                  ? `Jour ${Math.min(routines.learningDays, routines.requiredLearningDays)} sur ${routines.requiredLearningDays}`
                  : `Day ${Math.min(routines.learningDays, routines.requiredLearningDays)} of ${routines.requiredLearningDays}`}
              </small>
            </article>
          ) : (
            <article className="activity-side-card activity-coverage-card">
              <header>
                <div>
                  <span className="eyebrow">{fr ? 'Couverture' : 'Coverage'}</span>
                  <h3>{fr ? 'Lecture des pièces' : 'Room readings'}</h3>
                </div>
                <Radio />
              </header>
              {(['OBSERVED', 'NO_ACTIVITY', 'EQUIPMENT_ISSUE', 'NOT_EQUIPPED'] as const).map(
                (state) => {
                  const count =
                    summary?.rooms.filter(
                      (room) => (mode === 'LIFE' ? room.state : room.environmentState) === state,
                    ).length ?? 0;
                  return (
                    <div key={state}>
                      <span>{roomStateCopy(state, locale, mode)}</span>
                      <strong>{count}</strong>
                    </div>
                  );
                },
              )}
            </article>
          )}
        </aside>
      </div>

      <article className="activity-surface-card activity-sequences-card">
        <header className="activity-card-heading">
          <div>
            <span className="eyebrow">{fr ? 'Moments du quotidien' : 'Daily moments'}</span>
            <h3>{fr ? 'Ce qui s’est passé' : 'What happened'}</h3>
          </div>
          {selectedRoomEntry && (
            <span className="activity-duration-pill">
              <CircleDot /> {selectedRoomEntry.room.name}
            </span>
          )}
        </header>
        <div className="activity-sequence-list">
          {filteredSequences.slice(0, visibleSequences).map((sequence) => (
            <details className="activity-sequence" key={sequence.id}>
              <summary>
                <time>{clock(sequence.startedAt, locale, timeZone)}</time>
                <span className="activity-sequence-icon">
                  <Footprints />
                </span>
                <span className="activity-sequence-copy">
                  <strong>{sequenceSentence(sequence, locale)}</strong>
                  <small>
                    {relativeTime(sequence.startedAt, locale)} · {sequence.totalEventCount}{' '}
                    {fr ? 'événement(s)' : 'event(s)'}
                  </small>
                </span>
                <ChevronDown />
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
                    <div key={event.id}>
                      <span>
                        <Icon />
                      </span>
                      <div>
                        <strong>{eventDescription(event, locale)}</strong>
                        <small>
                          {event.roomName} ·{' '}
                          {event.sensorName ?? (fr ? 'Capteur du logement' : 'Home sensor')}
                        </small>
                      </div>
                      <time>
                        {clock(event.occurredAt, locale, timeZone)}
                        <small>
                          {event.quality === 'good'
                            ? fr
                              ? 'Fiable'
                              : 'Reliable'
                            : fr
                              ? 'À confirmer'
                              : 'To confirm'}
                        </small>
                      </time>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
          {!filteredSequences.length && (
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
