import {
  WEEKLY_DIGEST_BASELINE_WEEKS,
  buildWeeklyDigest,
  digestShiftDate,
  digestWeekDays,
  digestWeekStart,
  digestZonedTime,
  latestDigestWeek,
  type WeeklyDigest,
  type WeeklyDigestContext,
  type WeeklyDigestMealState,
  type WeeklyDigestMetrics,
} from './weekly-digest.js';

/**
 * Weekly digests of the "Maison Martin" demos (web and mobile): a believable week for Jeanne,
 * computed by the real digest rules from made-up sensor measures. The latest week shows a
 * notable change: she gets up about 40 minutes later, gets up more at night, goes out less
 * and three meals show no kitchen activity. Earlier weeks are ordinary.
 */
export interface WeeklyDigestDemoLabels {
  /** Home help, son, daughter (the people of the demo notebook). */
  visitors: { help: string; son: string; daughter: string };
  appointment: string;
  alertMorning: string;
  alertBattery: string;
  sensorName: string;
  sensorRoom: string;
}

export interface WeeklyDigestDemoOptions {
  timeZone?: string;
  residentName?: string;
  labels: WeeklyDigestDemoLabels;
  now?: () => Date;
}

export interface WeeklyDigestDemoResponse {
  status: number;
  body?: unknown;
}

export interface WeeklyDigestDemo {
  digest(week?: string | null): WeeklyDigest | null;
  handle(method: string, pathname: string, search?: string): WeeklyDigestDemoResponse | null;
}

const HISTORY_WEEKS = 8;

/** A small deterministic pseudo-random number in [0, 1) from a text. */
function noise(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}
const around = (seed: string, center: number, spread: number) =>
  Math.round(center + (noise(seed) * 2 - 1) * spread);

function demoMetrics(weekStart: string, changed: boolean): WeeklyDigestMetrics {
  const days = digestWeekDays(weekStart);
  const meal = (seed: string, missed: boolean): WeeklyDigestMealState =>
    missed ? 'NOT_SEEN' : noise(seed) < 0.04 ? 'NOT_SEEN' : 'SEEN';
  const nights = days.map((date, index) => {
    const later = changed && index >= 1;
    const bedtimeMinute = around(`${date}:bed`, 22 * 60 + 15, 20);
    const wakeMinute = around(`${date}:wake`, later ? 8 * 60 + 5 : 7 * 60 + 20, 12);
    const risings = changed
      ? [1, 3, 2, 3, 2, 3, 1][index]!
      : Math.max(0, around(`${date}:risings`, 1, 1));
    return {
      date,
      bedtimeMinute,
      wakeMinute,
      inBedMinutes: wakeMinute + 1440 - bedtimeMinute - around(`${date}:settle`, 12, 6),
      risings,
    };
  });
  const missedThisWeek = changed
    ? new Set([`${days[3]}:LUNCH`, `${days[4]}:BREAKFAST`, `${days[5]}:LUNCH`])
    : new Set<string>();
  const outingPattern = changed ? [1, 0, 1, 0, 0, 1, 0] : [1, 1, 0, 1, 2, 1, 1];
  return {
    version: 1,
    weekStart,
    days: days.map((date) => ({ date, hasData: true })),
    nights: { source: 'BED', days: nights },
    meals: {
      equipped: true,
      days: days.map((date) => ({
        date,
        meals: {
          BREAKFAST: meal(`${date}:b`, missedThisWeek.has(`${date}:BREAKFAST`)),
          LUNCH: meal(`${date}:l`, missedThisWeek.has(`${date}:LUNCH`)),
          DINNER: meal(`${date}:d`, missedThisWeek.has(`${date}:DINNER`)),
        },
        fridgeOpenings: around(`${date}:fridge`, changed ? 6 : 8, 2),
      })),
    },
    outings: {
      equipped: true,
      days: days.map((date, index) => {
        const count = outingPattern[index] ?? 0;
        return {
          date,
          count,
          minutes: count
            ? Array.from({ length: count }, (_, n) => around(`${date}:out${n}`, 70, 35)).reduce(
                (sum, value) => sum + value,
                0,
              )
            : 0,
        };
      }),
    },
    calls: {
      available: true,
      days: days.map((date, index) => {
        const count = [0, 1, 0, 1, 0, 0, 1][index] ?? 0;
        return { date, count, minutes: count ? around(`${date}:call`, 18, 8) : 0 };
      }),
    },
    sharedPresence: {
      equipped: true,
      days: days.map((date, index) => ({ date, count: [1, 0, 1, 0, 1, 1, 1][index] ?? 0 })),
    },
  };
}

export function createWeeklyDigestDemo(options: WeeklyDigestDemoOptions): WeeklyDigestDemo {
  const timeZone = options.timeZone ?? 'Europe/Paris';
  const now = options.now ?? (() => new Date());
  const labels = options.labels;
  const at = (date: string, minute: number) =>
    digestZonedTime(date, minute, timeZone).toISOString();

  const context = (weekStart: string, latest: string): WeeklyDigestContext => {
    const days = digestWeekDays(weekStart);
    const changed = weekStart === latest;
    const earliest = digestShiftDate(latest, -7 * (HISTORY_WEEKS - 1));
    const visits = [
      { day: 0, minute: 10 * 60, name: labels.visitors.help },
      { day: 2, minute: 10 * 60, name: labels.visitors.help },
      { day: 4, minute: 10 * 60, name: labels.visitors.help },
      { day: 5, minute: 15 * 60, name: labels.visitors.son },
      { day: 6, minute: 12 * 60, name: labels.visitors.daughter },
    ].map((visit, index) => ({
      id: `digest-visit-${weekStart}-${index}`,
      name: visit.name,
      startsAt: at(days[visit.day]!, visit.minute),
      confirmed: index !== 3 || !changed,
    }));
    return {
      weekStart,
      timezone: timeZone,
      residentName: options.residentName ?? 'Jeanne Martin',
      generatedAt: now().toISOString(),
      previousWeek: weekStart > earliest ? digestShiftDate(weekStart, -7) : null,
      nextWeek: weekStart < latest ? digestShiftDate(weekStart, 7) : null,
      visits,
      appointments: changed
        ? [
            {
              id: `digest-appointment-${weekStart}`,
              title: labels.appointment,
              startsAt: at(days[3]!, 14 * 60 + 30),
            },
          ]
        : [],
      alerts: changed
        ? [
            {
              id: `digest-alert-${weekStart}-morning`,
              openedAt: at(days[3]!, 9 * 60 + 10),
              title: labels.alertMorning,
              severity: 'ATTENTION',
              type: 'INACTIVITY',
              status: 'RESOLVED',
            },
            {
              id: `digest-alert-${weekStart}-battery`,
              openedAt: at(days[4]!, 18 * 60 + 2),
              title: labels.alertBattery,
              severity: 'INFO',
              type: 'LOW_BATTERY',
              status: 'ACKNOWLEDGED',
            },
          ]
        : [],
      sensorIssues: changed
        ? [
            {
              id: 'digest-sensor-bathroom',
              name: labels.sensorName,
              roomName: labels.sensorRoom,
              kind: 'LOW_BATTERY',
              since: at(days[4]!, 18 * 60 + 2),
            },
          ]
        : [],
    };
  };

  const digest = (week?: string | null): WeeklyDigest | null => {
    const latest = latestDigestWeek(now(), timeZone);
    const weekStart = week ? digestWeekStart(week) : latest;
    const earliest = digestShiftDate(latest, -7 * (HISTORY_WEEKS - 1));
    if (weekStart > latest || weekStart < earliest) return null;
    const baseline = Array.from({ length: WEEKLY_DIGEST_BASELINE_WEEKS }, (_, index) =>
      demoMetrics(digestShiftDate(weekStart, -7 * (index + 1)), false),
    );
    return buildWeeklyDigest(
      context(weekStart, latest),
      demoMetrics(weekStart, weekStart === latest),
      baseline,
    );
  };

  return {
    digest,
    handle(method, pathname, search = '') {
      if (pathname !== '/weekly-digest' || method !== 'GET') return null;
      const week = new URLSearchParams(search).get('week');
      const value = digest(week);
      return value
        ? { status: 200, body: value }
        : { status: 404, body: { message: 'Weekly digest not found' } };
    },
  };
}
