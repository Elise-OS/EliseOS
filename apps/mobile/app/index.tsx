import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Animated,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Linking,
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
import { mobileApi, type AlertItem, type Overview } from '../src/api';
import { ServerRegistry } from '../src/discovery/registry';
import { discoveryService } from '../src/discovery/service';
import type { DiscoveredServer, SavedServer } from '../src/discovery/types';
import { DashboardApp } from '../src/dashboard/DashboardApp';
import { registerPushNotifications } from '../src/notifications';

type Stage = 'boot' | 'welcome' | 'discovery' | 'login' | 'dashboard';

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
    port: Number(parsed.port || 80),
    lastSeenAt: server.lastConnectedAt,
  };
};

export default function HomeScreen() {
  const [stage, setStage] = useState<Stage>('boot');
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [knownServers, setKnownServers] = useState<SavedServer[]>([]);
  const [server, setServer] = useState<SavedServer | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
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

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      const last = await ServerRegistry.last();
      if (!mounted) return;
      if (!last) {
        setStage('welcome');
        return;
      }
      setServer(last);
      const savedToken = await ServerRegistry.token(last.id);
      if (!mounted) return;
      if (!savedToken) {
        setStage('login');
        return;
      }
      try {
        const user = await mobileApi.me(last, savedToken);
        if (!mounted) return;
        setToken(savedToken);
        setUserName(user.displayName);
        setStage('dashboard');
      } catch {
        await ServerRegistry.clearToken(last.id);
        if (mounted) setStage('login');
      }
    };
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

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
      live: servers,
      remembered: knownServers.filter((item) => !discoveredIds.has(item.instanceId)),
    };
  }, [knownServers, servers]);

  const chooseServer = async (candidate: DiscoveredServer) => {
    setError('');
    if (candidate.setupRequired) {
      await Linking.openURL(candidate.url);
      return;
    }
    const saved = await ServerRegistry.save(candidate);
    setServer(saved);
    setEmail('');
    setPassword('');
    setStage('login');
  };

  const connectManual = async () => {
    setBusy(true);
    setError('');
    try {
      await chooseServer(await discoveryService.manual(manualUrl));
    } catch {
      setError('Adresse introuvable. Vérifiez qu’Élise est allumée et sur le même Wi-Fi.');
    } finally {
      setBusy(false);
    }
  };

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
      setStage('dashboard');
    } catch {
      setError('Identifiants incorrects ou Élise indisponible.');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (server && token) await mobileApi.logout(server, token).catch(() => undefined);
    if (server) await ServerRegistry.clearToken(server.id);
    setToken(null);
    setOverview(null);
    setAlerts([]);
    setStage('welcome');
  };

  if (stage === 'boot') {
    return (
      <View style={styles.boot}>
        <View style={styles.logo}>
          <Ionicons name="home-outline" size={28} color="#fff" />
        </View>
        <Text style={styles.brand}>Élise</Text>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (stage === 'welcome') {
    return (
      <SafeAreaView style={styles.welcome}>
        <View style={styles.welcomeHalo} />
        <View style={styles.welcomeBrand}>
          <View style={styles.miniLogo}>
            <Ionicons name="home-outline" size={20} color="#fff" />
          </View>
          <Text style={styles.welcomeBrandText}>Élise</Text>
        </View>
        <View style={styles.welcomeBody}>
          <View style={styles.welcomeIcon}>
            <Ionicons name="shield-checkmark-outline" size={35} color="#fff" />
          </View>
          <Text style={styles.eyebrowLight}>VOTRE MAISON, EN TOUTE SÉRÉNITÉ</Text>
          <Text style={styles.welcomeTitle}>Élise veille.{`\n`}Vous restez proche.</Text>
          <Text style={styles.welcomeText}>
            Connectez-vous à votre Élise sur le réseau local pour retrouver l’essentiel, où que vous
            soyez dans la maison.
          </Text>
        </View>
        <View>
          <Pressable style={styles.primaryLight} onPress={() => setStage('discovery')}>
            <Text style={styles.primaryLightText}>Rechercher mon Élise</Text>
            <Ionicons name="arrow-forward" size={19} color={colors.navy} />
          </Pressable>
          <Text style={styles.welcomePrivacy}>Aucune caméra · Aucune écoute · 100 % local</Text>
        </View>
      </SafeAreaView>
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
            name={remembered ? 'time-outline' : 'home-outline'}
            size={22}
            color={colors.blue}
          />
        </View>
        <View style={styles.serverCopy}>
          <Text style={styles.serverName}>{candidate.instanceName}</Text>
          <Text style={styles.serverUrl} numberOfLines={1}>
            {candidate.url}
          </Text>
          <View style={styles.serverStatus}>
            <View style={[styles.dot, candidate.setupRequired && styles.dotAmber]} />
            <Text style={styles.serverStatusText}>
              {candidate.setupRequired
                ? 'À CONFIGURER SUR LE WEB'
                : remembered
                  ? 'CONNEXION RÉCENTE'
                  : 'PRÊT À SE CONNECTER'}
            </Text>
          </View>
        </View>
        <Ionicons
          name={candidate.setupRequired ? 'open-outline' : 'chevron-forward'}
          size={20}
          color={colors.muted}
        />
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
            <Text style={styles.pageEyebrow}>RÉSEAU LOCAL</Text>
            <Text style={styles.pageTitle}>
              {servers.length ? 'Votre Élise est là.' : 'Recherche en cours…'}
            </Text>
            <Text style={styles.pageText}>
              Vérifiez que votre téléphone et le Raspberry Pi utilisent le même réseau Wi-Fi.
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
              <Text style={styles.radarTitle}>Scan mDNS actif</Text>
              <Text style={styles.radarText}>
                Recherche de _michel._tcp et vérification du réseau local
              </Text>
            </View>
          )}
          {visibleServers.live.length > 0 && (
            <View style={styles.list}>
              <Text style={styles.sectionLabel}>DÉTECTÉ MAINTENANT</Text>
              {visibleServers.live.map((item) => renderServer(item))}
            </View>
          )}
          {visibleServers.remembered.length > 0 && (
            <View style={styles.list}>
              <Text style={styles.sectionLabel}>CONNEXIONS RÉCENTES</Text>
              {visibleServers.remembered.map((item) => renderServer(asDiscovered(item), true))}
            </View>
          )}
          <View style={styles.manualCard}>
            <Text style={styles.manualTitle}>Connexion manuelle</Text>
            <Text style={styles.manualText}>
              Si Élise n’apparaît pas, saisissez son adresse locale.
            </Text>
            <View style={styles.manualRow}>
              <TextInput
                style={styles.manualInput}
                value={manualUrl}
                onChangeText={setManualUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.50:8080"
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
            <View style={styles.iconButton} />
          </View>
          <View style={styles.loginBody}>
            <View style={styles.loginServerIcon}>
              <Ionicons name="home-outline" size={28} color="#fff" />
            </View>
            <Text style={styles.pageEyebrow}>SERVEUR SÉLECTIONNÉ</Text>
            <Text style={styles.loginTitle}>{server.instanceName}</Text>
            <Text style={styles.loginUrl}>{server.url}</Text>
            <View style={styles.form}>
              <Text style={styles.label}>Identifiant</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
              />
              <Text style={styles.label}>Mot de passe</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
              />
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
                    <Text style={styles.primaryText}>Se connecter</Text>
                    <Ionicons name="arrow-forward" size={19} color="#fff" />
                  </>
                )}
              </Pressable>
            </View>
            <View style={styles.localNotice}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.green} />
              <Text style={styles.localNoticeText}>Connexion directe à votre serveur local</Text>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  if (stage === 'dashboard' && server && token) {
    return <DashboardApp server={server} token={token} userName={userName} onLogout={logout} />;
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
    gap: 13,
    backgroundColor: colors.cream,
  },
  logo: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
    shadowColor: colors.navy,
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
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
  brand: { fontFamily: 'Georgia', fontSize: 27, color: colors.navy, fontWeight: '600' },
  welcome: {
    flex: 1,
    paddingHorizontal: 26,
    paddingBottom: 18,
    overflow: 'hidden',
    justifyContent: 'space-between',
    backgroundColor: colors.navy,
  },
  welcomeHalo: {
    position: 'absolute',
    width: 470,
    height: 470,
    borderRadius: 235,
    top: -280,
    right: -210,
    backgroundColor: '#3C7090',
    opacity: 0.5,
  },
  welcomeBrand: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 10 },
  welcomeBrandText: { color: '#fff', fontFamily: 'Georgia', fontSize: 20, fontWeight: '600' },
  welcomeBody: { alignItems: 'center' },
  welcomeIcon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
    backgroundColor: 'rgba(255,255,255,.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.18)',
  },
  eyebrowLight: {
    color: '#9CB8C9',
    fontSize: 10,
    letterSpacing: 1.7,
    fontWeight: '800',
    marginBottom: 12,
  },
  welcomeTitle: {
    color: '#fff',
    textAlign: 'center',
    fontFamily: 'Georgia',
    fontSize: 38,
    lineHeight: 45,
  },
  welcomeText: {
    color: '#C4D1DA',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 18,
    maxWidth: 340,
  },
  primaryLight: {
    minHeight: 54,
    paddingHorizontal: 20,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.paper,
  },
  primaryLightText: { color: colors.navy, fontSize: 13, fontWeight: '800' },
  welcomePrivacy: { color: '#91A5B3', fontSize: 10, textAlign: 'center', marginTop: 16 },
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
  loginServerIcon: {
    width: 60,
    height: 60,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    backgroundColor: colors.blue,
  },
  loginTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 31, marginTop: 2 },
  loginUrl: { color: colors.muted, fontSize: 11, marginTop: 7 },
  form: { width: '100%', marginTop: 32 },
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
