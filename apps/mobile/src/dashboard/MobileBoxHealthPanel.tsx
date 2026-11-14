import type { BoxHealthCheck, BoxHealthLevel, BoxHealthReport } from '@elise/contracts';
import {
  Activity,
  Archive,
  BatteryLow,
  Bell,
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  CircleQuestionMark,
  Clock,
  CloudOff,
  Cpu,
  Database,
  DatabaseBackup,
  Eye,
  FileWarning,
  Gauge,
  Globe,
  HardDrive,
  House,
  Inbox,
  KeyRound,
  MemoryStick,
  OctagonAlert,
  Radar,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Thermometer,
  TriangleAlert,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { dateLocale, t } from '../i18n';
import { colors } from '../theme';
import {
  BACKUP_POLL_MS,
  actionDestination,
  backupRunning,
  bannerOf,
  checkCopy,
  groupTone,
  isKnownCheck,
  isKnownGroup,
  orderedGroups,
  technicalLines,
  toneOf,
  type BoxHealthBanner,
  type BoxHealthDestination,
  type BoxHealthTone,
} from './box-health-view';

const MIN_TOUCH = 44;

/** Calm green, amber, sober red; "unable to check" stays neutral grey with an amber hint. */
const tones: Record<
  BoxHealthTone | 'unavailable',
  { soft: string; ink: string; dot: string; line: string }
> = {
  ok: { soft: '#E7F1EB', ink: '#2E5C45', dot: '#4F8569', line: '#CFE1D5' },
  warning: { soft: '#FBF0E3', ink: '#80511A', dot: '#D99A55', line: '#F0D9BB' },
  critical: { soft: '#F8E7E7', ink: '#8E3434', dot: '#B74747', line: '#EDCACA' },
  unavailable: { soft: '#EEF0F2', ink: '#45505B', dot: '#B9874C', line: '#D9DEE3' },
};

const bannerTone = (banner: BoxHealthBanner) =>
  banner === 'ok'
    ? tones.ok
    : banner === 'critical'
      ? tones.critical
      : banner === 'unavailable'
        ? tones.unavailable
        : tones.warning;

const bannerIcon: Record<BoxHealthBanner, LucideIcon> = {
  ok: ShieldCheck,
  warning: TriangleAlert,
  unchecked: CircleQuestionMark,
  critical: OctagonAlert,
  unavailable: CloudOff,
};

const groupIcon: Record<string, LucideIcon> = {
  monitoring: Eye,
  home: House,
  notifications: Bell,
  box: Cpu,
  data: Database,
  access: KeyRound,
};

const checkIcon: Record<string, LucideIcon> = {
  worker: Activity,
  'last-event': Clock,
  coverage: Radar,
  'home-assistant': House,
  zigbee: Radio,
  'sensors-offline': WifiOff,
  'sensors-battery': BatteryLow,
  deliveries: Send,
  outbox: Inbox,
  disk: HardDrive,
  memory: MemoryStick,
  temperature: Thermometer,
  throttling: Gauge,
  containers: Boxes,
  'storage-errors': FileWarning,
  backup: DatabaseBackup,
  'db-size': Archive,
  'remote-access': Globe,
};

/** Checks the box reported as fine in the "reachable" family read better with a plain wifi icon. */
const iconFor = (check: BoxHealthCheck) =>
  check.id === 'sensors-offline' && check.level === 'ok'
    ? Wifi
    : (checkIcon[check.id] ?? (check.level === 'unknown' ? CircleDashed : Wrench));

function checkSentence(check: BoxHealthCheck) {
  const copy = checkCopy(check);
  const values: Record<string, string | number> = { ...copy.values };
  if (copy.duration) {
    values.duration = t(`boxHealth.duration.${copy.duration.unit}`, {
      count: copy.duration.count,
    });
  }
  return String(t(`boxHealth.${copy.path}` as never, values as never));
}

const checkLabel = (check: BoxHealthCheck) =>
  isKnownCheck(check.id) ? t(`boxHealth.checks.${check.id}.label`) : check.id;

const levelLabel = (level: BoxHealthLevel) => t(`boxHealth.level.${level}`);

function checkedAtText(checkedAt: string | undefined) {
  if (!checkedAt) return null;
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return null;
  const locale = dateLocale();
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return t('boxHealth.checkedAt', { time });
  return t('boxHealth.checkedOn', {
    date: date.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
    time,
  });
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => active && setReduce(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

export type BoxHealthPlace = Exclude<BoxHealthDestination, 'backup'>;

export function MobileBoxHealthPanel({
  server,
  token,
  refreshSignal = 0,
  onRefreshingChange,
  places = [],
  onOpenPlace,
}: {
  server: SavedServer;
  token: string;
  /** Bumped by the screen's pull-to-refresh; each change checks the box again. */
  refreshSignal?: number;
  onRefreshingChange?: (refreshing: boolean) => void;
  /** Places of the app the action buttons can lead to; other buttons are hidden. */
  places?: BoxHealthPlace[];
  onOpenPlace?: (place: BoxHealthPlace) => void;
}) {
  const [report, setReport] = useState<BoxHealthReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: BoxHealthTone } | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const latest = useRef(0);
  const refreshingChange = useRef(onRefreshingChange);
  refreshingChange.current = onRefreshingChange;

  const load = useCallback(
    async (mode: 'initial' | 'manual' | 'pull' | 'silent') => {
      const call = ++latest.current;
      if (mode === 'manual') setChecking(true);
      if (mode === 'pull') refreshingChange.current?.(true);
      try {
        const next = await mobileApi.getBoxHealth(server, token);
        if (call !== latest.current) return;
        if (!next || !Array.isArray(next.groups)) throw new Error('invalid-report');
        setReport(next);
        setFailed(false);
      } catch {
        if (call !== latest.current) return;
        // Never keep old figures on screen once the box stops answering: they could reassure wrongly.
        setReport(null);
        setFailed(true);
      } finally {
        if (call === latest.current) {
          setLoading(false);
          setChecking(false);
        }
        if (mode === 'pull') refreshingChange.current?.(false);
      }
    },
    [server, token],
  );

  useEffect(() => {
    setLoading(true);
    void load('initial');
  }, [load]);

  const firstSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === firstSignal.current) return;
    void load('pull');
  }, [refreshSignal, load]);

  const running = backupRunning(report);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load('silent'), BACKUP_POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const startBackup = async () => {
    if (backupBusy || running) return;
    setBackupBusy(true);
    setNotice(null);
    try {
      await mobileApi.runBoxHealthBackup(server, token);
      setNotice({ text: t('boxHealth.backupStarted'), tone: 'ok' });
      await load('silent');
    } catch {
      setNotice({ text: t('boxHealth.backupFailed'), tone: 'warning' });
    } finally {
      setBackupBusy(false);
    }
  };

  const available = useMemo(() => new Set<BoxHealthDestination>([...places, 'backup']), [places]);
  const onAction = (destination: BoxHealthDestination) => {
    if (destination === 'backup') void startBackup();
    else onOpenPlace?.(destination);
  };

  if (loading && !report && !failed) return <BoxHealthSkeleton />;

  const banner = bannerOf(report, failed);
  const groups = report ? orderedGroups(report) : [];

  return (
    <View style={styles.root}>
      <VerdictBanner
        banner={banner}
        checkedAt={report?.checkedAt}
        checking={checking}
        onRetry={() => void load('manual')}
      />

      {report ? (
        <View style={styles.toolbar}>
          <ToolbarButton
            label={checking ? t('boxHealth.checking') : t('boxHealth.checkNow')}
            busy={checking}
            onPress={() => void load('manual')}
            icon={<RefreshCw size={18} color={colors.blue} strokeWidth={2.2} />}
          />
          <ToolbarButton
            primary
            label={
              running
                ? t('boxHealth.backupRunning')
                : backupBusy
                  ? t('boxHealth.backupStarting')
                  : t('boxHealth.backupNow')
            }
            busy={backupBusy || running}
            onPress={() => void startBackup()}
            icon={<DatabaseBackup size={18} color="#FFFFFF" strokeWidth={2.2} />}
          />
        </View>
      ) : null}

      {running ? (
        <View
          style={[styles.notice, { backgroundColor: colors.paleBlue }]}
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={colors.blue} />
          <View style={styles.flex}>
            <Text style={[styles.noticeTitle, { color: colors.blue }]}>
              {t('boxHealth.backupRunning')}
            </Text>
            <Text style={styles.noticeBody}>{t('boxHealth.backupRunningHint')}</Text>
          </View>
        </View>
      ) : notice ? (
        <View
          style={[styles.notice, { backgroundColor: tones[notice.tone].soft }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.noticeTitle, { color: tones[notice.tone].ink }]}>{notice.text}</Text>
        </View>
      ) : null}

      {groups.map((group) => {
        const tone = groupTone(group.checks);
        const Icon = groupIcon[group.id] ?? Wrench;
        const title = isKnownGroup(group.id)
          ? t(`boxHealth.groups.${group.id}`)
          : t('boxHealth.groups.other');
        return (
          <View key={group.id} style={styles.groupCard}>
            <View style={styles.groupHeader} accessibilityRole="header">
              <View style={styles.groupIcon}>
                <Icon size={18} color={colors.blue} strokeWidth={2.1} />
              </View>
              <Text style={styles.groupTitle}>{title}</Text>
              <View style={[styles.groupBadge, { backgroundColor: tones[tone].soft }]}>
                <View style={[styles.dot, { backgroundColor: tones[tone].dot }]} />
                <Text style={[styles.groupBadgeText, { color: tones[tone].ink }]}>
                  {t(`boxHealth.groupSummary.${tone}`)}
                </Text>
              </View>
            </View>
            {group.checks.map((check, index) => (
              <CheckRow
                key={`${check.id}-${index}`}
                check={check}
                first={index === 0}
                destination={actionDestination(check.action, available)}
                actionBusy={check.action === 'run-backup' && (backupBusy || running)}
                onAction={onAction}
              />
            ))}
          </View>
        );
      })}

      {report ? (
        <TechnicalDetails
          report={report}
          open={technicalOpen}
          onToggle={() => setTechnicalOpen((open) => !open)}
        />
      ) : null}
    </View>
  );
}

function VerdictBanner({
  banner,
  checkedAt,
  checking,
  onRetry,
}: {
  banner: BoxHealthBanner;
  checkedAt: string | undefined;
  checking: boolean;
  onRetry: () => void;
}) {
  const tone = bannerTone(banner);
  const Icon = bannerIcon[banner];
  const title = t(`boxHealth.banner.${banner}.title`);
  const body = t(`boxHealth.banner.${banner}.body`);
  const time = banner === 'unavailable' ? null : checkedAtText(checkedAt);
  return (
    <View
      style={[styles.banner, { backgroundColor: tone.soft, borderColor: tone.line }]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={[title, body, time].filter(Boolean).join('. ')}
    >
      <View style={styles.bannerRow}>
        <View style={[styles.bannerIcon, { backgroundColor: '#FFFFFF' }]}>
          <Icon size={26} color={tone.ink} strokeWidth={2.1} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.bannerTitle, { color: tone.ink }]}>{title}</Text>
          {time ? <Text style={styles.bannerTime}>{time}</Text> : null}
        </View>
      </View>
      <Text style={styles.bannerBody}>{body}</Text>
      {banner === 'unavailable' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('boxHealth.retry')}
          accessibilityState={{ busy: checking, disabled: checking }}
          disabled={checking}
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          {checking ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <RefreshCw size={18} color="#FFFFFF" strokeWidth={2.2} />
          )}
          <Text style={styles.retryText}>{t('boxHealth.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ToolbarButton({
  label,
  icon,
  busy,
  primary,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  busy: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        primary ? styles.toolbarPrimary : styles.toolbarSecondary,
        busy && styles.busy,
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? '#FFFFFF' : colors.blue} /> : icon}
      <Text
        numberOfLines={2}
        style={[styles.toolbarText, { color: primary ? '#FFFFFF' : colors.blue }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CheckRow({
  check,
  first,
  destination,
  actionBusy,
  onAction,
}: {
  check: BoxHealthCheck;
  first: boolean;
  destination: BoxHealthDestination | null;
  actionBusy: boolean;
  onAction: (destination: BoxHealthDestination) => void;
}) {
  const tone = tones[toneOf(check.level)];
  const Icon = iconFor(check);
  const sentence = checkSentence(check);
  const label = checkLabel(check);
  const level = levelLabel(check.level);
  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <View
        style={styles.rowMain}
        accessible
        accessibilityLabel={`${label}. ${level}. ${sentence}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: tone.soft }]}>
          <Icon size={18} color={tone.ink} strokeWidth={2.1} />
          <View style={[styles.rowDot, { backgroundColor: tone.dot }]} />
        </View>
        <View style={styles.flex}>
          <View style={styles.rowHeading}>
            <Text style={styles.rowLabel}>{label}</Text>
            {check.level !== 'ok' ? (
              <Text style={[styles.rowLevel, { color: tone.ink }]}>{level}</Text>
            ) : null}
          </View>
          <Text style={styles.rowSentence}>{sentence}</Text>
        </View>
      </View>
      {destination && check.action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(`boxHealth.actions.${check.action}`)}
          accessibilityState={{ busy: actionBusy, disabled: actionBusy }}
          disabled={actionBusy}
          onPress={() => onAction(destination)}
          style={({ pressed }) => [
            styles.rowAction,
            actionBusy && styles.busy,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.rowActionText}>{t(`boxHealth.actions.${check.action}`)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TechnicalDetails({
  report,
  open,
  onToggle,
}: {
  report: BoxHealthReport;
  open: boolean;
  onToggle: () => void;
}) {
  const checks = report.groups.flatMap((group) => group.checks);
  const raw = report.technical ? technicalLines(report.technical) : [];
  return (
    <View style={styles.technical}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? t('boxHealth.technical.hide') : t('boxHealth.technical.show')}
        onPress={onToggle}
        style={({ pressed }) => [styles.technicalHeader, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <Text style={styles.technicalTitle}>{t('boxHealth.technical.title')}</Text>
          <Text style={styles.technicalHint}>{t('boxHealth.technical.hint')}</Text>
        </View>
        {open ? (
          <ChevronUp size={20} color={colors.muted} />
        ) : (
          <ChevronDown size={20} color={colors.muted} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.technicalBody}>
          <Text style={styles.technicalSection}>{t('boxHealth.technical.checks')}</Text>
          {checks.map((check, index) => (
            <Text key={`${check.id}-${index}`} selectable style={styles.mono}>
              {`${check.id} · ${check.level}${
                Object.keys(check.params ?? {}).length
                  ? ` · ${Object.entries(check.params ?? {})
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(' ')}`
                  : ''
              }${check.detail ? `\n  ${check.detail}` : ''}`}
            </Text>
          ))}
          <Text style={styles.technicalSection}>{t('boxHealth.technical.raw')}</Text>
          {raw.length ? (
            raw.map((line, index) => (
              <Text key={index} selectable style={styles.mono}>
                {line}
              </Text>
            ))
          ) : (
            <Text style={styles.technicalHint}>{t('boxHealth.technical.empty')}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function BoxHealthSkeleton() {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      style={[styles.root, { opacity: pulse }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('boxHealth.loading')}
    >
      <View style={[styles.banner, styles.skeletonBanner]}>
        <View style={styles.bannerRow}>
          <View style={[styles.bannerIcon, styles.skeletonBlock]} />
          <View style={[styles.flex, { gap: 8 }]}>
            <View style={[styles.skeletonLine, { width: '55%', height: 18 }]} />
            <View style={[styles.skeletonLine, { width: '35%' }]} />
          </View>
        </View>
        <View style={[styles.skeletonLine, { width: '90%' }]} />
      </View>
      {[0, 1].map((card) => (
        <View key={card} style={styles.groupCard}>
          <View style={[styles.skeletonLine, { width: '40%', height: 16 }]} />
          {[0, 1, 2].map((row) => (
            <View key={row} style={[styles.row, row > 0 && styles.rowDivider]}>
              <View style={styles.rowMain}>
                <View style={[styles.rowIcon, styles.skeletonBlock]} />
                <View style={[styles.flex, { gap: 8 }]}>
                  <View style={[styles.skeletonLine, { width: '30%' }]} />
                  <View style={[styles.skeletonLine, { width: '80%' }]} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  busy: { opacity: 0.8 },
  banner: { borderRadius: 24, borderWidth: 1, padding: 20, gap: 14 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bannerIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -0.3 },
  bannerTime: { marginTop: 3, color: colors.muted, fontSize: 13, fontWeight: '600' },
  bannerBody: { color: colors.navy, fontSize: 16, lineHeight: 23 },
  retry: {
    minHeight: 48,
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.blue,
  },
  retryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  toolbar: { flexDirection: 'row', gap: 10 },
  toolbarButton: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  toolbarPrimary: { backgroundColor: colors.blue },
  toolbarSecondary: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  toolbarText: { flexShrink: 1, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  notice: {
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noticeTitle: { fontSize: 15, fontWeight: '800' },
  noticeBody: { marginTop: 2, color: colors.muted, fontSize: 14, lineHeight: 20 },
  groupCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    gap: 6,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 },
  groupIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  groupTitle: { flex: 1, color: colors.navy, fontSize: 18, fontWeight: '800' },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  groupBadgeText: { fontSize: 12, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { paddingVertical: 12, gap: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.paper,
  },
  rowHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
  rowLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  rowLevel: { fontSize: 12, fontWeight: '800' },
  rowSentence: { marginTop: 2, color: colors.navy, fontSize: 16, lineHeight: 22 },
  rowAction: {
    marginLeft: 52,
    minHeight: MIN_TOUCH,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: '#FFFFFF',
  },
  rowActionText: { color: colors.blue, fontSize: 15, fontWeight: '800' },
  technical: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream,
    overflow: 'hidden',
  },
  technicalHeader: {
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  technicalTitle: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  technicalHint: { marginTop: 2, color: colors.muted, fontSize: 13, lineHeight: 18 },
  technicalBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 6 },
  technicalSection: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  mono: {
    color: colors.navy,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  skeletonBanner: { backgroundColor: '#EEF0F2', borderColor: '#E1E5E9' },
  skeletonBlock: { backgroundColor: '#E1E5E9' },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: '#E1E5E9' },
});
