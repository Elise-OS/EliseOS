import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  initialScreenState,
  type ActivitySummary,
  type AlertRuleSettings,
  type CalendarPage,
  type HomePlan,
  type HomeSummary,
  type LiaisonPage,
  type ScreenSnapshot,
  type SensorDevice,
  type SensorOnboardingSession,
} from '@elise/contracts';
import type {
  ActivityItem,
  AlertDetail,
  AlertItem,
  CameraItem,
  CurrentUser,
  JournalItem,
  Overview,
  SimulationScenario,
  TrustedPerson,
} from '../api';
import type { SavedServer } from '../discovery/types';
import { appLocale } from '../locale';
import { t } from '../i18n';

// The demo home follows the app language; it is rebuilt when the language changes.

export const DEMO_SERVER_ID = 'elise-demo';
export const DEMO_TOKEN = 'elise-demo-session';

export const isDemoServer = (server: SavedServer) => server.id === DEMO_SERVER_ID;

export function createDemoServer(): SavedServer {
  const now = new Date().toISOString();
  return {
    id: DEMO_SERVER_ID,
    instanceId: DEMO_SERVER_ID,
    instanceName: t('mockApi.eliseOsMartinHome'),
    version: '0.1.6-demo',
    apiVersion: 1,
    serverTime: now,
    supportsMobile: true,
    setupRequired: false,
    localUrl: null,
    remoteUrl: null,
    url: 'https://demo.eliseos.local',
    urls: ['https://demo.eliseos.local'],
    source: 'manual',
    lastConnectedAt: now,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
// Offsets to local clock times keep demo events at plausible hours whenever the demo is opened.
const untilClock = (days: number, hours: number, minutes = 0) => {
  const target = new Date();
  target.setDate(target.getDate() + days);
  target.setHours(hours, minutes, 0, 0);
  return target.getTime() - Date.now();
};
const untilNextClock = (hours: number, minutes = 0) => {
  const today = untilClock(0, hours, minutes);
  return today > 0 ? today : untilClock(1, hours, minutes);
};
// Evaluated when the demo state is built, so displayed times stay on the exact minute.
const careVisitStart = () => untilNextClock(11, 30);
const careVisitEnd = () => careVisitStart() + 1.5 * HOUR;
const doctorStart = () => untilClock(1, 10);
const doctorEnd = () => untilClock(1, 11);
const lastWakeUp = () => {
  const today = untilClock(0, 7, 40);
  return today < 0 ? today : untilClock(-1, 7, 40);
};
const lastBedtime = () => lastWakeUp() - 9 * HOUR - 25 * 60_000;

const DEMO_RADIOS = [
  {
    id: 'france-inter',
    name: 'France Inter',
    url: 'https://demo.invalid/radio/france-inter.mp3',
    country: 'France',
    codec: 'MP3',
    bitrate: 128,
  },
  {
    id: 'franceinfo',
    name: 'franceinfo',
    url: 'https://demo.invalid/radio/franceinfo.mp3',
    country: 'France',
    codec: 'MP3',
    bitrate: 128,
  },
  {
    id: 'france-culture',
    name: 'France Culture',
    url: 'https://demo.invalid/radio/france-culture.mp3',
    country: 'France',
    codec: 'MP3',
    bitrate: 128,
  },
  {
    id: 'france-musique',
    name: 'France Musique',
    url: 'https://demo.invalid/radio/france-musique.mp3',
    country: 'France',
    codec: 'MP3',
    bitrate: 128,
  },
  {
    id: 'fip',
    name: 'FIP',
    url: 'https://demo.invalid/radio/fip.mp3',
    country: 'France',
    codec: 'MP3',
    bitrate: 128,
  },
];

// Built on demand: the demo texts follow the language chosen when the demo starts.
const DEMO_PODCASTS = () => [
  {
    id: '100001',
    title: 'Affaires sensibles',
    author: 'France Inter',
    episodeCount: 650,
    genre: 'Histoire',
    feedUrl: 'https://demo.invalid/podcasts/affaires-sensibles.xml',
  },
  {
    id: '100002',
    title: t('mockApi.lesPiedsSurTerre'),
    author: 'France Culture',
    episodeCount: 4700,
    genre: t('mockApi.society'),
    feedUrl: 'https://demo.invalid/podcasts/les-pieds-sur-terre.xml',
  },
];

const DEMO_PODCAST_EPISODES = () => ({
  '100001': [
    {
      id: 'demo-affaires-giscard-chirac',
      title: 'Giscard / Chirac — La guerre des chefs',
      description: 'Un épisode consacré aux rivalités politiques de la droite française.',
      enclosureUrl: 'https://demo.invalid/podcasts/affaires-giscard-chirac.mp3',
      durationSeconds: 54 * 60,
      publishedAt: Date.parse('2023-07-06T13:00:00Z'),
    },
    {
      id: 'demo-affaires-mitterrand',
      title: t('mockApi.francoisMitterrandAndTheObservatory'),
      description: t('mockApi.theStoryOfTheObservatory'),
      enclosureUrl: 'https://demo.invalid/podcasts/affaires-mitterrand.mp3',
      durationSeconds: 54 * 60,
      publishedAt: Date.parse('2021-07-06T13:00:00Z'),
    },
  ],
  '100002': [
    {
      id: 'demo-pieds-profession-pecheur',
      title: 'Profession pêcheur',
      description: 'Trois récits de pêcheurs face aux surprises de la mer.',
      enclosureUrl: 'https://demo.invalid/podcasts/pieds-profession-pecheur.mp3',
      durationSeconds: 28 * 60,
      publishedAt: Date.parse('2021-08-16T13:00:00Z'),
    },
    {
      id: 'demo-pieds-oublier-pour-survivre',
      title: t('mockApi.forgettingToSurvive'),
      description: t('mockApi.twoStoriesAboutMemoryAfter'),
      enclosureUrl: 'https://demo.invalid/podcasts/pieds-oublier.mp3',
      durationSeconds: 28 * 60,
      publishedAt: Date.parse('2021-06-17T13:00:00Z'),
    },
  ],
});

const dateInParis = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * DAY);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const ROOM_IDS = {
  entry: 'room-entry',
  living: 'room-living',
  kitchen: 'room-kitchen',
  bedroom: 'room-bedroom',
  bathroom: 'room-bathroom',
};

type DemoSession = ReturnType<typeof createDemoSession>;

function createDemoSession() {
  const homeSummary: HomeSummary = {
    from: iso(-DAY),
    to: iso(),
    timezone: 'Europe/Paris',
    residentName: 'Jeanne Martin',
    presence: {
      sessionId: 'demo-presence-session',
      state: 'OPEN',
      since: iso(-92 * MINUTE),
      lastConfirmedAt: iso(-18 * MINUTE),
      durationSeconds: 92 * 60,
      roomId: ROOM_IDS.living,
      detectedAt: iso(-18 * MINUTE),
      confidence: 'HIGH',
      identifiedResidentId: 'resident-jeanne',
      source: 'SENSOR',
      plausibleTransition: true,
      ambiguousReason: null,
      trackingState: 'CONFIRMED',
      confirmedRoomId: ROOM_IDS.living,
      candidateRoomId: ROOM_IDS.living,
      pathRoomIds: [ROOM_IDS.entry, ROOM_IDS.living],
      confidenceScore: 0.94,
      reasonCodes: ['RECENT_MOTION', 'CONNECTED_ROOMS'],
      explanation: t('mockApi.recentMovementWasNoticedIn'),
      lastEvidenceAt: iso(-18 * MINUTE),
      evidenceSummary: [
        {
          eventId: 'event-living-1',
          sensorId: 'sensor-living-motion',
          roomId: ROOM_IDS.living,
          capability: 'motion',
          occurredAt: iso(-18 * MINUTE),
          observed: true,
        },
      ],
      trackingDegraded: false,
    },
    rooms: [
      { id: ROOM_IDS.entry, name: t('mockApi.entrance'), kind: 'ENTRANCE' },
      { id: ROOM_IDS.living, name: t('mockApi.livingRoom'), kind: 'LIVING_ROOM' },
      { id: ROOM_IDS.kitchen, name: t('mockApi.kitchen'), kind: 'KITCHEN' },
      { id: ROOM_IDS.bedroom, name: t('mockApi.bedroom'), kind: 'BEDROOM' },
      { id: ROOM_IDS.bathroom, name: t('mockApi.bathroom'), kind: 'BATHROOM' },
    ],
    roomSummaries: [
      {
        roomId: ROOM_IDS.entry,
        name: t('mockApi.entrance'),
        kind: 'ENTRANCE',
        color: '#E8F0F3',
        sensors: [
          {
            capability: 'contact',
            value: 'Fermée',
            unit: null,
            state: 'INACTIVE',
            available: true,
            updatedAt: iso(-90 * MINUTE),
          },
          {
            capability: 'motion',
            value: t('mockApi.noRecentMovement'),
            unit: null,
            state: 'INACTIVE',
            available: true,
            updatedAt: iso(-46 * MINUTE),
          },
        ],
      },
      {
        roomId: ROOM_IDS.living,
        name: t('mockApi.livingRoom'),
        kind: 'LIVING_ROOM',
        color: '#F2E9D9',
        sensors: [
          {
            capability: 'motion',
            value: t('mockApi.movementDetected'),
            unit: null,
            state: 'ACTIVE',
            available: true,
            updatedAt: iso(-18 * MINUTE),
          },
          {
            capability: 'temperature',
            value: 21.4,
            unit: '°C',
            state: 'INACTIVE',
            available: true,
            updatedAt: iso(-12 * MINUTE),
          },
        ],
      },
      {
        roomId: ROOM_IDS.kitchen,
        name: t('mockApi.kitchen'),
        kind: 'KITCHEN',
        color: '#E4EDE5',
        sensors: [
          {
            capability: 'contact',
            value: 'Frigo ouvert',
            unit: null,
            state: 'ACTIVE',
            available: true,
            updatedAt: iso(-38 * MINUTE),
          },
          {
            capability: 'motion',
            value: t('mockApi.movementDetected'),
            unit: null,
            state: 'ACTIVE',
            available: true,
            updatedAt: iso(-34 * MINUTE),
          },
        ],
      },
      {
        roomId: ROOM_IDS.bedroom,
        name: t('mockApi.bedroom'),
        kind: 'BEDROOM',
        color: '#ECE8F3',
        sensors: [
          {
            capability: 'occupancy',
            value: t('mockApi.restEndedAt0718'),
            unit: null,
            state: 'INACTIVE',
            available: true,
            updatedAt: iso(-7 * HOUR),
          },
        ],
      },
      {
        roomId: ROOM_IDS.bathroom,
        name: t('mockApi.bathroom'),
        kind: 'BATHROOM',
        color: '#E3EFF0',
        shower: {
          state: 'COMPLETED',
          currentHumidity: 55,
          baselineHumidity: 43,
          risePercent: 28,
          startedAt: iso(-4.4 * HOUR),
          endedAt: iso(-4.05 * HOUR),
          durationMinutes: 21,
          updatedAt: iso(-4.05 * HOUR),
        },
        sensors: [
          {
            capability: 'humidity',
            value: 55,
            unit: '%',
            state: 'INACTIVE',
            available: true,
            updatedAt: iso(-4 * HOUR),
          },
        ],
      },
    ],
    latestPresence: {
      roomId: ROOM_IDS.living,
      occurredAt: iso(-18 * MINUTE),
      capability: 'motion',
    },
    activityRooms: [
      t('mockApi.kitchen'),
      t('mockApi.livingRoom'),
      t('mockApi.bathroom'),
      t('mockApi.bedroom'),
    ],
    entrance: {
      state: 'INSIDE_ACTIVITY',
      reason: 'FOLLOWED_BY_MOVEMENT',
      openedAt: iso(-5 * HOUR),
      closedAt: iso(-4.95 * HOUR),
      evidenceAt: iso(-4.9 * HOUR),
      evaluateAfter: null,
      windowSeconds: 120,
      roomName: t('mockApi.entrance'),
    },
    cards: [
      {
        id: 'opening-main',
        label: t('mockApi.frontDoor'),
        kind: 'OPENING',
        available: true,
        observedToday: true,
        countToday: 2,
        lastObservedAt: iso(-5 * HOUR),
        state: 'INACTIVE',
        updatedAt: iso(-90 * MINUTE),
      },
      {
        id: 'fridge-kitchen',
        label: t('mockApi.fridge'),
        kind: 'FRIDGE',
        available: true,
        observedToday: true,
        countToday: 5,
        lastObservedAt: iso(-38 * MINUTE),
        state: 'ACTIVE',
        updatedAt: iso(-38 * MINUTE),
      },
      {
        id: 'toilet-bathroom',
        label: t('mockApi.bathroom'),
        kind: 'TOILET',
        available: true,
        observedToday: true,
        countToday: 3,
        lastObservedAt: iso(-4 * HOUR),
        state: 'INACTIVE',
        updatedAt: iso(-4 * HOUR),
      },
      {
        id: 'comfort-living',
        label: t('mockApi.livingRoomTemperature'),
        kind: 'COMFORT',
        available: true,
        observedToday: true,
        countToday: 1,
        lastObservedAt: iso(-12 * MINUTE),
        state: 'INACTIVE',
        updatedAt: iso(-12 * MINUTE),
      },
      {
        id: 'appliance-kitchen',
        label: t('mockApi.kettle'),
        kind: 'APPLIANCE',
        available: true,
        observedToday: true,
        countToday: 2,
        lastObservedAt: iso(-2.2 * HOUR),
        state: 'INACTIVE',
        updatedAt: iso(-2.2 * HOUR),
      },
    ],
    sleep: {
      roomId: ROOM_IDS.bedroom,
      configured: true,
      available: true,
      occupied: false,
      bedtimeAt: iso(lastBedtime()),
      wakeAt: iso(lastWakeUp()),
    },
    alert: {
      id: 'alert-door-open',
      title: t('mockApi.frontDoorOpenLongerThan'),
      severity: 'ATTENTION',
      roomName: t('mockApi.entrance'),
    },
  };

  const overview: Overview = {
    onboardingRequired: false,
    home: { id: 'home-martin', name: t('mockApi.martinHome'), resident: 'Jeanne Martin' },
    reassurance: 'ATTENTION',
    learningDays: 42,
    openAlerts: 2,
    sensors: { total: 9, online: 8, degraded: 1, offline: 0 },
    nextSchedule: {
      id: 'visit-tomorrow',
      type: 'VISIT',
      title: t('mockApi.claireSVisit'),
      startsAt: iso(22 * HOUR),
    },
    lastActivity: {
      occurredAt: iso(-18 * MINUTE),
      capability: 'motion',
      room: t('mockApi.livingRoom'),
    },
    rooms: [
      { id: ROOM_IDS.entry, name: t('mockApi.entrance'), kind: 'ENTRANCE', sensors: 2 },
      { id: ROOM_IDS.living, name: t('mockApi.livingRoom'), kind: 'LIVING_ROOM', sensors: 2 },
      { id: ROOM_IDS.kitchen, name: t('mockApi.kitchen'), kind: 'KITCHEN', sensors: 2 },
      { id: ROOM_IDS.bedroom, name: t('mockApi.bedroom'), kind: 'BEDROOM', sensors: 1 },
      {
        id: ROOM_IDS.bathroom,
        name: t('mockApi.bathroom'),
        kind: 'BATHROOM',
        sensors: 2,
      },
    ],
  };

  const activityFeed: ActivityItem[] = [
    [-18, t('mockApi.livingRoom'), 'motion', t('mockApi.movementDetected')],
    [-34, t('mockApi.kitchen'), 'motion', t('mockApi.movementNoticed')],
    [-38, t('mockApi.kitchen'), 'contact', t('mockApi.fridgeOpened')],
    [-64, t('mockApi.livingRoom'), 'motion', t('mockApi.presenceInTheLivingRoom')],
    [-112, t('mockApi.entrance'), 'contact', t('mockApi.doorClosed')],
    [-116, t('mockApi.entrance'), 'contact', t('mockApi.doorOpened')],
    [-138, t('mockApi.livingRoom'), 'temperature', t('mockApi.temperatureSteadyAt214')],
    [-210, t('mockApi.bathroom'), 'humidity', t('mockApi.humidityDroppingAfterTheShower')],
    [-235, t('mockApi.bathroom'), 'occupancy', t('mockApi.movementInTheBathroom')],
    [-310, t('mockApi.kitchen'), 'motion', t('mockApi.movementNoticed')],
    [-342, t('mockApi.kitchen'), 'contact', t('mockApi.fridgeOpened')],
    [-405, t('mockApi.livingRoom'), 'motion', t('mockApi.presenceInTheLivingRoom')],
    [-438, t('mockApi.kitchen'), 'button', t('mockApi.kettleUsed')],
    [-486, t('mockApi.bedroom'), 'occupancy', t('mockApi.endOfTheRestPeriod')],
    [-550, t('mockApi.livingRoom'), 'motion', t('mockApi.movementNoticed')],
    [-610, t('mockApi.entrance'), 'contact', t('mockApi.doorClosed')],
    [-614, t('mockApi.entrance'), 'contact', t('mockApi.doorOpened')],
    [-660, t('mockApi.kitchen'), 'motion', t('mockApi.firstMovementOfTheMorning')],
  ].map(([minutes, room, capability, label], index) => ({
    id: `demo-event-${index + 1}`,
    capability: String(capability),
    quality: 'GOOD',
    payload: { label: String(label), state: 'observed' },
    occurredAt: iso(Number(minutes) * MINUTE),
    room: String(room),
    sensor: {
      entityId: `sensor-${String(room).toLowerCase().replaceAll(' ', '-')}`,
      room: { id: ROOM_IDS.living, name: String(room) },
    },
  }));

  const events = [
    {
      id: 'summary-event-1',
      occurredAt: iso(-18 * MINUTE),
      capability: 'motion' as const,
      quality: 'GOOD',
      payload: { state: 'on' },
      roomId: ROOM_IDS.living,
      roomName: t('mockApi.livingRoom'),
      sensorId: 'sensor-living-motion',
      sensorName: t('mockApi.motionDetector'),
      sensorStatus: 'ONLINE',
      unit: null,
      targetType: 'ROOM' as const,
      targetId: ROOM_IDS.living,
      passage: null,
    },
    {
      id: 'summary-event-2',
      occurredAt: iso(-34 * MINUTE),
      capability: 'motion' as const,
      quality: 'GOOD',
      payload: { state: 'on' },
      roomId: ROOM_IDS.kitchen,
      roomName: t('mockApi.kitchen'),
      sensorId: 'sensor-kitchen-motion',
      sensorName: t('mockApi.motionDetector'),
      sensorStatus: 'ONLINE',
      unit: null,
      targetType: 'ROOM' as const,
      targetId: ROOM_IDS.kitchen,
      passage: null,
    },
    {
      id: 'summary-event-3',
      occurredAt: iso(-38 * MINUTE),
      capability: 'contact' as const,
      quality: 'GOOD',
      payload: { state: 'open' },
      roomId: ROOM_IDS.kitchen,
      roomName: t('mockApi.kitchen'),
      sensorId: 'sensor-fridge-contact',
      sensorName: t('mockApi.fridgeContact'),
      sensorStatus: 'ONLINE',
      unit: null,
      targetType: 'ITEM' as const,
      targetId: 'fridge-kitchen',
      passage: null,
    },
  ];

  const activitySummary: ActivitySummary = {
    period: '24h',
    from: iso(-DAY),
    to: iso(),
    total: 31,
    buckets: Array.from({ length: 8 }, (_, index) => ({
      start: iso(-(7 - index) * 3 * HOUR),
      label: `${String(7 + index * 2).padStart(2, '0')} h`,
      count: [1, 3, 5, 2, 6, 4, 7, 3][index] ?? 0,
    })),
    byRoom: [
      { id: ROOM_IDS.kitchen, name: t('mockApi.kitchen'), count: 11 },
      { id: ROOM_IDS.living, name: t('mockApi.livingRoom'), count: 9 },
      { id: ROOM_IDS.entry, name: t('mockApi.entrance'), count: 5 },
      { id: ROOM_IDS.bathroom, name: t('mockApi.bathroom'), count: 4 },
      { id: ROOM_IDS.bedroom, name: t('mockApi.bedroom'), count: 2 },
    ],
    byCapability: [
      { capability: 'motion', count: 17 },
      { capability: 'contact', count: 9 },
      { capability: 'occupancy', count: 3 },
      { capability: 'temperature', count: 2 },
    ],
    dwellByRoom: [
      {
        id: ROOM_IDS.living,
        name: t('mockApi.livingRoom'),
        totalSeconds: 3 * 60 * 60,
        averageSeconds: 2700,
        medianSeconds: 2400,
        sessions: 4,
        reliableSessions: 4,
        ambiguousSeconds: 180,
        confidenceRate: 0.96,
      },
      {
        id: ROOM_IDS.kitchen,
        name: t('mockApi.kitchen'),
        totalSeconds: 95 * 60,
        averageSeconds: 1425,
        medianSeconds: 1200,
        sessions: 4,
        reliableSessions: 4,
        ambiguousSeconds: 90,
        confidenceRate: 0.95,
      },
      {
        id: ROOM_IDS.bathroom,
        name: t('mockApi.bathroom'),
        totalSeconds: 26 * 60,
        averageSeconds: 780,
        medianSeconds: 750,
        sessions: 2,
        reliableSessions: 2,
        ambiguousSeconds: 0,
        confidenceRate: 0.91,
      },
    ],
    unknownSeconds: 35 * 60,
    reliableBuckets: Array.from({ length: 8 }, (_, index) => ({
      start: iso(-(7 - index) * 3 * HOUR),
      label: `${String(7 + index * 2).padStart(2, '0')} h`,
      seconds: [0, 1800, 2700, 900, 3300, 1500, 4200, 1200][index] ?? 0,
      byRoom: {
        [ROOM_IDS.living]: [0, 900, 1200, 0, 1500, 900, 1800, 600][index] ?? 0,
        [ROOM_IDS.kitchen]: [0, 900, 900, 600, 900, 300, 1200, 300][index] ?? 0,
      },
    })),
    observedSeconds: (8 * HOUR) / 1000,
    unobservedSeconds: (15 * HOUR) / 1000,
    lastReliableActivity: events[0] ?? null,
    rooms: [
      {
        id: ROOM_IDS.living,
        name: t('mockApi.livingRoom'),
        kind: 'LIVING_ROOM',
        floor: 0,
        state: 'OBSERVED',
        environmentState: 'OBSERVED',
        sensorCount: 2,
        lastActivity: events[0] ?? null,
        environment: [
          {
            capability: 'temperature',
            latestValue: '21,4 °C',
            numericValue: 21.4,
            unit: '°C',
            minimum: 20.8,
            maximum: 21.8,
            points: [
              { occurredAt: iso(-3 * HOUR), value: 20.8 },
              { occurredAt: iso(-2 * HOUR), value: 21.1 },
              { occurredAt: iso(-HOUR), value: 21.8 },
              { occurredAt: iso(-12 * MINUTE), value: 21.4 },
            ],
          },
        ],
        safety: [],
      },
      {
        id: ROOM_IDS.kitchen,
        name: t('mockApi.kitchen'),
        kind: 'KITCHEN',
        floor: 0,
        state: 'OBSERVED',
        environmentState: 'LEARNING',
        sensorCount: 2,
        lastActivity: events[1] ?? null,
        environment: [],
        safety: [],
      },
      {
        id: ROOM_IDS.bedroom,
        name: t('mockApi.bedroom'),
        kind: 'BEDROOM',
        floor: 0,
        state: 'OBSERVED',
        environmentState: 'NOT_EQUIPPED',
        sensorCount: 1,
        lastActivity: null,
        environment: [],
        safety: [],
      },
    ],
    sequences: [
      {
        id: 'sequence-1',
        startedAt: iso(-18 * MINUTE),
        endedAt: iso(-14 * MINUTE),
        durationSeconds: 240,
        roomIds: [ROOM_IDS.living],
        roomNames: [t('mockApi.livingRoom')],
        passages: [],
        totalEventCount: 2,
        hiddenEventCount: 0,
        events: [events[0]],
      },
      {
        id: 'sequence-2',
        startedAt: iso(-40 * MINUTE),
        endedAt: iso(-32 * MINUTE),
        durationSeconds: 480,
        roomIds: [ROOM_IDS.kitchen],
        roomNames: [t('mockApi.kitchen')],
        passages: [],
        totalEventCount: 4,
        hiddenEventCount: 1,
        events: [events[1], events[2]],
      },
      {
        id: 'sequence-3',
        startedAt: iso(-65 * MINUTE),
        endedAt: iso(-58 * MINUTE),
        durationSeconds: 420,
        roomIds: [ROOM_IDS.entry, ROOM_IDS.living],
        roomNames: [t('mockApi.entrance'), t('mockApi.livingRoom')],
        passages: [
          {
            fromLevelId: 'level-ground',
            fromLevelName: t('mockApi.groundFloor'),
            toLevelId: 'level-ground',
            toLevelName: t('mockApi.groundFloor'),
          },
        ],
        totalEventCount: 3,
        hiddenEventCount: 0,
        events: [events[0]],
      },
      {
        id: 'sequence-4',
        startedAt: iso(-4.5 * HOUR),
        endedAt: iso(-4.1 * HOUR),
        durationSeconds: 1440,
        roomIds: [ROOM_IDS.bathroom],
        roomNames: [t('mockApi.bathroom')],
        passages: [],
        totalEventCount: 5,
        hiddenEventCount: 2,
        events: [events[2]],
      },
    ],
    hasMoreSequences: false,
  };

  const alerts: AlertItem[] = [
    {
      id: 'alert-door-open',
      type: 'DOOR_OPEN_LONG',
      severity: 'ATTENTION',
      status: 'OPEN',
      title: t('mockApi.frontDoorOpenLongerThan'),
      explanation: t('mockApi.theDoorStayedOpenFor'),
      confidence: 0.82,
      openedAt: iso(-52 * MINUTE),
      room: { id: ROOM_IDS.entry, name: t('mockApi.entrance') },
      lastMovement: { occurredAt: iso(-48 * MINUTE), roomName: t('mockApi.entrance') },
      transitions: [],
    },
    {
      id: 'alert-sensor-low-battery',
      type: 'SENSOR_LOW_BATTERY',
      severity: 'INFO',
      status: 'ACKNOWLEDGED',
      title: t('mockApi.batteryToReplaceSoon'),
      explanation: t('mockApi.theBedroomDetectorReportsA'),
      confidence: 1,
      openedAt: iso(-4 * HOUR),
      room: { id: ROOM_IDS.bedroom, name: t('mockApi.bedroom') },
      transitions: [
        {
          id: 'transition-battery-1',
          from: 'OPEN',
          to: 'ACKNOWLEDGED',
          note: null,
          createdAt: iso(-3.5 * HOUR),
        },
      ],
    },
    {
      id: 'alert-temperature',
      type: 'TEMPERATURE_CHANGE',
      severity: 'INFO',
      status: 'RESOLVED',
      title: t('mockApi.temperatureBackInTheUsual'),
      explanation: t('mockApi.theLivingRoomTemperatureWent'),
      confidence: 0.95,
      openedAt: iso(-2 * DAY),
      resolvedAt: iso(-2 * DAY + 30 * MINUTE),
      room: { id: ROOM_IDS.living, name: t('mockApi.livingRoom') },
      transitions: [],
    },
  ];

  const cameras: CameraItem[] = [
    {
      id: 'camera-entry',
      name: t('mockApi.entrance'),
      provider: 'onvif',
      status: 'ONLINE',
      compatibility: 'VALIDATED',
      room: { id: ROOM_IDS.entry, name: t('mockApi.entrance'), kind: 'ENTRANCE' },
      capabilities: { live: true, talk: true, ptz: false, privacy: true, snapshot: true },
      privacyMode: true,
      consentedAt: iso(-30 * DAY),
      lastSeenAt: iso(-2 * MINUTE),
      lastPersonSeenAt: iso(-90 * MINUTE),
    },
    {
      id: 'camera-living',
      name: t('mockApi.livingRoom'),
      provider: 'onvif',
      status: 'ONLINE',
      compatibility: 'RECOGNIZED',
      room: { id: ROOM_IDS.living, name: t('mockApi.livingRoom'), kind: 'LIVING_ROOM' },
      capabilities: { live: true, talk: false, ptz: true, privacy: true, snapshot: true },
      privacyMode: true,
      consentedAt: iso(-30 * DAY),
      lastSeenAt: iso(-3 * MINUTE),
      lastPersonSeenAt: iso(-18 * MINUTE),
    },
  ];

  const sensorDevices: SensorDevice[] = [
    sensor(
      'sensor-entry-door',
      t('mockApi.frontDoor'),
      t('mockApi.entrance'),
      'contact',
      'INACTIVE',
      86,
      -90,
      'SNZB-04',
    ),
    sensor(
      'sensor-entry-motion',
      t('mockApi.entranceMotion'),
      t('mockApi.entrance'),
      'motion',
      'ONLINE',
      78,
      -46,
      'SNZB-03',
    ),
    sensor(
      'sensor-living-motion',
      t('mockApi.livingRoomMotion'),
      t('mockApi.livingRoom'),
      'motion',
      'ONLINE',
      64,
      -18,
      'SNZB-03',
    ),
    sensor(
      'sensor-living-climate',
      t('mockApi.livingRoomTemperature2'),
      t('mockApi.livingRoom'),
      'temperature',
      'ONLINE',
      91,
      -12,
      'SNZB-02P',
    ),
    sensor(
      'sensor-fridge-contact',
      t('mockApi.fridgeContact2'),
      t('mockApi.kitchen'),
      'contact',
      'ONLINE',
      73,
      -38,
      'SNZB-04',
    ),
    sensor(
      'sensor-kitchen-motion',
      t('mockApi.kitchenMotion'),
      t('mockApi.kitchen'),
      'motion',
      'ONLINE',
      58,
      -34,
      'SNZB-03',
    ),
    sensor(
      'sensor-bedroom-climate',
      t('mockApi.bedroomTemperature'),
      t('mockApi.bedroom'),
      'temperature',
      'ATTENTION',
      18,
      -7 * 60,
      'SNZB-02P',
    ),
    sensor(
      'sensor-bathroom-climate',
      t('mockApi.bathroomHumidity'),
      t('mockApi.bathroom'),
      'humidity',
      'ONLINE',
      82,
      -4 * 60,
      'SNZB-02P',
    ),
    sensor(
      'sensor-kettle-plug',
      t('mockApi.kettle'),
      t('mockApi.kitchen'),
      'power',
      'ONLINE',
      67,
      -132,
      'SNZB-01P6',
    ),
    sensor(
      'sensor-bathroom-fall',
      t('mockApi.fallDetector'),
      t('mockApi.bathroom'),
      'fall_detection',
      'ONLINE',
      96,
      -8,
      'DEMO-FALL',
      t('mockApi.demo'),
    ),
    sensor(
      'sensor-living-smoke',
      t('mockApi.smokeDetector'),
      t('mockApi.livingRoom'),
      'smoke',
      'ONLINE',
      94,
      -14,
      'DEMO-SMOKE',
      t('mockApi.demo'),
    ),
    sensor(
      'sensor-kitchen-water',
      t('mockApi.waterLeakDetector'),
      t('mockApi.kitchen'),
      'water_leak',
      'ONLINE',
      91,
      -11,
      'DEMO-WATER',
      t('mockApi.demo'),
    ),
  ];

  const homePlan: HomePlan = {
    schemaVersion: 4,
    revision: 3,
    configured: true,
    setupDraft: null,
    levels: [
      {
        id: 'level-ground',
        name: t('mockApi.groundFloor'),
        floor: 0,
        order: 0,
        width: 760,
        height: 520,
        scaleCmPerUnit: 5,
        rooms: [
          room(ROOM_IDS.entry, t('mockApi.entrance'), 'ENTRANCE', 0, 0, 150, 170, 7),
          room(ROOM_IDS.living, t('mockApi.livingRoom'), 'LIVING_ROOM', 170, 0, 340, 300, 28),
          room(ROOM_IDS.kitchen, t('mockApi.kitchen'), 'KITCHEN', 530, 0, 210, 250, 16),
          room(ROOM_IDS.bedroom, t('mockApi.bedroom'), 'BEDROOM', 0, 190, 245, 300, 19),
          room(ROOM_IDS.bathroom, t('mockApi.bathroom'), 'BATHROOM', 265, 330, 180, 160, 8),
        ],
        openings: [
          {
            id: 'door-main',
            kind: 'DOOR',
            roomIds: [ROOM_IDS.entry],
            x: 70,
            y: 0,
            width: 90,
            rotation: 0,
            isMainEntrance: true,
          },
          {
            id: 'passage-entry-living',
            kind: 'PASSAGE',
            roomIds: [ROOM_IDS.entry, ROOM_IDS.living],
            x: 155,
            y: 90,
            width: 70,
            rotation: 0,
          },
          {
            id: 'passage-living-kitchen',
            kind: 'PASSAGE',
            roomIds: [ROOM_IDS.living, ROOM_IDS.kitchen],
            x: 510,
            y: 90,
            width: 70,
            rotation: 0,
          },
          {
            id: 'passage-living-bedroom',
            kind: 'PASSAGE',
            roomIds: [ROOM_IDS.living, ROOM_IDS.bedroom],
            x: 280,
            y: 300,
            width: 70,
            rotation: 0,
          },
          {
            id: 'door-bathroom',
            kind: 'DOOR',
            roomIds: [ROOM_IDS.living, ROOM_IDS.bathroom],
            x: 300,
            y: 325,
            width: 65,
            rotation: 0,
          },
        ],
        stairs: [],
        items: [
          {
            id: 'item-armchair',
            kind: 'ARMCHAIR',
            roomId: ROOM_IDS.living,
            x: 250,
            y: 80,
            width: 65,
            height: 70,
            rotation: 0,
          },
          {
            id: 'item-sofa',
            kind: 'SOFA',
            roomId: ROOM_IDS.living,
            x: 350,
            y: 70,
            width: 125,
            height: 50,
            rotation: 0,
          },
          {
            id: 'item-tv',
            kind: 'TV_STAND',
            roomId: ROOM_IDS.living,
            x: 445,
            y: 205,
            width: 65,
            height: 35,
            rotation: 0,
          },
          {
            id: 'item-fridge',
            kind: 'FRIDGE',
            roomId: ROOM_IDS.kitchen,
            x: 550,
            y: 25,
            width: 48,
            height: 68,
            rotation: 0,
          },
          {
            id: 'item-table',
            kind: 'TABLE',
            roomId: ROOM_IDS.kitchen,
            x: 610,
            y: 120,
            width: 90,
            height: 68,
            rotation: 0,
          },
          {
            id: 'item-bed',
            kind: 'BED',
            roomId: ROOM_IDS.bedroom,
            x: 60,
            y: 260,
            width: 135,
            height: 95,
            rotation: 0,
          },
          {
            id: 'item-toilet',
            kind: 'TOILET',
            roomId: ROOM_IDS.bathroom,
            x: 365,
            y: 360,
            width: 35,
            height: 45,
            rotation: 0,
          },
        ],
      },
    ],
    placements: sensorDevices
      .filter((device) => device.id !== 'sensor-kettle-plug')
      .map((device) => ({
        id: `placement-${device.id}`,
        kind: 'SENSOR' as const,
        equipmentId: device.id,
        roomId: device.room?.id ?? ROOM_IDS.living,
        floorId: 'level-ground',
        openingId: device.id.includes('door') ? 'door-main' : null,
        targetType: device.id.includes('door') ? ('OPENING' as const) : ('ROOM' as const),
        targetId: device.id.includes('door') ? 'door-main' : (device.room?.id ?? ROOM_IDS.living),
        placementNote: t('mockApi.fictionalPositionForTheDemo'),
        capabilityBindings: device.capabilities.map((capability) => ({
          sensorId: capability.sensorId,
          capability: capability.capability,
          role: capability.label,
        })),
        x:
          60 +
          (device.room?.id === ROOM_IDS.kitchen
            ? 540
            : device.room?.id === ROOM_IDS.bedroom
              ? 70
              : 250),
        y: 35 + (device.room?.id === ROOM_IDS.bedroom ? 210 : 40),
        rotation: 0,
      })),
    connections: [
      {
        id: 'connection-entry-living',
        kind: 'DOOR',
        fromRoomId: ROOM_IDS.entry,
        toRoomId: ROOM_IDS.living,
      },
      {
        id: 'connection-living-kitchen',
        kind: 'PASSAGE',
        fromRoomId: ROOM_IDS.living,
        toRoomId: ROOM_IDS.kitchen,
      },
      {
        id: 'connection-living-bedroom',
        kind: 'PASSAGE',
        fromRoomId: ROOM_IDS.living,
        toRoomId: ROOM_IDS.bedroom,
      },
      {
        id: 'connection-living-bathroom',
        kind: 'DOOR',
        fromRoomId: ROOM_IDS.living,
        toRoomId: ROOM_IDS.bathroom,
      },
    ],
    adjacencies: [],
    understanding: {
      levels: [{ floorId: 'level-ground', roomCount: 5, areaM2: 78, approximate: true }],
      isolatedRoomIds: [],
      adjacentWithoutPassage: [],
      nearAdjacencyIds: [],
      floorsWithoutStairs: [],
      incompleteStairIds: [],
      mainEntranceOpeningId: 'door-main',
    },
  };

  const screen = createScreenSnapshot();
  const schedule = [
    scheduleItem(
      'visit-today',
      'VISIT',
      t('mockApi.visitFromSophieHomeHelp'),
      careVisitStart(),
      t('mockApi.helpWithMeals'),
    ),
    scheduleItem(
      'appointment-tomorrow',
      'APPOINTMENT',
      t('mockApi.doctorSAppointment'),
      doctorStart(),
      t('mockApi.drBernardSPractice'),
    ),
    scheduleItem(
      'visit-weekend',
      'VISIT',
      t('mockApi.lunchWithClaire'),
      3 * DAY,
      t('mockApi.familyVisit'),
    ),
  ];
  const journal: JournalItem[] = [
    journalEntry(
      'journal-1',
      'NOTE',
      t('mockApi.aWellPacedMorning'),
      t('mockApi.jeanneHadBreakfastThenSettled'),
      lastWakeUp() + 2 * HOUR,
    ),
    journalEntry(
      'journal-2',
      'VISIT',
      t('mockApi.claireSVisit'),
      t('mockApi.aMomentSharedOverCoffee'),
      -DAY,
    ),
    journalEntry(
      'journal-3',
      'ALERT',
      t('mockApi.frontDoor'),
      t('mockApi.claireCheckedTheDoorwayAnd'),
      -2 * DAY,
    ),
    journalEntry(
      'journal-4',
      'APPOINTMENT',
      t('mockApi.medicalAppointment'),
      t('mockApi.followUpConsultationWithDr'),
      -3 * DAY,
    ),
    journalEntry(
      'journal-5',
      'NOTE',
      t('mockApi.sundayMeal'),
      t('mockApi.familyLunchAtJeanneS'),
      -4 * DAY,
    ),
    journalEntry(
      'journal-6',
      'MOOD',
      t('mockApi.moodOfTheDay'),
      t('mockApi.jeanneSaidSheWasIn'),
      -5 * DAY,
    ),
    journalEntry(
      'journal-7',
      'VISIT',
      t('mockApi.sophieSVisit'),
      t('mockApi.homeHelpInTheMorning'),
      -6 * DAY,
    ),
    journalEntry(
      'journal-8',
      'NOTE',
      t('mockApi.theRadioWasOn'),
      t('mockApi.franceInterInTheLiving'),
      -7 * DAY,
    ),
  ];

  const today = dateInParis();
  const tomorrow = dateInParis(1);
  const liaison: LiaisonPage = {
    items: [
      {
        id: 'liaison-task-meds',
        kind: 'TASK',
        body: t('mockApi.callThePharmacyToRenew'),
        tags: ['TREATMENT'],
        createdAt: iso(-2 * HOUR),
        author: { id: 'person-claire', displayName: 'Claire Martin' },
        assignee: { id: 'person-claire', displayName: 'Claire Martin' },
        dueOn: today,
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'liaison-note-breakfast',
        kind: 'NOTE',
        body: t('mockApi.jeanneEnjoyedHerBreakfastAnd'),
        tags: ['MEAL', 'MOOD'],
        createdAt: iso(lastWakeUp() + 90 * MINUTE),
        author: { id: 'person-sophie', displayName: 'Sophie Bernard' },
        assignee: null,
        dueOn: null,
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'liaison-task-flowers',
        kind: 'TASK',
        body: t('mockApi.rememberToWaterTheBalcony'),
        tags: [],
        createdAt: iso(-DAY),
        author: { id: 'person-claire', displayName: 'Claire Martin' },
        assignee: { id: 'person-luc', displayName: 'Luc Martin' },
        dueOn: tomorrow,
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'liaison-note-weekend',
        kind: 'NOTE',
        body: t('mockApi.sundayLunchIsConfirmedClaire'),
        tags: ['MEAL'],
        createdAt: iso(-DAY),
        author: { id: 'person-luc', displayName: 'Luc Martin' },
        assignee: null,
        dueOn: null,
        completedAt: iso(-20 * HOUR),
        completedBy: { id: 'person-claire', displayName: 'Claire Martin' },
      },
    ],
    nextCursor: null,
    openTasks: [],
    members: [
      { id: 'person-claire', displayName: 'Claire Martin' },
      { id: 'person-luc', displayName: 'Luc Martin' },
      { id: 'person-sophie', displayName: 'Sophie Bernard' },
    ],
    currentUser: { id: 'person-claire', displayName: 'Claire Martin' },
    visits: [
      {
        id: 'visit-today',
        visitorName: 'Sophie Bernard',
        startsAt: iso(careVisitStart()),
        endsAt: iso(careVisitEnd()),
        notes: t('mockApi.helpWithMeals'),
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'visit-weekend',
        visitorName: 'Claire Martin',
        startsAt: iso(3 * DAY),
        endsAt: iso(3 * DAY + 2 * HOUR),
        notes: t('mockApi.familyLunch'),
        completedAt: null,
        completedBy: null,
      },
      {
        id: 'visit-past',
        visitorName: 'Luc Martin',
        startsAt: iso(-DAY),
        endsAt: iso(-DAY + 2 * HOUR),
        notes: t('mockApi.shoppingAndAWalk'),
        completedAt: iso(-DAY + 2 * HOUR),
        completedBy: { id: 'person-luc', displayName: 'Luc Martin' },
      },
    ],
    appointments: [
      {
        id: 'appointment-tomorrow',
        title: t('mockApi.doctorSAppointment'),
        startsAt: iso(doctorStart()),
        endsAt: iso(doctorEnd()),
        location: t('mockApi.drBernardSPractice'),
        notes: t('mockApi.bringTheLatestResults'),
      },
      {
        id: 'appointment-past',
        title: t('mockApi.homeHairdresser'),
        startsAt: iso(-4 * DAY),
        endsAt: iso(-4 * DAY + HOUR),
        location: t('mockApi.home'),
        notes: null,
      },
    ],
    canWrite: true,
    timezone: 'Europe/Paris',
    today,
    residentName: 'Jeanne Martin',
  };
  liaison.openTasks = liaison.items.filter((item) => item.kind === 'TASK' && !item.completedAt);

  const people: TrustedPerson[] = [
    person(
      'person-claire',
      'Claire',
      'Martin',
      t('mockApi.daughter'),
      'OWNER',
      true,
      0,
      true,
      true,
    ),
    person('person-luc', 'Luc', 'Martin', t('mockApi.son'), 'CAREGIVER', true, 1, true, false),
    person(
      'person-sophie',
      'Sophie',
      'Bernard',
      t('mockApi.homeHelp'),
      'VIEWER',
      false,
      2,
      true,
      false,
    ),
    person(
      'person-marie',
      'Marie',
      'Martin',
      t('mockApi.granddaughter'),
      null,
      false,
      3,
      false,
      false,
    ),
  ];

  const rules: AlertRuleSettings = {
    inactivity: { enabled: true, minutes: 180 },
    doorOpen: { enabled: true, minutes: 8 },
    lowTemperature: { enabled: true, celsius: 17, minutes: 15 },
    highTemperature: { enabled: true, celsius: 30, minutes: 15 },
    nightActivity: { enabled: true, startMinute: 1320, endMinute: 360, minimumEvents: 3 },
    sensorOffline: { enabled: true, minutes: 120 },
    lowBattery: { enabled: true, percent: 20 },
    behavioral: { enabled: false },
  };

  const calendar: CalendarPage = {
    timezone: 'Europe/Paris',
    canWrite: true,
    items: [
      {
        id: 'calendar-visit-today',
        type: 'VISIT',
        title: t('mockApi.sophieHomeHelp'),
        startsAt: iso(careVisitStart()),
        endsAt: iso(careVisitEnd()),
        detail: t('mockApi.visit'),
        notes: t('mockApi.helpWithMeals'),
        seriesId: 'series-care',
        recurrence: 'WEEKLY',
        recurrenceUntil: iso(30 * DAY),
      },
      {
        id: 'calendar-doctor',
        type: 'APPOINTMENT',
        title: t('mockApi.doctorSAppointment'),
        startsAt: iso(doctorStart()),
        endsAt: iso(doctorEnd()),
        detail: t('mockApi.drBernardSPractice'),
        notes: t('mockApi.bringTheLatestResults'),
        seriesId: null,
        recurrence: 'NONE',
        recurrenceUntil: null,
      },
      {
        id: 'calendar-claire',
        type: 'VISIT',
        title: t('mockApi.lunchWithClaire'),
        startsAt: iso(3 * DAY),
        endsAt: iso(3 * DAY + 2 * HOUR),
        detail: t('mockApi.visit'),
        notes: t('mockApi.familyLunch'),
        seriesId: null,
        recurrence: 'NONE',
        recurrenceUntil: null,
      },
      {
        id: 'calendar-past',
        type: 'APPOINTMENT',
        title: t('mockApi.homeHairdresser'),
        startsAt: iso(-4 * DAY),
        endsAt: iso(-4 * DAY + HOUR),
        detail: t('mockApi.home'),
        notes: null,
        seriesId: null,
        recurrence: 'NONE',
        recurrenceUntil: null,
      },
    ],
  };

  return {
    overview,
    homeSummary,
    activityFeed,
    activitySummary,
    alerts,
    cameras,
    sensorDevices,
    homePlan,
    schedule,
    journal,
    liaison,
    people,
    rules,
    calendar,
    screen,
    onboardingSession: null as SensorOnboardingSession | null,
  };
}

function room(
  id: string,
  name: string,
  kind: string,
  x: number,
  y: number,
  width: number,
  height: number,
  areaM2: number,
) {
  return {
    id,
    name,
    kind,
    areaM2,
    geometry: {
      color: '#E8F0F3',
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    },
  };
}

function sensor(
  id: string,
  name: string,
  roomName: string,
  capability: string,
  state: string,
  batteryPercent: number,
  minutesAgo: number,
  model: string,
  manufacturer = 'SONOFF',
): SensorDevice {
  const roomId =
    Object.entries(ROOM_IDS).find(([key]) => {
      const names: Record<string, string> = {
        entry: t('mockApi.entrance'),
        living: t('mockApi.livingRoom'),
        kitchen: t('mockApi.kitchen'),
        bedroom: t('mockApi.bedroom'),
        bathroom: t('mockApi.bathroom'),
      };
      return names[key] === roomName;
    })?.[1] ?? ROOM_IDS.living;
  const status: SensorDevice['capabilities'][number]['status'] =
    state === 'ATTENTION' ? 'DEGRADED' : 'ONLINE';
  return {
    id,
    physicalDeviceId: `physical-${id}`,
    name,
    manufacturer,
    model,
    protocol: 'zigbee',
    integration: 'zigbee2mqtt',
    room: { id: roomId, name: roomName, kind: roomName.toUpperCase().replaceAll(' ', '_') },
    installationStatus: state === 'ATTENTION' ? 'ATTENTION' : 'OPERATIONAL',
    enabled: true,
    placementConfirmedAt: iso(-30 * DAY),
    placementNote: t('mockApi.installedAndCheckedInThis'),
    lastSeenAt: iso(minutesAgo * MINUTE),
    batteryPercent,
    capabilities: [
      {
        sensorId: `${id}-capability`,
        entityId: `binary_sensor.${id}`,
        capability,
        label: capabilityLabel(capability),
        primary: true,
        status,
        value: capability === 'temperature' ? { value: 21.4 } : { state: 'on' },
        unit: capability === 'temperature' ? '°C' : null,
        lastSeenAt: iso(minutesAgo * MINUTE),
        classification: {
          source: 'USER',
          confidence: 0.98,
          reason: 'Confirmé pour la démonstration.',
          confirmedAt: iso(-30 * DAY),
        },
      },
      ...(capability === 'temperature'
        ? [
            {
              sensorId: `${id}-humidity`,
              entityId: `sensor.${id}_humidity`,
              capability: 'humidity',
              label: t('mockApi.humidity'),
              primary: false,
              status,
              value: { value: 48 },
              unit: '%',
              lastSeenAt: iso(minutesAgo * MINUTE),
              classification: {
                source: 'METADATA' as const,
                confidence: 0.96,
                reason: null,
                confirmedAt: null,
              },
            },
          ]
        : []),
    ],
    action: 'NONE',
  };
}

function capabilityLabel(capability: string) {
  return (
    (
      {
        motion: t('mockApi.motion'),
        contact: t('mockApi.opening'),
        temperature: t('mockApi.temperature'),
        humidity: t('mockApi.humidity'),
        power: t('mockApi.power'),
        occupancy: t('mockApi.presence'),
      } as Record<string, string>
    )[capability] ?? capability
  );
}

function createScreenSnapshot(): ScreenSnapshot {
  const state = initialScreenState();
  const mediaId = 'c17b5f20-08c0-4da0-b0bc-3e78b0f6a351';
  state.settings = {
    consent: true,
    volume: 32,
    weatherCity: 'Lyon',
    slideshowSeconds: 18,
    quietStart: '21:30',
    quietEnd: '08:00',
    grants: {
      'person-claire': {
        call: true,
        autoAnswer: false,
        message: true,
        control: true,
        administer: true,
      },
      'person-luc': {
        call: true,
        autoAnswer: false,
        message: true,
        control: false,
        administer: false,
      },
      'person-sophie': {
        call: false,
        autoAnswer: false,
        message: false,
        control: false,
        administer: false,
      },
    },
    schedule: [],
  };
  state.message = t('mockApi.helloJeanneThinkingOfYou');
  state.messages = [state.message, t('mockApi.theAppointmentIsTomorrowAt')];
  state.messageIntervalSeconds = 30;
  state.messageAuthor = 'Claire Martin';
  state.messageUpdatedAt = Date.now() - 20 * MINUTE;
  state.media = [
    {
      id: mediaId,
      kind: 'photo',
      title: t('mockApi.theGardenInSpring'),
      url: 'https://demo.invalid/jardin.jpg',
    },
    {
      id: 'dd421624-87ef-4afe-ab68-2cc26ec72918',
      kind: 'tv',
      title: 'Arte',
      url: 'https://demo.invalid/arte.m3u8',
    },
    {
      id: 'da9f6cc0-ff07-49c6-b2bb-fd4be8e6a015',
      kind: 'audio',
      title: 'France Inter',
      url: 'https://demo.invalid/france-inter.mp3',
    },
    ...DEMO_RADIOS.map((station, index) => ({
      id: [
        'a520632a-74d7-4d1a-9adf-381acd6af201',
        'a520632a-74d7-4d1a-9adf-381acd6af202',
        'a520632a-74d7-4d1a-9adf-381acd6af203',
        'a520632a-74d7-4d1a-9adf-381acd6af204',
        'a520632a-74d7-4d1a-9adf-381acd6af205',
      ][index],
      kind: 'stream' as const,
      title: station.name,
      url: station.url,
    })),
  ];
  state.playback = { mediaId, paused: false, asleep: false, volume: 32, revision: 12 };
  state.podcasts = DEMO_PODCASTS().map(({ id, title, author, episodeCount, genre, feedUrl }) => ({
    id,
    title,
    author,
    episodeCount,
    genre,
    feedUrl,
  }));
  state.call = null;
  state.tvControl = {
    id: 'tv-living-room',
    name: t('mockApi.livingRoomTv'),
    manufacturer: 'Samsung',
    model: 'The Frame',
    protocols: ['cec', 'network'],
    homeAssistantEntityId: 'media_player.sejour',
    homeAssistantName: t('mockApi.livingRoomTv'),
  };
  state.activity = [
    {
      id: 'screen-activity-1',
      kind: 'message',
      title: t('mockApi.messageSent'),
      detail: t('mockApi.helloJeanneThinkingOfYou2'),
      actor: 'Claire Martin',
      createdAt: Date.now() - 20 * MINUTE,
      status: 'applied',
    },
    {
      id: 'screen-activity-2',
      kind: 'content',
      title: t('mockApi.photoShown'),
      detail: t('mockApi.theGardenInSpring'),
      actor: 'Claire Martin',
      createdAt: Date.now() - 2 * HOUR,
      status: 'applied',
    },
    {
      id: 'screen-activity-3',
      kind: 'appointment',
      title: t('mockApi.appointmentAdded'),
      detail: t('mockApi.tomorrowAt10AmDr'),
      actor: 'Claire Martin',
      createdAt: Date.now() - DAY,
      status: 'applied',
    },
  ];
  return {
    state,
    paired: true,
    online: true,
    lastSeen: iso(-2 * MINUTE),
    capabilities: { media: true, messages: true, calls: true, weather: true, calendar: true },
    grant: { call: true, autoAnswer: false, message: true, control: true, administer: true },
    userId: 'person-claire',
    jitsiUrl: null,
    resident: 'Jeanne Martin',
    timezone: 'Europe/Paris',
    visit: null,
    agenda: [
      {
        id: 'appointment-tomorrow',
        type: 'appointment',
        pictogram: 'medical',
        title: 'Dr Bernard · 10 h',
        startsAt: iso(doctorStart()),
      },
      {
        id: 'visit-weekend',
        type: 'visit',
        pictogram: 'family',
        title: t('mockApi.lunchWithClaire'),
        startsAt: iso(3 * DAY),
      },
    ],
    weather: {
      city: 'Lyon',
      temperature: 19,
      minimum: 13,
      maximum: 22,
      weatherCode: 2,
      observedAt: iso(-10 * MINUTE),
    },
    members: [
      { id: 'person-claire', name: 'Claire Martin' },
      { id: 'person-luc', name: 'Luc Martin' },
    ],
  };
}

function scheduleItem(
  id: string,
  type: 'VISIT' | 'APPOINTMENT',
  title: string,
  offset: number,
  detail: string,
) {
  return {
    id,
    type,
    title,
    startsAt: iso(offset),
    endsAt: iso(offset + HOUR),
    detail,
    notes: null,
    seriesId: null,
    recurrence: 'NONE' as const,
    recurrenceUntil: null,
  };
}

function journalEntry(
  id: string,
  kind: string,
  title: string,
  body: string,
  offset: number,
): JournalItem {
  return { id, kind, title, body, occurredAt: iso(offset) };
}

function person(
  id: string,
  firstName: string,
  lastName: string,
  relation: string,
  role: TrustedPerson['role'],
  isEmergency: boolean,
  priority: number,
  hasAccount: boolean,
  isCurrentUser: boolean,
): TrustedPerson {
  return {
    id,
    firstName,
    lastName,
    phone: id === 'person-claire' ? '+33 6 12 34 56 78' : '+33 6 98 76 54 32',
    email: `${firstName.toLowerCase()}@exemple.fr`,
    relation,
    role,
    isEmergency,
    priority,
    hasAccount,
    accessDisabled: false,
    archived: false,
    isCurrentUser,
    username: hasAccount ? firstName.toLowerCase() : null,
  };
}

let demoSession: DemoSession = createDemoSession();
let demoSessionLocale = appLocale();
let demoNotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

export function resetDemoSession() {
  demoSession = createDemoSession();
  demoSessionLocale = appLocale();
  demoNotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

const mockTvStatus = () => ({
  installed: true,
  display: {
    connected: ['HDMI-1'],
    selected: 'HDMI-1',
    mode: '1920x1080@60Hz',
    updatedAt: Date.now() / 1000,
  },
  cec: {
    detected: true,
    tvAcknowledged: true,
    activeSourceSent: true,
    asleepRequested: false,
    updatedAt: Date.now() / 1000,
  },
  networkTv: {
    id: 'tv-living-room',
    name: 'Samsung The Frame',
    mac: '00:00:00:00:00:00',
    homeAssistantEntityId: 'media_player.sejour',
  },
  networkTvStatus: { reachable: true, updatedAt: Date.now() / 1000 },
  homeAssistantTv: { available: true },
});

export function mockDemoRequest<T>(path: string, init?: RequestInit): T {
  const [pathname, search = ''] = path.split('?');
  const params = new URLSearchParams(search);
  const method = init?.method?.toUpperCase() ?? 'GET';
  // The fictional home is written in one language: switching languages starts it afresh.
  if (demoSessionLocale !== appLocale()) resetDemoSession();
  const body =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const state = demoSession;

  if (pathname === '/auth/me') return DEMO_USER as T;
  if (pathname === '/notifications/preferences') {
    if (method === 'PUT') demoNotificationPreferences = body as typeof demoNotificationPreferences;
    return { ...demoNotificationPreferences } as T;
  }
  if (pathname === '/auth/logout' || pathname === '/notifications/subscriptions')
    return { id: 'demo-ok' } as T;
  if (pathname === '/overview') return state.overview as T;
  if (pathname === '/home-summary') return state.homeSummary as T;
  if (pathname === '/schedule') return state.schedule as T;
  if (pathname === '/screen') return state.screen as T;
  if (pathname === '/screen/tv') return mockTvStatus() as T;
  if (pathname === '/screen/tv/reclaim') return { reclaimed: true } as T;
  if (pathname === '/screen/calls') return { accepted: true } as T;
  if (pathname === '/screen/commands') {
    const command = body as { action?: string; mediaId?: string; volume?: number };
    if (command.action === 'play' || command.action === 'resume' || command.action === 'wake') {
      state.screen.state.playback = {
        ...state.screen.state.playback,
        mediaId: command.mediaId ?? state.screen.state.playback.mediaId,
        paused: false,
        asleep: false,
        revision: state.screen.state.playback.revision + 1,
      };
    } else if (command.action === 'pause') {
      state.screen.state.playback = {
        ...state.screen.state.playback,
        paused: true,
        revision: state.screen.state.playback.revision + 1,
      };
    } else if (command.action === 'sleep' || command.action === 'stop') {
      state.screen.state.playback = {
        ...state.screen.state.playback,
        asleep: true,
        revision: state.screen.state.playback.revision + 1,
      };
    } else if (command.action === 'volume' && typeof command.volume === 'number') {
      state.screen.state.playback = {
        ...state.screen.state.playback,
        volume: command.volume,
        revision: state.screen.state.playback.revision + 1,
      };
    }
    return { accepted: true } as T;
  }
  if (pathname === '/screen/message' && method === 'PATCH') {
    if (typeof body.message === 'string') state.screen.state.message = body.message;
    if (Array.isArray(body.messages)) state.screen.state.messages = body.messages as string[];
    if (typeof body.messageIntervalSeconds === 'number')
      state.screen.state.messageIntervalSeconds = body.messageIntervalSeconds;
    state.screen.state.messageUpdatedAt = Date.now();
    return state.screen as T;
  }
  if (pathname === '/screen/settings' && method === 'PATCH') {
    state.screen.state.settings = {
      ...state.screen.state.settings,
      ...body,
    };
    return state.screen as T;
  }
  if (pathname === '/screen/scheduled-content' && method === 'POST') {
    state.screen.state.scheduledContent = [
      ...(state.screen.state.scheduledContent ?? []),
      {
        id: `demo-screen-scheduled-${Date.now()}`,
        kind: String(body.kind) === 'photo' ? 'photo' : 'message',
        scheduledAt: Date.now() + HOUR,
        createdAt: Date.now(),
        actor: 'Claire Martin',
        title: t('mockApi.scheduledContent'),
      },
    ];
    return state.screen as T;
  }
  if (pathname.startsWith('/screen/scheduled-content/') && method === 'DELETE') {
    const id = pathname.split('/').at(-1);
    state.screen.state.scheduledContent = (state.screen.state.scheduledContent ?? []).filter(
      (item) => item.id !== id,
    );
    return state.screen as T;
  }
  if (pathname === '/screen/media' && method === 'POST') {
    state.screen.state.media = [
      ...state.screen.state.media,
      body as unknown as (typeof state.screen.state.media)[number],
    ];
    return { accepted: true } as T;
  }
  if (pathname.startsWith('/screen/media/') && method === 'DELETE') {
    const id = pathname.split('/').at(-1);
    state.screen.state.media = state.screen.state.media.filter((item) => item.id !== id);
    return { accepted: true } as T;
  }
  if (pathname === '/screen/radio/search') {
    const query = params.get('q')?.trim().toLocaleLowerCase('fr') ?? '';
    return DEMO_RADIOS.filter(
      (station) => !query || station.name.toLocaleLowerCase('fr').includes(query),
    ) as T;
  }
  if (pathname === '/screen/podcasts/search') {
    const query = params.get('q')?.trim().toLocaleLowerCase('fr') ?? '';
    return DEMO_PODCASTS()
      .filter(
        (podcast) =>
          !query ||
          `${podcast.title} ${podcast.author} ${podcast.genre}`
            .toLocaleLowerCase('fr')
            .includes(query),
      )
      .map(({ id, title, author, episodeCount, genre }) => ({
        id,
        title,
        author,
        episodeCount,
        genre,
      })) as T;
  }
  if (/^\/screen\/podcasts\/[^/]+\/episodes$/.test(pathname)) {
    const podcastId = pathname.split('/')[3] ?? '100001';
    const episodes = DEMO_PODCAST_EPISODES();
    return (episodes[podcastId as keyof typeof episodes] ?? episodes['100001']) as T;
  }
  if (/^\/screen\/podcasts\/[^/]+\/play$/.test(pathname)) {
    const podcastId = pathname.split('/')[3] ?? '100001';
    const podcasts = DEMO_PODCASTS();
    const podcast = podcasts.find((item) => item.id === podcastId) ?? podcasts[0];
    const episodes =
      DEMO_PODCAST_EPISODES()[podcast.id as keyof ReturnType<typeof DEMO_PODCAST_EPISODES>] ??
      DEMO_PODCAST_EPISODES()['100001'];
    const requestedEpisodeId = typeof body.episodeId === 'string' ? body.episodeId : '';
    const episode = episodes.find((item) => item.id === requestedEpisodeId) ?? episodes[0];
    const mediaId =
      podcast.id === '100002'
        ? '98fd6b5e-390c-4ff6-9935-6fd5e7fa34f5'
        : '98fd6b5e-390c-4ff6-9935-6fd5e7fa34f4';
    if (!state.screen.state.podcasts?.some((item) => item.id === podcast.id)) {
      state.screen.state.podcasts = [...(state.screen.state.podcasts ?? []), podcast];
    }
    const savedEpisode = state.screen.state.media.find((item) => item.id === mediaId);
    if (savedEpisode) {
      savedEpisode.title = episode.title;
      savedEpisode.url = episode.enclosureUrl;
      savedEpisode.podcastEpisodeId = episode.id;
      savedEpisode.podcastPublishedAt = episode.publishedAt ?? undefined;
      savedEpisode.podcastDurationSeconds = episode.durationSeconds ?? undefined;
    } else {
      state.screen.state.media.push({
        id: mediaId,
        kind: 'podcast',
        title: episode.title,
        url: episode.enclosureUrl,
        podcastFeedId: podcast.id,
        podcastEpisodeId: episode.id,
        podcastShowTitle: podcast.title,
        ...(episode.publishedAt ? { podcastPublishedAt: episode.publishedAt } : {}),
        ...(episode.durationSeconds ? { podcastDurationSeconds: episode.durationSeconds } : {}),
      });
    }
    state.screen.state.playback = {
      ...state.screen.state.playback,
      mediaId,
      paused: false,
      asleep: false,
      revision: state.screen.state.playback.revision + 1,
    };
    return state.screen as T;
  }
  if (/^\/screen\/podcasts\/[^/]+\/follow$/.test(pathname)) {
    const podcastId = pathname.split('/')[3] ?? '100001';
    const podcasts = state.screen.state.podcasts ?? [];
    if (!podcasts.some((item) => item.id === podcastId)) {
      const podcast = DEMO_PODCASTS().find((item) => item.id === podcastId);
      if (podcast) state.screen.state.podcasts = [...podcasts, podcast];
    }
    return { accepted: true } as T;
  }
  if (pathname.includes('/screen/podcasts/')) return { accepted: true } as T;
  if (pathname === '/screen/upload') return state.screen as T;

  if (pathname === '/activity/feed') {
    const pageSize = 30;
    return { items: state.activityFeed.slice(0, pageSize), nextCursor: null } as T;
  }
  if (pathname === '/journal/feed') return { items: state.journal, nextCursor: null } as T;
  if (pathname === '/analytics/activity') return state.activitySummary as T;
  if (pathname === '/alerts/feed') return { items: state.alerts, nextCursor: null } as T;
  if (pathname === '/alerts/summary')
    return {
      urgentCount: state.alerts.filter(
        (alert) => alert.status === 'OPEN' && alert.severity === 'URGENT',
      ).length,
    } as T;
  if (/^\/alerts\/[^/]+\/detail$/.test(pathname)) {
    const id = pathname.split('/')[2];
    const alert = state.alerts.find((item) => item.id === id) ?? state.alerts[0];
    const detail: AlertDetail = {
      ...alert,
      sensor: {
        id: 'sensor-entry-door',
        sourceName: t('mockApi.frontDoor'),
        capability: 'contact',
        unit: null,
      },
      observations: [
        {
          id: 'observation-open',
          occurredAt: alert.openedAt,
          capability: 'contact',
          quality: 'GOOD',
          payload: { state: 'open', durationMinutes: 8 },
        },
        {
          id: 'observation-close',
          occurredAt: iso(-44 * MINUTE),
          capability: 'contact',
          quality: 'GOOD',
          payload: { state: 'closed' },
        },
      ],
    };
    return detail as T;
  }
  if (/^\/alerts\/[^/]+$/.test(pathname) && method === 'PATCH') {
    const id = pathname.split('/')[2];
    const alert = state.alerts.find((item) => item.id === id);
    if (alert) {
      alert.status = body.status as AlertItem['status'];
      alert.transitions = [
        ...(alert.transitions ?? []),
        {
          id: `transition-${Date.now()}`,
          from: 'OPEN',
          to: alert.status,
          note: typeof body.note === 'string' ? body.note : null,
          createdAt: iso(),
        },
      ];
      if (alert.status === 'RESOLVED' || alert.status === 'DISMISSED') alert.resolvedAt = iso();
      return alert as T;
    }
    return {} as T;
  }

  if (pathname === '/cameras') return state.cameras as T;
  if (pathname === '/sensor-devices') return state.sensorDevices as T;
  if (pathname === '/sensor-devices/protocols')
    return [
      { id: 'zigbee', available: true, native: true },
      { id: 'matter', available: false, native: true },
      { id: 'wifi', available: true, native: false },
    ] as T;
  if (pathname === '/household/plan') {
    if (method === 'PUT') state.homePlan = body as unknown as HomePlan;
    return state.homePlan as T;
  }
  if (pathname === '/household/people' && method === 'POST') {
    const created: TrustedPerson = {
      ...person(
        `person-demo-${Date.now()}`,
        typeof body.firstName === 'string' ? body.firstName : 'Alex',
        typeof body.lastName === 'string' ? body.lastName : 'Martin',
        typeof body.relation === 'string' ? body.relation : t('mockApi.relative'),
        null,
        Boolean(body.isEmergency),
        state.people.length,
        false,
        false,
      ),
      phone: typeof body.phone === 'string' ? body.phone : null,
      email: typeof body.email === 'string' ? body.email : null,
    };
    state.people.push(created);
    return created as T;
  }
  if (pathname === '/household/people') return state.people as T;
  if (pathname.startsWith('/household/people/') && method === 'DELETE') return undefined as T;
  if (pathname.startsWith('/household/people/') && method === 'PATCH') {
    const id = pathname.split('/')[3];
    const existing = state.people.find((item) => item.id === id);
    if (existing) Object.assign(existing, body);
    return (existing ?? state.people[0]) as T;
  }
  if (pathname === '/liaison' && method === 'POST') {
    const item = {
      id: `liaison-demo-${Date.now()}`,
      kind: String(body.kind) === 'TASK' ? ('TASK' as const) : ('NOTE' as const),
      body: typeof body.body === 'string' ? body.body : '',
      tags: Array.isArray(body.tags) ? (body.tags as LiaisonPage['items'][number]['tags']) : [],
      createdAt: iso(),
      author: { id: 'person-claire', displayName: 'Claire Martin' },
      assignee: null,
      dueOn: null,
      completedAt: null,
      completedBy: null,
    };
    state.liaison.items.unshift(item);
    state.liaison.openTasks = state.liaison.items.filter(
      (entry) => entry.kind === 'TASK' && !entry.completedAt,
    );
    return item as T;
  }
  if (pathname.startsWith('/liaison/') && pathname.endsWith('/completion') && method === 'PATCH') {
    const id = pathname.split('/').at(-2);
    if (pathname.includes('/visits/')) {
      const visit = state.liaison.visits.find((entry) => entry.id === id);
      if (visit) visit.completedAt = body.completed ? iso() : null;
      return visit as T;
    }
    const item = state.liaison.items.find((entry) => entry.id === id);
    if (item) item.completedAt = body.completed ? iso() : null;
    state.liaison.openTasks = state.liaison.items.filter(
      (entry) => entry.kind === 'TASK' && !entry.completedAt,
    );
    return item as T;
  }
  if (pathname === '/liaison') {
    const filtered = state.liaison.items
      .filter(
        (item) => params.get('filter') !== 'OPEN' || (item.kind === 'TASK' && !item.completedAt),
      )
      .filter((item) => params.get('filter') !== 'DONE' || Boolean(item.completedAt));
    return { ...state.liaison, items: filtered, nextCursor: null } as T;
  }
  if (pathname === '/calendar' || pathname.startsWith('/calendar/')) {
    if (method === 'POST') {
      const item = {
        id: `calendar-demo-${Date.now()}`,
        type: body.type === 'VISIT' ? ('VISIT' as const) : ('APPOINTMENT' as const),
        title:
          typeof body.title === 'string'
            ? body.title
            : typeof body.visitorName === 'string'
              ? body.visitorName
              : t('mockApi.visit'),
        startsAt: typeof body.startsAt === 'string' ? body.startsAt : iso(HOUR),
        endsAt: typeof body.endsAt === 'string' ? body.endsAt : null,
        detail:
          body.type === 'VISIT'
            ? t('mockApi.visit')
            : typeof body.location === 'string'
              ? body.location
              : null,
        notes: typeof body.notes === 'string' ? body.notes : null,
        seriesId: null,
        recurrence: (body.recurrence ?? 'NONE') as 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY',
        recurrenceUntil: typeof body.recurrenceUntil === 'string' ? body.recurrenceUntil : null,
      };
      state.calendar.items.unshift(item);
      return item as T;
    }
    if (method === 'DELETE') {
      const id = pathname.split('/')[2];
      state.calendar.items = state.calendar.items.filter((item) => item.id !== id);
      return undefined as T;
    }
    if (method === 'PATCH') {
      const id = pathname.split('/')[2];
      const existing = state.calendar.items.find((item) => item.id === id);
      if (existing) Object.assign(existing, body);
      return existing as T;
    }
    return state.calendar as T;
  }

  if (pathname === '/alerts/rules') {
    if (method === 'PATCH') Object.assign(state.rules, body);
    return state.rules as T;
  }
  if (pathname === '/simulation/scenarios') return DEMO_SCENARIOS() as T;
  if (pathname.startsWith('/simulation/scenarios/')) {
    state.activityFeed.unshift(
      {
        id: `demo-simulation-${Date.now()}-1`,
        capability: 'motion',
        quality: 'GOOD',
        payload: {
          label: t('mockApi.simulatedMovementInTheLiving'),
          state: 'observed',
        },
        occurredAt: iso(),
        room: t('mockApi.livingRoom'),
        sensor: {
          entityId: 'sensor-demo-simulation',
          room: { id: ROOM_IDS.living, name: t('mockApi.livingRoom') },
        },
      },
      {
        id: `demo-simulation-${Date.now()}-2`,
        capability: 'contact',
        quality: 'GOOD',
        payload: { label: t('mockApi.demoEvent'), state: 'observed' },
        occurredAt: iso(-MINUTE),
        room: t('mockApi.entrance'),
        sensor: {
          entityId: 'sensor-demo-door',
          room: { id: ROOM_IDS.entry, name: t('mockApi.entrance') },
        },
      },
    );
    return { accepted: 2, duplicates: 0 } as T;
  }
  if (pathname === '/remote-access/status') return DEMO_REMOTE_STATUS as T;
  if (pathname.startsWith('/remote-access/')) return DEMO_REMOTE_STATUS as T;

  if (pathname === '/sensor-devices/onboarding-sessions/current')
    return state.onboardingSession as T;
  if (pathname === '/sensor-devices/onboarding-sessions' && method === 'POST') {
    state.onboardingSession = {
      id: 'demo-onboarding-session',
      protocol: 'zigbee',
      status: 'DEVICE_FOUND',
      step: 'DEVICE_FOUND',
      deviceId: 'sensor-new-demo',
      errorCode: null,
      errorMessage: null,
      expiresAt: iso(5 * MINUTE),
      connection: { online: true, pairingOpen: true, deviceDetected: true, updatedAt: iso() },
      detectedDevice: {
        ...sensor(
          'sensor-new-demo',
          t('mockApi.newDetector'),
          t('mockApi.livingRoom'),
          'motion',
          'ONLINE',
          100,
          0,
          'SNZB-03',
        ),
        detectedType: 'MOTION',
      },
    };
    return state.onboardingSession as T;
  }
  if (
    /^\/sensor-devices\/onboarding-sessions\/[^/]+\/complete$/.test(pathname) &&
    method === 'POST'
  ) {
    const session = state.onboardingSession;
    const device = session?.detectedDevice;
    if (!session || !device) return { sessionId: 'demo-onboarding-session', device: null } as T;
    device.name = typeof body.name === 'string' ? body.name : device.name;
    if (body.roomId === null) device.room = null;
    else if (typeof body.roomId === 'string') {
      const name =
        state.homeSummary.rooms.find((item) => item.id === body.roomId)?.name ??
        t('mockApi.livingRoom');
      device.room = { id: body.roomId, name, kind: name.toUpperCase().replaceAll(' ', '_') };
    }
    state.sensorDevices.push(device);
    session.status = 'COMPLETED';
    return { sessionId: 'demo-onboarding-session', device } as T;
  }
  if (/^\/sensor-devices\/onboarding-sessions\/[^/]+$/.test(pathname)) {
    if (method === 'DELETE' && state.onboardingSession)
      state.onboardingSession.status = 'CANCELLED';
    return state.onboardingSession as T;
  }
  if (pathname.startsWith('/sensor-devices/') && pathname.includes('/placement-guide'))
    return {
      title: t('mockApi.positionTheSensor'),
      summary: t('mockApi.chooseAClearSpotSuited'),
      steps: [
        t('mockApi.placeTheSensorInThe'),
        t('mockApi.avoidHeatSourcesAndMetal'),
        t('mockApi.checkTheSignalFromThe'),
      ],
      avoid: ['Derrière un meuble métallique', t('mockApi.rightNextToARadiator')],
      testInstruction: t('mockApi.triggerTheSensorToCheck'),
      safetyNote: t('mockApi.aSensorGivesACue'),
    } as T;
  if (pathname.includes('/verification-sessions'))
    return {
      id: 'demo-verification',
      deviceId: 'sensor-living-motion',
      sensorId: 'sensor-living-motion',
      status: 'COMPLETED',
      startedAt: iso(-MINUTE),
      expiresAt: iso(4 * MINUTE),
      observedAt: iso(),
    } as T;
  if (pathname.startsWith('/sensor-devices/') && method === 'PATCH') {
    const device = state.sensorDevices.find((item) => item.id === pathname.split('/')[2]);
    if (device) Object.assign(device, body);
    return { id: device?.id ?? pathname.split('/')[2] } as T;
  }
  if (pathname.startsWith('/sensor-devices/')) return { id: pathname.split('/')[2] } as T;

  if (pathname === '/screen/google')
    return {
      configured: false,
      clientId: '',
      redirectUri: null,
      youtubeEnabled: false,
      calendarEnabled: false,
      youtubeConnected: false,
    } as T;
  if (pathname === '/screen/weather/cities')
    return [{ name: 'Lyon', label: 'Lyon, France', latitude: 45.764, longitude: 4.8357 }] as T;

  return {} as T;
}

const DEMO_USER: CurrentUser = {
  id: 'person-claire',
  displayName: 'Claire Martin',
  username: 'claire',
  email: 'claire@exemple.fr',
  phone: '+33 6 12 34 56 78',
  mustChangePassword: false,
  role: 'OWNER',
  capabilities: [
    'people:read',
    'people:manage',
    'administrators:manage',
    'configuration:read',
    'configuration:manage',
    'alerts:manage',
    'medications:manage',
    'screen:control',
    'screen:administer',
  ],
};

const DEMO_SCENARIOS = (): SimulationScenario[] => [
  {
    id: 'morning-routine',
    title: t('mockApi.usualMorning'),
    description: t('mockApi.aFewMovementsInThe'),
  },
  {
    id: 'door-open',
    title: t('mockApi.doorOpenLonger'),
    description: t('mockApi.anOpeningFollowedByNearby'),
  },
  {
    id: 'quiet-morning',
    title: t('mockApi.quieterMorning'),
    description: t('mockApi.littleMovementObservedAtThe'),
  },
];

const DEMO_REMOTE_STATUS = {
  state: 'READY',
  installed: true,
  remoteUrl: 'https://demo.eliseos.local',
  hostname: 'maison-martin',
  servePort: 8443,
  keyExpiresAt: iso(30 * DAY),
  httpsAvailable: true,
  webrtcAvailable: true,
  authUrl: null,
  actionRequired: 'NONE',
} as const;
