import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import eliseLogo from '../assets/logo.png';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  type AppStateStatus,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMobileApiAuthError, mobileApi, type AlertItem, type Overview } from '../src/api';
import { ServerRegistry } from '../src/discovery/registry';
import { discoveryService } from '../src/discovery/service';
import { isTailscaleUrl, remoteUrlFromDeepLink } from '../src/discovery/helpers';
import { parseSetupLink, resolveSetupLinkTarget, type SetupLink } from '../src/discovery/setupLink';
import type { DiscoveredServer, SavedServer } from '../src/discovery/types';
import { DashboardApp } from '../src/dashboard/DashboardApp';
import { prefetchHomeData } from '../src/dashboard/prefetchHomeData';
import {
  createDemoServer,
  DEMO_SERVER_ID,
  DEMO_TOKEN,
  resetDemoSession,
} from '../src/demo/mock-api';
import { registerPushNotifications } from '../src/notifications';
import { MobilePreparation } from '../src/setup/MobilePreparation';
import { MobileSetup, type Locale } from '../src/setup/MobileSetup';
import { WebHandoffModal } from '../src/setup/WebHandoffModal';
import { homeWebAddresses } from '../src/setup/webAddresses';
import { setAppLocale } from '../src/locale';
import { WelcomeExperience } from '../src/welcome/WelcomeExperience';
import { colors } from '../src/theme';
import { isLanguage, t } from '../src/i18n';
import { deviceLanguage } from '../src/i18n/device';

type Stage =
  | 'boot'
  | 'welcome'
  | 'discovery'
  | 'preparing'
  | 'login'
  | 'setup'
  | 'dashboard-preview'
  | 'dashboard';
type LoginOption = { id: string; displayName: string; identifier: string };

const LOCALE_KEY = '@elise:locale';
// A box on the home network answers at once: the TV's address is tried briefly, a few times.
const SETUP_LINK_PROBE_TIMEOUT = 2500;
const SETUP_PREVIEW_ID = 'elise-setup-preview';
const setupPreviewServer: DiscoveredServer = {
  id: SETUP_PREVIEW_ID,
  instanceId: SETUP_PREVIEW_ID,
  instanceName: 'Élise OS · Démo installation',
  version: '0.1.1-demo',
  apiVersion: 1,
  serverTime: new Date().toISOString(),
  supportsMobile: true,
  setupRequired: true,
  localUrl: null,
  remoteUrl: null,
  url: 'http://elise-demo.local:8090',
  host: 'elise-demo.local',
  port: 8090,
  source: 'manual',
  lastSeenAt: new Date().toISOString(),
};

const relativeTime = (value?: string) => {
  if (!value) return t('app.noActivity');
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return t('app.minAgo', { minutes });
  const hours = Math.round(minutes / 60);
  return t('app.hrAgo', { hours });
};

const asDiscovered = (server: SavedServer): DiscoveredServer => {
  const parsed = new URL(server.url);
  return {
    ...server,
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    lastSeenAt: server.lastConnectedAt,
  };
};

export default function HomeScreen() {
  const queryClient = useQueryClient();
  const incomingUrl = Linking.useURL();
  const [stage, setStage] = useState<Stage>('boot');
  // The phone's language until the user picks one on the welcome screen or in the settings.
  const [locale, setLocale] = useState<Locale>(deviceLanguage);
  // Helpers outside React read the language from here; set it before children render.
  setAppLocale(locale);
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [knownServers, setKnownServers] = useState<SavedServer[]>([]);
  const [server, setServer] = useState<SavedServer | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [loginOptions, setLoginOptions] = useState<LoginOption[]>([]);
  const [setupPreview, setSetupPreview] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  // Invites the user to finish the home setup on the web, right after the mobile setup.
  const [webHandoff, setWebHandoff] = useState(false);
  const radar = useRef(new Animated.Value(0)).current;
  const discoveryScrollRef = useRef<ScrollView | null>(null);
  const bootMotion = useRef(new Animated.Value(0)).current;
  const bootPulse = useRef(new Animated.Value(0)).current;
  const handledDeepLink = useRef<string | null>(null);
  // Set once a setup link (the TV's QR code) decides the screen: the start-up stops choosing one.
  const setupLinkTookOver = useRef(false);
  // Box of a setup link that has not answered yet: opened as soon as the scan finds it.
  const pendingLinkBox = useRef<string | null>(null);
  // The saved box and language, read once at start-up and shared with a setup link.
  const initialState = useRef<Promise<{
    last: SavedServer | null;
    savedLocale: string | null;
  }> | null>(null);
  const readInitialState = () =>
    (initialState.current ??= Promise.all([
      ServerRegistry.last(),
      AsyncStorage.getItem(LOCALE_KEY),
    ]).then(([last, savedLocale]) => ({ last, savedLocale })));
  const discoverRememberedRemoteServers = useCallback(async () => {
    const savedServers = await ServerRegistry.list();
    setKnownServers(savedServers);
    await Promise.all(
      savedServers.map((savedServer) => discoveryService.discoverRemote(savedServer)),
    );
  }, []);

  /** Opens the dashboard of a box the user is signed in to (or its sign-in if the session ended). */
  const openSignedIn = async (saved: SavedServer, savedToken: string, active: () => boolean) => {
    setServer(saved);
    try {
      const user = await mobileApi.me(saved, savedToken);
      if (!active()) return;
      setToken(savedToken);
      setUserName(user.displayName);
      await prefetchHomeData(queryClient, saved, savedToken);
      if (!active()) return;
      setStage('dashboard');
    } catch (error) {
      if (isMobileApiAuthError(error)) {
        await ServerRegistry.clearToken(saved.id);
        if (active()) setStage('login');
        return;
      }
      if (!active()) return;
      setToken(savedToken);
      setOffline(true);
      setStage('dashboard');
    }
  };

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      const { last, savedLocale } = await readInitialState();
      if (!mounted) return;
      if (isLanguage(savedLocale)) setLocale(savedLocale);
      const active = () => mounted && !setupLinkTookOver.current;
      if (!active()) return;
      if (!last) {
        setStage('welcome');
        return;
      }
      setServer(last);
      const savedToken = await ServerRegistry.token(last.id);
      if (!active()) return;
      if (!savedToken) {
        void mobileApi
          .loginOptions(last)
          .then(setLoginOptions)
          .catch(() => setLoginOptions([]));
        setStage('login');
        return;
      }
      await openSignedIn(last, savedToken, active);
    };
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [queryClient]);

  useEffect(() => {
    if (stage !== 'boot') return;
    const orbit = Animated.loop(
      Animated.timing(bootMotion, {
        toValue: 1,
        duration: 1900,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      }),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bootPulse, {
          toValue: 1,
          duration: 1050,
          easing: Easing.inOut(Easing.ease),
          isInteraction: false,
          useNativeDriver: true,
        }),
        Animated.timing(bootPulse, {
          toValue: 0,
          duration: 1050,
          easing: Easing.inOut(Easing.ease),
          isInteraction: false,
          useNativeDriver: true,
        }),
      ]),
    );
    let running = true;
    const appState = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && !running) {
        bootMotion.setValue(0);
        bootPulse.setValue(0);
        orbit.start();
        pulse.start();
        running = true;
      } else if (nextState !== 'active' && running) {
        orbit.stop();
        pulse.stop();
        running = false;
      }
    });
    orbit.start();
    pulse.start();
    return () => {
      appState.remove();
      orbit.stop();
      pulse.stop();
      bootMotion.setValue(0);
      bootPulse.setValue(0);
    };
  }, [bootMotion, bootPulse, stage]);

  useEffect(() => {
    if (stage !== 'discovery') return;
    const unsubscribe = discoveryService.subscribe(setServers);
    const unsubscribeError = discoveryService.onError(setError);
    void discoverRememberedRemoteServers().catch(() => {});
    discoveryService.start();
    const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        discoveryService.restart();
        void discoverRememberedRemoteServers().catch(() => {});
      } else discoveryService.stop();
    });
    const keyboard = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(() => discoveryScrollRef.current?.scrollToEnd({ animated: true }));
    });
    const animation = Animated.loop(
      Animated.timing(radar, { toValue: 1, duration: 1800, useNativeDriver: true }),
    );
    animation.start();
    return () => {
      animation.stop();
      radar.setValue(0);
      // Leaving the search ends the wait for the box of a setup link.
      pendingLinkBox.current = null;
      appState.remove();
      keyboard.remove();
      unsubscribe();
      unsubscribeError();
      discoveryService.stop();
    };
  }, [discoverRememberedRemoteServers, radar, stage]);

  const loadDashboard = async (showSpinner = false) => {
    if (!server || !token) return;
    if (showSpinner) setRefreshing(true);
    try {
      const [nextOverview, nextAlerts] = await Promise.all([
        mobileApi.overview(server, token),
        mobileApi.alerts(server, token),
      ]);
      setOverview(nextOverview);
      setAlerts(
        nextAlerts.items.filter((alert) => ['OPEN', 'ACKNOWLEDGED'].includes(alert.status)),
      );
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (stage === 'dashboard') void loadDashboard();
  }, [stage, server, token]);

  useEffect(() => {
    if (stage === 'dashboard' && server && token && server.id !== DEMO_SERVER_ID) {
      void registerPushNotifications(server, token).catch(() => undefined);
    }
  }, [server, stage, token]);

  const visibleServers = useMemo(() => {
    const discoveredIds = new Set(servers.map((item) => item.instanceId));
    return {
      live: [...servers, setupPreviewServer],
      remembered: knownServers.filter((item) => !discoveredIds.has(item.instanceId)),
    };
  }, [knownServers, servers]);

  /** Opens a box the usual way; false when it no longer answers (the error is shown). */
  const chooseServer = async (candidate: DiscoveredServer): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      if (candidate.instanceId === SETUP_PREVIEW_ID) {
        setSetupPreview(true);
        setServer({
          ...candidate,
          urls: [candidate.url],
          lastConnectedAt: candidate.lastSeenAt,
        });
        setStage('setup');
        return true;
      }
      setSetupPreview(false);
      const current = await discoveryService.refreshServer(candidate);
      const saved = await ServerRegistry.save(current);
      setServer(saved);
      setEmail('');
      setPassword('');
      setLoginOptions([]);
      if (current.preparing) {
        setStage('preparing');
        return true;
      }
      if (current.setupRequired) {
        setStage('setup');
        return true;
      }
      const options = await mobileApi.loginOptions(saved).catch(() => []);
      setLoginOptions(options);
      setStage('login');
      return true;
    } catch {
      setError(t('app.eliseIsNoLongerResponding'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The preparation screen polls with a stable callback; it reads the latest state here.
  const chooseServerRef = useRef(chooseServer);
  const serverRef = useRef(server);
  // A setup link is handled across several awaits: it reads the latest screen and scan here.
  const stageRef = useRef(stage);
  const serversRef = useRef(servers);
  useEffect(() => {
    chooseServerRef.current = chooseServer;
    serverRef.current = server;
    stageRef.current = stage;
    serversRef.current = servers;
  });
  const onPreparationReady = useCallback(() => {
    if (serverRef.current) void chooseServerRef.current(asDiscovered(serverRef.current));
  }, []);

  const connectManual = async () => {
    setBusy(true);
    setError('');
    try {
      await chooseServer(await discoveryService.manual(manualUrl));
    } catch {
      setError(t('app.addressNotFoundCheckThe'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!incomingUrl || handledDeepLink.current === incomingUrl) return;
    const value = remoteUrlFromDeepLink(incomingUrl);
    if (!value) return;
    handledDeepLink.current = incomingUrl;
    setManualUrl(value);
    setStage('discovery');
    void discoveryService
      .manual(value)
      .then(chooseServer)
      .catch(() => setError(t('app.theEliseLinkIsValid')));
  }, [incomingUrl]);

  /**
   * Opens the box whose TV shows the QR code. A saved box opens the usual way and nothing is
   * overwritten; a new one is looked for on the network, then at the TV's address, and opens on
   * its preparation screen. The app language stays the user's (or the phone's): the preparation
   * screen sends it to the box, the TV's language never changes it.
   */
  const openSetupLink = async (url: string, link: SetupLink) => {
    const current = () => handledDeepLink.current === url;
    const [{ last }, saved] = await Promise.all([readInitialState(), ServerRegistry.list()]);
    if (!current()) return;
    const known = link.box ? saved.find((item) => item.instanceId === link.box) : undefined;
    const savedToken = known ? await ServerRegistry.token(known.id) : null;
    if (!current()) return;

    // Already on that box: its dashboard (or the start-up opening it), setup or preparation.
    const shownId = (serverRef.current ?? last)?.instanceId;
    const shownStage = stageRef.current;
    if (
      known &&
      shownId === known.instanceId &&
      (['preparing', 'setup'].includes(shownStage) ||
        (savedToken && ['boot', 'dashboard'].includes(shownStage)))
    )
      return;

    setupLinkTookOver.current = true;
    setError('');
    setSetupPreview(false);

    const openKnown = async (box: SavedServer, boxToken: string | null) => {
      if (boxToken) {
        await ServerRegistry.remember(box);
        setOverview(null);
        setAlerts([]);
        setOffline(false);
        setStage('boot');
        await openSignedIn(box, boxToken, current);
        return;
      }
      // Still preparing, to set up or to sign in to: asking the box tells which.
      setStage('boot');
      if (await chooseServer(asDiscovered(box))) return;
      if (!current()) return;
      pendingLinkBox.current = box.instanceId;
      setStage('discovery');
    };

    if (known) {
      await openKnown(known, savedToken);
      return;
    }

    // The search screen scans the network while the TV's address is tried.
    pendingLinkBox.current = link.box;
    setStage('discovery');
    stageRef.current = 'discovery';
    const target = await resolveSetupLinkTarget({
      link,
      saved,
      discovered: () => serversRef.current,
      probe: (ip) => discoveryService.manual(ip, SETUP_LINK_PROBE_TIMEOUT),
      // Stops once another link arrived or the scan already opened the box.
      cancelled: () => !current() || pendingLinkBox.current !== link.box,
    });
    // The user left the search, or the scan found the box first and is opening it.
    if (!current() || stageRef.current !== 'discovery' || pendingLinkBox.current !== link.box)
      return;
    if (target.kind === 'saved') {
      await openKnown(target.server, await ServerRegistry.token(target.server.id));
    } else if (target.kind === 'found') {
      pendingLinkBox.current = null;
      await chooseServer(target.server);
    } else if (target.kind === 'mismatch') {
      setError(t('app.anotherEliseBoxAnswersAt'));
    } else {
      setError(t('app.theTvBoxIsNotFound'));
    }
  };

  useEffect(() => {
    if (!incomingUrl || handledDeepLink.current === incomingUrl) return;
    const link = parseSetupLink(incomingUrl);
    if (!link) return;
    handledDeepLink.current = incomingUrl;
    void openSetupLink(incomingUrl, link);
  }, [incomingUrl]);

  // The box of a setup link that did not answer at once: opened as soon as the scan finds it.
  useEffect(() => {
    const box = pendingLinkBox.current;
    if (stage !== 'discovery' || !box) return;
    const found = servers.find((item) => item.instanceId === box);
    if (!found) return;
    pendingLinkBox.current = null;
    void chooseServer(found);
  }, [servers, stage]);

  const login = async () => {
    if (!server) return;
    setBusy(true);
    setError('');
    try {
      const result = await mobileApi.login(server, email.trim(), password);
      await ServerRegistry.saveToken(server.id, result.accessToken);
      await ServerRegistry.remember(server);
      setToken(result.accessToken);
      setUserName(result.user.displayName);
      setStage('boot');
      await prefetchHomeData(queryClient, server, result.accessToken);
      setStage('dashboard');
    } catch {
      setError(t('app.incorrectCredentialsOrEliseIs'));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (server?.id === DEMO_SERVER_ID) {
      queryClient.removeQueries({ queryKey: ['elise', DEMO_SERVER_ID] });
      setToken(null);
      setServer(null);
      setOverview(null);
      setAlerts([]);
      setOffline(false);
      setStage('welcome');
      return;
    }
    if (server && token) void mobileApi.logout(server, token).catch(() => undefined);
    if (server) await ServerRegistry.clearToken(server.id);
    setToken(null);
    setOverview(null);
    setAlerts([]);
    setStage('welcome');
  };

  const changeLocale = (next: Locale) => {
    setAppLocale(next);
    setLocale(next);
    void AsyncStorage.setItem(LOCALE_KEY, next);
    // Fetched texts (demo data, labels from the server) are fetched again in the new language.
    void queryClient.invalidateQueries();
  };

  const completeSetup = async (accessToken: string, displayName: string) => {
    if (!server) return;
    await ServerRegistry.saveToken(server.id, accessToken);
    await ServerRegistry.remember(server);
    setToken(accessToken);
    setUserName(displayName);
    setStage('boot');
    await prefetchHomeData(queryClient, server, accessToken);
    setStage('dashboard');
    setWebHandoff(true);
  };

  const enterDemo = async () => {
    const demoServer = createDemoServer();
    resetDemoSession();
    queryClient.removeQueries({ queryKey: ['elise', DEMO_SERVER_ID] });
    setServer(demoServer);
    setToken(DEMO_TOKEN);
    setUserName('Claire Martin');
    setSetupPreview(false);
    setOverview(null);
    setAlerts([]);
    setOffline(false);
    setStage('boot');
    await prefetchHomeData(queryClient, demoServer, DEMO_TOKEN);
    setStage('dashboard');
  };

  if (stage === 'boot') {
    const orbitRotation = bootMotion.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });
    const logoScale = bootPulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] });
    const haloOpacity = bootPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.72] });
    return (
      <SafeAreaView style={styles.boot}>
        <View pointerEvents="none" style={styles.bootAmbientTop} />
        <View pointerEvents="none" style={styles.bootAmbientBottom} />
        <View style={styles.bootContent}>
          <View style={styles.bootVisual}>
            <Animated.View
              pointerEvents="none"
              style={[styles.bootHalo, { opacity: haloOpacity, transform: [{ scale: logoScale }] }]}
            />
            <Animated.View
              pointerEvents="none"
              style={[styles.bootOrbit, { transform: [{ rotate: orbitRotation }] }]}
            />
            <Animated.View style={[styles.bootLogoPlate, { transform: [{ scale: logoScale }] }]}>
              <Image
                source={eliseLogo}
                style={styles.bootLogoImage}
                resizeMode="contain"
                accessibilityLabel="Logo Élise"
              />
            </Animated.View>
          </View>
          <View style={styles.bootCopy}>
            <Text style={styles.bootEyebrow}>ÉLISE OS</Text>
            <Text style={styles.bootTitle}>{t('app.preparingYourSpace')}</Text>
            <Text style={styles.bootMessage}>{t('app.eliseIsBringingYourHome')}</Text>
          </View>
          <View style={styles.bootLoading}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.bootLoadingText}>{t('app.justAMoment')}</Text>
          </View>
        </View>
        <Text style={styles.bootFooter}>{t('app.homeConnectionPeaceOfMind')}</Text>
      </SafeAreaView>
    );
  }

  if (stage === 'welcome') {
    return (
      <WelcomeExperience
        locale={locale}
        onLocaleChange={changeLocale}
        onDiscover={() => setStage('discovery')}
        onDemo={() => void enterDemo()}
      />
    );
  }

  if (stage === 'discovery') {
    const renderServer = (candidate: DiscoveredServer, remembered = false) => (
      <Pressable
        key={candidate.instanceId}
        style={styles.serverCard}
        onPress={() => void chooseServer(candidate)}
      >
        <View style={[styles.serverIcon, remembered && styles.serverIconRemembered]}>
          <Ionicons
            name={
              candidate.instanceId === SETUP_PREVIEW_ID
                ? 'construct-outline'
                : candidate.preparing
                  ? 'hourglass-outline'
                  : remembered
                    ? 'time-outline'
                    : candidate.source === 'tailscale'
                      ? 'cloud-outline'
                      : 'home-outline'
            }
            size={22}
            color={colors.blue}
          />
        </View>
        <View style={styles.serverCopy}>
          <Text style={styles.serverName}>{candidate.instanceName}</Text>
          <Text style={styles.serverUrl} numberOfLines={1}>
            {candidate.instanceId === SETUP_PREVIEW_ID
              ? t('app.localPreviewNoDataIs')
              : candidate.url}
          </Text>
          <View style={styles.serverStatus}>
            <View style={[styles.dot, candidate.setupRequired && styles.dotAmber]} />
            <Text style={styles.serverStatusText}>
              {candidate.preparing
                ? t('app.gettingReady', { round: Math.round(candidate.preparation?.percent ?? 0) })
                : candidate.setupRequired
                  ? candidate.instanceId === SETUP_PREVIEW_ID
                    ? t('app.demoEliseOsNeedsSetup')
                    : t('app.eliseOsNeedsSetup')
                  : remembered
                    ? t('app.recentConnection')
                    : candidate.source === 'tailscale'
                      ? 'VIA TAILSCALE'
                      : t('app.readyToConnect')}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    );
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={styles.screen}>
          <ScrollView
            ref={discoveryScrollRef}
            contentContainerStyle={styles.discoveryContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.nav}>
              <Pressable style={styles.iconButton} onPress={() => setStage('welcome')}>
                <Ionicons name="arrow-back" size={21} color={colors.navy} />
              </Pressable>
              <View style={styles.discoveryBrand}>
                <Image source={eliseLogo} style={styles.discoveryBrandLogo} resizeMode="cover" />
                <View>
                  <Text style={styles.discoveryBrandName}>Élise</Text>
                  <Text style={styles.discoveryBrandCaption}>{t('app.familySpace')}</Text>
                </View>
              </View>
              <Pressable
                style={styles.iconButton}
                onPress={() => {
                  discoveryService.restart();
                  void discoverRememberedRemoteServers().catch(() => {});
                }}
              >
                <Ionicons name="refresh" size={20} color={colors.navy} />
              </Pressable>
            </View>
            <View style={styles.discoveryHeading}>
              <View style={styles.discoveryEyebrowRow}>
                <View style={styles.discoveryEyebrowDot} />
                <Text style={[styles.pageEyebrow, styles.discoveryPageEyebrow]}>
                  {t('app.homeConnection')}
                </Text>
              </View>
              <Text style={styles.pageTitle}>
                {servers.length ? t('app.eliseHasBeenFound') : t('app.connectEliseToYourHome')}
              </Text>
              <Text style={styles.pageText}>{t('app.yourPhoneLooksForElise')}</Text>
            </View>
            {!servers.length && (
              <View style={styles.radarCard}>
                <View style={styles.radarWrap}>
                  <Animated.View
                    style={[
                      styles.radarRing,
                      {
                        opacity: radar.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
                        transform: [
                          {
                            scale: radar.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.5, 1.45],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <View style={styles.radarCore}>
                    <Ionicons name="wifi" size={24} color="#fff" />
                  </View>
                </View>
                <View style={styles.radarCopy}>
                  <Text style={styles.radarTitle}>{t('app.searchingNow')}</Text>
                  <Text style={styles.radarText}>{t('app.thisMayTakeAFew')}</Text>
                  <View style={styles.scanStatus}>
                    <View style={styles.scanStatusDot} />
                    <Text style={styles.scanStatusText}>{t('app.automaticDiscovery')}</Text>
                  </View>
                </View>
              </View>
            )}
            {visibleServers.live.length > 0 && (
              <View style={styles.list}>
                <Text style={styles.sectionLabel}>{t('app.foundNow')}</Text>
                {visibleServers.live.map((item) => renderServer(item))}
              </View>
            )}
            {visibleServers.remembered.length > 0 && (
              <View style={styles.list}>
                <Text style={styles.sectionLabel}>{t('app.recentConnections')}</Text>
                {visibleServers.remembered.map((item) => renderServer(asDiscovered(item), true))}
              </View>
            )}
            <View style={styles.manualCard}>
              <View style={styles.manualHeading}>
                <View style={styles.manualIcon}>
                  <Ionicons name="link-outline" size={18} color={colors.accent} />
                </View>
                <View style={styles.manualCopy}>
                  <Text style={styles.manualTitle}>{t('app.enterAnAddress')}</Text>
                  <Text style={styles.manualText}>{t('app.useYourServerSLocal')}</Text>
                </View>
              </View>
              <View style={styles.manualRow}>
                <TextInput
                  style={styles.manualInput}
                  value={manualUrl}
                  onChangeText={setManualUrl}
                  onSubmitEditing={() => void connectManual()}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  placeholder="http://192.168.1.55:8090"
                  placeholderTextColor="#98A1A9"
                  selectionColor={colors.accent}
                  accessibilityLabel={t('app.serverAddress')}
                />
                <Pressable
                  style={styles.manualButton}
                  disabled={busy}
                  onPress={() => void connectManual()}
                  accessibilityRole="button"
                  accessibilityLabel={t('app.connect')}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  )}
                </Pressable>
              </View>
            </View>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.red} />
                <Text style={styles.errorBoxText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  if (stage === 'login' && server) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.loginScreen}>
          <View style={styles.nav}>
            <Pressable style={styles.iconButton} onPress={() => setStage('discovery')}>
              <Ionicons name="arrow-back" size={21} color={colors.navy} />
            </Pressable>
            <Text style={styles.navBrand}>Élise</Text>
            <View style={styles.loginNavSpacer} />
          </View>
          <View style={styles.loginBody}>
            <Image source={eliseLogo} style={styles.loginServerLogo} resizeMode="cover" />
            <Text style={styles.pageEyebrow}>{t('app.selectedServer')}</Text>
            <Text style={styles.loginTitle}>{server.instanceName}</Text>
            <Text style={styles.loginUrl}>{server.url}</Text>
            <View style={styles.form}>
              <Text style={styles.label}>{t('app.whoAreYou')}</Text>
              {loginOptions.length ? (
                <View style={styles.userList}>
                  {loginOptions.map((option) => {
                    const selected = email === option.identifier;
                    return (
                      <Pressable
                        key={option.id}
                        style={[styles.userCard, selected && styles.userCardActive]}
                        onPress={() => {
                          setEmail(option.identifier);
                          setPassword('');
                        }}
                      >
                        <View style={[styles.userAvatar, selected && styles.userAvatarActive]}>
                          <Text
                            style={[styles.userInitials, selected && styles.userInitialsActive]}
                          >
                            {option.displayName
                              .split(' ')
                              .map((part) => part[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.userName}>{option.displayName}</Text>
                          <Text style={styles.userIdentifier}>@{option.identifier}</Text>
                        </View>
                        <Ionicons
                          name={selected ? 'checkmark-circle' : 'chevron-forward'}
                          size={21}
                          color={selected ? colors.green : colors.muted}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  placeholder={t('app.username')}
                />
              )}
              {email ? (
                <>
                  <Text style={styles.label}>{t('app.password')}</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoComplete="current-password"
                    autoFocus={loginOptions.length > 0}
                  />
                </>
              ) : null}
              {error ? <Text style={styles.formError}>{error}</Text> : null}
              <Pressable
                style={styles.primary}
                disabled={busy || !email || password.length < 12}
                onPress={() => void login()}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.primaryText}>{t('app.signIn')}</Text>
                    <Ionicons name="arrow-forward" size={19} color="#fff" />
                  </>
                )}
              </Pressable>
            </View>
            <View style={styles.localNotice}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.green} />
              <Text style={styles.localNoticeText}>
                {isTailscaleUrl(server.url)
                  ? t('app.securePrivateConnectionThroughTailscale')
                  : t('app.directConnectionToYourLocal')}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  if (stage === 'preparing' && server) {
    return (
      <MobilePreparation
        url={server.url}
        instanceName={server.instanceName}
        initial={server.preparation}
        locale={locale}
        onBack={() => setStage('discovery')}
        onReady={onPreparationReady}
      />
    );
  }

  if (stage === 'setup' && server) {
    return (
      <MobileSetup
        server={server}
        locale={locale}
        previewMode={setupPreview}
        onBack={() => {
          setSetupPreview(false);
          setStage('discovery');
        }}
        onCompleted={completeSetup}
        onPreviewCompleted={() => setStage('dashboard-preview')}
      />
    );
  }

  if (stage === 'dashboard-preview' && server) {
    return (
      <SafeAreaView style={styles.dashboardScreen}>
        <ScrollView contentContainerStyle={styles.dashboardContent}>
          <View style={styles.dashboardHeader}>
            <View>
              <Text style={styles.dashboardHello}>{t('app.helloCamille')}</Text>
              <Text style={styles.dashboardHome}>{t('app.jeanneSHome')}</Text>
            </View>
            <Image source={eliseLogo} style={styles.previewDashboardLogo} resizeMode="contain" />
          </View>
          <View style={styles.previewBanner}>
            <Ionicons name="eye-outline" size={17} color={colors.blue} />
            <Text style={styles.previewBannerText}>{t('app.demoDashboard')}</Text>
          </View>
          <View style={[styles.statusCard, { borderColor: `${colors.green}55` }]}>
            <View style={[styles.statusIcon, { backgroundColor: colors.green }]}>
              <Ionicons name="checkmark-circle-outline" size={27} color="#fff" />
            </View>
            <Text style={styles.statusLabel}>{t('app.currentSituation')}</Text>
            <Text style={styles.statusTitle}>{t('app.everythingLooksNormal')}</Text>
            <Text style={styles.statusDetail}>{t('app.eliseIsStartingToLearn')}</Text>
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <View style={styles.metricIcon}>
                <Ionicons name="sparkles-outline" size={20} color={colors.blue} />
              </View>
              <Text style={styles.metricLabel}>{t('app.learning')}</Text>
              <Text style={styles.metricValue}>{t('app.day1')}</Text>
              <Text style={styles.metricDetail}>{t('app.of14Days')}</Text>
            </View>
            <View style={styles.metricCard}>
              <View style={styles.metricIcon}>
                <Ionicons name="home-outline" size={20} color={colors.blue} />
              </View>
              <Text style={styles.metricLabel}>{t('app.presence')}</Text>
              <Text style={styles.metricValue}>{t('app.atHome')}</Text>
              <Text style={styles.metricDetail}>{t('app.setupComplete')}</Text>
            </View>
          </View>
          <View style={styles.emptyAlerts}>
            <Ionicons name="checkmark-circle-outline" size={24} color={colors.green} />
            <Text style={styles.emptyAlertsText}>{t('app.nothingNeedsYourAttention')}</Text>
          </View>
          <Pressable
            style={styles.primary}
            onPress={() => {
              setSetupPreview(false);
              setServer(null);
              setStage('discovery');
            }}
          >
            <Text style={styles.primaryText}>{t('app.exitDemo')}</Text>
            <Ionicons name="close-outline" size={20} color="#fff" />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage === 'dashboard' && server && token) {
    return (
      <>
        <DashboardApp
          server={server}
          token={token}
          userName={userName}
          locale={locale}
          onLocaleChange={changeLocale}
          onLogout={logout}
        />
        <WebHandoffModal
          visible={webHandoff}
          addresses={homeWebAddresses(server)}
          onClose={() => setWebHandoff(false)}
        />
      </>
    );
  }

  const status = offline
    ? {
        title: t('app.eliseIsUnreachable'),
        detail: t('app.checkTheRaspberryPiAnd'),
        tone: colors.red,
        icon: 'cloud-offline-outline' as const,
      }
    : overview?.onboardingRequired
      ? {
          title: t('app.householdToFinish'),
          detail: t('app.finishSettingUpTheHousehold'),
          tone: colors.amber,
          icon: 'construct-outline' as const,
        }
      : overview?.reassurance === 'ATTENTION'
        ? {
            title: t('app.aSituationNeedsYourAttention'),
            detail: t('app.reviewTheOpenAlertsBelow'),
            tone: colors.amber,
            icon: 'alert-circle-outline' as const,
          }
        : overview?.reassurance === 'INSUFFICIENT_DATA'
          ? {
              title: t('app.notEnoughData'),
              detail: t('app.someSensorsAreNotResponding'),
              tone: colors.amber,
              icon: 'help-circle-outline' as const,
            }
          : overview?.reassurance === 'LEARNING'
            ? {
                title: t('app.eliseIsLearningTheRoutine'),
                detail: t('app.learningDayOf14', { value: overview.learningDays ?? 0 }),
                tone: colors.accent,
                icon: 'sparkles-outline' as const,
              }
            : {
                title: t('app.everythingLooksNormal'),
                detail: t('app.noUnusualSituationDetectedToday'),
                tone: colors.green,
                icon: 'checkmark-circle-outline' as const,
              };

  return (
    <SafeAreaView style={styles.dashboardScreen}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadDashboard(true)}
            tintColor={colors.blue}
          />
        }
        contentContainerStyle={styles.dashboardContent}
      >
        <View style={styles.dashboardHeader}>
          <View>
            <Text style={styles.dashboardHello}>
              {t('app.hello')} {userName.split(' ')[0] || userName},
            </Text>
            <Text style={styles.dashboardHome}>
              {overview?.home?.name ?? server?.instanceName ?? 'Élise'}
            </Text>
          </View>
          <Pressable style={styles.avatar} onPress={() => void logout()}>
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
        {offline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={17} color="#fff" />
            <Text style={styles.offlineBannerText}>{t('app.localConnectionLost')}</Text>
          </View>
        )}
        <View style={[styles.statusCard, { borderColor: `${status.tone}55` }]}>
          <View style={[styles.statusIcon, { backgroundColor: status.tone }]}>
            <Ionicons name={status.icon} size={27} color="#fff" />
          </View>
          <Text style={styles.statusLabel}>{t('app.currentSituation')}</Text>
          <Text style={styles.statusTitle}>{status.title}</Text>
          <Text style={styles.statusDetail}>{status.detail}</Text>
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <View style={styles.metricIcon}>
              <Ionicons name="pulse-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.metricLabel}>{t('app.lastActivity')}</Text>
            <Text style={styles.metricValue}>
              {offline ? t('app.unavailable') : (overview?.lastActivity?.room ?? '—')}
            </Text>
            <Text style={styles.metricDetail}>
              {offline
                ? t('app.statusNotRefreshed')
                : relativeTime(overview?.lastActivity?.occurredAt)}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricIcon}>
              <Ionicons name="home-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.metricLabel}>{t('app.estimatedPresence')}</Text>
            <Text style={styles.metricValue}>
              {offline || !overview?.home ? '—' : t('app.atHome')}
            </Text>
            <Text style={styles.metricDetail}>
              {offline ? t('app.statusNotRefreshed') : t('app.basedOnLocalActivity')}
            </Text>
          </View>
        </View>
        <View style={styles.alertSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionLabel}>{t('app.alerts')}</Text>
              <Text style={styles.sectionTitle}>
                {alerts.length ? t('app.ongoing', { length: alerts.length }) : t('app.noAlerts')}
              </Text>
            </View>
            <View style={[styles.alertCount, alerts.length > 0 && styles.alertCountActive]}>
              <Text style={styles.alertCountText}>{alerts.length}</Text>
            </View>
          </View>
          {offline ? (
            <Text style={styles.emptyText}>{t('app.alertsCannotBeRefreshed')}</Text>
          ) : alerts.length ? (
            alerts.slice(0, 2).map((alert) => (
              <View style={styles.alertRow} key={alert.id}>
                <View
                  style={[
                    styles.alertLine,
                    alert.severity === 'URGENT' && { backgroundColor: colors.red },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <Text style={styles.alertText} numberOfLines={2}>
                    {alert.explanation}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
            ))
          ) : (
            <View style={styles.emptyAlerts}>
              <Ionicons name="checkmark-circle-outline" size={24} color={colors.green} />
              <Text style={styles.emptyAlertsText}>{t('app.noSituationNeedsYourAttention')}</Text>
            </View>
          )}
        </View>
        <View style={styles.dashboardFooter}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.blue} />
          <Text style={styles.dashboardFooterText}>
            {t('app.connectedLocallyTo')} {server?.instanceName}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 28,
    backgroundColor: colors.cream,
  },
  bootAmbientTop: {
    position: 'absolute',
    width: 370,
    height: 370,
    borderRadius: 185,
    top: -205,
    right: -165,
    backgroundColor: '#E0EAF0',
  },
  bootAmbientBottom: {
    position: 'absolute',
    width: 285,
    height: 285,
    borderRadius: 143,
    bottom: -175,
    left: -132,
    backgroundColor: '#F0E2D2',
  },
  bootContent: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: 22,
  },
  bootVisual: {
    width: 184,
    height: 184,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootHalo: {
    position: 'absolute',
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: '#DDE8EB',
  },
  bootOrbit: {
    position: 'absolute',
    width: 144,
    height: 144,
    borderRadius: 72,
    borderWidth: 2,
    borderColor: '#D7E0E4',
    borderTopColor: colors.accent,
    borderRightColor: colors.amber,
  },
  bootLogoPlate: {
    width: 112,
    height: 112,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    shadowColor: colors.navy,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  bootLogoImage: { width: 98, height: 98, borderRadius: 27 },
  bootCopy: { alignItems: 'center', gap: 7 },
  bootEyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  bootTitle: {
    color: colors.navy,
    fontFamily: 'Georgia',
    fontSize: 27,
    textAlign: 'center',
  },
  bootMessage: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
  bootLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 2,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  bootLoadingText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  bootFooter: {
    position: 'absolute',
    bottom: 16,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  miniLogo: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.3)',
    backgroundColor: 'rgba(255,255,255,.08)',
  },
  screen: { flex: 1, backgroundColor: '#F7F4EE' },
  discoveryContent: { paddingHorizontal: 20, paddingBottom: 30, gap: 20 },
  nav: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  navBrand: { fontFamily: 'Georgia', fontWeight: '600', fontSize: 22, color: colors.navy },
  discoveryBrand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  discoveryBrandLogo: { width: 38, height: 38, borderRadius: 12 },
  discoveryBrandName: { color: colors.navy, fontFamily: 'Georgia', fontSize: 20, lineHeight: 25 },
  discoveryBrandCaption: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 1,
  },
  discoveryHeading: { gap: 0 },
  discoveryEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },
  discoveryEyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  loginNavSpacer: { width: 40 },
  pageEyebrow: {
    color: colors.accent,
    fontSize: 13,
    letterSpacing: 0.6,
    fontWeight: '800',
    marginBottom: 7,
  },
  discoveryPageEyebrow: { marginBottom: 0 },
  pageTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 32, lineHeight: 40 },
  pageText: { color: colors.muted, fontSize: 16, lineHeight: 25, marginTop: 9 },
  radarCard: {
    minHeight: 150,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#DCE5E3',
    backgroundColor: '#EAF0EE',
  },
  radarWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  radarRing: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  radarCore: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  radarCopy: { flex: 1, paddingVertical: 8 },
  radarTitle: { color: colors.navy, fontWeight: '800', fontSize: 17 },
  radarText: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 5 },
  scanStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  scanStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  scanStatusText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  list: { gap: 10 },
  sectionLabel: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 0.6,
    fontWeight: '800',
    marginBottom: 2,
  },
  serverCard: {
    minHeight: 92,
    padding: 14,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  serverIcon: {
    width: 45,
    height: 45,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F0F3',
  },
  serverIconRemembered: { backgroundColor: '#EEEAE3' },
  serverCopy: { flex: 1 },
  serverName: { color: colors.navy, fontWeight: '800', fontSize: 17 },
  serverUrl: { color: colors.muted, fontSize: 13, marginTop: 4 },
  serverStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  serverStatusText: { color: colors.green, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  dotAmber: { backgroundColor: colors.amber },
  manualCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    shadowColor: colors.navy,
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  manualHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  manualIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F0F3',
  },
  manualCopy: { flex: 1 },
  manualTitle: { color: colors.navy, fontWeight: '800', fontSize: 17 },
  manualText: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 3 },
  manualRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  manualInput: {
    flex: 1,
    height: 50,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7DFE0',
    color: colors.navy,
    backgroundColor: '#F9FAF9',
    fontSize: 15,
  },
  manualButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  errorBox: {
    padding: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8E1E1',
  },
  errorBoxText: { color: colors.red, flex: 1, fontSize: 14 },
  loginScreen: { flex: 1, paddingHorizontal: 20 },
  loginBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 45 },
  loginServerLogo: {
    width: 60,
    height: 60,
    borderRadius: 19,
    marginBottom: 20,
  },
  loginTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 32, marginTop: 2 },
  loginUrl: { color: colors.muted, fontSize: 14, marginTop: 7 },
  form: { width: '100%', marginTop: 32 },
  userList: { gap: 9, marginBottom: 16 },
  userCard: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  userCardActive: { borderColor: '#94B6A1', backgroundColor: '#E8F1EB' },
  userAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  userAvatarActive: { backgroundColor: colors.green },
  userInitials: { color: colors.blue, fontWeight: '800', fontSize: 16 },
  userInitialsActive: { color: '#fff' },
  userName: { color: colors.navy, fontWeight: '800', fontSize: 17 },
  userIdentifier: { color: colors.muted, fontSize: 15, marginTop: 3 },
  label: { color: colors.navy, fontSize: 14, fontWeight: '800', marginBottom: 7 },
  input: {
    height: 49,
    paddingHorizontal: 13,
    marginBottom: 16,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.navy,
    backgroundColor: '#fff',
  },
  formError: { color: colors.red, fontSize: 14, marginBottom: 12 },
  primary: {
    minHeight: 52,
    paddingHorizontal: 17,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: colors.blue,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  localNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20 },
  localNoticeText: { color: colors.muted, fontSize: 13 },
  dashboardScreen: { flex: 1, backgroundColor: colors.cream },
  dashboardContent: { paddingHorizontal: 20, paddingBottom: 35 },
  dashboardHeader: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewDashboardLogo: { width: 54, height: 54, borderRadius: 14 },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#E5EEF4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  previewBannerText: { color: colors.blue, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  dashboardHello: { color: colors.muted, fontSize: 15 },
  dashboardHome: { color: colors.navy, fontFamily: 'Georgia', fontSize: 26, marginTop: 3 },
  avatar: {
    width: 43,
    height: 43,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  offlineBanner: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    backgroundColor: colors.red,
  },
  offlineBannerText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  statusCard: {
    padding: 23,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    backgroundColor: colors.paper,
  },
  statusIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 17,
  },
  statusLabel: { color: colors.accent, fontSize: 12, letterSpacing: 0.6, fontWeight: '800' },
  statusTitle: {
    color: colors.navy,
    textAlign: 'center',
    fontFamily: 'Georgia',
    fontSize: 27,
    marginTop: 8,
  },
  statusDetail: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 8,
  },
  metricRow: { flexDirection: 'row', gap: 11, marginTop: 12 },
  metricCard: {
    flex: 1,
    minHeight: 145,
    padding: 15,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  metricIcon: {
    width: 37,
    height: 37,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
    backgroundColor: '#E8F0F3',
  },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  metricValue: { color: colors.navy, fontSize: 17, fontWeight: '800', marginTop: 7 },
  metricDetail: { color: colors.muted, fontSize: 12, marginTop: 4 },
  alertSection: {
    padding: 18,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 12,
    backgroundColor: colors.paper,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: { color: colors.navy, fontSize: 20, fontWeight: '800', marginTop: 4 },
  alertCount: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7EBEE',
  },
  alertCountActive: { backgroundColor: '#F7E4CF' },
  alertCountText: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  alertRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  alertLine: { width: 3, height: 42, borderRadius: 2, backgroundColor: colors.amber },
  alertTitle: { color: colors.navy, fontWeight: '800', fontSize: 15 },
  alertText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 3 },
  emptyAlerts: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  emptyAlertsText: { color: colors.muted, flex: 1, fontSize: 14 },
  emptyText: { color: colors.muted, fontSize: 14 },
  dashboardFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    marginTop: 21,
  },
  dashboardFooterText: { color: colors.muted, fontSize: 12 },
});
