import { describe, expect, it } from 'vitest';
import { buildHomeCards, buildSleepSummary, latestPresenceEvidence } from './home-summary';
import type { HomePlan } from '@michel/contracts';
const room = { id: 'wc', kind: 'TOILET', name: 'Toilettes' };
const bathroom = { id: 'bathroom', kind: 'BATHROOM', name: 'Salle de bain' };
const event = (active: boolean, hour = 10) => ({
  sensorId: 'pir',
  roomId: 'wc',
  capability: 'motion',
  payload: { active },
  quality: 'good',
  occurredAt: new Date(`2026-09-15T${hour}:00:00Z`),
});
const sensor = {
  id: 'pir',
  deviceId: null,
  roomId: 'wc',
  capability: 'motion',
  status: 'ONLINE',
  available: true,
  events: [event(false)],
};
const humidityAt = (minute: number) =>
  new Date(`2026-09-15T10:${String(minute).padStart(2, '0')}:00Z`);
const humidityEvent = (value: number, minute: number) => ({
  sensorId: 'bath-humidity',
  roomId: 'bathroom',
  capability: 'humidity',
  payload: { value, unit: '%' },
  quality: 'good',
  occurredAt: humidityAt(minute),
});
const humiditySensor = (latest: ReturnType<typeof humidityEvent>, extra = {}) => ({
  id: 'bath-humidity',
  deviceId: 'bath-device',
  roomId: 'bathroom',
  capability: 'humidity',
  status: 'ONLINE',
  available: true,
  unit: '%',
  events: [latest],
  ...extra,
});
const bedroom = { id: 'bedroom', kind: 'BEDROOM', name: 'Chambre' };
const bedEvent = (open: boolean, occurredAt: string) => ({
  sensorId: 'bed-contact',
  roomId: 'bedroom',
  capability: 'contact',
  payload: { open },
  quality: 'good',
  occurredAt: new Date(occurredAt),
});
const bedPlan = (bedOccupiedWhen: 'CLOSED' | 'OPEN' = 'CLOSED') =>
  ({
    levels: [{ items: [], rooms: [{ ...bedroom, geometry: { color: null } }] }],
    placements: [
      {
        kind: 'SENSOR',
        equipmentId: 'bed-device',
        equipmentRefKind: 'DEVICE',
        roomId: 'bedroom',
        capabilityBindings: [
          { sensorId: 'bed-contact', capability: 'contact', role: 'BED', bedOccupiedWhen },
        ],
      },
    ],
  }) as unknown as HomePlan;
const bedSensor = (latest: ReturnType<typeof bedEvent>, status = 'ONLINE') => ({
  id: 'bed-contact',
  deviceId: 'bed-device',
  roomId: 'bedroom',
  capability: 'contact',
  status,
  available: status === 'ONLINE',
  events: [latest],
});

describe('bed landmarks', () => {
  const now = new Date('2026-09-15T06:10:00Z');

  it('confirms bedtime across midnight and wake-up after a sustained exit', () => {
    const events = [
      bedEvent(true, '2026-09-14T19:00:00Z'),
      bedEvent(false, '2026-09-14T20:30:00Z'),
      bedEvent(true, '2026-09-15T01:00:00Z'),
      bedEvent(false, '2026-09-15T01:10:00Z'),
      bedEvent(true, '2026-09-15T05:30:00Z'),
    ];
    expect(
      buildSleepSummary(
        [bedSensor(events.at(-1)!)],
        events,
        [],
        bedPlan(),
        [bedroom],
        'Europe/Paris',
        now,
      ),
    ).toMatchObject({
      configured: true,
      available: true,
      occupied: false,
      bedtimeAt: '2026-09-14T20:30:00.000Z',
      wakeAt: '2026-09-15T05:30:00.000Z',
    });
    expect(buildHomeCards([bedSensor(events.at(-1)!)], events, bedPlan(), [bedroom]).cards).toEqual(
      [],
    );
  });

  it('keeps yesterday evening bedtime and today wake-up after tonight has started', () => {
    const events = [
      bedEvent(true, '2026-09-14T18:00:00Z'),
      bedEvent(false, '2026-09-14T20:00:00Z'),
      bedEvent(true, '2026-09-15T05:00:00Z'),
      bedEvent(true, '2026-09-15T18:00:00Z'),
      bedEvent(false, '2026-09-15T20:00:00Z'),
    ];
    expect(
      buildSleepSummary(
        [bedSensor(events.at(-1)!)],
        events,
        [],
        bedPlan(),
        [bedroom],
        'Europe/Paris',
        new Date('2026-09-15T20:30:00Z'),
      ),
    ).toMatchObject({
      configured: true,
      available: true,
      occupied: true,
      bedtimeAt: '2026-09-14T20:00:00.000Z',
      wakeAt: '2026-09-15T05:00:00.000Z',
    });
  });

  it('waits through a brief exit and accepts reversed wiring', () => {
    const events = [
      bedEvent(false, '2026-09-14T19:00:00Z'),
      bedEvent(true, '2026-09-14T20:00:00Z'),
      bedEvent(false, '2026-09-15T05:55:00Z'),
    ];
    expect(
      buildSleepSummary(
        [bedSensor(events.at(-1)!)],
        events,
        [],
        bedPlan('OPEN'),
        [bedroom],
        'Europe/Paris',
        now,
      ),
    ).toMatchObject({
      bedtimeAt: '2026-09-14T20:00:00.000Z',
      wakeAt: null,
      occupied: false,
    });
    const shortVisit = [
      bedEvent(false, '2026-09-14T19:00:00Z'),
      bedEvent(true, '2026-09-14T20:00:00Z'),
      bedEvent(false, '2026-09-14T20:10:00Z'),
    ];
    expect(
      buildSleepSummary(
        [bedSensor(shortVisit.at(-1)!)],
        shortVisit,
        [],
        bedPlan('OPEN'),
        [bedroom],
        'Europe/Paris',
        now,
      ).bedtimeAt,
    ).toBeNull();
  });

  it('keeps historical landmarks if the contact goes offline', () => {
    const events = [
      bedEvent(true, '2026-09-14T19:00:00Z'),
      bedEvent(false, '2026-09-14T20:30:00Z'),
      bedEvent(true, '2026-09-15T05:30:00Z'),
    ];
    expect(
      buildSleepSummary(
        [bedSensor(events.at(-1)!, 'OFFLINE')],
        events,
        [],
        bedPlan(),
        [bedroom],
        'Europe/Paris',
        now,
      ),
    ).toMatchObject({ available: false, occupied: null, wakeAt: '2026-09-15T05:30:00.000Z' });
    expect(buildSleepSummary([], [], [], null, [bedroom], 'Europe/Paris', now)).toMatchObject({
      roomId: 'bedroom',
      configured: false,
    });
  });

  it('keeps the first bedtime and waits until the final morning exit', () => {
    const beforeReturn = [
      bedEvent(true, '2026-09-14T19:00:00Z'),
      bedEvent(false, '2026-09-14T20:00:00Z'),
      bedEvent(true, '2026-09-15T03:00:00Z'),
      bedEvent(false, '2026-09-15T03:45:00Z'),
    ];
    expect(
      buildSleepSummary(
        [bedSensor(beforeReturn.at(-1)!)],
        beforeReturn,
        [],
        bedPlan(),
        [bedroom],
        'Europe/Paris',
        new Date('2026-09-15T03:50:00Z'),
      ),
    ).toMatchObject({ bedtimeAt: '2026-09-14T20:00:00.000Z', wakeAt: null });

    const finalExit = [...beforeReturn, bedEvent(true, '2026-09-15T06:00:00Z')];
    expect(
      buildSleepSummary(
        [bedSensor(finalExit.at(-1)!)],
        finalExit,
        [],
        bedPlan(),
        [bedroom],
        'Europe/Paris',
        new Date('2026-09-15T06:40:00Z'),
      ),
    ).toMatchObject({
      bedtimeAt: '2026-09-14T20:00:00.000Z',
      wakeAt: '2026-09-15T06:00:00.000Z',
    });
  });

  it('does not invent a bedtime from the first state reported after pairing', () => {
    const first = bedEvent(false, '2026-09-14T20:30:00Z');
    expect(
      buildSleepSummary([bedSensor(first)], [first], [], bedPlan(), [bedroom], 'Europe/Paris', now)
        .bedtimeAt,
    ).toBeNull();
  });
});
describe('home daily facts', () => {
  it('distinguishes a passage from a negative motion event', () => {
    expect(buildHomeCards([sensor], [event(false)], null, [room]).cards[0]?.observedToday).toBe(
      false,
    );
    expect(
      buildHomeCards([sensor], [event(true), event(false, 11)], null, [room]).cards[0]
        ?.observedToday,
    ).toBe(true);
    expect(
      buildHomeCards(
        [sensor],
        [event(true), event(true, 11), event(false, 12), event(true, 13)],
        null,
        [room],
      ).cards[0]?.countToday,
    ).toBe(2);
  });
  it('keeps historical evidence when a sensor becomes unavailable', () => {
    const result = buildHomeCards([{ ...sensor, status: 'OFFLINE' }], [event(true)], null, [room]);
    expect(result.cards[0]).toMatchObject({
      available: false,
      observedToday: true,
      countToday: 1,
      state: 'UNKNOWN',
    });
  });
  it('ignores poor quality and unassigned evidence', () => {
    expect(
      buildHomeCards([sensor], [{ ...event(true), quality: 'degraded' }], null, [room])
        .activityRooms,
    ).toEqual([]);
    expect(
      buildHomeCards([{ ...sensor, roomId: null }], [event(true)], null, [room]).cards,
    ).toEqual([]);
  });
  it('uses the full day rather than a limited feed', () => {
    const events = [event(true), ...Array.from({ length: 600 }, () => event(false, 11))];
    expect(buildHomeCards([sensor], events, null, [room]).cards[0]?.observedToday).toBe(true);
  });
  it('deduplicates contact states and retains an opening after closure', () => {
    const opening = (open: boolean, hour: number) => ({
      ...event(open, hour),
      capability: 'contact',
      payload: { open },
    });
    const result = buildHomeCards(
      [{ ...sensor, capability: 'contact', events: [opening(false, 13)] }],
      [opening(true, 10), opening(true, 11), opening(false, 13)],
      null,
      [room],
    );
    expect(result.cards[0]).toMatchObject({
      observedToday: true,
      countToday: 1,
      state: 'INACTIVE',
      lastObservedAt: '2026-09-15T10:00:00.000Z',
    });
  });
  it('interprets temperature only through configured thresholds', () => {
    const latest = { ...event(false), capability: 'temperature', payload: { value: 35 } };
    expect(
      buildHomeCards([{ ...sensor, capability: 'temperature', events: [latest] }], [], null, [room])
        .cards[0],
    ).toMatchObject({ kind: 'COMFORT', state: 'ACTIVE' });
  });

  it('keeps the latest configured readings grouped by room', () => {
    const readings = buildHomeCards(
      [
        {
          ...sensor,
          capability: 'temperature',
          unit: '°C',
          events: [{ ...event(false), payload: { value: 21.4, unit: '°C' } }],
        },
        {
          ...sensor,
          id: 'humidity',
          capability: 'humidity',
          events: [{ ...event(false), payload: { value: 48, unit: '%' } }],
        },
      ],
      [],
      null,
      [{ id: 'wc', kind: 'TOILET', name: 'Toilettes' }],
    );
    const roomSummary = readings.roomSummaries.find((item) => item.roomId === 'wc');
    expect(roomSummary?.sensors.find((item) => item.capability === 'temperature')).toMatchObject({
      value: 21.4,
      unit: '°C',
    });
    expect(roomSummary?.sensors.find((item) => item.capability === 'humidity')).toMatchObject({
      value: 48,
      unit: '%',
    });
  });

  it('detects a confirmed humidity rise as a shower in progress', () => {
    const readings = [
      humidityEvent(45, 0),
      humidityEvent(46, 5),
      humidityEvent(55, 10),
      humidityEvent(58, 15),
    ];
    const result = buildHomeCards(
      [humiditySensor(readings.at(-1)!)],
      readings,
      null,
      [bathroom],
      undefined,
      humidityAt(15),
    );
    expect(result.roomSummaries[0]?.shower).toMatchObject({
      state: 'IN_PROGRESS',
      currentHumidity: 58,
      startedAt: humidityAt(10).toISOString(),
    });
    expect(result.roomSummaries[0]?.shower?.risePercent).toBeGreaterThanOrEqual(8);
  });

  it('closes the shower after humidity returns near its baseline', () => {
    const readings = [
      humidityEvent(45, 0),
      humidityEvent(46, 5),
      humidityEvent(55, 10),
      humidityEvent(58, 15),
      humidityEvent(60, 20),
      humidityEvent(48, 30),
      humidityEvent(47, 35),
    ];
    const result = buildHomeCards(
      [humiditySensor(readings.at(-1)!)],
      readings,
      null,
      [bathroom],
      undefined,
      humidityAt(35),
    );
    expect(result.roomSummaries[0]?.shower).toMatchObject({
      state: 'COMPLETED',
      startedAt: humidityAt(10).toISOString(),
      endedAt: humidityAt(30).toISOString(),
      durationMinutes: 20,
    });
  });

  it('does not call a small humidity fluctuation a shower', () => {
    const readings = [
      humidityEvent(45, 0),
      humidityEvent(46, 5),
      humidityEvent(51, 10),
      humidityEvent(47, 15),
    ];
    const result = buildHomeCards(
      [humiditySensor(readings.at(-1)!)],
      readings,
      null,
      [bathroom],
      undefined,
      humidityAt(15),
    );
    expect(result.roomSummaries[0]?.shower?.state).toBe('IDLE');
  });

  it('cancels an unconfirmed humidity spike when it falls back', () => {
    const readings = [
      humidityEvent(45, 0),
      humidityEvent(46, 5),
      humidityEvent(55, 10),
      humidityEvent(49, 15),
    ];
    const result = buildHomeCards(
      [humiditySensor(readings.at(-1)!)],
      readings,
      null,
      [bathroom],
      undefined,
      humidityAt(15),
    );
    expect(result.roomSummaries[0]?.shower?.state).toBe('IDLE');
  });

  it('marks a shower detector unavailable when its humidity reading is stale', () => {
    const latest = humidityEvent(58, 15);
    const result = buildHomeCards(
      [humiditySensor(latest)],
      [humidityEvent(45, 0), humidityEvent(46, 5), humidityEvent(55, 10), latest],
      null,
      [bathroom],
      undefined,
      new Date('2026-09-15T11:00:00Z'),
    );
    expect(result.roomSummaries[0]?.shower?.state).toBe('UNAVAILABLE');
  });

  it('exposes the latest active movement as the current location evidence', async () => {
    const db = database();
    db.sensor.findMany.mockResolvedValue([sensor]);
    db.observationEvent.findMany.mockResolvedValue([
      {
        sensorId: 'pir',
        roomId: 'wc',
        capability: 'motion',
        quality: 'good',
        payload: { active: true },
        occurredAt: new Date('2026-09-16T16:20:00.000Z'),
      },
    ]);
    const result = await new ActivityService(db as never).homeSummary('user', unknownPresence);
    expect(result.latestPresence).toEqual({
      roomId: 'wc',
      occurredAt: '2026-09-16T16:20:00.000Z',
      capability: 'motion',
    });
  });

  it('does not keep a closed presence sensor as the current room', () => {
    const salon = {
      ...sensor,
      id: 'salon-r3',
      roomId: 'salon',
      capability: 'occupancy',
      device: { model: 'Multi-function smart presence sensor R3' },
    };
    const toilet = {
      ...sensor,
      id: 'toilet-pir',
      device: { model: 'Wireless motion sensor' },
      capability: 'occupancy',
    };
    const events = [
      {
        ...event(true, 10),
        sensorId: salon.id,
        roomId: salon.roomId,
        capability: 'occupancy',
      },
      {
        ...event(true, 11),
        sensorId: toilet.id,
        capability: 'occupancy',
      },
      {
        ...event(false, 11),
        sensorId: toilet.id,
        capability: 'occupancy',
        occurredAt: new Date('2026-09-15T11:01:00Z'),
      },
    ];
    expect(
      latestPresenceEvidence([salon, toilet], events, new Date('2026-09-15T12:10:00Z')),
    ).toMatchObject({ roomId: 'salon', capability: 'occupancy' });
  });

  it('does not let a recent but closed motion pulse override an active presence sensor', () => {
    const salon = {
      ...sensor,
      id: 'salon-r3',
      roomId: 'salon',
      capability: 'occupancy',
      device: { model: 'Multi-function smart presence sensor R3' },
    };
    const toilet = {
      ...sensor,
      id: 'toilet-pir',
      device: { model: 'Wireless motion sensor' },
      capability: 'occupancy',
    };
    const events = [
      {
        ...event(true, 10),
        sensorId: salon.id,
        roomId: salon.roomId,
        capability: 'occupancy',
      },
      {
        ...event(true, 11),
        sensorId: toilet.id,
        capability: 'occupancy',
      },
      {
        ...event(false, 11),
        sensorId: toilet.id,
        capability: 'occupancy',
        occurredAt: new Date('2026-09-15T11:01:00Z'),
      },
    ];
    expect(
      latestPresenceEvidence([salon, toilet], events, new Date('2026-09-15T11:03:00Z')),
    ).toMatchObject({ roomId: 'salon', capability: 'occupancy' });
  });

  it('uses the newest sensor that is currently active', () => {
    const salon = {
      ...sensor,
      id: 'salon-r3',
      roomId: 'salon',
      capability: 'occupancy',
      device: { model: 'Multi-function smart presence sensor R3' },
    };
    const toilet = {
      ...sensor,
      id: 'toilet-pir',
      device: { model: 'Wireless motion sensor' },
      capability: 'occupancy',
    };
    const events = [
      {
        ...event(true, 10),
        sensorId: salon.id,
        roomId: salon.roomId,
        capability: 'occupancy',
      },
      {
        ...event(true, 11),
        sensorId: toilet.id,
        capability: 'occupancy',
      },
    ];
    expect(latestPresenceEvidence([salon, toilet], events)).toMatchObject({
      roomId: 'wc',
      capability: 'motion',
    });
  });

  it('refreshes continuous presence from another report by the same device', () => {
    const occupancyAt = new Date('2026-09-15T11:00:00Z');
    const deviceSeenAt = new Date('2026-09-15T11:48:00Z');
    const salon = {
      ...sensor,
      id: 'salon-r3',
      roomId: 'salon',
      capability: 'occupancy',
      device: {
        model: 'Multi-function smart presence sensor R3',
        lastSeenAt: deviceSeenAt,
      },
      events: [
        {
          ...event(true, 10),
          sensorId: 'salon-r3',
          roomId: 'salon',
          capability: 'occupancy',
          occurredAt: occupancyAt,
        },
      ],
    };

    expect(latestPresenceEvidence([salon], salon.events)).toMatchObject({
      roomId: 'salon',
      capability: 'occupancy',
      occurredAt: deviceSeenAt,
    });
  });

  it('does not expose device diagnostics in a room card', () => {
    const readings = buildHomeCards(
      [{ ...sensor, capability: 'battery', events: [event(false)] }],
      [],
      null,
      [room],
    );
    expect(readings.roomSummaries[0]?.sensors).toEqual([]);
  });
});

import { vi, afterEach } from 'vitest';
import { ActivityService } from './activity.service';
import { presenceEstimateSchema } from '@michel/contracts';
const unknownPresence = presenceEstimateSchema.parse({
  roomId: null,
  detectedAt: null,
  confidence: 'UNKNOWN',
  identifiedResidentId: null,
  source: 'NONE',
  plausibleTransition: null,
});
const database = () => ({
  home: {
    findFirst: vi.fn().mockResolvedValue({ id: 'home', timezone: 'Europe/Paris', rooms: [room] }),
  },
  sensor: { findMany: vi.fn().mockResolvedValue([]) },
  observationEvent: { findMany: vi.fn().mockResolvedValue([]) },
  homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
  alert: { findMany: vi.fn().mockResolvedValue([]) },
  configurationRevision: { findFirst: vi.fn().mockResolvedValue(null) },
});
describe('home summary access and day boundaries', () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    ['2026-09-15T00:05:00Z', '2026-09-14T22:00:00.000Z'],
    ['2026-03-29T12:00:00Z', '2026-03-28T23:00:00.000Z'],
    ['2026-10-25T12:00:00Z', '2026-10-24T22:00:00.000Z'],
  ])('uses local midnight at %s', async (now, midnight) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const db = database();
    const result = await new ActivityService(db as never).homeSummary('user', unknownPresence);
    expect(result.from).toBe(midnight);
    expect(result.to).toBe(new Date(now).toISOString());
    expect(db.observationEvent.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { sensor: { analysisEnabled: true, removedAt: null } },
    });
    expect(db.observationEvent.findMany.mock.calls[0]?.[0]).not.toHaveProperty('take');
  });
  it('rejects access when the user has no home membership', async () => {
    const db = database();
    db.home.findFirst.mockResolvedValue(null);
    await expect(
      new ActivityService(db as never).homeSummary('outsider', unknownPresence),
    ).rejects.toThrow();
    expect(db.sensor.findMany).not.toHaveBeenCalled();
    expect(db.home.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization: { memberships: { some: { userId: 'outsider', disabledAt: null } } },
        },
      }),
    );
  });

  it('keeps a confirmed room when its latest evidence sensor is online', async () => {
    const db = database();
    db.sensor.findMany.mockResolvedValue([sensor]);
    db.alert.findMany.mockResolvedValue([
      {
        id: 'alert-toilet',
        title: 'Occupancy ne répond plus',
        severity: 'INFO',
        roomId: 'wc',
      },
    ]);
    const confirmedPresence = presenceEstimateSchema.parse({
      roomId: 'wc',
      detectedAt: '2026-09-16T16:16:28.122Z',
      confidence: 'HIGH',
      identifiedResidentId: null,
      source: 'SENSOR',
      plausibleTransition: true,
      trackingState: 'CONFIRMED',
      confirmedRoomId: 'wc',
      trackingDegraded: true,
      evidenceSummary: [
        {
          eventId: 'salon-active',
          sensorId: 'pir',
          roomId: 'wc',
          capability: 'occupancy',
          occurredAt: '2026-09-16T16:16:28.122Z',
          observed: true,
        },
      ],
    });

    const result = await new ActivityService(db as never).homeSummary('user', confirmedPresence);

    expect(result.presence.trackingState).toBe('CONFIRMED');
    expect(result.presence.trackingDegraded).toBe(false);
    expect(result.alert?.roomName).toBe('Toilettes');
  });
});
