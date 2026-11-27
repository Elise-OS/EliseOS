import {
  HEATWAVE_COOL_MARGIN,
  heatwaveSettingsSchema,
  type HeatwaveSettings,
  type HeatwaveStatus,
} from '@elise/contracts';
import { dateLocale, t } from '../i18n';

/** "28", "27,5": a temperature as the family reads it, without trailing zeros. */
export const celsius = (value: number) =>
  new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(value);

export const clockTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone });

/** "30 min", "1 h", "1 h 30". */
export function duration(minutes: number) {
  if (minutes < 60) return t('heatwave.units.minutes', { value: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t('heatwave.units.hoursMinutes', { hours, minutes: String(rest).padStart(2, '0') })
    : t('heatwave.units.hours', { hours });
}

/** One press of a − / + button, kept inside the limits the box accepts. */
export function stepValue(value: number, delta: number, min: number, max: number, step: number) {
  const next = Math.round((value + delta) / step) * step;
  return Math.min(max, Math.max(min, Number(next.toFixed(1))));
}

/** The first reminder hour moves; the last one stays after it. */
export function withStartHour(settings: HeatwaveSettings, startHour: number): HeatwaveSettings {
  const start = Math.min(22, Math.max(0, startHour));
  return {
    ...settings,
    reminders: {
      ...settings.reminders,
      startHour: start,
      endHour: Math.max(settings.reminders.endHour, start + 1),
    },
  };
}

export function withEndHour(settings: HeatwaveSettings, endHour: number): HeatwaveSettings {
  const end = Math.min(23, Math.max(settings.reminders.startHour + 1, endHour));
  return { ...settings, reminders: { ...settings.reminders, endHour: end } };
}

export const settingsValid = (settings: HeatwaveSettings) =>
  heatwaveSettingsSchema.safeParse(settings).success;

/** The settings told as a few human sentences. */
export function heatwaveSummary(settings: HeatwaveSettings): string[] {
  const triggers = [
    settings.indoorTrigger.enabled
      ? t('heatwave.summary.indoor', {
          celsius: celsius(settings.indoorTrigger.celsius),
          duration: duration(settings.indoorTrigger.minutes),
        })
      : null,
    settings.forecastTrigger.enabled
      ? t('heatwave.summary.forecast', { celsius: celsius(settings.forecastTrigger.celsius) })
      : null,
  ].filter((part): part is string => part !== null);
  return [
    triggers.length
      ? t('heatwave.summary.triggers', { triggers: triggers.join(t('heatwave.summary.or')) })
      : t('heatwave.summary.manualOnly'),
    settings.reminders.enabled
      ? t('heatwave.summary.reminders', {
          every: settings.reminders.everyHours,
          start: settings.reminders.startHour,
          end: settings.reminders.endHour,
        })
      : t('heatwave.summary.noReminders'),
    settings.tips.enabled ? t('heatwave.summary.tips') : t('heatwave.summary.noTips'),
    settings.alert.enabled
      ? t('heatwave.summary.alert', {
          celsius: celsius(settings.alert.celsius),
          duration: duration(settings.alert.minutes),
        })
      : t('heatwave.summary.noAlert'),
  ];
}

export type HeatwaveTone = 'active' | 'paused' | 'idle';

export const heatwaveTone = (status: HeatwaveStatus): HeatwaveTone =>
  status.active ? 'active' : status.manual === 'OFF' ? 'paused' : 'idle';

export function heatwaveStatusLabel(status: HeatwaveStatus) {
  const tone = heatwaveTone(status);
  return tone === 'active'
    ? t('heatwave.card.statusOn')
    : tone === 'paused'
      ? t('heatwave.card.statusPaused')
      : t('heatwave.card.statusOff');
}

/** Why the mode is in its current state, in one calm sentence. */
export function heatwaveStateText(status: HeatwaveStatus): string {
  if (status.active && status.source === 'MANUAL') return t('heatwave.card.sourceManual');
  if (status.active && status.source === 'FORECAST')
    return status.forecast.city
      ? t('heatwave.card.sourceForecastCity', { city: status.forecast.city })
      : t('heatwave.card.sourceForecast');
  if (status.active) return t('heatwave.card.sourceIndoor');
  if (status.manual === 'OFF')
    return t('heatwave.card.paused', {
      celsius: celsius(status.settings.indoorTrigger.celsius - HEATWAVE_COOL_MARGIN),
    });
  if (!status.settings.indoorTrigger.enabled && !status.settings.forecastTrigger.enabled)
    return t('heatwave.card.idleManualOnly');
  return t('heatwave.card.idle');
}

export interface HeatwaveFact {
  key: 'indoor' | 'forecast' | 'reminders';
  label: string;
  value: string;
  detail?: string;
}

/** The three lines of the card: heat of the day, forecast and drink reminders. */
export function heatwaveFacts(status: HeatwaveStatus): HeatwaveFact[] {
  const { indoor, forecast, reminders } = status;
  const indoorValue =
    indoor.sensors === 0
      ? t('heatwave.card.indoorNoSensor')
      : indoor.maxToday === null
        ? t('heatwave.card.indoorNoData')
        : indoor.maxTodayRoom
          ? t('heatwave.card.indoorMaxRoom', {
              value: celsius(indoor.maxToday),
              room: indoor.maxTodayRoom,
            })
          : t('heatwave.card.indoorMax', { value: celsius(indoor.maxToday) });
  const forecastParts = [
    forecast.todayMax !== null
      ? t('heatwave.card.forecastToday', { value: celsius(forecast.todayMax) })
      : null,
    forecast.tomorrowMax !== null
      ? t('heatwave.card.forecastTomorrow', { value: celsius(forecast.tomorrowMax) })
      : null,
  ].filter((part): part is string => part !== null);
  const forecastValue =
    forecast.available && forecastParts.length
      ? forecastParts.join(' · ')
      : t('heatwave.card.forecastUnavailable');
  const remindersValue = status.settings.reminders.enabled
    ? reminders.shown > 0
      ? t('heatwave.card.remindersShown', { count: reminders.shown })
      : t('heatwave.card.remindersNone')
    : t('heatwave.card.remindersOff');
  const next =
    status.active && status.settings.reminders.enabled && reminders.next
      ? t('heatwave.card.nextReminder', { time: clockTime(reminders.next, status.timezone) })
      : undefined;
  return [
    { key: 'indoor', label: t('heatwave.card.indoorLabel'), value: indoorValue },
    {
      key: 'forecast',
      label: forecast.city
        ? t('heatwave.card.forecastLabelCity', { city: forecast.city })
        : t('heatwave.card.forecastLabel'),
      value: forecastValue,
    },
    {
      key: 'reminders',
      label: t('heatwave.card.remindersLabel'),
      value: remindersValue,
      ...(next ? { detail: next } : {}),
    },
  ];
}
