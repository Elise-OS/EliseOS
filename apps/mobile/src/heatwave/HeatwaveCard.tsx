import {
  HEATWAVE_REGISTRY_URL,
  type HeatwaveLevel,
  type HeatwaveSettings,
  type HeatwaveStatus,
  type HeatwaveTimelineState,
} from '@elise/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CloudSun,
  ExternalLink,
  GlassWater,
  House,
  Landmark,
  PowerOff,
  ShieldCheck,
  SlidersHorizontal,
  ThermometerSun,
  Tv,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { MobileApiError, mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import { colors } from '../theme';
import {
  celsius,
  heatwaveReason,
  heatwaveStatusLabel,
  heatwaveSteps,
  heatwaveTone,
  heatwaveToday,
  type HeatwaveStepKey,
} from './heatwave-view';
import { HeatwaveSheet, heatwaveQueryKey } from './HeatwaveSheet';

/** Same palette as the web card: sage, amber and a deep terracotta, never an alarm red. */
const hw = {
  amberDeep: '#8F5519',
  amberSoft: '#FBEFDF',
  amberLine: '#F0D7B2',
  sage: '#3F6F56',
  sageSoft: '#E7F1EB',
  hot: '#9A3F22',
  hotSoft: '#FBE7DC',
  blue: '#376884',
  blueSoft: '#EAF2F6',
  text: '#3D4F61',
  muted: '#5D6B78',
  line: '#EBE3D6',
};
const levelColors: Record<HeatwaveLevel | 'none', { tone: string; soft: string }> = {
  comfortable: { tone: hw.sage, soft: hw.sageSoft },
  warm: { tone: hw.amberDeep, soft: hw.amberSoft },
  hot: { tone: hw.hot, soft: hw.hotSoft },
  none: { tone: hw.blue, soft: hw.blueSoft },
};
const stepIcons: Record<HeatwaveStepKey, LucideIcon> = {
  detect: ThermometerSun,
  tv: Tv,
  family: Bell,
  stop: PowerOff,
};

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => alive && setReduce(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

/** The small amber dot of « Activé », breathing slowly unless motion is reduced. */
function PulseDot({ active }: { active: boolean }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || reduce) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduce, pulse]);
  return (
    <View style={styles.dotWrap}>
      {active ? (
        <Animated.View
          style={[
            styles.dotHalo,
            {
              opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.8, 0, 0] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2] }) },
              ],
            },
          ]}
        />
      ) : null}
      <View style={[styles.dot, active && styles.dotActive]} />
    </View>
  );
}

function Degrees({ value, color }: { value: number; color: string }) {
  return (
    <Text style={[styles.figure, { color }]}>
      {celsius(value)}
      <Text style={styles.figureUnit}>{'\u00a0°C'}</Text>
    </Text>
  );
}

function LevelChip({ level }: { level: HeatwaveLevel | null }) {
  if (!level) return null;
  const palette = levelColors[level];
  return (
    <Text style={[styles.level, { color: palette.tone, backgroundColor: palette.soft }]}>
      {t(`heatwave.level.${level}`)}
    </Text>
  );
}

function Tile({
  icon: Icon,
  title,
  level,
  aside,
  wide = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  level: HeatwaveLevel | null;
  aside?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const palette = levelColors[level ?? 'none'];
  return (
    <View
      style={[
        styles.tile,
        wide && styles.tileWide,
        level === 'warm' && { borderColor: hw.amberLine },
        level === 'hot' && { borderColor: '#F0D1C2' },
      ]}
    >
      <View style={styles.tileHeader}>
        <View style={[styles.tileIcon, { backgroundColor: palette.soft }]}>
          <Icon size={17} color={palette.tone} />
        </View>
        <Text style={styles.tileTitle} numberOfLines={1}>
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

const timelineLabel = (state: HeatwaveTimelineState) =>
  ({
    shown: t('heatwave.today.shown'),
    past: t('heatwave.today.past'),
    next: t('heatwave.today.next'),
    later: t('heatwave.today.later'),
  })[state];

/** Reminders of the day from the first to the last hour: dots on a line, purely informative. */
function Timeline({
  settings,
  timeline,
}: {
  settings: HeatwaveSettings;
  timeline: ReturnType<typeof heatwaveToday>['reminders']['timeline'];
}) {
  const start = settings.reminders.startHour * 60;
  const span = Math.max(60, settings.reminders.endHour * 60 - start);
  const hour = (minute: number) => t('heatwave.today.hour', { hour: Math.floor(minute / 60) });
  return (
    <View
      accessible
      accessibilityLabel={[
        t('heatwave.today.timeline', {
          start: settings.reminders.startHour,
          end: settings.reminders.endHour,
        }),
        ...timeline.map(({ minute, state }) => `${hour(minute)} · ${timelineLabel(state)}`),
      ].join('. ')}
      style={styles.timeline}
    >
      <View style={styles.timelineTrack}>
        <View style={styles.timelineLine} />
        {timeline.map(({ minute, state }) => (
          <View
            key={minute}
            style={[
              styles.timelineDot,
              state === 'shown' && styles.timelineShown,
              state === 'past' && styles.timelinePast,
              state === 'next' && styles.timelineNext,
              { left: `${((minute - start) / span) * 100}%` },
            ]}
          />
        ))}
      </View>
      <View style={styles.timelineLabels}>
        <Text style={styles.timelineHour}>{hour(start)}</Text>
        <View style={styles.legend}>
          <View style={[styles.legendDot, styles.timelineShown]} />
          <Text style={styles.legendText}>{t('heatwave.today.shown')}</Text>
          <View style={[styles.legendDot, styles.legendNext]} />
          <Text style={styles.legendText}>{t('heatwave.today.next')}</Text>
        </View>
        <Text style={styles.timelineHour}>{hour(settings.reminders.endHour * 60)}</Text>
      </View>
    </View>
  );
}

/**
 * « Canicule » card of the Settings tab: the state of the mode and why, today's figures on a calm
 * heat scale, the reminders of the day, how the mode works in four steps from the saved settings,
 * the town hall register and the medical notice. Owners and administrators open the settings
 * sheet; every member reads the card. Hidden on a box too old to know the heatwave mode.
 */
export function HeatwaveCard({ server, token }: { server: SavedServer; token: string }) {
  const queryClient = useQueryClient();
  const queryKey = heatwaveQueryKey(server);
  const [expanded, setExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reduce = useReduceMotion();
  const status = useQuery({
    queryKey,
    queryFn: () => mobileApi.heatwave(server, token),
    refetchInterval: 60_000,
  });
  if (status.error instanceof MobileApiError && status.error.status === 404) return null;
  const data = status.data;

  const run = async (work: () => Promise<HeatwaveStatus>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      queryClient.setQueryData(queryKey, await work());
    } catch {
      setError(t('heatwave.card.actionError'));
    } finally {
      setBusy(false);
    }
  };

  const tone = data ? heatwaveTone(data) : 'idle';
  const active = tone === 'active';
  const today = data ? heatwaveToday(data) : null;
  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <Svg
        pointerEvents="none"
        width="100%"
        height={180}
        style={styles.wash}
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id="heatwaveWash" x1="0%" y1="0%" x2="70%" y2="100%">
            <Stop offset="0%" stopColor={active ? '#FADBB0' : '#EEF3F5'} stopOpacity={0.9} />
            <Stop offset="100%" stopColor="#FDFBF7" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heatwaveWash)" />
      </Svg>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[
          t('heatwave.card.settingsTitle'),
          data ? heatwaveStatusLabel(data) : '',
          data ? heatwaveReason(data) : '',
        ]
          .filter(Boolean)
          .join('. ')}
        style={styles.header}
        onPress={() => {
          if (!reduce) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded((value) => !value);
        }}
      >
        <View style={[styles.badge, !active && styles.badgeIdle]}>
          <ThermometerSun size={24} color={active ? hw.amberDeep : hw.blue} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{t('heatwave.card.settingsEyebrow').toUpperCase()}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('heatwave.card.settingsTitle')}</Text>
            {data ? (
              <View style={[styles.pill, active && styles.pillActive]}>
                <PulseDot active={active} />
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {heatwaveStatusLabel(data)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.reason}>
            {data ? heatwaveReason(data) : t('heatwave.card.settingsIntro')}
          </Text>
        </View>
        {expanded ? (
          <ChevronDown size={20} color={colors.muted} />
        ) : (
          <ChevronRight size={20} color={colors.muted} />
        )}
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {!data || !today ? (
            status.isPending ? (
              <View style={styles.loading} accessibilityRole="progressbar">
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.muted}>{t('heatwave.card.loading')}</Text>
              </View>
            ) : (
              <View style={styles.stack}>
                <Text style={styles.error}>{t('heatwave.card.error')}</Text>
                <SmallButton
                  label={t('heatwave.card.retry')}
                  onPress={() => void status.refetch()}
                />
              </View>
            )
          ) : (
            <>
              {data.canToggle || data.canManage ? (
                <View style={styles.actions}>
                  {data.canToggle ? (
                    <SmallButton
                      label={
                        data.active ? t('heatwave.card.deactivate') : t('heatwave.card.activate')
                      }
                      primary={!data.active}
                      disabled={busy}
                      onPress={() =>
                        void run(() => mobileApi.setHeatwaveManual(server, token, !data.active))
                      }
                    />
                  ) : null}
                  {data.canManage ? (
                    <SmallButton
                      label={t('heatwave.card.settings')}
                      icon={<SlidersHorizontal size={16} color={colors.blue} />}
                      disabled={busy}
                      onPress={() => setSettingsOpen(true)}
                    />
                  ) : null}
                </View>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Text style={styles.heading} accessibilityRole="header">
                {t('heatwave.card.todayTitle')}
              </Text>
              <View style={styles.tiles}>
                <Tile
                  icon={House}
                  title={t('heatwave.today.indoorTitle')}
                  level={today.indoor.level}
                >
                  {today.indoor.value !== null ? (
                    <View style={styles.figureRow}>
                      <Degrees
                        value={today.indoor.value}
                        color={levelColors[today.indoor.level ?? 'none'].tone}
                      />
                      <LevelChip level={today.indoor.level} />
                    </View>
                  ) : null}
                  <Text style={styles.caption}>{today.indoor.caption}</Text>
                  {today.indoor.gauge ? (
                    <View
                      accessible
                      accessibilityLabel={t('heatwave.today.gauge', {
                        min: today.indoor.gauge.min,
                        max: today.indoor.gauge.max,
                        trigger: celsius(data.settings.indoorTrigger.celsius),
                        alert: celsius(
                          data.settings.alert.enabled
                            ? data.settings.alert.celsius
                            : data.settings.indoorTrigger.celsius + 3,
                        ),
                      })}
                      style={styles.gauge}
                    >
                      <View
                        style={[
                          styles.gaugeFill,
                          {
                            width: `${today.indoor.gauge.value * 100}%`,
                            backgroundColor: levelColors[today.indoor.level ?? 'none'].tone,
                          },
                        ]}
                      />
                      <View
                        style={[styles.gaugeMark, { left: `${today.indoor.gauge.trigger * 100}%` }]}
                      />
                      <View
                        style={[
                          styles.gaugeMark,
                          styles.gaugeAlert,
                          { left: `${today.indoor.gauge.alert * 100}%` },
                        ]}
                      />
                    </View>
                  ) : null}
                </Tile>
                <Tile icon={CloudSun} title={today.forecast.title} level={today.forecast.level}>
                  {today.forecast.value !== null ? (
                    <View style={styles.figureRow}>
                      <Degrees
                        value={today.forecast.value}
                        color={levelColors[today.forecast.level ?? 'none'].tone}
                      />
                      <LevelChip level={today.forecast.level} />
                    </View>
                  ) : null}
                  <Text style={styles.caption}>{today.forecast.caption}</Text>
                </Tile>
                <Tile
                  icon={GlassWater}
                  title={t('heatwave.today.remindersTitle')}
                  level={null}
                  wide
                  aside={
                    today.reminders.next ? (
                      <Text style={styles.next}>{today.reminders.next}</Text>
                    ) : null
                  }
                >
                  <View style={styles.reminderRow}>
                    {today.reminders.figure !== null ? (
                      <Text style={[styles.figure, { color: colors.navy }]}>
                        {today.reminders.figure}
                      </Text>
                    ) : null}
                    <Text style={[styles.caption, styles.flex]}>{today.reminders.caption}</Text>
                  </View>
                  {today.reminders.enabled ? (
                    <Timeline settings={data.settings} timeline={today.reminders.timeline} />
                  ) : null}
                </Tile>
              </View>

              <Text style={styles.heading} accessibilityRole="header">
                {t('heatwave.how.title')}
              </Text>
              <View>
                {heatwaveSteps(data).map((step, index, steps) => {
                  const Icon = stepIcons[step.key];
                  const last = index === steps.length - 1;
                  return (
                    <View key={step.key} style={styles.step}>
                      <View style={styles.stepRail}>
                        <View style={[styles.stepIcon, step.key === 'stop' && styles.stepIconStop]}>
                          <Icon size={19} color={step.key === 'stop' ? hw.sage : hw.amberDeep} />
                          <Text style={styles.stepNumber}>{index + 1}</Text>
                        </View>
                        {!last ? <View style={styles.stepLine} /> : null}
                      </View>
                      <View style={[styles.flex, !last && styles.stepCopy]}>
                        <Text style={styles.stepTitle}>{step.title}</Text>
                        <Text style={styles.stepText}>{step.text}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={[styles.callout, data.registry.due && styles.calloutDue]}>
                <View style={styles.calloutIcon}>
                  <Landmark size={18} color={data.registry.due ? hw.amberDeep : hw.blue} />
                </View>
                <View style={[styles.flex, styles.calloutCopy]}>
                  <Text style={styles.calloutTitle}>{t('heatwave.registry.title')}</Text>
                  {data.registry.due ? (
                    <Text style={styles.calloutBadge}>{t('heatwave.callout.registryDue')}</Text>
                  ) : null}
                  <Text style={styles.calloutText}>{t('heatwave.registry.text')}</Text>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(HEATWAVE_REGISTRY_URL)}
                    style={styles.link}
                  >
                    <Text style={styles.linkText}>{t('heatwave.registry.link')}</Text>
                    <ExternalLink size={15} color={colors.accent} />
                  </Pressable>
                  {data.registry.due && data.canToggle ? (
                    <SmallButton
                      label={t('heatwave.registry.done')}
                      disabled={busy}
                      onPress={() =>
                        void run(() =>
                          mobileApi.acknowledgeHeatwaveRegistry(server, token, data.registry.year),
                        )
                      }
                    />
                  ) : null}
                </View>
              </View>
              <View style={[styles.callout, styles.calloutMedical]}>
                <View style={styles.calloutIcon}>
                  <ShieldCheck size={18} color={hw.blue} />
                </View>
                <View style={[styles.flex, styles.calloutCopy]}>
                  <Text style={styles.calloutTitle}>{t('heatwave.how.medicalTitle')}</Text>
                  <Text style={styles.calloutText}>{t('heatwave.notMedical')}</Text>
                </View>
              </View>
              {!data.canManage ? (
                <Text style={styles.muted}>{t('heatwave.card.readOnly')}</Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {settingsOpen && data ? (
        <HeatwaveSheet
          server={server}
          token={token}
          settings={data.settings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </View>
  );
}

function SmallButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  cardActive: { borderColor: '#ECD6B6' },
  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8DFB8',
    borderWidth: 4,
    borderColor: 'rgba(246, 217, 174, 0.45)',
    shadowColor: '#9A5D1D',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  badgeIdle: {
    backgroundColor: '#E6EEF2',
    borderColor: 'rgba(214, 228, 235, 0.6)',
    shadowOpacity: 0.06,
  },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { marginTop: 2, color: colors.navy, fontFamily: 'Georgia', fontSize: 22 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EEF2F4',
  },
  pillActive: { backgroundColor: hw.amberSoft, borderWidth: 1, borderColor: hw.amberLine },
  pillText: { color: '#44535F', fontSize: 12, fontWeight: '800' },
  pillTextActive: { color: hw.amberDeep },
  dotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dotHalo: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(217, 154, 85, 0.5)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8B98A3' },
  dotActive: { backgroundColor: '#C97C2C' },
  reason: { marginTop: 4, color: hw.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  body: { marginTop: 16, gap: 12 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  stack: { gap: 10 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.red, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heading: { marginTop: 6, color: colors.navy, fontFamily: 'Georgia', fontSize: 19 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    gap: 4,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: hw.line,
    backgroundColor: '#FFFFFF',
  },
  tileWide: { flexBasis: '100%' },
  tileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { flex: 1, color: hw.text, fontSize: 13, fontWeight: '700' },
  level: {
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '800',
  },
  figure: { fontFamily: 'Georgia', fontSize: 32, lineHeight: 38 },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
  figureUnit: { color: hw.muted, fontSize: 15, fontWeight: '700' },
  caption: { color: hw.muted, fontSize: 13, lineHeight: 18 },
  gauge: {
    height: 8,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: '#EFEAE2',
  },
  gaugeFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 999 },
  gaugeMark: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 14,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#8F7A63',
  },
  gaugeAlert: { backgroundColor: hw.hot },
  next: {
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: hw.blueSoft,
    color: '#2B5670',
    fontSize: 11,
    fontWeight: '800',
  },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeline: { marginTop: 6 },
  timelineTrack: { height: 26, marginHorizontal: 9, justifyContent: 'center' },
  timelineLine: { height: 3, borderRadius: 2, backgroundColor: '#E3E9EC' },
  timelineDot: {
    position: 'absolute',
    top: 7,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#C6D3DA',
    backgroundColor: '#FFFFFF',
  },
  timelineShown: { borderColor: '#C97C2C', backgroundColor: '#D99A55' },
  timelinePast: { borderColor: '#D4DADE', backgroundColor: '#EEF1F3' },
  timelineNext: {
    top: 4,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: colors.blue,
  },
  timelineLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timelineHour: { color: hw.muted, fontSize: 12, fontWeight: '700' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: {
    width: 9,
    height: 9,
    marginLeft: 4,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#C6D3DA',
  },
  legendNext: { borderColor: colors.blue, backgroundColor: '#FFFFFF' },
  legendText: { color: hw.muted, fontSize: 11 },
  step: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center' },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8E2C2',
  },
  stepIconStop: { backgroundColor: '#DCEDE3' },
  stepNumber: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    overflow: 'hidden',
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: colors.blue,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 14,
    textAlign: 'center',
  },
  stepLine: { flex: 1, width: 2, marginVertical: 4, backgroundColor: '#ECD6B6' },
  stepCopy: { paddingBottom: 16 },
  stepTitle: { color: colors.navy, fontSize: 15, fontWeight: '800' },
  stepText: { marginTop: 3, color: hw.text, fontSize: 13, lineHeight: 20 },
  callout: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: hw.blueSoft,
  },
  calloutDue: { backgroundColor: '#FDF3E4', borderWidth: 1, borderColor: hw.amberLine },
  calloutMedical: { backgroundColor: '#F3F5F6', borderWidth: 1, borderColor: '#E3E8EB' },
  calloutIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  calloutCopy: { gap: 5 },
  calloutTitle: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  calloutBadge: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    color: hw.amberDeep,
    fontSize: 11,
    fontWeight: '800',
  },
  calloutText: { color: '#23415C', fontSize: 13, lineHeight: 19 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  linkText: { flexShrink: 1, color: colors.accent, fontSize: 14, fontWeight: '800' },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  buttonPrimary: { borderColor: colors.blue, backgroundColor: colors.blue },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  buttonTextPrimary: { color: '#FFFFFF' },
  pressed: { opacity: 0.8 },
});
