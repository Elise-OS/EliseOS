import type { NightPath, NightPathOverview } from '@elise/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  canManageNightPaths,
  canTriggerNightPath,
  draftFromPath,
  emptyNightPathDraft,
  nightPathCardText,
  nightPathDraftProblem,
  nightPathPayload,
  nightPathSummary,
  residentFirstName,
  stepBrightness,
  toggleRoom,
} from './night-path-view';

const rooms: NightPathOverview['rooms'] = [
  {
    id: 'bedroom',
    name: 'Chambre',
    kind: 'BEDROOM',
    floorName: 'Rez-de-chaussée',
    presenceSensors: 1,
    bedSensors: 1,
    lights: 1,
  },
  {
    id: 'hall',
    name: 'Couloir',
    kind: 'HALLWAY',
    floorName: null,
    presenceSensors: 0,
    bedSensors: 0,
    lights: 1,
  },
  {
    id: 'toilet',
    name: 'Toilettes',
    kind: 'TOILET',
    floorName: null,
    presenceSensors: 0,
    bedSensors: 0,
    lights: 2,
  },
  {
    id: 'kitchen',
    name: 'Cuisine',
    kind: 'KITCHEN',
    floorName: null,
    presenceSensors: 1,
    bedSensors: 0,
    lights: 0,
  },
];

const path: NightPath = {
  id: 'path-1',
  name: 'Chambre → toilettes',
  enabled: true,
  triggerRoomIds: ['bedroom'],
  includeBedExit: false,
  lightRoomIds: ['bedroom', 'hall', 'toilet'],
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  brightnessPercent: 25,
  colorTemperatureKelvin: 2_200,
  offDelayMinutes: 3,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  activeUntil: null,
};

afterEach(() => setLanguage('fr'));

describe('nightPathSummary', () => {
  it('reads like the web dashboard sentence', () => {
    expect(nightPathSummary(path, rooms, 'Jeanne')).toBe(
      'La nuit, de 22 h à 7 h, quand Jeanne bouge dans la chambre : chambre, couloir et toilettes s’allument doucement.',
    );
  });

  it('mentions getting out of bed only when a trigger room has a bed sensor', () => {
    expect(nightPathSummary({ ...path, includeBedExit: true }, rooms, 'Jeanne')).toContain(
      'quand Jeanne se lève du lit ou bouge dans la chambre',
    );
    expect(
      nightPathSummary(
        { ...path, includeBedExit: true, triggerRoomIds: ['kitchen'] },
        rooms,
        'Jeanne',
      ),
    ).toContain('quand Jeanne bouge dans la cuisine');
  });

  it('uses the singular for one lit room and a neutral word without a first name', () => {
    expect(nightPathSummary({ ...path, lightRoomIds: ['hall'] }, rooms, '')).toBe(
      'La nuit, de 22 h à 7 h, quand la personne bouge dans la chambre : couloir s’allume doucement.',
    );
  });

  it('asks for the missing rooms instead of a broken sentence', () => {
    expect(nightPathSummary({ ...path, triggerRoomIds: [] }, rooms, 'Jeanne')).toBe(
      'Choisissez au moins une pièce de départ et une pièce à éclairer.',
    );
    expect(nightPathSummary({ ...path, lightRoomIds: ['gone'] }, rooms, 'Jeanne')).toBe(
      'Choisissez au moins une pièce de départ et une pièce à éclairer.',
    );
  });

  it('follows the app language', () => {
    setLanguage('en');
    const sentence = nightPathSummary(path, rooms, 'Jeanne');
    expect(sentence).toContain('when Jeanne moves in the chambre');
    expect(sentence).toContain('chambre, couloir');
  });
});

describe('night path drafts', () => {
  it('starts in the bedroom and lights every room with a light', () => {
    const draft = emptyNightPathDraft(rooms, 0);
    expect(draft).toMatchObject({
      name: 'Chemin de nuit',
      triggerRoomIds: ['bedroom'],
      lightRoomIds: ['bedroom', 'hall', 'toilet'],
      startMinute: 22 * 60,
      endMinute: 7 * 60,
      brightnessPercent: 25,
      colorTemperatureKelvin: 2_200,
      offDelayMinutes: 3,
      includeBedExit: true,
      enabled: true,
    });
    expect(emptyNightPathDraft(rooms, 1).name).toBe('Chemin de nuit 2');
  });

  it('falls back to any room with a detector, or none', () => {
    expect(emptyNightPathDraft(rooms.slice(1), 0).triggerRoomIds).toEqual(['kitchen']);
    expect(emptyNightPathDraft(rooms.slice(1, 3), 0).triggerRoomIds).toEqual([]);
  });

  it('explains what is missing before saving', () => {
    const draft = draftFromPath(path);
    expect(nightPathDraftProblem(draft)).toBeNull();
    expect(nightPathDraftProblem({ ...draft, name: '  ' })).toBe('Donnez un nom à ce chemin.');
    expect(nightPathDraftProblem({ ...draft, triggerRoomIds: [] })).toBe(
      'Choisissez au moins une pièce où démarrer.',
    );
    expect(nightPathDraftProblem({ ...draft, lightRoomIds: [] })).toBe(
      'Choisissez au moins une pièce à éclairer.',
    );
    expect(nightPathDraftProblem({ ...draft, endMinute: draft.startMinute })).toBe(
      'Le début et la fin de la nuit doivent être différents.',
    );
  });

  it('edits a copy of the path and sends a trimmed name', () => {
    const draft = draftFromPath(path);
    draft.lightRoomIds.push('kitchen');
    expect(path.lightRoomIds).toEqual(['bedroom', 'hall', 'toilet']);
    expect(nightPathPayload({ ...draft, name: '  Nuit  ' }).name).toBe('Nuit');
    expect(nightPathPayload(draft)).not.toHaveProperty('id');
  });

  it('toggles rooms and steps brightness by 5 % between 5 and 100', () => {
    expect(toggleRoom(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleRoom(['b'], 'a')).toEqual(['b', 'a']);
    expect(stepBrightness(25, 1)).toBe(30);
    expect(stepBrightness(25, -1)).toBe(20);
    expect(stepBrightness(5, -1)).toBe(5);
    expect(stepBrightness(100, 1)).toBe(100);
    expect(stepBrightness(1, 1)).toBe(5);
  });

  it('only lets rooms with a detector start a path', () => {
    expect(canTriggerNightPath(rooms[0])).toBe(true);
    expect(canTriggerNightPath(rooms[1])).toBe(false);
  });
});

describe('night path access and card', () => {
  it('lets only the owner and administrators change paths', () => {
    expect(canManageNightPaths('OWNER')).toBe(true);
    expect(canManageNightPaths('ADMINISTRATOR')).toBe(true);
    expect(canManageNightPaths('CAREGIVER')).toBe(false);
    expect(canManageNightPaths('VIEWER')).toBe(false);
    expect(canManageNightPaths(undefined)).toBe(false);
  });

  it('speaks of the resident by first name', () => {
    expect(residentFirstName(' Jeanne  Martin ')).toBe('Jeanne');
    expect(residentFirstName(null)).toBe('');
  });

  it('summarises the paths on the card', () => {
    const overview = { timezone: 'Europe/Paris', rooms, paths: [path] };
    expect(nightPathCardText(overview, 'Jeanne')).toBe('1 chemin configuré, 1 en service');
    expect(
      nightPathCardText(
        { ...overview, paths: [path, { ...path, id: 'p2', enabled: false }] },
        'Jeanne',
      ),
    ).toBe('2 chemins configurés, 1 en service');
    expect(nightPathCardText(undefined, 'Jeanne')).toBe(
      'Une lumière douce s’allume sur le trajet quand Jeanne se lève la nuit.',
    );
  });
});
