import {
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  DoorOpen,
  Filter,
  Hand,
  Info,
  MapPin,
  MoreVertical,
  Phone,
  Settings,
  ShieldCheck,
  Thermometer,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from './i18n';
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

const statusLabels: Record<AlertStatus, [string, string]> = {
  OPEN: ['Ouverte', 'Open'],
  ACKNOWLEDGED: ['Prise en charge', 'Acknowledged'],
  RESOLVED: ['Résolue', 'Resolved'],
  DISMISSED: ['Écartée', 'Dismissed'],
};
const severityLabels: Record<AlertSeverity, [string, string]> = {
  INFO: ['Information', 'Information'],
  ATTENTION: ['À vérifier', 'Needs attention'],
  URGENT: ['Urgence', 'Urgent'],
};
const label = (pair: [string, string], locale: Locale) => pair[locale === 'fr' ? 0 : 1];
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
const time = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const relative = (value: string, locale: Locale) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { numeric: 'auto' });
  if (minutes < 1) return label(['À l’instant', 'Just now'], locale);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  if (minutes < 1_440) return rtf.format(-Math.floor(minutes / 60), 'hour');
  return rtf.format(-Math.floor(minutes / 1_440), 'day');
};
const durationBetween = (start: string, end: string, locale: Locale) => {
  const minutes = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (locale === 'fr')
    return hours
      ? `${hours} h${remainingMinutes ? ` ${remainingMinutes} min` : ''}`
      : `${minutes} min`;
  return hours ? `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''}` : `${minutes}m`;
};
const explanationFor = (item: Situation, locale: Locale, timezone: string) => {
  if (item.type !== 'INACTIVITY') return item.explanation;
  if (!item.lastMovement) {
    return item.explanation.startsWith('Dernier mouvement fiable')
      ? item.explanation
      : label(
          [
            'Aucun horaire de mouvement fiable n’est disponible avant le déclenchement. Vérifiez les capteurs : une absence de données ne confirme pas une absence de mouvement.',
            'No reliable movement time is available before this alert. Check the sensors: missing data does not confirm that no movement occurred.',
          ],
          locale,
        );
  }
  const movement = item.lastMovement;
  const recordedAt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(movement.occurredAt));
  const gap = durationBetween(movement.occurredAt, item.openedAt, locale);
  return label(
    [
      `Dernier mouvement fiable enregistré le ${recordedAt}${movement.roomName ? `, dans ${movement.roomName}` : ''}. L’alerte a été déclenchée ${gap} après.`,
      `Last reliable movement recorded ${recordedAt}${movement.roomName ? `, in ${movement.roomName}` : ''}. The alert triggered ${gap} later.`,
    ],
    locale,
  );
};
const iconFor = (type: string) => {
  if (type === 'TEMPERATURE') return Thermometer;
  if (type === 'SENSOR_OFFLINE') return WifiOff;
  if (type === 'DOOR_OPEN') return DoorOpen;
  if (type === 'SYSTEM') return Info;
  return Bell;
};
const displayTitle = (item: Situation, locale: Locale) =>
  item.type === 'SENSOR_OFFLINE'
    ? label(
        [
          `Capteur${item.room?.name ? ` du ${item.room.name}` : ''} indisponible`,
          `Sensor${item.room?.name ? ` in ${item.room.name}` : ''} offline`,
        ],
        locale,
      )
    : item.title;
const priorityLabel = (item: Situation, locale: Locale) =>
  ['RESOLVED', 'DISMISSED'].includes(item.status)
    ? label(['Terminée', 'Closed'], locale)
    : label(severityLabels[item.severity], locale);
const observedNumber = (payload: unknown): number | null => {
  if (!payload || typeof payload !== 'object' || !('value' in payload)) return null;
  const value = payload.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
};
const advice = (type: string, locale: Locale, residentName: string) => {
  const texts: Record<string, [string, string]> = {
    INACTIVITY: [
      `L’absence de détection ne confirme pas à elle seule un problème. Envoyez une demande d’appel à ${residentName} sur son écran pour vérifier qu’il va bien. Sans réponse et si vous restez inquiet, demandez une vérification sur place.`,
      `No detected movement does not by itself confirm a problem. Send ${residentName} a call request on their screen to check that they are all right. If there is no answer and you remain concerned, ask someone to check in person.`,
    ],
    TEMPERATURE: [
      'Vérifiez le confort de la personne et le fonctionnement du chauffage ou de la ventilation.',
      'Check the resident’s comfort and the heating or ventilation.',
    ],
    SENSOR_OFFLINE: [
      'Vérifiez l’alimentation et la connexion du capteur. Tant qu’il est indisponible, certaines conclusions sont suspendues.',
      'Check the sensor’s power and connection. Some conclusions are suspended while it is offline.',
    ],
    DOOR_OPEN: [
      'Vérifiez si la porte est toujours ouverte et refermez-la si nécessaire.',
      'Check whether the door is still open and close it if needed.',
    ],
    LOW_BATTERY: [
      'Prévoyez de remplacer la pile du capteur.',
      'Plan to replace the sensor battery.',
    ],
    SMOKE: [
      'Si de la fumée est présente, mettez-vous en sécurité et appelez les secours.',
      'If smoke is present, get to safety and call emergency services.',
    ],
    CARBON_MONOXIDE: [
      'Évacuez le logement et appelez les secours si la détection est confirmée.',
      'Leave the home and call emergency services if the detection is confirmed.',
    ],
    WATER_LEAK: [
      'Vérifiez la zone concernée et coupez l’eau si nécessaire.',
      'Check the affected area and turn off the water if needed.',
    ],
    MEDICATION_MISSED: [
      'Vérifiez auprès de la personne si la dose a été prise avant toute nouvelle prise. En cas de doute, suivez les consignes du professionnel de santé.',
      'Check whether the dose was taken before giving another. If uncertain, follow the healthcare professional’s instructions.',
    ],
    UNUSUAL_ACTIVITY: [
      'Consultez les heures de détection dans la chronologie et vérifiez si ces mouvements correspondent aux habitudes de la nuit.',
      'Check the detection times in the timeline and whether this activity matches the usual nighttime pattern.',
    ],
    SYSTEM: [
      'Vérifiez les capteurs et leur connexion. Tant que les données sont insuffisantes, Élise ne peut pas évaluer correctement les situations qui en dépendent.',
      'Check the sensors and their connection. While data is insufficient, Élise cannot reliably assess situations that depend on them.',
    ],
    SOS: [
      'Contactez la personne ou les secours selon la situation.',
      'Contact the resident or emergency services as appropriate.',
    ],
  };
  return label(
    texts[type] ?? [
      'Consultez les faits et les heures indiqués, puis confirmez la situation avant de la clôturer.',
      'Review the recorded facts and times, then confirm the situation before closing it.',
    ],
    locale,
  );
};

export function AlertsPage({
  locale,
  canManage,
  residentName,
  timezone,
  onSettings,
  onCall,
  onChanged,
}: {
  locale: Locale;
  canManage: boolean;
  residentName: string;
  timezone: string;
  onSettings: () => void;
  onCall: () => Promise<void>;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealedSnapshot, setRevealedSnapshot] = useState<string | null>(null);
  const callConfirmationRef = useRef<HTMLDialogElement>(null);

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
      setNotice(
        label(['Impossible de charger les situations.', 'Could not load situations.'], locale),
      );
    } finally {
      setLoading(false);
    }
  }, [locale]);
  useEffect(() => {
    void refresh();
    const stream = new EventSource('/api/v1/events');
    stream.onmessage = () => void refresh();
    return () => stream.close();
  }, [refresh]);
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
      setNotice(
        label(
          [
            'Les anciennes situations ne sont pas accessibles.',
            'Older situations are unavailable.',
          ],
          locale,
        ),
      );
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
  const filtered = matchingFilters.filter(
    (item) =>
      showHistory || ['OPEN', 'ACKNOWLEDGED'].includes(item.status) || isToday(item.openedAt),
  );
  const hasOlderItems = matchingFilters.some((item) => !filtered.includes(item));
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
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
        if (live)
          setNotice(label(['Le détail est indisponible.', 'Details are unavailable.'], locale));
      });
    return () => {
      live = false;
    };
  }, [selected?.id, selected?.status, locale]);
  const actualDetail = detail?.id === selected?.id ? detail : null;
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
          description: label(['Situation détectée', 'Situation detected'], locale),
        },
        ...(actualDetail?.transitions ?? []).map((transition) => ({
          id: transition.id,
          at: transition.createdAt,
          description: `${label(statusLabels[transition.to], locale)}${transition.note ? ` · ${transition.note}` : ''}`,
        })),
        ...observationsForTimeline.map((observation) => ({
          id: observation.id,
          at: observation.occurredAt,
          description:
            observedNumber(observation.payload) !== null
              ? `${label(['Mesure', 'Reading'], locale)} : ${new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 }).format(observedNumber(observation.payload)!)} ${actualDetail?.sensor?.unit ?? ''}`
              : label(['Événement du capteur', 'Sensor event'], locale),
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
        throw new Error(body?.message ?? label(['Action impossible.', 'Action failed.'], locale));
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
      setNotice(
        error instanceof Error
          ? error.message
          : label(['Action impossible.', 'Action failed.'], locale),
      );
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
      setNotice(
        error instanceof Error
          ? error.message
          : label(['Appel impossible.', 'Call failed.'], locale),
      );
    } finally {
      setBusy(false);
    }
  };
  const reassuranceCopy: [string, string] =
    items.length === 0
      ? ['Aucune situation dans le flux récent.', 'No situations in the recent feed.']
      : [
          `${items.length} dernières situations reçues, de la plus récente à la plus ancienne${nextCursor ? ' ; les précédentes peuvent être chargées.' : '.'}`,
          `${items.length} latest recorded situations, newest first${nextCursor ? '; older situations can be loaded.' : '.'}`,
        ];
  if (loading)
    return (
      <DataLoadingScreen
        locale={locale}
        message={label(['Chargement des situations…', 'Loading situations…'], locale)}
      />
    );

  return (
    <section className="alerts-page">
      <header className="alerts-hero">
        <div className="alerts-hero-copy">
          <span>{label(['ALERTES DU DOMICILE', 'HOME ALERTS'], locale)}</span>
          <h1>{label(['Alertes', 'Alerts'], locale)}</h1>
          <p>
            {label(
              [
                'Pour chaque situation : le fait détecté, l’heure de déclenchement et ce qui peut être vérifié.',
                'For each situation: what was detected, when it triggered, and what you can check.',
              ],
              locale,
            )}
          </p>
        </div>
        <button className="alerts-outline alerts-settings" type="button" onClick={onSettings}>
          <Settings /> {label(['Règles des alertes', 'Alert rules'], locale)}
        </button>
      </header>
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
              ? label(['État des urgences indisponible', 'Urgency status unavailable'], locale)
              : urgentCount > 0
                ? label(
                    [
                      `${urgentCount} alerte${urgentCount > 1 ? 's' : ''} urgente${urgentCount > 1 ? 's' : ''} en cours`,
                      `${urgentCount} active urgent alert${urgentCount > 1 ? 's' : ''}`,
                    ],
                    locale,
                  )
                : label(['Aucune alerte urgente en cours', 'No urgent alert in progress'], locale)}
          </h2>
          <p>{label(reassuranceCopy, locale)}</p>
        </div>
      </div>
      {notice && (
        <div className="alerts-notice" role="alert">
          {notice}
          <button
            type="button"
            onClick={() => setNotice('')}
            aria-label={label(['Fermer', 'Close'], locale)}
          >
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
              <h2>{label(['Situation du jour', 'Today’s situations'], locale)}</h2>
            </div>
            <div className="alerts-list-controls">
              <div
                className="alerts-tabs"
                role="group"
                aria-label={label(['Filtrer les situations', 'Filter situations'], locale)}
              >
                {(['ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={filter === status}
                    onClick={() => setFilter(status)}
                  >
                    {label(
                      (
                        {
                          ALL: showHistory ? ['Toutes', 'All'] : ['Aujourd’hui', 'Today'],
                          OPEN: ['Ouvertes', 'Open'],
                          ACKNOWLEDGED: ['Prises en charge', 'Acknowledged'],
                          RESOLVED: ['Résolues', 'Resolved'],
                        } as const
                      )[status] as [string, string],
                      locale,
                    )}
                  </button>
                ))}
              </div>
              <button
                className="alerts-outline alerts-filter-button"
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <Filter /> {label(['Filtrer', 'Filter'], locale)}
              </button>
            </div>
          </div>
          {filtersOpen && (
            <div className="alerts-extra-filters">
              <label>
                {label(['Priorité', 'Priority'], locale)}
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as typeof severity)}
                >
                  <option value="ALL">{label(['Toutes', 'All'], locale)}</option>
                  {(['INFO', 'ATTENTION', 'URGENT'] as const).map((value) => (
                    <option key={value} value={value}>
                      {label(severityLabels[value], locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {label(['Pièce', 'Room'], locale)}
                <select value={room} onChange={(event) => setRoom(event.target.value)}>
                  <option value="ALL">{label(['Toutes les pièces', 'All rooms'], locale)}</option>
                  {rooms.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="alerts-cards">
            {!filtered.length && (
              <div className="alerts-empty">
                <CheckCircle2 />
                <h3>{label(['Aucune situation à afficher', 'No situations to show'], locale)}</h3>
                <p>
                  {label(
                    [
                      'Essayez un autre filtre ou revenez plus tard.',
                      'Try another filter or check back later.',
                    ],
                    locale,
                  )}
                </p>
              </div>
            )}
            {filtered.map((item) => {
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
                        {priorityLabel(item, locale)}
                      </span>
                      <span
                        className={`alerts-chip alerts-chip--status alerts-chip--${item.status.toLowerCase()}`}
                      >
                        <i />
                        {label(statusLabels[item.status], locale)}
                      </span>
                    </span>
                    <strong>{displayTitle(item, locale)}</strong>
                    <span className="alerts-situation-desc">
                      {explanationFor(item, locale, timezone)}
                    </span>
                    <span className="alerts-situation-meta">
                      <MapPin />
                      {item.room?.name ?? label(['Domicile', 'Home'], locale)}
                      <b>·</b>
                      {item.type === 'INACTIVITY'
                        ? `${label(['Signalée', 'Triggered'], locale)} ${relative(item.openedAt, locale)}`
                        : relative(item.openedAt, locale)}
                    </span>
                  </span>
                  <ChevronRight className="alerts-situation-arrow" />
                </button>
              );
            })}
          </div>
          {(hasOlderItems || nextCursor) && (
            <button
              className="alerts-older"
              type="button"
              disabled={loadingMore}
              onClick={() => {
                if (!showHistory) setShowHistory(true);
                else void loadMore();
              }}
            >
              {loadingMore
                ? label(['Chargement…', 'Loading…'], locale)
                : showHistory && nextCursor
                  ? label(['Charger d’autres situations', 'Load more situations'], locale)
                  : label(['Afficher les alertes précédentes', 'Show previous situations'], locale)}
              <ChevronDown />
            </button>
          )}
        </div>
        <aside
          className="alerts-detail-panel"
          aria-label={label(['Détail de la situation', 'Situation details'], locale)}
        >
          {!selected ? (
            <div className="alerts-empty">
              <Bell />
              <h3>{label(['Sélectionnez une situation', 'Select a situation'], locale)}</h3>
              <p>
                {label(
                  [
                    'Son détail et les actions possibles apparaîtront ici.',
                    'Its details and available actions will appear here.',
                  ],
                  locale,
                )}
              </p>
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
                  <h2>{displayTitle(selected, locale)}</h2>
                  <div className="alerts-detail-badges">
                    <span className="alerts-chip alerts-chip--severity">
                      <Bell />
                      {priorityLabel(selected, locale)}
                    </span>
                    <span
                      className={`alerts-chip alerts-chip--status alerts-chip--${selected.status.toLowerCase()}`}
                    >
                      <i />
                      {label(statusLabels[selected.status], locale)}
                    </span>
                  </div>
                </div>
                <span className="alerts-detail-meta">
                  {selected.room?.name ?? label(['Domicile', 'Home'], locale)} ·{' '}
                  {selected.type === 'INACTIVITY'
                    ? `${label(['Signalée', 'Triggered'], locale)} ${relative(selected.openedAt, locale)}`
                    : relative(selected.openedAt, locale)}
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
                      {new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
                        maximumFractionDigits: 1,
                      }).format(latestValue)}{' '}
                      {actualDetail?.sensor?.unit ?? ''}{' '}
                      {selected.room
                        ? `${label(['dans', 'in'], locale)} ${selected.room.name}`
                        : ''}
                    </strong>
                    <p>
                      {label(['Dernière mesure reçue', 'Latest received reading'], locale)} ·{' '}
                      {relative(latest!.occurredAt, locale)}
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
                    <h3>{label(['Ce que vous pouvez faire', 'What you can do'], locale)}</h3>
                    <p>{advice(selected.type, locale, residentName)}</p>
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
                      {label(['Prendre en charge', 'Acknowledge'], locale)}
                    </button>
                  )}
                  <button
                    className="alerts-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => callConfirmationRef.current?.showModal()}
                  >
                    <Phone />
                    {label([`Appeler ${residentName}`, `Call ${residentName}`], locale)}
                  </button>
                </div>
              </div>
              {actualDetail?.cameraSnapshots && actualDetail.cameraSnapshots.length > 0 && (
                <div className="alerts-capture">
                  {revealedSnapshot === selected.id ? (
                    <img
                      src={`/api/v1/alerts/${selected.id}/snapshot`}
                      alt={label(
                        [
                          'Capture associée à la situation',
                          'Snapshot associated with the situation',
                        ],
                        locale,
                      )}
                    />
                  ) : (
                    <button type="button" onClick={() => setRevealedSnapshot(selected.id)}>
                      {label(['Afficher la capture de la pièce', 'Show room snapshot'], locale)}
                    </button>
                  )}
                </div>
              )}
              <div className="alerts-timeline">
                <h3>
                  <Clock3 />
                  {label(['Chronologie', 'Timeline'], locale)}
                </h3>
                <ol>
                  {timeline.map((entry) => (
                    <li key={entry.id}>
                      <time dateTime={entry.at}>{time(entry.at, locale)}</time>
                      <span>{entry.description}</span>
                    </li>
                  ))}
                </ol>
                {!actualDetail && (
                  <p>{label(['Chargement des événements…', 'Loading events…'], locale)}</p>
                )}
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
                    {label(['Marquer comme résolue', 'Mark as resolved'], locale)}
                  </button>
                  <div className="alerts-menu-wrap">
                    <button
                      className="alerts-outline alerts-menu-trigger"
                      type="button"
                      aria-label={label(['Autres actions', 'More actions'], locale)}
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
                          {label(['Signaler une fausse alerte', 'Report a false alert'], locale)}
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
                    {label(
                      ['Pourquoi cette alerte est-elle fausse ?', 'Why is this alert false?'],
                      locale,
                    )}
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
                      {label(['Annuler', 'Cancel'], locale)}
                    </button>
                    <button
                      type="submit"
                      className="alerts-primary"
                      disabled={busy || !dismissReason.trim()}
                    >
                      <Check />
                      {label(['Confirmer', 'Confirm'], locale)}
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
          <h2 id="alerts-call-dialog-title">
            {label(
              [`Confirmer l’appel à ${residentName} ?`, `Confirm call to ${residentName}?`],
              locale,
            )}
          </h2>
          <p id="alerts-call-dialog-description">
            {label(
              [
                'Une demande d’appel sera envoyée à son écran.',
                'A call request will be sent to their screen.',
              ],
              locale,
            )}
          </p>
          <div className="alerts-call-dialog-actions">
            <button
              className="alerts-outline"
              type="button"
              onClick={() => callConfirmationRef.current?.close()}
            >
              {label(['Annuler', 'Cancel'], locale)}
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
              {label([`Appeler ${residentName}`, `Call ${residentName}`], locale)}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
