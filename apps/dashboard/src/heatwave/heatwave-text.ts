import {
  HEATWAVE_COOL_MARGIN,
  heatwaveForecastLevel,
  heatwaveGauge,
  heatwaveIndoorLevel,
  heatwaveReminderTimeline,
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

/** The settings told as a few human sentences, shown at the bottom of the settings window. */
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
