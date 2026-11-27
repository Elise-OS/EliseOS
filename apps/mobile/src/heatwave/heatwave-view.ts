import {
  HEATWAVE_COOL_MARGIN,
  HEATWAVE_COOL_MINUTES,
  heatwaveForecastLevel,
  heatwaveGauge,
  heatwaveIndoorLevel,
  heatwaveReminderTimeline,
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

export type HeatwaveStepKey = 'detect' | 'tv' | 'family' | 'stop';

/**
 * « Comment ça marche » in four steps, each in one sentence written from the saved settings:
 * Élise detects the heat, the TV reminds to drink, the family is told, everything stops alone.
 */
export function heatwaveSteps(
  status: Pick<HeatwaveStatus, 'settings' | 'forecast'>,
): Array<{ key: HeatwaveStepKey; title: string; text: string }> {
  const { settings, forecast } = status;
  const { indoorTrigger, forecastTrigger, reminders, alert } = settings;
  const triggers = [
    indoorTrigger.enabled
      ? t('heatwave.how.onIndoor', {
          celsius: celsius(indoorTrigger.celsius),
          duration: duration(indoorTrigger.minutes),
        })
      : null,
    forecastTrigger.enabled
      ? forecast.city
        ? t('heatwave.how.onForecastCity', {
            celsius: celsius(forecastTrigger.celsius),
            city: forecast.city,
          })
        : t('heatwave.how.onForecast', { celsius: celsius(forecastTrigger.celsius) })
      : null,
  ].filter((part): part is string => part !== null);
  const cool = celsius(indoorTrigger.celsius - HEATWAVE_COOL_MARGIN);
  const forecastLimit = celsius(forecastTrigger.celsius);
  return [
    {
      key: 'detect',
      title: t('heatwave.how.stepDetect'),
      text: triggers.length
        ? t('heatwave.how.onShort', { triggers: triggers.join(t('heatwave.summary.or')) })
        : t('heatwave.how.onManualOnly'),
    },
    {
      key: 'tv',
      title: t('heatwave.how.stepTv'),
      text: reminders.enabled
        ? t('heatwave.how.tvShort', {
            count: reminders.everyHours,
            start: reminders.startHour,
            end: reminders.endHour,
          })
        : t('heatwave.how.tvShortNoReminders'),
    },
    {
      key: 'family',
      title: t('heatwave.how.stepFamily'),
      text: alert.enabled
        ? t('heatwave.how.family', {
            celsius: celsius(alert.celsius),
            duration: duration(alert.minutes),
          })
        : t('heatwave.how.familyNoAlert'),
    },
    {
      key: 'stop',
      title: t('heatwave.how.stepStop'),
      text:
        indoorTrigger.enabled && forecastTrigger.enabled
          ? t('heatwave.how.off', { celsius: cool, forecast: forecastLimit })
          : indoorTrigger.enabled
            ? t('heatwave.how.offIndoor', { celsius: cool })
            : forecastTrigger.enabled
              ? t('heatwave.how.offForecast', { forecast: forecastLimit })
              : t('heatwave.how.offManual'),
    },
  ];
}

/** Why the mode is in its state, in one short line under the title of the card. */
export function heatwaveReason(status: HeatwaveStatus): string {
  const { forecast, indoor, settings } = status;
  if (status.active && status.source === 'MANUAL') return t('heatwave.reason.manual');
  if (status.active && status.source === 'FORECAST') {
    // Today's heat when it is the one announced, otherwise tomorrow's.
    const today =
      forecast.todayMax !== null && forecast.todayMax >= settings.forecastTrigger.celsius;
    const value = today ? forecast.todayMax : forecast.tomorrowMax;
    if (value !== null) {
      const city = forecast.city;
      if (today)
        return city
          ? t('heatwave.reason.forecastCity', { city, value: celsius(value) })
          : t('heatwave.reason.forecast', { value: celsius(value) });
      return city
        ? t('heatwave.reason.forecastTomorrowCity', { city, value: celsius(value) })
        : t('heatwave.reason.forecastTomorrow', { value: celsius(value) });
    }
  }
  const indoorValue = indoor.current ?? indoor.maxToday;
  if (status.active && indoorValue !== null)
    return indoor.maxTodayRoom
      ? t('heatwave.reason.indoorRoom', { value: celsius(indoorValue), room: indoor.maxTodayRoom })
      : t('heatwave.reason.indoor', { value: celsius(indoorValue) });
  if (status.active) return heatwaveStateText(status);
  if (status.manual === 'OFF') return t('heatwave.reason.paused');
  if (!settings.indoorTrigger.enabled && !settings.forecastTrigger.enabled)
    return t('heatwave.reason.manualOnly');
  return forecast.city
    ? t('heatwave.reason.watchingCity', { city: forecast.city })
    : t('heatwave.reason.watching');
}

/** Figures of the « Aujourd'hui » tiles, with their heat level and the indoor gauge. */
export function heatwaveToday(status: HeatwaveStatus, now = new Date()) {
  const { settings, indoor, forecast, reminders } = status;
  const forecastValue = forecast.available && forecast.todayMax !== null ? forecast.todayMax : null;
  const forecastLevelOf = Math.max(
    forecast.todayMax ?? -Infinity,
    forecast.tomorrowMax ?? -Infinity,
  );
  return {
    indoor: {
      value: indoor.maxToday,
      level: indoor.maxToday === null ? null : heatwaveIndoorLevel(settings, indoor.maxToday),
      gauge: indoor.maxToday === null ? null : heatwaveGauge(settings, indoor.maxToday),
      caption:
        indoor.sensors === 0
          ? t('heatwave.card.indoorNoSensor')
          : indoor.maxToday === null
            ? t('heatwave.card.indoorNoData')
            : indoor.maxTodayRoom
              ? t('heatwave.today.maxOfDayRoom', { room: indoor.maxTodayRoom })
              : t('heatwave.today.maxOfDay'),
    },
    forecast: {
      title: forecast.city
        ? t('heatwave.today.forecastTitleCity', { city: forecast.city })
        : t('heatwave.today.forecastTitle'),
      value: forecastValue,
      level: Number.isFinite(forecastLevelOf)
        ? heatwaveForecastLevel(settings, forecastLevelOf)
        : null,
      caption: !forecast.available
        ? t('heatwave.card.forecastUnavailable')
        : forecast.tomorrowMax !== null
          ? t('heatwave.today.tomorrow', { value: celsius(forecast.tomorrowMax) })
          : t('heatwave.today.today'),
    },
    reminders: {
      enabled: settings.reminders.enabled,
      shown: reminders.shown,
      /** Shown as a large figure next to the caption, when at least one reminder was shown. */
      figure: settings.reminders.enabled && reminders.shown > 0 ? reminders.shown : null,
      caption: !settings.reminders.enabled
        ? t('heatwave.card.remindersOff')
        : reminders.shown > 0
          ? t('heatwave.today.shownCaption', { count: reminders.shown })
          : t('heatwave.card.remindersNone'),
      next:
        status.active && settings.reminders.enabled && reminders.next
          ? t('heatwave.card.nextReminder', { time: clockTime(reminders.next, status.timezone) })
          : null,
      timeline: heatwaveReminderTimeline({
        settings,
        shown: reminders.shown,
        next: reminders.next,
        active: status.active,
        now,
        timeZone: status.timezone,
      }),
    },
  };
}

/** The large title of the state banner: « Le mode canicule est activé ». */
export const heatwaveStateTitle = (status: HeatwaveStatus): string =>
  ({
    active: t('heatwave.panel.stateOn'),
    paused: t('heatwave.panel.statePaused'),
    idle: t('heatwave.panel.stateOff'),
  })[heatwaveTone(status)];

/** « Activé aujourd’hui à 10:12 » or « Activé depuis le 14 juillet », only while it is on. */
export function heatwaveSince(status: HeatwaveStatus, now = new Date()): string | null {
  if (!status.active || !status.activatedAt) return null;
  const since = new Date(status.activatedAt);
  const day = (date: Date) =>
    date.toLocaleDateString('en-CA', { timeZone: status.timezone, dateStyle: 'short' });
  if (day(since) === day(now))
    return t('heatwave.panel.sinceToday', { time: clockTime(status.activatedAt, status.timezone) });
  return t('heatwave.panel.sinceDate', {
    date: since.toLocaleDateString(dateLocale(), {
      day: 'numeric',
      month: 'long',
      timeZone: status.timezone,
    }),
  });
}

export type HeatwaveChipKey =
  'banner' | 'reminders' | 'tips' | 'family' | 'indoor' | 'forecast' | 'manual' | 'rearm';

/** What Élise does right now (when on) or watches for (when standing by), as short chips. */
export function heatwaveChips(
  status: HeatwaveStatus,
): Array<{ key: HeatwaveChipKey; text: string }> {
  const { settings } = status;
  const chips: Array<{ key: HeatwaveChipKey; text: string } | null> = status.active
    ? [
        { key: 'banner', text: t('heatwave.panel.chipBanner') },
        settings.reminders.enabled
          ? {
              key: 'reminders',
              text: t('heatwave.panel.chipReminders', { count: settings.reminders.everyHours }),
            }
          : null,
        settings.tips.enabled ? { key: 'tips', text: t('heatwave.panel.chipTips') } : null,
        settings.alert.enabled
          ? {
              key: 'family',
              text: t('heatwave.panel.chipFamily', { celsius: celsius(settings.alert.celsius) }),
            }
          : null,
      ]
    : status.manual === 'OFF'
      ? [
          {
            key: 'rearm',
            text: t('heatwave.panel.chipRearm', {
              celsius: celsius(settings.indoorTrigger.celsius - HEATWAVE_COOL_MARGIN),
            }),
          },
        ]
      : [
          settings.indoorTrigger.enabled
            ? {
                key: 'indoor',
                text: t('heatwave.panel.chipWatchIndoor', {
                  celsius: celsius(settings.indoorTrigger.celsius),
                }),
              }
            : null,
          settings.forecastTrigger.enabled
            ? {
                key: 'forecast',
                text: t('heatwave.panel.chipWatchForecast', {
                  celsius: celsius(settings.forecastTrigger.celsius),
                }),
              }
            : null,
          !settings.indoorTrigger.enabled && !settings.forecastTrigger.enabled
            ? { key: 'manual', text: t('heatwave.panel.chipManualOnly') }
            : null,
        ];
  return chips.filter((chip): chip is { key: HeatwaveChipKey; text: string } => chip !== null);
}

export type HeatwaveThresholdKey = 'indoor' | 'forecast' | 'stop' | 'reminders' | 'tips' | 'alert';

/** The saved settings as short label / value rows, for the « Vos réglages » block. */
export function heatwaveThresholds(
  settings: HeatwaveSettings,
): Array<{ key: HeatwaveThresholdKey; label: string; value: string; off: boolean }> {
  const { indoorTrigger, forecastTrigger, reminders, tips, alert } = settings;
  const cool = celsius(indoorTrigger.celsius - HEATWAVE_COOL_MARGIN);
  const forecast = celsius(forecastTrigger.celsius);
  const coolFor = duration(HEATWAVE_COOL_MINUTES);
  return [
    {
      key: 'indoor',
      label: t('heatwave.settings.indoorTitle'),
      off: !indoorTrigger.enabled,
      value: indoorTrigger.enabled
        ? t('heatwave.panel.valueIndoor', {
            celsius: celsius(indoorTrigger.celsius),
            duration: duration(indoorTrigger.minutes),
          })
        : t('heatwave.panel.noTrigger'),
    },
    {
      key: 'forecast',
      label: t('heatwave.settings.forecastTitle'),
      off: !forecastTrigger.enabled,
      value: forecastTrigger.enabled
        ? t('heatwave.panel.valueForecast', { celsius: forecast })
        : t('heatwave.panel.noTrigger'),
    },
    {
      key: 'stop',
      label: t('heatwave.panel.stopTitle'),
      off: false,
      value:
        indoorTrigger.enabled && forecastTrigger.enabled
          ? t('heatwave.panel.valueStopBoth', { celsius: cool, duration: coolFor, forecast })
          : indoorTrigger.enabled
            ? t('heatwave.panel.valueStop', { celsius: cool, duration: coolFor })
            : forecastTrigger.enabled
              ? t('heatwave.panel.valueStopForecast', { forecast })
              : t('heatwave.panel.valueStopManual'),
    },
    {
      key: 'reminders',
      label: t('heatwave.settings.remindersTitle'),
      off: !reminders.enabled,
      value: reminders.enabled
        ? t('heatwave.panel.valueReminders', {
            every: t('heatwave.settings.everyHours', { count: reminders.everyHours }),
            start: reminders.startHour,
            end: reminders.endHour,
          })
        : t('heatwave.panel.noReminders'),
    },
    {
      key: 'tips',
      label: t('heatwave.settings.tipsTitle'),
      off: !tips.enabled,
      value: tips.enabled ? t('heatwave.panel.valueTips') : t('heatwave.panel.noTips'),
    },
    {
      key: 'alert',
      label: t('heatwave.settings.alertTitle'),
      off: !alert.enabled,
      value: alert.enabled
        ? t('heatwave.panel.valueAlert', {
            celsius: celsius(alert.celsius),
            duration: duration(alert.minutes),
          })
        : t('heatwave.panel.noAlert'),
    },
  ];
}
