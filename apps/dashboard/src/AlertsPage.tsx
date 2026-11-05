import {
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  DoorOpen,
  Droplets,
  Flame,
  Filter,
  Hand,
  Info,
  MapPin,
  MoreVertical,
  Phone,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  WifiOff,
  X,
} from 'lucide-react';
import {
  configuredHomeDevicesForCategory,
  type HomePlan,
  type RoomSensorCategory,
  type SensorDevice,
} from '@elise/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentLanguage, dateLocale, type Locale, t } from './i18n';
import { DataLoadingScreen } from './DataLoadingScreen';
import './alerts-page.css';

type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
type AlertSeverity = 'INFO' | 'ATTENTION' | 'URGENT';
export interface Situation {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  explanation: string;
  openedAt: string;
  resolvedAt?: string | null;
  lastMovement?: { occurredAt: string; roomName: string | null } | null;
  room?: { id: string; name: string } | null;
  cameraSnapshots?: Array<{ id: string; capturedAt: string; expiresAt: string }>;
  transitions?: Array<{ id: string; to: AlertStatus; note: string | null; createdAt: string }>;
}
interface SituationDetail extends Situation {
  sensor: { id: string; sourceName: string | null; capability: string; unit: string | null } | null;
  observations: Array<{
    id: string;
    occurredAt: string;
    capability: string;
    quality: string;
    payload: unknown;
  }>;
}
type FilterStatus = 'ALL' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type SafetyCategory = Extract<RoomSensorCategory, 'fall_detection' | 'smoke' | 'water_leak'>;
type SafetyCoverage = { devices: SensorDevice[]; attentionCount: number };

const statusLabels: Record<AlertStatus, () => string> = {
  OPEN: () => t('alertsPage.statusLabels.OPEN'),
  ACKNOWLEDGED: () => t('alertsPage.statusLabels.ACKNOWLEDGED'),
  RESOLVED: () => t('alertsPage.statusLabels.RESOLVED'),
  DISMISSED: () => t('alertsPage.statusLabels.DISMISSED'),
};
const severityLabels: Record<AlertSeverity, () => string> = {
  INFO: () => t('alertsPage.severityLabels.INFO'),
  ATTENTION: () => t('alertsPage.severityLabels.ATTENTION'),
  URGENT: () => t('alertsPage.severityLabels.URGENT'),
};
const localDay = (value: string | Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const time = (value: string) =>
  new Intl.DateTimeFormat(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const relative = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' });
  if (minutes < 1) return t('alertsPage.justNow');
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  if (minutes < 1_440) return rtf.format(-Math.floor(minutes / 60), 'hour');
  return rtf.format(-Math.floor(minutes / 1_440), 'day');
};
const durationBetween = (start: string, end: string) => {
  const minutes = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return t('alertsPage.duration.minutes', { minutes });
  return remainingMinutes
    ? t('alertsPage.duration.hoursMinutes', { hours, minutes: remainingMinutes })
    : t('alertsPage.duration.hours', { hours });
};
const explanationFor = (item: Situation, locale: Locale, timezone: string) => {
  const safetyExplanations: Record<string, () => string> = {
    WATER_LEAK: () => t('alertsPage.explanationFor.safetyExplanations.WATER_LEAK'),
    SMOKE: () => t('alertsPage.explanationFor.safetyExplanations.SMOKE'),
    CARBON_MONOXIDE: () => t('alertsPage.explanationFor.safetyExplanations.CARBON_MONOXIDE'),
    FALL_DETECTION: () => t('alertsPage.explanationFor.safetyExplanations.FALL_DETECTION'),
    SOS: () => t('alertsPage.explanationFor.safetyExplanations.SOS'),
    SENSOR_OFFLINE: () => t('alertsPage.explanationFor.safetyExplanations.SENSOR_OFFLINE'),
  };
  if (safetyExplanations[item.type]) return safetyExplanations[item.type]!();
  if (item.type !== 'INACTIVITY') return item.explanation;
  if (!item.lastMovement) {
    return item.explanation.startsWith('Dernier mouvement fiable')
      ? item.explanation
      : t('alertsPage.noReliableMovementTimeIs');
  }
  const movement = item.lastMovement;
  const recordedAt = new Intl.DateTimeFormat(dateLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(movement.occurredAt));
  const gap = durationBetween(movement.occurredAt, item.openedAt);
  return movement.roomName
    ? t('alertsPage.lastReliableMovementIn', { recordedAt, room: movement.roomName, gap })
    : t('alertsPage.lastReliableMovement', { recordedAt, gap });
};
const iconFor = (type: string) => {
  if (type === 'TEMPERATURE') return Thermometer;
  if (type === 'SENSOR_OFFLINE') return WifiOff;
  if (type === 'DOOR_OPEN') return DoorOpen;
  if (type === 'WATER_LEAK') return Droplets;
  if (type === 'SMOKE') return Flame;
  if (['FALL_DETECTION', 'CARBON_MONOXIDE'].includes(type)) return ShieldAlert;
  if (type === 'SOS') return Hand;
  if (type === 'SYSTEM') return Info;
  return Bell;
};
const displayTitle = (item: Situation) => {
  const safetyTitles: Record<string, () => string> = {
    WATER_LEAK: () => t('alertsPage.displayTitle.safetyTitles.WATER_LEAK'),
    SMOKE: () => t('alertsPage.displayTitle.safetyTitles.SMOKE'),
    CARBON_MONOXIDE: () => t('alertsPage.displayTitle.safetyTitles.CARBON_MONOXIDE'),
    FALL_DETECTION: () => t('alertsPage.displayTitle.safetyTitles.FALL_DETECTION'),
    SOS: () => t('alertsPage.displayTitle.safetyTitles.SOS'),
  };
  if (safetyTitles[item.type]) return safetyTitles[item.type]!();
  if (item.type === 'SENSOR_OFFLINE') {
    const sensorName = item.title.replace(/ ne répond plus$/i, '');
    // The server writes this title in French; other languages rebuild it from the sensor name.
    return currentLanguage() === 'fr'
      ? item.title
      : t('alertsPage.sensorIsOffline', { sensorName });
  }
  return item.title;
};
const priorityLabel = (item: Situation) =>
  ['RESOLVED', 'DISMISSED'].includes(item.status)
    ? t('alertsPage.closed')
    : severityLabels[item.severity]();
const observedNumber = (payload: unknown): number | null => {
  if (!payload || typeof payload !== 'object' || !('value' in payload)) return null;
  const value = payload.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
};
const sensorEventText = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return t('alertsPage.sensorEvent');
  const value = payload as Record<string, unknown>;
  if (value.fallStatus === 'fall_alarm') return t('alertsPage.fallReported');
  if (value.fallStatus === 'fall_warning') return t('alertsPage.possibleFallReported');
  if (value.fallStatus === 'normal') return t('alertsPage.detectorReturnedToNormal');
  if (typeof value.active === 'boolean')
    return value.active ? t('alertsPage.detectionActive') : t('alertsPage.returnedToNormal');
  if (typeof value.open === 'boolean')
    return value.open ? t('alertsPage.openingDetected') : t('alertsPage.closed2');
  return t('alertsPage.sensorEvent');
};
const safetyCoverage = (
  plan: HomePlan,
  devices: SensorDevice[],
  category: SafetyCategory,
): SafetyCoverage => {
  const configured = configuredHomeDevicesForCategory(plan, devices, category);
  return {
    devices: configured,
    attentionCount: configured.filter(
      (device) =>
        !device.enabled ||
        device.installationStatus !== 'OPERATIONAL' ||
        device.capabilities.some(
          ({ capability, status }) => capability === category && status !== 'ONLINE',
        ),
    ).length,
  };
};
const safetyCoverageText = (
  coverage: SafetyCoverage | null,
  locale: Locale,
  loading: boolean,
  unavailable: boolean,
) => {
  if (loading) return t('alertsPage.loadingSensors');
  if (unavailable || !coverage) return t('alertsPage.homeDataUnavailable');
  const { devices, attentionCount } = coverage;
  if (!devices.length) return t('alertsPage.noDetectorConfigured');
  const onlineCount = devices.length - attentionCount;
  if (attentionCount === 0) return t('alertsPage.sensorsOnline', { count: devices.length });
  if (onlineCount === 0) return t('alertsPage.sensorsToCheck', { count: devices.length });
  return t('alertsPage.onlineToCheck', { onlineCount, attentionCount });
};
const safetyTone = (coverage: SafetyCoverage | null, loading: boolean, unavailable: boolean) =>
  loading
    ? 'pending'
    : unavailable || !coverage
      ? 'unavailable'
      : !coverage.devices.length
        ? 'unconfigured'
        : coverage.attentionCount
          ? 'attention'
          : 'online';
const advice = (type: string, residentName: string) => {
  const texts: Record<string, () => string> = {
    INACTIVITY: () => t('alertsPage.advice.INACTIVITY', { residentName }),
    TEMPERATURE: () => t('alertsPage.advice.TEMPERATURE', { residentName }),
    SENSOR_OFFLINE: () => t('alertsPage.advice.SENSOR_OFFLINE', { residentName }),
    DOOR_OPEN: () => t('alertsPage.advice.DOOR_OPEN', { residentName }),
    LOW_BATTERY: () => t('alertsPage.advice.LOW_BATTERY', { residentName }),
    SMOKE: () => t('alertsPage.advice.SMOKE', { residentName }),
    CARBON_MONOXIDE: () => t('alertsPage.advice.CARBON_MONOXIDE', { residentName }),
    WATER_LEAK: () => t('alertsPage.advice.WATER_LEAK', { residentName }),
    FALL_DETECTION: () => t('alertsPage.advice.FALL_DETECTION', { residentName }),
    MEDICATION_MISSED: () => t('alertsPage.advice.MEDICATION_MISSED', { residentName }),
    UNUSUAL_ACTIVITY: () => t('alertsPage.advice.UNUSUAL_ACTIVITY', { residentName }),
    SYSTEM: () => t('alertsPage.advice.SYSTEM', { residentName }),
    SOS: () => t('alertsPage.advice.SOS', { residentName }),
  };
  return texts[type]?.() ?? t('alertsPage.advice.default');
};

export function AlertsPage({
  locale,
  canManage,
  residentName,
  timezone,
  onSettings,
  onCall,
  onOpenHomeCategory = () => undefined,
  onChanged,
}: {
  locale: Locale;
  canManage: boolean;
  residentName: string;
  timezone: string;
  onSettings: () => void;
  onCall: () => Promise<void>;
  onOpenHomeCategory?: (category: SafetyCategory) => void;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<Situation[]>([]);
  const [urgentCount, setUrgentCount] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SituationDetail | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [severity, setSeverity] = useState<'ALL' | AlertSeverity>('ALL');
  const [room, setRoom] = useState('ALL');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [displayedCount, setDisplayedCount] = useState(8);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealedSnapshot, setRevealedSnapshot] = useState<string | null>(null);
  const [homePlan, setHomePlan] = useState<HomePlan | null>(null);
  const [homeSensorDevices, setHomeSensorDevices] = useState<SensorDevice[]>([]);
  const [safetyLoading, setSafetyLoading] = useState(true);
  const [safetyUnavailable, setSafetyUnavailable] = useState(false);
  const callConfirmationRef = useRef<HTMLDialogElement>(null);
  const safetyRequestRef = useRef<AbortController | null>(null);
  const safetyRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSafety = useCallback(async () => {
    safetyRequestRef.current?.abort();
    const controller = new AbortController();
    safetyRequestRef.current = controller;
    try {
      const [planResponse, devicesResponse] = await Promise.all([
        fetch('/api/v1/household/plan', { cache: 'no-store', signal: controller.signal }),
        fetch('/api/v1/sensor-devices', { cache: 'no-store', signal: controller.signal }),
      ]);
      if (!planResponse.ok || !devicesResponse.ok) throw new Error('home sensors');
      const [plan, devices] = await Promise.all([
        planResponse.json() as Promise<HomePlan>,
        devicesResponse.json() as Promise<SensorDevice[]>,
      ]);
      if (!Array.isArray(plan.placements) || !Array.isArray(devices))
        throw new Error('home sensors');
      setHomePlan(plan);
      setHomeSensorDevices(devices);
      setSafetyUnavailable(false);
    } catch {
      if (!controller.signal.aborted) setSafetyUnavailable(true);
    } finally {
      if (!controller.signal.aborted) setSafetyLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSafety();
    return () => safetyRequestRef.current?.abort();
  }, [refreshSafety]);

  const refresh = useCallback(async () => {
    try {
      const [response, summaryResponse] = await Promise.all([
        fetch('/api/v1/alerts/feed?limit=30'),
        fetch('/api/v1/alerts/summary'),
      ]);
      if (!response.ok) throw new Error();
      const page = (await response.json()) as { items: Situation[]; nextCursor: string | null };
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setUrgentCount(
        summaryResponse.ok
          ? ((await summaryResponse.json()) as { urgentCount: number }).urgentCount
          : null,
      );
      setNotice('');
    } catch {
      setUrgentCount(null);
      setNotice(t('alertsPage.couldNotLoadSituations'));
    } finally {
      setLoading(false);
    }
  }, [locale]);
  useEffect(() => {
    void refresh();
    const stream = new EventSource('/api/v1/events');
    stream.onmessage = (message: MessageEvent<string>) => {
      let type = '';
      try {
        type = (JSON.parse(message.data) as { type?: string }).type ?? '';
      } catch {
        void refresh();
        return;
      }
      if (type === 'heartbeat') return;
      if (type === 'connected') {
        void refresh();
        void refreshSafety();
        return;
      }
      if (type === 'alerts') void refresh();
      if (type === 'household') {
        if (safetyRefreshTimerRef.current) clearTimeout(safetyRefreshTimerRef.current);
        safetyRefreshTimerRef.current = setTimeout(() => {
          safetyRefreshTimerRef.current = null;
          void refreshSafety();
        }, 300);
      }
    };
    return () => {
      stream.close();
      if (safetyRefreshTimerRef.current) clearTimeout(safetyRefreshTimerRef.current);
      safetyRequestRef.current?.abort();
    };
  }, [refresh, refreshSafety]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/v1/alerts/feed?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!response.ok) throw new Error();
      const page = (await response.json()) as { items: Situation[]; nextCursor: string | null };
      setItems((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((entry) => entry.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch {
      setNotice(t('alertsPage.olderSituationsAreUnavailable'));
    } finally {
      setLoadingMore(false);
    }
  };
  const rooms = useMemo(
    () => [
      ...new Map(
        items.filter((item) => item.room).map((item) => [item.room!.id, item.room!]),
      ).values(),
    ],
    [items],
  );
  const matchingFilters = items.filter(
    (item) =>
      (filter === 'ALL' ||
        (filter === 'RESOLVED'
          ? ['RESOLVED', 'DISMISSED'].includes(item.status)
          : item.status === filter)) &&
      (severity === 'ALL' || item.severity === severity) &&
      (room === 'ALL' || item.room?.id === room),
  );
  const today = localDay(new Date(), timezone);
  const isToday = (value: string) => localDay(value, timezone) === today;
  const isOngoing = (item: Situation) => ['OPEN', 'ACKNOWLEDGED'].includes(item.status);
  const currentItems = matchingFilters.filter((item) => isToday(item.openedAt) || isOngoing(item));
  const olderItems = matchingFilters.filter((item) => !isToday(item.openedAt) && !isOngoing(item));
  const olderCount = olderItems.length;
  const filtered = showHistory ? olderItems : currentItems;
  const visible = filtered.slice(0, displayedCount);
  const hasMoreLoaded = filtered.length > visible.length;
  const extraFilterCount = Number(severity !== 'ALL') + Number(room !== 'ALL');
  useEffect(() => {
    setDisplayedCount(8);
  }, [filter, severity, room, showHistory]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    fetch(`/api/v1/alerts/${encodeURIComponent(selected.id)}/detail`)
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<SituationDetail>;
      })
      .then((result) => {
        if (live) setDetail(result);
      })
      .catch(() => {
        if (live) setNotice(t('alertsPage.detailsAreUnavailable'));
      });
    return () => {
      live = false;
    };
  }, [selected?.id, selected?.status, locale]);
  const actualDetail = detail?.id === selected?.id ? detail : null;
  const safetyCoverages = useMemo(
    () =>
      homePlan
        ? {
            fall: safetyCoverage(homePlan, homeSensorDevices, 'fall_detection'),
            smoke: safetyCoverage(homePlan, homeSensorDevices, 'smoke'),
            water: safetyCoverage(homePlan, homeSensorDevices, 'water_leak'),
          }
        : null,
    [homePlan, homeSensorDevices],
  );
  const observations =
    actualDetail?.observations.filter((item) => item.quality !== 'INVALID') ?? [];
  const latest = observations[0];
  const latestValue = latest ? observedNumber(latest.payload) : null;
  const observationsForTimeline = observations.slice(0, 3);
  const timeline = selected
    ? [
        {
          id: 'opened',
          at: selected.openedAt,
          description: t('alertsPage.situationDetected'),
        },
        ...(actualDetail?.transitions ?? []).map((transition) => ({
          id: transition.id,
          at: transition.createdAt,
          description: `${statusLabels[transition.to]()}${transition.note ? ` · ${transition.note}` : ''}`,
        })),
        ...observationsForTimeline.map((observation) => ({
          id: observation.id,
          at: observation.occurredAt,
          description:
            observedNumber(observation.payload) !== null
              ? `${t('alertsPage.reading')} : ${new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(observedNumber(observation.payload)!)} ${actualDetail?.sensor?.unit ?? ''}`
              : sensorEventText(observation.payload),
        })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    : [];
  const transition = async (status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED', note?: string) => {
    if (!selected || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(`/api/v1/alerts/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...(note ? { note } : {}) }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('alertsPage.actionFailed'));
      }
      setDismissOpen(false);
      setMenuOpen(false);
      setDismissReason('');
      await Promise.all([refresh(), onChanged()]);
      const detailResponse = await fetch(
        `/api/v1/alerts/${encodeURIComponent(selected.id)}/detail`,
      );
      if (detailResponse.ok) setDetail((await detailResponse.json()) as SituationDetail);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('alertsPage.actionFailed'));
    } finally {
      setBusy(false);
    }
  };
  const call = async () => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await onCall();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('alertsPage.callFailed'));
    } finally {
      setBusy(false);
    }
  };
  const reassuranceCopy =
    items.length === 0
      ? t('alertsPage.reassurance.empty')
      : showHistory
        ? t('alertsPage.reassurance.history', { count: visible.length })
        : t('alertsPage.reassurance.recent', { count: visible.length });
  if (loading)
    return <DataLoadingScreen locale={locale} message={t('alertsPage.loadingSituations')} />;

  return (
    <section className="alerts-page">
      <header className="page-hero alerts-hero">
        <div className="page-hero__copy alerts-hero-copy">
          <span className="page-hero__eyebrow">{t('alertsPage.homeAlerts')}</span>
          <h1 className="page-hero__title">{t('alertsPage.alerts')}</h1>
          <p className="page-hero__text">{t('alertsPage.forEachSituationWhatWas')}</p>
        </div>
        <div className="page-hero__actions">
          <button className="alerts-outline alerts-settings" type="button" onClick={onSettings}>
            <Settings /> {t('alertsPage.alertRules')}
          </button>
        </div>
      </header>
      <section className="alerts-safety-grid" aria-label={t('alertsPage.homeSafetySensors')}>
        {(
          [
            {
              category: 'fall_detection',
              coverage: safetyCoverages?.fall ?? null,
              icon: ShieldAlert,
              iconClass: 'fall',
              eyebrow: () => t('alertsPage.safetyCard.personalSafety'),
              title: () => t('alertsPage.safetyCard.fall'),
            },
            {
              category: 'smoke',
              coverage: safetyCoverages?.smoke ?? null,
              icon: Flame,
              iconClass: 'smoke',
              eyebrow: () => t('alertsPage.safetyCard.homeSafety'),
              title: () => t('alertsPage.safetyCard.smoke'),
            },
            {
              category: 'water_leak',
              coverage: safetyCoverages?.water ?? null,
              icon: Droplets,
              iconClass: 'water',
              eyebrow: () => t('alertsPage.safetyCard.homeSafety'),
              title: () => t('alertsPage.safetyCard.water'),
            },
          ] as const
        ).map(({ category, coverage, icon: Icon, iconClass, eyebrow, title }) => {
          const tone = safetyTone(coverage, safetyLoading, safetyUnavailable);
          const cardContent = (
            <>
              <span className={`alerts-safety-icon alerts-safety-icon--${iconClass}`}>
                <Icon aria-hidden="true" />
              </span>
              <div className="alerts-safety-copy">
                <span className="alerts-safety-eyebrow">{eyebrow()}</span>
                <h2>{title()}</h2>
                <p>{safetyCoverageText(coverage, locale, safetyLoading, safetyUnavailable)}</p>
              </div>
            </>
          );
          const canConfigure = canManage && tone === 'unconfigured';
          return (
            <article
              className={`alerts-safety-card alerts-safety-card--${tone}${canConfigure ? ' alerts-safety-card--action' : ''}`}
              key={category}
            >
              {canConfigure ? (
                <button
                  type="button"
                  className="alerts-safety-card-trigger"
                  aria-label={t('alertsPage.configureInMyHome', { name: title() })}
                  onClick={() => onOpenHomeCategory(category)}
                >
                  {cardContent}
                  <ChevronRight aria-hidden="true" />
                </button>
              ) : (
                cardContent
              )}
            </article>
          );
        })}
      </section>
      <div
        className={`alerts-reassurance${urgentCount ? ' alerts-reassurance--urgent' : ''}`}
        role="status"
      >
        <span className="alerts-reassurance-icon">
          <ShieldCheck aria-hidden="true" />
        </span>
        <div>
          <h2>
            {urgentCount === null
              ? t('alertsPage.urgencyStatusUnavailable')
              : urgentCount > 0
                ? t('alertsPage.urgentAlertsActive', { count: urgentCount })
                : t('alertsPage.noUrgentAlertInProgress')}
          </h2>
          <p>{reassuranceCopy}</p>
        </div>
      </div>
      {notice && (
        <div className="alerts-notice" role="alert">
          {notice}
          <button type="button" onClick={() => setNotice('')} aria-label={t('alertsPage.close')}>
            <X />
          </button>
        </div>
      )}
      <div className="alerts-layout">
        <div className="alerts-list-panel">
          <div className="alerts-list-head">
            <div className="alerts-section-title">
              <span>
                <ClipboardList />
              </span>
              <h2>
                {showHistory
                  ? t('alertsPage.situationHistory')
                  : t('alertsPage.recentAndOngoingSituations')}
              </h2>
            </div>
            <div className="alerts-list-controls">
              <div
                className="alerts-tabs"
                role="group"
                aria-label={t('alertsPage.filterSituations')}
              >
                {(['ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={filter === status}
                    onClick={() => setFilter(status)}
                  >
                    {status === 'ALL'
                      ? showHistory
                        ? t('alertsPage.statusFilter.all')
                        : t('alertsPage.statusFilter.current')
                      : status === 'OPEN'
                        ? t('alertsPage.statusFilter.open')
                        : status === 'ACKNOWLEDGED'
                          ? t('alertsPage.statusFilter.acknowledged')
                          : t('alertsPage.statusFilter.resolved')}
                  </button>
                ))}
              </div>
              <button
                className="alerts-outline alerts-filter-button"
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <Filter />
                {t('alertsPage.filters')}
                {extraFilterCount > 0 && (
                  <span className="alerts-filter-count">{extraFilterCount}</span>
                )}
                <ChevronDown className={filtersOpen ? 'is-open' : ''} />
              </button>
            </div>
          </div>
          {filtersOpen && (
            <div className="alerts-extra-filters">
              <div className="alerts-filter-panel-heading">
                <div>
                  <strong>{t('alertsPage.refineSituations')}</strong>
                  <span>{t('alertsPage.resultCount', { count: filtered.length })}</span>
                </div>
                {extraFilterCount > 0 && (
                  <button
                    className="alerts-filter-reset"
                    type="button"
                    onClick={() => {
                      setSeverity('ALL');
                      setRoom('ALL');
                    }}
                  >
                    {t('alertsPage.reset')}
                  </button>
                )}
              </div>
              <div
                className="alerts-filter-group"
                role="group"
                aria-label={t('alertsPage.priority')}
              >
                <span className="alerts-filter-label">{t('alertsPage.priority')}</span>
                <div className="alerts-filter-options">
                  {(['ALL', 'INFO', 'ATTENTION', 'URGENT'] as const).map((value) => (
                    <button
                      key={value}
                      className={`alerts-filter-option${severity === value ? ' is-active' : ''}`}
                      type="button"
                      aria-pressed={severity === value}
                      onClick={() => setSeverity(value)}
                    >
                      {value === 'ALL' ? t('alertsPage.all') : severityLabels[value]()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="alerts-filter-group" role="group" aria-label={t('alertsPage.room')}>
                <span className="alerts-filter-label">{t('alertsPage.room')}</span>
                <div className="alerts-filter-options alerts-filter-options--rooms">
                  <button
                    className={`alerts-filter-option${room === 'ALL' ? ' is-active' : ''}`}
                    type="button"
                    aria-pressed={room === 'ALL'}
                    onClick={() => setRoom('ALL')}
                  >
                    {t('alertsPage.allRooms')}
                  </button>
                  {rooms.map((value) => (
                    <button
                      key={value.id}
                      className={`alerts-filter-option${room === value.id ? ' is-active' : ''}`}
                      type="button"
                      aria-pressed={room === value.id}
                      onClick={() => setRoom(value.id)}
                    >
                      {value.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="alerts-cards">
            {!visible.length && (
              <div className="alerts-empty">
                <CheckCircle2 />
                <h3>
                  {loadingMore
                    ? showHistory
                      ? t('alertsPage.loadingHistory')
                      : t('alertsPage.loadingSituations')
                    : t('alertsPage.noSituationsToShow')}
                </h3>
                <p>
                  {olderCount > 0 && !showHistory
                    ? t('alertsPage.emptyWithHistory')
                    : t('alertsPage.emptyTryAnotherFilter')}
                </p>
              </div>
            )}
            {visible.map((item) => {
              const Icon = iconFor(item.type);
              return (
                <button
                  className={`alerts-situation alerts-situation--${['RESOLVED', 'DISMISSED'].includes(item.status) ? 'resolved' : item.severity.toLowerCase()}${selected?.id === item.id ? ' is-selected' : ''}`}
                  key={item.id}
                  type="button"
                  aria-pressed={selected?.id === item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setMenuOpen(false);
                    setDismissOpen(false);
                  }}
                >
                  <span className="alerts-situation-icon">
                    <Icon />
                  </span>
                  <span className="alerts-situation-content">
                    <span className="alerts-situation-top">
                      <span className="alerts-chip alerts-chip--severity">
                        {['RESOLVED', 'DISMISSED'].includes(item.status) ? (
                          <CheckCircle2 />
                        ) : item.severity === 'INFO' ? (
                          <Info />
                        ) : (
                          <Bell />
                        )}
                        {priorityLabel(item)}
                      </span>
                      <span
                        className={`alerts-chip alerts-chip--status alerts-chip--${item.status.toLowerCase()}`}
                      >
                        <i />
                        {statusLabels[item.status]()}
                      </span>
                    </span>
                    <strong>{displayTitle(item)}</strong>
                    <span className="alerts-situation-desc">
                      {explanationFor(item, locale, timezone)}
                    </span>
                    <span className="alerts-situation-meta">
                      <MapPin />
                      {item.room?.name ?? t('alertsPage.home')}
                      <b>·</b>
                      {item.type === 'INACTIVITY'
                        ? `${t('alertsPage.triggered')} ${relative(item.openedAt)}`
                        : relative(item.openedAt)}
                    </span>
                  </span>
                  <ChevronRight className="alerts-situation-arrow" />
                </button>
              );
            })}
          </div>
          <div className="alerts-pagination">
            {hasMoreLoaded && (
              <button
                className="alerts-older"
                type="button"
                onClick={() => setDisplayedCount((count) => count + 8)}
              >
                {t('alertsPage.show8MoreSituations')}
                <ChevronDown />
              </button>
            )}
            {!showHistory && !hasMoreLoaded && nextCursor && (
              <button
                className="alerts-older"
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  setDisplayedCount(visible.length + 8);
                  void loadMore();
                }}
              >
                {loadingMore ? t('alertsPage.loading') : t('alertsPage.loadMoreSituations')}
                <ChevronDown />
              </button>
            )}
            {!showHistory && olderCount > 0 && (
              <button
                className="alerts-history-toggle"
                type="button"
                onClick={() => setShowHistory(true)}
              >
                {t('alertsPage.viewOlderSituations')}
                {olderCount > 0 && <span>{olderCount}</span>}
                <ChevronDown />
              </button>
            )}
            {showHistory && !hasMoreLoaded && nextCursor && (
              <button
                className="alerts-older"
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  setDisplayedCount(visible.length + 8);
                  void loadMore();
                }}
              >
                {loadingMore ? t('alertsPage.loading') : t('alertsPage.loadMoreSituations')}
                <ChevronDown />
              </button>
            )}
            {showHistory && (
              <button
                className="alerts-history-toggle"
                type="button"
                onClick={() => setShowHistory(false)}
              >
                {t('alertsPage.backToCurrentSituations')}
              </button>
            )}
          </div>
        </div>
        <aside className="alerts-detail-panel" aria-label={t('alertsPage.situationDetails')}>
          {!selected ? (
            <div className="alerts-empty">
              <Bell />
              <h3>{t('alertsPage.selectASituation')}</h3>
              <p>{t('alertsPage.itsDetailsAndAvailableActions')}</p>
            </div>
          ) : (
            <>
              <div className="alerts-detail-header">
                <span
                  className={`alerts-detail-icon alerts-detail-icon--${selected.severity.toLowerCase()}`}
                >
                  {(() => {
                    const Icon = iconFor(selected.type);
                    return <Icon />;
                  })()}
                </span>
                <div>
                  <h2>{displayTitle(selected)}</h2>
                  <div className="alerts-detail-badges">
                    <span className="alerts-chip alerts-chip--severity">
                      <Bell />
                      {priorityLabel(selected)}
                    </span>
                    <span
                      className={`alerts-chip alerts-chip--status alerts-chip--${selected.status.toLowerCase()}`}
                    >
                      <i />
                      {statusLabels[selected.status]()}
                    </span>
                  </div>
                </div>
                <span className="alerts-detail-meta">
                  {selected.room?.name ?? t('alertsPage.home')} ·{' '}
                  {selected.type === 'INACTIVITY'
                    ? `${t('alertsPage.triggered')} ${relative(selected.openedAt)}`
                    : relative(selected.openedAt)}
                </span>
              </div>
              <p className="alerts-detail-explanation">
                {explanationFor(selected, locale, timezone)}
              </p>
              {latestValue !== null && (
                <div className="alerts-measure">
                  <span>
                    <Thermometer />
                  </span>
                  <div>
                    <strong>
                      {new Intl.NumberFormat(dateLocale(), {
                        maximumFractionDigits: 1,
                      }).format(latestValue)}{' '}
                      {actualDetail?.sensor?.unit ?? ''}{' '}
                      {selected.room ? `${t('alertsPage.in')} ${selected.room.name}` : ''}
                    </strong>
                    <p>
                      {t('alertsPage.latestReceivedReading')} · {relative(latest!.occurredAt)}
                    </p>
                  </div>
                </div>
              )}
              <div className="alerts-guidance">
                <div className="alerts-guidance-copy">
                  <span aria-hidden="true">
                    <Info />
                  </span>
                  <div>
                    <h3>{t('alertsPage.whatYouCanDo')}</h3>
                    <p>{advice(selected.type, residentName)}</p>
                  </div>
                </div>
                <div className="alerts-guidance-actions">
                  {canManage && selected.status === 'OPEN' && (
                    <button
                      className="alerts-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => void transition('ACKNOWLEDGED')}
                    >
                      <Hand />
                      {t('alertsPage.acknowledge')}
                    </button>
                  )}
                  <button
                    className="alerts-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => callConfirmationRef.current?.showModal()}
                  >
                    <Phone />
                    {t('alertsPage.call', { residentName })}
                  </button>
                </div>
              </div>
              {actualDetail?.cameraSnapshots && actualDetail.cameraSnapshots.length > 0 && (
                <div className="alerts-capture">
                  {revealedSnapshot === selected.id ? (
                    <img
                      src={`/api/v1/alerts/${selected.id}/snapshot`}
                      alt={t('alertsPage.snapshotAssociatedWithTheSituation')}
                    />
                  ) : (
                    <button type="button" onClick={() => setRevealedSnapshot(selected.id)}>
                      {t('alertsPage.showRoomSnapshot')}
                    </button>
                  )}
                </div>
              )}
              <div className="alerts-timeline">
                <h3>
                  <Clock3 />
                  {t('alertsPage.timeline')}
                </h3>
                <ol>
                  {timeline.map((entry) => (
                    <li key={entry.id}>
                      <time dateTime={entry.at}>{time(entry.at)}</time>
                      <span>{entry.description}</span>
                    </li>
                  ))}
                </ol>
                {!actualDetail && <p>{t('alertsPage.loadingEvents')}</p>}
              </div>
              {canManage && ['OPEN', 'ACKNOWLEDGED'].includes(selected.status) && (
                <div className="alerts-detail-footer">
                  <button
                    className="alerts-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => void transition('RESOLVED')}
                  >
                    <CheckCircle2 />
                    {t('alertsPage.markAsResolved')}
                  </button>
                  <div className="alerts-menu-wrap">
                    <button
                      className="alerts-outline alerts-menu-trigger"
                      type="button"
                      aria-label={t('alertsPage.moreActions')}
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen(!menuOpen)}
                    >
                      <MoreVertical />
                    </button>
                    {menuOpen && (
                      <div className="alerts-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setDismissOpen(true);
                            setMenuOpen(false);
                          }}
                        >
                          {t('alertsPage.reportAFalseAlert')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {dismissOpen && (
                <form
                  className="alerts-dismiss"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void transition('DISMISSED', dismissReason.trim());
                  }}
                >
                  <label>
                    {t('alertsPage.whyIsThisAlertFalse')}
                    <textarea
                      maxLength={1000}
                      required
                      value={dismissReason}
                      onChange={(event) => setDismissReason(event.target.value)}
                    />
                  </label>
                  <div>
                    <button
                      type="button"
                      className="alerts-outline"
                      onClick={() => setDismissOpen(false)}
                    >
                      {t('alertsPage.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="alerts-primary"
                      disabled={busy || !dismissReason.trim()}
                    >
                      <Check />
                      {t('alertsPage.confirm')}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </aside>
      </div>
      <dialog
        ref={callConfirmationRef}
        className="alerts-call-dialog"
        aria-labelledby="alerts-call-dialog-title"
        aria-describedby="alerts-call-dialog-description"
      >
        <div className="alerts-call-dialog-content">
          <h2 id="alerts-call-dialog-title">{t('alertsPage.confirmCallTo', { residentName })}</h2>
          <p id="alerts-call-dialog-description">{t('alertsPage.aCallRequestWillBe')}</p>
          <div className="alerts-call-dialog-actions">
            <button
              className="alerts-outline"
              type="button"
              onClick={() => callConfirmationRef.current?.close()}
            >
              {t('alertsPage.cancel')}
            </button>
            <button
              className="alerts-primary"
              type="button"
              disabled={busy}
              onClick={() => {
                callConfirmationRef.current?.close();
                void call();
              }}
            >
              <Phone />
              {t('alertsPage.call', { residentName })}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
