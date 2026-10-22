import { Ionicons } from '@expo/vector-icons';
import type { RemoteAccessStatus } from '@michel/contracts';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Locale } from './MobileSetup';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TAILSCALE_APP =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/app/tailscale/id1470499037'
    : 'https://play.google.com/store/apps/details?id=com.tailscale.ipn';

const colors = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  greenSoft: '#E7F1EB',
  amberSoft: '#FBF0E3',
  red: '#B74747',
};

const copy = {
  fr: {
    benefits: [
      ['lock-closed-outline', 'Tunnel privé et chiffré'],
      ['globe-outline', 'Rien n’est ouvert sur Internet'],
      ['people-outline', 'Gratuit pour la famille'],
    ] as [IconName, string][],
    steps: [
      ['Relier Élise à Tailscale', 'Élise prépare une demande de connexion.'],
      ['Valider dans Tailscale', 'Connectez-vous ou créez un compte gratuit, puis revenez ici.'],
      ['Activer l’adresse privée', 'Élise obtient son adresse sécurisée.'],
    ],
    connect: 'Relier Élise',
    approve: 'Ouvrir Tailscale',
    enable: 'Activer',
    waiting: 'En attente de votre validation…',
    configuring: 'Préparation de l’adresse…',
    checking: 'Vérification de l’accès à distance…',
    ready: 'Accès à distance activé',
    readyHint:
      'Installez Tailscale sur ce téléphone avec le même compte pour joindre Élise hors de la maison.',
    installApp: 'Installer Tailscale sur ce téléphone',
    unavailable:
      'L’accès à distance n’est pas disponible sur ce boîtier pour le moment. Vous pourrez l’activer plus tard dans les réglages.',
    degraded:
      'L’accès à distance demande une vérification. Vous pourrez reprendre dans les réglages.',
    preview: 'Aperçu : la connexion à Tailscale se fait sur un vrai boîtier Élise.',
    later: 'Vous pouvez aussi passer cette étape et l’activer plus tard dans les réglages.',
    address: 'Adresse privée',
  },
  en: {
    benefits: [
      ['lock-closed-outline', 'Private, encrypted tunnel'],
      ['globe-outline', 'Nothing is exposed to the Internet'],
      ['people-outline', 'Free for families'],
    ] as [IconName, string][],
    steps: [
      ['Link Élise to Tailscale', 'Élise prepares a connection request.'],
      ['Approve in Tailscale', 'Sign in or create a free account, then come back here.'],
      ['Turn on the private address', 'Élise gets its secure address.'],
    ],
    connect: 'Link Élise',
    approve: 'Open Tailscale',
    enable: 'Turn on',
    waiting: 'Waiting for your approval…',
    configuring: 'Preparing the address…',
    checking: 'Checking remote access…',
    ready: 'Remote access is on',
    readyHint:
      'Install Tailscale on this phone with the same account to reach Élise away from home.',
    installApp: 'Install Tailscale on this phone',
    unavailable:
      'Remote access is not available on this box right now. You can turn it on later in settings.',
    degraded: 'Remote access needs attention. You can continue from settings later.',
    preview: 'Preview: linking to Tailscale happens on a real Élise box.',
    later: 'You can also skip this step and turn it on later in settings.',
    address: 'Private address',
  },
};

/** Which of the three visual steps is current: 0 link, 1 approve, 2 enable, 3 done. */
const progressOf = (status: RemoteAccessStatus | null) => {
  switch (status?.state) {
    case 'AUTHORIZING':
      return 1;
    case 'CONFIGURING':
      return 2;
    case 'READY':
      return 3;
    default:
      return 0;
  }
};

export function RemoteAccessStep({
  locale,
  status,
  checked,
  busy,
  error,
  previewMode,
  onConnect,
  onEnable,
  onError,
}: {
  locale: Locale;
  status: RemoteAccessStatus | null;
  checked: boolean;
  busy: boolean;
  error: string;
  previewMode?: boolean;
  onConnect: () => void;
  onEnable: () => void;
  onError: () => void;
}) {
  const t = copy[locale];
  const progress = progressOf(status);
  const unavailable =
    !previewMode &&
    checked &&
    (!status || status.state === 'UNAVAILABLE' || status.state === 'DEGRADED');

  const action = () => {
    if (previewMode || unavailable) return null;
    if (!status && !checked) {
      return (
        <View style={styles.waitingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.waitingText}>{t.checking}</Text>
        </View>
      );
    }
    switch (status?.state) {
      case 'SIGNED_OUT':
        return (
          <Pressable style={styles.action} disabled={busy} onPress={onConnect}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="link-outline" size={18} color="#fff" />
            )}
            <Text style={styles.actionText}>{t.connect}</Text>
          </Pressable>
        );
      case 'AUTHORIZING':
        return status.authUrl ? (
          <View style={styles.actionGroup}>
            <Pressable
              style={styles.action}
              onPress={() => void Linking.openURL(status.authUrl!).catch(onError)}
            >
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.actionText}>{t.approve}</Text>
            </Pressable>
            <View style={styles.waitingRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.waitingText}>{t.waiting}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.waitingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.waitingText}>{t.waiting}</Text>
          </View>
        );
      case 'CONFIGURING':
        return status.actionRequired === 'ENABLE_HTTPS' || status.actionRequired === 'RETRY' ? (
          <Pressable style={styles.action} disabled={busy} onPress={onEnable}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="flash-outline" size={18} color="#fff" />
            )}
            <Text style={styles.actionText}>{t.enable}</Text>
          </Pressable>
        ) : (
          <View style={styles.waitingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.waitingText}>{t.configuring}</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.benefits}>
        {t.benefits.map(([icon, label]) => (
          <View key={label} style={styles.benefit}>
            <Ionicons name={icon} size={17} color={colors.green} />
            <Text style={styles.benefitText}>{label}</Text>
          </View>
        ))}
      </View>

      {progress === 3 && status ? (
        <View style={styles.readyCard}>
          <View style={styles.readyHeader}>
            <View style={styles.readyIcon}>
              <Ionicons name="checkmark" size={22} color="#fff" />
            </View>
            <Text style={styles.readyTitle}>{t.ready}</Text>
          </View>
          {status.remoteUrl ? (
            <Pressable
              style={styles.address}
              onPress={() => void Linking.openURL(status.remoteUrl!).catch(() => {})}
            >
              <Text style={styles.addressLabel}>{t.address}</Text>
              <Text style={styles.addressValue} numberOfLines={1}>
                {status.remoteUrl}
              </Text>
            </Pressable>
          ) : null}
          <Text style={styles.readyHint}>{t.readyHint}</Text>
          <Pressable
            style={styles.secondary}
            onPress={() => void Linking.openURL(TAILSCALE_APP).catch(() => {})}
          >
            <Ionicons name="download-outline" size={17} color={colors.navy} />
            <Text style={styles.secondaryText}>{t.installApp}</Text>
          </Pressable>
        </View>
      ) : unavailable ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={20} color={colors.navy} />
          <Text style={styles.noticeText}>
            {status?.state === 'DEGRADED' ? t.degraded : t.unavailable}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          {t.steps.map(([title, hint], index) => {
            const done = index < progress;
            const current = index === progress;
            return (
              <View key={title} style={styles.step}>
                <View style={styles.rail}>
                  <View style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}>
                    {done ? (
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    ) : (
                      <Text style={[styles.dotNumber, current && styles.dotNumberCurrent]}>
                        {index + 1}
                      </Text>
                    )}
                  </View>
                  {index < t.steps.length - 1 ? (
                    <View style={[styles.line, done && styles.lineDone]} />
                  ) : null}
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepTitle, !done && !current && styles.stepTitleMuted]}>
                    {title}
                  </Text>
                  <Text style={styles.stepHint}>{hint}</Text>
                  {current ? action() : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {previewMode ? <Text style={styles.later}>{t.preview}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {progress < 3 ? <Text style={styles.later}>{t.later}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, marginBottom: 20 },
  benefits: { gap: 8 },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: colors.greenSoft,
  },
  benefitText: { color: colors.navy, fontSize: 13, fontWeight: '600' },
  card: {
    padding: 16,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  step: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 28 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  dotDone: { backgroundColor: colors.green, borderColor: colors.green },
  dotCurrent: { borderColor: colors.accent },
  dotNumber: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  dotNumberCurrent: { color: colors.accent },
  line: { flex: 1, width: 2, minHeight: 18, backgroundColor: colors.line, marginVertical: 4 },
  lineDone: { backgroundColor: colors.green },
  stepBody: { flex: 1, paddingBottom: 18, gap: 4 },
  stepTitle: { color: colors.navy, fontSize: 15, fontWeight: '700' },
  stepTitleMuted: { color: colors.muted },
  stepHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  actionGroup: { gap: 10, marginTop: 8 },
  action: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 13,
    backgroundColor: colors.blue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  waitingText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  readyCard: {
    padding: 16,
    borderRadius: 19,
    backgroundColor: colors.greenSoft,
    gap: 12,
  },
  readyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  readyIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyTitle: { color: colors.navy, fontSize: 17, fontWeight: '700' },
  address: {
    padding: 12,
    borderRadius: 13,
    backgroundColor: colors.paper,
    gap: 3,
  },
  addressLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  addressValue: { color: colors.navy, fontSize: 13, fontWeight: '600' },
  readyHint: { color: colors.navy, fontSize: 13, lineHeight: 19 },
  secondary: {
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryText: { color: colors.navy, fontWeight: '700', fontSize: 14 },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 15,
    backgroundColor: colors.amberSoft,
  },
  noticeText: { flex: 1, color: colors.navy, fontSize: 13, lineHeight: 19 },
  later: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  error: { color: colors.red, fontSize: 13, textAlign: 'center' },
});
