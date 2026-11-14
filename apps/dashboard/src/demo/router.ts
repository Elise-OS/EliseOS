import { boxHealthDemoAnswer, boxHealthDemoState } from './box-health';
import {
  createZigbeeDemo,
  isZigbeeDemoScenario,
  type ZigbeeDemoScenario,
  TV_GUIDE_SOURCES,
  tvChannelLineup,
  type EquipmentCoverage,
  type UpdateStatus,
} from '@elise/contracts';
import { DemoRouteNotFound, demoState, mockDemoRequest, resetDemoSession } from './scenario';
import { t } from '../i18n';

export interface DemoResponse {
  status: number;
  body?: unknown;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const atClock = (day: Date, hours: number, minutes = 0) => {
  const value = new Date(day);
  value.setHours(hours, minutes, 0, 0);
  return value;
};

export const UNAVAILABLE_IN_DEMO = t('router.notAvailableInTheDemo');

const unavailable = (): DemoResponse => ({ status: 403, body: { message: UNAVAILABLE_IN_DEMO } });

interface Medication {
  id: string;
  name: string;
  dosage: string;
  instructions: string | null;
  active: boolean;
  schedules: Array<{
    id: string;
    minuteOfDay: number;
    daysOfWeek: number[];
    graceMinutes: number;
    active: boolean;
  }>;
}

/** Web-only answers that the shared mobile scenario does not cover. */
function createWebState() {
  const medications: Medication[] = [
    {
      id: 'medication-levothyrox',
      name: 'Levothyrox',
      dosage: '75 µg',
      instructions: t('router.onAnEmptyStomachWith'),
      active: true,
      schedules: [
        {
          id: 'schedule-morning',
          minuteOfDay: 8 * 60,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          graceMinutes: 60,
          active: true,
        },
      ],
    },
    {
      id: 'medication-doliprane',
      name: 'Doliprane',
      dosage: '500 mg',
      instructions: t('router.ifInPainNoMore'),
      active: true,
      schedules: [
        {
          id: 'schedule-evening',
          minuteOfDay: 20 * 60,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          graceMinutes: 90,
          active: true,
        },
      ],
    },
  ];
  return {
    home: {
      id: 'home-martin',
      name: t('router.martinHome'),
      timezone: 'Europe/Paris',
      type: t('router.house'),
      address: 'Lyon',
      floorCount: 1,
      installationStatus: 'ACTIVE',
      learningStartedAt: iso(-42 * DAY),
    },
    medications,
    doseChanges: new Map<
      string,
      { status: string; confirmedAt: string | null; note: string | null }
    >(),
  };
}

let web = createWebState();

/** `?zigbee=empty` (or none, new, missing) opens the Zigbee key settings in another situation. */
function zigbeeScenario(): ZigbeeDemoScenario {
  const value =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('zigbee');
  return isZigbeeDemoScenario(value) ? value : 'ready';
}
let zigbee = createZigbeeDemo({ scenario: zigbeeScenario() });

export function resetDemo() {
  resetDemoSession();
  web = createWebState();
  zigbee = createZigbeeDemo({ scenario: zigbeeScenario() });
}

function overview() {
  const state = demoState();
  return {
    ...state.overview,
    openAlerts: state.alerts.filter((alert) => alert.status === 'OPEN').length,
    currentUser: { id: 'person-claire', displayName: 'Claire Martin', firstName: 'Claire' },
    home: { id: web.home.id, name: web.home.name, type: web.home.type, resident: 'Jeanne Martin' },
    resident: {
      id: 'resident-jeanne',
      displayName: 'Jeanne Martin',
      preferredName: 'Jeanne',
      photoUrl: null,
      supportNeeds: [],
      knownHabits: 4,
    },
    activity: state.activityFeed.slice(0, 12),
  };
}

function household() {
  const state = demoState();
  const sensorsByRoom = new Map<string, unknown[]>();
  for (const device of state.sensorDevices) {
    const capability = device.capabilities[0];
    const sensor = {
      id: device.id,
      entityId: `binary_sensor.${device.id.replaceAll('-', '_')}`,
      capability: capability?.capability ?? 'motion',
      status: capability?.status ?? 'ONLINE',
      lastSeenAt: device.lastSeenAt,
      lastValue: null,
      device: { name: device.name, manufacturer: device.manufacturer, model: device.model },
    };
    const roomId = device.room?.id ?? 'unassigned';
    sensorsByRoom.set(roomId, [...(sensorsByRoom.get(roomId) ?? []), sensor]);
  }
  return {
    home: web.home,
    residents: [
      {
        id: 'resident-jeanne',
        displayName: 'Jeanne Martin',
        firstName: 'Jeanne',
        lastName: 'Martin',
        preferredName: 'Jeanne',
        birthDate: '1941-03-18',
        spokenLanguage: t('router.english'),
        formOfAddress: 'VOUS',
        photoUrl: null,
        primary: true,
        context: {
          livesAlone: true,
          livesWithPartner: false,
          livesWithRelative: false,
          receivesHomeHelp: true,
          receivesVisits: true,
          hasPet: false,
          mobility: 'CANE',
          hearingDifficulty: true,
          visualDifficulty: false,
        },
        supportNeeds: [
          {
            id: 'need-hearing',
            kind: 'HEARING',
            note: t('router.speakClearlyFacingHer'),
          },
        ],
        habits: [
          {
            id: 'habit-wake',
            kind: 'WAKE_UP',
            status: 'CONFIRMED',
            startMinute: 7 * 60 + 30,
            endMinute: 9 * 60,
          },
          {
            id: 'habit-lunch',
            kind: 'LUNCH',
            status: 'LEARNING',
            startMinute: 12 * 60,
            endMinute: 13 * 60 + 30,
          },
          {
            id: 'habit-dinner',
            kind: 'DINNER',
            status: 'LEARNING',
            startMinute: 19 * 60,
            endMinute: 20 * 60 + 30,
          },
          {
            id: 'habit-bed',
            kind: 'BEDTIME',
            status: 'CONFIRMED',
            startMinute: 21 * 60,
            endMinute: 23 * 60,
          },
        ],
      },
    ],
    trustedContacts: state.people,
    rooms: state.homeSummary.rooms.map((room, index) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      floor: 0,
      sortOrder: index,
      sensors: sensorsByRoom.get(room.id) ?? [],
    })),
    unassignedSensors: sensorsByRoom.get('unassigned') ?? [],
  };
}

function doses(search: URLSearchParams) {
  const from = new Date(`${search.get('from') ?? new Date().toISOString().slice(0, 10)}T00:00:00`);
  const to = new Date(`${search.get('to') ?? new Date().toISOString().slice(0, 10)}T00:00:00`);
  const now = Date.now();
  const items = [];
  for (let day = new Date(from); day <= to; day = new Date(day.getTime() + DAY)) {
    for (const medication of web.medications) {
      for (const schedule of medication.schedules) {
        const scheduledFor = atClock(
          day,
          Math.floor(schedule.minuteOfDay / 60),
          schedule.minuteOfDay % 60,
        );
        const id = `dose-${schedule.id}-${scheduledFor.toISOString().slice(0, 10)}`;
        const past = scheduledFor.getTime() + schedule.graceMinutes * MINUTE < now;
        const change = web.doseChanges.get(id);
        const taken =
          past && !(medication.id === 'medication-doliprane' && day.getDate() % 3 === 0);
        items.push({
          id,
          scheduledFor: scheduledFor.toISOString(),
          status: change?.status ?? (taken ? 'TAKEN' : past ? 'MISSED' : 'PENDING'),
          confirmedAt:
            change?.confirmedAt ??
            (taken ? new Date(scheduledFor.getTime() + 12 * MINUTE).toISOString() : null),
          note: change?.note ?? null,
          schedule: { graceMinutes: schedule.graceMinutes, medication },
          confirmedBy:
            taken || change ? { id: 'person-sophie', displayName: 'Sophie Bernard' } : null,
        });
      }
    }
  }
  return items;
}

const emptyCoverage: EquipmentCoverage = {
  recommendations: [],
  profiles: [],
  summary: {
    main: [],
    optional: [],
    totals: { required: 0, covered: 0, toAdd: 0, optional: 0 },
    warnings: [],
  },
};

const updateStatus = (): UpdateStatus => ({
  state: 'UP_TO_DATE',
  currentVersion: '0.1.12',
  latestVersion: '0.1.12',
  updateAvailable: false,
  authConfigured: false,
  authUsername: null,
  checkedAt: iso(-2 * 60 * MINUTE),
  releaseNotes: null,
  progress: null,
  message: null,
  error: null,
});

/** Invented "on now / next" of each catalog channel with a guide, around the frozen moment. */
const DEMO_TV_PROGRAMMES: Record<
  string,
  { current: () => string; next: () => string; from: [number, number]; to: [number, number] }
> = {
  arte: {
    current: () => t('scenario.gardenInSpring'),
    next: () => t('scenario.landscapesFromHereAndElsewhere'),
    from: [10, 20],
    to: [11, 10],
  },
  rmcLife: {
    current: () => t('router.tvGuide.rmcLifeCurrent'),
    next: () => t('router.tvGuide.rmcLifeNext'),
    from: [9, 55],
    to: [10, 50],
  },
  rmcStory: {
    current: () => t('router.tvGuide.rmcStoryCurrent'),
    next: () => t('router.tvGuide.rmcStoryNext'),
    from: [10, 0],
    to: [11, 0],
  },
  rmcDecouverte: {
    current: () => t('router.tvGuide.rmcDecouverteCurrent'),
    next: () => t('router.tvGuide.rmcDecouverteNext'),
    from: [10, 10],
    to: [11, 5],
  },
  la1: {
    current: () => t('router.tvGuide.la1Current'),
    next: () => t('router.tvGuide.la1Next'),
    from: [10, 0],
    to: [11, 30],
  },
  la2: {
    current: () => t('router.tvGuide.la2Current'),
    next: () => t('router.tvGuide.la2Next'),
    from: [10, 5],
    to: [10, 55],
  },
  canal24h: {
    current: () => t('router.tvGuide.canal24hCurrent'),
    next: () => t('router.tvGuide.canal24hNext'),
    from: [10, 0],
    to: [11, 0],
  },
  clan: {
    current: () => t('router.tvGuide.clanCurrent'),
    next: () => t('router.tvGuide.clanNext'),
    from: [10, 15],
    to: [10, 40],
  },
  france24Es: {
    current: () => t('router.tvGuide.newsCurrent'),
    next: () => t('router.tvGuide.france24Next'),
    from: [10, 30],
    to: [10, 45],
  },
  rai3Trento: {
    current: () => t('router.tvGuide.rai3Current'),
    next: () => t('router.tvGuide.rai3Next'),
    from: [10, 0],
    to: [11, 0],
  },
  rai3Bolzano: {
    current: () => t('router.tvGuide.rai3Current'),
    next: () => t('router.tvGuide.rai3Next'),
    from: [10, 0],
    to: [11, 0],
  },
  rai3Friuli: {
    current: () => t('router.tvGuide.rai3Current'),
    next: () => t('router.tvGuide.rai3Next'),
    from: [10, 0],
    to: [11, 0],
  },
  tv2000: {
    current: () => t('router.tvGuide.tv2000Current'),
    next: () => t('router.tvGuide.tv2000Next'),
    from: [10, 0],
    to: [11, 0],
  },
  euronewsIt: {
    current: () => t('router.tvGuide.newsCurrent'),
    next: () => t('router.tvGuide.euronewsNext'),
    from: [10, 30],
    to: [10, 45],
  },
  rtp1: {
    current: () => t('router.tvGuide.rtp1Current'),
    next: () => t('router.tvGuide.rtp1Next'),
    from: [10, 0],
    to: [11, 0],
  },
  rtp2: {
    current: () => t('router.tvGuide.rtp2Current'),
    next: () => t('router.tvGuide.rtp2Next'),
    from: [10, 5],
    to: [10, 55],
  },
  rtpNoticias: {
    current: () => t('router.tvGuide.newsCurrent'),
    next: () => t('router.tvGuide.rtpNoticiasNext'),
    from: [10, 30],
    to: [10, 45],
  },
  rtpMemoria: {
    current: () => t('router.tvGuide.rtpMemoriaCurrent'),
    next: () => t('router.tvGuide.rtpMemoriaNext'),
    from: [10, 10],
    to: [11, 5],
  },
  rtpAfrica: {
    current: () => t('router.tvGuide.rtpAfricaCurrent'),
    next: () => t('router.tvGuide.rtpAfricaNext'),
    from: [10, 0],
    to: [11, 0],
  },
  dwEnglish: {
    current: () => t('router.tvGuide.newsCurrent'),
    next: () => t('router.tvGuide.dwNext'),
    from: [10, 30],
    to: [10, 45],
  },
  france24En: {
    current: () => t('router.tvGuide.newsCurrent'),
    next: () => t('router.tvGuide.france24Next'),
    from: [10, 30],
    to: [10, 45],
  },
  alJazeeraEn: {
    current: () => t('router.tvGuide.alJazeeraCurrent'),
    next: () => t('router.tvGuide.alJazeeraNext'),
    from: [10, 0],
    to: [11, 0],
  },
};

/** The guide of the channels the demo screen offers, as the API answers it. */
function tvGuide() {
  const today = new Date();
  const slot = (hours: number, minutes: number) => atClock(today, hours, minutes).toISOString();
  const screen = demoState().screen;
  const channels = tvChannelLineup(screen.language, screen.state.tvChannels, screen.timezone);
  const programmes = channels.flatMap((channel) => {
    const programme = DEMO_TV_PROGRAMMES[channel.id];
    if (!programme || !channel.guide) return [];
    const length = (programme.to[0] - programme.from[0]) * 60 + programme.to[1] - programme.from[1];
    const nextEnd = atClock(today, ...programme.to);
    nextEnd.setMinutes(nextEnd.getMinutes() + Math.min(length, 45));
    return [
      {
        sourceId: channel.guide.source,
        id: channel.id,
        name: channel.name,
        current: {
          title: programme.current(),
          description: null,
          startAt: slot(...programme.from),
          endAt: slot(...programme.to),
        },
        next: {
          title: programme.next(),
          description: null,
          startAt: slot(...programme.to),
          endAt: nextEnd.toISOString(),
        },
      },
    ];
  });
  const sources = [
    ...new Map(
      programmes.map(({ sourceId }) => {
        const { label, site } = TV_GUIDE_SOURCES[sourceId];
        return [label, { label, site }] as const;
      }),
    ).values(),
  ];
  return {
    channels: programmes.map(({ id, name, current, next }) => ({ id, name, current, next })),
    sources,
    retrievedAt: iso(-20 * MINUTE),
    stale: false,
  };
}

function parse(body: string | undefined): Record<string, unknown> {
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Answers one API call, as the Élise API would, from the in-memory demo home. */
export function handleDemoRequest(method: string, path: string, rawBody?: string): DemoResponse {
  const [pathname = '', query = ''] = path.split('?');
  const search = new URLSearchParams(query);
  const body = parse(rawBody);
  const state = demoState();

  const zigbeeAnswer = zigbee.handle(method, pathname, rawBody);
  if (zigbeeAnswer) return zigbeeAnswer;
  // `loading` (a request that never ends) is answered by install.ts before reaching the router.
  const boxHealth = boxHealthDemoAnswer(
    method,
    pathname,
    boxHealthDemoState(typeof window === 'undefined' ? '' : window.location.search),
  );
  if (boxHealth && boxHealth !== 'pending') return boxHealth;

  if (pathname === '/auth/setup-state')
    return { status: 200, body: { setupRequired: false, systemReady: true } };
  if (pathname === '/overview') return { status: 200, body: overview() };
  if (pathname === '/alerts' && method === 'GET') return { status: 200, body: state.alerts };
  if (pathname === '/journal') return { status: 200, body: state.journal };
  if (pathname === '/household') return { status: 200, body: household() };
  if (pathname === '/household/home') {
    if (method !== 'GET') Object.assign(web.home, body);
    return { status: 200, body: web.home };
  }
  if (pathname === '/household/presence') return { status: 200, body: state.homeSummary.presence };
  if (pathname === '/household/plan/equipment-coverage')
    return { status: 200, body: emptyCoverage };
  if (/^\/household\/people\/[^/]+\/access$/.test(pathname)) {
    const person = state.people.find((item) => item.id === pathname.split('/')[3]);
    if (person) Object.assign(person, body);
    return { status: 200, body: person ?? {} };
  }
  if (pathname === '/medications') {
    if (method === 'POST') {
      const created = {
        id: `medication-${Date.now()}`,
        name: typeof body.name === 'string' ? body.name : t('router.medication'),
        dosage: typeof body.dosage === 'string' ? body.dosage : '',
        instructions: typeof body.instructions === 'string' ? body.instructions : null,
        active: true,
        schedules: [
          {
            id: `schedule-${Date.now()}`,
            minuteOfDay: Number(body.minuteOfDay ?? 9 * 60),
            daysOfWeek: Array.isArray(body.daysOfWeek)
              ? (body.daysOfWeek as number[])
              : [0, 1, 2, 3, 4, 5, 6],
            graceMinutes: Number(body.graceMinutes ?? 60),
            active: true,
          },
        ],
      };
      web.medications.push(created);
      return { status: 201, body: created };
    }
    return { status: 200, body: web.medications };
  }
  if (pathname === '/medications/doses') return { status: 200, body: doses(search) };
  if (/^\/medications\/doses\/[^/]+$/.test(pathname)) {
    const id = pathname.split('/')[3] ?? '';
    const status = typeof body.status === 'string' ? body.status : 'TAKEN';
    web.doseChanges.set(id, {
      status,
      confirmedAt: status === 'TAKEN' ? iso() : null,
      note: typeof body.note === 'string' ? body.note : null,
    });
    return { status: 200, body: { id, status } };
  }
  if (pathname === '/cameras/recordings') return { status: 200, body: [] };
  if (pathname === '/system/update' || pathname === '/system/update/check')
    return { status: 200, body: updateStatus() };
  if (
    pathname.startsWith('/system/update/') ||
    pathname.startsWith('/residents/') ||
    /^\/cameras\/[^/]+\/live-session$/.test(pathname) ||
    pathname === '/auth/change-password' ||
    pathname === '/auth/login' ||
    pathname.startsWith('/auth/bootstrap') ||
    (pathname === '/screen/google' && method !== 'GET')
  )
    return unavailable();

  if (pathname === '/screen/host' || pathname === '/screen/host/pair')
    return { status: 200, body: { installed: true, paired: true, hostname: 'elise' } };
  if (pathname === '/screen/tv-guide') return { status: 200, body: tvGuide() };
  if (pathname === '/screen/tv/scan' || pathname === '/screen/tv/select')
    return { status: 200, body: mockDemoRequest<unknown>('/screen/tv') };
  if (pathname === '/screen/youtube/account')
    return {
      status: 200,
      body: { configured: false, connected: false, email: null, channelTitle: null },
    };
  if (pathname === '/screen/youtube/playlists') return { status: 200, body: [] };
  if (/^\/screen\/media\/[^/]+$/.test(pathname) && method !== 'DELETE') {
    const media = state.screen.state.media.find((item) => item.id === pathname.split('/')[3]);
    if (media) Object.assign(media, body);
    return { status: 200, body: state.screen };
  }
  if (/^\/screen\/calls\/[^/]+$/.test(pathname) && method === 'DELETE')
    return { status: 200, body: { accepted: true } };
  if (pathname === '/cameras/network-discovery') return { status: 200, body: [] };
  if (
    pathname.startsWith('/screen/youtube/') ||
    /^\/screen\/calls\/[^/]+\/join$/.test(pathname) ||
    pathname === '/cameras/network' ||
    pathname.startsWith('/screen-device/')
  )
    return unavailable();

  try {
    const answer = mockDemoRequest<unknown>(
      path,
      rawBody === undefined ? { method } : { method, body: rawBody },
    );
    return { status: answer === undefined ? 204 : 200, body: answer };
  } catch (error) {
    if (error instanceof DemoRouteNotFound)
      return { status: 404, body: { message: error.message } };
    throw error;
  }
}
