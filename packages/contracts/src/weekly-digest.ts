import { z } from 'zod';
import { heatwaveLocalClock, heatwaveZonedDate } from './heatwave.js';
import { liaisonDateSchema } from './liaison.js';

/**
 * Weekly digest of the family notebook: a plain summary of the week (Monday to Sunday) computed
 * on the box, from the sensors, the calendar, the TV video calls and the alerts. Every figure is
 * an estimate from sensors: the digest says so, shows missing data and never claims more.
 */

/** The digest of a week is ready on Sunday at this local time (minutes after midnight). */
export const WEEKLY_DIGEST_READY_MINUTE = 20 * 60;
/** Earlier weeks compared with the digest week to describe "the usual". */
export const WEEKLY_DIGEST_BASELINE_WEEKS = 4;
/** Weeks needed, with enough measured days, before Élise compares a theme with the usual. */
export const WEEKLY_DIGEST_MIN_BASELINE_WEEKS = 2;

export const WEEKLY_DIGEST_MEALS = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
export type WeeklyDigestMeal = (typeof WEEKLY_DIGEST_MEALS)[number];
/** Default meal windows, in local minutes: [start, end). A resident's meal habit widens them. */
export const WEEKLY_DIGEST_MEAL_WINDOWS: Record<WeeklyDigestMeal, readonly [number, number]> = {
  BREAKFAST: [6 * 60 + 30, 10 * 60 + 30],
  LUNCH: [11 * 60 + 30, 14 * 60 + 30],
  DINNER: [18 * 60, 21 * 60],
};

export const WEEKLY_DIGEST_LANGUAGES = ['fr', 'en', 'es', 'it', 'pt'] as const;
export type WeeklyDigestLanguage = (typeof WEEKLY_DIGEST_LANGUAGES)[number];
export const weeklyDigestLanguageSchema = z.enum(WEEKLY_DIGEST_LANGUAGES);

/** Any day of the wanted week; the API answers with the week (Monday) that holds it. */
export const weeklyDigestQuerySchema = z.object({ week: liaisonDateSchema.optional() });
export const weeklyDigestPdfQuerySchema = z.object({
  week: liaisonDateSchema.optional(),
  lang: z
    .string()
    .optional()
    .transform((value) => weeklyDigestLanguage(value)),
});
export type WeeklyDigestQuery = z.infer<typeof weeklyDigestQuerySchema>;

export function weeklyDigestLanguage(value: string | null | undefined): WeeklyDigestLanguage {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return (WEEKLY_DIGEST_LANGUAGES as readonly string[]).includes(base ?? '')
    ? (base as WeeklyDigestLanguage)
    : 'fr';
}

export type WeeklyDigestMealState = 'SEEN' | 'NOT_SEEN' | 'UNKNOWN';
/** BED: a bed sensor; MOTION: an estimate from the movements outside the bedroom. */
export type WeeklyDigestNightSource = 'BED' | 'MOTION';
export type WeeklyDigestThemeState = 'OK' | 'PARTIAL' | 'NOT_EQUIPPED' | 'NO_DATA';
export type WeeklyDigestTheme =
  'nights' | 'meals' | 'outings' | 'visits' | 'alerts' | 'sensors' | 'general';

export interface WeeklyDigestNightDay {
  /** The morning the night ends (the night of Sunday to Monday belongs to Monday). */
  date: string;
  /** Local minutes after midnight of the evening before; after midnight goes past 1440. */
  bedtimeMinute: number | null;
  /** Local minutes after midnight of `date`. */
  wakeMinute: number | null;
  /** Time in bed (bed sensor) or estimated night length (movements), in minutes. */
  inBedMinutes: number | null;
  /** Times the person seems to have got up during the night. */
  risings: number | null;
}

export interface WeeklyDigestMealDay {
  date: string;
  meals: Record<WeeklyDigestMeal, WeeklyDigestMealState>;
  /** Fridge door openings that day, or null without a working fridge sensor. */
  fridgeOpenings: number | null;
}

export interface WeeklyDigestOutingDay {
  date: string;
  /** Probable outings that started that day (main door, then no movement inside). */
  count: number | null;
  minutes: number | null;
}

export interface WeeklyDigestCallDay {
  date: string;
  count: number | null;
  minutes: number | null;
}

export interface WeeklyDigestPresenceDay {
  date: string;
  /** Moments when two distant rooms moved at the same time: someone else was maybe there. */
  count: number | null;
}

/** What the sensors measured, day by day. Kept on the box once the week is over. */
export interface WeeklyDigestMetrics {
  version: 1;
  weekStart: string;
  days: Array<{ date: string; hasData: boolean }>;
  nights: { source: WeeklyDigestNightSource | null; days: WeeklyDigestNightDay[] };
  meals: { equipped: boolean; days: WeeklyDigestMealDay[] };
  outings: { equipped: boolean; days: WeeklyDigestOutingDay[] };
  calls: { available: boolean; days: WeeklyDigestCallDay[] };
  sharedPresence: { equipped: boolean; days: WeeklyDigestPresenceDay[] };
}

export interface WeeklyDigestVisit {
  id: string;
  name: string;
  startsAt: string;
  /** A member of the family confirmed the visit in the notebook. */
  confirmed: boolean;
}

export interface WeeklyDigestAppointment {
  id: string;
  title: string;
  startsAt: string;
}

export interface WeeklyDigestAlert {
  id: string;
  openedAt: string;
  title: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
  type: string;
  status: string;
}

export interface WeeklyDigestSensorIssue {
  id: string;
  name: string;
  roomName: string | null;
  /** OFFLINE: no answer now; LOW_BATTERY: a battery alert; NO_SIGNAL: silent all week. */
  kind: 'OFFLINE' | 'LOW_BATTERY' | 'NO_SIGNAL';
  since: string | null;
}

/** Facts that do not come from the sensor measures: calendar, alerts, sensor health. */
export interface WeeklyDigestContext {
  weekStart: string;
  timezone: string;
  residentName: string | null;
  generatedAt: string;
  previousWeek: string | null;
  nextWeek: string | null;
  visits: WeeklyDigestVisit[];
  appointments: WeeklyDigestAppointment[];
  alerts: WeeklyDigestAlert[];
  sensorIssues: WeeklyDigestSensorIssue[];
}

export type WeeklyDigestStatementKey =
  | 'wakeLater'
  | 'wakeEarlier'
  | 'bedtimeLater'
  | 'bedtimeEarlier'
  | 'inBedShorter'
  | 'inBedLonger'
  | 'moreRisings'
  | 'fewerRisings'
  | 'moreMissedMeals'
  | 'fewerMissedMeals'
  | 'lessFridge'
  | 'moreFridge'
  | 'fewerOutings'
  | 'moreOutings'
  | 'fewerCalls'
  | 'moreCalls'
  | 'nightsStable'
  | 'mealsStable'
  | 'outingsStable'
  | 'noHistory'
  | 'daysWithoutData'
  | 'sensorIssues'
  | 'summaryNoData'
  | 'summaryFirst'
  | 'summaryCalm'
  | 'summaryChanges'
  | 'summaryAlerts';

/** One sentence of the digest, without its words: each app writes it in its language. */
export interface WeeklyDigestStatement {
  key: WeeklyDigestStatementKey;
  theme: WeeklyDigestTheme;
  tone: 'change' | 'stable' | 'info' | 'warning';
  /** minutes → a duration, clock → a time of day, count / usual / percent → numbers. */
  values: Partial<Record<'minutes' | 'clock' | 'count' | 'usual' | 'percent', number>>;
}

export interface WeeklyDigest extends WeeklyDigestContext {
  weekEnd: string;
  metrics: WeeklyDigestMetrics;
  /** Earlier weeks used to describe the usual (0 for a first digest). */
  comparisonWeeks: number;
  nights: {
    state: WeeklyDigestThemeState;
    source: WeeklyDigestNightSource | null;
    bedtime: number | null;
    wake: number | null;
    inBed: number | null;
    risingsPerNight: number | null;
    risingsTotal: number | null;
    measured: number;
    restlessNights: string[];
    shortNights: string[];
    usual: {
      bedtime: number | null;
      wake: number | null;
      inBed: number | null;
      risingsPerNight: number | null;
    } | null;
  };
  meals: {
    state: WeeklyDigestThemeState;
    seen: number;
    notSeen: number;
    unknown: number;
    missed: Array<{ date: string; meal: WeeklyDigestMeal }>;
    fridgePerDay: number | null;
    usual: { notSeen: number; fridgePerDay: number | null } | null;
  };
  outings: {
    state: WeeklyDigestThemeState;
    total: number;
    minutes: number;
    daysWithout: string[];
    longestDayMinutes: number | null;
    usual: { total: number; minutes: number } | null;
  };
  visitSummary: {
    planned: number;
    confirmed: number;
    calls: { state: WeeklyDigestThemeState; total: number; minutes: number; usual: number | null };
    sharedPresence: { state: WeeklyDigestThemeState; total: number };
  };
  alertSummary: { total: number; urgent: number; attention: number; info: number };
  daysWithoutData: string[];
  changes: WeeklyDigestStatement[];
  summary: WeeklyDigestStatement;
}

// ---------------------------------------------------------------------------------------------
// Calendar helpers. Weeks are named by their Monday, as a local date key (YYYY-MM-DD).

export function digestShiftDate(dateKey: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function digestWeekday(dateKey: string): number {
  const [year = 1970, month = 1, day = 1] = dateKey.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week holding `dateKey`. */
export function digestWeekStart(dateKey: string): string {
  return digestShiftDate(dateKey, -digestWeekday(dateKey));
}

export function digestWeekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => digestShiftDate(weekStart, index));
}

export function digestLocalClock(at: Date, timeZone: string) {
  return heatwaveLocalClock(at, timeZone);
}

/** The instant shown as `minute` (may pass 1440) on `dateKey` by the clocks of `timeZone`. */
export function digestZonedTime(dateKey: string, minute: number, timeZone: string): Date {
  const extraDays = Math.floor(minute / 1440);
  return heatwaveZonedDate(
    digestShiftDate(dateKey, extraDays),
    minute - extraDays * 1440,
    timeZone,
  );
}

/** The week whose digest is the latest one ready at `now`. */
export function latestDigestWeek(now: Date, timeZone: string): string {
  const { dateKey, minute } = digestLocalClock(now, timeZone);
  const monday = digestWeekStart(dateKey);
  return digestWeekday(dateKey) === 6 && minute >= WEEKLY_DIGEST_READY_MINUTE
    ? monday
    : digestShiftDate(monday, -7);
}

/** When the digest of `weekStart` is ready (Sunday evening, local time). */
export function digestReadyAt(weekStart: string, timeZone: string): Date {
  return digestZonedTime(digestShiftDate(weekStart, 6), WEEKLY_DIGEST_READY_MINUTE, timeZone);
}

/** True once the whole week, its Sunday evening included, is in the past. */
export function digestWeekClosed(weekStart: string, now: Date, timeZone: string): boolean {
  return (
    now.getTime() >= digestZonedTime(digestShiftDate(weekStart, 7), 3 * 60, timeZone).getTime()
  );
}

// ---------------------------------------------------------------------------------------------
// Building the digest from the metrics of the week and of the weeks before.

const NIGHT_MIN_MEASURED = 4;
const SIGNIFICANT = {
  clockMinutes: 30,
  inBedMinutes: 45,
  risingsPerNight: 0.8,
  shortNightMinutes: 60,
} as const;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

const known = <T>(values: Array<T | null | undefined>): T[] =>
  values.filter((value): value is T => value !== null && value !== undefined);

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

function themeState(equipped: boolean, measured: number, expected: number): WeeklyDigestThemeState {
  if (!equipped) return 'NOT_EQUIPPED';
  if (measured === 0) return 'NO_DATA';
  return measured < expected ? 'PARTIAL' : 'OK';
}

function nightSummary(metrics: WeeklyDigestMetrics) {
  const days = metrics.nights.days;
  const bedtimes = known(days.map((day) => day.bedtimeMinute));
  const wakes = known(days.map((day) => day.wakeMinute));
  const inBed = known(days.map((day) => day.inBedMinutes));
  const risings = known(days.map((day) => day.risings));
  return {
    measured: days.filter((day) => day.wakeMinute !== null || day.bedtimeMinute !== null).length,
    bedtime: mean(bedtimes),
    wake: mean(wakes),
    inBed: mean(inBed),
    risingsPerNight: mean(risings),
    risingsTotal: risings.length ? risings.reduce((sum, value) => sum + value, 0) : null,
    bedtimes,
    wakes,
    inBedValues: inBed,
    risingValues: risings,
  };
}

function mealSummary(metrics: WeeklyDigestMetrics) {
  const days = metrics.meals.days;
  const states = days.flatMap((day) =>
    WEEKLY_DIGEST_MEALS.map((meal) => ({ date: day.date, meal, state: day.meals[meal] })),
  );
  const fridge = known(days.map((day) => day.fridgeOpenings));
  return {
    seen: states.filter(({ state }) => state === 'SEEN').length,
    notSeen: states.filter(({ state }) => state === 'NOT_SEEN').length,
    unknown: states.filter(({ state }) => state === 'UNKNOWN').length,
    measuredDays: days.filter((day) =>
      WEEKLY_DIGEST_MEALS.some((meal) => day.meals[meal] !== 'UNKNOWN'),
    ).length,
    missed: states
      .filter(({ state }) => state === 'NOT_SEEN')
      .map(({ date, meal }) => ({ date, meal })),
    fridgePerDay: mean(fridge),
  };
}

function outingSummary(metrics: WeeklyDigestMetrics) {
  const days = metrics.outings.days.filter((day) => day.count !== null);
  return {
    measured: days.length,
    total: days.reduce((sum, day) => sum + (day.count ?? 0), 0),
    minutes: days.reduce((sum, day) => sum + (day.minutes ?? 0), 0),
    daysWithout: days.filter((day) => day.count === 0).map((day) => day.date),
    longestDayMinutes: days.length ? Math.max(...days.map((day) => day.minutes ?? 0)) : null,
  };
}

function callSummary(metrics: WeeklyDigestMetrics) {
  const days = metrics.calls.days.filter((day) => day.count !== null);
  return {
    measured: days.length,
    total: days.reduce((sum, day) => sum + (day.count ?? 0), 0),
    minutes: days.reduce((sum, day) => sum + (day.minutes ?? 0), 0),
  };
}

interface Candidate {
  statement: WeeklyDigestStatement;
  score: number;
}

const statement = (
  key: WeeklyDigestStatementKey,
  theme: WeeklyDigestTheme,
  tone: WeeklyDigestStatement['tone'],
  values: WeeklyDigestStatement['values'] = {},
): WeeklyDigestStatement => ({ key, theme, tone, values });

/**
 * The digest of a week. `baseline` holds the metrics of the weeks before (most recent first,
 * at most four are used). Pure: the API, the demos and the tests call it the same way.
 */
export function buildWeeklyDigest(
  context: WeeklyDigestContext,
  metrics: WeeklyDigestMetrics,
  baseline: WeeklyDigestMetrics[],
): WeeklyDigest {
  const history = baseline.slice(0, WEEKLY_DIGEST_BASELINE_WEEKS);
  const nights = nightSummary(metrics);
  const meals = mealSummary(metrics);
  const outings = outingSummary(metrics);
  const calls = callSummary(metrics);

  // The usual of each theme, only from weeks that measured it enough.
  const nightWeeks = history
    .filter((week) => week.nights.source)
    .map(nightSummary)
    .filter((week) => week.measured >= NIGHT_MIN_MEASURED);
  const mealWeeks = history
    .filter((week) => week.meals.equipped)
    .map(mealSummary)
    .filter((week) => week.measuredDays >= NIGHT_MIN_MEASURED);
  const outingWeeks = history
    .filter((week) => week.outings.equipped)
    .map(outingSummary)
    .filter((week) => week.measured >= 5);
  const callWeeks = history
    .filter((week) => week.calls.available)
    .map(callSummary)
    .filter((week) => week.measured >= 5);
  const enough = (weeks: unknown[]) => weeks.length >= WEEKLY_DIGEST_MIN_BASELINE_WEEKS;

  const usualNights = enough(nightWeeks)
    ? {
        bedtime: median(nightWeeks.flatMap((week) => week.bedtimes)),
        wake: median(nightWeeks.flatMap((week) => week.wakes)),
        inBed: median(nightWeeks.flatMap((week) => week.inBedValues)),
        risingsPerNight: mean(known(nightWeeks.map((week) => week.risingsPerNight))),
      }
    : null;
  const usualMeals = enough(mealWeeks)
    ? {
        notSeen: Math.round(median(mealWeeks.map((week) => week.notSeen)) ?? 0),
        fridgePerDay: median(known(mealWeeks.map((week) => week.fridgePerDay))),
      }
    : null;
  const usualOutings = enough(outingWeeks)
    ? {
        total: Math.round(median(outingWeeks.map((week) => week.total)) ?? 0),
        minutes: Math.round(median(outingWeeks.map((week) => week.minutes)) ?? 0),
      }
    : null;
  const usualCalls = enough(callWeeks)
    ? Math.round(median(callWeeks.map((week) => week.total)) ?? 0)
    : null;

  // A restless night: at least 3 risings, and 2 more than the usual night.
  const restlessLimit = Math.max(
    3,
    usualNights?.risingsPerNight !== null && usualNights?.risingsPerNight !== undefined
      ? Math.round(usualNights.risingsPerNight + 2)
      : 3,
  );
  const restlessNights = metrics.nights.days
    .filter((day) => day.risings !== null && day.risings >= restlessLimit)
    .map((day) => day.date);
  const shortNights =
    usualNights?.inBed !== null && usualNights?.inBed !== undefined
      ? metrics.nights.days
          .filter(
            (day) =>
              day.inBedMinutes !== null &&
              day.inBedMinutes < usualNights.inBed! - SIGNIFICANT.shortNightMinutes,
          )
          .map((day) => day.date)
      : [];

  // What changed: one candidate per signal, ranked by how far it is from the usual.
  const candidates: Candidate[] = [];
  const changedThemes = new Set<WeeklyDigestTheme>();
  const push = (candidate: Candidate) => {
    candidates.push(candidate);
    changedThemes.add(candidate.statement.theme);
  };
  if (usualNights && nights.measured >= NIGHT_MIN_MEASURED) {
    if (nights.wake !== null && usualNights.wake !== null) {
      const shift = nights.wake - usualNights.wake;
      if (Math.abs(shift) >= SIGNIFICANT.clockMinutes)
        // Getting up later or earlier is the landmark families notice first.
        push({
          score: Math.abs(shift) / 20,
          statement: statement(shift > 0 ? 'wakeLater' : 'wakeEarlier', 'nights', 'change', {
            minutes: roundTo(Math.abs(shift), 5),
            clock: Math.round(nights.wake),
          }),
        });
    }
    if (nights.bedtime !== null && usualNights.bedtime !== null) {
      const shift = nights.bedtime - usualNights.bedtime;
      if (Math.abs(shift) >= SIGNIFICANT.clockMinutes)
        push({
          score: Math.abs(shift) / SIGNIFICANT.clockMinutes,
          statement: statement(shift > 0 ? 'bedtimeLater' : 'bedtimeEarlier', 'nights', 'change', {
            minutes: roundTo(Math.abs(shift), 5),
            clock: Math.round(nights.bedtime) % 1440,
          }),
        });
    }
    if (nights.inBed !== null && usualNights.inBed !== null) {
      const shift = nights.inBed - usualNights.inBed;
      if (Math.abs(shift) >= SIGNIFICANT.inBedMinutes)
        push({
          score: Math.abs(shift) / SIGNIFICANT.inBedMinutes,
          statement: statement(shift < 0 ? 'inBedShorter' : 'inBedLonger', 'nights', 'change', {
            minutes: roundTo(Math.abs(shift), 5),
          }),
        });
    }
    if (nights.risingsPerNight !== null && usualNights.risingsPerNight !== null) {
      const shift = nights.risingsPerNight - usualNights.risingsPerNight;
      const relative =
        usualNights.risingsPerNight > 0 ? Math.abs(shift) / usualNights.risingsPerNight : 1;
      if (Math.abs(shift) >= SIGNIFICANT.risingsPerNight && relative >= 0.4)
        push({
          score: Math.abs(shift) / SIGNIFICANT.risingsPerNight,
          statement: statement(shift > 0 ? 'moreRisings' : 'fewerRisings', 'nights', 'change', {
            count: oneDecimal(nights.risingsPerNight),
            usual: oneDecimal(usualNights.risingsPerNight),
          }),
        });
    }
  }
  if (usualMeals && meals.measuredDays >= NIGHT_MIN_MEASURED) {
    const shift = meals.notSeen - usualMeals.notSeen;
    if (Math.abs(shift) >= 2)
      push({
        score: Math.abs(shift) / 2,
        statement: statement(
          shift > 0 ? 'moreMissedMeals' : 'fewerMissedMeals',
          'meals',
          'change',
          { count: meals.notSeen, usual: usualMeals.notSeen },
        ),
      });
    if (meals.fridgePerDay !== null && usualMeals.fridgePerDay && usualMeals.fridgePerDay >= 2) {
      const ratio = meals.fridgePerDay / usualMeals.fridgePerDay - 1;
      if (Math.abs(ratio) >= 0.3)
        push({
          score: Math.abs(ratio) / 0.3,
          statement: statement(ratio < 0 ? 'lessFridge' : 'moreFridge', 'meals', 'change', {
            percent: roundTo(Math.abs(ratio) * 100, 5),
          }),
        });
    }
  }
  if (usualOutings && outings.measured >= 5) {
    const shift = outings.total - usualOutings.total;
    const relative = usualOutings.total > 0 ? Math.abs(shift) / usualOutings.total : 1;
    if (Math.abs(shift) >= 2 && relative >= 0.35)
      push({
        score: relative / 0.35,
        statement: statement(shift < 0 ? 'fewerOutings' : 'moreOutings', 'outings', 'change', {
          count: outings.total,
          usual: usualOutings.total,
        }),
      });
  }
  if (usualCalls !== null && calls.measured >= 5) {
    const shift = calls.total - usualCalls;
    if (Math.abs(shift) >= 2)
      push({
        score: Math.abs(shift) / 2.5,
        statement: statement(shift < 0 ? 'fewerCalls' : 'moreCalls', 'visits', 'change', {
          count: calls.total,
          usual: usualCalls,
        }),
      });
  }

  const daysWithoutData = metrics.days.filter((day) => !day.hasData).map((day) => day.date);
  const warnings: WeeklyDigestStatement[] = [];
  if (daysWithoutData.length)
    warnings.push(
      statement('daysWithoutData', 'sensors', 'warning', { count: daysWithoutData.length }),
    );
  if (context.sensorIssues.length)
    warnings.push(
      statement('sensorIssues', 'sensors', 'warning', { count: context.sensorIssues.length }),
    );

  const comparisonWeeks = Math.max(
    nightWeeks.length,
    mealWeeks.length,
    outingWeeks.length,
    callWeeks.length,
  );
  const hasHistory = Boolean(usualNights || usualMeals || usualOutings || usualCalls !== null);
  const ranked = candidates
    .sort((left, right) => right.score - left.score)
    .map(({ statement: item }) => item);
  const room = Math.max(1, 5 - warnings.length);
  let changes: WeeklyDigestStatement[];
  if (!hasHistory) {
    changes = [statement('noHistory', 'general', 'info'), ...warnings];
  } else {
    changes = ranked.slice(0, room);
    // At least three sentences: themes without change are said to be stable.
    const stable: Array<[WeeklyDigestTheme, WeeklyDigestStatementKey, boolean]> = [
      ['nights', 'nightsStable', Boolean(usualNights) && nights.measured >= NIGHT_MIN_MEASURED],
      ['meals', 'mealsStable', Boolean(usualMeals) && meals.measuredDays >= NIGHT_MIN_MEASURED],
      ['outings', 'outingsStable', Boolean(usualOutings) && outings.measured >= 5],
    ];
    for (const [theme, key, measured] of stable) {
      if (changes.length + warnings.length >= 3) break;
      if (measured && !changedThemes.has(theme)) changes.push(statement(key, theme, 'stable'));
    }
    changes = [...changes, ...warnings].slice(0, 5);
  }

  const urgent = context.alerts.filter((alert) => alert.severity === 'URGENT').length;
  const measuredAnything =
    nights.measured > 0 || meals.measuredDays > 0 || outings.measured > 0 || calls.measured > 0;
  // The summary counts the changes the family will read, not those left out for room.
  const changeCount = Math.min(ranked.length, room);
  const summary = !measuredAnything
    ? statement('summaryNoData', 'general', 'warning')
    : urgent > 0
      ? statement('summaryAlerts', 'alerts', 'warning', { count: urgent })
      : !hasHistory
        ? statement('summaryFirst', 'general', 'info')
        : changeCount > 0
          ? statement('summaryChanges', 'general', 'change', { count: changeCount })
          : statement('summaryCalm', 'general', 'stable');

  return {
    ...context,
    weekEnd: digestShiftDate(metrics.weekStart, 6),
    metrics,
    comparisonWeeks,
    nights: {
      state: themeState(Boolean(metrics.nights.source), nights.measured, 7),
      source: metrics.nights.source,
      bedtime: nights.bedtime === null ? null : Math.round(nights.bedtime),
      wake: nights.wake === null ? null : Math.round(nights.wake),
      inBed: nights.inBed === null ? null : Math.round(nights.inBed),
      risingsPerNight: nights.risingsPerNight === null ? null : oneDecimal(nights.risingsPerNight),
      risingsTotal: nights.risingsTotal,
      measured: nights.measured,
      restlessNights,
      shortNights,
      usual: usualNights
        ? {
            bedtime: usualNights.bedtime === null ? null : Math.round(usualNights.bedtime),
            wake: usualNights.wake === null ? null : Math.round(usualNights.wake),
            inBed: usualNights.inBed === null ? null : Math.round(usualNights.inBed),
            risingsPerNight:
              usualNights.risingsPerNight === null ? null : oneDecimal(usualNights.risingsPerNight),
          }
        : null,
    },
    meals: {
      state: themeState(metrics.meals.equipped, meals.measuredDays, 7),
      seen: meals.seen,
      notSeen: meals.notSeen,
      unknown: meals.unknown,
      missed: meals.missed,
      fridgePerDay: meals.fridgePerDay === null ? null : oneDecimal(meals.fridgePerDay),
      usual: usualMeals
        ? {
            notSeen: usualMeals.notSeen,
            fridgePerDay:
              usualMeals.fridgePerDay === null ? null : oneDecimal(usualMeals.fridgePerDay),
          }
        : null,
    },
    outings: {
      state: themeState(metrics.outings.equipped, outings.measured, 7),
      total: outings.total,
      minutes: outings.minutes,
      daysWithout: outings.daysWithout,
      longestDayMinutes: outings.longestDayMinutes,
      usual: usualOutings,
    },
    visitSummary: {
      planned: context.visits.length,
      confirmed: context.visits.filter((visit) => visit.confirmed).length,
      calls: {
        state: themeState(metrics.calls.available, calls.measured, 7),
        total: calls.total,
        minutes: calls.minutes,
        usual: usualCalls,
      },
      sharedPresence: {
        state: themeState(
          metrics.sharedPresence.equipped,
          metrics.sharedPresence.days.filter((day) => day.count !== null).length,
          7,
        ),
        total: metrics.sharedPresence.days.reduce((sum, day) => sum + (day.count ?? 0), 0),
      },
    },
    alertSummary: {
      total: context.alerts.length,
      urgent,
      attention: context.alerts.filter((alert) => alert.severity === 'ATTENTION').length,
      info: context.alerts.filter((alert) => alert.severity === 'INFO').length,
    },
    daysWithoutData,
    changes,
    summary,
  };
}

/** Metrics of a week where nothing could be measured (no equipment, or data no longer kept). */
export function emptyWeeklyDigestMetrics(weekStart: string): WeeklyDigestMetrics {
  const days = digestWeekDays(weekStart);
  return {
    version: 1,
    weekStart,
    days: days.map((date) => ({ date, hasData: false })),
    nights: {
      source: null,
      days: days.map((date) => ({
        date,
        bedtimeMinute: null,
        wakeMinute: null,
        inBedMinutes: null,
        risings: null,
      })),
    },
    meals: {
      equipped: false,
      days: days.map((date) => ({
        date,
        meals: { BREAKFAST: 'UNKNOWN', LUNCH: 'UNKNOWN', DINNER: 'UNKNOWN' },
        fridgeOpenings: null,
      })),
    },
    outings: { equipped: false, days: days.map((date) => ({ date, count: null, minutes: null })) },
    calls: { available: false, days: days.map((date) => ({ date, count: null, minutes: null })) },
    sharedPresence: { equipped: false, days: days.map((date) => ({ date, count: null })) },
  };
}

/** A stored metrics value, or null when it is not one (older format, corrupted row). */
export function parseWeeklyDigestMetrics(value: unknown): WeeklyDigestMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<WeeklyDigestMetrics>;
  if (
    record.version !== 1 ||
    typeof record.weekStart !== 'string' ||
    !Array.isArray(record.days) ||
    !record.nights ||
    !record.meals ||
    !record.outings ||
    !record.calls ||
    !record.sharedPresence
  )
    return null;
  return record as WeeklyDigestMetrics;
}
