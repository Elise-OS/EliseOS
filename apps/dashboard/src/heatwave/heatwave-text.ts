import { HEATWAVE_COOL_MARGIN, type HeatwaveSettings, type HeatwaveStatus } from '@elise/contracts';
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
