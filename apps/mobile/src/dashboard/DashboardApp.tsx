import { MobileLiaisonPanel } from './MobileLiaisonPanel';
import { MobileCalendarPanel } from './MobileCalendarPanel';
import { MobileScreenPanel } from '../screen/MobileScreenPanel';
import { MobileWelcomePanel } from './MobileWelcomePanel';
import { MobilePeoplePanel } from './MobilePeoplePanel';
import { MobileSettingsPanel } from './MobileSettingsPanel';
import { MobileHomePlanPanel } from './MobileHomePlanPanel';
import { AppleLiquidGlassBackground } from './AppleLiquidGlassBackground';
import { MobileCallOverlay } from '../screen/MobileCallOverlay';
import { Ionicons } from '@expo/vector-icons';
import { Sofa } from 'lucide-react-native';
import { configuredHomeDevicesForCategory } from '@michel/contracts';
import NetInfo from '@react-native-community/netinfo';
import type {
  ActivityEvent,
  ActivitySequence,
  HomePlan,
  HomeSummary,
  RoomSensorCategory,
  ScreenJoin,
  SensorDevice,
} from '@michel/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Modal,
  Platform,
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
import {
  isMobileApiAuthError,
  mobileApi,
  type AlertItem,
  type CameraItem,
  type JournalItem,
} from '../api';
import { caregiverPresenceCopy } from './presence-copy';
import type { SavedServer } from '../discovery/types';
import {
  activeServerUrl,
  preferredServerUrls,
  rememberActiveServerUrl,
} from '../discovery/helpers';
import { subscribeNotificationNavigation } from '../notifications';
import { relativeTime } from './formatters';
import { isDemoServer } from '../demo/mock-api';

type Tab = 'home' | 'activity' | 'alerts' | 'house' | 'journal' | 'screen' | 'people' | 'settings';
type IconName = React.ComponentProps<typeof Ionicons>['name'];
type SafetyCategory = Extract<RoomSensorCategory, 'fall_detection' | 'smoke' | 'water_leak'>;
type SafetyCoverage = { devices: SensorDevice[]; attentionCount: number };

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
  { id: 'house', label: 'Logement', icon: 'home-outline', active: 'home' },
  { id: 'journal', label: 'Liaison', icon: 'book-outline', active: 'book' },
  { id: 'screen', label: 'Affichage TV', icon: 'tv-outline', active: 'tv' },
  { id: 'settings', label: 'Réglages', icon: 'settings-outline', active: 'settings' },
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

const fullDate = (value: string, timeZone = 'Europe/Paris') =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

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

const safetyCoverageCopy = (
  coverage: SafetyCoverage | null,
  locale: 'fr' | 'en',
  loading: boolean,
) => {
  const fr = locale === 'fr';
  if (loading) return fr ? 'Chargement des capteurs…' : 'Loading sensors…';
  if (!coverage) return fr ? 'Données du logement indisponibles' : 'Home data unavailable';
  const { devices, attentionCount } = coverage;
  if (!devices.length) return fr ? 'Aucun détecteur configuré' : 'No detector configured';
  const onlineCount = devices.length - attentionCount;
  if (!attentionCount)
    return fr
      ? `${devices.length} capteur${devices.length > 1 ? 's' : ''} · En ligne`
      : `${devices.length} sensor${devices.length > 1 ? 's' : ''} · Online`;
  if (!onlineCount)
    return fr
      ? `${devices.length} capteur${devices.length > 1 ? 's' : ''} · À vérifier`
      : `${devices.length} sensor${devices.length > 1 ? 's' : ''} · Needs checking`;
  return fr
    ? `${onlineCount} en ligne · ${attentionCount} à vérifier`
    : `${onlineCount} online · ${attentionCount} to check`;
};

const safetyCoverageTone = (coverage: SafetyCoverage | null, loading: boolean) =>
  loading
    ? 'pending'
    : !coverage
      ? 'unavailable'
      : !coverage.devices.length
        ? 'unconfigured'
        : coverage.attentionCount
          ? 'attention'
          : 'online';

const alertTitleText = (item: AlertItem, fr: boolean) => {
  const titles: Record<string, [string, string]> = {
    WATER_LEAK: ['Fuite d’eau détectée', 'Water leak detected'],
    SMOKE: ['Fumée détectée', 'Smoke detected'],
    CARBON_MONOXIDE: ['Monoxyde de carbone détecté', 'Carbon monoxide detected'],
    FALL_DETECTION: ['Alerte de chute', 'Possible fall detected'],
    SOS: ['Bouton d’assistance activé', 'Assistance button pressed'],
  };
  if (titles[item.type]) return titles[item.type][fr ? 0 : 1];
  if (item.type === 'SENSOR_OFFLINE') {
    const sensorName = item.title.replace(/ ne répond plus$/i, '');
    return fr ? item.title : `${sensorName} is offline`;
  }
  return item.title;
};

const alertExplanationText = (item: AlertItem, fr: boolean) => {
  const explanations: Record<string, [string, string]> = {
    WATER_LEAK: [
      'Le capteur a signalé la présence d’eau. Vérifiez la zone concernée et coupez l’eau si nécessaire.',
      'The sensor reported water. Check the affected area and turn off the water if needed.',
    ],
    SMOKE: [
      'Le détecteur de fumée s’est déclenché. Vérifiez rapidement la situation sans vous exposer au danger.',
      'The smoke detector was triggered. Check promptly without putting yourself in danger.',
    ],
    CARBON_MONOXIDE: [
      'Le détecteur a signalé du monoxyde de carbone. Vérifiez immédiatement la situation et suivez les consignes d’urgence.',
      'The detector reported carbon monoxide. Check immediately and follow emergency guidance.',
    ],
    FALL_DETECTION: [
      'Le détecteur signale une chute possible. Vérifiez rapidement que la personne va bien.',
      'The detector reported a possible fall. Check promptly that the resident is all right.',
    ],
    SOS: [
      'Le bouton d’assistance du domicile a été activé. Contactez rapidement la personne.',
      'The home assistance button was pressed. Contact the resident promptly.',
    ],
    SENSOR_OFFLINE: [
      'Élise ne reçoit plus de données de ce capteur. Vérifiez son alimentation et sa connexion ; les conclusions qui en dépendent sont suspendues.',
      'Élise is no longer receiving data from this sensor. Check its power and connection; conclusions that depend on it are suspended.',
    ],
  };
  return explanations[item.type]?.[fr ? 0 : 1] ?? item.explanation;
};

const sensorEventText = (payload: unknown, fr: boolean) => {
  if (!payload || typeof payload !== 'object') return fr ? 'Événement du capteur' : 'Sensor event';
  const value = payload as Record<string, unknown>;
  if (value.fallStatus === 'fall_alarm') return fr ? 'Chute signalée' : 'Fall reported';
  if (value.fallStatus === 'fall_warning')
    return fr ? 'Chute possible signalée' : 'Possible fall reported';
  if (value.fallStatus === 'normal')
    return fr ? 'Détecteur revenu à l’état normal' : 'Detector returned to normal';
  if (typeof value.active === 'boolean')
    return value.active
      ? fr
        ? 'Détection active'
        : 'Detection active'
      : fr
        ? 'Retour à la normale'
        : 'Returned to normal';
  if (typeof value.open === 'boolean')
    return value.open
      ? fr
        ? 'Ouverture détectée'
        : 'Opening detected'
      : fr
        ? 'Fermeture détectée'
        : 'Closed';
  return fr ? 'Événement du capteur' : 'Sensor event';
};

interface DashboardAppProps {
  server: SavedServer;
  token: string;
  userName: string;
  locale: 'fr' | 'en';
  onLocaleChange: (locale: 'fr' | 'en') => void;
  onLogout: () => Promise<void>;
}

export function DashboardApp({
  server,
  token,
  userName,
  locale,
  onLocaleChange,
  onLogout,
}: DashboardAppProps) {
  const queryClient = useQueryClient();
  const rootKey = useMemo(() => ['michel', server.id] as const, [server.id]);
  const [tab, setTab] = useState<Tab>('home');
  const [legacyJournal, setLegacyJournal] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'general' | 'rules' | 'notifications'>(
    'general',
  );
  const [mobileCallId, setMobileCallId] = useState<string | null>(null);
  const [mobileCallJoin, setMobileCallJoin] = useState<ScreenJoin | null>(null);
  const [mobileCallJoinError, setMobileCallJoinError] = useState('');
  const mobileCallJoinRequested = useRef<string | null>(null);
  const mobileCallStarting = useRef(false);
  const demoMode = isDemoServer(server);
  const loggedOutForAuth = useRef(false);

  useEffect(
    () =>
      subscribeNotificationNavigation((destination) => {
        setTab(destination);
        if (destination === 'journal') {
          setCalendarOpen(false);
          setLegacyJournal(false);
        }
        void queryClient.invalidateQueries({ queryKey: [...rootKey, destination] });
      }),
    [queryClient, rootKey],
  );

  const overview = useQuery({
    queryKey: [...rootKey, 'overview'],
    queryFn: () => mobileApi.overview(server, token),
  });
  const serverHealth = useQuery({
    queryKey: [...rootKey, 'server-health'],
    queryFn: () => mobileApi.health(server),
    enabled: !demoMode,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const currentUser = useQuery({
    queryKey: [...rootKey, 'current-user'],
    queryFn: () => mobileApi.me(server, token),
  });
  const homeSummary = useQuery({
    queryKey: [...rootKey, 'home-summary'],
    queryFn: () => mobileApi.homeSummary(server, token),
  });
  const screen = useQuery({
    queryKey: [...rootKey, 'screen'],
    queryFn: () => mobileApi.screen(server, token),
    refetchInterval: (query) => (query.state.data?.state.call ? 2_000 : false),
    refetchIntervalInBackground: false,
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
  const homePlan = useQuery({
    queryKey: [...rootKey, 'home-plan'],
    queryFn: () => mobileApi.homePlan(server, token),
  });
  const sensorProtocols = useQuery({
    queryKey: [...rootKey, 'sensor-protocols'],
    queryFn: () => mobileApi.sensorProtocols(server, token),
  });
  const screenRole = currentUser.data?.role ?? 'VIEWER';

  const startMobileCall = async () => {
    if (demoMode) {
      Alert.alert('Appel simulé', 'La démonstration ne lance aucun appel réel.');
      return;
    }
    if (mobileCallStarting.current || mobileCallId) return;
    mobileCallStarting.current = true;
    try {
      const snapshot = await mobileApi.screenCall(server, token);
      const call = snapshot.state.call;
      if (!call) throw new Error('L’appel n’a pas pu être lancé.');
      mobileCallJoinRequested.current = null;
      setMobileCallJoin(null);
      setMobileCallJoinError('');
      queryClient.setQueryData([...rootKey, 'screen'], snapshot);
      setMobileCallId(call.id);
    } finally {
      mobileCallStarting.current = false;
    }
  };

  useEffect(() => {
    if (!mobileCallId) return;
    const call = screen.data?.state.call;
    if (!call || call.id !== mobileCallId) {
      setMobileCallId(null);
      setMobileCallJoin(null);
      setMobileCallJoinError('');
      mobileCallJoinRequested.current = null;
      return;
    }
    if (
      !call.acceptedAt ||
      call.userId !== currentUser.data?.id ||
      mobileCallJoinRequested.current === call.id
    )
      return;

    mobileCallJoinRequested.current = call.id;
    let disposed = false;
    void mobileApi
      .screenCallJoin(server, token, call.id)
      .then((join) => {
        if (!disposed) setMobileCallJoin(join);
      })
      .catch((cause) => {
        if (!disposed)
          setMobileCallJoinError(
            cause instanceof Error ? cause.message : 'Impossible de rejoindre la visioconférence.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [
    currentUser.data?.id,
    mobileCallId,
    screen.data?.state.call?.acceptedAt,
    screen.data?.state.call?.id,
    screen.data?.state.call?.userId,
    server,
    token,
  ]);

  const endMobileCall = async () => {
    const callId = mobileCallId;
    setMobileCallId(null);
    setMobileCallJoin(null);
    setMobileCallJoinError('');
    mobileCallJoinRequested.current = null;
    if (!callId || demoMode) return;
    try {
      await mobileApi.screenEndCall(server, token, callId);
    } catch {
      Alert.alert(
        locale === 'fr' ? 'Appel terminé' : 'Call ended',
        locale === 'fr'
          ? 'La fermeture de l’appel sur l’écran du logement n’a pas pu être confirmée.'
          : 'The home screen could not be notified that the call ended.',
      );
    } finally {
      void queryClient.invalidateQueries({ queryKey: [...rootKey, 'screen'] });
    }
  };

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: rootKey });

  useEffect(() => {
    let wasAvailable = true;
    return NetInfo.addEventListener((state) => {
      const available = state.isConnected !== false;
      if (available && !wasAvailable) {
        void queryClient.refetchQueries({ queryKey: rootKey, type: 'active' });
      }
      wasAvailable = available;
    });
  }, [queryClient, rootKey]);

  useEffect(() => {
    if (demoMode) return;
    let stream: EventSource | null = null;
    let streamUrl = '';
    let endpointIndex = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const pendingDomains = new Set<string>();
    const refreshDomains = () => {
      refreshTimer = undefined;
      for (const domain of pendingDomains)
        void queryClient.invalidateQueries(
          { queryKey: [...rootKey, domain] },
          { cancelRefetch: false },
        );
      pendingDomains.clear();
    };
    let appActive = true;
    let disposed = false;
    let generation = 0;
    const clearReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const open = (preferActive = true) => {
      if (disposed || !appActive) return;
      clearReconnect();
      const urls = preferredServerUrls(server);
      if (!urls.length) return;
      if (preferActive) {
        const activeIndex = urls.indexOf(activeServerUrl(server));
        if (activeIndex >= 0) endpointIndex = activeIndex;
      }
      endpointIndex %= urls.length;
      const url = urls[endpointIndex];
      stream?.close();
      streamUrl = url;
      const currentGeneration = ++generation;
      const current = new EventSource(`${url}/api/v1/events`, {
        headers: { Authorization: `Bearer ${token}` },
        pollingInterval: 3_000,
      });
      stream = current;
      current.addEventListener('open', () => {
        if (currentGeneration !== generation) return;
        rememberActiveServerUrl(server, url);
      });
      current.addEventListener('error', () => {
        if (currentGeneration !== generation) return;
        endpointIndex = (endpointIndex + 1) % urls.length;
        reconnectTimer = setTimeout(() => open(false), 1_500);
      });
      current.addEventListener('message', (message: MessageEvent) => {
        if (currentGeneration !== generation) return;
        if (!message.data) return;
        try {
          const event = JSON.parse(message.data) as { type: string };
          if (event.type === 'heartbeat' || event.type === 'connected') return;
          const domains: Record<string, string[]> = {
            activity: [
              'overview',
              'activity',
              'summary',
              'activity-summary-day',
              'home-summary',
              'household',
              'presence',
            ],
            alerts: ['overview', 'alerts', 'alert-summary'],
            household: [
              'overview',
              'home-plan',
              'sensor-devices',
              'sensor-protocols',
              'home-summary',
              'liaison',
            ],
            screen: ['screen'],
            home: ['overview', 'home-summary', 'screen', 'activity', 'summary', 'schedule'],
            liaison: ['liaison'],
            journal: ['journal'],
            schedule: ['overview', 'schedule', 'liaison'],
            presence: ['presence', 'presence-history'],
          };
          for (const domain of domains[event.type] ?? []) {
            if (event.type === 'activity' || event.type === 'presence') {
              pendingDomains.add(domain);
              refreshTimer ??= setTimeout(refreshDomains, 3_000);
            } else {
              void queryClient.invalidateQueries(
                { queryKey: [...rootKey, domain] },
                { cancelRefetch: false },
              );
            }
          }
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
        appActive = true;
        open();
        void queryClient.refetchQueries({ queryKey: rootKey, type: 'active' });
      } else {
        appActive = false;
        generation += 1;
        clearReconnect();
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = undefined;
        pendingDomains.clear();
        stream?.close();
        stream = null;
      }
    });
    const network = NetInfo.addEventListener((next) => {
      if (next.isConnected !== false && (!stream || streamUrl !== activeServerUrl(server))) open();
    });
    return () => {
      disposed = true;
      generation += 1;
      clearInterval(endpointCheck);
      clearReconnect();
      if (refreshTimer) clearTimeout(refreshTimer);
      state.remove();
      network();
      stream?.close();
    };
  }, [demoMode, queryClient, rootKey, server, token]);

  const authError = [
    overview.error,
    currentUser.error,
    homeSummary.error,
    screen.error,
    activity.error,
    alerts.error,
    journal.error,
    cameras.error,
    sensorDevices.error,
    homePlan.error,
    sensorProtocols.error,
  ].find(isMobileApiAuthError);

  useEffect(() => {
    if (!authError || loggedOutForAuth.current) return;
    loggedOutForAuth.current = true;
    void onLogout();
  }, [authError, onLogout]);

  const offline =
    !demoMode &&
    (serverHealth.isError || (serverHealth.isSuccess && serverHealth.data.status !== 'ok'));
  const hideGlobalHeader =
    tab === 'house' || tab === 'journal' || tab === 'screen' || tab === 'alerts';
  const activityItems = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const alertItems = alerts.data?.pages.flatMap((page) => page.items) ?? [];
  const journalItems = journal.data?.pages.flatMap((page) => page.items) ?? [];

  const logout = () => {
    const confirmLogout = () => {
      queryClient.removeQueries({ queryKey: rootKey });
      void onLogout();
    };

    if (demoMode) {
      queryClient.removeQueries({ queryKey: rootKey });
      void onLogout();
      return;
    }

    const title = locale === 'fr' ? 'Se déconnecter ?' : 'Sign out?';
    const message =
      locale === 'fr'
        ? 'Les données conservées hors ligne seront supprimées.'
        : 'Offline data stored on this device will be deleted.';

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
        confirmLogout();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: locale === 'fr' ? 'Annuler' : 'Cancel', style: 'cancel' },
      {
        text: locale === 'fr' ? 'Se déconnecter' : 'Sign out',
        style: 'destructive',
        onPress: confirmLogout,
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'left', 'right', 'bottom']}>
      {demoMode ? (
        <View style={styles.demoBanner}>
          <View style={styles.demoBannerLabel}>
            <Ionicons name="sparkles-outline" size={15} color={colors.blue} />
            <Text style={styles.demoBannerText}>
              {locale === 'fr' ? 'MODE DÉMO · DONNÉES FICTIVES' : 'DEMO MODE · SAMPLE DATA'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={locale === 'fr' ? 'Quitter la démonstration' : 'Exit demo'}
            onPress={logout}
            style={styles.demoExitButton}
          >
            <Text style={styles.demoExitText}>{locale === 'fr' ? 'Quitter' : 'Exit'}</Text>
          </Pressable>
        </View>
      ) : null}
      {tab !== 'home' && !hideGlobalHeader && tab !== 'settings' && tab !== 'people' ? (
        <View style={styles.appHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ouvrir les autres pages"
            style={styles.headerMenuButton}
            onPress={() => setPagesOpen(true)}
          >
            <Ionicons name="menu-outline" size={23} color={colors.blue} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.content}>
        {tab === 'home' && (
          <MobileWelcomePanel
            server={server}
            token={token}
            userName={userName}
            locale={locale}
            overview={overview.data}
            homeSummary={homeSummary.data}
            screen={screen.data}
            schedule={schedule.data ?? []}
            activity={activityItems}
            refreshing={overview.isRefetching || homeSummary.isRefetching}
            connectionAvailable={!offline}
            onStartCall={startMobileCall}
            onRefresh={invalidateAll}
            onNavigate={setTab}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab
            server={server}
            token={token}
            homeSummary={homeSummary.data}
            timeZone={homeSummary.data?.timezone ?? 'Europe/Paris'}
            refreshing={activity.isRefetching}
            onRefresh={invalidateAll}
            onOpenRoom={() => setTab('house')}
            onOpenJournal={() => setTab('journal')}
          />
        )}
        {tab === 'alerts' && (
          <AlertsTab
            server={server}
            token={token}
            locale={locale}
            items={alertItems}
            refreshing={alerts.isRefetching}
            onRefresh={invalidateAll}
            onMore={() => void alerts.fetchNextPage()}
            hasMore={alerts.hasNextPage}
            loadingMore={alerts.isFetchingNextPage}
            canManage={currentUser.data?.capabilities.includes('alerts:manage') ?? false}
            residentName={overview.data?.home?.resident ?? 'Élise'}
            timezone={homeSummary.data?.timezone ?? 'Europe/Paris'}
            homePlan={homePlan.data}
            sensorDevices={sensorDevices.data}
            safetyLoading={homePlan.isLoading || sensorDevices.isLoading}
            onCall={startMobileCall}
            onSettings={() => {
              setSettingsSection('rules');
              setTab('settings');
            }}
          />
        )}
        {tab === 'house' && (
          <HouseTab
            cameras={cameras.data ?? []}
            sensorDevices={sensorDevices.data}
            homePlan={homePlan.data}
            imageBaseUrl={activeServerUrl(server)}
            homePlanLoading={homePlan.isPending}
            homePlanError={homePlan.isError}
            protocols={sensorProtocols.data ?? []}
            locale={locale}
            refreshing={
              cameras.isRefetching ||
              sensorDevices.isRefetching ||
              homePlan.isRefetching ||
              sensorProtocols.isRefetching
            }
            onRefresh={invalidateAll}
          />
        )}
        {tab === 'screen' && (
          <Screen refreshing={screen.isRefetching} onRefresh={invalidateAll}>
            <MobileScreenPanel
              server={server}
              token={token}
              snapshot={screen.data}
              onChanged={() =>
                void queryClient.invalidateQueries({ queryKey: [...rootKey, 'screen'] })
              }
            />
          </Screen>
        )}
        {tab === 'people' && (
          <MobilePeoplePanel
            server={server}
            token={token}
            role={screenRole}
            onBackToSettings={() => {
              setSettingsSection('general');
              setTab('settings');
            }}
          />
        )}
        {tab === 'settings' && (
          <MobileSettingsPanel
            server={server}
            token={token}
            role={screenRole}
            locale={locale}
            initialSection={settingsSection}
            screen={screen.data}
            onLocaleChange={onLocaleChange}
            onScreenUpdated={() =>
              void queryClient.invalidateQueries({ queryKey: [...rootKey, 'screen'] })
            }
            onOpenPage={setTab}
            onLogout={logout}
          />
        )}
        {tab === 'journal' && calendarOpen && (
          <MobileCalendarPanel
            server={server}
            token={token}
            onBack={() => setCalendarOpen(false)}
          />
        )}
        {tab === 'journal' && !legacyJournal && !calendarOpen && (
          <MobileLiaisonPanel
            server={server}
            token={token}
            offline={offline}
            schedule={schedule.data ?? []}
            alerts={alertItems}
            residentName={overview.data?.home?.resident ?? 'Élise'}
            onJournal={() => setLegacyJournal(true)}
            onCalendar={() => setCalendarOpen(true)}
          />
        )}
        {tab === 'journal' && legacyJournal && (
          <JournalTab
            items={journalItems}
            timezone={homeSummary.data?.timezone ?? 'Europe/Paris'}
            refreshing={journal.isRefetching}
            onRefresh={invalidateAll}
            onMore={() => void journal.fetchNextPage()}
            hasMore={journal.hasNextPage}
            onBack={() => setLegacyJournal(false)}
          />
        )}
      </View>
      <MobileCallOverlay
        visible={Boolean(mobileCallId)}
        residentName={screen.data?.resident ?? overview.data?.home?.resident ?? 'Élise'}
        locale={locale}
        accepted={Boolean(
          screen.data?.state.call?.id === mobileCallId && screen.data.state.call.acceptedAt,
        )}
        join={mobileCallJoin}
        error={mobileCallJoinError}
        onEnd={endMobileCall}
      />
      <View style={styles.tabBar}>
        {Platform.OS === 'ios' ? (
          <AppleLiquidGlassBackground style={StyleSheet.absoluteFill} />
        ) : null}
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={styles.tabButton}
              onPress={() => {
                setCalendarOpen(false);
                setTab(item.id);
              }}
            >
              <View>
                {item.id === 'house' ? (
                  <Sofa
                    color={active ? colors.blue : '#8A9299'}
                    size={24}
                    strokeWidth={active ? 2.25 : 1.9}
                  />
                ) : (
                  <Ionicons
                    name={active ? item.active : item.icon}
                    color={active ? colors.blue : '#8A9299'}
                    size={21}
                  />
                )}
              </View>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Modal
        visible={pagesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPagesOpen(false)}
      >
        <Pressable style={styles.pagesBackdrop} onPress={() => setPagesOpen(false)}>
          <View style={styles.pagesSheet}>
            <View style={styles.pagesHeader}>
              <View>
                <Text style={styles.eyebrow}>VOTRE FOYER</Text>
                <Text style={styles.pagesTitle}>Toutes les pages</Text>
              </View>
              <Pressable style={styles.close} onPress={() => setPagesOpen(false)}>
                <Ionicons name="close" size={22} color={colors.navy} />
              </Pressable>
            </View>
            {(
              [
                ['activity', 'Activité', 'pulse-outline'],
                ['alerts', 'Alertes', 'notifications-outline'],
                ['people', 'Proches', 'people-outline'],
              ] as Array<[Tab, string, IconName]>
            ).map(([id, label, icon]) => (
              <Pressable
                key={id}
                style={styles.pageMenuRow}
                onPress={() => {
                  setPagesOpen(false);
                  setCalendarOpen(false);
                  setTab(id);
                }}
              >
                <View style={styles.pageMenuIcon}>
                  <Ionicons name={icon} size={20} color={colors.blue} />
                </View>
                <Text style={styles.pageMenuLabel}>{label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              style={styles.pageMenuRow}
              onPress={() => {
                setPagesOpen(false);
                logout();
              }}
            >
              <View style={styles.pageMenuIcon}>
                <Ionicons name="log-out-outline" size={20} color={colors.red} />
              </View>
              <Text style={[styles.pageMenuLabel, styles.pageMenuLabelDanger]}>
                {demoMode
                  ? locale === 'fr'
                    ? 'Quitter la démonstration'
                    : 'Exit demo'
                  : locale === 'fr'
                    ? 'Se déconnecter'
                    : 'Sign out'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Screen({
  children,
  onRefresh,
}: React.PropsWithChildren<{
  refreshing: boolean;
  onRefresh: () => void | Promise<unknown>;
}>) {
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const refresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setPullRefreshing(false);
    }
  };
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={pullRefreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.blue}
        />
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

function ActivityTab({
  server,
  token,
  timeZone,
  homeSummary,
  refreshing,
  onRefresh,
  onOpenRoom,
  onOpenJournal,
}: {
  server: SavedServer;
  token: string;
  timeZone: string;
  homeSummary?: HomeSummary;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenRoom: (roomId: string) => void;
  onOpenJournal: () => void;
}) {
  const todayKey = dashboardDateKey(new Date(), timeZone);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [compare, setCompare] = useState(false);
  const [comparisonDate, setComparisonDate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visibleSequences, setVisibleSequences] = useState(8);
  const daySummary = useQuery({
    queryKey: ['michel', server.id, 'activity-summary-day', selectedDate],
    queryFn: () => mobileApi.activitySummary(server, token, selectedDate),
  });
  const compareSummary = useQuery({
    queryKey: ['michel', server.id, 'activity-summary-day', comparisonDate],
    queryFn: () => mobileApi.activitySummary(server, token, comparisonDate),
    enabled: compare && Boolean(comparisonDate) && comparisonDate !== selectedDate,
  });
  const summary = daySummary.data;
  const sequences = [...(summary?.sequences ?? [])].sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  );
  const usedRooms = new Set(sequences.flatMap((sequence) => sequence.roomNames)).size;
  const dates = Array.from({ length: 7 }, (_, index) => dashboardShiftDate(todayKey, -index));
  const durationMinutes = Math.round((summary?.observedSeconds ?? 0) / 60);
  const comparison = compareSummary.data;
  const comparisonRooms = new Set(
    (comparison?.sequences ?? []).flatMap((sequence) => sequence.roomNames),
  ).size;
  const liveAt =
    selectedDate === todayKey
      ? (homeSummary?.latestPresence?.occurredAt ??
        homeSummary?.presence.lastEvidenceAt ??
        homeSummary?.presence.lastConfirmedAt ??
        homeSummary?.presence.detectedAt ??
        null)
      : null;
  const lastReliable = summary?.lastReliableActivity;
  const selectedDateLabel =
    selectedDate === todayKey
      ? `Aujourd’hui · ${dashboardDateLabel(selectedDate, timeZone)}`
      : dashboardDateLabel(selectedDate, timeZone);

  useEffect(() => {
    setVisibleSequences(8);
    setExpanded(null);
  }, [selectedDate]);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle eyebrow="ANALYSE" title="Activité" />
      <View style={styles.activityReliableBanner}>
        <Ionicons name="checkmark-circle-outline" size={18} color={colors.green} />
        <Text style={styles.activityReliableText}>
          {lastReliable
            ? `La dernière activité fiable a été observée dans ${lastReliable.roomName} à ${dashboardClock(lastReliable.occurredAt, timeZone)}.`
            : 'Aucune activité fiable ne permet encore de résumer cette période.'}
        </Text>
      </View>
      <View style={styles.card}>
        <View style={styles.totalRow}>
          <View style={styles.rowCopy}>
            <Text style={styles.metricLabel}>MOMENTS DU QUOTIDIEN</Text>
            <Text style={styles.trendText}>
              Une vue d’ensemble des activités et déplacements de la journée.
            </Text>
          </View>
          <Pressable
            style={styles.datePickerButton}
            onPress={() =>
              setSelectedDate(
                (current) => dates[(dates.indexOf(current) + 1) % dates.length] ?? todayKey,
              )
            }
          >
            <Ionicons name="calendar-outline" size={16} color={colors.blue} />
            <Text style={styles.datePickerText}>{selectedDateLabel}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.blue} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {dates.map((date) => (
            <Chip
              key={date}
              active={selectedDate === date}
              label={date === todayKey ? 'Aujourd’hui' : dashboardShortDate(date, timeZone)}
              onPress={() => {
                setSelectedDate(date);
                if (date === comparisonDate) setComparisonDate('');
              }}
            />
          ))}
        </ScrollView>
        <Pressable
          style={styles.compareToggle}
          onPress={() => {
            setCompare((value) => !value);
            if (compare) setComparisonDate('');
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: compare }}
        >
          <Ionicons name="git-compare-outline" size={16} color={colors.blue} />
          <Text style={styles.link}>Comparer avec une autre journée</Text>
          <View style={[styles.toggleTrack, compare && styles.toggleTrackActive]}>
            <View style={[styles.toggleKnob, compare && styles.toggleKnobActive]} />
          </View>
        </Pressable>
        {compare ? (
          <View style={styles.comparePanel}>
            <Text style={styles.metricLabel}>COMPARER AVEC</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {dates
                .filter((date) => date !== selectedDate)
                .map((date) => (
                  <Chip
                    key={date}
                    active={comparisonDate === date}
                    label={dashboardShortDate(date, timeZone)}
                    onPress={() => setComparisonDate(date)}
                  />
                ))}
            </ScrollView>
            {compare && comparisonDate ? (
              compareSummary.isPending ? (
                <Text style={styles.rowDetail}>Comparaison…</Text>
              ) : comparison ? (
                <View style={styles.comparisonStats}>
                  <ComparisonStat
                    value={dashboardDelta(
                      sequences.length - comparison.sequences.length,
                      'moments',
                    )}
                    label="moments détectés"
                  />
                  <ComparisonStat
                    value={dashboardDelta(
                      durationMinutes - Math.round(comparison.observedSeconds / 60),
                      'min',
                    )}
                    label="d’activité"
                  />
                  <ComparisonStat
                    value={dashboardDelta(usedRooms - comparisonRooms, 'pièces')}
                    label="pièces utilisées"
                  />
                </View>
              ) : (
                <Text style={styles.rowDetail}>Comparaison indisponible pour cette journée.</Text>
              )
            ) : null}
          </View>
        ) : null}
        <View style={styles.momentStats}>
          <MomentStat
            icon="footsteps-outline"
            value={String(sequences.length)}
            label="moments détectés"
            tone="blue"
          />
          <MomentStat
            icon="time-outline"
            value={dashboardDuration(summary?.observedSeconds ?? 0)}
            label="d’activité"
            tone="green"
          />
          <MomentStat
            icon="home-outline"
            value={String(usedRooms)}
            label="pièces utilisées"
            tone="amber"
          />
        </View>
      </View>
      <View style={styles.card}>
        <SectionTitle eyebrow="CHRONOLOGIE" title="Moments observés" />
        {selectedDate === todayKey && homeSummary && liveAt ? (
          <View style={styles.liveMomentRow}>
            <View style={styles.liveTime}>
              <Text style={styles.liveTimeText}>{dashboardClock(liveAt, timeZone)}</Text>
              <Text style={styles.rowDetail}>En ce moment</Text>
            </View>
            <View style={styles.timelineDotLive} />
            <View style={styles.liveCard}>
              <Ionicons name="footsteps-outline" size={18} color={colors.green} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{mobileActivityPresence(homeSummary)}</Text>
                <Text style={styles.rowDetail}>Situation actuelle</Text>
              </View>
            </View>
          </View>
        ) : null}
        {daySummary.isPending ? (
          <Text style={styles.rowDetail}>Chargement des moments…</Text>
        ) : null}
        {sequences.slice(0, visibleSequences).map((sequence) => (
          <View key={sequence.id} style={styles.sequenceBlock}>
            <Pressable
              style={styles.sequenceSummary}
              onPress={() =>
                setExpanded((current) => (current === sequence.id ? null : sequence.id))
              }
            >
              <View style={styles.liveTime}>
                <Text style={styles.liveTimeText}>
                  {dashboardClock(sequence.startedAt, timeZone)}
                </Text>
                <Text style={styles.rowDetail}>{dashboardRelative(sequence.startedAt)}</Text>
              </View>
              <View style={styles.timelineDot} />
              <View style={styles.sequenceCard}>
                <View style={styles.sequenceIcon}>
                  <Ionicons name="footsteps-outline" size={17} color={colors.blue} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{dashboardSequenceSentence(sequence)}</Text>
                  <Text style={styles.rowDetail}>
                    {sequence.totalEventCount} événements ·{' '}
                    {sequence.durationSeconds
                      ? `activité pendant ${dashboardDuration(sequence.durationSeconds)}`
                      : dashboardRelative(sequence.startedAt)}
                  </Text>
                </View>
                <Ionicons
                  name={expanded === sequence.id ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.muted}
                />
              </View>
            </Pressable>
            {expanded === sequence.id ? (
              <View style={styles.sequenceEvents}>
                {sequence.hiddenEventCount > 0 ? (
                  <Text style={styles.rowDetail}>
                    {sequence.hiddenEventCount} événements répétitifs ont été regroupés.
                  </Text>
                ) : null}
                {sequence.events.map((event) => (
                  <Pressable
                    key={event.id}
                    style={styles.sequenceEvent}
                    onPress={() => onOpenRoom(event.roomId)}
                  >
                    <Text style={styles.sequenceEventTime}>
                      {dashboardClock(event.occurredAt, timeZone)}
                    </Text>
                    <View style={styles.eventIcon}>
                      <Ionicons
                        name={capabilityMeta[event.capability]?.icon ?? 'pulse-outline'}
                        size={16}
                        color={colors.blue}
                      />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{mobileEventDescription(event)}</Text>
                      <Text style={styles.rowDetail}>
                        {event.roomName} · {event.sensorName ?? 'Capteur du logement'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.reliability,
                        event.quality === 'good' ? styles.reliable : styles.unreliable,
                      ]}
                    >
                      {event.quality === 'good' ? 'Fiable' : 'À confirmer'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {!daySummary.isPending && !sequences.length && !(selectedDate === todayKey && liveAt) ? (
          <Empty icon="pulse-outline" text="Aucun moment fiable ne correspond à cette journée." />
        ) : null}
        {visibleSequences < sequences.length ? (
          <Pressable
            style={styles.loadMore}
            onPress={() => setVisibleSequences((value) => value + 8)}
          >
            <Text style={styles.link}>Afficher les moments précédents</Text>
          </Pressable>
        ) : null}
        {summary?.hasMoreSequences && visibleSequences >= sequences.length ? (
          <View style={styles.olderNote}>
            <Text style={styles.rowDetail}>
              Les événements plus anciens restent disponibles dans le journal local.
            </Text>
            <Pressable onPress={onOpenJournal}>
              <Text style={styles.link}>Ouvrir le journal</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function dashboardDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function dashboardShiftDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function dashboardDateLabel(value: string, timezone: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
function dashboardShortDate(value: string, timezone: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  });
}
function dashboardClock(value: string, timezone: string) {
  return new Date(value).toLocaleTimeString('fr-FR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
}
function dashboardRelative(value: string) {
  return relativeTime(value);
}
function dashboardDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} h${remainder ? ` ${remainder} min` : ''}`;
}
function dashboardDelta(value: number, unit: string) {
  return value === 0 ? 'Identique' : `${value > 0 ? '+' : '−'}${Math.abs(value)} ${unit}`;
}
function dashboardSequenceSentence(sequence: ActivitySequence) {
  const passage = sequence.passages[0];
  if (passage) return `Passage entre ${passage.fromLevelName} et ${passage.toLevelName}.`;
  if (sequence.roomNames.length > 1) {
    const first = sequence.roomNames[0] ?? 'le logement';
    const last = sequence.roomNames.at(-1) ?? first;
    return first === last
      ? `Déplacement avec retour dans « ${first} ».`
      : `Passage de ${first} à ${last}.`;
  }
  return `Activité observée dans ${sequence.roomNames[0] ?? 'le logement'}.`;
}
function dashboardPayload(event: ActivityEvent) {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}
function mobileEventDescription(event: ActivityEvent) {
  const payload = dashboardPayload(event);
  const context =
    payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)
      ? (payload.context as Record<string, unknown>)
      : {};
  const raw = payload.open ?? payload.active ?? payload.value ?? payload.state;
  if (
    event.capability === 'contact' ||
    event.capability === 'dry_contact' ||
    (event.capability === 'occupancy' && context.role === 'BED')
  ) {
    const open =
      raw === true || raw === 'open' || raw === 'contact_open' || raw === 'on' || raw === 1;
    if (context.role === 'BED')
      return open === (context.bedOccupiedWhen === 'OPEN' || event.capability === 'occupancy')
        ? 'Lit occupé'
        : 'Lit libre';
    return open
      ? event.capability === 'dry_contact'
        ? 'Contact ouvert'
        : 'Ouverture détectée'
      : event.capability === 'dry_contact'
        ? 'Contact fermé'
        : 'Fermeture détectée';
  }
  if (event.capability === 'motion') return 'Mouvement détecté';
  if (event.capability === 'occupancy' || event.capability === 'person_presence')
    return 'Présence détectée';
  if (event.capability === 'button') return 'Bouton d’appel activé';
  const value =
    typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
      ? String(raw)
      : '';
  return value
    ? `${capabilityMeta[event.capability]?.label ?? event.capability} · ${value}${event.unit ? ` ${event.unit}` : ''}`
    : (capabilityMeta[event.capability]?.label ?? event.capability);
}
function mobileActivityPresence(data: HomeSummary) {
  const roomId =
    data.latestPresence?.roomId ?? data.presence.confirmedRoomId ?? data.presence.roomId;
  const room = data.rooms.find(({ id }) => id === roomId);
  return room
    ? `Présence observée dans ${room.name}.`
    : caregiverPresenceCopy(data.presence).detail;
}
function ComparisonStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.comparisonStat}>
      <Text style={styles.comparisonValue}>{value}</Text>
      <Text style={styles.rowDetail}>{label}</Text>
    </View>
  );
}
function MomentStat({
  icon,
  value,
  label,
  tone,
}: {
  icon: IconName;
  value: string;
  label: string;
  tone: 'blue' | 'green' | 'amber';
}) {
  return (
    <View style={styles.momentStat}>
      <View
        style={[
          styles.momentIcon,
          tone === 'green'
            ? styles.momentIconGreen
            : tone === 'amber'
              ? styles.momentIconAmber
              : null,
        ]}
      >
        <Ionicons
          name={icon}
          size={17}
          color={tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : colors.blue}
        />
      </View>
      <Text style={styles.momentValue}>{value}</Text>
      <Text style={styles.rowDetail}>{label}</Text>
    </View>
  );
}

function SafetySensorCard({
  icon,
  iconColor,
  iconBackground,
  eyebrow,
  title,
  coverage,
  locale,
  loading,
}: {
  icon: IconName;
  iconColor: string;
  iconBackground: string;
  eyebrow: string;
  title: string;
  coverage: SafetyCoverage | null;
  locale: 'fr' | 'en';
  loading: boolean;
}) {
  const tone = safetyCoverageTone(coverage, loading);
  return (
    <View style={[styles.card, styles.alertSafetyCard]}>
      <View style={styles.alertSafetyHeader}>
        <View style={[styles.alertSafetyIcon, { backgroundColor: iconBackground }]}>
          <Ionicons name={icon} size={23} color={iconColor} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.alertSafetyEyebrow}>{eyebrow}</Text>
          <Text style={styles.alertSafetyTitle}>{title}</Text>
          <Text
            style={[
              styles.alertSafetyDetail,
              tone === 'online'
                ? styles.alertSafetyOnline
                : tone === 'attention'
                  ? styles.alertSafetyAttention
                  : null,
            ]}
          >
            {safetyCoverageCopy(coverage, locale, loading)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function AlertsTab({
  server,
  token,
  locale,
  items,
  refreshing,
  onRefresh,
  onMore,
  hasMore,
  loadingMore,
  canManage,
  residentName,
  timezone,
  homePlan,
  sensorDevices,
  safetyLoading,
  onCall,
  onSettings,
}: {
  server: SavedServer;
  token: string;
  locale: 'fr' | 'en';
  items: AlertItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onMore: () => void;
  hasMore?: boolean;
  loadingMore: boolean;
  canManage: boolean;
  residentName: string;
  timezone: string;
  homePlan?: HomePlan;
  sensorDevices?: SensorDevice[];
  safetyLoading: boolean;
  onCall: () => Promise<void>;
  onSettings: () => void;
}) {
  const fr = locale === 'fr';
  const client = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'>('ALL');
  const [showHistory, setShowHistory] = useState(false);
  const [severity, setSeverity] = useState<'ALL' | AlertItem['severity']>('ALL');
  const [room, setRoom] = useState('ALL');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [displayedCount, setDisplayedCount] = useState(8);
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [callOpen, setCallOpen] = useState(false);
  const urgentCount = useQuery({
    queryKey: ['michel', server.id, 'alert-summary'],
    queryFn: () => mobileApi.alertSummary(server, token),
  });
  const detail = useQuery({
    queryKey: ['michel', server.id, 'alert-detail', selected?.id],
    queryFn: () => mobileApi.alertDetail(server, token, selected!.id),
    enabled: Boolean(selected),
  });
  const rooms = [
    ...new Map(
      items.filter((item) => item.room).map((item) => [item.room!.id, item.room!]),
    ).values(),
  ];
  const fallCoverage =
    homePlan && sensorDevices ? safetyCoverage(homePlan, sensorDevices, 'fall_detection') : null;
  const smokeCoverage =
    homePlan && sensorDevices ? safetyCoverage(homePlan, sensorDevices, 'smoke') : null;
  const waterCoverage =
    homePlan && sensorDevices ? safetyCoverage(homePlan, sensorDevices, 'water_leak') : null;
  const todayKey = dashboardDateKey(new Date(), timezone);
  const matching = items.filter(
    (item) =>
      (filter === 'ALL' ||
        (filter === 'RESOLVED'
          ? ['RESOLVED', 'DISMISSED'].includes(item.status)
          : item.status === filter)) &&
      (severity === 'ALL' || item.severity === severity) &&
      (room === 'ALL' || item.room?.id === room),
  );
  const isOngoing = (item: AlertItem) => ['OPEN', 'ACKNOWLEDGED'].includes(item.status);
  const currentItems = matching.filter(
    (item) => dashboardDateKey(new Date(item.openedAt), timezone) === todayKey || isOngoing(item),
  );
  const olderItems = matching.filter(
    (item) => dashboardDateKey(new Date(item.openedAt), timezone) !== todayKey && !isOngoing(item),
  );
  const olderCount = olderItems.length;
  const filtered = showHistory ? olderItems : currentItems;
  const visible = filtered.slice(0, displayedCount);
  const hasMoreLoaded = filtered.length > visible.length;
  const extraFilterCount = Number(severity !== 'ALL') + Number(room !== 'ALL');
  useEffect(() => {
    setDisplayedCount(8);
  }, [filter, severity, room, showHistory]);
  const mutation = useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string;
      status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
      note?: string;
    }) => mobileApi.transitionAlert(server, token, id, status, note),
    onSuccess: async () => {
      setSelected(null);
      setDismissOpen(false);
      setDismissReason('');
      await client.invalidateQueries({ queryKey: ['michel', server.id] });
    },
  });
  const act = (status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED', note?: string) => {
    if (!selected) return;
    if (!canManage) return;
    Alert.alert(
      'Confirmer cette action ?',
      status === 'ACKNOWLEDGED'
        ? 'L’alerte restera visible comme prise en charge.'
        : 'L’alerte quittera la liste des alertes ouvertes.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => mutation.mutate({ id: selected.id, status, note }) },
      ],
    );
  };
  const closeDetail = () => {
    setSelected(null);
    setDismissOpen(false);
    setCallOpen(false);
  };
  const actualDetail = detail.data?.id === selected?.id ? detail.data : null;
  const observations =
    actualDetail?.observations.filter((entry) => entry.quality !== 'INVALID') ?? [];
  const latestValue =
    observations[0]?.payload &&
    typeof observations[0].payload === 'object' &&
    'value' in observations[0].payload
      ? (observations[0].payload as { value?: unknown }).value
      : null;
  const numberValue =
    typeof latestValue === 'number'
      ? latestValue
      : typeof latestValue === 'string' &&
          latestValue.trim() &&
          Number.isFinite(Number(latestValue))
        ? Number(latestValue)
        : null;
  const timelineEntries = selected
    ? [
        { id: 'opened', at: selected.openedAt, label: 'Situation détectée' },
        ...(actualDetail?.transitions ?? []).map((entry) => ({
          id: entry.id,
          at: entry.createdAt,
          label: `${alertStatusLabel(entry.to)}${entry.note ? ` · ${entry.note}` : ''}`,
        })),
        ...observations.slice(0, 3).map((entry) => {
          const measured = numberFromPayload(entry.payload);
          return {
            id: entry.id,
            at: entry.occurredAt,
            label:
              measured !== null
                ? `Mesure : ${measured} ${actualDetail?.sensor?.unit ?? ''}`
                : sensorEventText(entry.payload, fr),
          };
        }),
      ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    : [];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionTitle
        eyebrow="ALERTES DU DOMICILE"
        title="Alertes"
        action={
          <Pressable onPress={onSettings}>
            <Text style={styles.link}>Règles des alertes</Text>
          </Pressable>
        }
      />
      <View
        style={styles.alertSafetyCards}
        accessibilityLabel={fr ? 'Capteurs de sécurité du logement' : 'Home safety sensors'}
      >
        <SafetySensorCard
          icon="shield-outline"
          iconColor="#7252AC"
          iconBackground="#F2EDFB"
          eyebrow={fr ? 'Protection de la personne' : 'Personal safety'}
          title={fr ? 'Détection des chutes' : 'Fall detection'}
          coverage={fallCoverage}
          locale={locale}
          loading={safetyLoading}
        />
        <SafetySensorCard
          icon="flame-outline"
          iconColor="#B45B54"
          iconBackground="#FCF0ED"
          eyebrow={fr ? 'Sécurité du logement' : 'Home safety'}
          title={fr ? 'Détection de la fumée' : 'Smoke detection'}
          coverage={smokeCoverage}
          locale={locale}
          loading={safetyLoading}
        />
        <SafetySensorCard
          icon="water-outline"
          iconColor="#307BA7"
          iconBackground="#E9F5FC"
          eyebrow={fr ? 'Sécurité du logement' : 'Home safety'}
          title={fr ? 'Détection des fuites d’eau' : 'Water leak detection'}
          coverage={waterCoverage}
          locale={locale}
          loading={safetyLoading}
        />
      </View>
      <View
        style={[
          styles.alertReassurance,
          (urgentCount.data?.urgentCount ?? 0) > 0 && styles.alertReassuranceUrgent,
        ]}
      >
        <Ionicons
          name="shield-checkmark-outline"
          size={22}
          color={(urgentCount.data?.urgentCount ?? 0) > 0 ? colors.red : colors.green}
        />
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>
            {urgentCount.isError
              ? 'État des urgences indisponible'
              : urgentCount.data?.urgentCount
                ? `${urgentCount.data.urgentCount} alerte${urgentCount.data.urgentCount === 1 ? '' : 's'} urgente${urgentCount.data.urgentCount === 1 ? '' : 's'} en cours`
                : 'Aucune alerte urgente en cours'}
          </Text>
          <Text style={styles.rowDetail}>
            {showHistory
              ? `${visible.length} situation${visible.length > 1 ? 's' : ''} affichée${visible.length > 1 ? 's' : ''} dans l’historique.`
              : `${visible.length} situation${visible.length > 1 ? 's' : ''} récente${visible.length > 1 ? 's' : ''} ou en cours affichée${visible.length > 1 ? 's' : ''}. Les situations terminées plus anciennes restent dans l’historique.`}
          </Text>
        </View>
      </View>
      <Segment
        options={[
          ['ALL', showHistory ? (fr ? 'Toutes' : 'All') : fr ? 'Actuelles' : 'Current'],
          ['OPEN', fr ? 'Ouvertes' : 'Open'],
          ['ACKNOWLEDGED', fr ? 'Prises en charge' : 'Acknowledged'],
          ['RESOLVED', fr ? 'Résolues' : 'Resolved'],
        ]}
        value={filter}
        onChange={(value) => setFilter(value as typeof filter)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: filtersOpen }}
        style={[styles.filterToggle, filtersOpen && styles.filterToggleActive]}
        onPress={() => setFiltersOpen((value) => !value)}
      >
        <Ionicons name="filter-outline" size={17} color={colors.blue} />
        <Text style={styles.filterToggleText}>
          {filtersOpen
            ? fr
              ? 'Masquer les filtres'
              : 'Hide filters'
            : fr
              ? 'Filtrer les alertes'
              : 'Filter alerts'}
        </Text>
        {extraFilterCount > 0 ? (
          <View style={styles.filterCountBadge}>
            <Text style={styles.filterCountText}>{extraFilterCount}</Text>
          </View>
        ) : null}
        <Ionicons
          name={filtersOpen ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.muted}
        />
      </Pressable>
      {filtersOpen ? (
        <View style={styles.alertFilterPanel}>
          <View style={styles.alertFilterPanelHeading}>
            <View>
              <Text style={styles.alertFilterPanelTitle}>
                {fr ? 'Affiner les alertes' : 'Refine alerts'}
              </Text>
              <Text style={styles.alertFilterPanelDetail}>
                {filtered.length} {fr ? 'résultat' : 'result'}
                {filtered.length > 1 ? 's' : ''}
              </Text>
            </View>
            {extraFilterCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSeverity('ALL');
                  setRoom('ALL');
                }}
                style={styles.alertFilterReset}
              >
                <Text style={styles.alertFilterResetText}>{fr ? 'Réinitialiser' : 'Reset'}</Text>
              </Pressable>
            ) : null}
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={fr ? 'Priorité' : 'Priority'}
            style={styles.alertFilterGroup}
          >
            <Text style={styles.alertFilterLabel}>{fr ? 'PRIORITÉ' : 'PRIORITY'}</Text>
            <View style={styles.alertFilterOptions}>
              {(['ALL', 'INFO', 'ATTENTION', 'URGENT'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: severity === value }}
                  onPress={() => setSeverity(value)}
                  style={[
                    styles.alertFilterPill,
                    severity === value && styles.alertFilterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.alertFilterPillText,
                      severity === value && styles.alertFilterPillTextActive,
                    ]}
                  >
                    {value === 'ALL'
                      ? fr
                        ? 'Toutes'
                        : 'All'
                      : value === 'INFO'
                        ? 'Information'
                        : value === 'ATTENTION'
                          ? fr
                            ? 'À vérifier'
                            : 'Needs attention'
                          : fr
                            ? 'Urgence'
                            : 'Urgent'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={fr ? 'Pièce' : 'Room'}
            style={styles.alertFilterGroup}
          >
            <Text style={styles.alertFilterLabel}>{fr ? 'PIÈCE' : 'ROOM'}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.alertFilterRoomOptions}
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: room === 'ALL' }}
                onPress={() => setRoom('ALL')}
                style={[styles.alertFilterPill, room === 'ALL' && styles.alertFilterPillActive]}
              >
                <Text
                  style={[
                    styles.alertFilterPillText,
                    room === 'ALL' && styles.alertFilterPillTextActive,
                  ]}
                >
                  {fr ? 'Toutes les pièces' : 'All rooms'}
                </Text>
              </Pressable>
              {rooms.map((value) => (
                <Pressable
                  key={value.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: room === value.id }}
                  onPress={() => setRoom(value.id)}
                  style={[
                    styles.alertFilterPill,
                    room === value.id && styles.alertFilterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.alertFilterPillText,
                      room === value.id && styles.alertFilterPillTextActive,
                    ]}
                  >
                    {value.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
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
              <Text style={styles.alertTitle}>{alertTitleText(item, fr)}</Text>
              <Text numberOfLines={2} style={styles.alertExplanation}>
                {alertExplanationText(item, fr)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
        {!visible.length ? (
          <Empty
            icon="checkmark-circle-outline"
            text={
              loadingMore && !visible.length
                ? fr
                  ? showHistory
                    ? 'Chargement des situations plus anciennes…'
                    : 'Chargement des situations…'
                  : showHistory
                    ? 'Loading older situations…'
                    : 'Loading situations…'
                : olderCount > 0 && !showHistory
                  ? fr
                    ? 'Aucune alerte récente ou en cours. Des situations terminées plus anciennes sont dans l’historique.'
                    : 'No recent or ongoing alerts. Older completed situations are in the history.'
                  : filter !== 'RESOLVED'
                    ? fr
                      ? 'Aucune alerte ne demande votre attention.'
                      : 'No alerts need your attention.'
                    : fr
                      ? 'Aucune alerte dans l’historique.'
                      : 'No alerts in the history.'
            }
          />
        ) : null}
        {hasMoreLoaded ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDisplayedCount((count) => count + 8)}
            style={styles.alertPaginationButton}
          >
            <Text style={styles.alertPaginationText}>
              {fr ? 'Afficher 8 situations de plus' : 'Show 8 more situations'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.blue} />
          </Pressable>
        ) : null}
        {!showHistory && !hasMoreLoaded && hasMore ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={() => {
              setDisplayedCount(visible.length + 8);
              onMore();
            }}
            style={styles.alertPaginationButton}
          >
            <Text style={styles.alertPaginationText}>
              {loadingMore
                ? fr
                  ? 'Chargement…'
                  : 'Loading…'
                : fr
                  ? 'Charger d’autres situations'
                  : 'Load more situations'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.blue} />
          </Pressable>
        ) : null}
        {!showHistory && olderCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowHistory(true)}
            style={[styles.alertPaginationButton, styles.alertHistoryButton]}
          >
            <Text style={styles.alertPaginationText}>
              {fr ? 'Voir les situations plus anciennes' : 'View older situations'}
            </Text>
            {olderCount > 0 ? (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{olderCount}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-down" size={16} color={colors.blue} />
          </Pressable>
        ) : null}
        {showHistory && !hasMoreLoaded && hasMore ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={() => {
              setDisplayedCount(visible.length + 8);
              onMore();
            }}
            style={styles.alertPaginationButton}
          >
            <Text style={styles.alertPaginationText}>
              {loadingMore
                ? fr
                  ? 'Chargement…'
                  : 'Loading…'
                : fr
                  ? 'Charger d’autres situations'
                  : 'Load more situations'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.blue} />
          </Pressable>
        ) : null}
        {showHistory ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowHistory(false)}
            style={styles.alertHistoryButton}
          >
            <Text style={styles.alertHistoryText}>
              {fr ? 'Revenir aux situations actuelles' : 'Back to current situations'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Modal
        visible={Boolean(selected)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeDetail}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Pressable style={styles.close} onPress={closeDetail}>
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
              <Text style={styles.modalTitle}>{alertTitleText(selected, fr)}</Text>
              <Text style={styles.modalDate}>{fullDate(selected.openedAt, timezone)}</Text>
              <View style={styles.explanationCard}>
                <Text style={styles.explanationTitle}>Ce qui a été observé</Text>
                <Text style={styles.explanationText}>{alertExplanationText(selected, fr)}</Text>
                {selected.room?.name ? (
                  <Text style={styles.rowDetail}>Pièce : {selected.room.name}</Text>
                ) : null}
                {selected.type === 'INACTIVITY' && selected.lastMovement ? (
                  <Text style={styles.rowDetail}>
                    Dernier mouvement fiable :{' '}
                    {fullDate(selected.lastMovement.occurredAt, timezone)}
                    {selected.lastMovement.roomName ? ` · ${selected.lastMovement.roomName}` : ''}
                  </Text>
                ) : null}
              </View>
              {detail.isPending ? (
                <Text style={styles.rowDetail}>Chargement des observations…</Text>
              ) : null}
              {actualDetail?.sensor ? (
                <View style={styles.alertMeasure}>
                  <Ionicons name="thermometer-outline" size={18} color={colors.blue} />
                  <Text style={styles.rowDetail}>
                    Capteur : {actualDetail.sensor.sourceName ?? actualDetail.sensor.capability}
                    {numberValue !== null
                      ? ` · ${numberValue}${actualDetail.sensor.unit ? ` ${actualDetail.sensor.unit}` : ''}`
                      : ''}
                    {observations[0] ? ` · ${relativeTime(observations[0].occurredAt)}` : ''}
                  </Text>
                </View>
              ) : null}
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
              {actualDetail?.transitions?.length || observations.length ? (
                <View style={styles.timeline}>
                  <Text style={styles.eyebrow}>CHRONOLOGIE</Text>
                  {timelineEntries.map((entry) => (
                    <View key={entry.id} style={styles.timelineRow}>
                      <View style={styles.timelineDot} />
                      <Text style={styles.timelineText}>
                        {entry.label} · {fullDate(entry.at, timezone)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {['OPEN', 'ACKNOWLEDGED'].includes(selected.status) ? (
                <View style={styles.alertActions}>
                  {canManage && selected.status === 'OPEN' ? (
                    <Pressable style={styles.primaryButton} onPress={() => act('ACKNOWLEDGED')}>
                      <Text style={styles.primaryButtonText}>Prendre en charge</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.secondaryButton} onPress={() => setCallOpen(true)}>
                    <Text style={styles.secondaryButtonText}>Appeler {residentName}</Text>
                  </Pressable>
                  {canManage ? (
                    <Pressable style={styles.secondaryButton} onPress={() => act('RESOLVED')}>
                      <Text style={styles.secondaryButtonText}>Marquer comme résolue</Text>
                    </Pressable>
                  ) : null}
                  {canManage ? (
                    <Pressable onPress={() => setDismissOpen(true)}>
                      <Text style={styles.dismissText}>Signaler une fausse alerte</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {dismissOpen ? (
                <View style={styles.dismissPanel}>
                  <Text style={styles.explanationTitle}>
                    Pourquoi cette alerte est-elle fausse ?
                  </Text>
                  <TextInput
                    value={dismissReason}
                    onChangeText={setDismissReason}
                    multiline
                    maxLength={1000}
                    placeholder="Décrivez ce qui s’est passé…"
                    style={styles.dismissInput}
                  />
                  <View style={styles.dismissButtons}>
                    <Pressable style={styles.secondaryButton} onPress={() => setDismissOpen(false)}>
                      <Text style={styles.secondaryButtonText}>Annuler</Text>
                    </Pressable>
                    <Pressable
                      disabled={!dismissReason.trim() || mutation.isPending}
                      style={[
                        styles.primaryButton,
                        (!dismissReason.trim() || mutation.isPending) && styles.buttonDisabled,
                      ]}
                      onPress={() => act('DISMISSED', dismissReason.trim())}
                    >
                      <Text style={styles.primaryButtonText}>Confirmer</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
      <Modal
        visible={callOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCallOpen(false)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.modalTitle}>Appeler {residentName} ?</Text>
            <Text style={styles.rowDetail}>
              L’écran du logement répondra automatiquement et la vidéo s’ouvrira sur ce téléphone.
            </Text>
            <View style={styles.dismissButtons}>
              <Pressable style={styles.secondaryButton} onPress={() => setCallOpen(false)}>
                <Text style={styles.secondaryButtonText}>Annuler</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  setCallOpen(false);
                  void onCall().catch(() =>
                    Alert.alert(
                      fr ? 'Appel indisponible' : 'Call unavailable',
                      fr
                        ? 'L’appel ne peut pas être lancé pour le moment.'
                        : 'The call cannot be started right now.',
                    ),
                  );
                }}
              >
                <Text style={styles.primaryButtonText}>Lancer l’appel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function numberFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || !('value' in payload)) return null;
  const value = payload.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}
function alertStatusLabel(status: AlertItem['status']) {
  return status === 'ACKNOWLEDGED'
    ? 'Prise en charge'
    : status === 'RESOLVED'
      ? 'Résolue'
      : status === 'DISMISSED'
        ? 'Écartée'
        : 'Ouverte';
}

function mobileSensorDeviceHealth(device: SensorDevice): 'ONLINE' | 'DEGRADED' | 'OFFLINE' {
  const primaryCapabilities = device.capabilities.filter(({ primary }) => primary);
  const capabilities = primaryCapabilities.length > 0 ? primaryCapabilities : device.capabilities;
  const statuses = capabilities.map(({ status }) => status);
  if (!device.enabled || statuses.length === 0 || statuses.every((status) => status === 'OFFLINE'))
    return 'OFFLINE';
  if (statuses.some((status) => ['DEGRADED', 'OFFLINE', 'UNKNOWN'].includes(status)))
    return 'DEGRADED';
  return 'ONLINE';
}

function HouseTab({
  cameras,
  sensorDevices,
  homePlan,
  imageBaseUrl,
  homePlanLoading,
  homePlanError,
  protocols,
  locale,
  refreshing,
  onRefresh,
}: {
  cameras: CameraItem[];
  sensorDevices: SensorDevice[] | undefined;
  homePlan: HomePlan | undefined;
  imageBaseUrl: string;
  homePlanLoading: boolean;
  homePlanError: boolean;
  protocols: Array<{ id: string; available: boolean; native: boolean }>;
  locale: 'fr' | 'en';
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [roomDetailOpen, setRoomDetailOpen] = useState(false);
  const sensorCounts = sensorDevices?.reduce(
    (counts, device) => {
      counts[mobileSensorDeviceHealth(device)] += 1;
      return counts;
    },
    { ONLINE: 0, DEGRADED: 0, OFFLINE: 0 },
  );
  const onlineCameras = cameras.filter((camera) => camera.status === 'ONLINE').length;
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {!roomDetailOpen && (
        <SectionTitle eyebrow="FOYER" title={locale === 'fr' ? 'Le logement' : 'The home'} />
      )}
      <MobileHomePlanPanel
        plan={homePlan}
        sensorDevices={sensorDevices}
        cameras={cameras}
        imageBaseUrl={imageBaseUrl}
        loading={homePlanLoading}
        error={homePlanError}
        locale={locale}
        onRefresh={onRefresh}
        onRoomDetailChange={setRoomDetailOpen}
      />
      {!roomDetailOpen && (
        <View style={styles.card}>
          <SectionTitle eyebrow="ÉTAT DU DOMICILE" title="Équipement du logement" />
          <EquipmentStateRow
            label="En ligne"
            value={sensorCounts?.ONLINE ?? '—'}
            color={colors.green}
          />
          <EquipmentStateRow
            label="Dégradés"
            value={sensorCounts?.DEGRADED ?? '—'}
            color={colors.amber}
          />
          <EquipmentStateRow
            label="Hors ligne"
            value={sensorCounts?.OFFLINE ?? '—'}
            color={colors.red}
          />
          <EquipmentStateRow
            label="Caméras disponibles"
            value={onlineCameras}
            color={colors.blue}
          />
          <View style={styles.protocolRow}>
            <Ionicons name="radio-outline" size={18} color={colors.accent} />
            <Text style={styles.rowTitle}>Réseau Zigbee</Text>
            <Text style={styles.protocolState}>
              {protocols.find(({ id }) => id === 'zigbee')?.available
                ? 'Disponible'
                : 'À configurer'}
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}

function EquipmentStateRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <View style={styles.equipmentStateRow}>
      <View style={[styles.equipmentStateDot, { backgroundColor: color }]} />
      <Text style={styles.rowTitle}>{label}</Text>
      <Text style={styles.equipmentStateValue}>{value}</Text>
    </View>
  );
}

function journalDayKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftJournalDayKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function journalKindMeta(kind: string): {
  label: string;
  icon: IconName;
  tone: 'blue' | 'green' | 'amber';
} {
  if (kind === 'DAILY_SUMMARY') {
    return { label: 'Bilan du jour', icon: 'sparkles-outline', tone: 'blue' };
  }
  if (kind === 'NOTE') {
    return { label: 'Note familiale', icon: 'create-outline', tone: 'green' };
  }
  return { label: 'Événement', icon: 'time-outline', tone: 'amber' };
}

function JournalTab({
  items,
  timezone,
  refreshing,
  onRefresh,
  onMore,
  hasMore,
  onBack,
}: {
  items: JournalItem[];
  timezone: string;
  refreshing: boolean;
  onRefresh: () => void;
  onMore: () => void;
  hasMore?: boolean;
  onBack: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const recentItems = useMemo(() => {
    const today = journalDayKey(now, timezone);
    const firstDay = shiftJournalDayKey(today, -6);
    return items.filter((item) => {
      if (item.kind !== 'DAILY_SUMMARY') return true;
      const summaryDay = item.id.startsWith('liaison-summary:')
        ? item.id.slice(-10)
        : journalDayKey(new Date(item.occurredAt), timezone);
      return summaryDay >= firstDay && summaryDay <= today;
    });
  }, [items, now, timezone]);

  const groups = useMemo(() => {
    const sorted = [...recentItems].sort(
      (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
    );
    const result: Array<{ key: string; date: Date; items: JournalItem[] }> = [];
    for (const item of sorted) {
      const date = new Date(item.occurredAt);
      const key = journalDayKey(date, timezone);
      const existing = result.find((group) => group.key === key);
      if (existing) existing.items.push(item);
      else result.push({ key, date, items: [item] });
    }
    return result;
  }, [recentItems, timezone]);

  const today = journalDayKey(now, timezone);
  const dateHeading = (date: Date) => {
    const key = journalDayKey(date, timezone);
    if (key === today) return 'Aujourd’hui';
    if (key === shiftJournalDayKey(today, -1)) return 'Hier';
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: timezone,
    }).format(date);
  };
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(new Date(value));

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.journalHero}>
        <View style={styles.journalHeroCopy}>
          <Text style={styles.journalHeroTitle}>Journal du foyer</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour au carnet de liaison"
          style={styles.journalBack}
          onPress={onBack}
        >
          <Ionicons name="chevron-back" size={16} color={colors.blue} />
          <Text style={styles.journalBackText}>Retour au carnet</Text>
        </Pressable>
      </View>

      <View style={styles.journalFeed}>
        <View style={styles.journalFeedHeading}>
          <View style={styles.journalFeedCopy}>
            <View style={styles.journalSectionTitleRow}>
              <View style={styles.journalDot} />
              <Text style={styles.journalSectionTitle}>Mémoire du foyer</Text>
            </View>
            <Text style={styles.journalSectionDescription}>
              Les événements et notes qui méritent d’être retrouvés.
            </Text>
          </View>
          <Text style={styles.journalCount}>
            {recentItems.length} {recentItems.length === 1 ? 'événement' : 'événements'}
          </Text>
        </View>

        {groups.length ? (
          <View style={styles.journalTimeline}>
            {groups.map((group) => (
              <View key={group.key} style={styles.journalDay}>
                <View style={styles.journalDayHeading}>
                  <Text style={styles.journalDayTitle}>{dateHeading(group.date)}</Text>
                  <Text style={styles.journalDayCount}>
                    {group.items.length} {group.items.length === 1 ? 'événement' : 'événements'}
                  </Text>
                </View>
                <View style={styles.journalDayItems}>
                  {group.items.map((item) => {
                    const meta = journalKindMeta(item.kind);
                    const title = item.id.startsWith('liaison-summary:')
                      ? 'Résumé du carnet de liaison'
                      : item.title;
                    return (
                      <View key={item.id} style={styles.journalEntry}>
                        <View
                          style={[
                            styles.journalEntryIcon,
                            meta.tone === 'green'
                              ? styles.journalEntryIconGreen
                              : meta.tone === 'amber'
                                ? styles.journalEntryIconAmber
                                : styles.journalEntryIconBlue,
                          ]}
                        >
                          <Ionicons
                            name={meta.icon}
                            size={18}
                            color={
                              meta.tone === 'green'
                                ? '#26714E'
                                : meta.tone === 'amber'
                                  ? '#A7681C'
                                  : '#28659A'
                            }
                          />
                        </View>
                        <View style={styles.journalEntryCopy}>
                          <View style={styles.journalEntryMeta}>
                            <Text style={styles.journalEntryTime}>
                              {formatTime(item.occurredAt)}
                            </Text>
                            <Text style={styles.journalEntryKind}>{meta.label}</Text>
                          </View>
                          <Text style={styles.journalEntryTitle}>{title}</Text>
                          {item.body ? (
                            <Text style={styles.journalEntryBody}>{item.body}</Text>
                          ) : null}
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={17}
                          color="#607795"
                          style={styles.journalEntryChevron}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.journalEmpty}>
            <View style={styles.journalEmptyIcon}>
              <Ionicons name="book-outline" size={27} color={colors.blue} />
            </View>
            <Text style={styles.journalEmptyTitle}>Le journal commence ici</Text>
            <Text style={styles.journalEmptyText}>
              Les bilans du quotidien et les notes partagées par les aidants apparaîtront ici.
            </Text>
            <Pressable style={styles.journalEmptyAction} onPress={onBack}>
              <Ionicons name="create-outline" size={17} color={colors.blue} />
              <Text style={styles.journalEmptyActionText}>Écrire une première note</Text>
            </Pressable>
          </View>
        )}
        {hasMore ? <LoadMore onPress={onMore} /> : null}
      </View>
    </Screen>
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
  demoBanner: {
    minHeight: 38,
    paddingHorizontal: 16,
    backgroundColor: '#E6EEE9',
    borderBottomWidth: 1,
    borderBottomColor: '#D1DDD5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  demoBannerLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  demoBannerText: { color: colors.blue, fontSize: 9, fontWeight: '900', letterSpacing: 0.65 },
  demoExitButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  demoExitText: { color: colors.blue, fontSize: 11, fontWeight: '900' },
  content: { flex: 1, paddingTop: 16 },
  appHeader: {
    minHeight: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, gap: 12 },
  tabBar: {
    minHeight: Platform.OS === 'ios' ? 72 : 66,
    marginHorizontal: Platform.OS === 'ios' ? 14 : 0,
    marginTop: Platform.OS === 'ios' ? 6 : 0,
    marginBottom: Platform.OS === 'ios' ? 6 : 0,
    paddingTop: Platform.OS === 'ios' ? 4 : 8,
    paddingBottom: Platform.OS === 'ios' ? 4 : 0,
    paddingHorizontal: Platform.OS === 'ios' ? 6 : 0,
    borderTopWidth: Platform.OS === 'ios' ? 0 : StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderRadius: Platform.OS === 'ios' ? 36 : 0,
    flexDirection: 'row',
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.paper,
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#172B3D',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 5 },
        }
      : {}),
  },
  tabButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabText: { color: '#858D94', fontSize: 9, fontWeight: '700' },
  tabTextActive: { color: colors.blue },
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
  journalHero: {
    minHeight: 104,
    padding: 17,
    borderWidth: 1,
    borderColor: '#D9E8EC',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#F0F8FA',
  },
  journalHeroCopy: { flex: 1 },
  journalHeroTitle: {
    marginTop: 5,
    color: '#112F5D',
    fontFamily: 'Georgia',
    fontSize: 24,
    fontWeight: '600',
  },
  journalBack: {
    minHeight: 36,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#D4E0E7',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    backgroundColor: '#FFFFFF',
  },
  journalBackText: { color: colors.blue, fontSize: 9, fontWeight: '800' },
  journalFeed: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#DCE7E8',
    borderRadius: 20,
    backgroundColor: '#F7FCFA',
  },
  journalFeedHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  journalFeedCopy: { flex: 1 },
  journalSectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  journalDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#4F91C9',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  journalSectionTitle: {
    color: '#17345F',
    fontFamily: 'Georgia',
    fontSize: 21,
    fontWeight: '600',
  },
  journalSectionDescription: {
    marginTop: 6,
    color: '#516889',
    fontSize: 10,
    lineHeight: 15,
  },
  journalCount: { marginTop: 2, color: '#5C6E8C', fontSize: 9, fontWeight: '600' },
  journalTimeline: { marginTop: 20 },
  journalDay: { marginBottom: 19 },
  journalDayHeading: {
    marginBottom: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  journalDayTitle: {
    color: '#24466F',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  journalDayCount: { color: '#6F8099', fontSize: 8 },
  journalDayItems: { gap: 8 },
  journalEntry: {
    minHeight: 70,
    paddingVertical: 10,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#D9E7E6',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FFFFFF',
    shadowColor: '#214C53',
    shadowOpacity: 0.035,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  journalEntryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journalEntryIconBlue: { backgroundColor: '#E5F1FF' },
  journalEntryIconGreen: { backgroundColor: '#E1F3E8' },
  journalEntryIconAmber: { backgroundColor: '#FFF0D7' },
  journalEntryCopy: { flex: 1, minWidth: 0 },
  journalEntryMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  journalEntryTime: { color: '#6A7E9D', fontSize: 8 },
  journalEntryKind: {
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    color: '#466B75',
    backgroundColor: '#EEF4F4',
    fontSize: 7,
    fontWeight: '700',
  },
  journalEntryTitle: {
    marginTop: 5,
    color: '#1D3C68',
    fontFamily: 'Georgia',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  journalEntryBody: { marginTop: 4, color: '#526987', fontSize: 9, lineHeight: 14 },
  journalEntryChevron: { marginLeft: 0 },
  journalEmpty: {
    minHeight: 240,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journalEmptyIcon: {
    width: 52,
    height: 52,
    marginBottom: 12,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5F1FF',
  },
  journalEmptyTitle: { color: '#1D3C68', fontFamily: 'Georgia', fontSize: 17, fontWeight: '600' },
  journalEmptyText: {
    marginTop: 7,
    color: '#526987',
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 15,
  },
  journalEmptyAction: {
    minHeight: 38,
    marginTop: 15,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D4E0E7',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  journalEmptyActionText: { color: colors.blue, fontSize: 9, fontWeight: '800' },
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
  headerMenuButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pagesBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11, 41, 72, 0.34)' },
  pagesSheet: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 35,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.cream,
    gap: 9,
  },
  pagesHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pagesTitle: { marginTop: 5, color: colors.navy, fontFamily: 'Georgia', fontSize: 23 },
  pageMenuRow: {
    minHeight: 64,
    paddingHorizontal: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.paper,
  },
  pageMenuIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  pageMenuLabel: { flex: 1, color: colors.navy, fontSize: 12, fontWeight: '800' },
  pageMenuLabelDanger: { color: colors.red },
  alertReassurance: {
    minHeight: 72,
    padding: 13,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.paleGreen,
  },
  alertReassuranceUrgent: { borderColor: '#E4B7B2', backgroundColor: '#F9E9E6' },
  alertSafetyCards: { gap: 10, marginBottom: 11 },
  alertSafetyCard: { gap: 11, backgroundColor: '#FAFCFB' },
  alertSafetyHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  alertSafetyIcon: {
    width: 43,
    height: 43,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertSafetyEyebrow: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.65,
    textTransform: 'uppercase',
  },
  alertSafetyTitle: { marginTop: 3, color: colors.navy, fontSize: 14, fontWeight: '800' },
  alertSafetyDetail: { marginTop: 5, color: colors.muted, fontSize: 9, lineHeight: 13 },
  alertSafetyOnline: { color: colors.green, fontWeight: '700' },
  alertSafetyAttention: { color: '#925819', fontWeight: '700' },
  filterToggle: {
    minHeight: 42,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.paper,
  },
  filterToggleActive: { borderColor: '#A9C3DD', backgroundColor: '#F3F8FC' },
  filterToggleText: { flex: 1, color: colors.navy, fontSize: 11, fontWeight: '800' },
  filterCountBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  filterCountText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  alertFilterPanel: {
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    gap: 14,
    backgroundColor: '#F8FAFC',
  },
  alertFilterPanelHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  alertFilterPanelTitle: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  alertFilterPanelDetail: { marginTop: 3, color: colors.muted, fontSize: 9 },
  alertFilterReset: {
    minHeight: 31,
    paddingHorizontal: 10,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  alertFilterResetText: { color: colors.blue, fontSize: 9, fontWeight: '800' },
  alertFilterGroup: { gap: 8 },
  alertFilterLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  alertFilterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingRight: 2 },
  alertFilterRoomOptions: { flexDirection: 'row', gap: 7, paddingRight: 2 },
  alertFilterPill: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  alertFilterPillActive: {
    borderColor: colors.blue,
    backgroundColor: colors.blue,
  },
  alertFilterPillText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  alertFilterPillTextActive: { color: '#fff' },
  alertPaginationButton: {
    minHeight: 42,
    marginTop: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.paper,
  },
  alertPaginationText: { color: colors.blue, fontSize: 10, fontWeight: '800' },
  alertHistoryButton: {
    minHeight: 38,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  alertHistoryText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  filterPanel: {
    padding: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    gap: 8,
    backgroundColor: colors.paper,
  },
  alertMeasure: {
    width: '100%',
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.paleBlue,
  },
  dismissPanel: {
    width: '100%',
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    gap: 9,
    backgroundColor: colors.paleAmber,
  },
  dismissInput: {
    minHeight: 84,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.navy,
    textAlignVertical: 'top',
    backgroundColor: colors.paper,
    fontSize: 11,
  },
  dismissButtons: { flexDirection: 'row', gap: 8 },
  confirmBackdrop: {
    flex: 1,
    padding: 22,
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 41, 72, 0.35)',
  },
  confirmCard: { padding: 19, borderRadius: 18, gap: 12, backgroundColor: colors.paper },
  activityReliableBanner: {
    minHeight: 48,
    padding: 12,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.paleGreen,
  },
  activityReliableText: {
    flex: 1,
    color: colors.green,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  datePickerButton: {
    minHeight: 37,
    maxWidth: '62%',
    paddingHorizontal: 9,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.paleBlue,
  },
  datePickerText: { flexShrink: 1, color: colors.blue, fontSize: 9, fontWeight: '800' },
  compareToggle: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7 },
  toggleTrack: {
    width: 38,
    height: 22,
    padding: 3,
    marginLeft: 'auto',
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: '#C9CFD2',
  },
  toggleTrackActive: { alignItems: 'flex-end', backgroundColor: colors.green },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  toggleKnobActive: { alignSelf: 'flex-end' },
  comparePanel: { padding: 11, borderRadius: 12, gap: 9, backgroundColor: '#F2F0EA' },
  comparisonStats: { flexDirection: 'row', gap: 7 },
  comparisonStat: {
    flex: 1,
    minHeight: 60,
    padding: 8,
    borderRadius: 10,
    backgroundColor: colors.paper,
  },
  comparisonValue: { color: colors.navy, fontSize: 13, fontWeight: '900' },
  momentStats: { marginTop: 13, flexDirection: 'row', gap: 7 },
  momentStat: {
    flex: 1,
    minHeight: 88,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.paper,
  },
  momentIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  momentIconGreen: { backgroundColor: colors.paleGreen },
  momentIconAmber: { backgroundColor: colors.paleAmber },
  momentValue: { marginTop: 6, color: colors.navy, fontSize: 15, fontWeight: '900' },
  liveMomentRow: { minHeight: 73, flexDirection: 'row', alignItems: 'center', gap: 9 },
  liveTime: { width: 57, alignItems: 'flex-end' },
  liveTimeText: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  timelineDotLive: {
    width: 11,
    height: 11,
    borderWidth: 2,
    borderColor: colors.green,
    borderRadius: 7,
    backgroundColor: colors.paper,
  },
  liveCard: {
    minHeight: 56,
    flex: 1,
    padding: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.paleGreen,
  },
  sequenceBlock: { marginTop: 4 },
  sequenceSummary: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 9 },
  sequenceCard: {
    minHeight: 58,
    flex: 1,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.paper,
  },
  sequenceIcon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  sequenceEvents: {
    marginLeft: 66,
    paddingLeft: 9,
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
    gap: 5,
  },
  sequenceEvent: {
    minHeight: 45,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sequenceEventTime: { width: 35, color: colors.muted, fontSize: 8 },
  reliability: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 7,
    fontSize: 7,
    fontWeight: '900',
  },
  reliable: { color: colors.green, backgroundColor: colors.paleGreen },
  unreliable: { color: '#8D641C', backgroundColor: colors.paleAmber },
  olderNote: {
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventIcon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  equipmentStateRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  equipmentStateDot: { width: 8, height: 8, borderRadius: 4 },
  equipmentStateValue: { marginLeft: 'auto', color: colors.navy, fontSize: 11, fontWeight: '900' },
  protocolRow: {
    minHeight: 44,
    marginTop: 6,
    padding: 10,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.paleBlue,
  },
  protocolState: { marginLeft: 'auto', color: colors.accent, fontSize: 9, fontWeight: '800' },
});
