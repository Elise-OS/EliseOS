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
import { useEffect, useMemo, useRef, useState } from 'react';
import { isMobileApiAuthError, mobileApi, type AlertItem, type Overview } from '../src/api';
import { ServerRegistry } from '../src/discovery/registry';
import { discoveryService } from '../src/discovery/service';
import { isTailscaleUrl, remoteUrlFromDeepLink } from '../src/discovery/helpers';
import type { DiscoveredServer, SavedServer } from '../src/discovery/types';
import { DashboardApp } from '../src/dashboard/DashboardApp';
import { prefetchHomeData } from '../src/dashboard/prefetchHomeData';
import { registerPushNotifications } from '../src/notifications';
import { MobileSetup, type Locale } from '../src/setup/MobileSetup';
import { WelcomeExperience } from '../src/welcome/WelcomeExperience';

type Stage =
  'boot' | 'welcome' | 'discovery' | 'login' | 'setup' | 'dashboard-preview' | 'dashboard';
type LoginOption = { id: string; displayName: string; identifier: string };

const LOCALE_KEY = '@elise:locale';
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

const colors = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  amber: '#D99A55',
  red: '#B74747',
};

const relativeTime = (value?: string) => {
  if (!value) return 'Aucune activité';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Il y a ${hours} h`;
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
  const [locale, setLocale] = useState<Locale>('fr');
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
  const radar = useRef(new Animated.Value(0)).current;
  const bootMotion = useRef(new Animated.Value(0)).current;
  const bootPulse = useRef(new Animated.Value(0)).current;
  const handledDeepLink = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      const [last, savedLocale] = await Promise.all([
        ServerRegistry.last(),
        AsyncStorage.getItem(LOCALE_KEY),
      ]);
      if (!mounted) return;
      if (savedLocale === 'fr' || savedLocale === 'en') setLocale(savedLocale);
      if (!last) {
        setStage('welcome');
        return;
      }
      setServer(last);
      const savedToken = await ServerRegistry.token(last.id);
      if (!mounted) return;
      if (!savedToken) {
        void mobileApi
          .loginOptions(last)
          .then(setLoginOptions)
          .catch(() => setLoginOptions([]));
        setStage('login');
        return;
      }
      try {
        const user = await mobileApi.me(last, savedToken);
        if (!mounted) return;
        setToken(savedToken);
        setUserName(user.displayName);
        await prefetchHomeData(queryClient, last, savedToken);
        if (!mounted) return;
        setStage('dashboard');
      } catch (error) {
        if (isMobileApiAuthError(error)) {
          await ServerRegistry.clearToken(last.id);
          if (mounted) setStage('login');
          return;
        }
        if (!mounted) return;
        setToken(savedToken);
        setOffline(true);
        setStage('dashboard');
      }
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
    void ServerRegistry.list().then(setKnownServers);
    discoveryService.start();
    const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') discoveryService.restart();
      else discoveryService.stop();
    });
    const animation = Animated.loop(
      Animated.timing(radar, { toValue: 1, duration: 1800, useNativeDriver: true }),
    );
    animation.start();
    return () => {
      animation.stop();
      radar.setValue(0);
      appState.remove();
      unsubscribe();
      unsubscribeError();
      discoveryService.stop();
    };
  }, [radar, stage]);

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
    if (stage === 'dashboard' && server && token) {
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

  const chooseServer = async (candidate: DiscoveredServer) => {
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
        return;
      }
      setSetupPreview(false);
      const current = await discoveryService.refreshServer(candidate);
      const saved = await ServerRegistry.save(current);
      setServer(saved);
      setEmail('');
      setPassword('');
      setLoginOptions([]);
      if (current.setupRequired) {
        setStage('setup');
        return;
      }
      const options = await mobileApi.loginOptions(saved).catch(() => []);
      setLoginOptions(options);
      setStage('login');
    } catch {
      setError(
        locale === 'fr'
          ? 'Élise ne répond plus à cette adresse. Relancez la recherche.'
          : 'Élise is no longer responding at this address. Scan again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const connectManual = async () => {
    setBusy(true);
    setError('');
    try {
      await chooseServer(await discoveryService.manual(manualUrl));
    } catch {
      setError(
        locale === 'fr'
          ? 'Adresse introuvable. Vérifiez le réseau local ou que Tailscale est actif.'
          : 'Address not found. Check the local network or make sure Tailscale is active.',
      );
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
      .catch(() =>
        setError(
          locale === 'fr'
            ? 'Le lien Élise est valide, mais Tailscale ne répond pas encore.'
            : 'The Élise link is valid, but Tailscale is not responding yet.',
        ),
      );
  }, [incomingUrl]);

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
      setError(
        locale === 'fr'
          ? 'Identifiants incorrects ou Élise indisponible.'
          : 'Incorrect credentials or Élise is unavailable.',
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (server && token) void mobileApi.logout(server, token).catch(() => undefined);
    if (server) await ServerRegistry.clearToken(server.id);
    setToken(null);
    setOverview(null);
    setAlerts([]);
    setStage('welcome');
  };

  const changeLocale = (next: Locale) => {
    setLocale(next);
    void AsyncStorage.setItem(LOCALE_KEY, next);
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
            <Text style={styles.bootTitle}>
              {locale === 'fr' ? 'Votre espace se prépare' : 'Preparing your space'}
            </Text>
            <Text style={styles.bootMessage}>
              {locale === 'fr'
                ? 'Élise retrouve vos repères.'
                : 'Élise is bringing your home back into view.'}
            </Text>
          </View>
          <View style={styles.bootLoading}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.bootLoadingText}>
              {locale === 'fr' ? 'Un instant…' : 'Just a moment…'}
            </Text>
          </View>
        </View>
        <Text style={styles.bootFooter}>
          {locale === 'fr' ? 'MAISON · LIEN · SÉRÉNITÉ' : 'HOME · CONNECTION · PEACE OF MIND'}
        </Text>
      </SafeAreaView>
    );
  }

  if (stage === 'welcome') {
    return (
      <WelcomeExperience
        locale={locale}
        onLocaleChange={changeLocale}
        onDiscover={() => setStage('discovery')}
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
                : remembered
                  ? 'time-outline'
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
              ? locale === 'fr'
                ? 'Aperçu local · aucune donnée envoyée'
                : 'Local preview · no data is sent'
              : candidate.url}
          </Text>
          <View style={styles.serverStatus}>
            <View style={[styles.dot, candidate.setupRequired && styles.dotAmber]} />
            <Text style={styles.serverStatusText}>
              {candidate.setupRequired
                ? candidate.instanceId === SETUP_PREVIEW_ID
                  ? locale === 'fr'
                    ? 'DÉMO · ÉLISE OS À CONFIGURER'
                    : 'DEMO · ÉLISE OS NEEDS SETUP'
                  : locale === 'fr'
                    ? 'ÉLISE OS À CONFIGURER'
                    : 'ÉLISE OS NEEDS SETUP'
                : remembered
                  ? locale === 'fr'
                    ? 'CONNEXION RÉCENTE'
                    : 'RECENT CONNECTION'
                  : locale === 'fr'
                    ? 'PRÊT À SE CONNECTER'
                    : 'READY TO CONNECT'}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    );
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.discoveryContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.nav}>
            <Pressable style={styles.iconButton} onPress={() => setStage('welcome')}>
              <Ionicons name="arrow-back" size={21} color={colors.navy} />
            </Pressable>
            <Text style={styles.navBrand}>Élise</Text>
            <Pressable style={styles.iconButton} onPress={() => discoveryService.restart()}>
              <Ionicons name="refresh" size={20} color={colors.navy} />
            </Pressable>
          </View>
          <View>
            <Text style={styles.pageEyebrow}>
              {locale === 'fr' ? 'RÉSEAU LOCAL' : 'LOCAL NETWORK'}
            </Text>
            <Text style={styles.pageTitle}>
              {servers.length
                ? locale === 'fr'
                  ? 'Votre Élise est là.'
                  : 'Your Élise is here.'
                : locale === 'fr'
                  ? 'Recherche en cours…'
                  : 'Scanning…'}
            </Text>
            <Text style={styles.pageText}>
              {locale === 'fr'
                ? 'Votre téléphone recherche automatiquement Élise OS sur tout le réseau Wi-Fi local.'
                : 'Your phone is automatically scanning the entire local Wi-Fi network for Élise OS.'}
            </Text>
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
                  <Ionicons name="wifi" size={28} color="#fff" />
                </View>
              </View>
              <Text style={styles.radarTitle}>
                {locale === 'fr' ? 'Scan réseau actif' : 'Network scan active'}
              </Text>
              <Text style={styles.radarText}>
                {locale === 'fr'
                  ? 'Recherche mDNS et vérification des ports 8090 et 8080 sur le sous-réseau'
                  : 'Searching with mDNS and probing ports 8090 and 8080 across the subnet'}
              </Text>
            </View>
          )}
          {visibleServers.live.length > 0 && (
            <View style={styles.list}>
              <Text style={styles.sectionLabel}>
                {locale === 'fr' ? 'DÉTECTÉ MAINTENANT' : 'FOUND NOW'}
              </Text>
              {visibleServers.live.map((item) => renderServer(item))}
            </View>
          )}
          {visibleServers.remembered.length > 0 && (
            <View style={styles.list}>
              <Text style={styles.sectionLabel}>
                {locale === 'fr' ? 'CONNEXIONS RÉCENTES' : 'RECENT CONNECTIONS'}
              </Text>
              {visibleServers.remembered.map((item) => renderServer(asDiscovered(item), true))}
            </View>
          )}
          <View style={styles.manualCard}>
            <Text style={styles.manualTitle}>
              {locale === 'fr' ? 'Connexion manuelle' : 'Manual connection'}
            </Text>
            <Text style={styles.manualText}>
              {locale === 'fr'
                ? 'Si Élise n’apparaît pas, saisissez son adresse locale ou son adresse Tailscale HTTPS.'
                : 'If Élise does not appear, enter its local or Tailscale HTTPS address.'}
            </Text>
            <View style={styles.manualRow}>
              <TextInput
                style={styles.manualInput}
                value={manualUrl}
                onChangeText={setManualUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.55:8090"
                placeholderTextColor="#98A1A9"
              />
              <Pressable
                style={styles.manualButton}
                disabled={busy}
                onPress={() => void connectManual()}
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
            <Text style={styles.pageEyebrow}>
              {locale === 'fr' ? 'SERVEUR SÉLECTIONNÉ' : 'SELECTED SERVER'}
            </Text>
            <Text style={styles.loginTitle}>{server.instanceName}</Text>
            <Text style={styles.loginUrl}>{server.url}</Text>
            <View style={styles.form}>
              <Text style={styles.label}>
                {locale === 'fr' ? 'Qui êtes-vous ?' : 'Who are you?'}
              </Text>
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
                  placeholder={locale === 'fr' ? 'Identifiant' : 'Username'}
                />
              )}
              {email ? (
                <>
                  <Text style={styles.label}>{locale === 'fr' ? 'Mot de passe' : 'Password'}</Text>
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
                    <Text style={styles.primaryText}>
                      {locale === 'fr' ? 'Se connecter' : 'Sign in'}
                    </Text>
                    <Ionicons name="arrow-forward" size={19} color="#fff" />
                  </>
                )}
              </Pressable>
            </View>
            <View style={styles.localNotice}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.green} />
              <Text style={styles.localNoticeText}>
                {isTailscaleUrl(server.url)
                  ? locale === 'fr'
                    ? 'Connexion privée sécurisée via Tailscale'
                    : 'Secure private connection through Tailscale'
                  : locale === 'fr'
                    ? 'Connexion directe à votre serveur local'
                    : 'Direct connection to your local server'}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
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
              <Text style={styles.dashboardHello}>
                {locale === 'fr' ? 'Bonjour Camille,' : 'Hello Camille,'}
              </Text>
              <Text style={styles.dashboardHome}>
                {locale === 'fr' ? 'Logement de Jeanne' : 'Jeanne’s home'}
              </Text>
            </View>
            <Image source={eliseLogo} style={styles.previewDashboardLogo} resizeMode="contain" />
          </View>
          <View style={styles.previewBanner}>
            <Ionicons name="eye-outline" size={17} color={colors.blue} />
            <Text style={styles.previewBannerText}>
              {locale === 'fr' ? 'DASHBOARD DE DÉMONSTRATION' : 'DEMO DASHBOARD'}
            </Text>
          </View>
          <View style={[styles.statusCard, { borderColor: `${colors.green}55` }]}>
            <View style={[styles.statusIcon, { backgroundColor: colors.green }]}>
              <Ionicons name="checkmark-circle-outline" size={27} color="#fff" />
            </View>
            <Text style={styles.statusLabel}>
              {locale === 'fr' ? 'SITUATION ACTUELLE' : 'CURRENT SITUATION'}
            </Text>
            <Text style={styles.statusTitle}>
              {locale === 'fr' ? 'Tout semble normal' : 'Everything looks normal'}
            </Text>
            <Text style={styles.statusDetail}>
              {locale === 'fr'
                ? 'Élise commence à apprendre les habitudes de Jeanne.'
                : 'Élise is starting to learn Jeanne’s routines.'}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <View style={styles.metricIcon}>
                <Ionicons name="sparkles-outline" size={20} color={colors.blue} />
              </View>
              <Text style={styles.metricLabel}>
                {locale === 'fr' ? 'APPRENTISSAGE' : 'LEARNING'}
              </Text>
              <Text style={styles.metricValue}>{locale === 'fr' ? 'Jour 1' : 'Day 1'}</Text>
              <Text style={styles.metricDetail}>
                {locale === 'fr' ? 'sur 14 jours' : 'of 14 days'}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <View style={styles.metricIcon}>
                <Ionicons name="home-outline" size={20} color={colors.blue} />
              </View>
              <Text style={styles.metricLabel}>{locale === 'fr' ? 'PRÉSENCE' : 'PRESENCE'}</Text>
              <Text style={styles.metricValue}>{locale === 'fr' ? 'À domicile' : 'At home'}</Text>
              <Text style={styles.metricDetail}>
                {locale === 'fr' ? 'Configuration terminée' : 'Setup complete'}
              </Text>
            </View>
          </View>
          <View style={styles.emptyAlerts}>
            <Ionicons name="checkmark-circle-outline" size={24} color={colors.green} />
            <Text style={styles.emptyAlertsText}>
              {locale === 'fr'
                ? 'Aucune situation ne demande votre attention.'
                : 'Nothing needs your attention.'}
            </Text>
          </View>
          <Pressable
            style={styles.primary}
            onPress={() => {
              setSetupPreview(false);
              setServer(null);
              setStage('discovery');
            }}
          >
            <Text style={styles.primaryText}>
              {locale === 'fr' ? 'Quitter la démonstration' : 'Exit demo'}
            </Text>
            <Ionicons name="close-outline" size={20} color="#fff" />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage === 'dashboard' && server && token) {
    return (
      <DashboardApp
        server={server}
        token={token}
        userName={userName}
        locale={locale}
        onLocaleChange={changeLocale}
        onLogout={logout}
      />
    );
  }

  const status = offline
    ? {
        title: 'Élise est inaccessible',
        detail: 'Vérifiez le Raspberry Pi et votre connexion Wi-Fi.',
        tone: colors.red,
        icon: 'cloud-offline-outline' as const,
      }
    : overview?.onboardingRequired
      ? {
          title: 'Foyer à finaliser',
          detail: 'Terminez la configuration du foyer depuis le dashboard web.',
          tone: colors.amber,
          icon: 'construct-outline' as const,
        }
      : overview?.reassurance === 'ATTENTION'
        ? {
            title: 'Une situation demande votre attention',
            detail: 'Consultez les alertes ouvertes ci-dessous.',
            tone: colors.amber,
            icon: 'alert-circle-outline' as const,
          }
        : overview?.reassurance === 'INSUFFICIENT_DATA'
          ? {
              title: 'Données insuffisantes',
              detail: 'Certains capteurs ne répondent pas correctement.',
              tone: colors.amber,
              icon: 'help-circle-outline' as const,
            }
          : overview?.reassurance === 'LEARNING'
            ? {
                title: 'Élise apprend les habitudes',
                detail: `Jour ${overview.learningDays ?? 0} sur 14 d’apprentissage.`,
                tone: colors.accent,
                icon: 'sparkles-outline' as const,
              }
            : {
                title: 'Tout semble normal',
                detail: 'Aucune situation inhabituelle détectée aujourd’hui.',
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
            <Text style={styles.dashboardHello}>Bonjour {userName.split(' ')[0] || userName},</Text>
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
            <Text style={styles.offlineBannerText}>Connexion locale interrompue</Text>
          </View>
        )}
        <View style={[styles.statusCard, { borderColor: `${status.tone}55` }]}>
          <View style={[styles.statusIcon, { backgroundColor: status.tone }]}>
            <Ionicons name={status.icon} size={27} color="#fff" />
          </View>
          <Text style={styles.statusLabel}>SITUATION ACTUELLE</Text>
          <Text style={styles.statusTitle}>{status.title}</Text>
          <Text style={styles.statusDetail}>{status.detail}</Text>
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <View style={styles.metricIcon}>
              <Ionicons name="pulse-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.metricLabel}>DERNIÈRE ACTIVITÉ</Text>
            <Text style={styles.metricValue}>
              {offline ? 'Indisponible' : (overview?.lastActivity?.room ?? '—')}
            </Text>
            <Text style={styles.metricDetail}>
              {offline ? 'État non actualisé' : relativeTime(overview?.lastActivity?.occurredAt)}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricIcon}>
              <Ionicons name="home-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.metricLabel}>PRÉSENCE ESTIMÉE</Text>
            <Text style={styles.metricValue}>
              {offline || !overview?.home ? '—' : 'À domicile'}
            </Text>
            <Text style={styles.metricDetail}>
              {offline ? 'État non actualisé' : 'Selon l’activité locale'}
            </Text>
          </View>
        </View>
        <View style={styles.alertSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionLabel}>ALERTES</Text>
              <Text style={styles.sectionTitle}>
                {alerts.length ? `${alerts.length} en cours` : 'Aucune alerte'}
              </Text>
            </View>
            <View style={[styles.alertCount, alerts.length > 0 && styles.alertCountActive]}>
              <Text style={styles.alertCountText}>{alerts.length}</Text>
            </View>
          </View>
          {offline ? (
            <Text style={styles.emptyText}>Les alertes ne peuvent pas être actualisées.</Text>
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
              <Text style={styles.emptyAlertsText}>
                Aucune situation ne demande votre attention.
              </Text>
            </View>
          )}
        </View>
        <View style={styles.dashboardFooter}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.blue} />
          <Text style={styles.dashboardFooterText}>
            Connecté localement à {server?.instanceName}
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 3,
  },
  bootTitle: {
    color: colors.navy,
    fontFamily: 'Georgia',
    fontSize: 25,
    textAlign: 'center',
  },
  bootMessage: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
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
  bootLoadingText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  bootFooter: {
    position: 'absolute',
    bottom: 16,
    color: colors.muted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 2,
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
  discoveryContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 24 },
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
  navBrand: { fontFamily: 'Georgia', fontWeight: '600', fontSize: 20, color: colors.navy },
  loginNavSpacer: { width: 40 },
  pageEyebrow: {
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '800',
    marginBottom: 7,
  },
  pageTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 33, lineHeight: 39 },
  pageText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  radarCard: {
    minHeight: 265,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  radarWrap: { width: 125, height: 125, alignItems: 'center', justifyContent: 'center' },
  radarRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  radarCore: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  radarTitle: { color: colors.navy, fontWeight: '800', fontSize: 15, marginTop: 12 },
  radarText: { color: colors.muted, fontSize: 11, marginTop: 6 },
  list: { gap: 10 },
  sectionLabel: {
    color: colors.accent,
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: '800',
    marginBottom: 2,
  },
  serverCard: {
    minHeight: 100,
    padding: 15,
    borderRadius: 17,
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
  serverName: { color: colors.navy, fontWeight: '800', fontSize: 15 },
  serverUrl: { color: colors.muted, fontSize: 10, marginTop: 4 },
  serverStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  serverStatusText: { color: colors.green, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  dotAmber: { backgroundColor: colors.amber },
  manualCard: {
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#EEEAE3',
  },
  manualTitle: { color: colors.navy, fontWeight: '800', fontSize: 14 },
  manualText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  manualRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  manualInput: {
    flex: 1,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.navy,
    backgroundColor: '#fff',
    fontSize: 12,
  },
  manualButton: {
    width: 46,
    height: 46,
    borderRadius: 11,
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
  errorBoxText: { color: colors.red, flex: 1, fontSize: 11 },
  loginScreen: { flex: 1, paddingHorizontal: 20 },
  loginBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 45 },
  loginServerLogo: {
    width: 60,
    height: 60,
    borderRadius: 19,
    marginBottom: 20,
  },
  loginTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 31, marginTop: 2 },
  loginUrl: { color: colors.muted, fontSize: 11, marginTop: 7 },
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
  userInitials: { color: colors.blue, fontWeight: '800', fontSize: 13 },
  userInitialsActive: { color: '#fff' },
  userName: { color: colors.navy, fontWeight: '800', fontSize: 15 },
  userIdentifier: { color: colors.muted, fontSize: 12, marginTop: 3 },
  label: { color: colors.navy, fontSize: 11, fontWeight: '800', marginBottom: 7 },
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
  formError: { color: colors.red, fontSize: 11, marginBottom: 12 },
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
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  localNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20 },
  localNoticeText: { color: colors.muted, fontSize: 10 },
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
  previewBannerText: { color: colors.blue, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  dashboardHello: { color: colors.muted, fontSize: 12 },
  dashboardHome: { color: colors.navy, fontFamily: 'Georgia', fontSize: 24, marginTop: 3 },
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
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    backgroundColor: colors.red,
  },
  offlineBannerText: { color: '#fff', fontSize: 11, fontWeight: '700' },
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
  statusLabel: { color: colors.accent, fontSize: 9, letterSpacing: 1.4, fontWeight: '800' },
  statusTitle: {
    color: colors.navy,
    textAlign: 'center',
    fontFamily: 'Georgia',
    fontSize: 25,
    marginTop: 8,
  },
  statusDetail: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
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
  metricLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  metricValue: { color: colors.navy, fontSize: 15, fontWeight: '800', marginTop: 7 },
  metricDetail: { color: colors.muted, fontSize: 9, marginTop: 4 },
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
  sectionTitle: { color: colors.navy, fontSize: 18, fontWeight: '800', marginTop: 4 },
  alertCount: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7EBEE',
  },
  alertCountActive: { backgroundColor: '#F7E4CF' },
  alertCountText: { color: colors.navy, fontSize: 11, fontWeight: '800' },
  alertRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  alertLine: { width: 3, height: 42, borderRadius: 2, backgroundColor: colors.amber },
  alertTitle: { color: colors.navy, fontWeight: '800', fontSize: 12 },
  alertText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  emptyAlerts: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  emptyAlertsText: { color: colors.muted, flex: 1, fontSize: 11 },
  emptyText: { color: colors.muted, fontSize: 11 },
  dashboardFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    marginTop: 21,
  },
  dashboardFooterText: { color: colors.muted, fontSize: 9 },
});
