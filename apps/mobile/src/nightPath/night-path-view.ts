import {
  DEFAULT_NIGHT_PATH,
  nightPathRoomPhrase,
  type MembershipRole,
  type NightPath,
  type NightPathInput,
  type NightPathOverview,
  type NightPathRoom,
} from '@elise/contracts';
import { currentLanguage, dateLocale, t } from '../i18n';

/** Colour temperatures offered in the editor, warmest first (same as the web dashboard). */
export const NIGHT_PATH_TEMPERATURES = [2_200, 2_700, 3_000] as const;
export const NIGHT_PATH_MIN_BRIGHTNESS = 5;
export const NIGHT_PATH_MAX_BRIGHTNESS = 100;
export const NIGHT_PATH_BRIGHTNESS_STEP = 5;

export type NightPathDraft = NightPathInput;

/** Only the owner and the administrators of the home change night paths; everyone reads them. */
export const canManageNightPaths = (role: MembershipRole | null | undefined) =>
  role === 'OWNER' || role === 'ADMINISTRATOR';

/** « Jeanne Martin » → « Jeanne »: the sentences speak of the resident by first name. */
export const residentFirstName = (name: string | null | undefined) =>
  name?.trim().split(/\s+/)[0] ?? '';

/** "Chambre" → "chambre", so that room names read naturally inside a sentence. */
function inSentence(name: string) {
  return name ? `${name.charAt(0).toLocaleLowerCase(dateLocale())}${name.slice(1)}` : name;
}

/** « chambre, couloir et toilettes », in the app language. */
export function nightPathList(names: string[]) {
  try {
    return new Intl.ListFormat(dateLocale(), { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    // Some phone engines have no Intl.ListFormat: same sentence, built by hand.
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')} ${t('nightPath.and')} ${names[names.length - 1]}`;
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

/** True when a trigger room of the path has a bed sensor, so « gets up from bed » applies. */
export function nightPathBedAvailable(
  triggerRoomIds: string[],
  rooms: Pick<NightPathRoom, 'id' | 'bedSensors'>[],
) {
  return rooms.some(({ id, bedSensors }) => bedSensors > 0 && triggerRoomIds.includes(id));
}

/**
 * « La nuit, de 22 h à 7 h, quand Jeanne bouge dans la chambre : chambre, couloir et
 * toilettes s’allument doucement. » — the same sentence as on the web dashboard. Trigger rooms
 * carry their article (« la chambre », "the bedroom", « no quarto »); lit rooms stay bare.
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
    nightPathRoomPhrase(currentLanguage(), kind, name),
  );
  const lights = known(path.lightRoomIds).map(({ name }) => inSentence(name));
  if (!triggers.length || !lights.length) return t('nightPath.summaryIncomplete');
  const bed = path.includeBedExit && nightPathBedAvailable(path.triggerRoomIds, rooms);
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

/** Line of the « Chemin lumineux » card of the home tab. */
export function nightPathCardText(overview: NightPathOverview | undefined, resident: string) {
  if (overview?.paths.length)
    return t('nightPath.cardCount', {
      count: overview.paths.length,
      enabled: overview.paths.filter(({ enabled }) => enabled).length,
    });
  return t('nightPath.cardEmpty', { resident: resident || t('nightPath.theResident') });
}

/** Rooms that can start a path: a motion, presence or bed sensor is needed. */
export const canTriggerNightPath = (room: Pick<NightPathRoom, 'presenceSensors' | 'bedSensors'>) =>
  room.presenceSensors > 0 || room.bedSensors > 0;

/** A new path: the bedroom (or the first room with a detector) lights every room with a light. */
export function emptyNightPathDraft(rooms: NightPathRoom[], existing: number): NightPathDraft {
  const bedroom = rooms.find((room) => room.kind === 'BEDROOM' && room.presenceSensors > 0);
  const trigger = bedroom ?? rooms.find(canTriggerNightPath);
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
    triggerRoomIds: [...path.triggerRoomIds],
    lightRoomIds: [...path.lightRoomIds],
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

/** The draft as the API takes it (same body as the web dashboard sends). */
export function nightPathPayload(draft: NightPathDraft): NightPathInput {
  return { ...draft, name: draft.name.trim() };
}

/** Adds or removes a room of a list, keeping the others in place. */
export const toggleRoom = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];

/** −/+ by 5 %, never below 5 % nor above 100 %. */
export function stepBrightness(value: number, direction: -1 | 1) {
  const next =
    Math.round(value / NIGHT_PATH_BRIGHTNESS_STEP) * NIGHT_PATH_BRIGHTNESS_STEP +
    direction * NIGHT_PATH_BRIGHTNESS_STEP;
  return Math.min(NIGHT_PATH_MAX_BRIGHTNESS, Math.max(NIGHT_PATH_MIN_BRIGHTNESS, next));
}
