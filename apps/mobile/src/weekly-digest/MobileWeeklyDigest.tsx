import {
  WEEKLY_DIGEST_MEALS,
  weeklyDigestLanguage,
  weeklyDigestTexts,
  digestPeriod,
  digestPlural,
  type WeeklyDigest,
  type WeeklyDigestTheme,
} from '@elise/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  BellRing,
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  Footprints,
  Info,
  Moon,
  RadioTower,
  Share2,
  ShieldCheck,
  TriangleAlert,
  Users,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import { appLocale } from '../locale';
import { shareWeeklyDigestPdf } from './share-pdf';
import {
  digestAlertsView,
  digestCardView,
  digestChangesView,
  digestChartData,
  digestSensorsView,
  digestThemesView,
  type DigestListItem,
  type DigestThemeKey,
  type DigestThemeView,
} from './weekly-digest-view';

/**
 * "Bilan de la semaine" in the mobile notebook: a card, then a full sheet with what changed,
 * one card per theme with its 7-day chart, alerts, sensors and the PDF to share with the doctor
 * or the nurse. For the family only: nothing of it reaches the resident's TV.
 */

export const weeklyDigestQueryKey = (server: SavedServer, week?: string | null) => [
  'elise',
  server.id,
  'weekly-digest',
  week ?? 'latest',
];

const C = {
  ink: '#17325D',
  copy: '#3F5878',
  muted: '#5F738A',
  line: '#DCE7F0',
  blue: '#2D6698',
  blueSoft: '#EDF5FC',
  amber: '#9A5A16',
  amberFill: '#D08A3D',
  amberSoft: '#FFF4E5',
  green: '#23704F',
  greenFill: '#3E9670',
  greenSoft: '#EAF6EF',
  red: '#A8432F',
  redSoft: '#FBECE8',
  grey: '#C5CFDA',
  violet: '#6A74C2',
  nightFill: '#4F7FB0',
};

const THEME_ICON: Record<WeeklyDigestTheme, LucideIcon> = {
  nights: Moon,
  meals: Utensils,
  outings: Footprints,
  visits: Users,
  alerts: BellRing,
  sensors: RadioTower,
  general: Info,
};

const THEME_TINT: Record<WeeklyDigestTheme, { color: string; background: string }> = {
  nights: { color: '#2D5F93', background: '#EAF2FB' },
  meals: { color: C.green, background: C.greenSoft },
  outings: { color: C.amber, background: C.amberSoft },
  visits: { color: '#4C56A8', background: '#EEF0FB' },
  alerts: { color: C.red, background: C.redSoft },
  sensors: { color: '#536A83', background: '#EEF2F6' },
  general: { color: C.blue, background: C.blueSoft },
};

const language = () => weeklyDigestLanguage(appLocale());

function TrendPill({ tone, label }: { tone: string; label: string }) {
  const style = tone === 'change' ? s.trendChange : tone === 'stable' ? s.trendStable : s.trendNone;
  const textStyle =
    tone === 'change' ? s.trendChangeText : tone === 'stable' ? s.trendStableText : s.trendNoneText;
  return (
    <View style={[s.trend, style]}>
      <Text style={[s.trendText, textStyle]}>{label}</Text>
    </View>
  );
}

/** The card of the notebook. */
export function MobileWeeklyDigestCard({ server, token }: { server: SavedServer; token: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: weeklyDigestQueryKey(server),
    queryFn: () => mobileApi.weeklyDigest(server, token),
    retry: false,
    staleTime: 10 * 60_000,
  });
  const lang = language();
  const text = weeklyDigestTexts(lang);
  const digest = query.data;
  if (!digest)
    return (
      <View style={[s.card, s.cardQuiet]}>
        <View style={s.cardTop}>
          <View style={s.cardIcon}>
            <ChartNoAxesColumn size={22} color="#fff" />
          </View>
          <View style={s.flex}>
            <Text style={s.eyebrow}>{text.title.toUpperCase()}</Text>
            <Text style={s.quiet}>
              {query.isPending
                ? t('weeklyDigest.loading')
                : (query.error as { status?: number } | null)?.status === 404
                  ? text.readySoon
                  : t('weeklyDigest.unavailable')}
            </Text>
          </View>
        </View>
      </View>
    );
  const view = digestCardView(digest, lang);
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${view.title}. ${view.summary}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [s.cardPress, pressed && s.pressed]}
      >
        <View style={s.cardTop}>
          <View style={s.cardIcon}>
            <ChartNoAxesColumn size={22} color="#fff" />
          </View>
          <View style={s.flex}>
            <Text style={s.eyebrow}>{view.title.toUpperCase()}</Text>
            <Text style={s.period}>{view.period}</Text>
          </View>
        </View>
        <Text style={s.cardSummary}>{view.summary}</Text>
        {view.highlights.map((item) => {
          const Icon = THEME_ICON[item.theme];
          return (
            <View key={item.text} style={s.chip}>
              <Icon size={15} color={C.amber} />
              <Text style={s.chipText}>{item.text}</Text>
            </View>
          );
        })}
        <View style={s.miniGrid}>
          {view.tiles.map((tile) => {
            const Icon = THEME_ICON[tile.theme];
            return (
              <View key={tile.theme} style={s.mini}>
                <View style={s.miniHead}>
                  <Icon size={14} color={C.muted} />
                  <Text style={s.miniTitle}>{tile.title}</Text>
                </View>
                <Text style={s.miniValue}>{tile.value}</Text>
                <TrendPill tone={tile.trend.tone} label={tile.trend.label} />
              </View>
            );
          })}
        </View>
        <View style={s.cardCta}>
          <Text style={s.cardCtaText}>{t('weeklyDigest.open')}</Text>
          <ChevronRight size={18} color="#fff" />
        </View>
      </Pressable>
      {open && (
        <MobileWeeklyDigestSheet
          server={server}
          token={token}
          initial={digest}
          onClose={() => setOpen(false)}
        />
      )}
    </View>
  );
}

/** The charts use the app's sans-serif font, also in the web version. */
const SVG_FONT =
  Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;
const W = 300;
const LEFT = 42;
const STEP = (W - LEFT - 6) / 7;
const cx = (index: number) => LEFT + STEP * index + STEP / 2;

function DayRow({ days }: { days: string[] }) {
  return (
    <>
      {days.map((day, index) => (
        <SvgText
          fontFamily={SVG_FONT}
          key={day + index}
          x={cx(index)}
          y={112}
          fontSize={10}
          fill={C.muted}
          fontWeight="600"
          textAnchor="middle"
        >
          {day}
        </SvgText>
      ))}
    </>
  );
}

function ThemeChart({ theme, digest }: { theme: DigestThemeKey; digest: WeeklyDigest }) {
  const data = digestChartData(digest, language());
  const base = 90;
  if (theme === 'nights') {
    const top = 8;
    const height = 78;
    const toY = (minute: number) =>
      top + Math.min(1, Math.max(0, (minute - 21 * 60) / (13 * 60))) * height;
    return (
      <Svg width="100%" height={128} viewBox={`0 0 ${W} 118`}>
        <Rect x={LEFT} y={top} width={W - LEFT - 6} height={height} rx={8} fill="#F2F6FA" />
        <SvgText
          fontFamily={SVG_FONT}
          x={LEFT - 6}
          y={top + 8}
          fontSize={9}
          fill="#8696A8"
          textAnchor="end"
        >
          21:00
        </SvgText>
        <SvgText
          fontFamily={SVG_FONT}
          x={LEFT - 6}
          y={top + height}
          fontSize={9}
          fill="#8696A8"
          textAnchor="end"
        >
          10:00
        </SvgText>
        {data.usualWake !== null && (
          <Line
            x1={LEFT}
            x2={W - 6}
            y1={toY(data.usualWake)}
            y2={toY(data.usualWake)}
            stroke="#2D5F93"
            strokeWidth={1.2}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        )}
        {data.nights.map((night, index) =>
          night.bedtime === null || night.wake === null ? (
            <SvgText
              fontFamily={SVG_FONT}
              key={index}
              x={cx(index)}
              y={top + height / 2 + 4}
              fontSize={13}
              fill="#9AA9B8"
              fontWeight="700"
              textAnchor="middle"
            >
              ?
            </SvgText>
          ) : (
            <Rect
              key={index}
              x={cx(index) - 7}
              y={toY(night.bedtime)}
              width={14}
              height={Math.max(4, toY(night.wake) - toY(night.bedtime))}
              rx={6}
              fill={night.restless ? C.amberFill : C.nightFill}
            />
          ),
        )}
        {data.nights.map((night, index) =>
          night.wake !== null && night.risings ? (
            <SvgText
              fontFamily={SVG_FONT}
              key={`r${index}`}
              x={cx(index)}
              y={Math.min(top + height - 3, toY(night.wake) + 11)}
              fontSize={10}
              fontWeight="800"
              fill={night.restless ? C.amber : '#5D708A'}
              textAnchor="middle"
            >
              {night.risings}
            </SvgText>
          ) : null,
        )}
        <DayRow days={data.days} />
      </Svg>
    );
  }
  if (theme === 'meals') {
    const rows = [22, 50, 78];
    return (
      <Svg width="100%" height={128} viewBox={`0 0 ${W} 118`}>
        {WEEKLY_DIGEST_MEALS.map((meal, row) => (
          <SvgText
            fontFamily={SVG_FONT}
            key={meal}
            x={LEFT - 6}
            y={rows[row] + 4}
            fontSize={9}
            fill="#8696A8"
            textAnchor="end"
          >
            {data.mealRows[row]}
          </SvgText>
        ))}
        {data.meals.map((day, index) =>
          day.map((state, row) =>
            state === 'SEEN' ? (
              <Circle
                key={`${index}-${row}`}
                cx={cx(index)}
                cy={rows[row]}
                r={8}
                fill={C.greenFill}
              />
            ) : state === 'NOT_SEEN' ? (
              <Circle
                key={`${index}-${row}`}
                cx={cx(index)}
                cy={rows[row]}
                r={7}
                fill="#fff"
                stroke={C.amberFill}
                strokeWidth={2.4}
              />
            ) : (
              <Circle
                key={`${index}-${row}`}
                cx={cx(index)}
                cy={rows[row]}
                r={7}
                fill="#fff"
                stroke={C.grey}
                strokeWidth={1.6}
                strokeDasharray="2 2"
              />
            ),
          ),
        )}
        <DayRow days={data.days} />
      </Svg>
    );
  }
  if (theme === 'outings') {
    const max = Math.max(60, ...data.outings.map((day) => day.minutes ?? 0));
    return (
      <Svg width="100%" height={128} viewBox={`0 0 ${W} 118`}>
        <Line x1={LEFT} x2={W - 6} y1={base} y2={base} stroke="#DFE7EF" strokeWidth={1.2} />
        {data.outings.map((day, index) => {
          if (day.count === null)
            return (
              <SvgText
                fontFamily={SVG_FONT}
                key={index}
                x={cx(index)}
                y={base - 6}
                fontSize={13}
                fill="#9AA9B8"
                textAnchor="middle"
              >
                ?
              </SvgText>
            );
          if (day.count === 0)
            return <Circle key={index} cx={cx(index)} cy={base - 3} r={2.5} fill={C.grey} />;
          const height = Math.max(4, ((day.minutes ?? 0) / max) * 66);
          return (
            <Rect
              key={index}
              x={cx(index) - 9}
              y={base - height}
              width={18}
              height={height}
              rx={5}
              fill="#E09A4E"
            />
          );
        })}
        {data.outings.map((day, index) =>
          day.count ? (
            <SvgText
              fontFamily={SVG_FONT}
              key={`c${index}`}
              x={cx(index)}
              y={base - Math.max(4, ((day.minutes ?? 0) / max) * 66) - 5}
              fontSize={10}
              fontWeight="800"
              fill={C.amber}
              textAnchor="middle"
            >
              {day.count}
            </SvgText>
          ) : null,
        )}
        <DayRow days={data.days} />
      </Svg>
    );
  }
  return (
    <Svg width="100%" height={128} viewBox={`0 0 ${W} 118`}>
      <Line x1={LEFT} x2={W - 6} y1={base} y2={base} stroke="#DFE7EF" strokeWidth={1.2} />
      {data.visits.map((day, index) => {
        const marks: Array<'visit' | 'call' | 'presence'> = [
          ...Array<'visit'>(day.visits).fill('visit'),
          ...Array<'call'>(day.calls).fill('call'),
          ...(day.presence ? (['presence'] as const) : []),
        ];
        return marks.map((mark, position) => {
          const y = base - 11 - position * 19;
          if (mark === 'visit')
            return (
              <Rect
                key={`${index}-${position}`}
                x={cx(index) - 7}
                y={y - 7}
                width={14}
                height={14}
                rx={4}
                fill={C.violet}
              />
            );
          if (mark === 'call')
            return (
              <Circle key={`${index}-${position}`} cx={cx(index)} cy={y} r={7} fill={C.greenFill} />
            );
          return (
            <Circle
              key={`${index}-${position}`}
              cx={cx(index)}
              cy={y}
              r={6}
              fill="#fff"
              stroke={C.amberFill}
              strokeWidth={2.2}
            />
          );
        });
      })}
      <DayRow days={data.days} />
    </Svg>
  );
}

function LegendMark({ kind }: { kind: string }) {
  const map: Record<string, object> = {
    night: { width: 8, height: 13, borderRadius: 4, backgroundColor: C.nightFill },
    restless: { width: 8, height: 13, borderRadius: 4, backgroundColor: C.amberFill },
    usual: {
      width: 16,
      height: 0,
      borderTopWidth: 2,
      borderStyle: 'dashed',
      borderColor: '#2D5F93',
    },
    seen: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.greenFill },
    call: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.greenFill },
    notSeen: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: C.amberFill },
    presence: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: C.amberFill },
    unknown: {
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: C.grey,
    },
    outing: { width: 11, height: 11, borderRadius: 3, backgroundColor: '#E09A4E' },
    visit: { width: 11, height: 11, borderRadius: 3, backgroundColor: C.violet },
  };
  return <View style={map[kind]} />;
}

function ThemeCard({ view, digest }: { view: DigestThemeView; digest: WeeklyDigest }) {
  const Icon = THEME_ICON[view.theme];
  const tint = THEME_TINT[view.theme];
  return (
    <View style={s.tile}>
      <View style={s.tileHead}>
        <View style={[s.tileIcon, { backgroundColor: tint.background }]}>
          <Icon size={19} color={tint.color} />
        </View>
        <Text accessibilityRole="header" style={s.tileTitle}>
          {view.title}
        </Text>
        {view.trend && <TrendPill tone={view.trend.tone} label={view.trend.label} />}
      </View>
      {view.message ? (
        <View style={s.unavailable}>
          <Info size={17} color={C.muted} />
          <Text style={s.unavailableText}>{view.message}</Text>
        </View>
      ) : (
        <>
          <View style={s.stats}>
            {view.stats.map((stat, index) => (
              <View
                key={stat.label}
                style={[s.stat, index === view.stats.length - 1 && s.statLast]}
              >
                <Text style={s.statLabel}>{stat.label}</Text>
                <View style={s.statRight}>
                  <Text style={s.statValue}>{stat.value}</Text>
                  {stat.usual ? <Text style={s.statUsual}>{stat.usual}</Text> : null}
                </View>
              </View>
            ))}
          </View>
          <ThemeChart theme={view.theme} digest={digest} />
          <View style={s.legend}>
            {view.legend.map((item) => (
              <View key={item.kind} style={s.legendItem}>
                <LegendMark kind={item.kind} />
                <Text style={s.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
          <View style={s.facts}>
            {view.facts.map((fact) => (
              <View key={fact.text} style={s.fact}>
                <View
                  style={[
                    s.factDot,
                    fact.tone === 'change' && { backgroundColor: C.amberFill },
                    fact.tone === 'stable' && { backgroundColor: C.greenFill },
                  ]}
                />
                <Text
                  style={[
                    s.factText,
                    fact.tone === 'change' && s.factChange,
                    fact.tone === 'muted' && s.factMuted,
                  ]}
                >
                  {fact.text}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
      {view.method ? <Text style={s.method}>{view.method}</Text> : null}
    </View>
  );
}

function ListCard({
  theme,
  title,
  items,
  empty,
  more,
}: {
  theme: WeeklyDigestTheme;
  title: string;
  items: DigestListItem[];
  empty: string;
  more?: string | null;
}) {
  const Icon = THEME_ICON[theme];
  const tint = THEME_TINT[theme];
  return (
    <View style={s.tile}>
      <View style={s.tileHead}>
        <View style={[s.tileIcon, { backgroundColor: tint.background }]}>
          <Icon size={19} color={tint.color} />
        </View>
        <Text accessibilityRole="header" style={s.tileTitle}>
          {title}
        </Text>
      </View>
      {items.length === 0 ? (
        <Text style={s.good}>{empty}</Text>
      ) : (
        items.map((item) => (
          <View key={item.key} style={s.listItem}>
            <View
              style={[
                s.badge,
                item.tone === 'urgent'
                  ? s.badgeUrgent
                  : item.tone === 'attention'
                    ? s.badgeAttention
                    : s.badgeInfo,
              ]}
            >
              <Text
                style={[
                  s.badgeText,
                  item.tone === 'urgent'
                    ? { color: C.red }
                    : item.tone === 'attention'
                      ? { color: C.amber }
                      : { color: C.blue },
                ]}
              >
                {item.badge}
              </Text>
            </View>
            <View style={s.flex}>
              <Text style={s.listTitle}>{item.title}</Text>
              {item.detail ? <Text style={s.listDetail}>{item.detail}</Text> : null}
            </View>
          </View>
        ))
      )}
      {more ? <Text style={s.factMuted}>{more}</Text> : null}
    </View>
  );
}

/** The full sheet of a week, with the weeks before and after and the PDF to share. */
export function MobileWeeklyDigestSheet({
  server,
  token,
  initial,
  onClose,
}: {
  server: SavedServer;
  token: string;
  initial: WeeklyDigest;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [week, setWeek] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const query = useQuery({
    queryKey: weeklyDigestQueryKey(server, week),
    queryFn: () => mobileApi.weeklyDigest(server, token, week ?? undefined),
    enabled: week !== null,
    retry: false,
  });
  const digest = week === null ? initial : (query.data ?? initial);
  const lang = language();
  const text = weeklyDigestTexts(lang);
  const comparison =
    digest.comparisonWeeks > 0
      ? digestPlural(text.pdf.comparison, digest.comparisonWeeks, lang)
      : text.pdf.noComparison;
  const loading = week !== null && query.isFetching;

  const share = async () => {
    setExporting(true);
    setNotice('');
    try {
      const result = await shareWeeklyDigestPdf({
        server,
        token,
        weekStart: digest.weekStart,
        language: lang,
        dialogTitle: t('weeklyDigest.shareTitle'),
      });
      if (result === 'downloaded') setNotice(t('weeklyDigest.downloaded'));
    } catch {
      setNotice(t('weeklyDigest.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.sheet, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={s.sheetHead}>
          <View style={s.flex}>
            <Text style={s.eyebrow}>{text.eyebrow.toUpperCase()}</Text>
            <Text accessibilityRole="header" style={s.sheetTitle}>
              {text.title}
            </Text>
            <Text style={s.sheetPeriod}>
              {[digest.residentName, digestPeriod(digest.weekStart, digest.weekEnd, lang, true)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('weeklyDigest.close')}
            onPress={onClose}
            style={s.close}
          >
            <X size={22} color="#385577" />
          </Pressable>
        </View>
        <View style={s.navRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('weeklyDigest.previousWeek')}
            disabled={!digest.previousWeek || loading}
            onPress={() => digest.previousWeek && setWeek(digest.previousWeek)}
            style={[s.navButton, (!digest.previousWeek || loading) && s.navDisabled]}
          >
            <ChevronLeft size={18} color={digest.previousWeek ? '#234B79' : '#A9B7C6'} />
            <Text style={[s.navText, !digest.previousWeek && s.navTextDisabled]}>
              {t('weeklyDigest.previousShort')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('weeklyDigest.nextWeek')}
            disabled={!digest.nextWeek || loading}
            onPress={() => digest.nextWeek && setWeek(digest.nextWeek)}
            style={[s.navButton, s.navButtonEnd, (!digest.nextWeek || loading) && s.navDisabled]}
          >
            <Text style={[s.navText, !digest.nextWeek && s.navTextDisabled]}>
              {t('weeklyDigest.nextShort')}
            </Text>
            <ChevronRight size={18} color={digest.nextWeek ? '#234B79' : '#A9B7C6'} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[s.sheetBody, { paddingBottom: insets.bottom + 28 }]}
          style={loading ? s.loading : undefined}
        >
          <Pressable
            accessibilityRole="button"
            disabled={exporting}
            onPress={() => void share()}
            style={({ pressed }) => [s.export, (pressed || exporting) && s.pressed]}
          >
            <Share2 size={19} color="#fff" />
            <Text style={s.exportText}>
              {exporting ? t('weeklyDigest.exporting') : t('weeklyDigest.exportPdf')}
            </Text>
          </Pressable>
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={s.notice}>
              {notice}
            </Text>
          ) : null}
          <View style={s.summary}>
            <ShieldCheck size={26} color="#fff" />
            <View style={s.flex}>
              <Text style={s.summaryText}>{digestCardView(digest, lang).summary}</Text>
              <Text style={s.summarySub}>{comparison}</Text>
            </View>
          </View>
          <View style={s.changes}>
            <Text accessibilityRole="header" style={s.changesTitle}>
              {text.themes.changes}
            </Text>
            {digestChangesView(digest, lang).map((item) => {
              const Icon = item.tone === 'warning' ? TriangleAlert : THEME_ICON[item.theme];
              const tint =
                item.tone === 'change'
                  ? { color: C.amber, background: C.amberSoft }
                  : item.tone === 'stable'
                    ? { color: C.green, background: C.greenSoft }
                    : item.tone === 'warning'
                      ? { color: C.red, background: C.redSoft }
                      : { color: C.blue, background: C.blueSoft };
              return (
                <View key={item.key} style={s.change}>
                  <View style={[s.changeIcon, { backgroundColor: tint.background }]}>
                    <Icon size={16} color={tint.color} />
                  </View>
                  <Text style={s.changeText}>{item.text}</Text>
                </View>
              );
            })}
          </View>
          {digestThemesView(digest, lang).map((view) => (
            <ThemeCard key={view.theme} view={view} digest={digest} />
          ))}
          {(() => {
            const alerts = digestAlertsView(digest, lang);
            const sensors = digestSensorsView(digest, lang);
            return (
              <>
                <ListCard
                  theme="alerts"
                  title={alerts.title}
                  items={alerts.items}
                  empty={alerts.empty}
                  more={alerts.more}
                />
                <ListCard
                  theme="sensors"
                  title={sensors.title}
                  items={sensors.items}
                  empty={sensors.empty}
                />
              </>
            );
          })()}
          <View style={s.disclaimer}>
            <ShieldCheck size={18} color={C.blue} />
            <Text style={s.disclaimerText}>
              <Text style={s.disclaimerStrong}>{text.disclaimer}</Text> {text.advice}
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.82 },
  card: {
    borderWidth: 1,
    borderColor: '#D6E4EE',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    shadowColor: '#183B5E',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardQuiet: { padding: 16 },
  cardPress: { padding: 16, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F4C7E',
  },
  eyebrow: { color: '#5D7896', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.9 },
  period: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '700' },
  quiet: { marginTop: 3, color: C.copy, fontSize: 14.5, lineHeight: 20 },
  cardSummary: { color: C.ink, fontFamily: 'Georgia', fontSize: 20, lineHeight: 26 },
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: C.amberSoft,
    borderWidth: 1,
    borderColor: '#F0D2A8',
  },
  chipText: { flex: 1, color: '#7E4A10', fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  mini: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 11,
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3EDF5',
    backgroundColor: '#F8FBFD',
  },
  miniHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniTitle: { color: C.muted, fontSize: 12.5, fontWeight: '700' },
  miniValue: { color: C.ink, fontSize: 14.5, fontWeight: '700', lineHeight: 19 },
  cardCta: {
    marginTop: 4,
    height: 48,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1D4677',
  },
  cardCtaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  trend: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  trendText: { fontSize: 12, fontWeight: '700' },
  trendChange: { backgroundColor: C.amberSoft },
  trendChangeText: { color: C.amber },
  trendStable: { backgroundColor: C.greenSoft },
  trendStableText: { color: C.green },
  trendNone: { backgroundColor: '#F0F4F8' },
  trendNoneText: { color: C.muted },
  sheet: { flex: 1, backgroundColor: '#F5F8FB' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  sheetTitle: { marginTop: 3, color: C.ink, fontFamily: 'Georgia', fontSize: 27 },
  sheetPeriod: { marginTop: 2, color: C.copy, fontSize: 14.5, fontWeight: '600' },
  close: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DBE6EF',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRow: {
    marginHorizontal: 18,
    marginBottom: 10,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DBE6EF',
    backgroundColor: '#fff',
  },
  navButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 8,
    gap: 4,
  },
  navButtonEnd: { justifyContent: 'flex-end' },
  navDisabled: { opacity: 0.6 },
  navText: { color: '#234B79', fontSize: 14, fontWeight: '700' },
  navTextDisabled: { color: '#A9B7C6' },
  sheetBody: { paddingHorizontal: 16, gap: 14 },
  loading: { opacity: 0.55 },
  export: {
    height: 50,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#1D4677',
  },
  exportText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  notice: {
    padding: 11,
    borderRadius: 14,
    color: '#234B79',
    fontWeight: '600',
    backgroundColor: C.blueSoft,
  },
  summary: {
    padding: 16,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1C4372',
  },
  summaryText: { color: '#fff', fontFamily: 'Georgia', fontSize: 19, lineHeight: 25 },
  summarySub: { marginTop: 3, color: '#DCE8F5', fontSize: 13 },
  changes: {
    padding: 16,
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0DCC0',
    backgroundColor: '#FFFAF2',
  },
  changesTitle: { color: C.ink, fontFamily: 'Georgia', fontSize: 20 },
  change: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  changeIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeText: { flex: 1, color: '#2C4363', fontSize: 15, lineHeight: 21, fontWeight: '500' },
  tile: {
    padding: 16,
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E1EAF2',
    backgroundColor: '#fff',
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { flex: 1, color: C.ink, fontFamily: 'Georgia', fontSize: 20 },
  stats: { borderRadius: 14, backgroundColor: '#F5F8FB', paddingHorizontal: 12 },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EDF3',
  },
  statLast: { borderBottomWidth: 0 },
  statLabel: { flex: 1, color: C.muted, fontSize: 13.5, fontWeight: '700' },
  statRight: { alignItems: 'flex-end', flexShrink: 1 },
  statValue: { color: C.ink, fontSize: 18, fontWeight: '800', textAlign: 'right' },
  statUsual: { color: C.muted, fontSize: 12, textAlign: 'right' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: C.muted, fontSize: 12 },
  facts: { gap: 6 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  factDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7, backgroundColor: '#9FB2C6' },
  factText: { flex: 1, color: C.copy, fontSize: 14, lineHeight: 20 },
  factChange: { color: '#8A5212', fontWeight: '600' },
  factMuted: { color: C.muted, fontSize: 13.5, lineHeight: 19 },
  method: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: '#E1E9F1',
    color: C.muted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  unavailable: {
    flexDirection: 'row',
    gap: 10,
    padding: 13,
    borderRadius: 14,
    backgroundColor: '#F3F6F9',
  },
  unavailableText: { flex: 1, color: C.copy, fontSize: 14.5, lineHeight: 20 },
  good: { color: C.green, fontSize: 14.5, fontWeight: '600' },
  listItem: { gap: 5, paddingBottom: 2 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  badgeUrgent: { backgroundColor: C.redSoft },
  badgeAttention: { backgroundColor: C.amberSoft },
  badgeInfo: { backgroundColor: C.blueSoft },
  badgeText: { fontSize: 11.5, fontWeight: '800' },
  listTitle: { color: C.ink, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
  listDetail: { color: C.muted, fontSize: 12.5, marginTop: 1 },
  disclaimer: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#EEF3F8',
  },
  disclaimerText: { flex: 1, color: C.copy, fontSize: 13.5, lineHeight: 20 },
  disclaimerStrong: { color: C.ink, fontWeight: '700' },
});
