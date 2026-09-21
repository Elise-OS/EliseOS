import { describe, expect, it } from 'vitest';
import { presenceEstimateSchema, type ActivitySummary, type HomeSummary } from '@michel/contracts';
import {
  currentMomentText,
  dayNarrativeText,
  dayText,
  entranceText,
  homeCardText,
  presenceText,
  welcomeAlertTitle,
  latestPresenceText,
  showerDetailText,
  showerStatusText,
} from './WelcomePage';
const data: HomeSummary = {
  from: '2026-09-14T22:00:00.000Z',
  to: '2026-09-15T12:00:00.000Z',
  timezone: 'Europe/Paris',
  residentName: 'Michel',
  rooms: [{ id: 'salon', kind: 'LIVING_ROOM', name: 'Salon' }],
  roomSummaries: [
    { roomId: 'salon', kind: 'LIVING_ROOM', name: 'Salon', color: null, sensors: [] },
  ],
  presence: presenceEstimateSchema.parse({
    roomId: 'salon',
    detectedAt: '2026-09-15T11:00:00.000Z',
    confidence: 'HIGH',
    identifiedResidentId: null,
    source: 'SENSOR',
    plausibleTransition: null,
    trackingState: 'CONFIRMED',
    confirmedRoomId: 'salon',
  }),
  cards: [],
  activityRooms: [],
  alert: null,
  entrance: null,
};
describe('Accueil wording', () => {
  it('shows shower detection state and duration', () => {
    const shower = {
      state: 'IN_PROGRESS' as const,
      currentHumidity: 68,
      baselineHumidity: 45,
      risePercent: 23,
      startedAt: '2026-09-15T10:00:00.000Z',
      endedAt: null,
      durationMinutes: 12,
      updatedAt: '2026-09-15T10:12:00.000Z',
    };
    const humidity = {
      capability: 'humidity',
      value: 68,
      unit: '%',
      state: 'UNKNOWN' as const,
      available: true,
      updatedAt: shower.updatedAt,
    };
    expect(showerStatusText(shower, 'fr')).toBe('Douche en cours');
    expect(
      showerDetailText(shower, humidity, 'fr', 'Europe/Paris', new Date('2026-09-15T10:12:00Z')),
    ).toContain('12 min');
  });

  it('describes the resident location naturally', () => {
    expect(presenceText(data, 'fr')).toBe('Michel est dans le salon.');
  });
  it('uses the latest active motion sensor room', () => {
    expect(
      latestPresenceText(
        {
          ...data,
          latestPresence: {
            roomId: 'salon',
            occurredAt: '2026-09-15T11:00:00.000Z',
            capability: 'motion',
          },
        },
        'fr',
      ),
    ).toBe('Dernière détection dans le salon à 13:00.');
    expect(
      presenceText(
        {
          ...data,
          presence: { ...data.presence, trackingState: 'IN_TRANSIT' },
          latestPresence: {
            roomId: 'salon',
            occurredAt: '2026-09-15T11:00:00.000Z',
            capability: 'motion',
          },
        },
        'fr',
      ),
    ).toBe('Michel est dans le salon.');
  });
  it('distinguishes stale, ambiguous and in-transit presence', () => {
    expect(
      presenceText({ ...data, presence: { ...data.presence, trackingState: 'STALE' } }, 'fr'),
    ).toContain('Michel se trouve probablement dans le salon');
    expect(
      presenceText({ ...data, presence: { ...data.presence, trackingState: 'AMBIGUOUS' } }, 'fr'),
    ).toContain('situer Michel précisément');
    expect(
      presenceText({ ...data, presence: { ...data.presence, trackingState: 'IN_TRANSIT' } }, 'en'),
    ).toContain('Michel appears to be moving');
  });
  it('uses the timestamp from the room named in a stale message', () => {
    const stale = {
      ...data,
      presence: {
        ...data.presence,
        trackingState: 'STALE' as const,
        lastEvidenceAt: '2026-09-15T15:13:00.000Z',
        lastConfirmedAt: '2026-09-15T14:05:00.000Z',
        evidenceSummary: [
          {
            eventId: 'salon-active',
            sensorId: 'salon-sensor',
            roomId: 'salon',
            capability: 'occupancy',
            occurredAt: '2026-09-15T14:05:00.000Z',
            observed: true as const,
          },
          {
            eventId: 'cuisine-active',
            sensorId: 'cuisine-sensor',
            roomId: 'cuisine',
            capability: 'occupancy',
            occurredAt: '2026-09-15T15:13:00.000Z',
            observed: true as const,
          },
        ],
      },
    };
    expect(presenceText(stale, 'fr')).toBe(
      'Michel se trouve probablement dans le salon. La dernière détection date de 16:05.',
    );
  });
  it('adds the observed journey to the current situation', () => {
    expect(
      currentMomentText(
        {
          ...data,
          rooms: [
            { id: 'chambre', kind: 'BEDROOM', name: 'Chambre' },
            { id: 'cuisine', kind: 'OTHER', name: 'Cuisine' },
            ...data.rooms,
          ],
          activityRooms: ['Chambre', 'Cuisine', 'Salon'],
        },
        'fr',
      ),
    ).toBe(
      'Michel est dans le salon. Depuis le début de la journée, son activité a été observée dans la chambre, la cuisine et le salon.',
    );
  });
  it('retains observed history while marking current information unavailable', () => {
    const card: HomeSummary['cards'][number] = {
      id: 'wc',
      label: 'WC',
      kind: 'TOILET',
      available: false,
      observedToday: true,
      countToday: 1,
      lastObservedAt: data.to,
      state: 'UNKNOWN',
      updatedAt: data.to,
    };
    expect(homeCardText(card, 'fr', data.timezone)).toContain('Un passage');
    expect(homeCardText(card, 'fr', data.timezone)).toContain('indisponibles');
    expect(homeCardText(card, 'en', data.timezone)).toContain('unavailable');
    expect(dayText({ ...data, cards: [card] }, 'fr')).toContain('Un passage');
  });
  it('tells the day naturally and leaves toilet activity out of the story', () => {
    const summary: ActivitySummary = {
      period: '24h',
      from: '2026-09-14T22:00:00.000Z',
      to: '2026-09-15T12:00:00.000Z',
      total: 3,
      buckets: [],
      byRoom: [],
      byCapability: [],
      dwellByRoom: [
        {
          id: 'salon',
          name: 'Salon',
          totalSeconds: 12_600,
          averageSeconds: 6_300,
          medianSeconds: 6_300,
          sessions: 2,
          reliableSessions: 2,
          ambiguousSeconds: 0,
          confidenceRate: 1,
        },
      ],
      unknownSeconds: 0,
      reliableBuckets: [],
      observedSeconds: 1_500,
      unobservedSeconds: 0,
      lastReliableActivity: null,
      rooms: [],
      sequences: [
        {
          id: 'morning',
          startedAt: '2026-09-15T06:00:00.000Z',
          endedAt: '2026-09-15T06:25:00.000Z',
          durationSeconds: 1_500,
          roomIds: ['bedroom', 'salon'],
          roomNames: ['Chambre', 'Salon'],
          passages: [],
          totalEventCount: 3,
          hiddenEventCount: 0,
          events: [],
        },
        {
          id: 'lunch',
          startedAt: '2026-09-15T10:30:00.000Z',
          endedAt: '2026-09-15T10:30:00.000Z',
          durationSeconds: 0,
          roomIds: ['kitchen'],
          roomNames: ['Cuisine'],
          passages: [],
          totalEventCount: 1,
          hiddenEventCount: 0,
          events: [],
        },
        {
          id: 'toilet',
          startedAt: '2026-09-15T11:00:00.000Z',
          endedAt: '2026-09-15T13:34:00.000Z',
          durationSeconds: 9_240,
          roomIds: ['toilet'],
          roomNames: ['Toilettes'],
          passages: [],
          totalEventCount: 2,
          hiddenEventCount: 0,
          events: [],
        },
        {
          id: 'afternoon',
          startedAt: '2026-09-15T13:45:00.000Z',
          endedAt: '2026-09-15T16:30:00.000Z',
          durationSeconds: 9_900,
          roomIds: ['salon'],
          roomNames: ['Salon'],
          passages: [],
          totalEventCount: 3,
          hiddenEventCount: 0,
          events: [],
        },
      ],
      hasMoreSequences: false,
    };
    const previousSummary: ActivitySummary = {
      ...summary,
      from: '2026-09-13T22:00:00.000Z',
      to: '2026-09-14T22:00:00.000Z',
      dwellByRoom: [],
      sequences: [
        {
          id: 'bedtime',
          startedAt: '2026-09-14T20:25:00.000Z',
          endedAt: '2026-09-14T20:30:00.000Z',
          durationSeconds: 300,
          roomIds: ['salon', 'bedroom'],
          roomNames: ['Salon', 'Chambre'],
          passages: [],
          totalEventCount: 2,
          hiddenEventCount: 0,
          events: [],
        },
      ],
    };
    const narrative = dayNarrativeText(
      {
        ...data,
        rooms: [
          { id: 'bedroom', kind: 'BEDROOM', name: 'Chambre' },
          { id: 'salon', kind: 'LIVING_ROOM', name: 'Salon' },
          { id: 'kitchen', kind: 'KITCHEN', name: 'Cuisine' },
          { id: 'toilet', kind: 'TOILET', name: 'Toilettes' },
        ],
        cards: [
          {
            id: 'fridge',
            label: 'Réfrigérateur',
            kind: 'FRIDGE',
            available: true,
            observedToday: true,
            countToday: 1,
            lastObservedAt: '2026-09-15T06:35:00.000Z',
            state: 'INACTIVE',
            updatedAt: '2026-09-15T06:35:00.000Z',
          },
          {
            id: 'toilet',
            label: 'Toilettes',
            kind: 'TOILET',
            available: true,
            observedToday: true,
            countToday: 1,
            lastObservedAt: '2026-09-15T13:34:00.000Z',
            state: 'INACTIVE',
            updatedAt: '2026-09-15T13:34:00.000Z',
          },
        ],
      },
      summary,
      'fr',
      previousSummary,
    );
    expect(narrative).toBe(
      'Michel s’est couché hier vers 22 h 30 et s’est réveillé ce matin vers 8 h. Il a passé environ 3 h 30 min dans le salon. Vers 12 h 30, il est allé déjeuner dans la cuisine, puis il est retourné au salon pour l’après-midi.',
    );
    expect(narrative).not.toMatch(/toilettes|détect|observ|capteur/i);
  });
  it('keeps technical sensor names out of the alert copy', () => {
    expect(welcomeAlertTitle('Occupancy ne répond plus', 'fr', 'Toilettes')).toBe(
      'Le capteur de présence des toilettes est indisponible.',
    );
  });
});

describe('entrance wording', () => {
  const entrance: NonNullable<HomeSummary['entrance']> = {
    state: 'EXIT_LIKELY',
    reason: 'NO_MOVEMENT_AFTER_EXIT',
    openedAt: data.to,
    closedAt: data.to,
    evidenceAt: data.to,
    evaluateAfter: data.to,
    windowSeconds: 180,
    roomName: 'Entrée',
  };
  it('shows a probable departure instead of an old indoor location', () => {
    expect(presenceText({ ...data, entrance }, 'fr')).toContain('Sortie probable');
    expect(entranceText(entrance, 'en', data.timezone)).toContain('Likely exit');
  });
  it('explains missing evidence without asserting an absence', () => {
    expect(entranceText({ ...entrance, state: 'UNAVAILABLE' }, 'fr', data.timezone)).toContain(
      'insuffisantes',
    );
    expect(entranceText({ ...entrance, state: 'UNCERTAIN' }, 'fr', data.timezone)).toContain(
      'ne permettent pas',
    );
  });
});
