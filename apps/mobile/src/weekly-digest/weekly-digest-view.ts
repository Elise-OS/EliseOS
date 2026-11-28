import {
  WEEKLY_DIGEST_MEALS,
  digestClock,
  digestDate,
  digestDuration,
  digestLocalDay,
  digestLocalMinute,
  digestNumber,
  digestPeriod,
  digestPlural,
  digestStatementText,
  digestThemeTrend,
  digestVisitDays,
  digestWeekDays,
  digestWeekdayLabel,
  fillDigestText,
  weeklyDigestTexts,
  type WeeklyDigest,
  type WeeklyDigestLanguage,
  type WeeklyDigestStatement,
  type WeeklyDigestTrend,
} from '@elise/contracts';

/**
 * What the mobile app shows of a weekly digest, as plain data: the card of the notebook and the
 * detailed sheet. Kept apart from the components so it is tested without a phone.
 */

export type DigestThemeKey = 'nights' | 'meals' | 'outings' | 'visits';

export interface DigestStat {
  label: string;
  value: string;
  usual: string | null;
}

export interface DigestFact {
  text: string;
  tone: 'change' | 'stable' | 'muted' | 'plain';
}

export interface DigestThemeView {
  theme: DigestThemeKey;
  title: string;
  /** Null when the theme is not equipped or has no data: `message` says so. */
  trend: WeeklyDigestTrend | null;
  message: string | null;
  stats: DigestStat[];
  facts: DigestFact[];
  legend: Array<{ kind: string; label: string }>;
  method: string | null;
}

export interface DigestListItem {
  key: string;
  badge: string;
  tone: 'urgent' | 'attention' | 'info';
  title: string;
  detail: string | null;
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function digestCardView(digest: WeeklyDigest, language: WeeklyDigestLanguage) {
  const text = weeklyDigestTexts(language);
  const unavailable = (state: string) => state === 'NOT_EQUIPPED' || state === 'NO_DATA';
  const tiles: Array<{
    theme: DigestThemeKey;
    title: string;
    value: string;
    trend: WeeklyDigestTrend;
  }> = [
    {
      theme: 'nights',
      title: text.themes.nights,
      value:
        digest.nights.wake === null
          ? text.noData
          : `${text.nights.wake} ${digestClock(digest.nights.wake)}`,
      trend: digestThemeTrend(digest, 'nights', language),
    },
    {
      theme: 'meals',
      title: text.themes.meals,
      value: unavailable(digest.meals.state)
        ? text.noData
        : digest.meals.notSeen
          ? digestPlural(text.meals.missed, digest.meals.notSeen, language)
          : text.meals.noneMissed,
      trend: digestThemeTrend(digest, 'meals', language),
    },
    {
      theme: 'outings',
      title: text.themes.outings,
      value: unavailable(digest.outings.state)
        ? text.noData
        : digestPlural(text.outings.count, digest.outings.total, language),
      trend: digestThemeTrend(digest, 'outings', language),
    },
    {
      theme: 'visits',
      title: text.themes.visits,
      value: digest.visitSummary.planned
        ? digestPlural(text.visits.planned, digest.visitSummary.planned, language)
        : text.visits.nonePlanned,
      trend: digestThemeTrend(digest, 'visits', language),
    },
  ];
  return {
    title: text.title,
    period: digestPeriod(digest.weekStart, digest.weekEnd, language),
    summary: digestStatementText(digest.summary, language),
    highlights: digest.changes
      .filter((item) => item.tone === 'change')
      .slice(0, 2)
      .map((item) => ({ theme: item.theme, text: digestStatementText(item, language) })),
    tiles,
  };
}

export function digestChangesView(digest: WeeklyDigest, language: WeeklyDigestLanguage) {
  return digest.changes.map((item: WeeklyDigestStatement) => ({
    key: item.key,
    theme: item.theme,
    tone: item.tone,
    text: digestStatementText(item, language),
  }));
}

export function digestThemesView(
  digest: WeeklyDigest,
  language: WeeklyDigestLanguage,
): DigestThemeView[] {
  const text = weeklyDigestTexts(language);
  const colon = language === 'fr' ? '\u00a0: ' : ': ';
  const usual = (value: string | null) =>
    value === null ? null : fillDigestText(text.usual, { value });
  const day = (date: string) => digestWeekdayLabel(date, language);
  const dayAndTime = (iso: string) =>
    `${day(digestLocalDay(iso, digest.timezone))} ${digestClock(digestLocalMinute(iso, digest.timezone))}`;
  const { nights, meals, outings, visitSummary } = digest;

  const nightView: DigestThemeView = {
    theme: 'nights',
    title: text.themes.nights,
    trend: null,
    message: null,
    stats: [],
    facts: [],
    legend: [],
    method:
      nights.source === 'BED'
        ? text.nights.sourceBed
        : nights.source === 'MOTION'
          ? text.nights.sourceMotion
          : null,
  };
  if (nights.state === 'NOT_EQUIPPED') nightView.message = text.nights.notEquipped;
  else if (nights.state === 'NO_DATA') nightView.message = text.nights.noData;
  else {
    nightView.trend = digestThemeTrend(digest, 'nights', language);
    nightView.stats = [
      {
        label: text.nights.bedtime,
        value: nights.bedtime === null ? '–' : digestClock(nights.bedtime),
        usual: usual(nights.usual?.bedtime == null ? null : digestClock(nights.usual.bedtime)),
      },
      {
        label: text.nights.wake,
        value: nights.wake === null ? '–' : digestClock(nights.wake),
        usual: usual(nights.usual?.wake == null ? null : digestClock(nights.usual.wake)),
      },
      {
        label: text.nights.risings,
        value:
          nights.risingsPerNight === null
            ? '–'
            : fillDigestText(text.nights.perNight, {
                count: digestNumber(nights.risingsPerNight, language),
              }),
        usual: usual(
          nights.usual?.risingsPerNight == null
            ? null
            : digestNumber(nights.usual.risingsPerNight, language),
        ),
      },
    ];
    nightView.facts.push(
      nights.restlessNights.length
        ? {
            text: digestPlural(text.nights.restless, nights.restlessNights.length, language),
            tone: 'change',
          }
        : { text: text.nights.calm, tone: 'stable' },
    );
    if (nights.shortNights.length)
      nightView.facts.push({
        text: digestPlural(text.nights.short, nights.shortNights.length, language),
        tone: 'change',
      });
    if (nights.state === 'PARTIAL')
      nightView.facts.push({
        text: digestPlural(text.nights.partial, 7 - nights.measured, language),
        tone: 'muted',
      });
    nightView.legend = [
      { kind: 'night', label: text.nights.legendBar },
      {
        kind: 'restless',
        label: capitalize(text.nights.restless.other.replace(/\{\{count\}\}\s*/, '')),
      },
      ...(nights.usual?.wake != null ? [{ kind: 'usual', label: text.nights.legendUsual }] : []),
    ];
  }

  const mealView: DigestThemeView = {
    theme: 'meals',
    title: text.themes.meals,
    trend: null,
    message: null,
    stats: [],
    facts: [],
    legend: [],
    method: meals.state === 'NOT_EQUIPPED' ? null : text.meals.method,
  };
  if (meals.state === 'NOT_EQUIPPED') mealView.message = text.meals.notEquipped;
  else if (meals.state === 'NO_DATA') mealView.message = text.meals.noData;
  else {
    mealView.trend = digestThemeTrend(digest, 'meals', language);
    mealView.stats = [
      { label: text.meals.seenLabel, value: `${meals.seen}`, usual: null },
      {
        label: text.meals.missedLabel,
        value: `${meals.notSeen}`,
        usual: usual(meals.usual ? `${meals.usual.notSeen}` : null),
      },
      ...(meals.fridgePerDay === null
        ? []
        : [
            {
              label: text.meals.fridgeLabel,
              value: fillDigestText(text.meals.perDay, {
                count: digestNumber(meals.fridgePerDay, language),
              }),
              usual: usual(
                meals.usual?.fridgePerDay == null
                  ? null
                  : digestNumber(meals.usual.fridgePerDay, language),
              ),
            },
          ]),
    ];
    mealView.facts.push(
      meals.missed.length
        ? {
            text: `${digestPlural(text.meals.missed, meals.missed.length, language)}${colon}${meals.missed
              .map((item) => `${day(item.date)} ${text.meals.rows[item.meal].toLowerCase()}`)
              .join(', ')}`,
            tone: 'change',
          }
        : { text: text.meals.noneMissed, tone: 'stable' },
    );
    mealView.legend = [
      { kind: 'seen', label: text.meals.seen },
      { kind: 'notSeen', label: text.meals.notSeen },
      { kind: 'unknown', label: text.meals.unknown },
    ];
  }

  const outingView: DigestThemeView = {
    theme: 'outings',
    title: text.themes.outings,
    trend: null,
    message: null,
    stats: [],
    facts: [],
    legend: [],
    method: outings.state === 'NOT_EQUIPPED' ? null : text.outings.method,
  };
  if (outings.state === 'NOT_EQUIPPED') outingView.message = text.outings.notEquipped;
  else if (outings.state === 'NO_DATA') outingView.message = text.outings.noData;
  else {
    outingView.trend = digestThemeTrend(digest, 'outings', language);
    outingView.stats = [
      {
        label: text.outings.label,
        value: `${outings.total}`,
        usual: usual(outings.usual ? `${outings.usual.total}` : null),
      },
      {
        label: text.outings.timeLabel,
        value: digestDuration(outings.minutes),
        usual: usual(outings.usual ? digestDuration(outings.usual.minutes) : null),
      },
      { label: text.outings.daysWithoutLabel, value: `${outings.daysWithout.length}`, usual: null },
    ];
    outingView.facts.push(
      outings.daysWithout.length
        ? {
            text: `${digestPlural(text.outings.daysWithout, outings.daysWithout.length, language)}${colon}${outings.daysWithout.map(day).join(', ')}`,
            tone: outings.daysWithout.length > 1 ? 'change' : 'plain',
          }
        : { text: text.outings.everyDay, tone: 'stable' },
    );
    outingView.legend = [{ kind: 'outing', label: text.outings.legend }];
  }

  const callsKnown =
    visitSummary.calls.state !== 'NOT_EQUIPPED' && visitSummary.calls.state !== 'NO_DATA';
  const visitView: DigestThemeView = {
    theme: 'visits',
    title: text.themes.visits,
    trend: visitSummary.calls.state === 'OK' ? digestThemeTrend(digest, 'visits', language) : null,
    message: null,
    stats: [
      {
        label: text.visits.plannedLabel,
        value: `${visitSummary.planned}`,
        usual: visitSummary.confirmed
          ? digestPlural(text.visits.confirmed, visitSummary.confirmed, language)
          : null,
      },
      {
        label: text.visits.callsLabel,
        value: callsKnown ? `${visitSummary.calls.total}` : '–',
        usual: visitSummary.calls.minutes
          ? fillDigestText(text.visits.callsDuration, {
              duration: digestDuration(visitSummary.calls.minutes),
            })
          : null,
      },
      ...(visitSummary.sharedPresence.state === 'NOT_EQUIPPED'
        ? []
        : [
            {
              label: text.visits.presenceLabel,
              value: `${visitSummary.sharedPresence.total}`,
              usual: null,
            },
          ]),
    ],
    facts: [
      ...digest.visits.slice(0, 6).map((visit) => ({
        text: `${dayAndTime(visit.startsAt)} · ${visit.name}`,
        tone: 'plain' as const,
      })),
      ...digest.appointments.map((item) => ({
        text: `${text.visits.appointments} · ${dayAndTime(item.startsAt)} · ${item.title}`,
        tone: 'plain' as const,
      })),
      ...(callsKnown ? [] : [{ text: text.visits.callsUnknown, tone: 'muted' as const }]),
      ...(visitSummary.sharedPresence.total > 0
        ? [{ text: text.visits.presenceHint, tone: 'muted' as const }]
        : []),
    ],
    legend: [
      { kind: 'visit', label: text.visits.legendVisit },
      { kind: 'call', label: text.visits.legendCall },
      { kind: 'presence', label: text.visits.legendPresence },
    ],
    method: text.visits.method,
  };
  return [nightView, mealView, outingView, visitView];
}

export function digestAlertsView(digest: WeeklyDigest, language: WeeklyDigestLanguage) {
  const text = weeklyDigestTexts(language);
  const items: DigestListItem[] = digest.alerts.slice(0, 6).map((alert) => ({
    key: alert.id,
    badge: text.alerts.severity[alert.severity],
    tone:
      alert.severity === 'URGENT'
        ? 'urgent'
        : alert.severity === 'ATTENTION'
          ? 'attention'
          : 'info',
    title: alert.title,
    detail: `${digestWeekdayLabel(digestLocalDay(alert.openedAt, digest.timezone), language)} ${digestClock(digestLocalMinute(alert.openedAt, digest.timezone))}`,
  }));
  return {
    title: text.themes.alerts,
    empty: text.alerts.none,
    items,
    more:
      digest.alerts.length > 6
        ? digestPlural(text.alerts.more, digest.alerts.length - 6, language)
        : null,
  };
}

export function digestSensorsView(digest: WeeklyDigest, language: WeeklyDigestLanguage) {
  const text = weeklyDigestTexts(language);
  const items: DigestListItem[] = [];
  if (digest.daysWithoutData.length)
    items.push({
      key: 'days',
      badge: text.noData,
      tone: 'urgent',
      title: digestPlural(text.sensors.daysWithout, digest.daysWithoutData.length, language),
      detail: digest.daysWithoutData.map((day) => digestWeekdayLabel(day, language)).join(', '),
    });
  for (const issue of digest.sensorIssues)
    items.push({
      key: issue.id,
      badge:
        issue.kind === 'OFFLINE'
          ? text.sensors.offline
          : issue.kind === 'LOW_BATTERY'
            ? text.sensors.lowBattery
            : text.sensors.noSignal,
      tone: 'attention',
      title: `${issue.name}${issue.roomName ? ` · ${issue.roomName}` : ''}`,
      detail: issue.since
        ? fillDigestText(text.sensors.since, {
            date: digestDate(digestLocalDay(issue.since, digest.timezone), language),
          })
        : null,
    });
  return { title: text.themes.sensors, empty: text.sensors.allGood, items };
}

/** Values of the small 7-day charts. */
export function digestChartData(digest: WeeklyDigest, language: WeeklyDigestLanguage) {
  const visits = digestVisitDays(digest);
  const text = weeklyDigestTexts(language);
  return {
    days: digestWeekDays(digest.weekStart).map((day) => digestWeekdayLabel(day, language)),
    mealRows: WEEKLY_DIGEST_MEALS.map((meal) => text.meals.rows[meal]),
    nights: digest.metrics.nights.days.map((day) => ({
      bedtime: day.bedtimeMinute,
      wake: day.wakeMinute === null ? null : day.wakeMinute + 1440,
      risings: day.risings,
      restless: digest.nights.restlessNights.includes(day.date),
    })),
    usualWake: digest.nights.usual?.wake == null ? null : digest.nights.usual.wake + 1440,
    meals: digest.metrics.meals.days.map((day) =>
      WEEKLY_DIGEST_MEALS.map((meal) => day.meals[meal]),
    ),
    outings: digest.metrics.outings.days.map((day) => ({ count: day.count, minutes: day.minutes })),
    visits: digestWeekDays(digest.weekStart).map((day, index) => ({
      visits: Math.min(visits.get(day) ?? 0, 2),
      calls: Math.min(digest.metrics.calls.days[index]?.count ?? 0, 2),
      presence: (digest.metrics.sharedPresence.days[index]?.count ?? 0) > 0,
    })),
  };
}

/** Address of the PDF made on the box. */
export function weeklyDigestPdfPath(weekStart: string, language: WeeklyDigestLanguage) {
  return `/api/v1/weekly-digest/pdf?week=${encodeURIComponent(weekStart)}&lang=${language}`;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of bytes, to write a PDF made on the phone (demo) into a file. */
export function toBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += BASE64[a >> 2];
    output += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : BASE64[c & 63];
  }
  return output;
}
