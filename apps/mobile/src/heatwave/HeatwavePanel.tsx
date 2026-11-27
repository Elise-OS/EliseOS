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
  ChevronRight,
  CirclePause,
  Clock3,
  CloudSun,
  ExternalLink,
  GlassWater,
  Hand,
  House,
  Landmark,
  Lightbulb,
  PowerOff,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  ThermometerSnowflake,
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
  heatwaveChips,
  heatwaveReason,
  heatwaveSince,
  heatwaveStateTitle,
  heatwaveStatusLabel,
  heatwaveSteps,
  heatwaveThresholds,
  heatwaveTone,
  heatwaveToday,
  type HeatwaveChipKey,
  type HeatwaveStepKey,
  type HeatwaveThresholdKey,
  type HeatwaveTone,
} from './heatwave-view';
import { HeatwaveSheet, heatwaveQueryKey } from './HeatwaveSheet';

/** Same palette as the web tab: sage, amber and a deep terracotta, never an alarm red. */
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
  blueLine: '#D6E4EB',
  slate: '#4A5866',
  slateSoft: '#EEF1F4',
  slateLine: '#D9DFE5',
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
const toneColors: Record<HeatwaveTone, { tone: string; soft: string; line: string }> = {
  active: { tone: hw.amberDeep, soft: '#FBE6C8', line: hw.amberLine },
  paused: { tone: hw.slate, soft: hw.slateSoft, line: hw.slateLine },
  idle: { tone: colors.blue, soft: hw.blueSoft, line: hw.blueLine },
};
const stepIcons: Record<HeatwaveStepKey, LucideIcon> = {
  detect: ThermometerSun,
  tv: Tv,
  family: Bell,
  stop: PowerOff,
};
const chipIcons: Record<HeatwaveChipKey, LucideIcon> = {
  banner: Tv,
  reminders: GlassWater,
  tips: Lightbulb,
  family: Bell,
  indoor: House,
  forecast: CloudSun,
  manual: Hand,
  rearm: RotateCcw,
};
const thresholdIcons: Record<HeatwaveThresholdKey, LucideIcon> = {
  indoor: House,
  forecast: CloudSun,
  stop: ThermometerSnowflake,
  reminders: GlassWater,
  tips: Lightbulb,
  alert: Bell,
};
const verdictIcons: Record<HeatwaveTone, LucideIcon> = {
  active: Sun,
  paused: CirclePause,
  idle: ThermometerSun,
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
function PulseDot({ tone }: { tone: HeatwaveTone }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const active = tone === 'active';
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
      <View
        style={[
          styles.dot,
          tone === 'active' && styles.dotActive,
          tone === 'idle' && styles.dotIdle,
        ]}
      />
    </View>
  );
}

/** « Activé », « En veille », « En pause » in a small pill. */
export function HeatwaveStatusPill({ status }: { status: HeatwaveStatus }) {
  const tone = heatwaveTone(status);
  return (
    <View
      style={[
        styles.pill,
        tone === 'active' && styles.pillActive,
        tone === 'idle' && styles.pillIdle,
      ]}
    >
      <PulseDot tone={tone} />
      <Text
        style={[
          styles.pillText,
          tone === 'active' && styles.pillTextActive,
          tone === 'idle' && styles.pillTextIdle,
        ]}
      >
        {heatwaveStatusLabel(status)}
      </Text>
    </View>
  );
}

function Degrees({ value, color }: { value: number; color: string }) {
  return (
    <Text style={[styles.figure, { color }]}>
      {celsius(value)}
      <Text style={styles.figureUnit}>{' °C'}</Text>
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
          <Icon size={18} color={palette.tone} />
        </View>
        <Text style={styles.tileTitle} numberOfLines={2}>
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
  const position = (minute: number) => `${((minute - start) / span) * 100}%` as const;
  // Every hour is written under its dot while they fit; otherwise only the first and last.
  const hours = timeline.length <= 7;
  const reached = timeline.filter(({ state }) => state === 'shown' || state === 'past').at(-1);
  const hasNext = timeline.some(({ state }) => state === 'next');
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
      style={[styles.timeline, hasNext && styles.timelineWithTag]}
    >
      <View style={[styles.timelineTrack, hours && styles.timelineTrackHours]}>
        <View style={styles.timelineLine} />
        {reached ? (
          <View style={[styles.timelineProgress, { width: position(reached.minute) }]} />
        ) : null}
        {timeline.map(({ minute, state }) => (
          <View key={minute} style={[styles.timelineSlot, { left: position(minute) }]}>
            {state === 'next' ? (
              <Text style={styles.timelineTag}>{t('heatwave.today.next')}</Text>
            ) : null}
            <View style={styles.timelineDotBox}>
              <View
                style={[
                  styles.timelineDot,
                  state === 'shown' && styles.timelineShown,
                  state === 'past' && styles.timelinePast,
                  state === 'next' && styles.timelineNext,
                ]}
              />
            </View>
            {hours ? (
              <Text
                style={[
                  styles.timelineHour,
                  state === 'shown' && { color: hw.amberDeep },
                  state === 'next' && styles.timelineHourNext,
                ]}
              >
                {hour(minute)}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <View style={[styles.timelineLabels, hours && styles.timelineLabelsEnd]}>
        {!hours ? <Text style={styles.timelineHour}>{hour(start)}</Text> : null}
        <View style={styles.legend}>
          <View style={[styles.legendDot, styles.timelineShown]} />
          <Text style={styles.legendText}>{t('heatwave.today.shown')}</Text>
          <View style={[styles.legendDot, styles.legendNext]} />
          <Text style={styles.legendText}>{t('heatwave.today.next')}</Text>
        </View>
        {!hours ? (
          <Text style={styles.timelineHour}>{hour(settings.reminders.endHour * 60)}</Text>
        ) : null}
      </View>
    </View>
  );
}

function useHeatwave(server: SavedServer, token: string) {
  return useQuery({
    queryKey: heatwaveQueryKey(server),
    queryFn: () => mobileApi.heatwave(server, token),
    refetchInterval: 60_000,
  });
}

const unsupported = (error: unknown) => error instanceof MobileApiError && error.status === 404;

/**
 * Entry row of the « Canicule » tab in the list of the settings, with the live state of the mode.
 * Hidden on a box too old to know the heatwave mode.
 */
export function HeatwaveSettingsRow({
  server,
  token,
  onPress,
}: {
  server: SavedServer;
  token: string;
  onPress: () => void;
}) {
  const status = useHeatwave(server, token);
  if (unsupported(status.error)) return null;
  const data = status.data;
  const active = data?.active ?? false;
  const body = data ? heatwaveReason(data) : t('heatwave.card.settingsIntro');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        t('heatwave.card.settingsTitle'),
        data ? heatwaveStatusLabel(data) : '',
        body,
      ]
        .filter(Boolean)
        .join('. ')}
      accessibilityHint={t('heatwave.panel.openTab')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
    >
      <View style={[styles.rowIcon, active && styles.rowIconActive]}>
        <ThermometerSun size={20} color={active ? hw.amberDeep : hw.blue} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowEyebrow}>{t('heatwave.card.settingsEyebrow').toUpperCase()}</Text>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle}>{t('heatwave.card.settingsTitle')}</Text>
          {data ? <HeatwaveStatusPill status={data} /> : null}
        </View>
        <Text style={styles.rowBody} numberOfLines={2}>
          {body}
        </Text>
      </View>
      <ChevronRight size={19} color={colors.muted} />
    </Pressable>
  );
}

/**
 * « Canicule » tab of the settings: a strong state card (amber when on, calm otherwise) with the
 * reason in plain words and what Élise does, today's figures and the reminders of the day, the
 * saved thresholds, how the mode works in four illustrated steps, the town hall register and a
 * discreet medical notice. Every member reads it; owners and administrators turn the mode on or
 * off and open the settings sheet.
 */
export function HeatwavePanel({ server, token }: { server: SavedServer; token: string }) {
  const queryClient = useQueryClient();
  const queryKey = heatwaveQueryKey(server);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = useHeatwave(server, token);
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

  if (unsupported(status.error))
    return (
      <View style={[styles.card, styles.empty]} accessibilityRole="summary">
        <View style={styles.emptyIcon}>
          <ThermometerSun size={22} color={hw.blue} />
        </View>
        <View style={[styles.flex, styles.gap4]}>
          <Text style={styles.cardTitle}>{t('heatwave.panel.unsupportedTitle')}</Text>
          <Text style={styles.cardText}>{t('heatwave.panel.unsupported')}</Text>
        </View>
      </View>
    );
  if (!data)
    return (
      <View style={[styles.card, styles.loading]}>
        {status.isPending ? (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>{t('heatwave.card.loading')}</Text>
          </>
        ) : (
          <>
            <Text style={styles.error}>{t('heatwave.card.error')}</Text>
            <ActionButton label={t('heatwave.card.retry')} onPress={() => void status.refetch()} />
          </>
        )}
      </View>
    );

  const tone = heatwaveTone(data);
  const palette = toneColors[tone];
  const active = tone === 'active';
  const today = heatwaveToday(data);
  const since = heatwaveSince(data);
  const VerdictIcon = verdictIcons[tone];
  return (
    <View style={styles.stack}>
      <View
        style={[styles.verdict, { borderColor: palette.line }, active && styles.verdictActive]}
        accessibilityLiveRegion="polite"
      >
        <Svg
          pointerEvents="none"
          width="100%"
          height="100%"
          style={StyleSheet.absoluteFill}
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id="heatwaveVerdict" x1="0%" y1="0%" x2="60%" y2="100%">
              <Stop offset="0%" stopColor={active ? '#FADBB0' : palette.soft} stopOpacity={1} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heatwaveVerdict)" />
        </Svg>
        <View style={[styles.verdictEdge, { backgroundColor: palette.tone }]} />
        <View style={styles.verdictHead}>
          <View
            style={[
              styles.verdictIcon,
              { borderColor: palette.line },
              active && styles.verdictIconActive,
            ]}
          >
            <VerdictIcon size={28} color={active ? '#A35F17' : palette.tone} />
          </View>
          <HeatwaveStatusPill status={data} />
        </View>
        <Text
          style={[styles.verdictTitle, { color: tone === 'idle' ? colors.navy : palette.tone }]}
          accessibilityRole="header"
        >
          {heatwaveStateTitle(data)}
        </Text>
        <Text style={styles.verdictReason}>{heatwaveReason(data)}</Text>
        {since ? (
          <View style={styles.since}>
            <Clock3 size={14} color={hw.text} />
            <Text style={styles.sinceText}>{since}</Text>
          </View>
        ) : null}
        <View style={styles.chips} accessibilityLabel={t('heatwave.panel.nowTitle')}>
          {heatwaveChips(data).map((chip) => {
            const Icon = chipIcons[chip.key];
            const color = active ? hw.amberDeep : tone === 'idle' ? '#2B5670' : hw.slate;
            return (
              <View key={chip.key} style={[styles.chip, { borderColor: palette.line }]}>
                <Icon size={15} color={color} />
                <Text style={[styles.chipText, { color }]}>{chip.text}</Text>
              </View>
            );
          })}
        </View>
        {data.canToggle || data.canManage ? (
          <View style={styles.actions}>
            {data.canToggle ? (
              <ActionButton
                label={data.active ? t('heatwave.card.deactivate') : t('heatwave.card.activate')}
                icon={
                  data.active ? (
                    <PowerOff size={17} color={colors.blue} />
                  ) : (
                    <Sun size={17} color="#FFFFFF" />
                  )
                }
                primary={!data.active}
                busy={busy}
                onPress={() =>
                  void run(() => mobileApi.setHeatwaveManual(server, token, !data.active))
                }
              />
            ) : null}
            {data.canManage ? (
              <ActionButton
                label={t('heatwave.panel.edit')}
                icon={<SlidersHorizontal size={17} color={colors.blue} />}
                disabled={busy}
                onPress={() => setSettingsOpen(true)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Text style={styles.heading} accessibilityRole="header">
        {t('heatwave.card.todayTitle')}
      </Text>
      <View style={styles.tiles}>
        <Tile icon={House} title={t('heatwave.today.indoorTitle')} level={today.indoor.level}>
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
              <View style={[styles.gaugeMark, { left: `${today.indoor.gauge.trigger * 100}%` }]} />
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
            today.reminders.next ? <Text style={styles.next}>{today.reminders.next}</Text> : null
          }
        >
          <View style={styles.reminderRow}>
            {today.reminders.figure !== null ? (
              <Text style={[styles.figure, { color: colors.navy }]}>{today.reminders.figure}</Text>
            ) : null}
            <Text style={[styles.caption, styles.flex]}>{today.reminders.caption}</Text>
          </View>
          {today.reminders.enabled ? (
            <Timeline settings={data.settings} timeline={today.reminders.timeline} />
          ) : null}
        </Tile>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderIcon}>
            <SlidersHorizontal size={18} color={hw.blue} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardHeading} accessibilityRole="header">
              {t('heatwave.panel.settingsTitle')}
            </Text>
            <Text style={styles.cardSub}>{t('heatwave.panel.settingsIntro')}</Text>
          </View>
          {data.canManage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('heatwave.panel.edit')}
              hitSlop={6}
              onPress={() => setSettingsOpen(true)}
              style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
            >
              <Text style={styles.editText}>{t('heatwave.panel.editShort')}</Text>
            </Pressable>
          ) : null}
        </View>
        {heatwaveThresholds(data.settings).map((row) => {
          const Icon = thresholdIcons[row.key];
          return (
            <View
              key={row.key}
              style={styles.threshold}
              accessible
              accessibilityLabel={`${row.label} : ${row.value}`}
            >
              <View style={styles.thresholdLabel}>
                <Icon
                  size={16}
                  color={row.off ? '#8B98A3' : row.key === 'stop' ? hw.sage : hw.amberDeep}
                />
                <Text style={styles.thresholdLabelText}>{row.label}</Text>
              </View>
              <Text style={[styles.thresholdValue, row.off && styles.thresholdOff]}>
                {row.value}
              </Text>
            </View>
          );
        })}
        {!data.canManage ? <Text style={styles.note}>{t('heatwave.card.readOnly')}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading} accessibilityRole="header">
          {t('heatwave.how.title')}
        </Text>
        <Text style={[styles.cardSub, styles.howIntro]}>{t('heatwave.panel.howIntro')}</Text>
        {heatwaveSteps(data).map((step, index, steps) => {
          const Icon = stepIcons[step.key];
          const last = index === steps.length - 1;
          return (
            <View key={step.key} style={styles.step}>
              <View style={styles.stepRail}>
                <View style={[styles.stepIcon, step.key === 'stop' && styles.stepIconStop]}>
                  <Icon size={20} color={step.key === 'stop' ? hw.sage : hw.amberDeep} />
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
          <Landmark size={19} color={data.registry.due ? hw.amberDeep : hw.blue} />
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
            <ActionButton
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

      <View style={styles.medical}>
        <ShieldCheck size={16} color={hw.blue} />
        <Text style={styles.medicalText}>{t('heatwave.notMedical')}</Text>
      </View>

      {settingsOpen ? (
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

function ActionButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  primary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  icon?: ReactNode;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        off && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? '#FFFFFF' : colors.blue} /> : icon}
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  gap4: { gap: 4 },
  pressed: { opacity: 0.82 },

  // Entry row in the list of the settings.
  row: {
    minHeight: 76,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.paper,
  },
  rowActive: { borderColor: '#ECD6B6', backgroundColor: '#FFF8EF' },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hw.blueSoft,
  },
  rowIconActive: { backgroundColor: '#F8DFB8' },
  rowEyebrow: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  rowTitleLine: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: { color: colors.navy, fontSize: 16, fontWeight: '900' },
  rowBody: { marginTop: 3, color: colors.muted, fontSize: 13, lineHeight: 19 },

  // State pill.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EEF2F4',
  },
  pillActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F0D3A8' },
  pillIdle: { backgroundColor: '#E3EEF4' },
  pillText: { color: '#44535F', fontSize: 12, fontWeight: '800' },
  pillTextActive: { color: hw.amberDeep },
  pillTextIdle: { color: '#2B5670' },
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
  dotIdle: { backgroundColor: hw.blue },

  // State card.
  verdict: {
    overflow: 'hidden',
    gap: 8,
    padding: 18,
    paddingLeft: 20,
    borderRadius: 24,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    shadowColor: '#1D374F',
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  verdictActive: { shadowColor: '#9A5D1D', shadowOpacity: 0.14 },
  verdictEdge: {
    position: 'absolute',
    left: 0,
    top: 22,
    bottom: 22,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    opacity: 0.8,
  },
  verdictHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verdictIcon: {
    width: 56,
    height: 56,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  verdictIconActive: {
    borderRadius: 28,
    borderWidth: 6,
    borderColor: 'rgba(248, 214, 163, 0.45)',
    backgroundColor: '#FBE3BC',
    shadowColor: '#9A5D1D',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  verdictTitle: { marginTop: 4, fontFamily: 'Georgia', fontSize: 24, lineHeight: 30 },
  verdictReason: { color: colors.navy, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  since: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sinceText: { color: hw.text, fontSize: 12.5, fontWeight: '600' },
  chips: { marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    minHeight: 32,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  chipText: { fontSize: 12.5, fontWeight: '800' },
  actions: { marginTop: 8, gap: 9 },

  // Sections.
  heading: { marginTop: 6, color: colors.navy, fontFamily: 'Georgia', fontSize: 20 },
  card: {
    gap: 4,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E7E8',
    backgroundColor: '#FFFFFF',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 6 },
  cardHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hw.blueSoft,
  },
  cardHeading: { color: colors.navy, fontFamily: 'Georgia', fontSize: 19 },
  cardSub: { color: hw.muted, fontSize: 12.5, lineHeight: 18 },
  cardTitle: { color: colors.navy, fontSize: 15, fontWeight: '800' },
  cardText: { color: hw.text, fontSize: 13.5, lineHeight: 20 },
  empty: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hw.blueSoft,
  },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 22 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: colors.red, fontSize: 13, lineHeight: 19 },
  note: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DCE3E6',
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  editButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D3DFE6',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  editText: { color: colors.blue, fontSize: 13.5, fontWeight: '800' },

  // Saved thresholds.
  threshold: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DCE3E6',
    gap: 3,
  },
  thresholdLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thresholdLabelText: { flexShrink: 1, color: hw.text, fontSize: 13, fontWeight: '600' },
  thresholdValue: {
    paddingLeft: 24,
    color: colors.navy,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  thresholdOff: { color: hw.muted, fontWeight: '600' },

  // Today's tiles.
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    gap: 4,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: hw.line,
    backgroundColor: '#FFFFFF',
  },
  tileWide: { flexBasis: '100%' },
  tileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  tileIcon: {
    width: 32,
    height: 32,
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
  figure: { fontFamily: 'Georgia', fontSize: 34, lineHeight: 40 },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
  figureUnit: { color: hw.muted, fontSize: 15, fontWeight: '700' },
  caption: { color: hw.muted, fontSize: 13, lineHeight: 18 },
  gauge: { height: 8, marginTop: 8, borderRadius: 999, backgroundColor: '#EFEAE2' },
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
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.blue,
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // Timeline of the reminders.
  timeline: { marginTop: 6 },
  timelineWithTag: { marginTop: 22 },
  timelineTrack: { height: 28, marginHorizontal: 12 },
  timelineTrackHours: { height: 46 },
  timelineLine: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E3E9EC',
  },
  timelineProgress: {
    position: 'absolute',
    top: 12,
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5B47A',
  },
  timelineSlot: {
    position: 'absolute',
    top: 0,
    width: 48,
    marginLeft: -24,
    alignItems: 'center',
  },
  timelineDotBox: { height: 28, alignItems: 'center', justifyContent: 'center' },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#C6D3DA',
    backgroundColor: '#FFFFFF',
  },
  timelineShown: { borderColor: '#C97C2C', backgroundColor: '#D99A55' },
  timelinePast: { borderColor: '#D4DADE', backgroundColor: '#EEF1F3' },
  timelineNext: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: colors.blue,
  },
  timelineTag: {
    position: 'absolute',
    top: -18,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: colors.blue,
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  timelineHour: { color: hw.muted, fontSize: 11.5, fontWeight: '700' },
  timelineHourNext: { color: colors.blue, fontWeight: '900' },
  timelineLabels: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timelineLabelsEnd: { justifyContent: 'flex-end' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: {
    width: 10,
    height: 10,
    marginLeft: 4,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#C6D3DA',
  },
  legendNext: { borderColor: colors.blue, backgroundColor: '#FFFFFF' },
  legendText: { color: hw.muted, fontSize: 11.5 },

  // How it works.
  howIntro: { marginBottom: 10 },
  step: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center' },
  stepIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8E2C2',
  },
  stepIconStop: { backgroundColor: '#DCEDE3' },
  stepNumber: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 19,
    height: 19,
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: colors.blue,
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '900',
    lineHeight: 15,
    textAlign: 'center',
  },
  stepLine: { flex: 1, width: 2, marginVertical: 4, borderRadius: 1, backgroundColor: '#ECD6B6' },
  stepCopy: { paddingBottom: 16 },
  stepTitle: { marginTop: 2, color: colors.navy, fontSize: 15, fontWeight: '800' },
  stepText: { marginTop: 3, color: hw.text, fontSize: 13.5, lineHeight: 20 },

  // Town hall register.
  callout: {
    flexDirection: 'row',
    gap: 12,
    padding: 15,
    borderRadius: 20,
    backgroundColor: hw.blueSoft,
  },
  calloutDue: { backgroundColor: '#FDF3E4', borderWidth: 1, borderColor: hw.amberLine },
  calloutIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  calloutCopy: { gap: 6 },
  calloutTitle: { color: colors.navy, fontSize: 15, fontWeight: '800' },
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
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { flexShrink: 1, color: colors.accent, fontSize: 14, fontWeight: '800' },

  // Discreet medical notice.
  medical: {
    flexDirection: 'row',
    gap: 9,
    paddingTop: 12,
    paddingHorizontal: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D8D2C8',
  },
  medicalText: { flex: 1, color: hw.muted, fontSize: 12.5, lineHeight: 18 },

  // Buttons.
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D3DFE6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  buttonPrimary: { borderColor: colors.blue, backgroundColor: colors.blue },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.blue, fontSize: 14.5, fontWeight: '800' },
  buttonTextPrimary: { color: '#FFFFFF' },
});
