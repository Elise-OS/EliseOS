import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import eliseLogo from '../../assets/logo.png';
import { fetchPreparation } from '../discovery/preparation';
import type { DiscoveryInfo, PreparationStatus, PreparationStep } from '../discovery/types';
import type { Locale } from './MobileSetup';

const POLL_MS = 3000;

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
  redSoft: '#F8E7E7',
};

const englishLabels: Record<PreparationStep['id'], string> = {
  settings: 'Raspberry Pi settings',
  network: 'Internet connection',
  clock: 'Setting the clock',
  verify: 'Checking the release',
  download: 'Downloading components',
  start: 'Starting Élise',
};

export function MobilePreparation({
  url,
  instanceName,
  initial,
  locale,
  onBack,
  onReady,
}: {
  url: string;
  instanceName: string;
  initial?: PreparationStatus | null;
  locale: Locale;
  onBack: () => void;
  onReady: (info: DiscoveryInfo) => void;
}) {
  const [status, setStatus] = useState<PreparationStatus | null>(initial ?? null);
  const [switching, setSwitching] = useState(false);
  const progress = useRef(new Animated.Value(initial?.percent ?? 0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await fetchPreparation(url);
      if (!active) return;
      if ('ready' in result) {
        onReady(result.ready);
        return;
      }
      if (result.preparation) {
        setStatus(result.preparation);
        setSwitching(false);
      } else setSwitching(true);
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [onReady, url]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: status?.percent ?? 0,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, status?.percent]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const percent = Math.max(2, Math.min(100, Math.round(status?.percent ?? 0)));
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const message = switching
    ? tr('Élise démarre, encore quelques secondes…', 'Élise is starting, a few more seconds…')
    : status?.error
      ? status.message
      : (status?.message ?? tr('Connexion à Élise…', 'Connecting to Élise…'));

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.nav}>
          <Pressable style={styles.iconButton} onPress={onBack}>
            <Ionicons name="arrow-back" size={21} color={colors.navy} />
          </Pressable>
          <Text style={styles.navCaption}>{instanceName}</Text>
          <View style={styles.iconSpacer} />
        </View>

        <View style={styles.hero}>
          <Image source={eliseLogo} style={styles.logo} resizeMode="cover" />
          <Text style={styles.eyebrow}>{tr('PREMIER DÉMARRAGE', 'FIRST START')}</Text>
          <Text style={styles.title}>{tr('Élise se prépare', 'Élise is getting ready')}</Text>
          <Text style={styles.text}>
            {tr(
              'Le boîtier installe ses composants. Gardez cet écran ouvert : la création du compte s’affichera toute seule.',
              'The box is installing its components. Keep this screen open: account creation will appear on its own.',
            )}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={[styles.message, status?.error && styles.messageError]}>{message}</Text>
          <View style={styles.meter}>
            <View style={styles.track}>
              <Animated.View
                style={[
                  styles.fill,
                  status?.error && styles.fillError,
                  {
                    width: progress.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['2%', '100%'],
                      extrapolate: 'clamp',
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.percent}>{percent} %</Text>
          </View>

          <View style={styles.steps}>
            {(status?.steps ?? []).map((step) => (
              <View
                key={step.id}
                style={[
                  styles.step,
                  step.state === 'current' && styles.stepCurrent,
                  step.state === 'failed' && styles.stepFailed,
                ]}
              >
                {step.state === 'current' ? (
                  <Animated.View
                    style={[styles.dot, styles.dotCurrent, { transform: [{ rotate }] }]}
                  />
                ) : (
                  <View
                    style={[
                      styles.dot,
                      step.state === 'done' && styles.dotDone,
                      step.state === 'failed' && styles.dotFailed,
                    ]}
                  >
                    {step.state === 'done' && <Ionicons name="checkmark" size={14} color="#fff" />}
                    {step.state === 'failed' && <Text style={styles.dotMark}>!</Text>}
                  </View>
                )}
                <Text
                  style={[
                    styles.stepLabel,
                    step.state === 'pending' && styles.stepPending,
                    step.state === 'current' && styles.stepLabelStrong,
                    step.state === 'failed' && styles.stepLabelFailed,
                  ]}
                >
                  {locale === 'fr' ? step.label : englishLabels[step.id]}
                </Text>
                {step.detail ? <Text style={styles.stepDetail}>{step.detail}</Text> : null}
              </View>
            ))}
          </View>

          {status?.needsGithubAuth && (
            <View style={styles.notice}>
              <Ionicons name="key-outline" size={18} color={colors.navy} />
              <Text style={styles.noticeText}>
                {tr(
                  `Le dépôt Élise est privé : renseignez le compte bot sur ${status.address ?? 'elise.local'} depuis un ordinateur.`,
                  `The Élise repository is private: enter the bot account at ${status.address ?? 'elise.local'} from a computer.`,
                )}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Ionicons name="wifi-outline" size={16} color={colors.muted} />
          <Text style={styles.footerText}>
            {[status?.address, status?.ipAddress, status?.version].filter(Boolean).join(' · ') ||
              url}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F4EE' },
  content: { paddingHorizontal: 20, paddingBottom: 30, gap: 18 },
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
  iconSpacer: { width: 40 },
  navCaption: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  hero: { alignItems: 'center', paddingHorizontal: 6 },
  logo: { width: 72, height: 72, borderRadius: 22, marginBottom: 16 },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '800',
    marginBottom: 7,
  },
  title: {
    color: colors.navy,
    fontFamily: 'Georgia',
    fontSize: 31,
    lineHeight: 37,
    textAlign: 'center',
  },
  text: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 9, textAlign: 'center' },
  card: {
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 14,
  },
  message: { color: colors.blue, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  messageError: { color: colors.red },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 99,
    backgroundColor: colors.cream,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 99, backgroundColor: colors.accent },
  fillError: { backgroundColor: colors.red },
  percent: { color: colors.navy, fontWeight: '700', minWidth: 42, textAlign: 'right' },
  steps: { gap: 4 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  stepCurrent: { backgroundColor: colors.cream },
  stepFailed: { backgroundColor: colors.redSoft },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCurrent: { borderColor: colors.accent, borderTopColor: 'transparent' },
  dotDone: { backgroundColor: colors.green, borderColor: colors.green },
  dotFailed: { backgroundColor: colors.red, borderColor: colors.red },
  dotMark: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepLabel: { flex: 1, color: colors.blue, fontSize: 14 },
  stepPending: { color: colors.muted },
  stepLabelStrong: { color: colors.navy, fontWeight: '700' },
  stepLabelFailed: { color: colors.red, fontWeight: '700' },
  stepDetail: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FBF0E3',
  },
  noticeText: { flex: 1, color: colors.navy, fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  footerText: { color: colors.muted, fontSize: 12 },
});
