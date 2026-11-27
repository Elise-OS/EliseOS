import { z } from 'zod';

/**
 * Heatwave mode ("mode canicule"): settings, API shapes and the pure rules shared by the API,
 * the worker and the demos. Everything here runs on the box; only the weather forecast comes
 * from the Internet, and the indoor trigger keeps working without it.
 */

const hour = z.number().int().min(0).max(23);

export const heatwaveSettingsSchema = z
  .object({
    /** Indoor trigger: at least one room at or above `celsius` for `minutes`. */
    indoorTrigger: z.object({
      enabled: z.boolean(),
      celsius: z.number().min(24).max(40),
      minutes: z.number().int().min(10).max(240),
    }),
    /** Weather trigger: forecast maximum of today or tomorrow at or above `celsius`. */
    forecastTrigger: z.object({
      enabled: z.boolean(),
      celsius: z.number().min(25).max(45),
    }),
    /** "Drink a glass of water" reminders on the TV while the mode is on. */
    reminders: z.object({
      enabled: z.boolean(),
      everyHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      startHour: hour,
      endHour: hour,
    }),
    /** Morning, daytime and evening advice under the TV banner. */
    tips: z.object({ enabled: z.boolean() }),
    /** Alert for the family through the alert engine: indoor heat lasting too long. */
    alert: z.object({
      enabled: z.boolean(),
      celsius: z.number().min(26).max(40),
      minutes: z.number().int().min(15).max(360),
    }),
  })
  .refine((value) => value.reminders.startHour < value.reminders.endHour, {
    message: 'The reminders must start before they end',
    path: ['reminders', 'endHour'],
  });

export type HeatwaveSettings = z.infer<typeof heatwaveSettingsSchema>;

export const DEFAULT_HEATWAVE_SETTINGS: HeatwaveSettings = {
  indoorTrigger: { enabled: true, celsius: 28, minutes: 30 },
  forecastTrigger: { enabled: true, celsius: 33 },
  reminders: { enabled: true, everyHours: 2, startHour: 9, endHour: 20 },
  tips: { enabled: true },
  alert: { enabled: true, celsius: 31, minutes: 60 },
};

/** Settings stored before a field existed, or damaged, fall back to the defaults. */
export function parseHeatwaveSettings(value: unknown): HeatwaveSettings {
  const parsed = heatwaveSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_HEATWAVE_SETTINGS);
}

export const heatwaveManualSchema = z.object({ active: z.boolean() });
export const heatwaveRegistrySchema = z.object({
  year: z.number().int().min(2020).max(2100),
});

/**
 * Hysteresis of the automatic deactivation: the indoor heat must stay below the indoor
 * threshold minus this margin (28 °C → 27 °C) for `HEATWAVE_COOL_MINUTES`.
 */
export const HEATWAVE_COOL_MARGIN = 1;
export const HEATWAVE_COOL_MINUTES = 120;
/** A temperature reading older than this no longer describes the room. */
export const HEATWAVE_FRESH_MINUTES = 90;
/** How long a drink reminder stays on the TV when nobody confirms it. */
export const HYDRATION_REMINDER_MINUTES = 10;
/** Official page about the heatwave registers kept by town halls (checked on 27 November 2026). */
export const HEATWAVE_REGISTRY_URL =
  'https://www.service-public.gouv.fr/particuliers/actualites/A14978';

export type HeatwaveSource = 'INDOOR' | 'FORECAST' | 'MANUAL';
export type HeatwaveManual = 'ON' | 'OFF';
export type HeatwaveTip = 'closeShutters' | 'refreshFace' | 'openWindows';

/** The last forecast the box received; `date` is the local day it was issued for. */
export interface HeatwaveForecast {
  date: string;
  todayMax: number | null;
  tomorrowMax: number | null;
  outdoorNow: number | null;
  city: string | null;
  fetchedAt: string;
}

export interface HeatwaveMemory {
  active: boolean;
  source: HeatwaveSource | null;
  /** ON: the family turned the mode on. OFF: turned off until the heat is over. */
  manual: HeatwaveManual | null;
}

export interface TimedReading {
  occurredAt: Date;
  value: number;
}

export interface HeatwaveStatus {
  settings: HeatwaveSettings;
  active: boolean;
  source: HeatwaveSource | null;
  manual: HeatwaveManual | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  timezone: string;
  indoor: {
    /** Number of rooms with a working temperature sensor. */
    sensors: number;
    current: number | null;
    maxToday: number | null;
    maxTodayRoom: string | null;
  };
  forecast: {
    available: boolean;
    city: string | null;
    todayMax: number | null;
    tomorrowMax: number | null;
    outdoorNow: number | null;
    fetchedAt: string | null;
  };
  reminders: {
    confirmed: number;
    missed: number;
    pending: number;
    /** Next reminder of today, if the mode stays on. */
    next: string | null;
  };
  registry: { due: boolean; year: number };
  canManage: boolean;
  canToggle: boolean;
}

export interface HeatwaveScreenView {
  active: boolean;
  tip: HeatwaveTip | null;
  reminder: { id: string; scheduledFor: string; expiresAt: string } | null;
}

const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;

const sortedReadings = (readings: TimedReading[], now: Date) =>
  readings
    .filter((reading) => Number.isFinite(reading.value) && reading.occurredAt <= now)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());

/**
 * The room has been at or above `celsius` without interruption for `minutes`. A sensor reports
 * on change, so its last value holds until the next one, as long as it is recent.
 */
export function sustainedAtOrAbove(
  readings: TimedReading[],
  celsius: number,
  minutes: number,
  now: Date,
): { active: boolean; since: Date | null; latest: number | null } {
  const sorted = sortedReadings(readings, now);
  const last = sorted.at(-1);
  if (!last) return { active: false, since: null, latest: null };
  if (minutesBetween(last.occurredAt, now) > HEATWAVE_FRESH_MINUTES)
    return { active: false, since: null, latest: null };
  let since: Date | null = null;
  for (const reading of sorted)
    since = reading.value >= celsius ? (since ?? reading.occurredAt) : null;
  return {
    active: since !== null && minutesBetween(since, now) >= minutes,
    since,
    latest: last.value,
  };
}

/**
 * The room has stayed below `celsius` for `minutes`. `known` is false when its sensor says
 * nothing recent: Élise then makes no conclusion from it.
 */
export function calmBelow(
  readings: TimedReading[],
  celsius: number,
  minutes: number,
  now: Date,
): { known: boolean; calm: boolean } {
  const sorted = sortedReadings(readings, now);
  const last = sorted.at(-1);
  if (!last || minutesBetween(last.occurredAt, now) > HEATWAVE_FRESH_MINUTES)
    return { known: false, calm: false };
  let lastHot = -1;
  sorted.forEach((reading, index) => {
    if (reading.value >= celsius) lastHot = index;
  });
  const calmSince = lastHot === -1 ? sorted[0]!.occurredAt : sorted[lastHot + 1]?.occurredAt;
  return { known: true, calm: !!calmSince && minutesBetween(calmSince, now) >= minutes };
}

/** "YYYY-MM-DD" and minute of the day of `date` on the wall clock of `timeZone`. */
export function heatwaveLocalClock(
  date: Date,
  timeZone: string,
): { dateKey: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '00';
  return {
    dateKey: `${part('year')}-${part('month')}-${part('day')}`,
    minute: (Number(part('hour')) % 24) * 60 + Number(part('minute')),
  };
}

/** The instant shown as `minute` on day `dateKey` by the clocks of `timeZone`. */
export function heatwaveZonedDate(dateKey: string, minute: number, timeZone: string): Date {
  const [year = 1970, month = 1, day = 1] = dateKey.split('-').map(Number);
  const wanted = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  let instant = wanted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = heatwaveLocalClock(new Date(instant), timeZone);
    const [y = 1970, m = 1, d = 1] = local.dateKey.split('-').map(Number);
    const shown = Date.UTC(y, m - 1, d, Math.floor(local.minute / 60), local.minute % 60);
    if (shown === wanted) break;
    instant += wanted - shown;
  }
  return new Date(instant);
}

export function previousDateKey(dateKey: string): string {
  const day = new Date(`${dateKey}T12:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Forecast maxima that still speak about today or tomorrow. Without Internet, yesterday's
 * "tomorrow" is still the best knowledge of today; older forecasts are ignored.
 */
export function relevantForecastMaxima(
  forecast: HeatwaveForecast | null,
  todayKey: string,
): number[] {
  if (!forecast) return [];
  const values =
    forecast.date === todayKey
      ? [forecast.todayMax, forecast.tomorrowMax]
      : forecast.date === previousDateKey(todayKey)
        ? [forecast.tomorrowMax]
        : [];
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

export interface HeatwaveEvaluation extends HeatwaveMemory {
  change: 'activated' | 'deactivated' | null;
  indoorHot: boolean;
  indoorCalm: boolean;
  forecastHot: boolean;
}

/**
 * Next state of the mode. Activation: indoor heat (≥ 28 °C for 30 min by default) or a hot
 * forecast (≥ 33 °C today or tomorrow). Automatic deactivation only once the heat is over:
 * every room below 27 °C for 2 h AND no hot forecast for today or tomorrow.
 * A family "on" holds until the family turns it off; a family "off" holds until the heat is over.
 */
export function evaluateHeatwave(input: {
  settings: HeatwaveSettings;
  previous: HeatwaveMemory;
  /** One entry per temperature sensor; `readings` cover the last hours. */
  sensors: Array<{ readings: TimedReading[] }>;
  forecast: HeatwaveForecast | null;
  now: Date;
  timeZone: string;
}): HeatwaveEvaluation {
  const { settings, previous, sensors, forecast, now, timeZone } = input;
  const indoor = settings.indoorTrigger;
  const indoorHot = sensors.some(
    (sensor) => sustainedAtOrAbove(sensor.readings, indoor.celsius, indoor.minutes, now).active,
  );
  const calmStates = sensors.map((sensor) =>
    calmBelow(sensor.readings, indoor.celsius - HEATWAVE_COOL_MARGIN, HEATWAVE_COOL_MINUTES, now),
  );
  const known = calmStates.filter((state) => state.known);
  // No temperature sensor at all: nothing indoors keeps the mode on. Sensors that all went
  // silent: Élise cannot tell, so the mode does not switch off on its own.
  const indoorCalm = sensors.length === 0 || (known.length > 0 && known.every((s) => s.calm));
  const todayKey = heatwaveLocalClock(now, timeZone).dateKey;
  const forecastHot = relevantForecastMaxima(forecast, todayKey).some(
    (value) => value >= settings.forecastTrigger.celsius,
  );
  const autoIndoor = indoor.enabled && indoorHot;
  const autoForecast = settings.forecastTrigger.enabled && forecastHot;
  const heatOver =
    (!indoor.enabled || indoorCalm) && (!settings.forecastTrigger.enabled || !forecastHot);
  const result = (state: HeatwaveMemory): HeatwaveEvaluation => ({
    ...state,
    change:
      state.active && !previous.active
        ? 'activated'
        : !state.active && previous.active
          ? 'deactivated'
          : null,
    indoorHot,
    indoorCalm,
    forecastHot,
  });

  if (previous.manual === 'ON') return result({ active: true, source: 'MANUAL', manual: 'ON' });
  if (previous.manual === 'OFF')
    return result({ active: false, source: null, manual: heatOver ? null : 'OFF' });
  if (previous.active) {
    if (heatOver) return result({ active: false, source: null, manual: null });
    return result({ active: true, source: previous.source, manual: null });
  }
  if (autoIndoor || autoForecast)
    return result({ active: true, source: autoIndoor ? 'INDOOR' : 'FORECAST', manual: null });
  return result({ active: false, source: null, manual: null });
}

/** Minutes of the day when a drink reminder is due, from start to end hour included. */
export function hydrationSlots(settings: HeatwaveSettings): number[] {
  const { everyHours, startHour, endHour } = settings.reminders;
  const slots: number[] = [];
  for (let at = startHour; at <= endHour; at += everyHours) slots.push(at * 60);
  return slots;
}

/** The reminder that should be on the TV at `now`, if any. */
export function dueHydrationReminder(
  settings: HeatwaveSettings,
  now: Date,
  timeZone: string,
): { scheduledFor: Date; expiresAt: Date } | null {
  if (!settings.reminders.enabled) return null;
  const { dateKey, minute } = heatwaveLocalClock(now, timeZone);
  const slot = hydrationSlots(settings).find(
    (start) => minute >= start && minute < start + HYDRATION_REMINDER_MINUTES,
  );
  if (slot === undefined) return null;
  const scheduledFor = heatwaveZonedDate(dateKey, slot, timeZone);
  return {
    scheduledFor,
    expiresAt: new Date(scheduledFor.getTime() + HYDRATION_REMINDER_MINUTES * 60_000),
  };
}

/** Next reminder of the same local day after `now`, or null. */
export function nextHydrationReminder(
  settings: HeatwaveSettings,
  now: Date,
  timeZone: string,
): Date | null {
  if (!settings.reminders.enabled) return null;
  const { dateKey, minute } = heatwaveLocalClock(now, timeZone);
  const slot = hydrationSlots(settings).find((start) => start > minute);
  return slot === undefined ? null : heatwaveZonedDate(dateKey, slot, timeZone);
}

/**
 * Advice under the TV banner: shutters in the morning, a fresh face in the day, and in the
 * evening open windows only when it is cooler outside than inside (both must be known).
 */
export function heatwaveTip(input: {
  settings: HeatwaveSettings;
  minute: number;
  outdoor: number | null;
  indoor: number | null;
}): HeatwaveTip | null {
  const { settings, minute, outdoor, indoor } = input;
  if (!settings.tips.enabled) return null;
  if (minute >= 8 * 60 && minute < 12 * 60) return 'closeShutters';
  if (minute >= 12 * 60 && minute < 20 * 60 + 30) return 'refreshFace';
  if (minute >= 20 * 60 + 30 && minute < 23 * 60)
    return outdoor !== null && indoor !== null && outdoor < indoor ? 'openWindows' : null;
  return null;
}

/** The town-hall registry reminder: from June to August, or at the first activation of the year. */
export function heatwaveRegistryDue(input: {
  now: Date;
  timeZone: string;
  acknowledgedYear: number | null;
  active: boolean;
}): { due: boolean; year: number } {
  const { dateKey } = heatwaveLocalClock(input.now, input.timeZone);
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const season = month >= 6 && month <= 8;
  return { due: input.acknowledgedYear !== year && (season || input.active), year };
}
