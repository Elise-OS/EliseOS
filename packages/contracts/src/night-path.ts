import { z } from 'zod';

/**
 * Night path lighting ("chemin lumineux de nuit").
 *
 * When the resident moves in one of the trigger rooms during the night window, Élise turns on
 * every light of the chosen rooms, softly and warmly, then turns them off after a few minutes
 * without movement. It is a comfort light, not a medical device. Any Home Assistant `light.*`
 * entity qualifies (Zigbee strip, bulb or night light): nothing depends on a particular model.
 */

export const NIGHT_PATH_OFF_DELAYS = [1, 3, 5, 10] as const;
export type NightPathOffDelay = (typeof NIGHT_PATH_OFF_DELAYS)[number];
export const NIGHT_PATH_MIN_KELVIN = 2_000;
export const NIGHT_PATH_MAX_KELVIN = 4_000;
/** Duration of the « Tester » button: long enough to walk to the room and look. */
export const NIGHT_PATH_TEST_SECONDS = 20;
/** Fade in / fade out, in seconds, when the light supports transitions. */
export const NIGHT_PATH_TRANSITION_SECONDS = 2;

export const DEFAULT_NIGHT_PATH = {
  enabled: true,
  includeBedExit: true,
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  brightnessPercent: 25,
  colorTemperatureKelvin: 2_200,
  offDelayMinutes: 3 as NightPathOffDelay,
};

const roomIdsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(30);
const minuteSchema = z.number().int().min(0).max(1_439);

const brightnessSchema = z.number().int().min(1).max(100);
const colorTemperatureSchema = z
  .number()
  .int()
  .min(NIGHT_PATH_MIN_KELVIN)
  .max(NIGHT_PATH_MAX_KELVIN);
const offDelaySchema = z.union(NIGHT_PATH_OFF_DELAYS.map((value) => z.literal(value)));

/** Fields without defaults: a partial update must never reset what it does not mention. */
const nightPathFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  /** Rooms whose motion or presence sensors start the path. */
  triggerRoomIds: roomIdsSchema,
  /** Also start the path when a bed sensor of a trigger room reports that the bed is empty. */
  includeBedExit: z.boolean(),
  /** Rooms whose lights are turned on, with or without a sensor of their own. */
  lightRoomIds: roomIdsSchema,
  startMinute: minuteSchema,
  endMinute: minuteSchema,
  brightnessPercent: brightnessSchema,
  colorTemperatureKelvin: colorTemperatureSchema,
  offDelayMinutes: offDelaySchema,
});

const distinctWindow = (value: {
  startMinute?: number | undefined;
  endMinute?: number | undefined;
}) =>
  value.startMinute === undefined ||
  value.endMinute === undefined ||
  value.startMinute !== value.endMinute;
const windowIssue = {
  message: 'The night window needs different start and end times',
  path: ['endMinute'],
};

export const nightPathInputSchema = nightPathFieldsSchema
  .extend({
    enabled: z.boolean().default(DEFAULT_NIGHT_PATH.enabled),
    includeBedExit: z.boolean().default(DEFAULT_NIGHT_PATH.includeBedExit),
    startMinute: minuteSchema.default(DEFAULT_NIGHT_PATH.startMinute),
    endMinute: minuteSchema.default(DEFAULT_NIGHT_PATH.endMinute),
    brightnessPercent: brightnessSchema.default(DEFAULT_NIGHT_PATH.brightnessPercent),
    colorTemperatureKelvin: colorTemperatureSchema.default(
      DEFAULT_NIGHT_PATH.colorTemperatureKelvin,
    ),
    offDelayMinutes: offDelaySchema.default(DEFAULT_NIGHT_PATH.offDelayMinutes),
  })
  .refine(distinctWindow, windowIssue);
export const nightPathUpdateSchema = nightPathFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })
  .refine(distinctWindow, windowIssue);

export const nightPathSchema = nightPathFieldsSchema.extend({
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** When the lights of this path are expected to turn off, while it is lit. */
  activeUntil: z.iso.datetime().nullable(),
});

export const nightPathRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  floorName: z.string().nullable(),
  /** Motion or presence sensors that can start a path. */
  presenceSensors: z.number().int().min(0),
  /** Bed sensors that can start a path when the resident gets up. */
  bedSensors: z.number().int().min(0),
  /** Lights that a path can turn on. */
  lights: z.number().int().min(0),
});

export const nightPathOverviewSchema = z.object({
  timezone: z.string(),
  paths: z.array(nightPathSchema),
  rooms: z.array(nightPathRoomSchema),
});

export const nightPathTestSchema = z.object({
  lightRoomIds: roomIdsSchema,
  brightnessPercent: brightnessSchema.default(DEFAULT_NIGHT_PATH.brightnessPercent),
  colorTemperatureKelvin: colorTemperatureSchema.default(DEFAULT_NIGHT_PATH.colorTemperatureKelvin),
});

export const nightPathTestResultSchema = z.object({
  lights: z.number().int().min(0),
  seconds: z.number().int().min(0),
});

/** What a light accepts, as reported by Home Assistant. Unknown means "try the usual". */
export const lightFeaturesSchema = z.object({
  brightness: z.boolean(),
  colorTemperature: z.boolean(),
  transition: z.boolean(),
  minKelvin: z.number().int().positive().nullish(),
  maxKelvin: z.number().int().positive().nullish(),
});

export type NightPathInput = z.infer<typeof nightPathInputSchema>;
export type NightPathUpdate = z.infer<typeof nightPathUpdateSchema>;
export type NightPath = z.infer<typeof nightPathSchema>;
export type NightPathRoom = z.infer<typeof nightPathRoomSchema>;
export type NightPathOverview = z.infer<typeof nightPathOverviewSchema>;
export type NightPathTest = z.infer<typeof nightPathTestSchema>;
export type NightPathTestResult = z.infer<typeof nightPathTestResultSchema>;
export type LightFeatures = z.infer<typeof lightFeaturesSchema>;

/** True when `minute` (0–1439, local time) falls in [start, end), across midnight if needed. */
export function minuteInNightWindow(minute: number, startMinute: number, endMinute: number) {
  if (startMinute === endMinute) return false;
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}

/** Local minute of the day of `at` in `timeZone` (falls back to UTC for an unknown zone). */
export function localMinuteOfDay(at: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
  const hour = Number(parts.find(({ type }) => type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(({ type }) => type === 'minute')?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

/** "22:00" → 1320; null when the text is not a valid time. */
export function parseNightPathTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** 1320 → "22:00". */
export function formatNightPathTime(minute: number) {
  const safe = ((Math.round(minute) % 1_440) + 1_440) % 1_440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Home Assistant `light.turn_on` data for a night path. Only what the light supports is sent:
 * a plain on/off light gets no brightness, colour or transition at all. When the bridge does
 * not report the features (older bridge), the usual values are sent and Home Assistant adapts.
 */
export function nightPathTurnOnData(
  settings: { brightnessPercent: number; colorTemperatureKelvin: number },
  features: LightFeatures | null | undefined,
): Record<string, number> {
  const data: Record<string, number> = {};
  if (!features || features.brightness) data.brightness_pct = settings.brightnessPercent;
  if (!features || features.colorTemperature) {
    const min = features?.minKelvin ?? null;
    const max = features?.maxKelvin ?? null;
    let kelvin = settings.colorTemperatureKelvin;
    if (min !== null && kelvin < min) kelvin = min;
    if (max !== null && kelvin > max) kelvin = max;
    data.color_temp_kelvin = kelvin;
  }
  if (!features || features.transition) data.transition = NIGHT_PATH_TRANSITION_SECONDS;
  return data;
}

export function nightPathTurnOffData(features: LightFeatures | null | undefined) {
  return !features || features.transition ? { transition: NIGHT_PATH_TRANSITION_SECONDS } : {};
}
