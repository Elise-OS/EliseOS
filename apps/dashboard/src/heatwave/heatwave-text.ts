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

export type HeatwaveHowKey = 'on' | 'off' | 'tv' | 'family' | 'registry' | 'medical';

/**
 * How the mode works, in plain words and with the saved settings: when it starts and stops,
 * what the TV shows, what the family receives, the town hall register and its limits.
 */
export function heatwaveHowItWorks(
  status: Pick<HeatwaveStatus, 'settings' | 'forecast'>,
): Array<{ key: HeatwaveHowKey; title: string; text: string }> {
  const { settings, forecast } = status;
  const { indoorTrigger, forecastTrigger, reminders, tips, alert } = settings;
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
  const off =
    indoorTrigger.enabled && forecastTrigger.enabled
      ? t('heatwave.how.off', { celsius: cool, forecast: forecastLimit })
      : indoorTrigger.enabled
        ? t('heatwave.how.offIndoor', { celsius: cool })
        : forecastTrigger.enabled
          ? t('heatwave.how.offForecast', { forecast: forecastLimit })
          : t('heatwave.how.offManual');
  const tv = [
    t('heatwave.how.tvBanner'),
    tips.enabled ? t('heatwave.how.tvTips') : null,
    reminders.enabled
      ? t('heatwave.how.tvReminders', {
          count: reminders.everyHours,
          start: reminders.startHour,
          end: reminders.endHour,
        })
      : t('heatwave.how.tvNoReminders'),
    t('heatwave.how.tvNothing'),
  ].filter((part): part is string => part !== null);
  return [
    {
      key: 'on',
      title: t('heatwave.how.onTitle'),
      text: triggers.length
        ? t('heatwave.how.on', { triggers: triggers.join(t('heatwave.summary.or')) })
        : t('heatwave.how.onManualOnly'),
    },
    { key: 'off', title: t('heatwave.how.offTitle'), text: off },
    { key: 'tv', title: t('heatwave.how.tvTitle'), text: tv.join(' ') },
    {
      key: 'family',
      title: t('heatwave.how.familyTitle'),
      text: alert.enabled
        ? t('heatwave.how.family', {
            celsius: celsius(alert.celsius),
            duration: duration(alert.minutes),
          })
        : t('heatwave.how.familyNoAlert'),
    },
    { key: 'registry', title: t('heatwave.how.registryTitle'), text: t('heatwave.how.registry') },
    { key: 'medical', title: t('heatwave.how.medicalTitle'), text: t('heatwave.notMedical') },
  ];
}
