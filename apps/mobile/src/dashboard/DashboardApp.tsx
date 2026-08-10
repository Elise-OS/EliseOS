import { Ionicons } from '@expo/vector-icons';
import type { ActivitySummary, DashboardPeriod, Household, ScheduleItem } from '@michel/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import EventSource, { type MessageEvent } from 'react-native-sse';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import {
  mobileApi,
  type ActivityItem,
  type AlertItem,
  type JournalItem,
  type Overview,
} from '../api';
import type { SavedServer } from '../discovery/types';
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
  contact: { label: 'Ouverture', icon: 'enter-outline' },
  button: { label: 'Bouton', icon: 'radio-button-on-outline' },
  temperature: { label: 'Température', icon: 'thermometer-outline' },
  humidity: { label: 'Humidité', icon: 'water-outline' },
  power: { label: 'Puissance', icon: 'flash-outline' },
  energy: { label: 'Énergie', icon: 'battery-charging-outline' },
  battery: { label: 'Batterie', icon: 'battery-half-outline' },
};

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

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: rootKey });

  useEffect(() => {
    let stream: EventSource | null = null;
    const open = () => {
      stream?.close();
      stream = new EventSource(`${server.url}/api/v1/events`, {
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
            activity: ['overview', 'activity', 'summary', 'household'],
            alerts: ['overview', 'alerts'],
            household: ['overview', 'household'],
            journal: ['journal'],
            schedule: ['overview', 'schedule'],
          };
          for (const domain of domains[event.type] ?? [])
            void queryClient.invalidateQueries({ queryKey: [...rootKey, domain] });
        } catch {
          // Ignore malformed local events; the next reconnect performs a full refresh.
        }
      });
    };
    open();
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        open();
        void invalidateAll();
      } else stream?.close();
    });
    return () => {
      state.remove();
      stream?.close();
    };
  }, [queryClient, rootKey, server.url, token]);

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
            household={household.data ?? null}
            refreshing={household.isRefetching}
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
  refreshing,
  onRefresh,
  goTo,
}: {
  overview?: Overview;
  summary?: ActivitySummary;
  activity: ActivityItem[];
  alerts: AlertItem[];
  schedule: ScheduleItem[];
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
          <Pressable key={item.id} style={styles.alertRow} onPress={() => setSelected(item)}>
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

function HouseTab({
  household,
  refreshing,
  onRefresh,
}: {
  household: Household | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [section, setSection] = useState<'rooms' | 'sensors' | 'people'>('rooms');
  const sensors = [
    ...(household?.rooms.flatMap((room) => room.sensors) ?? []),
    ...(household?.unassignedSensors ?? []),
  ];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle eyebrow="FOYER" title="Maison" />
      <Segment
        options={[
          ['rooms', 'Pièces'],
          ['sensors', 'Capteurs'],
          ['people', 'Entourage'],
        ]}
        value={section}
        onChange={(value) => setSection(value as typeof section)}
      />
      {section === 'rooms' ? (
        <View style={styles.roomGrid}>
          {household?.rooms.map((room) => {
            const good = room.sensors.filter((sensor) => sensor.status === 'ONLINE').length;
            return (
              <View key={room.id} style={styles.roomCard}>
                <View style={styles.roomTop}>
                  <View style={styles.roomIcon}>
                    <Ionicons name={roomIcon(room.kind)} size={21} color={colors.blue} />
                  </View>
                  <View
                    style={[
                      styles.healthDot,
                      {
                        backgroundColor: good === room.sensors.length ? colors.green : colors.amber,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomStatus}>
                  {good}/{room.sensors.length} capteurs en ligne
                </Text>
                {room.sensors.find((sensor) => friendlyValue(sensor.lastValue)) ? (
                  <Text style={styles.roomValue}>
                    {friendlyValue(
                      room.sensors.find((sensor) => friendlyValue(sensor.lastValue))?.lastValue ??
                        null,
                    )}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {section === 'sensors' ? (
        <View style={styles.card}>
          {sensors.map((sensor) => (
            <View key={sensor.id} style={styles.sensorRow}>
              <View
                style={[
                  styles.sensorStatus,
                  {
                    backgroundColor:
                      sensor.status === 'ONLINE' ? colors.paleGreen : colors.paleAmber,
                  },
                ]}
              >
                <Ionicons
                  name={capabilityMeta[sensor.capability]?.icon ?? 'hardware-chip-outline'}
                  size={19}
                  color={sensor.status === 'ONLINE' ? colors.green : colors.amber}
                />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>
                  {capabilityMeta[sensor.capability]?.label ?? sensor.capability}
                </Text>
                <Text numberOfLines={1} style={styles.rowDetail}>
                  {sensor.device?.name ?? sensor.entityId} · {relativeTime(sensor.lastSeenAt)}
                </Text>
              </View>
              <View style={styles.sensorRight}>
                <Text style={styles.sensorValue}>{friendlyValue(sensor.lastValue) ?? '—'}</Text>
                <Text
                  style={[
                    styles.sensorState,
                    { color: sensor.status === 'ONLINE' ? colors.green : colors.amber },
                  ]}
                >
                  {sensor.status === 'ONLINE' ? 'EN LIGNE' : sensor.status}
                </Text>
              </View>
            </View>
          ))}
          {!sensors.length ? (
            <Empty icon="hardware-chip-outline" text="Aucun capteur configuré." />
          ) : null}
        </View>
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
function roomIcon(kind: string): IconName {
  if (kind.includes('BED')) return 'bed-outline';
  if (kind.includes('BATH')) return 'water-outline';
  if (kind.includes('KITCHEN')) return 'restaurant-outline';
  if (kind.includes('ENTRANCE')) return 'enter-outline';
  return 'home-outline';
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
});
