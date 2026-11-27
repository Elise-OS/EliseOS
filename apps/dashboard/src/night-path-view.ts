import {
  DEFAULT_NIGHT_PATH,
  nightPathRoomPhrase,
  type NightPath,
  type NightPathInput,
  type NightPathRoom,
} from '@elise/contracts';
import { dateLocale, t } from './i18n';

/** Colour temperatures offered in the editor, warmest first. */
export const NIGHT_PATH_TEMPERATURES = [2_200, 2_700, 3_000] as const;

export type NightPathDraft = Omit<NightPathInput, 'offDelayMinutes'> & {
  offDelayMinutes: NightPathInput['offDelayMinutes'];
};

/** "Chambre" → "chambre", so that room names read naturally inside a sentence. */
function inSentence(name: string) {
  return name ? `${name.charAt(0).toLocaleLowerCase(dateLocale())}${name.slice(1)}` : name;
}

export function nightPathList(names: string[]) {
  try {
    return new Intl.ListFormat(dateLocale(), { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** 22:00 → « 22 h » in French, « 10:00 PM » in English… */
export function nightPathTimeLabel(minute: number) {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  if (dateLocale().startsWith('fr'))
    return minutes ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${hours} h`;
  const date = new Date(Date.UTC(2026, 0, 1, hours, minutes));
  return new Intl.DateTimeFormat(dateLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * « La nuit, de 22 h à 7 h, quand Jeanne bouge dans la chambre : chambre, couloir et
 * toilettes s’allument doucement. »
 */
export function nightPathSummary(
  path: Pick<
    NightPath,
    'triggerRoomIds' | 'lightRoomIds' | 'startMinute' | 'endMinute' | 'includeBedExit'
  >,
  rooms: Pick<NightPathRoom, 'id' | 'name' | 'kind' | 'bedSensors'>[],
  resident: string,
) {
  const known = (ids: string[]) =>
    ids.flatMap((id) => {
      const room = rooms.find((item) => item.id === id);
      return room ? [room] : [];
    });
  const triggers = known(path.triggerRoomIds).map(({ kind, name }) =>
    nightPathRoomPhrase(dateLocale(), kind, name),
  );
  const names = (ids: string[]) => known(ids).map(({ name }) => inSentence(name));
  const lights = names(path.lightRoomIds);
  if (!triggers.length || !lights.length) return t('nightPath.summaryIncomplete');
  const bed =
    path.includeBedExit &&
    rooms.some(({ id, bedSensors }) => bedSensors > 0 && path.triggerRoomIds.includes(id));
  const who = resident || t('nightPath.theResident');
  return t('nightPath.summary', {
    count: lights.length,
    start: nightPathTimeLabel(path.startMinute),
    end: nightPathTimeLabel(path.endMinute),
    when: bed
      ? t('nightPath.whenMovesOrGetsUp', { resident: who, rooms: nightPathList(triggers) })
      : t('nightPath.whenMoves', { resident: who, rooms: nightPathList(triggers) }),
    lights: nightPathList(lights),
  });
}

export function emptyNightPathDraft(rooms: NightPathRoom[], existing: number): NightPathDraft {
  const bedroom = rooms.find(({ kind, presenceSensors }) => kind === 'BEDROOM' && presenceSensors);
  const trigger = bedroom ?? rooms.find(({ presenceSensors }) => presenceSensors > 0);
  return {
    name: existing
      ? t('nightPath.defaultNameNumbered', { number: existing + 1 })
      : t('nightPath.defaultName'),
    enabled: DEFAULT_NIGHT_PATH.enabled,
    includeBedExit: DEFAULT_NIGHT_PATH.includeBedExit,
    triggerRoomIds: trigger ? [trigger.id] : [],
    lightRoomIds: rooms.filter(({ lights }) => lights > 0).map(({ id }) => id),
    startMinute: DEFAULT_NIGHT_PATH.startMinute,
    endMinute: DEFAULT_NIGHT_PATH.endMinute,
    brightnessPercent: DEFAULT_NIGHT_PATH.brightnessPercent,
    colorTemperatureKelvin: DEFAULT_NIGHT_PATH.colorTemperatureKelvin,
    offDelayMinutes: DEFAULT_NIGHT_PATH.offDelayMinutes,
  };
}

export function draftFromPath(path: NightPath): NightPathDraft {
  return {
    name: path.name,
    enabled: path.enabled,
    includeBedExit: path.includeBedExit,
    triggerRoomIds: path.triggerRoomIds,
    lightRoomIds: path.lightRoomIds,
    startMinute: path.startMinute,
    endMinute: path.endMinute,
    brightnessPercent: path.brightnessPercent,
    colorTemperatureKelvin: path.colorTemperatureKelvin,
    offDelayMinutes: path.offDelayMinutes,
  };
}

/** What is missing before the path can be saved, as a human sentence (null when ready). */
export function nightPathDraftProblem(draft: NightPathDraft) {
  if (!draft.name.trim()) return t('nightPath.problems.name');
  if (!draft.triggerRoomIds.length) return t('nightPath.problems.trigger');
  if (!draft.lightRoomIds.length) return t('nightPath.problems.lights');
  if (draft.startMinute === draft.endMinute) return t('nightPath.problems.window');
  return null;
}
