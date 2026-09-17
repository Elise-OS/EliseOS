import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityService } from './activity.service';

describe('ActivityService analytics', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z')));

  it('creates complete hourly buckets and room totals', async () => {
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          timezone: 'Europe/Paris',
          organizationId: 'org-1',
          rooms: [{ id: 'room-1', name: 'Salon', kind: 'LIVING_ROOM', floor: 0, sortOrder: 0 }],
          primaryResident: null,
          learningStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      observationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'event-1',
            capability: 'motion',
            quality: 'good',
            payload: { active: true },
            occurredAt: new Date('2026-08-02T10:10:00.000Z'),
            roomId: 'room-1',
            room: { id: 'room-1', name: 'Salon' },
            sensorId: 'sensor-1',
            sensor: {
              id: 'sensor-1',
              entityId: 'binary_sensor.salon',
              deviceId: 'device-1',
              sourceName: 'Mouvement salon',
              status: 'ONLINE',
              unit: null,
              room: { id: 'room-1', name: 'Salon' },
              device: { id: 'device-1', name: 'Capteur salon', displayName: null },
            },
          },
          {
            id: 'event-2',
            capability: 'contact',
            quality: 'good',
            payload: { value: true },
            occurredAt: new Date('2026-08-02T10:25:00.000Z'),
            roomId: 'room-1',
            room: { id: 'room-1', name: 'Salon' },
            sensorId: 'sensor-2',
            sensor: {
              id: 'sensor-2',
              entityId: 'binary_sensor.porte_salon',
              deviceId: 'device-2',
              sourceName: 'Porte salon',
              status: 'ONLINE',
              unit: null,
              room: { id: 'room-1', name: 'Salon' },
              device: { id: 'device-2', name: 'Porte salon', displayName: null },
            },
          },
        ]),
      },
      roomPresenceSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'session-1',
            roomId: 'room-1',
            room: { id: 'room-1', name: 'Salon' },
            startedAt: new Date('2026-08-02T10:00:00.000Z'),
            lastConfirmedAt: new Date('2026-08-02T10:20:00.000Z'),
            endedAt: new Date('2026-08-02T10:30:00.000Z'),
            state: 'CLOSED',
            confidence: 'HIGH',
            excludedFromLearning: false,
            source: 'SENSOR',
          },
        ]),
      },
      sensor: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sensor-1',
            entityId: 'binary_sensor.salon',
            deviceId: 'device-1',
            roomId: 'room-1',
            capability: 'motion',
            available: true,
            status: 'ONLINE',
            room: { id: 'room-1', name: 'Salon' },
            device: { id: 'device-1', enabled: true },
          },
        ]),
      },
      camera: { findMany: vi.fn().mockResolvedValue([]) },
      homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const result = await new ActivityService(prisma as never).summary(
      'user-1',
      '24h',
      '2026-08-02',
    );

    expect(result.buckets).toHaveLength(24);
    expect(result.total).toBe(2);
    expect(result.byRoom).toEqual([{ id: 'room-1', name: 'Salon', count: 2 }]);
    expect(result.byCapability).toEqual([
      { capability: 'motion', count: 1 },
      { capability: 'contact', count: 1 },
    ]);
    expect(result.dwellByRoom).toEqual([
      expect.objectContaining({ id: 'room-1', totalSeconds: 1_800, medianSeconds: 1_800 }),
    ]);
    expect(result.reliableBuckets.some((bucket) => bucket.seconds === 1_800)).toBe(true);
    expect(result.lastReliableActivity).toMatchObject({ roomName: 'Salon', capability: 'contact' });
    expect(result.rooms[0]).toMatchObject({ id: 'room-1', state: 'OBSERVED' });
  });

  it('uses the home calendar day across a daylight-saving transition', async () => {
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          timezone: 'Europe/Paris',
          rooms: [],
          primaryResident: null,
          learningStartedAt: null,
        }),
      },
      observationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      roomPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
      sensor: { findMany: vi.fn().mockResolvedValue([]) },
      camera: { findMany: vi.fn().mockResolvedValue([]) },
      homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    const result = await new ActivityService(prisma as never).summary(
      'user-1',
      '24h',
      '2026-03-29',
    );

    expect(result.reliableBuckets).toHaveLength(23);
    expect(new Date(result.to).getTime() - new Date(result.from).getTime()).toBe(23 * 3_600_000);
  });

  it('keeps every configured room, aggregates environment readings and excludes cameras', async () => {
    const room = { id: 'salon', name: 'Salon', kind: 'LIVING_ROOM', floor: 0, sortOrder: 0 };
    const bedroom = { id: 'chambre', name: 'Chambre', kind: 'BEDROOM', floor: 1, sortOrder: 0 };
    const sensor = (id: string, entityId: string, capability: string, deviceId = id) => ({
      id,
      entityId,
      deviceId,
      capability,
      sourceName: id,
      status: 'ONLINE',
      unit: capability === 'temperature' ? '°C' : null,
      available: true,
      roomId: room.id,
      room,
      device: { id: deviceId, name: id, displayName: null, enabled: true },
    });
    const motion = sensor('motion', 'binary_sensor.motion', 'motion');
    const temperature = sensor('temperature', 'sensor.temperature', 'temperature');
    const cameraPresence = sensor(
      'camera-presence',
      'binary_sensor.camera_person',
      'person_presence',
      'camera-device',
    );
    const event = (
      id: string,
      capability: string,
      occurredAt: string,
      source: ReturnType<typeof sensor>,
      payload: Record<string, unknown>,
      assigned = true,
    ) => ({
      id,
      capability,
      quality: 'good',
      payload,
      occurredAt: new Date(occurredAt),
      roomId: assigned ? room.id : null,
      room: assigned ? room : null,
      sensorId: source.id,
      sensor: assigned ? source : { ...source, roomId: null, room: null },
    });
    const plan = {
      schemaVersion: 4,
      revision: 1,
      configured: true,
      levels: [
        {
          id: 'ground',
          name: 'Rez-de-chaussée',
          floor: 0,
          order: 0,
          width: 800,
          height: 600,
          scaleCmPerUnit: null,
          rooms: [
            {
              id: room.id,
              name: room.name,
              kind: room.kind,
              geometry: {
                x: 0,
                y: 0,
                width: 400,
                height: 300,
                color: '#E8F0F3',
                points: [
                  { x: 0, y: 0 },
                  { x: 400, y: 0 },
                  { x: 400, y: 300 },
                ],
              },
            },
          ],
          openings: [],
          stairs: [
            {
              id: 'stair-1',
              fromFloorId: 'ground',
              toFloorId: 'first',
              fromRoomId: room.id,
              toRoomId: bedroom.id,
              x: 100,
              y: 100,
              width: 100,
              height: 200,
              rotation: 0,
            },
          ],
          items: [],
        },
        {
          id: 'first',
          name: 'Étage',
          floor: 1,
          order: 1,
          width: 800,
          height: 600,
          scaleCmPerUnit: null,
          rooms: [
            {
              id: bedroom.id,
              name: bedroom.name,
              kind: bedroom.kind,
              geometry: {
                x: 0,
                y: 0,
                width: 400,
                height: 300,
                color: '#F5EADB',
                points: [
                  { x: 0, y: 0 },
                  { x: 400, y: 0 },
                  { x: 400, y: 300 },
                ],
              },
            },
          ],
          openings: [],
          stairs: [],
          items: [],
        },
      ],
      placements: [],
      connections: [],
    };
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          timezone: 'Europe/Paris',
          rooms: [room, bedroom],
          primaryResident: null,
          learningStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      observationEvent: {
        findMany: vi.fn().mockResolvedValue([
          event('temperature-1', 'temperature', '2026-08-02T08:00:00.000Z', temperature, {
            value: 18,
            unit: '°C',
          }),
          event('motion-1', 'motion', '2026-08-02T09:00:00.000Z', motion, { active: true }),
          event('temperature-2', 'temperature', '2026-08-02T10:00:00.000Z', temperature, {
            value: 21,
            unit: '°C',
          }),
          event('camera-1', 'person_presence', '2026-08-02T10:05:00.000Z', cameraPresence, {
            active: true,
          }),
          event(
            'unassigned-1',
            'motion',
            '2026-08-02T10:10:00.000Z',
            motion,
            { active: true },
            false,
          ),
          event('stair-event', 'motion', '2026-08-02T10:15:00.000Z', motion, {
            active: true,
            context: { roomId: room.id, targetType: 'STAIR', targetId: 'stair-1' },
          }),
        ]),
      },
      roomPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
      sensor: { findMany: vi.fn().mockResolvedValue([motion, temperature, cameraPresence]) },
      camera: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { personEntityId: cameraPresence.entityId, deviceId: 'camera-device' },
          ]),
      },
      homePlan: { findUnique: vi.fn().mockResolvedValue({ data: plan }) },
    };

    const result = await new ActivityService(prisma as never).summary(
      'user-1',
      '24h',
      '2026-08-02',
    );

    expect(result.total).toBe(2);
    expect(result.lastReliableActivity?.id).toBe('stair-event');
    expect(result.rooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'salon', state: 'OBSERVED', sensorCount: 2 }),
        expect.objectContaining({ id: 'chambre', state: 'NOT_EQUIPPED', sensorCount: 0 }),
      ]),
    );
    expect(result.rooms.find(({ id }) => id === 'salon')?.environment[0]).toMatchObject({
      capability: 'temperature',
      latestValue: '21',
      minimum: 18,
      maximum: 21,
    });
    expect(
      result.sequences.flatMap(({ events }) => events).some(({ id }) => id === 'camera-1'),
    ).toBe(false);
    expect(result.sequences.flatMap(({ passages }) => passages)).toContainEqual(
      expect.objectContaining({ fromLevelName: 'Rez-de-chaussée', toLevelName: 'Étage' }),
    );
  });

  it('never reports normal reassurance when no sensor is installed', async () => {
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          name: 'Maison',
          type: 'HOUSE',
          timezone: 'Europe/Paris',
          learningStartedAt: new Date('2026-07-01T00:00:00.000Z'),
          primaryResident: null,
          rooms: [],
        }),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', displayName: 'Paul Test' }),
      },
      observationEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      alert: { count: vi.fn().mockResolvedValue(0) },
      sensor: { findMany: vi.fn().mockResolvedValue([]) },
      visit: { findFirst: vi.fn().mockResolvedValue(null) },
      appointment: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const result = await new ActivityService(prisma as never).overview('user-1');

    expect(result.reassurance).toBe('INSUFFICIENT_DATA');
    expect(prisma.observationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ capability: { not: 'illuminance' } }),
      }),
    );
  });

  it('confirms a room routine only after coverage, 14 days and 10 reliable sessions', async () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      id: `session-${index}`,
      roomId: 'room-1',
      room: { id: 'room-1', name: 'Salon' },
      startedAt: new Date(`2026-07-${String(20 + index).padStart(2, '0')}T08:00:00.000Z`),
      endedAt: new Date(`2026-07-${String(20 + index).padStart(2, '0')}T08:30:00.000Z`),
      durationSeconds: 1_800,
      state: 'CLOSED',
      confidence: 'HIGH',
      excludedFromLearning: false,
    }));
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          timezone: 'Europe/Paris',
          learningStartedAt: new Date('2026-07-01T00:00:00.000Z'),
          rooms: [{ id: 'room-1', name: 'Salon' }],
          primaryResident: null,
        }),
      },
      roomPresenceSession: { findMany: vi.fn().mockResolvedValue(sessions) },
      sensor: { findMany: vi.fn().mockResolvedValue([{ status: 'ONLINE' }]) },
      configurationRevision: { findFirst: vi.fn().mockResolvedValue(null) },
      camera: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new ActivityService(prisma as never).routines('user-1');

    expect(result.coverageSufficient).toBe(true);
    expect(result.behavioralAlertsEnabled).toBe(false);
    expect(result.rooms[0]).toMatchObject({ status: 'CONFIRMED', medianSeconds: 1_800 });
  });

  it('loads only the latest event for each household sensor', async () => {
    const sensor = {
      id: 'sensor-1',
      entityId: 'sensor.temperature',
      capability: 'temperature',
      compatibility: 'VALIDATED',
      available: true,
      status: 'ONLINE',
      lastSeenAt: new Date('2026-08-03T11:59:00.000Z'),
      device: { name: 'Thermomètre', manufacturer: 'Test', model: 'T1' },
    };
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          organizationId: 'org-1',
          name: 'Maison',
          timezone: 'Europe/Paris',
          type: 'HOUSE',
          address: null,
          floorCount: 1,
          installationStatus: 'ACTIVE',
          learningStartedAt: null,
          primaryResidentId: null,
          residents: [],
          trustedContacts: [],
          rooms: [
            {
              id: 'room-1',
              name: 'Salon',
              kind: 'LIVING_ROOM',
              floor: 0,
              sortOrder: 0,
              sensors: [sensor],
            },
          ],
        }),
      },
      caregiverProfile: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: 'event-1', sensorId: sensor.id, payload: { value: 21.5 } }]),
    };

    const result = await new ActivityService(prisma as never).household('user-1');

    expect(result.rooms[0]?.sensors[0]?.lastValue).toEqual({ value: 21.5 });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    const householdQuery = prisma.home.findFirst.mock.calls[0]?.[0] as {
      include?: { rooms?: { include?: { sensors?: unknown } } };
    };
    expect(householdQuery.include?.rooms?.include?.sensors).toEqual({
      orderBy: { entityId: 'asc' },
      include: { device: true },
    });
  });
});
