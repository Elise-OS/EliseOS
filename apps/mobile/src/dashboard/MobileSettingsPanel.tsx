import { Ionicons } from '@expo/vector-icons';
import type {
  AlertRuleSettings,
  MembershipRole,
  RemoteAccessStatus,
  UpdateStatus,
} from '@michel/contracts';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileApi, type GoogleAccountSettings, type SimulationScenario } from '../api';
import type { SavedServer } from '../discovery/types';
import { activeServerUrl, isTailscaleUrl } from '../discovery/helpers';

type SettingsSection = 'general' | 'google' | 'rules';
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

const terminalUpdateStates = new Set<UpdateStatus['state']>([
  'UP_TO_DATE',
  'AVAILABLE',
  'SUCCEEDED',
  'ROLLED_BACK',
  'FAILED',
  'UNCONFIGURED',
]);

function isPrivateNetworkUrl(value: string) {
  try {
    const { hostname } = new URL(value);
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
    const parts = hostname.split('.').map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return false;
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  } catch {
    return false;
  }
}

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
  onLocaleChange,
  onOpenPage,
}: {
  server: SavedServer;
  token: string;
  role: MembershipRole;
  locale: Locale;
  initialSection: SettingsSection;
  onLocaleChange: (locale: Locale) => void;
  onOpenPage: (
    page: 'home' | 'activity' | 'alerts' | 'house' | 'journal' | 'screen' | 'people' | 'settings',
  ) => void;
}) {
  const fr = locale === 'fr';
  const canManage = role === 'OWNER' || role === 'ADMINISTRATOR';
  const activeUrl = activeServerUrl(server);
  const localGateway = (() => {
    try {
      return new URL(activeUrl).protocol === 'http:';
    } catch {
      return false;
    }
  })();
  const updateConnectionAllowed = isTailscaleUrl(activeUrl) || isPrivateNetworkUrl(activeUrl);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [rules, setRules] = useState<AlertRuleSettings | null>(null);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesNotice, setRulesNotice] = useState('');
  const [google, setGoogle] = useState<GoogleAccountSettings | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [googleNotice, setGoogleNotice] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [youtubeEnabled, setYoutubeEnabled] = useState(true);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteNotice, setRemoteNotice] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateUsername, setUpdateUsername] = useState('');
  const [updateToken, setUpdateToken] = useState('');
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [simulationNotice, setSimulationNotice] = useState('');

  useEffect(() => setSection(initialSection), [initialSection]);

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

  useEffect(() => {
    if (!canManage || !updateConnectionAllowed || section !== 'general') return;
    let active = true;
    void mobileApi
      .updateStatus(server, token)
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch(() => {
        if (active) setUpdateStatus(null);
      });
    return () => {
      active = false;
    };
  }, [canManage, section, server.id, token, updateConnectionAllowed]);

  useEffect(() => {
    if (!canManage || section !== 'google') return;
    let active = true;
    setGoogleLoading(true);
    setGoogleError('');
    void mobileApi
      .googleSettings(server, token)
      .then((value) => {
        if (!active) return;
        setGoogle(value);
        setClientId(value.clientId);
        setYoutubeEnabled(value.youtubeEnabled);
        setCalendarEnabled(value.calendarEnabled);
      })
      .catch((error) => {
        if (active)
          setGoogleError(
            error instanceof Error && error.message.includes('403') ? 'forbidden' : 'load',
          );
      })
      .finally(() => {
        if (active) setGoogleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canManage, section, server.id, token]);

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
  const saveGoogle = async () => {
    if (!clientId.trim() || googleBusy) return;
    setGoogleBusy(true);
    setGoogleError('');
    setGoogleNotice('');
    try {
      const value = await mobileApi.saveGoogleSettings(server, token, {
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        youtubeEnabled,
        calendarEnabled,
      });
      setGoogle(value);
      setClientSecret('');
      setGoogleNotice(fr ? 'Configuration Google enregistrée.' : 'Google configuration saved.');
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : 'save');
    } finally {
      setGoogleBusy(false);
    }
  };
  const removeGoogle = () =>
    Alert.alert(
      fr ? 'Supprimer la configuration Google ?' : 'Remove Google configuration?',
      fr
        ? 'La connexion YouTube sera également supprimée.'
        : 'The YouTube connection will also be removed.',
      [
        { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' },
        {
          text: fr ? 'Supprimer' : 'Remove',
          style: 'destructive',
          onPress: () => {
            setGoogleBusy(true);
            void mobileApi
              .removeGoogleSettings(server, token)
              .then(() => {
                setGoogle(null);
                setClientId('');
                setClientSecret('');
                setYoutubeEnabled(true);
                setCalendarEnabled(true);
                setGoogleNotice(
                  fr ? 'Configuration Google supprimée.' : 'Google configuration removed.',
                );
              })
              .catch(() =>
                setGoogleError(
                  fr
                    ? 'La configuration n’a pas pu être supprimée.'
                    : 'Could not remove the configuration.',
                ),
              )
              .finally(() => setGoogleBusy(false));
          },
        },
      ],
    );

  const checkUpdate = async () => {
    if (!canManage || !updateConnectionAllowed || updateBusy) return;
    setUpdateBusy(true);
    try {
      setUpdateStatus(await mobileApi.checkUpdate(server, token));
    } catch {
      Alert.alert(
        fr ? 'Vérification impossible' : 'Check failed',
        fr
          ? 'La mise à jour ne peut pas être vérifiée pour le moment.'
          : 'Updates cannot be checked right now.',
      );
    } finally {
      setUpdateBusy(false);
    }
  };
  const saveUpdateCredentials = async () => {
    if (!updateUsername.trim() || !updateToken.trim()) return;
    setUpdateBusy(true);
    try {
      setUpdateStatus(
        await mobileApi.saveUpdateCredentials(
          server,
          token,
          updateUsername.trim(),
          updateToken.trim(),
        ),
      );
      setUpdateToken('');
    } catch {
      Alert.alert(
        fr ? 'Enregistrement impossible' : 'Could not save',
        fr
          ? 'Le compte de téléchargement n’a pas pu être enregistré.'
          : 'The download account could not be saved.',
      );
    } finally {
      setUpdateBusy(false);
    }
  };
  const removeUpdateCredentials = () =>
    Alert.alert(fr ? 'Supprimer le compte bot ?' : 'Remove bot account?', undefined, [
      { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' },
      {
        text: fr ? 'Supprimer' : 'Remove',
        style: 'destructive',
        onPress: () => {
          setUpdateBusy(true);
          void mobileApi
            .deleteUpdateCredentials(server, token)
            .then(setUpdateStatus)
            .catch(() => undefined)
            .finally(() => setUpdateBusy(false));
        },
      },
    ]);
  const installUpdate = (version: string) =>
    Alert.alert(
      fr ? `Installer ${version} maintenant ?` : `Install ${version} now?`,
      fr ? 'Élise redémarrera brièvement.' : 'Élise will restart briefly.',
      [
        { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' },
        {
          text: fr ? 'Installer' : 'Install',
          onPress: () => {
            setUpdateBusy(true);
            void (async () => {
              try {
                let next = await mobileApi.installUpdate(server, token, version);
                setUpdateStatus(next);
                for (
                  let attempt = 0;
                  attempt < 100 && !['SUCCEEDED', 'ROLLED_BACK', 'FAILED'].includes(next.state);
                  attempt += 1
                ) {
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  try {
                    next = await mobileApi.updateStatus(server, token);
                    setUpdateStatus(next);
                  } catch {
                    /* Service may briefly restart while the update is applied. */
                  }
                }
              } catch {
                Alert.alert(fr ? 'Installation impossible' : 'Install failed');
              } finally {
                setUpdateBusy(false);
              }
            })();
          },
        },
      ],
    );

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

  const sectionOptions: Array<[SettingsSection, string, string]> = [
    ['general', fr ? 'Général' : 'General', 'settings-outline'],
    ['google', fr ? 'Compte Google' : 'Google account', 'key-outline'],
    ['rules', fr ? 'Règles' : 'Rules', 'notifications-outline'],
  ];

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Text style={s.eyebrow}>ÉLISE OS</Text>
          <Text style={s.title}>{fr ? 'Réglages' : 'Settings'}</Text>
          <Text style={s.subtitle}>
            {fr
              ? 'Adaptez Élise à votre quotidien et choisissez les situations qui méritent votre attention.'
              : 'Adapt Élise to your daily life and choose which situations deserve your attention.'}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabs}
        >
          {sectionOptions.map(([value, label, icon]) => (
            <Pressable
              key={value}
              onPress={() => setSection(value)}
              style={[s.tab, section === value && s.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: section === value }}
            >
              <Ionicons
                name={icon as React.ComponentProps<typeof Ionicons>['name']}
                size={16}
                color={section === value ? '#fff' : c.blue}
              />
              <Text style={[s.tabText, section === value && s.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {section === 'general' ? (
          <>
            <Card
              eyebrow={fr ? 'PRÉFÉRENCES DE L’APPLICATION' : 'APPLICATION PREFERENCES'}
              title={fr ? 'Général' : 'General'}
              icon="settings-outline"
            >
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
              <SettingRow
                icon="sparkles-outline"
                title={fr ? 'Visite guidée' : 'Guided tour'}
                detail={
                  fr
                    ? 'Redécouvrez les espaces essentiels de l’application.'
                    : 'Rediscover the essential spaces in the app.'
                }
              >
                <Pressable
                  style={s.smallButton}
                  onPress={() => {
                    setTourStep(0);
                    setTourOpen(true);
                  }}
                >
                  <Text style={s.smallButtonText}>{fr ? 'Revoir la visite' : 'Replay tour'}</Text>
                </Pressable>
              </SettingRow>
            </Card>
            {canManage ? (
              <Card
                eyebrow={fr ? 'CONNEXION PRIVÉE' : 'PRIVATE CONNECTION'}
                title={fr ? 'Accès à distance' : 'Remote access'}
                icon="shield-checkmark-outline"
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
                    <StatusRow label="Dashboard HTTPS · 8443" ok={remoteStatus.httpsAvailable} />
                    <StatusRow
                      label={fr ? 'Caméra et interphone · 8555' : 'Camera and intercom · 8555'}
                      ok={remoteStatus.webrtcAvailable}
                    />
                    {remoteStatus.keyExpiresAt ? (
                      <Text style={s.caption}>
                        {fr ? 'Clé valide jusqu’au' : 'Key valid until'}{' '}
                        {new Date(remoteStatus.keyExpiresAt).toLocaleDateString(
                          locale === 'fr' ? 'fr-FR' : 'en-GB',
                        )}
                      </Text>
                    ) : null}
                    <Pressable
                      style={s.smallButton}
                      onPress={() => void Linking.openURL(remoteStatus.remoteUrl!)}
                    >
                      <Text style={s.smallButtonText}>
                        {fr ? 'Tester la connexion' : 'Test connection'}
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

            {canManage && updateConnectionAllowed ? (
              <Card
                eyebrow={fr ? 'MAINTENANCE DE L’APPAREIL' : 'DEVICE MAINTENANCE'}
                title="Mise à jour d’Élise OS"
                icon="cloud-download-outline"
                badge={
                  updateStatus ? updateLabel(updateStatus, fr) : fr ? 'Vérification…' : 'Checking…'
                }
              >
                <Text style={s.body}>
                  {fr
                    ? 'Recevez les nouvelles versions et choisissez quand les installer sur cet appareil.'
                    : 'See new versions and choose when to install them on this device.'}
                </Text>
                {updateStatus?.currentVersion ? (
                  <Text style={s.caption}>
                    {fr ? 'Version installée' : 'Installed version'} : {updateStatus.currentVersion}
                  </Text>
                ) : null}
                {updateStatus?.checkedAt ? (
                  <Text style={s.caption}>
                    {fr ? 'Dernière vérification' : 'Last checked'} :{' '}
                    {new Date(updateStatus.checkedAt).toLocaleString(
                      locale === 'fr' ? 'fr-FR' : 'en-GB',
                    )}
                  </Text>
                ) : null}
                {updateStatus?.progress != null && !terminalUpdateStates.has(updateStatus.state) ? (
                  <Text style={s.body}>
                    {fr ? 'Progression' : 'Progress'} : {updateStatus.progress}%
                  </Text>
                ) : null}
                <ActionButton
                  label={fr ? 'Rechercher une mise à jour' : 'Check for updates'}
                  outline
                  disabled={updateBusy}
                  onPress={() => void checkUpdate()}
                />
                {updateStatus?.latestVersion && updateStatus.updateAvailable ? (
                  <>
                    <Text style={s.cardTitle}>
                      {fr
                        ? `Version ${updateStatus.latestVersion}`
                        : `Version ${updateStatus.latestVersion}`}
                    </Text>
                    {updateStatus.releaseNotes ? (
                      <Text style={s.body}>{updateStatus.releaseNotes}</Text>
                    ) : null}
                    <ActionButton
                      label={
                        fr
                          ? `Installer ${updateStatus.latestVersion}`
                          : `Install ${updateStatus.latestVersion}`
                      }
                      disabled={updateBusy}
                      onPress={() => installUpdate(updateStatus.latestVersion!)}
                    />
                  </>
                ) : null}
                {updateStatus?.message ? <Text style={s.body}>{updateStatus.message}</Text> : null}
                {updateStatus?.error ? <Text style={s.notice}>{updateStatus.error}</Text> : null}
                <View style={s.separator} />
                <Text style={s.cardTitle}>
                  {updateStatus?.authConfigured
                    ? fr
                      ? 'Changer le compte de téléchargement'
                      : 'Change download account'
                    : fr
                      ? 'Configurer le compte de téléchargement'
                      : 'Configure download account'}
                </Text>
                <Text style={s.caption}>
                  {fr
                    ? 'Le jeton reste dans cette saisie temporaire et n’est jamais enregistré dans l’app mobile.'
                    : 'The token stays in this temporary form and is never saved in the mobile app.'}
                </Text>
                <Field
                  label={fr ? 'Nom du compte bot' : 'Bot account name'}
                  value={updateUsername}
                  onChange={setUpdateUsername}
                />
                <Field label="Jeton GitHub" value={updateToken} onChange={setUpdateToken} secure />
                <ActionButton
                  label={fr ? 'Enregistrer' : 'Save'}
                  disabled={updateBusy || !updateUsername.trim() || !updateToken.trim()}
                  onPress={() => void saveUpdateCredentials()}
                />
                {updateStatus?.authConfigured ? (
                  <ActionButton
                    label={fr ? 'Supprimer le compte' : 'Remove account'}
                    outline
                    disabled={updateBusy}
                    onPress={removeUpdateCredentials}
                  />
                ) : null}
              </Card>
            ) : canManage ? (
              <Card
                eyebrow={fr ? 'MAINTENANCE DE L’APPAREIL' : 'DEVICE MAINTENANCE'}
                title="Mise à jour d’Élise OS"
                icon="cloud-download-outline"
              >
                <Text style={s.notice}>
                  {fr
                    ? 'Les mises à jour se gèrent depuis le réseau local ou Tailscale.'
                    : 'Updates are available from the local network or Tailscale.'}
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
          </>
        ) : null}

        {section === 'google' ? (
          <Card
            eyebrow={fr ? 'SERVICES CONNECTÉS' : 'CONNECTED SERVICES'}
            title={fr ? 'Compte Google' : 'Google account'}
            icon="key-outline"
            badge={google?.configured ? (fr ? 'Prêt' : 'Ready') : fr ? 'À configurer' : 'To set up'}
          >
            <Text style={s.body}>
              {fr
                ? 'Un seul réglage pour vos playlists YouTube et votre futur calendrier Google.'
                : 'One setting for your YouTube playlists and future Google Calendar.'}
            </Text>
            {googleLoading ? (
              <Text style={s.body}>{fr ? 'Chargement…' : 'Loading…'}</Text>
            ) : googleError === 'forbidden' ? (
              <Text style={s.notice}>
                {fr
                  ? 'Seul un administrateur peut configurer le compte Google.'
                  : 'Only an administrator can configure Google.'}
              </Text>
            ) : googleError === 'load' ? (
              <Text style={s.notice}>
                {fr
                  ? 'La configuration Google est indisponible.'
                  : 'Google settings are unavailable.'}
              </Text>
            ) : !canManage ? (
              <Text style={s.notice}>
                {fr
                  ? 'Seul un administrateur peut configurer le compte Google.'
                  : 'Only an administrator can configure Google.'}
              </Text>
            ) : (
              <>
                <View style={s.steps}>
                  <Step
                    title={fr ? 'Créer un projet Google Cloud' : 'Create a Google Cloud project'}
                    text={
                      fr ? 'Utilisez un projet dédié à Élise.' : 'Use a project dedicated to Élise.'
                    }
                    url="https://console.cloud.google.com/projectcreate"
                  />
                  <Step
                    title={fr ? 'Activer YouTube Data API v3' : 'Enable YouTube Data API v3'}
                    text={
                      fr
                        ? 'Cette API permet de retrouver vos playlists YouTube.'
                        : 'This API enables your YouTube playlists.'
                    }
                    url="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                  />
                  <Step
                    title={fr ? 'Activer Google Calendar API' : 'Enable Google Calendar API'}
                    text={
                      fr
                        ? 'Cette API permet d’utiliser l’agenda partagé.'
                        : 'This API enables the shared calendar.'
                    }
                    url="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                  />
                  <Step
                    title={fr ? 'Préparer l’écran de consentement' : 'Prepare the consent screen'}
                    text={
                      fr
                        ? 'Choisissez Externe, indiquez Élise, puis ajoutez votre compte comme utilisateur test.'
                        : 'Choose External, name it Élise, and add your account as a test user.'
                    }
                    url="https://console.cloud.google.com/apis/credentials/consent"
                  />
                  <Step
                    title={fr ? 'Créer les identifiants OAuth' : 'Create OAuth credentials'}
                    text={
                      fr
                        ? 'Créez un ID client de type Application Web.'
                        : 'Create a Web application OAuth client ID.'
                    }
                    url="https://console.cloud.google.com/apis/credentials"
                  />
                </View>
                {google?.redirectUri ? (
                  <View style={s.linkBox}>
                    <Text style={s.caption}>
                      {fr
                        ? 'URI de redirection générée automatiquement'
                        : 'Automatically generated redirect URI'}
                    </Text>
                    <Text selectable style={s.linkText}>
                      {google.redirectUri}
                    </Text>
                    <Text style={s.caption}>
                      {fr
                        ? 'Copiez-la dans Google Cloud, sans la modifier.'
                        : 'Copy it to Google Cloud without changing it.'}
                    </Text>
                  </View>
                ) : null}
                <Field
                  label="Client ID"
                  value={clientId}
                  onChange={setClientId}
                  autoCapitalize="none"
                />
                <Field
                  label={fr ? 'Secret client' : 'Client secret'}
                  value={clientSecret}
                  onChange={setClientSecret}
                  secure
                />
                {google?.configured ? (
                  <Text style={s.caption}>
                    {fr
                      ? 'Laisser le secret vide pour conserver le secret enregistré.'
                      : 'Leave the secret empty to keep the saved secret.'}
                  </Text>
                ) : null}
                <SettingSwitch
                  title="YouTube"
                  detail={fr ? 'Playlists dans Affichage TV' : 'Playlists in TV display'}
                  value={youtubeEnabled}
                  onChange={setYoutubeEnabled}
                />
                <SettingSwitch
                  title="Google Calendar"
                  detail={fr ? 'Calendrier partagé dans Élise' : 'Shared calendar in Élise'}
                  value={calendarEnabled}
                  onChange={setCalendarEnabled}
                />
                {googleNotice ? <Text style={s.notice}>{googleNotice}</Text> : null}
                {googleError && googleError !== 'forbidden' && googleError !== 'load' ? (
                  <Text style={s.notice}>{googleError}</Text>
                ) : null}
                <ActionButton
                  label={fr ? 'Enregistrer la configuration' : 'Save configuration'}
                  disabled={
                    googleBusy || !clientId.trim() || (!google?.configured && !clientSecret.trim())
                  }
                  onPress={() => void saveGoogle()}
                />
                {google?.configured ? (
                  <ActionButton
                    label={fr ? 'Réinitialiser' : 'Reset'}
                    outline
                    disabled={googleBusy}
                    onPress={removeGoogle}
                  />
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        {section === 'rules' ? (
          !canManage ? (
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
              <Text style={s.body}>{fr ? 'Chargement des repères…' : 'Loading alert rules…'}</Text>
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
                label={fr ? 'Persistance température (minutes)' : 'Temperature duration (minutes)'}
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
                  setRules({ ...rules, nightActivity: { ...rules.nightActivity, enabled: value } })
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
                  setRules({ ...rules, sensorOffline: { ...rules.sensorOffline, enabled: value } })
                }
              />
              <NumberField
                label={fr ? 'Délai capteur silencieux (minutes)' : 'Silent sensor delay (minutes)'}
                value={rules.sensorOffline.minutes}
                min={15}
                max={10080}
                onChange={(value) =>
                  setRules({ ...rules, sensorOffline: { ...rules.sensorOffline, minutes: value } })
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
          )
        ) : null}
      </ScrollView>

      <Modal
        transparent
        visible={tourOpen}
        animationType="fade"
        onRequestClose={() => setTourOpen(false)}
      >
        <View style={s.tourBackdrop}>
          <View style={s.tourCard}>
            <Text style={s.eyebrow}>
              {fr ? `VISITE GUIDÉE · ${tourStep + 1}/5` : `GUIDED TOUR · ${tourStep + 1}/5`}
            </Text>
            <Text style={s.title}>
              {
                (fr
                  ? ['Accueil', 'Activité', 'Alertes', 'Liaison', 'Mon logement']
                  : ['Home', 'Activity', 'Alerts', 'Liaison', 'My home'])[tourStep]
              }
            </Text>
            <Text style={s.body}>
              {
                (fr
                  ? [
                      'Retrouvez la situation actuelle, les repères du quotidien et les raccourcis.',
                      'Consultez les moments observés, les pièces et les détails des événements.',
                      'Examinez les situations et les actions possibles.',
                      'Retrouvez les échanges familiaux et le calendrier partagé.',
                      'Explorez le plan, les capteurs et les caméras du logement.',
                    ]
                  : [
                      'See the current situation, daily landmarks, and shortcuts.',
                      'Review observed moments, rooms, and event details.',
                      'Review situations and available actions.',
                      'Open family notes and the shared calendar.',
                      'Explore the home plan, sensors, and cameras.',
                    ])[tourStep]
              }
            </Text>
            <View style={s.formActions}>
              <ActionButton
                label={fr ? 'Fermer' : 'Close'}
                outline
                onPress={() => setTourOpen(false)}
              />
              <ActionButton
                label={tourStep === 4 ? (fr ? 'Terminer' : 'Finish') : fr ? 'Suivant' : 'Next'}
                onPress={() => {
                  if (tourStep === 4) setTourOpen(false);
                  else setTourStep((value) => value + 1);
                }}
              />
            </View>
            <Pressable
              style={s.tourJump}
              onPress={() => {
                const pages = ['home', 'activity', 'alerts', 'journal', 'house'] as const;
                onOpenPage(pages[tourStep] ?? 'home');
                setTourOpen(false);
              }}
            >
              <Text style={s.smallButtonText}>{fr ? 'Ouvrir cette page' : 'Open this page'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Card({
  eyebrow,
  title,
  icon,
  badge,
  children,
}: React.PropsWithChildren<{
  eyebrow: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  badge?: string;
}>) {
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.cardIcon}>
          <Ionicons name={icon} size={19} color={c.blue} />
        </View>
        <View style={s.flex}>
          <Text style={s.eyebrow}>{eyebrow}</Text>
          <Text style={s.cardTitle}>{title}</Text>
        </View>
        {badge ? <Text style={s.badge}>{badge}</Text> : null}
      </View>
      <View style={s.cardBody}>{children}</View>
    </View>
  );
}
function SettingRow({
  icon,
  title,
  detail,
  children,
}: React.PropsWithChildren<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string;
}>) {
  return (
    <View style={s.settingRow}>
      <View style={s.cardIcon}>
        <Ionicons name={icon} size={18} color={c.accent} />
      </View>
      <View style={s.flex}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.body}>{detail}</Text>
      </View>
      {children}
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
function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={s.statusRow}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'alert-circle-outline'}
        size={16}
        color={ok ? c.green : c.amber}
      />
      <Text style={s.body}>{label}</Text>
    </View>
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
function SettingSwitch({
  title,
  detail,
  value,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={s.switchRow}>
      <View style={s.flex}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.body}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#C8CFD1', true: c.green }}
        thumbColor="#fff"
      />
    </View>
  );
}
function Step({ title, text, url }: { title: string; text: string; url: string }) {
  return (
    <View style={s.step}>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.body}>{text}</Text>
      <Pressable style={s.external} onPress={() => void Linking.openURL(url)}>
        <Text style={s.smallButtonText}>
          {title.includes('YouTube') ? 'Ouvrir Google Cloud' : 'Ouvrir Google Cloud'} ↗
        </Text>
      </Pressable>
    </View>
  );
}
function RuleToggle({
  title,
  detail,
  value,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={s.ruleRow}>
      <View style={s.flex}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.body}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
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
function updateLabel(status: UpdateStatus, fr: boolean) {
  const labels: Record<UpdateStatus['state'], string> = {
    UNCONFIGURED: fr ? 'Compte à configurer' : 'Account needed',
    CHECKING: fr ? 'Vérification…' : 'Checking…',
    UP_TO_DATE: fr ? 'À jour' : 'Up to date',
    AVAILABLE: fr ? 'Mise à jour disponible' : 'Update available',
    DOWNLOADING: fr ? 'Téléchargement…' : 'Downloading…',
    INSTALLING: fr ? 'Installation…' : 'Installing…',
    VERIFYING: fr ? 'Vérification…' : 'Verifying…',
    RESTARTING: fr ? 'Redémarrage…' : 'Restarting…',
    SUCCEEDED: fr ? 'Mise à jour terminée' : 'Update complete',
    ROLLED_BACK: fr ? 'Version précédente restaurée' : 'Rolled back',
    FAILED: fr ? 'Vérification impossible' : 'Check failed',
  };
  return labels[status.state];
}

const s = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 36, gap: 12, backgroundColor: c.cream },
  hero: { padding: 18, borderRadius: 20, gap: 6, backgroundColor: '#EDF2F1' },
  eyebrow: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: c.navy, fontFamily: 'Georgia', fontSize: 25 },
  subtitle: { color: c.muted, fontSize: 11, lineHeight: 16 },
  tabs: { gap: 8 },
  tab: {
    minHeight: 41,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: c.paper,
  },
  tabActive: { borderColor: c.blue, backgroundColor: c.blue },
  tabText: { color: c.blue, fontSize: 9, fontWeight: '800' },
  tabTextActive: { color: '#fff' },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
  },
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
  settingRow: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
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
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: 3 },
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
  switchRow: {
    minHeight: 57,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  steps: { gap: 2 },
  step: {
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    gap: 4,
  },
  external: { alignSelf: 'flex-start', paddingVertical: 6 },
  scenario: {
    minHeight: 60,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tourBackdrop: {
    flex: 1,
    padding: 22,
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 41, 72, 0.35)',
  },
  tourCard: { padding: 20, borderRadius: 20, gap: 12, backgroundColor: c.paper },
  formActions: { flexDirection: 'row', flex: 1, gap: 8 },
  tourJump: { alignSelf: 'center', padding: 8 },
});
