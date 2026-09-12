import { Ionicons } from '@expo/vector-icons';
import type {
  ActivitySummary,
  DashboardPeriod,
  Household,
  HomePlan,
  PlanRoom,
  PresenceEstimate,
  PresenceHistory,
  ScheduleItem,
  SensorDevice,
  SensorOnboardingSession,
  SensorPlacementGuide,
} from '@michel/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import EventSource, { type MessageEvent } from 'react-native-sse';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import {
  mobileApi,
  type ActivityItem,
  type AlertItem,
  type CameraItem,
  type CameraSession,
  type JournalItem,
  type Overview,
} from '../api';
import { caregiverPresenceCopy } from './presence-copy';
import type { SavedServer } from '../discovery/types';
import { activeServerUrl } from '../discovery/helpers';
import { subscribeNotificationNavigation } from '../notifications';
import { friendlyValue, relativeTime, roomOf } from './formatters';

type Tab = 'home' | 'activity' | 'alerts' | 'house' | 'journal';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const colors = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  paleGreen: '#E5EFE8',
  amber: '#D99A55',
  paleAmber: '#F7E9D7',
  red: '#B74747',
  paleBlue: '#E8F0F3',
};

const tabs: Array<{ id: Tab; label: string; icon: IconName; active: IconName }> = [
  { id: 'home', label: 'Accueil', icon: 'home-outline', active: 'home' },
  { id: 'activity', label: 'Activité', icon: 'pulse-outline', active: 'pulse' },
  { id: 'alerts', label: 'Alertes', icon: 'notifications-outline', active: 'notifications' },
  { id: 'house', label: 'Maison', icon: 'grid-outline', active: 'grid' },
  { id: 'journal', label: 'Journal', icon: 'book-outline', active: 'book' },
];

const capabilityMeta: Record<string, { label: string; icon: IconName }> = {
  motion: { label: 'Mouvement', icon: 'walk-outline' },
  occupancy: { label: 'Présence', icon: 'person-outline' },
  person_presence: { label: 'Personne détectée', icon: 'eye-outline' },
  contact: { label: 'Ouverture', icon: 'enter-outline' },
  button: { label: 'Bouton', icon: 'radio-button-on-outline' },
  temperature: { label: 'Température', icon: 'thermometer-outline' },
  humidity: { label: 'Humidité', icon: 'water-outline' },
  power: { label: 'Puissance', icon: 'flash-outline' },
  energy: { label: 'Énergie', icon: 'battery-charging-outline' },
  battery: { label: 'Batterie', icon: 'battery-half-outline' },
};

const detectedSensorLabels = {
  TEMPERATURE_HUMIDITY: 'Capteur de température et d’humidité',
  TEMPERATURE: 'Capteur de température',
  CONTACT: 'Capteur d’ouverture',
  MOTION: 'Détecteur de mouvement',
  PRESENCE: 'Capteur de présence',
  WATER_LEAK: 'Détecteur de fuite d’eau',
  SAFETY: 'Capteur de sécurité',
  SMART_PLUG: 'Prise connectée avec mesure',
  BUTTON: 'Bouton connecté',
  UNKNOWN: 'Capteur à identifier',
} as const;

const fullDate = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

interface DashboardAppProps {
  server: SavedServer;
  token: string;
  userName: string;
  onLogout: () => Promise<void>;
}

export function DashboardApp({ server, token, userName, onLogout }: DashboardAppProps) {
  const queryClient = useQueryClient();
  const rootKey = useMemo(() => ['michel', server.id] as const, [server.id]);
  const [tab, setTab] = useState<Tab>('home');
  const [period, setPeriod] = useState<DashboardPeriod>('24h');
  const [connected, setConnected] = useState(true);

  useEffect(() => subscribeNotificationNavigation(() => setTab('alerts')), []);

  const overview = useQuery({
    queryKey: [...rootKey, 'overview'],
    queryFn: () => mobileApi.overview(server, token),
  });
  const summary = useQuery({
    queryKey: [...rootKey, 'summary', period],
    queryFn: () => mobileApi.summary(server, token, period),
  });
  const household = useQuery({
    queryKey: [...rootKey, 'household'],
    queryFn: () => mobileApi.household(server, token),
  });
  const homePlan = useQuery({
    queryKey: [...rootKey, 'home-plan'],
    queryFn: () => mobileApi.homePlan(server, token),
  });
  const presence = useQuery({
    queryKey: [...rootKey, 'presence'],
    queryFn: () => mobileApi.presence(server, token),
    refetchInterval: 5_000,
  });
  const presenceHistory = useQuery({
    queryKey: [...rootKey, 'presence-history'],
    queryFn: () => mobileApi.presenceHistory(server, token),
  });
  const schedule = useQuery({
    queryKey: [...rootKey, 'schedule'],
    queryFn: () => mobileApi.schedule(server, token),
  });
  const activity = useInfiniteQuery({
    queryKey: [...rootKey, 'activity'],
    queryFn: ({ pageParam }) => mobileApi.activity(server, token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const alerts = useInfiniteQuery({
    queryKey: [...rootKey, 'alerts'],
    queryFn: ({ pageParam }) => mobileApi.alerts(server, token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const journal = useInfiniteQuery({
    queryKey: [...rootKey, 'journal'],
    queryFn: ({ pageParam }) => mobileApi.journal(server, token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const cameras = useQuery({
    queryKey: [...rootKey, 'cameras'],
    queryFn: () => mobileApi.cameras(server, token),
  });
  const sensorDevices = useQuery({
    queryKey: [...rootKey, 'sensor-devices'],
    queryFn: () => mobileApi.sensorDevices(server, token),
  });

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: rootKey });

  useEffect(() => {
    let stream: EventSource | null = null;
    let streamUrl = '';
    const open = () => {
      stream?.close();
      streamUrl = activeServerUrl(server);
      stream = new EventSource(`${streamUrl}/api/v1/events`, {
        headers: { Authorization: `Bearer ${token}` },
        pollingInterval: 3_000,
      });
      stream.addEventListener('open', () => setConnected(true));
      stream.addEventListener('error', () => setConnected(false));
      stream.addEventListener('message', (message: MessageEvent) => {
        if (!message.data) return;
        try {
          const event = JSON.parse(message.data) as { type: string };
          setConnected(true);
          if (event.type === 'heartbeat' || event.type === 'connected') return;
          const domains: Record<string, string[]> = {
            activity: ['overview', 'activity', 'summary', 'household', 'presence'],
            alerts: ['overview', 'alerts'],
            household: ['overview', 'household', 'sensor-devices', 'home-plan'],
            journal: ['journal'],
            schedule: ['overview', 'schedule'],
            presence: ['presence', 'presence-history'],
          };
          for (const domain of domains[event.type] ?? [])
            void queryClient.invalidateQueries({ queryKey: [...rootKey, domain] });
        } catch {
          // Ignore malformed local events; the next reconnect performs a full refresh.
        }
      });
    };
    open();
    const endpointCheck = setInterval(() => {
      if (activeServerUrl(server) !== streamUrl) open();
    }, 3_000);
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        open();
        void invalidateAll();
      } else stream?.close();
    });
    return () => {
      clearInterval(endpointCheck);
      state.remove();
      stream?.close();
    };
  }, [queryClient, rootKey, server, token]);

  const offline = !connected || (overview.isError && Boolean(overview.data));
  const lastUpdated = overview.dataUpdatedAt ? new Date(overview.dataUpdatedAt) : null;
  const activityItems = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const alertItems = alerts.data?.pages.flatMap((page) => page.items) ?? [];
  const journalItems = journal.data?.pages.flatMap((page) => page.items) ?? [];

  const logout = () => {
    Alert.alert('Se déconnecter ?', 'Les données conservées hors ligne seront supprimées.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: () => {
          queryClient.removeQueries({ queryKey: rootKey });
          void onLogout();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.hello}>Bonjour {userName.split(' ')[0] || userName},</Text>
          <Text style={styles.homeName}>{overview.data?.home?.name ?? server.instanceName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le menu du compte"
          style={styles.avatar}
          onPress={logout}
        >
          <Text style={styles.avatarText}>
            {userName
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'M'}
          </Text>
        </Pressable>
      </View>
      {offline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" color="#fff" size={17} />
          <Text style={styles.offlineText}>
            Hors ligne · dernières données{' '}
            {lastUpdated ? relativeTime(lastUpdated.toISOString()).toLowerCase() : 'enregistrées'}
          </Text>
        </View>
      ) : null}
      <View style={styles.content}>
        {tab === 'home' && (
          <HomeTab
            overview={overview.data}
            summary={summary.data}
            activity={activityItems}
            alerts={alertItems}
            schedule={schedule.data ?? []}
            presence={presence.data ?? null}
            presenceHistory={presenceHistory.data ?? null}
            refreshing={overview.isRefetching}
            onRefresh={invalidateAll}
            goTo={setTab}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab
            summary={summary.data}
            period={period}
            onPeriod={setPeriod}
            items={activityItems}
            refreshing={activity.isRefetching}
            onRefresh={invalidateAll}
            onMore={() => void activity.fetchNextPage()}
            hasMore={activity.hasNextPage}
          />
        )}
        {tab === 'alerts' && (
          <AlertsTab
            server={server}
            token={token}
            items={alertItems}
            refreshing={alerts.isRefetching}
            onRefresh={invalidateAll}
            onMore={() => void alerts.fetchNextPage()}
            hasMore={alerts.hasNextPage}
          />
        )}
        {tab === 'house' && (
          <HouseTab
            server={server}
            token={token}
            household={household.data ?? null}
            cameras={cameras.data ?? []}
            sensorDevices={sensorDevices.data ?? []}
            plan={homePlan.data ?? null}
            presence={presence.data ?? null}
            onSavePlan={async (next) => {
              const saved = await mobileApi.saveHomePlan(server, token, next);
              queryClient.setQueryData([...rootKey, 'home-plan'], saved);
              void queryClient.invalidateQueries({ queryKey: [...rootKey, 'household'] });
              return saved;
            }}
            refreshing={
              household.isRefetching ||
              cameras.isRefetching ||
              sensorDevices.isRefetching ||
              homePlan.isRefetching
            }
            onRefresh={invalidateAll}
          />
        )}
        {tab === 'journal' && (
          <JournalTab
            items={journalItems}
            schedule={schedule.data ?? []}
            refreshing={journal.isRefetching}
            onRefresh={invalidateAll}
            onMore={() => void journal.fetchNextPage()}
            hasMore={journal.hasNextPage}
          />
        )}
      </View>
      <View style={styles.tabBar}>
        {tabs.map((item) => {
          const active = item.id === tab;
          const badge =
            item.id === 'alerts'
              ? alertItems.filter((alert) => ['OPEN', 'ACKNOWLEDGED'].includes(alert.status)).length
              : 0;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={styles.tabButton}
              onPress={() => setTab(item.id)}
            >
              <View>
                <Ionicons
                  name={active ? item.active : item.icon}
                  color={active ? colors.blue : '#8A9299'}
                  size={21}
                />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{Math.min(badge, 9)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function Screen({
  children,
  refreshing,
  onRefresh,
}: React.PropsWithChildren<{ refreshing: boolean; onRefresh: () => void }>) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />
      }
      contentContainerStyle={styles.scroll}
    >
      {children}
    </ScrollView>
  );
}

function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

function HomeTab({
  overview,
  summary,
  activity,
  alerts,
  schedule,
  presence,
  presenceHistory,
  refreshing,
  onRefresh,
  goTo,
}: {
  overview?: Overview;
  summary?: ActivitySummary;
  activity: ActivityItem[];
  alerts: AlertItem[];
  schedule: ScheduleItem[];
  presence: PresenceEstimate | null;
  presenceHistory: PresenceHistory | null;
  refreshing: boolean;
  onRefresh: () => void;
  goTo: (tab: Tab) => void;
}) {
  const openAlerts = alerts.filter((item) => ['OPEN', 'ACKNOWLEDGED'].includes(item.status));
  const state =
    overview?.reassurance === 'ATTENTION'
      ? {
          icon: 'alert-circle-outline' as IconName,
          tone: colors.amber,
          label: 'Une situation demande votre attention',
          detail: 'Consultez les alertes en cours.',
        }
      : overview?.reassurance === 'INSUFFICIENT_DATA'
        ? {
            icon: 'help-circle-outline' as IconName,
            tone: colors.amber,
            label: 'Données insuffisantes',
            detail: 'Certains capteurs ne répondent pas correctement.',
          }
        : overview?.reassurance === 'LEARNING'
          ? {
              icon: 'sparkles-outline' as IconName,
              tone: colors.accent,
              label: 'Élise apprend les habitudes',
              detail: `Jour ${overview.learningDays ?? 0} sur 14.`,
            }
          : {
              icon: 'checkmark-circle-outline' as IconName,
              tone: colors.green,
              label: 'Tout semble normal',
              detail: 'Aucune situation inhabituelle détectée.',
            };
  const next = schedule.find((item) => new Date(item.startsAt) >= new Date());
  const [showPresenceWhy, setShowPresenceWhy] = useState(false);
  const presenceCopy = caregiverPresenceCopy(presence);
  const presenceIcon: IconName =
    presence?.trackingState === 'CONFIRMED'
      ? 'location-outline'
      : presence?.trackingState === 'IN_TRANSIT'
        ? 'navigate-outline'
        : presence?.trackingState === 'AMBIGUOUS'
          ? 'people-outline'
          : 'time-outline';
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={[styles.hero, { borderColor: `${state.tone}55` }]}>
        <View style={[styles.heroIcon, { backgroundColor: state.tone }]}>
          <Ionicons name={state.icon} color="#fff" size={26} />
        </View>
        <Text style={styles.eyebrow}>SITUATION ACTUELLE</Text>
        <Text style={styles.heroTitle}>{state.label}</Text>
        <Text style={styles.heroDetail}>{state.detail}</Text>
      </View>
      <View style={styles.card} accessibilityLabel="Suivi de présence du résident">
        <View style={styles.presenceSummaryHead}>
          <View
            style={[styles.smallIcon, presence?.trackingDegraded && styles.presenceWarningIcon]}
          >
            <Ionicons
              name={presenceIcon}
              size={20}
              color={presence?.trackingDegraded ? colors.amber : colors.blue}
            />
          </View>
          <View style={styles.presenceSummaryCopy}>
            <Text style={styles.eyebrow}>PRÉSENCE DU RÉSIDENT</Text>
            <Text style={styles.presenceSummaryTitle}>{presenceCopy.title}</Text>
            <Text style={styles.heroDetail}>
              {presenceCopy.detail}
              {'\n'}
              {presence?.lastEvidenceAt
                ? `${relativeTime(presence.lastEvidenceAt)} · confiance ${presence.confidence === 'HIGH' ? 'élevée' : presence.confidence === 'MEDIUM' ? 'moyenne' : 'faible'}`
                : 'En attente des capteurs de présence'}
            </Text>
          </View>
        </View>
        {presence?.trackingDegraded ? (
          <View style={styles.presenceWarning}>
            <Ionicons name="warning-outline" size={17} color={colors.amber} />
            <Text style={styles.presenceWarningText}>
              Suivi moins fiable : vérifiez la couverture des passages et les capteurs hors ligne.
            </Text>
          </View>
        ) : null}
        <View style={styles.presenceActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPresenceWhy((shown) => !shown)}
          >
            <Text style={styles.link}>
              {showPresenceWhy ? 'Masquer l’explication' : 'Pourquoi Élise pense cela ?'}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => goTo('house')}>
            <Text style={styles.link}>Voir sur le plan</Text>
          </Pressable>
        </View>
        {showPresenceWhy ? (
          <View style={styles.presenceWhy}>
            <Text style={styles.presenceWhyText}>{presence?.explanation}</Text>
            <Text style={styles.presenceWhyText}>{presenceCopy.why}</Text>
            {(presenceHistory?.items ?? []).slice(0, 3).map((decision) => (
              <View key={decision.id} style={styles.presenceDecisionRow}>
                <Text style={styles.presenceDecisionTime}>{relativeTime(decision.occurredAt)}</Text>
                <Text style={styles.presenceWhyText}>{decision.explanation}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.metricGrid}>
        <Metric
          icon="pulse-outline"
          label="DERNIÈRE ACTIVITÉ"
          value={overview?.lastActivity?.room ?? '—'}
          detail={relativeTime(overview?.lastActivity?.occurredAt)}
        />
        <Metric
          icon="hardware-chip-outline"
          label="CAPTEURS EN LIGNE"
          value={`${overview?.sensors?.online ?? 0}/${overview?.sensors?.total ?? 0}`}
          detail={
            (overview?.sensors?.degraded ?? 0) > 0
              ? `${overview?.sensors?.degraded} dégradé(s)`
              : 'Tous opérationnels'
          }
        />
        <Metric
          icon="notifications-outline"
          label="ALERTES"
          value={String(openAlerts.length)}
          detail={openAlerts.length ? 'À consulter' : 'Aucune en cours'}
        />
        <Metric
          icon="calendar-outline"
          label="PROCHAIN ÉVÉNEMENT"
          value={next?.title ?? 'Rien de prévu'}
          detail={next ? fullDate(next.startsAt) : 'Agenda libre'}
        />
      </View>
      <View style={styles.card}>
        <SectionTitle
          eyebrow="RYTHME DU FOYER"
          title="Activité sur 24 heures"
          action={
            <Pressable onPress={() => goTo('activity')}>
              <Text style={styles.link}>Voir tout</Text>
            </Pressable>
          }
        />
        <ActivityChart summary={summary} />
      </View>
      <View style={styles.card}>
        <SectionTitle eyebrow="DERNIERS ÉVÉNEMENTS" title="Ce qui vient de se passer" />
        {activity.slice(0, 4).map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))}
        {!activity.length ? (
          <Empty icon="pulse-outline" text="Aucune activité enregistrée." />
        ) : null}
      </View>
    </Screen>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: IconName;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.smallIcon}>
        <Ionicons name={icon} size={18} color={colors.blue} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text numberOfLines={1} style={styles.metricDetail}>
        {detail}
      </Text>
    </View>
  );
}

function ActivityChart({ summary }: { summary?: ActivitySummary }) {
  const width = 310;
  const height = 112;
  const values = summary?.buckets ?? [];
  const max = Math.max(1, ...values.map((item) => item.count));
  const gap = 4;
  const bar = values.length ? (width - gap * (values.length - 1)) / values.length : 0;
  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {values.map((item, index) => {
          const h = Math.max(3, (item.count / max) * 82);
          return (
            <Rect
              key={item.start}
              x={index * (bar + gap)}
              y={88 - h}
              width={bar}
              height={h}
              rx={Math.min(4, bar / 2)}
              fill={item.count === max ? colors.blue : '#AFC5D1'}
            />
          );
        })}
      </Svg>
      <View style={styles.chartLabels}>
        {values
          .filter(
            (_, index) =>
              index === 0 || index === values.length - 1 || index === Math.floor(values.length / 2),
          )
          .map((item) => (
            <Text key={item.start} style={styles.chartLabel}>
              {item.label}
            </Text>
          ))}
      </View>
    </View>
  );
}

function ActivityTab({
  summary,
  period,
  onPeriod,
  items,
  refreshing,
  onRefresh,
  onMore,
  hasMore,
}: {
  summary?: ActivitySummary;
  period: DashboardPeriod;
  onPeriod: (period: DashboardPeriod) => void;
  items: ActivityItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onMore: () => void;
  hasMore?: boolean;
}) {
  const [filter, setFilter] = useState('all');
  const capabilities = ['all', ...new Set(items.map((item) => item.capability))];
  const visible = filter === 'all' ? items : items.filter((item) => item.capability === filter);
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle eyebrow="ANALYSE" title="Activité du foyer" />
      <Segment
        options={[
          ['24h', '24 heures'],
          ['7d', '7 jours'],
          ['28d', '28 jours'],
        ]}
        value={period}
        onChange={(value) => onPeriod(value as DashboardPeriod)}
      />
      <View style={styles.card}>
        <View style={styles.totalRow}>
          <View>
            <Text style={styles.metricLabel}>ACTIVITÉS DÉTECTÉES</Text>
            <Text style={styles.bigNumber}>{summary?.total ?? 0}</Text>
          </View>
          <View style={styles.trendPill}>
            <Ionicons name="pulse" size={14} color={colors.green} />
            <Text style={styles.trendText}>Données locales</Text>
          </View>
        </View>
        <ActivityChart summary={summary} />
      </View>
      <View style={styles.card}>
        <SectionTitle eyebrow="PRÉSENCE" title="Temps passé par pièce" />
        {summary?.dwellByRoom.length ? (
          summary.dwellByRoom.slice(0, 5).map((room) => (
            <View key={room.id} style={styles.totalRow}>
              <View>
                <Text style={styles.metricLabel}>{room.name.toUpperCase()}</Text>
                <Text style={styles.trendText}>
                  {Math.round(room.totalSeconds / 60)} min · médiane{' '}
                  {Math.round(room.medianSeconds / 60)} min
                </Text>
              </View>
              <Text style={styles.trendText}>
                {room.reliableSessions}/{room.sessions} fiables
              </Text>
            </View>
          ))
        ) : (
          <Empty icon="time-outline" text="Pas encore de session fiable." />
        )}
      </View>
      <View style={styles.card}>
        <SectionTitle eyebrow="RÉPARTITION" title="Pièces les plus actives" />
        {summary?.byRoom.length ? (
          summary.byRoom
            .slice(0, 5)
            .map((room) => (
              <BarRow
                key={room.id ?? room.name}
                label={room.name}
                value={room.count}
                max={summary.byRoom[0]?.count ?? 1}
              />
            ))
        ) : (
          <Empty icon="grid-outline" text="Pas encore assez d’activité." />
        )}
      </View>
      <SectionTitle eyebrow="CHRONOLOGIE" title="Tous les événements" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {capabilities.map((item) => (
          <Chip
            key={item}
            active={filter === item}
            label={item === 'all' ? 'Tout' : (capabilityMeta[item]?.label ?? item)}
            onPress={() => setFilter(item)}
          />
        ))}
      </ScrollView>
      <View style={styles.card}>
        {visible.map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))}
        {!visible.length ? (
          <Empty icon="pulse-outline" text="Aucun événement pour ce filtre." />
        ) : null}
        {hasMore ? <LoadMore onPress={onMore} /> : null}
      </View>
    </Screen>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const meta = capabilityMeta[item.capability] ?? {
    label: item.capability,
    icon: 'ellipse-outline',
  };
  return (
    <View style={styles.listRow}>
      <View style={styles.rowIcon}>
        <Ionicons name={meta.icon} color={colors.blue} size={19} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>
          {meta.label} · {roomOf(item)}
        </Text>
        <Text style={styles.rowDetail}>
          {friendlyValue(item.payload) ?? relativeTime(item.occurredAt)}
        </Text>
      </View>
      <Text style={styles.rowTime}>
        {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(
          new Date(item.occurredAt),
        )}
      </Text>
    </View>
  );
}

function AlertsTab({
  server,
  token,
  items,
  refreshing,
  onRefresh,
  onMore,
  hasMore,
}: {
  server: SavedServer;
  token: string;
  items: AlertItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onMore: () => void;
  hasMore?: boolean;
}) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'history'>('open');
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
  const visible = items.filter((item) =>
    filter === 'open'
      ? ['OPEN', 'ACKNOWLEDGED'].includes(item.status)
      : ['RESOLVED', 'DISMISSED'].includes(item.status),
  );
  const mutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
    }) => mobileApi.transitionAlert(server, token, id, status),
    onSuccess: async () => {
      setSelected(null);
      await client.invalidateQueries({ queryKey: ['michel', server.id] });
    },
  });
  const act = (status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED') => {
    if (!selected) return;
    Alert.alert(
      'Confirmer cette action ?',
      status === 'ACKNOWLEDGED'
        ? 'L’alerte restera visible comme prise en charge.'
        : 'L’alerte quittera la liste des alertes ouvertes.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => mutation.mutate({ id: selected.id, status }) },
      ],
    );
  };
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle eyebrow="SUIVI" title="Alertes" />
      <Segment
        options={[
          [
            'open',
            `En cours (${items.filter((item) => ['OPEN', 'ACKNOWLEDGED'].includes(item.status)).length})`,
          ],
          ['history', 'Historique'],
        ]}
        value={filter}
        onChange={(value) => setFilter(value as typeof filter)}
      />
      <View style={styles.card}>
        {visible.map((item) => (
          <Pressable
            key={item.id}
            style={styles.alertRow}
            onPress={() => {
              setSnapshotVisible(false);
              setSelected(item);
            }}
          >
            <View
              style={[
                styles.severity,
                {
                  backgroundColor:
                    item.severity === 'URGENT'
                      ? colors.red
                      : item.severity === 'ATTENTION'
                        ? colors.amber
                        : colors.accent,
                },
              ]}
            />
            <View style={styles.rowCopy}>
              <View style={styles.alertMeta}>
                <Text style={styles.statusText}>
                  {item.status === 'ACKNOWLEDGED'
                    ? 'PRISE EN CHARGE'
                    : item.status === 'OPEN'
                      ? 'OUVERTE'
                      : item.status === 'RESOLVED'
                        ? 'RÉSOLUE'
                        : 'IGNORÉE'}
                </Text>
                <Text style={styles.rowTime}>{relativeTime(item.openedAt)}</Text>
              </View>
              <Text style={styles.alertTitle}>{item.title}</Text>
              <Text numberOfLines={2} style={styles.alertExplanation}>
                {item.explanation}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
        {!visible.length ? (
          <Empty
            icon="checkmark-circle-outline"
            text={
              filter === 'open'
                ? 'Aucune alerte ne demande votre attention.'
                : 'Aucune alerte dans l’historique.'
            }
          />
        ) : null}
        {hasMore ? <LoadMore onPress={onMore} /> : null}
      </View>
      <Modal
        visible={Boolean(selected)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Pressable style={styles.close} onPress={() => setSelected(null)}>
              <Ionicons name="close" size={22} color={colors.navy} />
            </Pressable>
            <Text style={styles.modalLabel}>DÉTAIL DE L’ALERTE</Text>
            <View style={styles.close} />
          </View>
          {selected ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View
                style={[
                  styles.largeAlertIcon,
                  { backgroundColor: selected.severity === 'URGENT' ? colors.red : colors.amber },
                ]}
              >
                <Ionicons name="notifications" color="#fff" size={30} />
              </View>
              <Text style={styles.modalTitle}>{selected.title}</Text>
              <Text style={styles.modalDate}>{fullDate(selected.openedAt)}</Text>
              <View style={styles.explanationCard}>
                <Text style={styles.explanationTitle}>Ce qu’Élise a observé</Text>
                <Text style={styles.explanationText}>{selected.explanation}</Text>
              </View>
              {selected.cameraSnapshots?.length ? (
                <View style={styles.mobileAlertSnapshot}>
                  {snapshotVisible ? (
                    <>
                      <Image
                        style={styles.mobileAlertSnapshotImage}
                        source={{
                          uri: `${activeServerUrl(server)}/api/v1/alerts/${selected.id}/snapshot`,
                          headers: { Authorization: `Bearer ${token}` },
                        }}
                      />
                      <Text style={styles.mobileAlertSnapshotNote}>
                        Image locale · suppression automatique après 24 h
                      </Text>
                    </>
                  ) : (
                    <Pressable
                      style={styles.mobileSnapshotButton}
                      onPress={() => setSnapshotVisible(true)}
                    >
                      <Ionicons name="image-outline" size={18} color={colors.green} />
                      <Text style={styles.mobileSnapshotButtonText}>
                        Afficher la capture de la pièce
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
              {selected.transitions?.length ? (
                <View style={styles.timeline}>
                  <Text style={styles.eyebrow}>HISTORIQUE</Text>
                  {selected.transitions.map((transition) => (
                    <View key={transition.id} style={styles.timelineRow}>
                      <View style={styles.timelineDot} />
                      <Text style={styles.timelineText}>
                        {transition.to} · {fullDate(transition.createdAt)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {['OPEN', 'ACKNOWLEDGED'].includes(selected.status) ? (
                <View style={styles.alertActions}>
                  {selected.status === 'OPEN' ? (
                    <Pressable style={styles.primaryButton} onPress={() => act('ACKNOWLEDGED')}>
                      <Text style={styles.primaryButtonText}>Prendre en charge</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.secondaryButton} onPress={() => act('RESOLVED')}>
                    <Text style={styles.secondaryButtonText}>Marquer comme résolue</Text>
                  </Pressable>
                  <Pressable onPress={() => act('DISMISSED')}>
                    <Text style={styles.dismissText}>Ignorer cette alerte</Text>
                  </Pressable>
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

function MobileSensors({
  server,
  token,
  devices,
  rooms,
  onRefresh,
}: {
  server: SavedServer;
  token: string;
  devices: SensorDevice[];
  rooms: Array<{ id: string; name: string; kind: string; floor: number; sortOrder: number }>;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<SensorDevice | null>(null);
  const [guide, setGuide] = useState<SensorPlacementGuide | null>(null);
  const [adding, setAdding] = useState(false);
  const [session, setSession] = useState<SensorOnboardingSession | null>(null);
  const [newSensorRoomId, setNewSensorRoomId] = useState<string | null>(null);
  const [newSensorName, setNewSensorName] = useState('');
  const [installingSensor, setInstallingSensor] = useState(false);
  const [pairingSeconds, setPairingSeconds] = useState(0);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!adding) return;
    void mobileApi
      .currentSensorOnboarding(server, token)
      .then((current) => {
        if (!current) return;
        setSession(current);
        if (current.detectedDevice) {
          setNewSensorName(detectedSensorLabels[current.detectedDevice.detectedType]);
        }
      })
      .catch(() => null);
  }, [adding, server, token]);

  useEffect(() => {
    if (!session || !['WAITING_FOR_DEVICE', 'PENDING'].includes(session.status)) return;
    const timer = setInterval(() => {
      void mobileApi.sensorOnboarding(server, token, session.id).then((next) => {
        setSession(next);
        if (next.status === 'DEVICE_FOUND') {
          if (next.detectedDevice) {
            setNewSensorName(detectedSensorLabels[next.detectedDevice.detectedType]);
          }
          onRefresh();
        }
      });
    }, 1_500);
    return () => clearInterval(timer);
  }, [onRefresh, server, session, token]);

  useEffect(() => {
    if (!session || session.status === 'DEVICE_FOUND') return;
    const update = () =>
      setPairingSeconds(
        Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1_000)),
      );
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [session]);

  const openDevice = (device: SensorDevice) => {
    setSelected(device);
    setGuide(null);
    void mobileApi
      .sensorPlacementGuide(server, token, device.id)
      .then(setGuide)
      .catch(() => null);
  };

  const updateRoom = (roomId: string | null) => {
    if (!selected) return;
    void mobileApi.updateSensorDevice(server, token, selected.id, { roomId }).then(() => {
      setSelected({ ...selected, room: rooms.find((room) => room.id === roomId) ?? null });
      onRefresh();
    });
  };

  const confirmCapability = (sensorId: string, capability: string) => {
    if (!selected) return;
    void mobileApi
      .confirmSensorClassification(server, token, selected.id, sensorId, capability)
      .then(() => {
        onRefresh();
        setSelected(null);
      });
  };

  const runTest = async () => {
    if (!selected) return;
    setTesting(true);
    const test = await mobileApi.startSensorVerification(server, token, selected.id);
    const timer = setInterval(() => {
      void mobileApi.sensorVerification(server, token, test.id).then((result) => {
        if (result.status === 'COMPLETED') {
          clearInterval(timer);
          setTesting(false);
          Alert.alert('Test réussi', 'Élise a reçu une nouvelle donnée de ce capteur.');
          onRefresh();
          setSelected(null);
        } else if (['EXPIRED', 'FAILED'].includes(result.status)) {
          clearInterval(timer);
          setTesting(false);
          Alert.alert(
            'Aucune donnée reçue',
            'Vérifiez la pile, la portée et le placement du capteur.',
          );
        }
      });
    }, 1_500);
  };

  const closeAdding = () => {
    if (session) void mobileApi.cancelSensorOnboarding(server, token, session.id);
    setAdding(false);
    setSession(null);
    setNewSensorRoomId(null);
    setNewSensorName('');
  };

  const finishAdding = async () => {
    if (!session?.detectedDevice || !newSensorName.trim()) return;
    setInstallingSensor(true);
    try {
      const result = await mobileApi.completeSensorOnboarding(server, token, session.id, {
        name: newSensorName.trim(),
        roomId: newSensorRoomId,
        target: null,
      });
      setSession(null);
      setAdding(false);
      setNewSensorRoomId(null);
      setNewSensorName('');
      onRefresh();
      openDevice(result.device);
    } catch {
      Alert.alert(
        'Installation non enregistrée',
        'Le capteur reste détecté. Vous pouvez réessayer.',
      );
    } finally {
      setInstallingSensor(false);
    }
  };

  return (
    <>
      <Pressable style={styles.sensorAddButton} onPress={() => setAdding(true)}>
        <Ionicons name="add-circle-outline" size={22} color="#fff" />
        <Text style={styles.sensorAddText}>Ajouter un capteur</Text>
      </Pressable>
      <View style={styles.card}>
        {devices.map((device) => {
          const online = device.capabilities.some((capability) => capability.status === 'ONLINE');
          return (
            <Pressable key={device.id} style={styles.sensorRow} onPress={() => openDevice(device)}>
              <View
                style={[
                  styles.sensorStatus,
                  { backgroundColor: online ? colors.paleGreen : colors.paleAmber },
                ]}
              >
                <Ionicons
                  name="hardware-chip-outline"
                  size={19}
                  color={online ? colors.green : colors.amber}
                />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{device.name}</Text>
                <Text numberOfLines={1} style={styles.rowDetail}>
                  {device.capabilities
                    .filter((item) => item.primary)
                    .map((item) => item.label)
                    .join(' · ') || 'À identifier'}
                </Text>
                <Text style={styles.rowDetail}>{device.room?.name ?? 'Aucune pièce'}</Text>
              </View>
              <View style={styles.sensorRight}>
                {device.batteryPercent !== null ? (
                  <Text style={styles.sensorValue}>{device.batteryPercent}%</Text>
                ) : null}
                <Text style={[styles.sensorState, { color: online ? colors.green : colors.amber }]}>
                  {device.installationStatus === 'OPERATIONAL' ? 'OPÉRATIONNEL' : 'À INSTALLER'}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {!devices.length ? (
          <Empty icon="hardware-chip-outline" text="Aucun capteur configuré." />
        ) : null}
      </View>

      <Modal
        visible={Boolean(selected)}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={styles.sensorSetupShell}>
          <ScrollView contentContainerStyle={styles.sensorSetupContent}>
            <Pressable style={styles.modalClose} onPress={() => setSelected(null)}>
              <Ionicons name="close" size={24} color={colors.navy} />
            </Pressable>
            <Text style={styles.eyebrow}>INSTALLATION</Text>
            <Text style={styles.sensorSetupTitle}>{selected?.name}</Text>
            <Text style={styles.sensorSetupLead}>
              {selected?.capabilities
                .filter((item) => item.primary)
                .map((item) => item.label)
                .join(' · ')}
            </Text>
            {selected?.capabilities
              .filter((item) => item.classification.confidence < 0.8)
              .map((capability) => (
                <View key={capability.sensorId} style={styles.sensorSetupSection}>
                  <Text style={styles.sensorSetupHeading}>Que mesure ce capteur ?</Text>
                  <View style={styles.sensorChoiceGrid}>
                    {[
                      ['motion', 'Mouvement'],
                      ['occupancy', 'Présence'],
                      ['contact', 'Ouverture'],
                      ['button', 'Bouton'],
                      ['temperature', 'Température'],
                      ['humidity', 'Humidité'],
                      ['water_leak', 'Fuite'],
                      ['smoke', 'Fumée'],
                      ['co2', 'CO₂'],
                      ['fall_detection', 'Chute'],
                    ].map(([value, label]) => (
                      <Pressable
                        key={value}
                        style={styles.sensorChoice}
                        onPress={() => confirmCapability(capability.sensorId, value)}
                      >
                        <Text style={styles.sensorChoiceText}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            <View style={styles.sensorSetupSection}>
              <Text style={styles.sensorSetupHeading}>Dans quelle pièce ?</Text>
              <View style={styles.sensorChoiceGrid}>
                {rooms.map((room) => (
                  <Pressable
                    key={room.id}
                    style={[
                      styles.sensorChoice,
                      selected?.room?.id === room.id && styles.sensorChoiceActive,
                    ]}
                    onPress={() => updateRoom(room.id)}
                  >
                    <Text style={styles.sensorChoiceText}>{room.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {guide ? (
              <View style={styles.sensorGuide}>
                <Ionicons name="location-outline" size={25} color={colors.blue} />
                <Text style={styles.sensorSetupHeading}>{guide.title}</Text>
                <Text style={styles.sensorSetupLead}>{guide.summary}</Text>
                {guide.steps.map((step, index) => (
                  <Text key={step} style={styles.sensorGuideStep}>
                    {index + 1}. {step}
                  </Text>
                ))}
                {guide.safetyNote ? (
                  <Text style={styles.sensorSafety}>{guide.safetyNote}</Text>
                ) : null}
              </View>
            ) : null}
            <Pressable
              style={styles.sensorConfirmButton}
              onPress={() =>
                selected &&
                void mobileApi
                  .updateSensorDevice(server, token, selected.id, { placementConfirmed: true })
                  .then(onRefresh)
              }
            >
              <Text style={styles.sensorConfirmText}>J’ai placé le capteur</Text>
            </Pressable>
            <Pressable
              disabled={!selected?.room || testing}
              style={[
                styles.sensorTestButton,
                (!selected?.room || testing) && styles.buttonDisabled,
              ]}
              onPress={() => void runTest()}
            >
              <Ionicons name="checkmark-circle-outline" size={21} color={colors.blue} />
              <Text style={styles.sensorTestText}>
                {testing ? 'Test en cours : déclenchez-le…' : 'Tester avec une donnée réelle'}
              </Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={adding} animationType="slide" onRequestClose={closeAdding}>
        <SafeAreaView style={styles.sensorSetupShell}>
          <ScrollView contentContainerStyle={styles.sensorSetupContent}>
            <Pressable style={styles.modalClose} onPress={closeAdding}>
              <Ionicons name="close" size={24} color={colors.navy} />
            </Pressable>
            <Text style={styles.eyebrow}>INSTALLATION GUIDÉE</Text>
            {!session ? (
              <>
                <Text style={styles.sensorSetupTitle}>Préparez votre capteur</Text>
                <Text style={styles.sensorSetupLead}>
                  Aucune information technique n’est nécessaire. Élise choisit automatiquement la
                  bonne connexion.
                </Text>
                <View style={styles.mobilePreparationList}>
                  <View style={styles.mobilePreparationStep}>
                    <Text style={styles.mobilePreparationNumber}>1</Text>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>Rapprochez-le de la box</Text>
                      <Text style={styles.rowDetail}>
                        Gardez-le à moins de deux mètres pendant l’installation.
                      </Text>
                    </View>
                  </View>
                  <View style={styles.mobilePreparationStep}>
                    <Text style={styles.mobilePreparationNumber}>2</Text>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>Repérez son bouton</Text>
                      <Text style={styles.rowDetail}>
                        Il peut être sur le côté, au dos ou dans un petit trou Reset.
                      </Text>
                    </View>
                  </View>
                </View>
                <Pressable
                  style={styles.mobileAutomaticSearchButton}
                  onPress={() =>
                    void mobileApi
                      .startSensorOnboarding(server, token)
                      .then(setSession)
                      .catch(() =>
                        Alert.alert(
                          'Recherche indisponible',
                          'La box ne peut pas lancer la recherche pour le moment.',
                        ),
                      )
                  }
                >
                  <Ionicons name="radio-outline" size={21} color="#fff" />
                  <Text style={styles.sensorConfirmText}>Rechercher mon capteur</Text>
                </Pressable>
              </>
            ) : session.status !== 'DEVICE_FOUND' || !session.detectedDevice ? (
              <View style={styles.mobilePairing}>
                <View style={styles.mobilePairingRadar}>
                  <Ionicons name="radio-outline" size={42} color={colors.accent} />
                </View>
                <Text style={styles.mobilePairingTime}>
                  {Math.floor(pairingSeconds / 60)}:{String(pairingSeconds % 60).padStart(2, '0')}
                </Text>
                <Text style={styles.sensorSetupHeading}>
                  {session.step === 'SCAN_QR_ON_MOBILE'
                    ? 'Scannez le QR code Matter'
                    : 'Élise recherche votre capteur'}
                </Text>
                <Text style={styles.sensorSetupLead}>
                  Maintenez son bouton environ 5 secondes, puis relâchez lorsque le voyant clignote.
                </Text>
                <View style={styles.mobileNetworkChip}>
                  <View
                    style={[
                      styles.mobileNetworkDot,
                      {
                        backgroundColor: session.connection?.pairingOpen
                          ? colors.green
                          : colors.amber,
                      },
                    ]}
                  />
                  <Text style={styles.mobileNetworkText}>
                    {session.connection?.pairingOpen
                      ? 'Réseau Zigbee ouvert'
                      : session.connection?.online
                        ? 'Clé connectée · ouverture en cours'
                        : 'Réseau à vérifier'}
                  </Text>
                </View>
                {['FAILED', 'EXPIRED'].includes(session.status) ? (
                  <Pressable
                    style={styles.sensorConfirmButton}
                    onPress={() => {
                      void mobileApi
                        .cancelSensorOnboarding(server, token, session.id)
                        .finally(() => setSession(null));
                    }}
                  >
                    <Text style={styles.sensorConfirmText}>Réessayer</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View>
                <View style={styles.mobileFoundBadge}>
                  <Ionicons name="checkmark-circle" size={17} color={colors.green} />
                  <Text style={styles.mobileFoundBadgeText}>CAPTEUR TROUVÉ</Text>
                </View>
                <Text style={styles.sensorSetupTitle}>
                  {detectedSensorLabels[session.detectedDevice.detectedType]}
                </Text>
                <View style={styles.mobileDetectedCard}>
                  <View style={styles.sensorProtocolIcon}>
                    <Ionicons name="thermometer-outline" size={25} color={colors.accent} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>
                      {session.detectedDevice.manufacturer ?? 'Fabricant inconnu'} ·{' '}
                      {session.detectedDevice.model ?? session.detectedDevice.name}
                    </Text>
                    <Text style={styles.rowDetail}>Connecté à Élise</Text>
                  </View>
                </View>
                <View style={styles.mobileCapabilityGrid}>
                  {session.detectedDevice.capabilities.map((capability) => (
                    <View key={capability.sensorId} style={styles.mobileCapability}>
                      <Text style={styles.mobileCapabilityLabel}>{capability.label}</Text>
                      <Text style={styles.mobileCapabilityValue}>
                        {typeof capability.value?.value === 'number'
                          ? `${capability.value.value}${capability.unit ? ` ${capability.unit}` : ''}`
                          : 'Détecté'}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.sensorGroupLabel}>NOM DANS ÉLISE</Text>
                <TextInput
                  style={styles.mobileSensorNameInput}
                  value={newSensorName}
                  onChangeText={setNewSensorName}
                />
                <Text style={styles.sensorGroupLabel}>OÙ SERA-T-IL INSTALLÉ ?</Text>
                <Pressable
                  style={[
                    styles.mobileRoomChoice,
                    newSensorRoomId === null && styles.sensorChoiceActive,
                  ]}
                  onPress={() => setNewSensorRoomId(null)}
                >
                  <Ionicons name="time-outline" size={20} color={colors.accent} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>Je choisirai plus tard</Text>
                    <Text style={styles.rowDetail}>Le capteur restera dans Non attribués.</Text>
                  </View>
                  {newSensorRoomId === null ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.green} />
                  ) : null}
                </Pressable>
                {[...new Set(rooms.map(({ floor }) => floor))]
                  .sort((a, b) => a - b)
                  .map((floor) => (
                    <View key={floor}>
                      <Text style={styles.mobileFloorGroup}>
                        {floor === 0
                          ? 'Rez-de-chaussée'
                          : floor === 1
                            ? '1er étage'
                            : `${floor}e étage`}
                      </Text>
                      <View style={styles.sensorChoiceGrid}>
                        {rooms
                          .filter((room) => room.floor === floor)
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((room) => (
                            <Pressable
                              key={room.id}
                              style={[
                                styles.mobileRoomChoice,
                                newSensorRoomId === room.id && styles.sensorChoiceActive,
                              ]}
                              onPress={() => setNewSensorRoomId(room.id)}
                            >
                              <Ionicons name="home-outline" size={19} color={colors.accent} />
                              <Text style={styles.sensorChoiceText}>{room.name}</Text>
                              {newSensorRoomId === room.id ? (
                                <Ionicons name="checkmark-circle" size={19} color={colors.green} />
                              ) : null}
                            </Pressable>
                          ))}
                      </View>
                    </View>
                  ))}
                <Pressable
                  disabled={installingSensor || !newSensorName.trim()}
                  style={[
                    styles.sensorConfirmButton,
                    (installingSensor || !newSensorName.trim()) && styles.buttonDisabled,
                  ]}
                  onPress={() => void finishAdding()}
                >
                  <Text style={styles.sensorConfirmText}>
                    {installingSensor
                      ? 'Installation…'
                      : newSensorRoomId
                        ? `Installer dans ${rooms.find(({ id }) => id === newSensorRoomId)?.name}`
                        : 'Enregistrer sans pièce'}
                  </Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const mobilePlanClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const mobilePlanId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mobileRoomBounds = (room: PlanRoom) => {
  const xs = room.geometry.points.map(({ x }) => x);
  const ys = room.geometry.points.map(({ y }) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};
const mobileRoomCenter = (room: PlanRoom) => {
  const box = mobileRoomBounds(room);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const mobileRoomAreaM2 = (room: PlanRoom) =>
  room.areaM2 ??
  Math.abs(
    room.geometry.points.reduce((sum, point, index) => {
      const next = room.geometry.points[(index + 1) % room.geometry.points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  ) / 10_000;
const mobileOnBoundary = (point: { x: number; y: number }, room: PlanRoom) =>
  room.geometry.points.some((start, index) => {
    const end = room.geometry.points[(index + 1) % room.geometry.points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = dx * dx + dy * dy;
    const ratio = length
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
      : 0;
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy)) < 8;
  });

function MobileHomePlan({
  plan,
  presence,
  sensors,
  cameras,
  onSave,
  onOpenCameras,
}: {
  plan: HomePlan | null;
  presence: PresenceEstimate | null;
  sensors: Household['rooms'][number]['sensors'];
  cameras: CameraItem[];
  onSave: (plan: HomePlan) => Promise<HomePlan>;
  onOpenCameras: () => void;
}) {
  const [draft, setDraft] = useState<HomePlan | null>(plan);
  const [mode, setMode] = useState<'EDIT' | 'LIVE'>('LIVE');
  const [floorId, setFloorId] = useState(plan?.levels[0]?.id ?? '');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [history, setHistory] = useState<HomePlan[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wizardLevels, setWizardLevels] = useState(plan?.levels.length ?? 1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!plan || dirty) return;
    setDraft(plan);
    setFloorId((current) => current || plan.levels[0]?.id || '');
  }, [dirty, plan]);

  const commit = (change: (next: HomePlan) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = mobilePlanClone(current);
      change(next);
      setHistory((items) => [...items.slice(-19), mobilePlanClone(current)]);
      setDirty(true);
      return next;
    });
  };

  useEffect(() => {
    if (!dirty || !draft) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      void onSave(draft)
        .then((saved) => {
          setDraft(saved);
          setDirty(false);
        })
        .catch(() =>
          Alert.alert('Plan non enregistré', 'Vérifiez le plan ou la connexion, puis réessayez.'),
        )
        .finally(() => setSaving(false));
    }, 1_200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, draft, onSave]);

  useEffect(() => {
    if (!draft || mode !== 'LIVE') return;
    const targetRoomId = presence?.candidateRoomId ?? presence?.confirmedRoomId;
    const targetFloor = draft.levels.find((level) =>
      level.rooms.some((room) => room.id === targetRoomId),
    );
    if (targetFloor) setFloorId(targetFloor.id);
  }, [draft, mode, presence?.candidateRoomId, presence?.confirmedRoomId]);

  if (!draft) return <Empty icon="map-outline" text="Chargement du logement…" />;
  const floor = draft.levels.find(({ id }) => id === floorId) ?? draft.levels[0];
  const selectedRoom = floor.rooms.find(({ id }) => id === selectedRoomId) ?? null;
  const sensorMap = new Map(sensors.map((sensor) => [sensor.id, sensor]));
  const cameraMap = new Map(cameras.map((camera) => [camera.id, camera]));
  const placedSensors = new Set(
    draft.placements.filter(({ kind }) => kind === 'SENSOR').map(({ equipmentId }) => equipmentId),
  );
  const placedCameras = new Set(
    draft.placements.filter(({ kind }) => kind === 'CAMERA').map(({ equipmentId }) => equipmentId),
  );

  const addRoom = (shape: 'RECTANGLE' | 'L') => {
    const index = floor.rooms.length;
    const x = 80 + (index % 2) * 520;
    const y = 80 + Math.floor(index / 2) * 350;
    const id = mobilePlanId('room');
    const points =
      shape === 'L'
        ? [
            { x, y },
            { x: x + 440, y },
            { x: x + 440, y: y + 150 },
            { x: x + 240, y: y + 150 },
            { x: x + 240, y: y + 300 },
            { x, y: y + 300 },
          ]
        : [
            { x, y },
            { x: x + 440, y },
            { x: x + 440, y: y + 300 },
            { x, y: y + 300 },
          ];
    commit((next) =>
      next.levels
        .find(({ id: target }) => target === floor.id)!
        .rooms.push({
          id,
          name: `Pièce ${next.levels.flatMap(({ rooms }) => rooms).length + 1}`,
          kind: 'OTHER',
          areaM2:
            Math.abs(
              points.reduce((sum, point, pointIndex) => {
                const following = points[(pointIndex + 1) % points.length];
                return sum + point.x * following.y - following.x * point.y;
              }, 0) / 2,
            ) / 10_000,
          geometry: { points, color: ['#E8F0F3', '#F5EAD8', '#E6EFE7', '#EEE8F3'][index % 4] },
        }),
    );
    setSelectedRoomId(id);
  };

  const updateRoom = (change: (room: PlanRoom) => void) => {
    if (!selectedRoom) return;
    commit((next) =>
      change(next.levels.flatMap(({ rooms }) => rooms).find(({ id }) => id === selectedRoom.id)!),
    );
  };

  const resizeRoom = (axis: 'width' | 'height', meters: number) => {
    if (!selectedRoom || meters < 0.5) return;
    const box = mobileRoomBounds(selectedRoom);
    const ratio = (meters * 100) / box[axis];
    updateRoom((room) => {
      room.geometry.points = room.geometry.points.map((point) => ({
        x: axis === 'width' ? Math.round((box.x + (point.x - box.x) * ratio) / 10) * 10 : point.x,
        y: axis === 'height' ? Math.round((box.y + (point.y - box.y) * ratio) / 10) * 10 : point.y,
      }));
    });
    commit((next) => {
      next.levels.find(({ id }) => id === floor.id)!.scaleCmPerUnit = 1;
    });
  };

  const addOpening = (kind: 'DOOR' | 'WINDOW') => {
    if (!selectedRoom) return;
    const start = selectedRoom.geometry.points[0];
    const end = selectedRoom.geometry.points[1];
    const point = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const roomIds = floor.rooms
      .filter((room) => mobileOnBoundary(point, room))
      .map(({ id }) => id)
      .slice(0, 2);
    commit((next) =>
      next.levels
        .find(({ id }) => id === floor.id)!
        .openings.push({
          id: mobilePlanId(kind.toLowerCase()),
          kind,
          roomIds,
          x: point.x,
          y: point.y,
          width: kind === 'DOOR' ? 90 : 120,
          rotation: 0,
        }),
    );
  };

  const placeEquipment = (kind: 'SENSOR' | 'CAMERA', equipmentId: string) => {
    if (!selectedRoom) {
      Alert.alert('Choisissez une pièce', 'Touchez d’abord la pièce où se trouve cet équipement.');
      return;
    }
    const point = mobileRoomCenter(selectedRoom);
    commit((next) => {
      next.placements = next.placements.filter(
        (item) => item.kind !== kind || item.equipmentId !== equipmentId,
      );
      next.placements.push({
        id: mobilePlanId('placement'),
        kind,
        equipmentId,
        equipmentRefKind: kind === 'CAMERA' ? 'CAMERA' : 'SENSOR_ENTITY',
        roomId: selectedRoom.id,
        floorId: floor.id,
        openingId: null,
        targetType: 'ROOM',
        targetId: selectedRoom.id,
        capabilityBindings: [],
        x: point.x,
        y: point.y,
        rotation: 0,
      });
    });
  };

  const deleteRoom = () => {
    if (!selectedRoom) return;
    Alert.alert('Supprimer cette pièce ?', 'Ses équipements seront remis dans la liste à placer.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          commit((next) => {
            for (const level of next.levels) {
              level.rooms = level.rooms.filter(({ id }) => id !== selectedRoom.id);
              level.openings = level.openings.filter(
                ({ roomIds }) => !roomIds.includes(selectedRoom.id),
              );
              level.items = level.items.filter(({ roomId }) => roomId !== selectedRoom.id);
              level.stairs = level.stairs.filter(
                ({ fromRoomId, toRoomId }) =>
                  fromRoomId !== selectedRoom.id && toRoomId !== selectedRoom.id,
              );
            }
            next.placements = next.placements.filter(({ roomId }) => roomId !== selectedRoom.id);
          });
          setSelectedRoomId(null);
        },
      },
    ]);
  };

  const addFloor = () => {
    const number = Math.max(...draft.levels.map(({ floor: value }) => value), -1) + 1;
    const id = mobilePlanId('floor');
    commit((next) =>
      next.levels.push({
        id,
        name: number === 0 ? 'Rez-de-chaussée' : number === 1 ? '1er étage' : `${number}e étage`,
        floor: number,
        order: next.levels.length,
        width: 1_200,
        height: 800,
        scaleCmPerUnit: null,
        rooms: [],
        openings: [],
        stairs: [],
        items: [],
      }),
    );
    setFloorId(id);
    setSelectedRoomId(null);
  };

  const addStair = () => {
    if (!selectedRoom) return;
    const targetFloor = draft.levels.find(({ id }) => id !== floor.id);
    const targetRoom = targetFloor?.rooms[0];
    if (!targetFloor || !targetRoom) {
      Alert.alert(
        'Autre niveau incomplet',
        'Créez une pièce sur un autre niveau avant d’ajouter l’escalier.',
      );
      return;
    }
    const point = mobileRoomCenter(selectedRoom);
    commit((next) =>
      next.levels
        .find(({ id }) => id === floor.id)!
        .stairs.push({
          id: mobilePlanId('stair'),
          fromFloorId: floor.id,
          toFloorId: targetFloor.id,
          fromRoomId: selectedRoom.id,
          toRoomId: targetRoom.id,
          x: point.x,
          y: point.y,
          width: 100,
          height: 180,
          rotation: 0,
        }),
    );
  };

  const finishWizard = () => {
    const next = mobilePlanClone(draft);
    next.configured = true;
    next.levels = Array.from(
      { length: wizardLevels },
      (_, index) =>
        next.levels[index] ?? {
          id: `floor-${index}`,
          name: index === 0 ? 'Rez-de-chaussée' : index === 1 ? '1er étage' : `${index}e étage`,
          floor: index,
          order: index,
          width: 1_200,
          height: 800,
          scaleCmPerUnit: null,
          rooms: [],
          openings: [],
          stairs: [],
          items: [],
        },
    );
    if (!next.levels.some(({ rooms }) => rooms.length))
      next.levels[0].rooms.push({
        id: mobilePlanId('room'),
        name: 'Pièce de vie',
        kind: 'LIVING_ROOM',
        areaM2: 24,
        geometry: {
          points: [
            { x: 120, y: 120 },
            { x: 720, y: 120 },
            { x: 720, y: 520 },
            { x: 120, y: 520 },
          ],
          color: '#E8F0F3',
        },
      });
    setHistory([draft]);
    setDraft(next);
    setFloorId(next.levels[0].id);
    setDirty(true);
  };

  return (
    <View style={styles.mobilePlanShell}>
      <View style={styles.mobilePlanMode}>
        <Pressable
          style={[styles.mobilePlanModeButton, mode === 'EDIT' && styles.mobilePlanModeActive]}
          onPress={() => setMode('EDIT')}
        >
          <Ionicons
            name="construct-outline"
            size={17}
            color={mode === 'EDIT' ? '#fff' : colors.blue}
          />
          <Text
            style={[styles.mobilePlanModeText, mode === 'EDIT' && styles.mobilePlanModeTextActive]}
          >
            Aménager
          </Text>
        </Pressable>
        <Pressable
          style={[styles.mobilePlanModeButton, mode === 'LIVE' && styles.mobilePlanModeActive]}
          onPress={() => setMode('LIVE')}
        >
          <Ionicons name="eye-outline" size={17} color={mode === 'LIVE' ? '#fff' : colors.blue} />
          <Text
            style={[styles.mobilePlanModeText, mode === 'LIVE' && styles.mobilePlanModeTextActive]}
          >
            En direct
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mobileFloorTabs}
      >
        {draft.levels.map((level) => (
          <Pressable
            key={level.id}
            style={[styles.mobileFloorTab, level.id === floor.id && styles.mobileFloorTabActive]}
            onPress={() => {
              setFloorId(level.id);
              setSelectedRoomId(null);
            }}
          >
            <Text
              style={[
                styles.mobileFloorText,
                level.id === floor.id && styles.mobileFloorTextActive,
              ]}
            >
              {level.name}
            </Text>
          </Pressable>
        ))}
        {mode === 'EDIT' ? (
          <Pressable style={styles.mobileFloorTab} onPress={addFloor}>
            <Text style={styles.mobileFloorText}>＋ Niveau</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {mode === 'EDIT' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mobilePlanTools}
        >
          <Pressable onPress={() => addRoom('RECTANGLE')}>
            <Ionicons name="square-outline" size={17} color={colors.blue} />
            <Text>Pièce</Text>
          </Pressable>
          <Pressable onPress={() => addRoom('L')}>
            <Ionicons name="shapes-outline" size={17} color={colors.blue} />
            <Text>Pièce en L</Text>
          </Pressable>
          <Pressable
            disabled={!history.length}
            onPress={() => {
              const previous = history.at(-1);
              if (!previous) return;
              setDraft(previous);
              setHistory((items) => items.slice(0, -1));
              setDirty(true);
            }}
          >
            <Ionicons name="arrow-undo-outline" size={17} color={colors.blue} />
            <Text>Annuler</Text>
          </Pressable>
          <View style={styles.mobileSaving}>
            <Text>{saving ? 'Sauvegarde…' : dirty ? 'Modifié' : 'Enregistré'}</Text>
          </View>
        </ScrollView>
      ) : null}
      {mode === 'LIVE' && presence?.confirmedRoomId ? (
        <View style={styles.mobilePresence}>
          <View
            style={[
              styles.mobilePresenceDot,
              presence.trackingState === 'IN_TRANSIT' && styles.mobilePresenceDotTransit,
            ]}
          />
          <View>
            <Text style={styles.mobilePresenceTitle}>
              {presence.trackingState === 'CONFIRMED'
                ? 'Présence confirmée'
                : presence.trackingState === 'IN_TRANSIT'
                  ? 'Déplacement probable'
                  : presence.trackingState === 'AMBIGUOUS'
                    ? 'Présence non attribuée'
                    : 'Dernière présence fiable'}
            </Text>
            <Text style={styles.mobilePresenceDetail}>{presence.explanation}</Text>
            {presence.trackingDegraded ? (
              <Text style={styles.presenceWarningText}>
                Suivi moins fiable · vérifiez les capteurs des passages.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.mobilePlanScroller}
      >
        <Svg
          width={620}
          height={414}
          viewBox={`0 0 ${floor.width} ${floor.height}`}
          style={styles.mobilePlanCanvas}
        >
          <Rect width={floor.width} height={floor.height} fill="#f8faf9" />
          {presence?.pathRoomIds.slice(0, -1).map((roomId, index) => {
            const nextRoomId = presence.pathRoomIds[index + 1];
            const from = floor.rooms.find((room) => room.id === roomId);
            const to = floor.rooms.find((room) => room.id === nextRoomId);
            if (!from || !to || mode !== 'LIVE') return null;
            const start = mobileRoomCenter(from);
            const end = mobileRoomCenter(to);
            return (
              <Line
                key={`${roomId}:${nextRoomId}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={colors.amber}
                strokeWidth="12"
                strokeDasharray="22 14"
              />
            );
          })}
          {floor.rooms.map((room) => {
            const point = mobileRoomCenter(room);
            const box = mobileRoomBounds(room);
            const active = presence?.confirmedRoomId === room.id && mode === 'LIVE';
            const candidate = presence?.candidateRoomId === room.id && mode === 'LIVE';
            return (
              <G key={room.id} onPress={() => setSelectedRoomId(room.id)}>
                <Polygon
                  points={room.geometry.points.map(({ x, y }) => `${x},${y}`).join(' ')}
                  fill={room.geometry.color}
                  stroke={
                    candidate
                      ? colors.amber
                      : active
                        ? colors.green
                        : selectedRoomId === room.id
                          ? colors.blue
                          : '#657985'
                  }
                  strokeWidth={candidate || active ? 13 : selectedRoomId === room.id ? 10 : 7}
                  strokeDasharray={candidate ? '24 14' : undefined}
                />
                <SvgText
                  x={point.x}
                  y={point.y - 4}
                  textAnchor="middle"
                  fontSize="25"
                  fontWeight="800"
                  fill={colors.navy}
                >
                  {room.name}
                </SvgText>
                <SvgText
                  x={point.x}
                  y={point.y + 23}
                  textAnchor="middle"
                  fontSize="15"
                  fill={colors.muted}
                >
                  {(box.width / 100).toFixed(1)} × {(box.height / 100).toFixed(1)} m
                  {floor.scaleCmPerUnit ? '' : ' env.'}
                </SvgText>
              </G>
            );
          })}
          {floor.openings.map((opening) => (
            <G key={opening.id}>
              <Line
                x1={opening.x - opening.width / 2}
                y1={opening.y}
                x2={opening.x + opening.width / 2}
                y2={opening.y}
                stroke={opening.kind === 'DOOR' ? '#b77741' : '#62a5c2'}
                strokeWidth="10"
              />
              <SvgText
                x={opening.x}
                y={opening.y - 14}
                textAnchor="middle"
                fontSize="13"
                fill={colors.muted}
              >
                {opening.kind === 'DOOR' ? 'porte' : 'fenêtre'}
              </SvgText>
            </G>
          ))}
          {floor.stairs.map((stair) => (
            <G key={stair.id}>
              <Rect
                x={stair.x - stair.width / 2}
                y={stair.y - stair.height / 2}
                width={stair.width}
                height={stair.height}
                fill="rgba(255,255,255,.7)"
                stroke={colors.muted}
                strokeWidth="4"
              />
              <SvgText
                x={stair.x}
                y={stair.y + 8}
                textAnchor="middle"
                fontSize="28"
                fill={colors.navy}
              >
                ↕
              </SvgText>
            </G>
          ))}
          {draft.placements
            .filter(({ floorId: id }) => id === floor.id)
            .map((placement) => {
              const sensor = sensorMap.get(placement.equipmentId);
              const camera = cameraMap.get(placement.equipmentId);
              const online = (sensor?.status ?? camera?.status) === 'ONLINE';
              return (
                <G
                  key={placement.id}
                  onPress={() => {
                    if (placement.kind === 'CAMERA' && mode === 'LIVE') onOpenCameras();
                  }}
                >
                  <Circle
                    cx={placement.x}
                    cy={placement.y}
                    r="23"
                    fill={placement.kind === 'CAMERA' ? colors.navy : '#fff'}
                    stroke={online ? colors.green : colors.amber}
                    strokeWidth="7"
                  />
                  <SvgText
                    x={placement.x}
                    y={placement.y + 6}
                    textAnchor="middle"
                    fontSize="18"
                    fontWeight="900"
                    fill={placement.kind === 'CAMERA' ? '#fff' : colors.navy}
                  >
                    {placement.kind === 'CAMERA' ? '◉' : '●'}
                  </SvgText>
                </G>
              );
            })}
        </Svg>
      </ScrollView>
      {mode === 'EDIT' && selectedRoom ? (
        <View style={styles.mobileRoomInspector}>
          <View style={styles.mobileInspectorHead}>
            <View>
              <Text style={styles.eyebrow}>PIÈCE SÉLECTIONNÉE</Text>
              <Text style={styles.mobileInspectorTitle}>{selectedRoom.name}</Text>
            </View>
            <Pressable onPress={deleteRoom}>
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </Pressable>
          </View>
          <TextInput
            style={styles.mobilePlanInput}
            value={selectedRoom.name}
            placeholder="Nom de la pièce"
            onChangeText={(name) =>
              updateRoom((room) => {
                room.name = name;
              })
            }
          />
          <Text style={styles.mobileWizardLabel}>SURFACE RÉELLE</Text>
          <View style={styles.mobileDimensionRow}>
            <TextInput
              style={styles.mobileDimensionInput}
              defaultValue={mobileRoomAreaM2(selectedRoom).toFixed(1)}
              keyboardType="decimal-pad"
              onEndEditing={(event) => {
                const area = Number(event.nativeEvent.text.replace(',', '.'));
                if (Number.isFinite(area) && area >= 0.1)
                  updateRoom((room) => {
                    room.areaM2 = area;
                  });
              }}
            />
            <Text style={styles.mobileDimensionLabel}>m²</Text>
          </View>
          <Text style={styles.mobileWizardLabel}>TAILLE VISUELLE SUR LE PLAN</Text>
          <View style={styles.mobileDimensionRow}>
            <TextInput
              style={styles.mobileDimensionInput}
              defaultValue={(mobileRoomBounds(selectedRoom).width / 100).toFixed(1)}
              keyboardType="decimal-pad"
              onEndEditing={(event) =>
                resizeRoom('width', Number(event.nativeEvent.text.replace(',', '.')))
              }
            />
            <Text style={styles.mobileDimensionLabel}>×</Text>
            <TextInput
              style={styles.mobileDimensionInput}
              defaultValue={(mobileRoomBounds(selectedRoom).height / 100).toFixed(1)}
              keyboardType="decimal-pad"
              onEndEditing={(event) =>
                resizeRoom('height', Number(event.nativeEvent.text.replace(',', '.')))
              }
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mobileInspectorActions}
          >
            <Pressable onPress={() => addOpening('DOOR')}>
              <Text>＋ Porte</Text>
            </Pressable>
            <Pressable onPress={() => addOpening('WINDOW')}>
              <Text>＋ Fenêtre</Text>
            </Pressable>
            {draft.levels.length > 1 ? (
              <Pressable onPress={addStair}>
                <Text>＋ Escalier</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {mode === 'EDIT' ? (
        <View style={styles.mobileEquipmentTray}>
          <Text style={styles.mobileTrayTitle}>
            Équipements à placer {selectedRoom ? `dans ${selectedRoom.name}` : ''}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {sensors
              .filter(({ id }) => !placedSensors.has(id))
              .map((sensor) => (
                <Pressable
                  key={sensor.id}
                  style={styles.mobileEquipmentChip}
                  onPress={() => placeEquipment('SENSOR', sensor.id)}
                >
                  <Ionicons name="radio-outline" size={16} color={colors.blue} />
                  <Text>{sensor.device?.name ?? sensor.entityId}</Text>
                </Pressable>
              ))}
            {cameras
              .filter(({ id }) => !placedCameras.has(id))
              .map((camera) => (
                <Pressable
                  key={camera.id}
                  style={styles.mobileEquipmentChip}
                  onPress={() => placeEquipment('CAMERA', camera.id)}
                >
                  <Ionicons name="videocam-outline" size={16} color={colors.blue} />
                  <Text>{camera.name}</Text>
                </Pressable>
              ))}
          </ScrollView>
        </View>
      ) : null}
      <Modal visible={!draft.configured} transparent animationType="fade">
        <View style={styles.mobileWizardBackdrop}>
          <View style={styles.mobileWizard}>
            <View style={styles.mobileWizardIcon}>
              <Ionicons name="map-outline" size={30} color="#fff" />
            </View>
            <Text style={styles.eyebrow}>CRÉONS VOTRE PLAN</Text>
            <Text style={styles.mobileWizardTitle}>À quoi ressemble le logement ?</Text>
            <Text style={styles.mobileWizardText}>
              Nous préparons une base simple que vous pourrez entièrement modifier.
            </Text>
            <Text style={styles.mobileWizardLabel}>Nombre de niveaux</Text>
            <View style={styles.mobileWizardLevels}>
              {[1, 2, 3, 4].map((value) => (
                <Pressable
                  key={value}
                  style={[
                    styles.mobileWizardLevel,
                    wizardLevels === value && styles.mobileWizardLevelActive,
                  ]}
                  onPress={() => setWizardLevels(value)}
                >
                  <Text
                    style={[
                      styles.mobileWizardLevelText,
                      wizardLevels === value && styles.mobileWizardLevelTextActive,
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.mobileWizardButton} onPress={finishWizard}>
              <Text>Créer mon logement</Text>
            </Pressable>
            <Text style={styles.mobileWizardFoot}>Les dimensions restent facultatives.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function HouseTab({
  server,
  token,
  household,
  cameras,
  sensorDevices,
  plan,
  presence,
  onSavePlan,
  refreshing,
  onRefresh,
}: {
  server: SavedServer;
  token: string;
  household: Household | null;
  cameras: CameraItem[];
  sensorDevices: SensorDevice[];
  plan: HomePlan | null;
  presence: PresenceEstimate | null;
  onSavePlan: (plan: HomePlan) => Promise<HomePlan>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [section, setSection] = useState<'rooms' | 'sensors' | 'cameras' | 'people'>('rooms');
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle eyebrow="FOYER" title="Maison" />
      <Segment
        options={[
          ['rooms', 'Mon logement'],
          ['sensors', 'Capteurs'],
          ['cameras', 'Caméras'],
          ['people', 'Entourage'],
        ]}
        value={section}
        onChange={(value) => setSection(value as typeof section)}
      />
      {section === 'rooms' ? (
        <MobileHomePlan
          plan={plan}
          presence={presence}
          sensors={[
            ...(household?.unassignedSensors ?? []),
            ...(household?.rooms.flatMap((room) => room.sensors) ?? []),
          ]}
          cameras={cameras}
          onSave={onSavePlan}
          onOpenCameras={() => setSection('cameras')}
        />
      ) : null}
      {section === 'sensors' ? (
        <MobileSensors
          server={server}
          token={token}
          devices={sensorDevices}
          rooms={household?.rooms ?? []}
          onRefresh={onRefresh}
        />
      ) : null}
      {section === 'cameras' ? (
        <CameraSection server={server} token={token} cameras={cameras} onRefresh={onRefresh} />
      ) : null}
      {section === 'people' ? (
        <>
          <View style={styles.card}>
            <SectionTitle eyebrow="RÉSIDENTS" title="Personnes accompagnées" />
            {household?.residents.map((resident) => (
              <PersonRow
                key={resident.id}
                name={resident.displayName}
                detail={resident.birthYear ? `Né(e) en ${resident.birthYear}` : 'Résident du foyer'}
                primary={resident.primary}
              />
            ))}
            {!household?.residents.length ? (
              <Empty icon="person-outline" text="Aucun résident renseigné." />
            ) : null}
          </View>
          <View style={styles.card}>
            <SectionTitle eyebrow="ENTOURAGE" title="Aidants et proches" />
            {household?.caregivers.map((person) => (
              <PersonRow
                key={person.id}
                name={person.displayName}
                detail={[person.relation, person.role].filter(Boolean).join(' · ')}
                primary={person.isPrimary}
              />
            ))}
            {!household?.caregivers.length ? (
              <Empty icon="people-outline" text="Aucun aidant renseigné." />
            ) : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function CameraSection({
  server,
  token,
  cameras,
  onRefresh,
}: {
  server: SavedServer;
  token: string;
  cameras: CameraItem[];
  onRefresh: () => void;
}) {
  const [session, setSession] = useState<CameraSession | null>(null);
  const [talking, setTalking] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const sessionRequest = useRef(0);
  const selected = cameras.find((camera) => camera.id === session?.cameraId) ?? null;

  const open = async (camera: CameraItem, talk = false) => {
    const requestId = ++sessionRequest.current;
    setLoading(camera.id);
    try {
      const nextSession = await mobileApi.cameraSession(server, token, camera.id, talk);
      if (requestId === sessionRequest.current) setSession(nextSession);
    } catch {
      if (requestId === sessionRequest.current) {
        Alert.alert('Caméra indisponible', 'Le flux local ne peut pas être ouvert pour le moment.');
      }
    } finally {
      if (requestId === sessionRequest.current) setLoading(null);
    }
  };
  const privacy = async (camera: CameraItem) => {
    try {
      await mobileApi.cameraPrivacy(server, token, camera.id, !camera.privacyMode);
      if (session?.cameraId === camera.id) {
        sessionRequest.current += 1;
        setSession(null);
        setTalking(false);
        setLoading(null);
      }
      onRefresh();
    } catch {
      Alert.alert('Mode intimité', 'Cette protection n’a pas pu être modifiée.');
    }
  };
  const startTalk = async () => {
    if (!selected) return;
    setTalking(true);
    await open(selected, true);
  };
  const stopTalk = async () => {
    if (!selected) return;
    setTalking(false);
    await open(selected, false);
  };
  const close = () => {
    sessionRequest.current += 1;
    setSession(null);
    setTalking(false);
    setLoading(null);
  };

  return (
    <>
      <View style={styles.cameraPrivacyNote}>
        <Ionicons name="shield-checkmark-outline" size={20} color={colors.green} />
        <Text style={styles.cameraPrivacyText}>
          Flux local · accès journalisé · captures d’alerte supprimées après 24 h
        </Text>
      </View>
      <View style={styles.mobileCameraGrid}>
        {cameras.map((camera) => (
          <View key={camera.id} style={styles.mobileCameraCard}>
            <View
              style={[
                styles.mobileCameraVisual,
                camera.privacyMode && styles.mobileCameraVisualPrivate,
              ]}
            >
              <Ionicons
                name={camera.privacyMode ? 'videocam-off-outline' : 'videocam-outline'}
                size={31}
                color={camera.privacyMode ? colors.muted : '#fff'}
              />
              <View style={styles.mobileCameraStatus}>
                <Text style={styles.mobileCameraStatusText}>
                  {camera.status === 'ONLINE' ? 'DISPONIBLE' : camera.status}
                </Text>
              </View>
            </View>
            <Text style={styles.mobileCameraRoom}>{camera.room?.name ?? 'Sans pièce'}</Text>
            <Text style={styles.mobileCameraName}>{camera.name}</Text>
            <Text style={styles.mobileCameraDetail}>
              {camera.privacyMode
                ? 'Mode intimité actif'
                : camera.lastPersonSeenAt
                  ? `Présence ${relativeTime(camera.lastPersonSeenAt).toLowerCase()}`
                  : 'Aucune présence récente'}
            </Text>
            <View style={styles.mobileCameraActions}>
              <Pressable
                disabled={camera.privacyMode || loading === camera.id}
                style={[
                  styles.mobileCameraOpen,
                  (camera.privacyMode || loading === camera.id) && styles.disabledButton,
                ]}
                onPress={() => void open(camera)}
              >
                <Ionicons name="eye-outline" color="#fff" size={17} />
                <Text style={styles.mobileCameraOpenText}>
                  {loading === camera.id ? 'Ouverture…' : 'Voir'}
                </Text>
              </Pressable>
              <Pressable style={styles.mobilePrivacyButton} onPress={() => void privacy(camera)}>
                <Ionicons name="shield-checkmark-outline" color={colors.blue} size={17} />
              </Pressable>
            </View>
          </View>
        ))}
        {!cameras.length ? (
          <View style={styles.card}>
            <Empty
              icon="videocam-outline"
              text="Aucune caméra configurée depuis le dashboard administrateur."
            />
          </View>
        ) : null}
      </View>

      <Modal animationType="slide" visible={Boolean(session && selected)} onRequestClose={close}>
        <SafeAreaView style={styles.cameraModal}>
          <View style={styles.cameraModalHeader}>
            <View>
              <Text style={styles.cameraModalLive}>
                {talking ? '● MICRO ACTIF' : '● EN DIRECT'}
              </Text>
              <Text style={styles.cameraModalTitle}>{selected?.name}</Text>
              <Text style={styles.cameraModalRoom}>{selected?.room?.name}</Text>
            </View>
            <Pressable style={styles.modalClose} onPress={close}>
              <Ionicons name="close" size={24} color={colors.navy} />
            </Pressable>
          </View>
          {session ? (
            <WebView
              key={session.mediaUrl}
              source={{
                uri: `${activeServerUrl(server).replace(/\/$/, '')}${session.mediaUrl}`,
              }}
              style={styles.cameraWebView}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            />
          ) : null}
          <View style={styles.cameraTalkArea}>
            {selected?.capabilities.talk ? (
              <Pressable
                style={[styles.cameraTalkButton, talking && styles.cameraTalkButtonActive]}
                onPressIn={() => void startTalk()}
                onPressOut={() => void stopTalk()}
              >
                <Ionicons name={talking ? 'mic' : 'mic-outline'} size={22} color="#fff" />
                <Text style={styles.cameraTalkText}>
                  {talking ? 'Parlez maintenant' : 'Maintenir pour parler'}
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.cameraAudioNote}>Le son n’est jamais enregistré par Élise.</Text>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function PersonRow({ name, detail, primary }: { name: string; detail: string; primary: boolean }) {
  return (
    <View style={styles.personRow}>
      <View style={styles.personAvatar}>
        <Text style={styles.personInitials}>
          {name
            .split(' ')
            .map((part) => part[0])
            .join('')
            .slice(0, 2)}
        </Text>
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{name}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {primary ? (
        <View style={styles.primaryPill}>
          <Text style={styles.primaryPillText}>PRINCIPAL</Text>
        </View>
      ) : null}
    </View>
  );
}

function JournalTab({
  items,
  schedule,
  refreshing,
  onRefresh,
  onMore,
  hasMore,
}: {
  items: JournalItem[];
  schedule: ScheduleItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onMore: () => void;
  hasMore?: boolean;
}) {
  const [section, setSection] = useState<'notes' | 'agenda'>('notes');
  const upcoming = schedule.filter((item) => new Date(item.startsAt) >= new Date());
  const past = schedule.filter((item) => new Date(item.startsAt) < new Date()).reverse();
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle eyebrow="MÉMOIRE DU FOYER" title="Journal" />
      <Segment
        options={[
          ['notes', 'Notes'],
          ['agenda', 'Agenda'],
        ]}
        value={section}
        onChange={(value) => setSection(value as typeof section)}
      />
      {section === 'notes' ? (
        <View style={styles.card}>
          {items.map((item) => (
            <View key={item.id} style={styles.note}>
              <View style={styles.noteDate}>
                <Text style={styles.noteDay}>{new Date(item.occurredAt).getDate()}</Text>
                <Text style={styles.noteMonth}>
                  {new Intl.DateTimeFormat('fr-FR', { month: 'short' })
                    .format(new Date(item.occurredAt))
                    .toUpperCase()}
                </Text>
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                {item.body ? <Text style={styles.noteBody}>{item.body}</Text> : null}
                <Text style={styles.noteKind}>{item.kind.replaceAll('_', ' ')}</Text>
              </View>
            </View>
          ))}
          {!items.length ? <Empty icon="book-outline" text="Aucune note dans le journal." /> : null}
          {hasMore ? <LoadMore onPress={onMore} /> : null}
        </View>
      ) : null}
      {section === 'agenda' ? (
        <>
          <View style={styles.card}>
            <SectionTitle eyebrow="À VENIR" title="Prochains événements" />
            {upcoming.map((item) => (
              <ScheduleRow key={item.id} item={item} />
            ))}
            {!upcoming.length ? (
              <Empty icon="calendar-outline" text="Aucun événement à venir." />
            ) : null}
          </View>
          {past.length ? (
            <View style={styles.card}>
              <SectionTitle eyebrow="PASSÉS" title="Événements récents" />
              {past.map((item) => (
                <ScheduleRow key={item.id} item={item} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  return (
    <View style={styles.listRow}>
      <View
        style={[styles.rowIcon, item.type === 'VISIT' && { backgroundColor: colors.paleGreen }]}
      >
        <Ionicons
          name={item.type === 'VISIT' ? 'people-outline' : 'medical-outline'}
          color={item.type === 'VISIT' ? colors.green : colors.blue}
          size={19}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowDetail}>
          {fullDate(item.startsAt)}
          {item.detail ? ` · ${item.detail}` : ''}
        </Text>
        {item.notes ? <Text style={styles.noteBody}>{item.notes}</Text> : null}
      </View>
    </View>
  );
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: string[][];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map(([id, label]) => (
        <Pressable
          key={id}
          style={[styles.segmentButton, value === id && styles.segmentActive]}
          onPress={() => onChange(id)}
        >
          <Text style={[styles.segmentText, value === id && styles.segmentTextActive]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}
function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <View style={styles.barBlock}>
      <View style={styles.barLabels}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowDetail}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(4, (value / max) * 100)}%` }]} />
      </View>
    </View>
  );
}
function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={25} color={colors.green} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}
function LoadMore({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.loadMore} onPress={onPress}>
      <Text style={styles.link}>Afficher plus</Text>
      <Ionicons name="chevron-down" size={16} color={colors.blue} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.cream },
  content: { flex: 1 },
  appHeader: {
    minHeight: 73,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hello: { color: colors.muted, fontSize: 12 },
  homeName: { color: colors.navy, fontFamily: 'Georgia', fontSize: 23, marginTop: 2 },
  avatar: {
    width: 43,
    height: 43,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  offlineBanner: {
    minHeight: 35,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.red,
  },
  offlineText: { flex: 1, color: '#fff', fontSize: 10, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, gap: 12 },
  tabBar: {
    minHeight: 66,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    flexDirection: 'row',
    backgroundColor: colors.paper,
  },
  tabButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabText: { color: '#858D94', fontSize: 9, fontWeight: '700' },
  tabTextActive: { color: colors.blue },
  badge: {
    position: 'absolute',
    right: -8,
    top: -5,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red,
  },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  hero: {
    padding: 21,
    borderWidth: 1,
    borderRadius: 21,
    alignItems: 'center',
    backgroundColor: colors.paper,
  },
  heroIcon: {
    width: 52,
    height: 52,
    marginBottom: 14,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.25, fontWeight: '900' },
  heroTitle: {
    marginTop: 7,
    color: colors.navy,
    textAlign: 'center',
    fontFamily: 'Georgia',
    fontSize: 23,
  },
  heroDetail: {
    marginTop: 7,
    color: colors.muted,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 17,
  },
  presenceSummaryHead: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  presenceSummaryCopy: { flex: 1 },
  presenceSummaryTitle: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    marginTop: 5,
  },
  presenceWarningIcon: { backgroundColor: '#fff3d6' },
  presenceWarning: {
    alignItems: 'center',
    backgroundColor: '#fff8e8',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 10,
  },
  presenceWarningText: { color: '#795418', flex: 1, fontSize: 10, lineHeight: 15 },
  presenceActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  presenceWhy: {
    backgroundColor: colors.paleBlue,
    borderRadius: 12,
    gap: 8,
    marginTop: 12,
    padding: 12,
  },
  presenceWhyText: { color: colors.muted, fontSize: 10, lineHeight: 16 },
  presenceDecisionRow: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  presenceDecisionTime: { color: colors.accent, fontSize: 8, fontWeight: '900', marginBottom: 3 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    width: '48.5%',
    minHeight: 137,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.paper,
  },
  smallIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    marginBottom: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  metricLabel: { color: colors.muted, fontSize: 8, letterSpacing: 0.65, fontWeight: '900' },
  metricValue: { marginTop: 6, color: colors.navy, fontSize: 15, fontWeight: '800' },
  metricDetail: { marginTop: 4, color: colors.muted, fontSize: 9 },
  card: {
    padding: 17,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: colors.paper,
  },
  sectionHead: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionTitle: { marginTop: 4, color: colors.navy, fontFamily: 'Georgia', fontSize: 20 },
  link: { color: colors.blue, fontSize: 10, fontWeight: '900' },
  chartLabels: { marginTop: -12, flexDirection: 'row', justifyContent: 'space-between' },
  chartLabel: { color: colors.muted, fontSize: 8 },
  listRow: {
    minHeight: 65,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  rowIcon: {
    width: 39,
    height: 39,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: colors.navy, fontSize: 12, fontWeight: '800' },
  rowDetail: { marginTop: 4, color: colors.muted, fontSize: 9 },
  rowTime: { color: colors.muted, fontSize: 8 },
  segment: { padding: 4, borderRadius: 13, flexDirection: 'row', backgroundColor: '#E7E2DA' },
  segmentButton: {
    flex: 1,
    minHeight: 37,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.paper },
  segmentText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  segmentTextActive: { color: colors.navy },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bigNumber: { marginTop: 4, color: colors.navy, fontFamily: 'Georgia', fontSize: 36 },
  trendPill: {
    paddingHorizontal: 10,
    minHeight: 29,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.paleGreen,
  },
  trendText: { color: colors.green, fontSize: 8, fontWeight: '900' },
  barBlock: { marginBottom: 13 },
  barLabels: { marginBottom: 7, flexDirection: 'row', justifyContent: 'space-between' },
  barTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: '#E5E8E9' },
  barFill: { height: 7, borderRadius: 4, backgroundColor: colors.accent },
  chips: { gap: 7, paddingBottom: 2 },
  chip: {
    minHeight: 35,
    paddingHorizontal: 13,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  chipActive: { borderColor: colors.blue, backgroundColor: colors.blue },
  chipText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  chipTextActive: { color: '#fff' },
  empty: { minHeight: 105, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 10 },
  loadMore: {
    minHeight: 44,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  alertRow: {
    minHeight: 104,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  severity: { width: 4, height: 58, borderRadius: 2 },
  alertMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  statusText: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  alertTitle: { marginTop: 6, color: colors.navy, fontSize: 13, fontWeight: '800' },
  alertExplanation: { marginTop: 4, color: colors.muted, fontSize: 10, lineHeight: 15 },
  modal: { flex: 1, backgroundColor: colors.cream },
  modalHeader: {
    minHeight: 62,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  modalLabel: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  modalContent: { padding: 23, alignItems: 'center', paddingBottom: 50 },
  largeAlertIcon: {
    width: 65,
    height: 65,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    marginTop: 20,
    color: colors.navy,
    textAlign: 'center',
    fontFamily: 'Georgia',
    fontSize: 29,
  },
  modalDate: { marginTop: 8, color: colors.muted, fontSize: 10 },
  explanationCard: {
    width: '100%',
    marginTop: 25,
    padding: 18,
    borderRadius: 17,
    backgroundColor: colors.paper,
  },
  explanationTitle: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  explanationText: { marginTop: 9, color: colors.muted, fontSize: 12, lineHeight: 19 },
  timeline: { width: '100%', marginTop: 25 },
  timelineRow: { minHeight: 37, flexDirection: 'row', alignItems: 'center', gap: 10 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  timelineText: { color: colors.muted, fontSize: 10 },
  alertActions: { width: '100%', marginTop: 25, gap: 10 },
  primaryButton: {
    minHeight: 51,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  primaryButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  secondaryButton: {
    minHeight: 51,
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.blue, fontSize: 11, fontWeight: '900' },
  dismissText: {
    padding: 13,
    color: colors.red,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
  },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roomCard: {
    width: '48.5%',
    minHeight: 156,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 17,
    backgroundColor: colors.paper,
  },
  roomTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomIcon: {
    width: 39,
    height: 39,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  roomName: { marginTop: 14, color: colors.navy, fontSize: 14, fontWeight: '900' },
  roomStatus: { marginTop: 5, color: colors.muted, fontSize: 9 },
  roomValue: { marginTop: 10, color: colors.accent, fontSize: 12, fontWeight: '900' },
  sensorRow: {
    minHeight: 75,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sensorStatus: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sensorRight: { alignItems: 'flex-end' },
  sensorValue: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  sensorState: { marginTop: 4, fontSize: 7, fontWeight: '900' },
  personRow: {
    minHeight: 68,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  personAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  personInitials: { color: '#fff', fontSize: 11, fontWeight: '900' },
  primaryPill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: colors.paleGreen,
  },
  primaryPillText: { color: colors.green, fontSize: 7, fontWeight: '900' },
  note: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    gap: 13,
  },
  noteDate: {
    width: 43,
    height: 48,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  noteDay: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  noteMonth: { color: colors.accent, fontSize: 7, fontWeight: '900' },
  noteBody: { marginTop: 6, color: colors.muted, fontSize: 10, lineHeight: 15 },
  noteKind: { marginTop: 7, color: colors.accent, fontSize: 7, fontWeight: '900' },
  healthCard: { backgroundColor: colors.paper },
  alertCount: { color: colors.red },
  dashboard: { flex: 1 },
  separator: { height: 1, backgroundColor: colors.line },
  muted: { color: colors.muted },
  paper: { backgroundColor: colors.paper },
  blue: { color: colors.blue },
  green: { color: colors.green },
  amber: { color: colors.amber },
  red: { color: colors.red },
  line: { borderColor: colors.line },
  cream: { backgroundColor: colors.cream },
  spacer: { height: 8 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  hidden: { opacity: 0 },
  caption: { fontSize: 9 },
  body: { fontSize: 12 },
  title: { fontSize: 20 },
  rounded: { borderRadius: 12 },
  shadow: {
    shadowColor: colors.navy,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  border: { borderWidth: 1 },
  padding: { padding: 12 },
  gap: { gap: 8 },
  transparent: { backgroundColor: 'transparent' },
  white: { color: '#fff' },
  bold: { fontWeight: '800' },
  textCenter: { textAlign: 'center' },
  overflow: { overflow: 'hidden' },
  absolute: { position: 'absolute' },
  small: { fontSize: 10 },
  large: { fontSize: 24 },
  top: { marginTop: 10 },
  bottom: { marginBottom: 10 },
  left: { marginLeft: 10 },
  right: { marginRight: 10 },
  width: { width: '100%' },
  height: { minHeight: 44 },
  opacity: { opacity: 0.7 },
  uppercase: { textTransform: 'uppercase' },
  letter: { letterSpacing: 1 },
  justify: { justifyContent: 'space-between' },
  align: { alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  noBorder: { borderWidth: 0 },
  noMargin: { margin: 0 },
  noPadding: { padding: 0 },
  square: { aspectRatio: 1 },
  circle: { borderRadius: 999 },
  screen: { flex: 1 },
  safe: { flex: 1 },
  box: { padding: 10 },
  info: { color: colors.accent },
  warning: { color: colors.amber },
  danger: { color: colors.red },
  success: { color: colors.green },
  background: { backgroundColor: colors.cream },
  surface: { backgroundColor: colors.paper },
  hairline: { borderWidth: StyleSheet.hairlineWidth },
  compact: { minHeight: 36 },
  normal: { fontWeight: '400' },
  semibold: { fontWeight: '600' },
  extraBold: { fontWeight: '900' },
  serif: { fontFamily: 'Georgia' },
  tiny: { fontSize: 8 },
  medium: { fontSize: 14 },
  extraLarge: { fontSize: 30 },
  icon: { width: 40, height: 40 },
  pill: { borderRadius: 20 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  end: { alignItems: 'flex-end' },
  start: { alignItems: 'flex-start' },
  around: { justifyContent: 'space-around' },
  evenly: { justifyContent: 'space-evenly' },
  baseline: { alignItems: 'baseline' },
  grow: { flexGrow: 1 },
  shrink: { flexShrink: 1 },
  relative: { position: 'relative' },
  z: { zIndex: 1 },
  clip: { overflow: 'hidden' },
  underline: { textDecorationLine: 'underline' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  full: { width: '100%', height: '100%' },
  flexEnd: { justifyContent: 'flex-end' },
  flexStart: { justifyContent: 'flex-start' },
  justifyCenter: { justifyContent: 'center' },
  selfCenter: { alignSelf: 'center' },
  selfStretch: { alignSelf: 'stretch' },
  textRight: { textAlign: 'right' },
  textLeft: { textAlign: 'left' },
  elevation: { elevation: 1 },
  none: { display: 'none' },
  auto: { alignSelf: 'auto' },
  stretch: { alignItems: 'stretch' },
  relativeTop: { top: 0 },
  relativeBottom: { bottom: 0 },
  relativeLeft: { left: 0 },
  relativeRight: { right: 0 },
  zero: { width: 0, height: 0 },
  one: { flex: 1 },
  horizontal: { flexDirection: 'row' },
  vertical: { flexDirection: 'column' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  inset: { marginHorizontal: 20 },
  section: { marginTop: 16 },
  footer: { paddingBottom: 20 },
  header: { paddingTop: 10 },
  cardGap: { gap: 12 },
  listGap: { gap: 4 },
  textGap: { gap: 3 },
  iconGap: { gap: 6 },
  buttonGap: { gap: 10 },
  safeBottom: { paddingBottom: 8 },
  safeTop: { paddingTop: 8 },
  max: { maxWidth: 520 },
  min: { minHeight: 1 },
  visible: { opacity: 1 },
  disabled: { opacity: 0.45 },
  selected: { borderColor: colors.blue },
  deselected: { borderColor: colors.line },
  interactive: { minHeight: 44 },
  focus: { borderColor: colors.accent },
  pressed: { opacity: 0.8 },
  loading: { opacity: 0.6 },
  stale: { opacity: 0.75 },
  connected: { color: colors.green },
  disconnected: { color: colors.red },
  local: { color: colors.accent },
  realtime: { color: colors.green },
  cached: { color: colors.amber },
  online: { color: colors.green },
  offline: { color: colors.red },
  active: { color: colors.blue },
  inactive: { color: colors.muted },
  open: { color: colors.amber },
  resolved: { color: colors.green },
  dismissed: { color: colors.muted },
  acknowledged: { color: colors.accent },
  urgent: { color: colors.red },
  attention: { color: colors.amber },
  cameraPrivacyNote: {
    alignItems: 'center',
    backgroundColor: colors.paleGreen,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 12,
    padding: 13,
  },
  cameraPrivacyText: { color: colors.green, flex: 1, fontSize: 11, fontWeight: '700' },
  mobileCameraGrid: { gap: 12 },
  mobileCameraCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingBottom: 15,
  },
  mobileCameraVisual: {
    alignItems: 'center',
    backgroundColor: '#214F50',
    height: 132,
    justifyContent: 'center',
    marginBottom: 14,
    position: 'relative',
  },
  mobileCameraVisualPrivate: { backgroundColor: '#E4E7E3' },
  mobileCameraStatus: {
    backgroundColor: 'rgba(5, 28, 29, 0.72)',
    borderRadius: 12,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    position: 'absolute',
    top: 12,
  },
  mobileCameraStatusText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  mobileCameraRoom: {
    color: colors.green,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginHorizontal: 15,
    textTransform: 'uppercase',
  },
  mobileCameraName: {
    color: colors.navy,
    fontFamily: 'Georgia',
    fontSize: 19,
    marginHorizontal: 15,
    marginTop: 4,
  },
  mobileCameraDetail: { color: colors.muted, fontSize: 11, marginHorizontal: 15, marginTop: 4 },
  mobileCameraActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    marginHorizontal: 15,
    marginTop: 14,
  },
  mobileCameraOpen: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    minHeight: 42,
    paddingHorizontal: 16,
  },
  mobileCameraOpenText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  mobilePrivacyButton: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  disabledButton: { opacity: 0.45 },
  cameraModal: { backgroundColor: colors.paper, flex: 1 },
  cameraModalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  cameraModalLive: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  cameraModalTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 24, marginTop: 4 },
  cameraModalRoom: { color: colors.muted, fontSize: 12, marginTop: 2 },
  modalClose: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  cameraWebView: { backgroundColor: '#102D2D', flex: 1 },
  cameraTalkArea: { alignItems: 'center', gap: 10, padding: 20 },
  cameraTalkButton: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: 30,
    flexDirection: 'row',
    gap: 9,
    minHeight: 50,
    paddingHorizontal: 22,
  },
  cameraTalkButtonActive: { backgroundColor: colors.red },
  cameraTalkText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  cameraAudioNote: { color: colors.muted, fontSize: 10 },
  mobileAlertSnapshot: { marginTop: 14, width: '100%' },
  mobileAlertSnapshotImage: {
    aspectRatio: 16 / 9,
    backgroundColor: '#102D2D',
    borderRadius: 15,
    width: '100%',
  },
  mobileAlertSnapshotNote: { color: colors.muted, fontSize: 9, marginTop: 7 },
  mobileSnapshotButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.paleGreen,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 13,
  },
  mobileSnapshotButtonText: { color: colors.green, fontSize: 11, fontWeight: '800' },
  sensorAddButton: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 48,
  },
  sensorAddText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  sensorSetupShell: { backgroundColor: colors.paper, flex: 1 },
  sensorSetupContent: { padding: 20, paddingBottom: 50 },
  sensorSetupTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 28, marginTop: 6 },
  sensorSetupLead: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  sensorSetupSection: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 24,
    paddingTop: 20,
  },
  sensorSetupHeading: { color: colors.navy, fontSize: 16, fontWeight: '900', marginTop: 8 },
  sensorChoiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  sensorChoice: {
    backgroundColor: colors.paleBlue,
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  sensorChoiceActive: { backgroundColor: colors.paleGreen, borderColor: colors.green },
  sensorChoiceText: { color: colors.navy, fontSize: 11, fontWeight: '800' },
  sensorGuide: { backgroundColor: '#EEF4F4', borderRadius: 16, marginTop: 24, padding: 17 },
  sensorGuideStep: { color: colors.navy, fontSize: 12, lineHeight: 19, marginTop: 8 },
  sensorSafety: {
    borderLeftColor: colors.amber,
    borderLeftWidth: 3,
    color: '#76512F',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
    paddingLeft: 10,
  },
  sensorConfirmButton: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 14,
    marginTop: 20,
    minHeight: 48,
    justifyContent: 'center',
  },
  sensorConfirmText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  sensorTestButton: {
    alignItems: 'center',
    borderColor: colors.blue,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 48,
  },
  sensorTestText: { color: colors.blue, fontSize: 12, fontWeight: '900' },
  buttonDisabled: { opacity: 0.45 },
  sensorProtocolList: { gap: 10, marginTop: 20 },
  sensorGroupLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 25,
  },
  mobilePreparationList: { gap: 9, marginTop: 22 },
  mobilePreparationStep: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    padding: 13,
  },
  mobilePreparationNumber: {
    backgroundColor: colors.paleBlue,
    borderRadius: 19,
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    height: 38,
    lineHeight: 38,
    textAlign: 'center',
    width: 38,
  },
  mobileAutomaticSearchButton: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 50,
  },
  sensorProtocolButton: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 13,
    minHeight: 72,
    paddingHorizontal: 14,
  },
  sensorProtocolIcon: {
    alignItems: 'center',
    backgroundColor: colors.paleBlue,
    borderRadius: 12,
    height: 45,
    justifyContent: 'center',
    width: 45,
  },
  unavailableProtocolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  unavailableProtocolChip: {
    backgroundColor: '#F0EEEA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unavailableProtocolText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  mobilePairing: { alignItems: 'center', gap: 8, marginTop: 70, paddingHorizontal: 20 },
  mobilePairingRadar: {
    alignItems: 'center',
    backgroundColor: colors.paleBlue,
    borderColor: '#B9D4DC',
    borderRadius: 48,
    borderWidth: 8,
    height: 96,
    justifyContent: 'center',
    marginBottom: 12,
    width: 96,
  },
  mobilePairingTime: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  mobileNetworkChip: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mobileNetworkDot: { borderRadius: 4, height: 8, width: 8 },
  mobileNetworkText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  mobileFoundBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.paleGreen,
    borderRadius: 20,
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  mobileFoundBadgeText: { color: colors.green, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  mobileDetectedCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    padding: 14,
  },
  mobileCapabilityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
  mobileCapability: { backgroundColor: '#EEF4F4', borderRadius: 11, minWidth: '47%', padding: 11 },
  mobileCapabilityLabel: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  mobileCapabilityValue: { color: colors.navy, fontSize: 13, fontWeight: '900', marginTop: 3 },
  mobileSensorNameInput: {
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    color: colors.navy,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 9,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  mobileRoomChoice: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginTop: 9,
    minHeight: 55,
    paddingHorizontal: 12,
  },
  mobileFloorGroup: { color: colors.accent, fontSize: 10, fontWeight: '900', marginTop: 17 },
  mobilePlanShell: {
    backgroundColor: '#fff',
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    overflow: 'hidden',
  },
  mobilePlanMode: { backgroundColor: colors.cream, flexDirection: 'row', gap: 5, padding: 6 },
  mobilePlanModeButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 42,
  },
  mobilePlanModeActive: { backgroundColor: colors.navy },
  mobilePlanModeText: { color: colors.blue, fontSize: 11, fontWeight: '900' },
  mobilePlanModeTextActive: { color: '#fff' },
  mobileFloorTabs: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
    padding: 8,
  },
  mobileFloorTab: {
    backgroundColor: colors.cream,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  mobileFloorTabActive: { backgroundColor: colors.paleBlue },
  mobileFloorText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  mobileFloorTextActive: { color: colors.blue },
  mobilePlanTools: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 7,
    padding: 8,
  },
  mobileSaving: { justifyContent: 'center', paddingHorizontal: 6 },
  mobilePlanScroller: { backgroundColor: '#edf1f0' },
  mobilePlanCanvas: { backgroundColor: '#fff', margin: 10 },
  mobilePresence: {
    alignItems: 'center',
    backgroundColor: colors.paleGreen,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mobilePresenceDot: { backgroundColor: colors.green, borderRadius: 6, height: 11, width: 11 },
  mobilePresenceDotTransit: { backgroundColor: colors.amber },
  mobilePresenceTitle: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  mobilePresenceDetail: { color: colors.muted, fontSize: 8, marginTop: 2 },
  mobileRoomInspector: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  mobileInspectorHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  mobileInspectorTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 20, marginTop: 3 },
  mobilePlanInput: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.navy,
    fontSize: 12,
    height: 44,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  mobileDimensionRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 9 },
  mobileDimensionInput: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.navy,
    fontSize: 12,
    height: 40,
    paddingHorizontal: 10,
    width: 72,
  },
  mobileDimensionLabel: { color: colors.muted, fontSize: 10 },
  mobileInspectorActions: { gap: 7, marginTop: 12 },
  mobileEquipmentTray: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 13,
  },
  mobileTrayTitle: { color: colors.navy, fontSize: 10, fontWeight: '900', marginBottom: 9 },
  mobileEquipmentChip: {
    alignItems: 'center',
    backgroundColor: colors.paleBlue,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    marginRight: 7,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  mobileWizardBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(11,41,72,.7)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  mobileWizard: { backgroundColor: colors.paper, borderRadius: 22, padding: 26, width: '100%' },
  mobileWizardIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.navy,
    borderRadius: 17,
    height: 58,
    justifyContent: 'center',
    marginBottom: 18,
    width: 58,
  },
  mobileWizardTitle: {
    color: colors.navy,
    fontFamily: 'Georgia',
    fontSize: 27,
    marginTop: 5,
    textAlign: 'center',
  },
  mobileWizardText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
    textAlign: 'center',
  },
  mobileWizardLabel: { color: colors.navy, fontSize: 10, fontWeight: '900', marginTop: 22 },
  mobileWizardLevels: { flexDirection: 'row', gap: 8, marginTop: 9 },
  mobileWizardLevel: {
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: 10,
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  mobileWizardLevelActive: { backgroundColor: colors.blue },
  mobileWizardLevelText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  mobileWizardLevelTextActive: { color: '#fff' },
  mobileWizardButton: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    marginTop: 22,
  },
  mobileWizardFoot: { color: colors.muted, fontSize: 9, marginTop: 10, textAlign: 'center' },
});
