import { Ionicons } from '@expo/vector-icons';
import type {
  AlertRuleSettings,
  MembershipRole,
  RemoteAccessStatus,
  ScreenSnapshot,
} from '@michel/contracts';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking as NativeLinking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileApi, type SimulationScenario } from '../api';
import type { NotificationPreferences } from '@michel/contracts';
import { registerPushNotifications, type PushRegistrationStatus } from '../notifications';
import type { SavedServer } from '../discovery/types';
import { isDemoServer } from '../demo/mock-api';
import { activeServerUrl } from '../discovery/helpers';
import { MobilePartnerRibbon } from './MobilePartnerRibbon';
import { MobileWeatherCard } from './MobileWeatherCard';

type SettingsSection = 'general' | 'rules' | 'notifications' | 'about' | 'legal';
type Locale = 'fr' | 'en';

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
  const fr = locale === 'fr';
  const demoMode = isDemoServer(server);
  const appVersion = Constants.expoConfig?.version ?? '—';
  const privacyPolicyUrl = fr
    ? 'https://eliseos.paulbreton.dev/politique/'
    : 'https://eliseos.paulbreton.dev/en/privacy/';
  const canManage = role === 'OWNER' || role === 'ADMINISTRATOR';
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

  const sectionTitle =
    section === 'notifications'
      ? 'Notifications'
      : section === 'about'
        ? fr
          ? 'À propos'
          : 'About'
        : section === 'legal'
          ? fr
            ? 'Mentions légales'
            : 'Legal information'
          : fr
            ? 'Réglages'
            : 'Settings';
  const sectionSubtitle =
    section === 'notifications'
      ? fr
        ? 'Choisissez les notifications push que vous souhaitez recevoir.'
        : 'Choose which push notifications you want to receive.'
      : section === 'about'
        ? fr
          ? 'En savoir plus sur Élise et cette application.'
          : 'Learn more about Élise and this app.'
        : section === 'legal'
          ? fr
            ? 'Éditeur du projet, licence et conditions de l’application.'
            : 'Project publisher, software licence, and app terms.'
          : fr
            ? 'Adaptez Élise à votre quotidien et choisissez les situations qui méritent votre attention.'
            : 'Adapt Élise to your daily life and choose which situations deserve your attention.';

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
      setRemoteNotice(
        fr ? 'Le service d’accès privé est indisponible.' : 'Private access is unavailable.',
      );
    }
  };
  const runRemoteAction = async (action: 'connect' | 'enable' | 'disable') => {
    setRemoteBusy(true);
    setRemoteNotice('');
    try {
      setRemoteStatus(await mobileApi.remoteAccessAction(server, token, action));
    } catch (error) {
      setRemoteNotice(
        error instanceof Error ? error.message : fr ? 'Action impossible.' : 'Action failed.',
      );
    } finally {
      setRemoteBusy(false);
    }
  };
  const pingRemote = async () => {
    const remoteUrl = remoteStatus?.remoteUrl;
    if (!remoteUrl || pingBusy) return;

    if (demoMode) {
      setRemoteNotice(
        fr
          ? 'Connexion simulée : Élise répond dans la démonstration.'
          : 'Simulated connection: Élise is responding in the demo.',
      );
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
      setRemoteNotice(
        fr ? 'Connexion testée : Élise répond.' : 'Connection tested: Élise is responding.',
      );
    } catch {
      setRemoteNotice(
        fr
          ? 'Aucune réponse. Vérifiez Tailscale et réessayez.'
          : 'No response. Check Tailscale and try again.',
      );
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
      setRulesNotice(
        fr ? 'Les repères ont été enregistrés localement.' : 'The alert rules were saved locally.',
      );
    } catch {
      setRulesNotice(
        fr ? 'Les repères n’ont pas pu être enregistrés.' : 'The alert rules could not be saved.',
      );
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
      setNotificationNotice(fr ? 'Préférence enregistrée.' : 'Preference saved.');
    } catch {
      setNotificationPreferences(previous);
      setNotificationNotice(
        fr ? 'La préférence n’a pas pu être enregistrée.' : 'The preference could not be saved.',
      );
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
        setPushNotice(
          fr
            ? 'Cet appareil est prêt à recevoir les notifications autorisées ci-dessous.'
            : 'This device can receive the notifications enabled below.',
        );
      } else if (status === 'permission-denied') {
        setPushNotice(
          fr
            ? 'Autorisez les notifications Élise dans les réglages de votre téléphone.'
            : 'Allow Élise notifications in your phone settings.',
        );
      } else if (status === 'project-id-missing') {
        setPushNotice(
          fr
            ? 'Les notifications push ne sont pas disponibles dans cette version de l’application.'
            : 'Push notifications are not available in this app version.',
        );
      } else {
        setPushNotice(
          fr
            ? 'Les notifications push nécessitent un téléphone ou une tablette.'
            : 'Push notifications require a phone or tablet.',
        );
      }
    } catch {
      setPushNotice(
        fr
          ? 'Cet appareil n’a pas pu être inscrit aux notifications. Réessayez.'
          : 'This device could not be registered for notifications. Try again.',
      );
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
          ? `${result.accepted} événement(s) ajouté(s) au journal d’activité.`
          : 'Ce scénario avait déjà été appliqué.',
      );
    } catch {
      setSimulationNotice('La situation n’a pas pu être simulée. Réessayez dans un instant.');
    } finally {
      setRunningScenario(null);
    }
  };

  return (
    <>
      <ScrollView
        key={section}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
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
                  <Text style={s.eyebrow}>
                    {fr ? 'PRÉFÉRENCES DE L’APPLICATION' : 'APPLICATION PREFERENCES'}
                  </Text>
                  <Text style={s.cardTitle}>{fr ? 'Général' : 'General'}</Text>
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
                    <Text style={s.cardTitle}>
                      {fr ? 'Langue de l’interface' : 'Interface language'}
                    </Text>
                    <Text style={s.body}>
                      {fr
                        ? 'Choisissez la langue utilisée par Élise sur cet appareil.'
                        : 'Choose the language Élise uses on this device.'}
                    </Text>
                    <View style={s.languageRow}>
                      <Choice
                        label="Français"
                        active={locale === 'fr'}
                        onPress={() => onLocaleChange('fr')}
                      />
                      <Choice
                        label="English"
                        active={locale === 'en'}
                        onPress={() => onLocaleChange('en')}
                      />
                    </View>
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
            <Pressable
              accessibilityRole="button"
              style={s.settingsNavRow}
              onPress={() => onOpenPage('people')}
            >
              <View style={[s.cardIcon, s.peopleSettingsIcon]}>
                <Ionicons name="people-outline" size={19} color={c.accent} />
              </View>
              <View style={s.flex}>
                <Text style={s.cardTitle}>{fr ? 'Proches' : 'People'}</Text>
                <Text style={s.body}>
                  {fr
                    ? 'Gérez les personnes enregistrées et leurs accès.'
                    : 'Manage trusted people and their access.'}
                </Text>
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
                <Text style={s.eyebrow}>{fr ? 'REPÈRES DU DOMICILE' : 'HOME LANDMARKS'}</Text>
                <Text style={s.cardTitle}>
                  {fr ? 'Situations à signaler' : 'Situations to flag'}
                </Text>
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
                <Text style={s.eyebrow}>
                  {fr ? 'NOTIFICATIONS DU COMPTE' : 'ACCOUNT NOTIFICATIONS'}
                </Text>
                <Text style={s.cardTitle}>{fr ? 'Notifications push' : 'Push notifications'}</Text>
                <Text style={s.body}>
                  {fr
                    ? 'Chutes, fumée, fuite d’eau et carnet de liaison.'
                    : 'Falls, smoke, water leaks, and the liaison journal.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={c.muted} />
            </Pressable>
            {canManage ? (
              <Card
                title={fr ? 'Accès à distance' : 'Remote access'}
                icon="shield-checkmark-outline"
                collapsible
                expanded={remoteExpanded}
                onToggle={() => setRemoteExpanded((expanded) => !expanded)}
                badge={
                  remoteStatus
                    ? remoteStatus.state === 'READY'
                      ? fr
                        ? 'Actif et privé'
                        : 'Active and private'
                      : remoteStatus.state === 'SIGNED_OUT'
                        ? fr
                          ? 'À activer'
                          : 'Not connected'
                        : remoteStatus.state === 'UNAVAILABLE'
                          ? fr
                            ? 'Indisponible'
                            : 'Unavailable'
                          : fr
                            ? 'À vérifier'
                            : 'Needs attention'
                    : fr
                      ? 'Vérification…'
                      : 'Checking…'
                }
              >
                <Text style={s.body}>
                  {fr
                    ? 'Consultez Élise depuis l’extérieur avec Tailscale. Seules les personnes invitées peuvent entrer.'
                    : 'Use Élise away from home with Tailscale. Only invited people can connect.'}
                </Text>
                {remoteStatus?.state === 'UNAVAILABLE' ? (
                  <Text style={s.notice}>
                    {fr
                      ? 'Le service d’accès privé n’est pas disponible sur cet appareil.'
                      : 'Private access is not available on this device.'}
                  </Text>
                ) : null}
                {remoteStatus?.state === 'SIGNED_OUT' ? (
                  <Text style={s.body}>
                    {fr
                      ? 'Reliez Élise à votre famille. La clé Tailscale reste hors de l’image Élise.'
                      : 'Link Élise to your family. The Tailscale key stays out of the Élise image.'}
                  </Text>
                ) : null}
                {remoteStatus?.state === 'AUTHORIZING' ? (
                  <Text style={s.body}>
                    {fr
                      ? 'Validez la connexion Tailscale. La validation sera détectée automatiquement.'
                      : 'Approve the Tailscale connection. Approval will be detected automatically.'}
                  </Text>
                ) : null}
                {remoteStatus?.state === 'CONFIGURING' ? (
                  <Text style={s.body}>
                    {fr
                      ? 'Ouvrez le lien privé pour terminer l’activation.'
                      : 'Open the private link to finish setup.'}
                  </Text>
                ) : null}
                {remoteStatus?.remoteUrl ? (
                  <>
                    <View style={s.linkBox}>
                      <Text style={s.caption}>{fr ? 'Adresse privée' : 'Private address'}</Text>
                      <Text selectable style={s.linkText}>
                        {remoteStatus.remoteUrl}
                      </Text>
                    </View>
                    {remoteStatus.keyExpiresAt ? (
                      <Text style={s.caption}>
                        {fr ? 'Clé valide jusqu’au' : 'Key valid until'}{' '}
                        {new Date(remoteStatus.keyExpiresAt).toLocaleDateString(
                          locale === 'fr' ? 'fr-FR' : 'en-GB',
                        )}
                      </Text>
                    ) : null}
                    <Pressable
                      disabled={pingBusy}
                      style={[s.smallButton, pingBusy && s.disabled]}
                      onPress={() => void pingRemote()}
                    >
                      <Text style={s.smallButtonText}>
                        {pingBusy
                          ? fr
                            ? 'Test en cours…'
                            : 'Testing…'
                          : fr
                            ? 'Tester la connexion'
                            : 'Test connection'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
                {localGateway && remoteStatus?.state === 'SIGNED_OUT' ? (
                  <ActionButton
                    label={fr ? 'Activer l’accès privé' : 'Enable private access'}
                    disabled={remoteBusy}
                    onPress={() => void runRemoteAction('connect')}
                  />
                ) : null}
                {localGateway && remoteStatus?.state === 'CONFIGURING' ? (
                  <ActionButton
                    label={fr ? 'Terminer l’activation' : 'Finish setup'}
                    disabled={remoteBusy}
                    onPress={() => void runRemoteAction('enable')}
                  />
                ) : null}
                {localGateway && remoteStatus?.remoteUrl ? (
                  <ActionButton
                    label={fr ? 'Désactiver l’accès Élise' : 'Disable Élise access'}
                    outline
                    disabled={remoteBusy}
                    onPress={() =>
                      Alert.alert(
                        fr ? 'Désactiver l’accès à distance ?' : 'Disable remote access?',
                        undefined,
                        [
                          { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' },
                          {
                            text: fr ? 'Désactiver' : 'Disable',
                            style: 'destructive',
                            onPress: () => void runRemoteAction('disable'),
                          },
                        ],
                      )
                    }
                  />
                ) : null}
                {remoteStatus?.authUrl ? (
                  <ActionButton
                    label={fr ? 'Ouvrir Tailscale' : 'Open Tailscale'}
                    outline
                    onPress={() => void Linking.openURL(remoteStatus.authUrl!)}
                  />
                ) : null}
                {remoteNotice ? <Text style={s.notice}>{remoteNotice}</Text> : null}
                <Text style={s.caption}>
                  {fr
                    ? 'Pour inviter un proche : créez son compte et son rôle, partagez uniquement la machine Élise dans Tailscale, puis envoyez-lui le lien.'
                    : 'To invite someone: create their account and role, share only the Élise machine in Tailscale, then send the link.'}
                </Text>
              </Card>
            ) : null}

            {scenarios.length ? (
              <Card eyebrow="MODE DÉMONSTRATION" title="Tester une situation" icon="pulse-outline">
                <Text style={s.body}>
                  Ces scénarios utilisent le même parcours que les capteurs du domicile. Ils restent
                  réservés à cette installation de test.
                </Text>
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
                      {runningScenario === scenario.id ? 'Simulation…' : 'Lancer'}
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
                <Text style={s.cardTitle}>{fr ? 'À propos' : 'About'}</Text>
                <Text style={s.body}>
                  {fr
                    ? 'Découvrir Élise OS et sa version.'
                    : 'Learn about Élise OS and its version.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={c.muted} />
            </Pressable>
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
              <Text style={s.settingsBackLabel}>
                {fr ? 'Retour aux réglages' : 'Back to settings'}
              </Text>
            </Pressable>
            {!canManage ? (
              <Card
                eyebrow={fr ? 'REPÈRES DU DOMICILE' : 'HOME LANDMARKS'}
                title={fr ? 'Situations à signaler' : 'Situations to flag'}
                icon="notifications-outline"
              >
                <Text style={s.notice}>
                  {fr
                    ? 'Seul un administrateur peut modifier les règles des alertes.'
                    : 'Only an administrator can change alert rules.'}
                </Text>
              </Card>
            ) : !rules ? (
              <Card
                eyebrow={fr ? 'REPÈRES DU DOMICILE' : 'HOME LANDMARKS'}
                title={fr ? 'Situations à signaler' : 'Situations to flag'}
                icon="notifications-outline"
              >
                <Text style={s.body}>
                  {fr ? 'Chargement des repères…' : 'Loading alert rules…'}
                </Text>
              </Card>
            ) : (
              <Card
                eyebrow={fr ? 'REPÈRES DU DOMICILE' : 'HOME LANDMARKS'}
                title={fr ? 'Situations à signaler' : 'Situations to flag'}
                icon="notifications-outline"
              >
                <Text style={s.body}>
                  {fr
                    ? 'Choisissez des seuils simples. Élise explique toujours ce qu’elle observe avant de proposer une vérification.'
                    : 'Choose simple thresholds. Élise explains what it observes before suggesting a check.'}
                </Text>
                <RuleToggle
                  title={fr ? 'Écarts aux habitudes apprises' : 'Changes from learned routines'}
                  detail={
                    fr
                      ? 'Disponible après 14 jours fiables et deux contrôles espacés.'
                      : 'Available after 14 reliable days and two spaced checks.'
                  }
                  value={rules.behavioral.enabled}
                  onChange={(value) => setRules({ ...rules, behavioral: { enabled: value } })}
                />
                <RuleToggle
                  title={fr ? 'Absence de mouvement' : 'No movement'}
                  detail={
                    fr
                      ? 'Seulement lorsque les capteurs répondent correctement.'
                      : 'Only when sensors are responding correctly.'
                  }
                  value={rules.inactivity.enabled}
                  onChange={(value) =>
                    setRules({ ...rules, inactivity: { ...rules.inactivity, enabled: value } })
                  }
                />
                <NumberField
                  label={fr ? 'Délai sans mouvement (minutes)' : 'No movement delay (minutes)'}
                  value={rules.inactivity.minutes}
                  min={15}
                  max={1440}
                  onChange={(value) =>
                    setRules({ ...rules, inactivity: { ...rules.inactivity, minutes: value } })
                  }
                />
                <RuleToggle
                  title={fr ? 'Porte laissée ouverte' : 'Door left open'}
                  detail={
                    fr
                      ? 'Une ouverture brève reste un événement normal.'
                      : 'A brief opening remains a normal event.'
                  }
                  value={rules.doorOpen.enabled}
                  onChange={(value) =>
                    setRules({ ...rules, doorOpen: { ...rules.doorOpen, enabled: value } })
                  }
                />
                <NumberField
                  label={fr ? 'Durée porte ouverte (minutes)' : 'Door open duration (minutes)'}
                  value={rules.doorOpen.minutes}
                  min={1}
                  max={120}
                  onChange={(value) =>
                    setRules({ ...rules, doorOpen: { ...rules.doorOpen, minutes: value } })
                  }
                />
                <RuleToggle
                  title={fr ? 'Température inhabituelle' : 'Unusual temperature'}
                  detail={
                    fr
                      ? 'Le seuil doit persister avant qu’Élise le signale.'
                      : 'The threshold must persist before Élise flags it.'
                  }
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
                  label={fr ? 'Température minimale (°C)' : 'Minimum temperature (°C)'}
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
                  label={fr ? 'Température maximale (°C)' : 'Maximum temperature (°C)'}
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
                  label={
                    fr ? 'Persistance température (minutes)' : 'Temperature duration (minutes)'
                  }
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
                  title={fr ? 'Activité nocturne répétée' : 'Repeated night activity'}
                  detail={
                    fr
                      ? 'Plusieurs mouvements, jamais un passage isolé.'
                      : 'Several movements, never a single pass.'
                  }
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
                    label={fr ? 'Début de la nuit' : 'Night begins'}
                    value={timeText(rules.nightActivity.startMinute)}
                    onChange={(value) =>
                      setRules({
                        ...rules,
                        nightActivity: { ...rules.nightActivity, startMinute: timeMinute(value) },
                      })
                    }
                  />
                  <Field
                    label={fr ? 'Fin de la nuit' : 'Night ends'}
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
                  label={fr ? 'Mouvements minimum' : 'Minimum movements'}
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
                  title={fr ? 'Capteur silencieux' : 'Silent sensor'}
                  detail={
                    fr
                      ? 'Évite de confondre une panne avec une absence d’activité.'
                      : 'Avoids confusing a fault with no activity.'
                  }
                  value={rules.sensorOffline.enabled}
                  onChange={(value) =>
                    setRules({
                      ...rules,
                      sensorOffline: { ...rules.sensorOffline, enabled: value },
                    })
                  }
                />
                <NumberField
                  label={
                    fr ? 'Délai capteur silencieux (minutes)' : 'Silent sensor delay (minutes)'
                  }
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
                  title={fr ? 'Batterie faible' : 'Low battery'}
                  detail={
                    fr
                      ? 'Une information calme pour anticiper le remplacement.'
                      : 'A calm reminder to plan a battery replacement.'
                  }
                  value={rules.lowBattery.enabled}
                  onChange={(value) =>
                    setRules({ ...rules, lowBattery: { ...rules.lowBattery, enabled: value } })
                  }
                />
                <NumberField
                  label={fr ? 'Seuil de batterie (%)' : 'Battery threshold (%)'}
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
                      ? fr
                        ? 'Enregistrement…'
                        : 'Saving…'
                      : fr
                        ? 'Enregistrer les repères'
                        : 'Save alert rules'
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
              <Text style={s.settingsBackLabel}>
                {fr ? 'Retour aux réglages' : 'Back to settings'}
              </Text>
            </Pressable>
            <Card
              eyebrow={fr ? 'AUTORISATION DE L’APPAREIL' : 'DEVICE PERMISSION'}
              title={fr ? 'Recevoir les notifications push' : 'Receive push notifications'}
              icon="phone-portrait-outline"
            >
              <Text style={s.body}>
                {fr
                  ? 'Les alertes et les nouveaux éléments du carnet sont envoyés à l’application. Les notifications doivent aussi être autorisées dans les réglages du téléphone.'
                  : 'Alerts and new journal entries are sent to the app. Notifications must also be allowed in your phone settings.'}
              </Text>
              {demoMode ? (
                <Text style={s.notice}>
                  {fr
                    ? 'La démonstration ne peut pas envoyer de véritables notifications push.'
                    : 'The demo cannot send real push notifications.'}
                </Text>
              ) : (
                <>
                  <ActionButton
                    label={
                      pushBusy
                        ? fr
                          ? 'Vérification…'
                          : 'Checking…'
                        : fr
                          ? 'Activer sur cet appareil'
                          : 'Enable on this device'
                    }
                    disabled={pushBusy}
                    onPress={() => void enablePushOnDevice()}
                  />
                  {pushStatus === 'permission-denied' ? (
                    <ActionButton
                      label={fr ? 'Ouvrir les réglages du téléphone' : 'Open phone settings'}
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
                title={fr ? 'Préférences de notification' : 'Notification preferences'}
                icon="notifications-outline"
              >
                <Text style={s.body}>{fr ? 'Chargement…' : 'Loading…'}</Text>
              </Card>
            ) : notificationPreferencesError || !notificationPreferences ? (
              <Card
                title={fr ? 'Préférences de notification' : 'Notification preferences'}
                icon="notifications-outline"
              >
                <Text style={s.notice}>
                  {fr
                    ? 'Les préférences n’ont pas pu être chargées.'
                    : 'Notification preferences could not be loaded.'}
                </Text>
                <ActionButton
                  label={fr ? 'Réessayer' : 'Try again'}
                  onPress={() => void loadNotificationPreferences()}
                />
              </Card>
            ) : (
              <>
                <Card
                  eyebrow={fr ? 'ALERTES DU LOGEMENT' : 'HOME ALERTS'}
                  title={fr ? 'Sécurité' : 'Safety'}
                  icon="shield-checkmark-outline"
                >
                  <Text style={s.body}>
                    {fr
                      ? 'Choisissez les alertes de sécurité à envoyer en notification push. Ces préférences s’appliquent aux appareils associés à ce compte.'
                      : 'Choose which safety alerts to send as push notifications. These preferences apply to devices linked to this account.'}
                  </Text>
                  <RuleToggle
                    title={fr ? 'Détection de chute' : 'Fall detection'}
                    detail={fr ? 'Lorsqu’une chute est détectée.' : 'When a fall is detected.'}
                    value={notificationPreferences.fallDetection}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('fallDetection', value)}
                  />
                  <RuleToggle
                    title={fr ? 'Détection de fumée' : 'Smoke detection'}
                    detail={
                      fr
                        ? 'Lorsqu’un détecteur signale de la fumée.'
                        : 'When a sensor detects smoke.'
                    }
                    value={notificationPreferences.smoke}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('smoke', value)}
                  />
                  <RuleToggle
                    title={fr ? 'Fuite d’eau' : 'Water leak'}
                    detail={
                      fr ? 'Lorsqu’une fuite d’eau est détectée.' : 'When a water leak is detected.'
                    }
                    value={notificationPreferences.waterLeak}
                    disabled={notificationBusy}
                    onChange={(value) => void updateNotificationPreference('waterLeak', value)}
                  />
                </Card>
                <Card
                  eyebrow={fr ? 'CARNET DE LIAISON' : 'LIAISON JOURNAL'}
                  title={fr ? 'Nouveaux éléments' : 'New entries'}
                  icon="book-outline"
                >
                  <Text style={s.body}>
                    {fr
                      ? 'Une notification est envoyée à chaque nouvelle entrée créée par un autre membre du domicile.'
                      : 'A notification is sent for each new entry created by another household member.'}
                  </Text>
                  <RuleToggle
                    title={fr ? 'Nouveau message' : 'New message'}
                    detail={
                      fr
                        ? 'Messages ajoutés au carnet de liaison.'
                        : 'Messages added to the liaison journal.'
                    }
                    value={notificationPreferences.liaisonMessages}
                    disabled={notificationBusy}
                    onChange={(value) =>
                      void updateNotificationPreference('liaisonMessages', value)
                    }
                  />
                  <RuleToggle
                    title={fr ? 'Nouvelle humeur' : 'New mood'}
                    detail={
                      fr
                        ? 'Humeurs ajoutées au carnet de liaison.'
                        : 'Moods added to the liaison journal.'
                    }
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
              <Text style={s.settingsBackLabel}>
                {fr ? 'Retour aux réglages' : 'Back to settings'}
              </Text>
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
                  <Text style={s.cardTitle}>
                    {fr ? 'Politique de confidentialité' : 'Privacy policy'}
                  </Text>
                  <Text style={s.body}>
                    {fr
                      ? 'Traitement et conservation des données.'
                      : 'Data processing and retention.'}
                  </Text>
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
                  <Text style={s.cardTitle}>{fr ? 'Mentions légales' : 'Legal information'}</Text>
                  <Text style={s.body}>
                    {fr ? 'Éditeur, licence et EULA Apple.' : 'Publisher, licence, and Apple EULA.'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={c.muted} />
              </Pressable>
            </View>
            <Card
              eyebrow={fr ? 'APPLICATION · VERSION' : 'APP · VERSION'}
              title="Élise OS"
              icon="heart-outline"
              badge={`v${appVersion}`}
            >
              <Text style={s.body}>
                {fr
                  ? 'Élise relie les repères du logement, l’application des proches et l’écran du résident pour soutenir le lien au quotidien.'
                  : 'Élise brings together cues from the home, the family app, and the resident’s screen to support everyday connection.'}
              </Text>
            </Card>
            <Card
              eyebrow={fr ? 'VIE PRIVÉE' : 'PRIVACY'}
              title={fr ? 'Traitement local' : 'Local processing'}
              icon="home-outline"
            >
              <Text style={s.body}>
                {fr
                  ? 'Les événements du logement sont traités sur l’installation locale et les proches autorisés y accèdent par réseau privé. Les notifications passent par Expo et le service Apple ou Google ; les appels vidéo utilisent le serveur Jitsi configuré. Aucune caméra n’est nécessaire pour les repères du logement.'
                  : 'Household events are processed on the local installation and authorized family members access it over a private network. Notifications use Expo and the Apple or Google service; video calls use the configured Jitsi server. No camera is needed for home cues.'}
              </Text>
            </Card>
            <Card
              eyebrow={fr ? 'À SAVOIR' : 'PLEASE NOTE'}
              title={fr ? 'Un prototype en cours d’intégration' : 'A prototype in progress'}
              icon="information-circle-outline"
            >
              <Text style={s.notice}>
                {fr
                  ? 'Élise n’est ni un dispositif médical ni un service d’urgence.'
                  : 'Élise is neither a medical device nor an emergency service.'}
              </Text>
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
              <Text style={s.settingsBackLabel}>
                {fr ? 'Retour à la page À propos' : 'Back to About'}
              </Text>
            </Pressable>
            <Card
              eyebrow={fr ? 'ÉDITEUR DU PROJET' : 'PROJECT PUBLISHER'}
              title="Élise OS"
              icon="person-circle-outline"
            >
              <Text style={s.body}>
                {fr
                  ? 'Élise OS est un projet porté individuellement en France.'
                  : 'Élise OS is an independently led project in France.'}
              </Text>
              <Text style={s.body}>contact@paulbreton.dev</Text>
              <ActionButton
                label={fr ? 'Contacter le porteur du projet' : 'Contact the project lead'}
                outline
                onPress={() => void Linking.openURL('mailto:contact@paulbreton.dev')}
              />
            </Card>
            <Card
              eyebrow={fr ? 'LICENCE DU LOGICIEL' : 'SOFTWARE LICENCE'}
              title="AGPL-3.0-only"
              icon="code-slash-outline"
            >
              <Text style={s.body}>
                {fr
                  ? 'Élise OS est un logiciel open source distribué sous licence AGPL-3.0-only.'
                  : 'Élise OS is open-source software distributed under the AGPL-3.0-only licence.'}
              </Text>
            </Card>
            <Card
              eyebrow={fr ? 'CONDITIONS DE L’APP STORE' : 'APP STORE TERMS'}
              title={fr ? 'EULA standard d’Apple' : 'Apple Standard EULA'}
              icon="document-text-outline"
            >
              <Text style={s.body}>
                {fr
                  ? 'Pour les apps distribuées sur l’App Store, la licence standard d’Apple s’applique sauf si une licence personnalisée est fournie.'
                  : 'For apps distributed through the App Store, Apple’s standard licence applies unless a custom licence is provided.'}
              </Text>
              <ActionButton
                label={fr ? 'Lire l’EULA standard d’Apple' : 'Read Apple’s Standard EULA'}
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
            demoMode
              ? fr
                ? 'Quitter la démonstration'
                : 'Exit demo'
              : fr
                ? 'Se déconnecter'
                : 'Sign out'
          }
          style={[s.settingsNavRow, s.logoutSettingsRow]}
          onPress={onLogout}
        >
          <View style={[s.cardIcon, s.logoutSettingsIcon]}>
            <Ionicons name="log-out-outline" size={19} color={c.red} />
          </View>
          <View style={s.flex}>
            <Text style={[s.cardTitle, s.logoutSettingsTitle]}>
              {demoMode
                ? fr
                  ? 'Quitter la démonstration'
                  : 'Exit demo'
                : fr
                  ? 'Se déconnecter'
                  : 'Sign out'}
            </Text>
            <Text style={s.body}>
              {fr ? 'Fermer cette session sur cet appareil.' : 'Sign out on this device.'}
            </Text>
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
function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[s.choice, active && s.choiceActive]}
      onPress={onPress}
    >
      <Text style={[s.choiceText, active && s.choiceTextActive]}>{label}</Text>
    </Pressable>
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
  heroEyebrow: { color: '#376884', fontSize: 9, letterSpacing: 1.25, fontWeight: '900' },
  heroTitle: {
    marginTop: 4,
    color: '#0B2948',
    fontFamily: 'Georgia',
    fontSize: 20,
    flexShrink: 1,
  },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: '#687382', flexShrink: 1 },
  eyebrow: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
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
  settingsBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  settingsBackLabel: { color: c.blue, fontSize: 10, fontWeight: '800' },
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
  cardTitle: { marginTop: 4, color: c.navy, fontSize: 13, fontWeight: '900' },
  badge: {
    maxWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
    borderRadius: 12,
    color: c.green,
    backgroundColor: c.paleGreen,
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
  },
  cardBody: { marginTop: 14, gap: 11 },
  body: { color: c.muted, fontSize: 10, lineHeight: 16 },
  caption: { color: c.muted, fontSize: 8, lineHeight: 13 },
  notice: {
    padding: 10,
    borderRadius: 10,
    color: '#8D4827',
    backgroundColor: c.paleAmber,
    fontSize: 9,
    lineHeight: 14,
  },
  languageRow: { flexDirection: 'row', gap: 8 },
  choice: {
    minHeight: 41,
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  choiceActive: { borderColor: c.blue, backgroundColor: '#E8F0F3' },
  choiceText: { color: c.muted, fontSize: 10, fontWeight: '800' },
  choiceTextActive: { color: c.blue },
  smallButton: {
    minHeight: 35,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F0F3',
  },
  smallButtonText: { color: c.blue, fontSize: 9, fontWeight: '900' },
  linkBox: { padding: 11, borderRadius: 11, backgroundColor: '#F1EEE8', gap: 4 },
  linkText: { color: c.blue, fontSize: 10, fontWeight: '800' },
  action: {
    minHeight: 43,
    paddingHorizontal: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  actionOutline: { borderWidth: 1, borderColor: c.blue, backgroundColor: c.paper },
  actionLabel: { color: '#fff', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  actionLabelOutline: { color: c.blue },
  disabled: { opacity: 0.45 },
  field: { gap: 5 },
  fieldLabel: { color: c.navy, fontSize: 9, fontWeight: '800' },
  input: {
    minHeight: 42,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    color: c.navy,
    fontSize: 10,
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
    fontSize: 11,
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
