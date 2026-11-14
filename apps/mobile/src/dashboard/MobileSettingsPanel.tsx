import { Ionicons } from '@expo/vector-icons';
import type {
  AlertRuleSettings,
  MembershipRole,
  RemoteAccessStatus,
  ScreenSnapshot,
} from '@elise/contracts';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking as NativeLinking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileApi, type SimulationScenario } from '../api';
import type { NotificationPreferences } from '@elise/contracts';
import { registerPushNotifications, type PushRegistrationStatus } from '../notifications';
import type { SavedServer } from '../discovery/types';
import { isDemoServer } from '../demo/mock-api';
import { activeServerUrl } from '../discovery/helpers';
import { MobilePartnerRibbon } from './MobilePartnerRibbon';
import { MobileWeatherCard } from './MobileWeatherCard';
import { MobileZigbeeKeyPanel } from './MobileZigbeeKeyPanel';
import { MobileBoxHealthPanel, type BoxHealthPlace } from './MobileBoxHealthPanel';
import { canManageBox } from './box-health-view';
import { dateLocale, type Language, t } from '../i18n';
import { LanguageList } from '../i18n/LanguagePicker';
import { useTabBarPadding } from './tabBarSpace';

type SettingsSection =
  'general' | 'zigbee' | 'health' | 'rules' | 'notifications' | 'about' | 'legal';
type Locale = Language;

const c = {
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
};

function defaultRules(): AlertRuleSettings {
  return {
    inactivity: { enabled: true, minutes: 180 },
    doorOpen: { enabled: true, minutes: 5 },
    lowTemperature: { enabled: true, celsius: 17, minutes: 15 },
    highTemperature: { enabled: true, celsius: 30, minutes: 15 },
    nightActivity: { enabled: true, startMinute: 22 * 60, endMinute: 6 * 60, minimumEvents: 3 },
    sensorOffline: { enabled: true, minutes: 120 },
    lowBattery: { enabled: true, percent: 15 },
    behavioral: { enabled: false },
  };
}

const HEALTH_PLACES: BoxHealthPlace[] = ['zigbee', 'sensors', 'remote-access'];

const timeText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const timeMinute = (value: string) => {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
};

export function MobileSettingsPanel({
  server,
  token,
  role,
  locale,
  initialSection,
  screen,
  onLocaleChange,
  onScreenUpdated,
  onOpenPage,
  onLogout,
}: {
  server: SavedServer;
  token: string;
  role: MembershipRole;
  locale: Locale;
  initialSection: SettingsSection;
  screen?: ScreenSnapshot;
  onLocaleChange: (locale: Locale) => void;
  onScreenUpdated: () => void;
  onOpenPage: (
    page: 'home' | 'activity' | 'alerts' | 'house' | 'journal' | 'screen' | 'people' | 'settings',
  ) => void;
  onLogout: () => void;
}) {
  const tabBarPadding = useTabBarPadding(28);
  const demoMode = isDemoServer(server);
  const appVersion = Constants.expoConfig?.version ?? '—';
  const privacyPolicyUrl = t('mobileSettingsPanel.privacyPolicyUrl');
  const canManage = canManageBox(role);
  const activeUrl = activeServerUrl(server);
  const localGateway = (() => {
    try {
      return new URL(activeUrl).protocol === 'http:';
    } catch {
      return false;
    }
  })();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [rules, setRules] = useState<AlertRuleSettings | null>(null);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesNotice, setRulesNotice] = useState('');
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteNotice, setRemoteNotice] = useState('');
  const [pingBusy, setPingBusy] = useState(false);
  const [remoteExpanded, setRemoteExpanded] = useState(false);
  const [generalExpanded, setGeneralExpanded] = useState(false);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [simulationNotice, setSimulationNotice] = useState('');
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [notificationPreferencesLoading, setNotificationPreferencesLoading] = useState(true);
  const [notificationPreferencesError, setNotificationPreferencesError] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState('');
  const [pushStatus, setPushStatus] = useState<PushRegistrationStatus | null>(null);
  const [healthRefreshSignal, setHealthRefreshSignal] = useState(0);
  const [healthRefreshing, setHealthRefreshing] = useState(false);

  const sectionTitle =
    section === 'zigbee'
      ? t('zigbeeKey.tab')
      : section === 'health'
        ? t('boxHealth.title')
        : section === 'notifications'
          ? 'Notifications'
          : section === 'about'
            ? t('mobileSettingsPanel.about')
            : section === 'legal'
              ? t('mobileSettingsPanel.legalInformation')
              : t('mobileSettingsPanel.settings');
  const sectionSubtitle =
    section === 'zigbee'
      ? t('zigbeeKey.intro')
      : section === 'health'
        ? t('boxHealth.intro')
        : section === 'notifications'
          ? t('mobileSettingsPanel.chooseWhichPushNotificationsYou')
          : section === 'about'
            ? t('mobileSettingsPanel.learnMoreAboutEliseAnd')
            : section === 'legal'
              ? t('mobileSettingsPanel.projectPublisherSoftwareLicenceAnd')
              : t('mobileSettingsPanel.adaptEliseToYourDaily');

  useEffect(() => setSection(initialSection), [initialSection]);

  const loadNotificationPreferences = useCallback(async () => {
    setNotificationPreferencesLoading(true);
    setNotificationPreferencesError(false);
    try {
      setNotificationPreferences(await mobileApi.notificationPreferences(server, token));
    } catch {
      setNotificationPreferencesError(true);
    } finally {
      setNotificationPreferencesLoading(false);
    }
  }, [server, token]);

  useEffect(() => {
    void loadNotificationPreferences();
  }, [loadNotificationPreferences]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void Promise.all([
      mobileApi.alertRules(server, token).catch(() => defaultRules()),
      mobileApi.simulationScenarios(server, token).catch(() => []),
      mobileApi.remoteAccessStatus(server, token).catch(() => null),
    ]).then(([nextRules, nextScenarios, nextRemote]) => {
      if (!active) return;
      setRules(nextRules);
      setScenarios(nextScenarios);
      setRemoteStatus(nextRemote);
    });
    return () => {
      active = false;
    };
  }, [canManage, server.id, token]);

  const refreshRemote = async () => {
    try {
      setRemoteStatus(await mobileApi.remoteAccessStatus(server, token));
    } catch {
      setRemoteNotice(t('mobileSettingsPanel.privateAccessIsUnavailable'));
    }
  };
  const runRemoteAction = async (action: 'connect' | 'enable' | 'disable') => {
    setRemoteBusy(true);
    setRemoteNotice('');
    try {
      setRemoteStatus(await mobileApi.remoteAccessAction(server, token, action));
    } catch (error) {
      setRemoteNotice(
        error instanceof Error ? error.message : t('mobileSettingsPanel.actionFailed'),
      );
    } finally {
      setRemoteBusy(false);
    }
  };
  const pingRemote = async () => {
    const remoteUrl = remoteStatus?.remoteUrl;
    if (!remoteUrl || pingBusy) return;

    if (demoMode) {
      setRemoteNotice(t('mobileSettingsPanel.simulatedConnectionEliseIsResponding'));
      return;
    }

    setPingBusy(true);
    setRemoteNotice('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const healthUrl = new URL('/api/v1/system/health', remoteUrl).toString();
      const response = await fetch(healthUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('health-check-failed');
      const health = (await response.json()) as { status?: string };
      if (health.status !== 'ok') throw new Error('health-check-failed');
      setRemoteNotice(t('mobileSettingsPanel.connectionTestedEliseIsResponding'));
    } catch {
      setRemoteNotice(t('mobileSettingsPanel.noResponseCheckTailscaleAnd'));
    } finally {
      clearTimeout(timeout);
      setPingBusy(false);
    }
  };
  useEffect(() => {
    if (!remoteStatus || !['AUTHORIZING', 'CONFIGURING'].includes(remoteStatus.state)) return;
    const timer = setInterval(() => void refreshRemote(), 2500);
    return () => clearInterval(timer);
  }, [remoteStatus?.state, server.id, token]);

  const saveRules = async () => {
    if (!rules) return;
    setRulesBusy(true);
    setRulesNotice('');
    try {
      setRules(await mobileApi.saveAlertRules(server, token, rules));
      setRulesNotice(t('mobileSettingsPanel.theAlertRulesWereSaved'));
    } catch {
      setRulesNotice(t('mobileSettingsPanel.theAlertRulesCouldNot'));
    } finally {
      setRulesBusy(false);
    }
  };
  const updateNotificationPreference = async (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => {
    if (!notificationPreferences || notificationBusy) return;
    const previous = notificationPreferences;
    const next = { ...previous, [key]: value };
    setNotificationPreferences(next);
    setNotificationBusy(true);
    setNotificationNotice('');
    try {
      setNotificationPreferences(await mobileApi.saveNotificationPreferences(server, token, next));
      setNotificationNotice(t('mobileSettingsPanel.preferenceSaved'));
    } catch {
      setNotificationPreferences(previous);
      setNotificationNotice(t('mobileSettingsPanel.thePreferenceCouldNotBe'));
    } finally {
      setNotificationBusy(false);
    }
  };
  const enablePushOnDevice = async () => {
    setPushBusy(true);
    setPushStatus(null);
    setPushNotice('');
    try {
      const status = await registerPushNotifications(server, token);
      setPushStatus(status);
      if (status === 'registered') {
        setPushNotice(t('mobileSettingsPanel.thisDeviceCanReceiveThe'));
      } else if (status === 'permission-denied') {
        setPushNotice(t('mobileSettingsPanel.allowEliseNotificationsInYour'));
      } else if (status === 'project-id-missing') {
        setPushNotice(t('mobileSettingsPanel.pushNotificationsAreNotAvailable'));
      } else {
        setPushNotice(t('mobileSettingsPanel.pushNotificationsRequireAPhone'));
      }
    } catch {
      setPushNotice(t('mobileSettingsPanel.thisDeviceCouldNotBe'));
    } finally {
      setPushBusy(false);
    }
  };
  const runScenario = async (scenario: SimulationScenario) => {
    setRunningScenario(scenario.id);
    setSimulationNotice('');
    try {
      const runId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await mobileApi.runSimulation(server, token, scenario.id, runId);
      setSimulationNotice(
        result.accepted > 0
          ? t('mobileSettingsPanel.eventSAddedToThe', { accepted: result.accepted })
          : t('mobileSettingsPanel.thisScenarioHadAlreadyBeen'),
      );
    } catch {
      setSimulationNotice(t('mobileSettingsPanel.theSituationCouldNotBe'));
    } finally {
      setRunningScenario(null);
    }
  };

  // Box health buttons lead to the nearest place of the app: the Zigbee key, the home and its
  // sensors, or the private access card of the general settings.
  const openHealthPlace = (place: BoxHealthPlace) => {
    if (place === 'zigbee') setSection('zigbee');
    else if (place === 'sensors') onOpenPage('house');
    else {
      setRemoteExpanded(true);
      setSection('general');
    }
  };

  return (
    <>
      <ScrollView
        key={section}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, tabBarPadding]}
        refreshControl={
          section === 'health' && canManage ? (
            <RefreshControl
              refreshing={healthRefreshing}
              onRefresh={() => setHealthRefreshSignal((signal) => signal + 1)}
              tintColor={c.blue}
              colors={[c.blue]}
            />
          ) : undefined
        }
      >
        <View style={s.hero}>
          <View style={s.heroHeadingRow}>
            <View style={s.heroHeadingCopy}>
              <Text style={s.heroEyebrow}>ÉLISE OS</Text>
              <Text style={s.heroTitle}>{sectionTitle}</Text>
            </View>
          </View>
          <Text style={s.heroSubtitle}>{sectionSubtitle}</Text>
        </View>
        {section === 'general' ? (
          <>
            <View style={s.settingsDisclosure}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: generalExpanded }}
                style={s.settingsDisclosureHeader}
                onPress={() => setGeneralExpanded((expanded) => !expanded)}
              >
                <View style={s.cardIcon}>
                  <Ionicons name="settings-outline" size={19} color={c.blue} />
                </View>
                <View style={s.flex}>
                  <Text style={s.eyebrow}>{t('mobileSettingsPanel.applicationPreferences')}</Text>
                  <Text style={s.cardTitle}>{t('mobileSettingsPanel.general')}</Text>
                </View>
                <Ionicons
                  name={generalExpanded ? 'chevron-down' : 'chevron-forward'}
                  size={19}
                  color={c.muted}
                />
              </Pressable>
              {generalExpanded ? (
                <View style={s.settingsDisclosureBody}>
                  <View style={s.languageSetting}>
                    <Text style={s.cardTitle}>{t('mobileSettingsPanel.interfaceLanguage')}</Text>
                    <Text style={s.body}>
                      {t('mobileSettingsPanel.chooseTheLanguageEliseUses')}
                    </Text>
                    <LanguageList
                      value={locale}
                      onChange={onLocaleChange}
                      label={t('mobileSettingsPanel.interfaceLanguage')}
                    />
                  </View>
                  <MobileWeatherCard
                    server={server}
                    token={token}
                    locale={locale}
                    snapshot={screen}
                    onChanged={onScreenUpdated}
                  />
                </View>
              ) : null}
            </View>
            {canManage ? (
              <Pressable
                accessibilityRole="button"
                style={s.settingsNavRow}
                onPress={() => setSection('zigbee')}
              >
                <View style={[s.cardIcon, s.homeLandmarksIcon]}>
                  <Ionicons name="key-outline" size={19} color={c.accent} />
                </View>
                <View style={s.flex}>
                  <Text style={s.eyebrow}>{t('zigbeeKey.eyebrow')}</Text>
                  <Text style={s.cardTitle}>{t('zigbeeKey.tab')}</Text>
                  <Text style={s.body}>{t('zigbeeKey.intro')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={c.muted} />
              </Pressable>
            ) : null}
            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('boxHealth.settingsRow.title')}
                accessibilityHint={t('boxHealth.settingsRow.body')}
                style={s.settingsNavRow}
                onPress={() => setSection('health')}
              >
                <View style={[s.cardIcon, s.healthSettingsIcon]}>
                  <Ionicons name="pulse-outline" size={19} color={c.green} />
                </View>
                <View style={s.flex}>
                  <Text style={s.eyebrow}>{t('boxHealth.settingsRow.eyebrow')}</Text>
                  <Text style={s.cardTitle}>{t('boxHealth.settingsRow.title')}</Text>
                  <Text style={s.body}>{t('boxHealth.settingsRow.body')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={c.muted} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={s.settingsNavRow}
              onPress={() => onOpenPage('people')}
            >
              <View style={[s.cardIcon, s.peopleSettingsIcon]}>
                <Ionicons name="people-outline" size={19} color={c.accent} />
              </View>
              <View style={s.flex}>
                <Text style={s.cardTitle}>{t('mobileSettingsPanel.people')}</Text>
                <Text style={s.body}>{t('mobileSettingsPanel.manageTrustedPeopleAndTheir')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={c.muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={s.settingsNavRow}
              onPress={() => setSection('rules')}
            >
              <View style={[s.cardIcon, s.homeLandmarksIcon]}>
                <Ionicons name="notifications-outline" size={19} color={c.accent} />
              </View>
              <View style={s.flex}>
                <Text style={s.eyebrow}>{t('mobileSettingsPanel.homeLandmarks')}</Text>
                <Text style={s.cardTitle}>{t('mobileSettingsPanel.situationsToFlag')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={c.muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={s.settingsNavRow}
              onPress={() => setSection('notifications')}
            >
              <View style={[s.cardIcon, s.notificationSettingsIcon]}>
                <Ionicons name="phone-portrait-outline" size={19} color={c.accent} />
              </View>
              <View style={s.flex}>
                <Text style={s.eyebrow}>{t('mobileSettingsPanel.accountNotifications')}</Text>
                <Text style={s.cardTitle}>{t('mobileSettingsPanel.pushNotifications')}</Text>
                <Text style={s.body}>{t('mobileSettingsPanel.fallsSmokeWaterLeaksAnd')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={c.muted} />
            </Pressable>
            {canManage ? (
              <Card
                title={t('mobileSettingsPanel.remoteAccess')}
                icon="shield-checkmark-outline"
                collapsible
                expanded={remoteExpanded}
                onToggle={() => setRemoteExpanded((expanded) => !expanded)}
                badge={
                  remoteStatus
                    ? remoteStatus.state === 'READY'
                      ? t('mobileSettingsPanel.activeAndPrivate')
                      : remoteStatus.state === 'SIGNED_OUT'
                        ? t('mobileSettingsPanel.notConnected')
                        : remoteStatus.state === 'UNAVAILABLE'
                          ? t('mobileSettingsPanel.unavailable')
                          : t('mobileSettingsPanel.needsAttention')
                    : t('mobileSettingsPanel.checking')
                }
              >
                <Text style={s.body}>{t('mobileSettingsPanel.useEliseAwayFromHome')}</Text>
                {remoteStatus?.state === 'UNAVAILABLE' ? (
                  <Text style={s.notice}>
                    {t('mobileSettingsPanel.privateAccessIsNotAvailable')}
                  </Text>
                ) : null}
                {remoteStatus?.state === 'SIGNED_OUT' ? (
                  <Text style={s.body}>{t('mobileSettingsPanel.linkEliseToYourFamily')}</Text>
                ) : null}
                {remoteStatus?.state === 'AUTHORIZING' ? (
                  <Text style={s.body}>
                    {t('mobileSettingsPanel.approveTheTailscaleConnectionApproval')}
                  </Text>
                ) : null}
                {remoteStatus?.state === 'CONFIGURING' ? (
                  <Text style={s.body}>{t('mobileSettingsPanel.openThePrivateLinkTo')}</Text>
                ) : null}
                {remoteStatus?.remoteUrl ? (
                  <>
                    <View style={s.linkBox}>
                      <Text style={s.caption}>{t('mobileSettingsPanel.privateAddress')}</Text>
                      <Text selectable style={s.linkText}>
                        {remoteStatus.remoteUrl}
                      </Text>
                    </View>
                    {remoteStatus.keyExpiresAt ? (
                      <Text style={s.caption}>
                        {t('mobileSettingsPanel.keyValidUntil')}{' '}
                        {new Date(remoteStatus.keyExpiresAt).toLocaleDateString(dateLocale())}
                      </Text>
                    ) : null}
                    <Pressable
                      disabled={pingBusy}
                      style={[s.smallButton, pingBusy && s.disabled]}
                      onPress={() => void pingRemote()}
                    >
                      <Text style={s.smallButtonText}>
                        {pingBusy
                          ? t('mobileSettingsPanel.testing')
                          : t('mobileSettingsPanel.testConnection')}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
                {localGateway && remoteStatus?.state === 'SIGNED_OUT' ? (
                  <ActionButton
                    label={t('mobileSettingsPanel.enablePrivateAccess')}
                    disabled={remoteBusy}
                    onPress={() => void runRemoteAction('connect')}
                  />
                ) : null}
                {localGateway && remoteStatus?.state === 'CONFIGURING' ? (
                  <ActionButton
                    label={t('mobileSettingsPanel.finishSetup')}
                    disabled={remoteBusy}
                    onPress={() => void runRemoteAction('enable')}
                  />
                ) : null}
                {localGateway && remoteStatus?.remoteUrl ? (
                  <ActionButton
                    label={t('mobileSettingsPanel.disableEliseAccess')}
                    outline
                    disabled={remoteBusy}
                    onPress={() =>
                      Alert.alert(t('mobileSettingsPanel.disableRemoteAccess'), undefined, [
                        { text: t('mobileSettingsPanel.cancel'), style: 'cancel' },
                        {
                          text: t('mobileSettingsPanel.disable'),
                          style: 'destructive',
                          onPress: () => void runRemoteAction('disable'),
                        },
                      ])
                    }
                  />
                ) : null}
                {remoteStatus?.authUrl ? (
                  <ActionButton
                    label={t('mobileSettingsPanel.openTailscale')}
                    outline
                    onPress={() => void Linking.openURL(remoteStatus.authUrl!)}
                  />
                ) : null}
                {remoteNotice ? <Text style={s.notice}>{remoteNotice}</Text> : null}
                <Text style={s.caption}>{t('mobileSettingsPanel.toInviteSomeoneCreateTheir')}</Text>
              </Card>
            ) : null}

            {scenarios.length ? (
              <Card
                eyebrow={t('mobileSettingsPanel.demoMode')}
                title={t('mobileSettingsPanel.testASituation')}
                icon="pulse-outline"
              >
                <Text style={s.body}>{t('mobileSettingsPanel.theseScenariosFollowTheSame')}</Text>
                {scenarios.map((scenario) => (
                  <Pressable
                    key={scenario.id}
                    style={s.scenario}
                    disabled={Boolean(runningScenario)}
                    onPress={() => void runScenario(scenario)}
                  >
                    <View style={s.flex}>
                      <Text style={s.cardTitle}>{scenario.title}</Text>
                      <Text style={s.body}>{scenario.description}</Text>
                    </View>
                    <Text style={s.smallButtonText}>
                      {runningScenario === scenario.id
                        ? t('mobileSettingsPanel.simulating')
                        : t('mobileSettingsPanel.run')}
                    </Text>
                  </Pressable>
                ))}
                {simulationNotice ? <Text style={s.notice}>{simulationNotice}</Text> : null}
              </Card>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={s.settingsNavRow}
              onPress={() => setSection('about')}
            >
              <View style={s.cardIcon}>
                <Ionicons name="information-circle-outline" size={19} color={c.accent} />
              </View>
              <View style={s.flex}>
                <Text style={s.cardTitle}>{t('mobileSettingsPanel.about')}</Text>
                <Text style={s.body}>{t('mobileSettingsPanel.learnAboutEliseOsAnd')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={c.muted} />
            </Pressable>
          </>
        ) : null}

        {section === 'zigbee' ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.settingsBack}
              onPress={() => setSection('general')}
            >
              <Ionicons name="chevron-back" size={18} color={c.blue} />
              <Text style={s.settingsBackLabel}>{t('mobileSettingsPanel.backToSettings')}</Text>
            </Pressable>
            <MobileZigbeeKeyPanel server={server} token={token} />
          </>
        ) : null}

        {section === 'health' && canManage ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.settingsBack}
              onPress={() => setSection('general')}
            >
              <Ionicons name="chevron-back" size={18} color={c.blue} />
              <Text style={s.settingsBackLabel}>{t('mobileSettingsPanel.backToSettings')}</Text>
            </Pressable>
            <MobileBoxHealthPanel
              server={server}
              token={token}
              refreshSignal={healthRefreshSignal}
              onRefreshingChange={setHealthRefreshing}
              places={HEALTH_PLACES}
              onOpenPlace={openHealthPlace}
            />
          </>
        ) : null}

        {section === 'rules' ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.settingsBack}
              onPress={() => setSection('general')}
            >
              <Ionicons name="chevron-back" size={18} color={c.blue} />
              <Text style={s.settingsBackLabel}>{t('mobileSettingsPanel.backToSettings')}</Text>
            </Pressable>
            {!canManage ? (
              <Card
                eyebrow={t('mobileSettingsPanel.homeLandmarks')}
                title={t('mobileSettingsPanel.situationsToFlag')}
                icon="notifications-outline"
              >
                <Text style={s.notice}>
                  {t('mobileSettingsPanel.onlyAnAdministratorCanChange')}
                </Text>
              </Card>
            ) : !rules ? (
              <Card
                eyebrow={t('mobileSettingsPanel.homeLandmarks')}
                title={t('mobileSettingsPanel.situationsToFlag')}
                icon="notifications-outline"
              >
                <Text style={s.body}>{t('mobileSettingsPanel.loadingAlertRules')}</Text>
              </Card>
            ) : (
              <Card
                eyebrow={t('mobileSettingsPanel.homeLandmarks')}
                title={t('mobileSettingsPanel.situationsToFlag')}
                icon="notifications-outline"
              >
                <Text style={s.body}>
                  {t('mobileSettingsPanel.chooseSimpleThresholdsEliseExplains')}
                </Text>
                <RuleToggle
                  title={t('mobileSettingsPanel.changesFromLearnedRoutines')}
                  detail={t('mobileSettingsPanel.availableAfter14ReliableDays')}
                  value={rules.behavioral.enabled}
                  onChange={(value) => setRules({ ...rules, behavioral: { enabled: value } })}
                />
                <RuleToggle
                  title={t('mobileSettingsPanel.noMovement')}
                  detail={t('mobileSettingsPanel.onlyWhenSensorsAreResponding')}
                  value={rules.inactivity.enabled}
                  onChange={(value) =>
                    setRules({ ...rules, inactivity: { ...rules.inactivity, enabled: value } })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.noMovementDelayMinutes')}
                  value={rules.inactivity.minutes}
                  min={15}
                  max={1440}
                  onChange={(value) =>
                    setRules({ ...rules, inactivity: { ...rules.inactivity, minutes: value } })
                  }
                />
                <RuleToggle
                  title={t('mobileSettingsPanel.doorLeftOpen')}
                  detail={t('mobileSettingsPanel.aBriefOpeningRemainsA')}
                  value={rules.doorOpen.enabled}
                  onChange={(value) =>
                    setRules({ ...rules, doorOpen: { ...rules.doorOpen, enabled: value } })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.doorOpenDurationMinutes')}
                  value={rules.doorOpen.minutes}
                  min={1}
                  max={120}
                  onChange={(value) =>
                    setRules({ ...rules, doorOpen: { ...rules.doorOpen, minutes: value } })
                  }
                />
                <RuleToggle
                  title={t('mobileSettingsPanel.unusualTemperature')}
                  detail={t('mobileSettingsPanel.theThresholdMustPersistBefore')}
                  value={rules.lowTemperature.enabled || rules.highTemperature.enabled}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      lowTemperature: { ...rules.lowTemperature, enabled: value },
                      highTemperature: { ...rules.highTemperature, enabled: value },
                    })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.minimumTemperatureC')}
                  value={rules.lowTemperature.celsius}
                  min={5}
                  max={25}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      lowTemperature: { ...rules.lowTemperature, celsius: value },
                    })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.maximumTemperatureC')}
                  value={rules.highTemperature.celsius}
                  min={20}
                  max={45}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      highTemperature: { ...rules.highTemperature, celsius: value },
                    })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.temperatureDurationMinutes')}
                  value={rules.lowTemperature.minutes}
                  min={1}
                  max={240}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      lowTemperature: { ...rules.lowTemperature, minutes: value },
                      highTemperature: { ...rules.highTemperature, minutes: value },
                    })
                  }
                />
                <RuleToggle
                  title={t('mobileSettingsPanel.repeatedNightActivity')}
                  detail={t('mobileSettingsPanel.severalMovementsNeverASingle')}
                  value={rules.nightActivity.enabled}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      nightActivity: { ...rules.nightActivity, enabled: value },
                    })
                  }
                />
                <View style={s.timeRow}>
                  <Field
                    label={t('mobileSettingsPanel.nightBegins')}
                    value={timeText(rules.nightActivity.startMinute)}
                    onChange={(value) =>
                      setRules({
                        ...rules,
                        nightActivity: { ...rules.nightActivity, startMinute: timeMinute(value) },
                      })
                    }
                  />
                  <Field
                    label={t('mobileSettingsPanel.nightEnds')}
                    value={timeText(rules.nightActivity.endMinute)}
                    onChange={(value) =>
                      setRules({
                        ...rules,
                        nightActivity: { ...rules.nightActivity, endMinute: timeMinute(value) },
                      })
                    }
                  />
                </View>
                <NumberField
                  label={t('mobileSettingsPanel.minimumMovements')}
                  value={rules.nightActivity.minimumEvents}
                  min={2}
                  max={20}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      nightActivity: { ...rules.nightActivity, minimumEvents: value },
                    })
                  }
                />
                <RuleToggle
                  title={t('mobileSettingsPanel.silentSensor')}
                  detail={t('mobileSettingsPanel.avoidsConfusingAFaultWith')}
                  value={rules.sensorOffline.enabled}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      sensorOffline: { ...rules.sensorOffline, enabled: value },
                    })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.silentSensorDelayMinutes')}
                  value={rules.sensorOffline.minutes}
                  min={15}
                  max={10080}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      sensorOffline: { ...rules.sensorOffline, minutes: value },
                    })
                  }
                />
                <RuleToggle
                  title={t('mobileSettingsPanel.lowBattery')}
                  detail={t('mobileSettingsPanel.aCalmReminderToPlan')}
                  value={rules.lowBattery.enabled}
                  onChange={(value) =>
                    setRules({ ...rules, lowBattery: { ...rules.lowBattery, enabled: value } })
                  }
                />
                <NumberField
                  label={t('mobileSettingsPanel.batteryThreshold')}
                  value={rules.lowBattery.percent}
                  min={1}
                  max={50}
                  onChange={(value) =>
                    setRules({ ...rules, lowBattery: { ...rules.lowBattery, percent: value } })
                  }
                />
                {rulesNotice ? <Text style={s.notice}>{rulesNotice}</Text> : null}
                <ActionButton
                  label={
                    rulesBusy
                      ? t('mobileSettingsPanel.saving')
                      : t('mobileSettingsPanel.saveAlertRules')
                  }
                  disabled={rulesBusy}
                  onPress={() => void saveRules()}
                />
              </Card>
            )}
          </>
        ) : null}

        {section === 'notifications' ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.settingsBack}
              onPress={() => setSection('general')}
            >
              <Ionicons name="chevron-back" size={18} color={c.blue} />
              <Text style={s.settingsBackLabel}>{t('mobileSettingsPanel.backToSettings')}</Text>
            </Pressable>
            <Card
              eyebrow={t('mobileSettingsPanel.devicePermission')}
              title={t('mobileSettingsPanel.receivePushNotifications')}
              icon="phone-portrait-outline"
            >
              <Text style={s.body}>{t('mobileSettingsPanel.alertsAndNewJournalEntries')}</Text>
              {demoMode ? (
                <Text style={s.notice}>{t('mobileSettingsPanel.theDemoCannotSendReal')}</Text>
              ) : (
                <>
                  <ActionButton
                    label={
                      pushBusy
                        ? t('mobileSettingsPanel.checking')
                        : t('mobileSettingsPanel.enableOnThisDevice')
                    }
                    disabled={pushBusy}
                    onPress={() => void enablePushOnDevice()}
                  />
                  {pushStatus === 'permission-denied' ? (
                    <ActionButton
                      label={t('mobileSettingsPanel.openPhoneSettings')}
                      outline
                      onPress={() => void NativeLinking.openSettings()}
                    />
                  ) : null}
                </>
              )}
              {pushNotice ? <Text style={s.notice}>{pushNotice}</Text> : null}
              {notificationNotice ? <Text style={s.notice}>{notificationNotice}</Text> : null}
            </Card>
            {notificationPreferencesLoading ? (
              <Card
                title={t('mobileSettingsPanel.notificationPreferences')}
                icon="notifications-outline"
              >
                <Text style={s.body}>{t('mobileSettingsPanel.loading')}</Text>
              </Card>
            ) : notificationPreferencesError || !notificationPreferences ? (
              <Card
                title={t('mobileSettingsPanel.notificationPreferences')}
                icon="notifications-outline"
              >
                <Text style={s.notice}>
                  {t('mobileSettingsPanel.notificationPreferencesCouldNotBe')}
                </Text>
                <ActionButton
                  label={t('mobileSettingsPanel.tryAgain')}
                  onPress={() => void loadNotificationPreferences()}
                />
              </Card>
            ) : (
              <>
                <Card
                  eyebrow={t('mobileSettingsPanel.homeAlerts')}
                  title={t('mobileSettingsPanel.safety')}
                  icon="shield-checkmark-outline"
                >
                  <Text style={s.body}>{t('mobileSettingsPanel.chooseWhichSafetyAlertsTo')}</Text>
                  <RuleToggle
                    title={t('mobileSettingsPanel.fallDetection')}
                    detail={t('mobileSettingsPanel.whenAFallIsDetected')}
                    value={notificationPreferences.fallDetection}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('fallDetection', value)}
                  />
                  <RuleToggle
                    title={t('mobileSettingsPanel.smokeDetection')}
                    detail={t('mobileSettingsPanel.whenASensorDetectsSmoke')}
                    value={notificationPreferences.smoke}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('smoke', value)}
                  />
                  <RuleToggle
                    title={t('mobileSettingsPanel.waterLeak')}
                    detail={t('mobileSettingsPanel.whenAWaterLeakIs')}
                    value={notificationPreferences.waterLeak}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('waterLeak', value)}
                  />
                </Card>
                <Card
                  eyebrow={t('mobileSettingsPanel.liaisonJournal')}
                  title={t('mobileSettingsPanel.newEntries')}
                  icon="book-outline"
                >
                  <Text style={s.body}>{t('mobileSettingsPanel.aNotificationIsSentFor')}</Text>
                  <RuleToggle
                    title={t('mobileSettingsPanel.newMessage')}
                    detail={t('mobileSettingsPanel.messagesAddedToTheLiaison')}
                    value={notificationPreferences.liaisonMessages}
                    disabled={notificationBusy}
                    onChange={(value) =>
                      void updateNotificationPreference('liaisonMessages', value)
                    }
                  />
                  <RuleToggle
                    title={t('mobileSettingsPanel.newMood')}
                    detail={t('mobileSettingsPanel.moodsAddedToTheLiaison')}
                    value={notificationPreferences.liaisonMoods}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('liaisonMoods', value)}
                  />
                </Card>
              </>
            )}
          </>
        ) : null}

        {section === 'about' ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.settingsBack}
              onPress={() => setSection('general')}
            >
              <Ionicons name="chevron-back" size={18} color={c.blue} />
              <Text style={s.settingsBackLabel}>{t('mobileSettingsPanel.backToSettings')}</Text>
            </Pressable>
            <View style={s.aboutActions}>
              <Pressable
                accessibilityRole="button"
                style={s.settingsNavRow}
                onPress={() => void Linking.openURL(privacyPolicyUrl)}
              >
                <View style={s.cardIcon}>
                  <Ionicons name="shield-checkmark-outline" size={19} color={c.accent} />
                </View>
                <View style={s.flex}>
                  <Text style={s.cardTitle}>{t('mobileSettingsPanel.privacyPolicy')}</Text>
                  <Text style={s.body}>{t('mobileSettingsPanel.dataProcessingAndRetention')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={c.muted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={s.settingsNavRow}
                onPress={() => setSection('legal')}
              >
                <View style={s.cardIcon}>
                  <Ionicons name="document-text-outline" size={19} color={c.accent} />
                </View>
                <View style={s.flex}>
                  <Text style={s.cardTitle}>{t('mobileSettingsPanel.legalInformation')}</Text>
                  <Text style={s.body}>
                    {t('mobileSettingsPanel.publisherLicenceAndAppleEula')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={c.muted} />
              </Pressable>
            </View>
            <Card
              eyebrow={t('mobileSettingsPanel.appVersion')}
              title="Élise OS"
              icon="heart-outline"
              badge={`v${appVersion}`}
            >
              <Text style={s.body}>{t('mobileSettingsPanel.eliseBringsTogetherCuesFrom')}</Text>
            </Card>
            <Card
              eyebrow={t('mobileSettingsPanel.privacy')}
              title={t('mobileSettingsPanel.localProcessing')}
              icon="home-outline"
            >
              <Text style={s.body}>{t('mobileSettingsPanel.householdEventsAreProcessedOn')}</Text>
            </Card>
            <Card
              eyebrow={t('mobileSettingsPanel.pleaseNote')}
              title={t('mobileSettingsPanel.inAnEmergencyCall112')}
              icon="information-circle-outline"
            >
              <Text style={s.notice}>{t('mobileSettingsPanel.eliseIsNeitherAMedical')}</Text>
            </Card>
            <MobilePartnerRibbon locale={locale} />
          </>
        ) : null}

        {section === 'legal' ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.settingsBack}
              onPress={() => setSection('about')}
            >
              <Ionicons name="chevron-back" size={18} color={c.blue} />
              <Text style={s.settingsBackLabel}>{t('mobileSettingsPanel.backToAbout')}</Text>
            </Pressable>
            <Card
              eyebrow={t('mobileSettingsPanel.projectPublisher')}
              title="Élise OS"
              icon="person-circle-outline"
            >
              <Text style={s.body}>{t('mobileSettingsPanel.eliseOsIsAnIndependently')}</Text>
              <Text style={s.body}>contact@paulbreton.dev</Text>
              <ActionButton
                label={t('mobileSettingsPanel.contactTheProjectLead')}
                outline
                onPress={() => void Linking.openURL('mailto:contact@paulbreton.dev')}
              />
            </Card>
            <Card
              eyebrow={t('mobileSettingsPanel.softwareLicence')}
              title="AGPL-3.0-only"
              icon="code-slash-outline"
            >
              <Text style={s.body}>{t('mobileSettingsPanel.eliseOsIsOpenSource')}</Text>
            </Card>
            <Card
              eyebrow={t('mobileSettingsPanel.appStoreTerms')}
              title={t('mobileSettingsPanel.appleStandardEula')}
              icon="document-text-outline"
            >
              <Text style={s.body}>{t('mobileSettingsPanel.forAppsDistributedThroughThe')}</Text>
              <ActionButton
                label={t('mobileSettingsPanel.readAppleSStandardEula')}
                outline
                onPress={() =>
                  void Linking.openURL(
                    'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
                  )
                }
              />
            </Card>
            <Text style={s.caption}>© Élise OS · Paul Breton</Text>
          </>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            demoMode ? t('mobileSettingsPanel.exitDemo') : t('mobileSettingsPanel.signOut')
          }
          style={[s.settingsNavRow, s.logoutSettingsRow]}
          onPress={onLogout}
        >
          <View style={[s.cardIcon, s.logoutSettingsIcon]}>
            <Ionicons name="log-out-outline" size={19} color={c.red} />
          </View>
          <View style={s.flex}>
            <Text style={[s.cardTitle, s.logoutSettingsTitle]}>
              {demoMode ? t('mobileSettingsPanel.exitDemo') : t('mobileSettingsPanel.signOut')}
            </Text>
            <Text style={s.body}>{t('mobileSettingsPanel.signOutOnThisDevice')}</Text>
          </View>
        </Pressable>
      </ScrollView>
    </>
  );
}

function Card({
  eyebrow,
  title,
  icon,
  badge,
  collapsible = false,
  expanded = false,
  onToggle,
  children,
}: React.PropsWithChildren<{
  eyebrow?: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  badge?: string;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}>) {
  const headerContent = (
    <>
      <View style={s.cardIcon}>
        <Ionicons name={icon} size={19} color={c.blue} />
      </View>
      <View style={s.flex}>
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      {badge ? <Text style={s.badge}>{badge}</Text> : null}
    </>
  );

  return (
    <View style={s.card}>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={s.cardHeader}
          onPress={onToggle}
        >
          {headerContent}
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={19}
            color={c.muted}
          />
        </Pressable>
      ) : (
        <View style={s.cardHeader}>{headerContent}</View>
      )}
      {!collapsible || expanded ? <View style={s.cardBody}>{children}</View> : null}
    </View>
  );
}
function ActionButton({
  label,
  onPress,
  disabled = false,
  outline = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  outline?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={[s.action, outline && s.actionOutline, disabled && s.disabled]}
      onPress={onPress}
    >
      <Text style={[s.actionLabel, outline && s.actionLabelOutline]}>{label}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  secure = false,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}
function RuleToggle({
  title,
  detail,
  value,
  onChange,
  disabled = false,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.ruleRow}>
      <View style={s.flex}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.body}>{detail}</Text>
      </View>
      <Switch
        disabled={disabled}
        accessibilityLabel={title}
        accessibilityHint={detail}
        value={value}
        onValueChange={onChange}
        style={disabled ? s.disabled : undefined}
        trackColor={{ false: '#C8CFD1', true: c.green }}
        thumbColor="#fff"
      />
    </View>
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(next)));
    setDraft(String(clamped));
    onChange(clamped);
  };
  return (
    <View style={s.numberRow}>
      <Text style={s.body}>{label}</Text>
      <TextInput
        style={s.numberInput}
        value={draft}
        keyboardType="number-pad"
        onChangeText={setDraft}
        onEndEditing={commit}
      />
    </View>
  );
}
const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 12,
    backgroundColor: c.cream,
  },
  hero: { gap: 5 },
  heroHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroHeadingCopy: { minWidth: 0, flex: 1 },
  heroEyebrow: { color: '#376884', fontSize: 12, letterSpacing: 0.6, fontWeight: '900' },
  heroTitle: {
    marginTop: 4,
    color: '#0B2948',
    fontFamily: 'Georgia',
    fontSize: 28,
    flexShrink: 1,
  },
  heroSubtitle: { fontSize: 16, lineHeight: 23, color: '#596779', flexShrink: 1 },
  eyebrow: { color: c.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
  },
  settingsDisclosure: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
  },
  settingsDisclosureHeader: {
    minHeight: 76,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingsDisclosureBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 12,
  },
  languageSetting: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    gap: 8,
  },
  settingsNavRow: {
    minHeight: 76,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.paper,
  },
  logoutSettingsRow: { borderColor: '#E6C7C1' },
  logoutSettingsIcon: { backgroundColor: '#F7E9E6' },
  logoutSettingsTitle: { color: c.red },
  aboutActions: { gap: 9 },
  peopleSettingsIcon: { backgroundColor: c.paleGreen },
  homeLandmarksIcon: { backgroundColor: c.paleAmber },
  notificationSettingsIcon: { backgroundColor: '#E8F0F3' },
  healthSettingsIcon: { backgroundColor: c.paleGreen },
  settingsBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  settingsBackLabel: { color: c.blue, fontSize: 13, fontWeight: '800' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F0F3',
  },
  flex: { flex: 1 },
  cardTitle: { marginTop: 4, color: c.navy, fontSize: 16, fontWeight: '900' },
  badge: {
    maxWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
    borderRadius: 12,
    color: c.green,
    backgroundColor: c.paleGreen,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  cardBody: { marginTop: 14, gap: 11 },
  body: { color: c.muted, fontSize: 13, lineHeight: 21 },
  caption: { color: c.muted, fontSize: 12, lineHeight: 18 },
  notice: {
    padding: 10,
    borderRadius: 10,
    color: '#8D4827',
    backgroundColor: c.paleAmber,
    fontSize: 12,
    lineHeight: 19,
  },
  smallButton: {
    minHeight: 35,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F0F3',
  },
  smallButtonText: { color: c.blue, fontSize: 12, fontWeight: '900' },
  linkBox: { padding: 11, borderRadius: 11, backgroundColor: '#F1EEE8', gap: 4 },
  linkText: { color: c.blue, fontSize: 13, fontWeight: '800' },
  action: {
    minHeight: 43,
    paddingHorizontal: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  actionOutline: { borderWidth: 1, borderColor: c.blue, backgroundColor: c.paper },
  actionLabel: { color: '#fff', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  actionLabelOutline: { color: c.blue },
  disabled: { opacity: 0.45 },
  field: { gap: 5 },
  fieldLabel: { color: c.navy, fontSize: 12, fontWeight: '800' },
  input: {
    minHeight: 42,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    color: c.navy,
    fontSize: 13,
  },
  ruleRow: {
    minHeight: 62,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  numberRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  numberInput: {
    width: 85,
    minHeight: 38,
    paddingHorizontal: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: c.line,
    color: c.navy,
    textAlign: 'center',
    backgroundColor: c.paper,
    fontSize: 14,
  },
  timeRow: { flexDirection: 'row', gap: 10 },
  scenario: {
    minHeight: 60,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
