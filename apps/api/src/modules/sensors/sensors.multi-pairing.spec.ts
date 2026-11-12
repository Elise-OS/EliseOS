import { describe, expect, it, vi } from 'vitest';
import { SensorsService } from './sensors.service';

/**
 * Several Zigbee devices joined during the same "Add a sensor" search: every one of them
 * must be offered, one after the other, and none may be lost or offered twice.
 * The Prisma double below understands the few filters the onboarding queries use.
 */

type Row = Record<string, unknown>;
type FakeSensor = {
  id: string;
  deviceId: string;
  entityId: string;
  capability: string;
  sourceName: string;
  lastSeenAt: Date;
  removedAt: Date | null;
  [key: string]: unknown;
};
type FakeDevice = {
  id: string;
  homeId: string;
  roomId: string | null;
  protocol: string | null;
  networkIdentifier: string | null;
  createdAt: Date;
  model: string | null;
  [key: string]: unknown;
};
type FakeSession = {
  id: string;
  homeId: string;
  deviceId: string | null;
  protocol: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  [key: string]: unknown;
};

const ROOM = { id: 'room-1', homeId: 'home-1', name: 'Salon', kind: 'LIVING_ROOM' };

const isRecord = (value: unknown): value is Row =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/** Prisma-like scalar filter: equality, `not`, `in`, `notIn`, `gte`, `gt`, `contains`. */
function scalarMatches(value: unknown, filter: unknown): boolean {
  if (!isRecord(filter)) {
    if (filter instanceof Date && value instanceof Date)
      return value.getTime() === filter.getTime();
    return value === filter;
  }
  return Object.entries(filter).every(([operator, expected]) => {
    switch (operator) {
      case 'not':
        return !scalarMatches(value, expected);
      case 'in':
        return (expected as unknown[]).includes(value);
      case 'notIn':
        return !(expected as unknown[]).includes(value);
      case 'gte':
        return value instanceof Date && value >= (expected as Date);
      case 'gt':
        return value instanceof Date && value > (expected as Date);
      case 'lte':
        return value instanceof Date && value <= (expected as Date);
      case 'contains':
        return typeof value === 'string' && value.includes(expected as string);
      default:
        throw new Error(`Unsupported operator ${operator}`);
    }
  });
}

function rowMatches(
  row: Row,
  where: Row | undefined,
  relations: Record<string, () => Row[]>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, filter]) => {
    if (filter === undefined) return true;
    if (key === 'AND') return (filter as Row[]).every((part) => rowMatches(row, part, relations));
    if (key === 'OR') return (filter as Row[]).some((part) => rowMatches(row, part, relations));
    if (key === 'NOT') return !rowMatches(row, filter as Row, relations);
    const relation = relations[key];
    if (relation) {
      const related = relation();
      const { some, none } = filter as { some?: Row; none?: Row };
      if (some) return related.some((item) => rowMatches(item, some, {}));
      if (none) return !related.some((item) => rowMatches(item, none, {}));
      throw new Error(`Unsupported relation filter on ${key}`);
    }
    return scalarMatches(row[key], filter);
  });
}

function fakeHub(options: {
  devices: FakeDevice[];
  sensors: FakeSensor[];
  sessions: FakeSession[];
  joined: () => string[];
  failedInterviews?: () => string[];
  latestJoinAt?: () => Date | null;
}) {
  const { devices, sensors, sessions } = options;
  let created = 0;
  const deviceRelations = (device: FakeDevice) => ({
    sensors: () => sensors.filter((sensor) => sensor.deviceId === device.id),
    onboardingSessions: () => sessions.filter((session) => session.deviceId === device.id),
  });
  const withIncludes = (device: FakeDevice, include?: Row) => {
    if (!include) return { ...device };
    const sensorFilter = isRecord(include.sensors) ? (include.sensors.where as Row) : undefined;
    return {
      ...device,
      room: device.roomId === ROOM.id ? ROOM : null,
      sensors: sensors
        .filter((sensor) => sensor.deviceId === device.id && rowMatches(sensor, sensorFilter, {}))
        .map((sensor) => ({ ...sensor })),
    };
  };
  const findDevices = ({
    where,
    include,
    orderBy,
  }: {
    where?: Row;
    include?: Row;
    orderBy?: { createdAt?: 'asc' | 'desc' };
  }) => {
    const found = devices.filter((device) => rowMatches(device, where, deviceRelations(device)));
    if (orderBy?.createdAt)
      found.sort((a, b) =>
        orderBy.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
    return found.map((device) => withIncludes(device, include));
  };
  const deviceModel = {
    findFirst: vi.fn((query: { where?: Row; include?: Row; orderBy?: Row }) =>
      Promise.resolve(findDevices(query)[0] ?? null),
    ),
    findMany: vi.fn((query: { where?: Row; include?: Row; orderBy?: Row }) =>
      Promise.resolve(findDevices(query)),
    ),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Row }) => {
      const device = devices.find(({ id }) => id === where.id)!;
      Object.assign(device, data);
      return Promise.resolve(device);
    }),
  };
  const sessionModel = {
    findFirst: vi.fn(({ where, include }: { where: Row; include?: { device?: unknown } }) => {
      const session = [...sessions]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .find((candidate) => rowMatches(candidate, where, {}));
      if (!session) return Promise.resolve(null);
      if (!include?.device) return Promise.resolve({ ...session });
      const device = devices.find(({ id }) => id === session.deviceId);
      return Promise.resolve({
        ...session,
        device: device ? withIncludes(device, { sensors: { where: { removedAt: null } } }) : null,
      });
    }),
    findMany: vi.fn(() => Promise.resolve([])),
    count: vi.fn(() => Promise.resolve(0)),
    create: vi.fn(({ data }: { data: Row }) => {
      const session = {
        id: `session-${++created}`,
        deviceId: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
        ...data,
      } as unknown as FakeSession;
      sessions.push(session);
      return Promise.resolve({ ...session });
    }),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Row }) => {
      const session = sessions.find(({ id }) => id === where.id)!;
      Object.assign(session, data);
      return Promise.resolve({ ...session });
    }),
    updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
      const matching = sessions.filter((session) => rowMatches(session, where, {}));
      for (const session of matching) Object.assign(session, data);
      return Promise.resolve({ count: matching.length });
    }),
  };
  const tx = {
    device: deviceModel,
    sensorOnboardingSession: sessionModel,
    room: { findFirst: vi.fn(() => Promise.resolve(ROOM)) },
    homePlan: { findUnique: vi.fn(() => Promise.resolve(null)) },
    sensor: {
      updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
        const matching = sensors.filter((sensor) => rowMatches(sensor, where, {}));
        for (const sensor of matching) Object.assign(sensor, data);
        return Promise.resolve({ count: matching.length });
      }),
    },
    equipmentSyncState: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
  };
  const prisma = {
    ...tx,
    home: { findFirst: vi.fn(() => Promise.resolve({ id: 'home-1' })) },
    $queryRaw: vi.fn(() => Promise.resolve([])),
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const mqtt = {
    zigbeeStatus: vi.fn(() => ({
      online: true,
      pairingOpen: false,
      updatedAt: new Date(),
      pairingResponseAt: null,
      pairingError: null,
    })),
    zigbeeDevicesJoinedSince: vi.fn(() => options.joined()),
    zigbeeInterviewFailedSince: vi.fn(() => (options.failedInterviews?.() ?? []).length > 0),
    zigbeeInterviewFailedDevicesSince: vi.fn(() => options.failedInterviews?.() ?? []),
    zigbeeLatestJoinAt: vi.fn(() => options.latestJoinAt?.() ?? null),
    isZigbeeDeviceJoined: vi.fn(() => true),
    setZigbeePairing: vi.fn(),
  };
  return { service: new SensorsService(prisma as never, mqtt as never), mqtt, sessionModel };
}

const startedAt = new Date(Date.now() - 60_000);
const after = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000);

function zigbeeDevice(
  id: string,
  ieee: string,
  model: string,
  capabilities: string[],
  joinedAfter: number,
  overrides: Partial<FakeDevice> = {},
) {
  const device: FakeDevice = {
    id,
    homeId: 'home-1',
    name: model,
    displayName: null,
    manufacturer: 'SONOFF',
    model,
    protocol: 'zigbee',
    integration: 'zigbee2mqtt',
    networkIdentifier: ieee,
    installationStatus: 'NEEDS_PLACEMENT',
    enabled: true,
    placementConfirmedAt: null,
    placementNote: null,
    roomId: null,
    createdAt: after(joinedAfter),
    ...overrides,
  };
  const sensors: FakeSensor[] = capabilities.map((capability) => ({
    id: `${id}-${capability}`,
    deviceId: id,
    homeId: 'home-1',
    roomId: device.roomId,
    entityId: `sensor.${id}_${capability}`,
    capability,
    sourceName: capability,
    status: 'ONLINE',
    available: true,
    unit: null,
    lastSeenAt: after(joinedAfter + 5),
    analysisEnabled: false,
    classificationSource: 'METADATA',
    classificationConfidence: 1,
    classificationReason: null,
    classificationConfirmedAt: null,
    removedAt: null,
  }));
  return { device, sensors };
}

const waitingSession = (): FakeSession => ({
  id: 'search-1',
  homeId: 'home-1',
  deviceId: null,
  requestedById: 'user-1',
  protocol: 'zigbee',
  status: 'WAITING_FOR_DEVICE',
  step: 'PAIRING',
  errorCode: null,
  errorMessage: null,
  createdAt: startedAt,
  updatedAt: startedAt,
  expiresAt: new Date(Date.now() + 180_000),
});

const install = (name: string) => ({ name, roomId: ROOM.id });

describe('several sensors paired during one search', () => {
  it('offers the three devices joined in one search, one after the other', async () => {
    const motion = zigbeeDevice('motion', '0xa1', 'SNZB-03P', ['motion', 'battery'], 5);
    const contact = zigbeeDevice('contact', '0xa2', 'SNZB-04P', ['contact', 'battery'], 10);
    const climate = zigbeeDevice('climate', '0xa3', 'SNZB-02P', ['temperature', 'humidity'], 15);
    const all = [motion, contact, climate];
    const devices = all.map(({ device }) => device);
    const sessions = [waitingSession()];
    const { service, mqtt } = fakeHub({
      devices,
      sensors: all.flatMap(({ sensors }) => sensors),
      sessions,
      joined: () => ['0xa1', '0xa2', '0xa3'],
    });

    const found = await service.onboarding('user-1', 'search-1');
    expect(found.status).toBe('DEVICE_FOUND');
    // The field older apps read is still there, with one device.
    const first = found.detectedDevice!.id;
    expect(found.pendingDevices?.map(({ id }) => id).sort()).toEqual(
      ['motion', 'contact', 'climate'].filter((id) => id !== first).sort(),
    );
    expect(found.pendingDevices?.every(({ detectedType }) => !!detectedType)).toBe(true);
    expect(mqtt.setZigbeePairing).toHaveBeenCalledWith(false, 0);

    const offered = [first];
    let current = found;
    for (let round = 0; round < 2; round += 1) {
      const done = await service.completeOnboarding('user-1', current.id, install(`S${round}`));
      expect(done.nextSession).toMatchObject({ status: 'DEVICE_FOUND' });
      current = done.nextSession!;
      expect(offered).not.toContain(current.detectedDevice!.id);
      expect(current.pendingDevices).toHaveLength(1 - round);
      offered.push(current.detectedDevice!.id);
      // The app can come back later: the next device is the current installation.
      await expect(service.currentOnboarding('user-1')).resolves.toMatchObject({
        id: current.id,
        detectedDevice: { id: current.detectedDevice!.id },
      });
    }
    const last = await service.completeOnboarding('user-1', current.id, install('S2'));
    expect(last.nextSession).toBeNull();

    expect(offered.sort()).toEqual(['climate', 'contact', 'motion']);
    expect(devices.every(({ roomId }) => roomId === ROOM.id)).toBe(true);
    expect(sessions.filter(({ status }) => status === 'COMPLETED')).toHaveLength(3);
    // Pairing was never reopened for the follow-ups.
    expect(mqtt.setZigbeePairing).not.toHaveBeenCalledWith(true, expect.anything());
    await expect(service.currentOnboarding('user-1')).resolves.toBeNull();
  });

  it('does not queue an installed device that rejoins during the search', async () => {
    const known = zigbeeDevice('known', '0xb1', 'SNZB-03P', ['motion'], 0, {
      roomId: ROOM.id,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const fresh = zigbeeDevice('fresh', '0xb2', 'SNZB-04P', ['contact'], 10);
    const sessions = [waitingSession()];
    const { service } = fakeHub({
      devices: [known.device, fresh.device],
      sensors: [...known.sensors, ...fresh.sensors],
      sessions,
      joined: () => ['0xb1', '0xb2'],
    });

    const found = await service.onboarding('user-1', 'search-1');
    expect(found.detectedDevice?.id).toBe('fresh');
    expect(found.pendingDevices).toEqual([]);
    const done = await service.completeOnboarding('user-1', found.id, install('Porte'));
    expect(done.nextSession).toBeNull();
  });

  it('waits for a device still finishing its interview once the first one is installed', async () => {
    const motion = zigbeeDevice('motion', '0xc1', 'SNZB-03P', ['motion'], 5);
    // Joined, but its interview has only exposed the battery so far.
    const slow = zigbeeDevice('slow', '0xc2', 'SNZB-02P', ['battery'], 20);
    const sensors = [...motion.sensors, ...slow.sensors];
    const sessions = [waitingSession()];
    const { service } = fakeHub({
      devices: [motion.device, slow.device],
      sensors,
      sessions,
      joined: () => ['0xc1', '0xc2'],
      latestJoinAt: () => after(20),
    });

    const found = await service.onboarding('user-1', 'search-1');
    expect(found.detectedDevice?.id).toBe('motion');
    expect(found.pendingDevices).toEqual([]);

    const done = await service.completeOnboarding('user-1', found.id, install('Mouvement'));
    expect(done.nextSession).toMatchObject({ status: 'WAITING_FOR_DEVICE', detectedDevice: null });
    const followUp = done.nextSession!;

    // Still interviewing: the installed motion sensor is not offered again.
    await expect(service.onboarding('user-1', followUp.id)).resolves.toMatchObject({
      status: 'WAITING_FOR_DEVICE',
    });

    sensors.push({
      ...slow.sensors[0]!,
      id: 'slow-temperature',
      capability: 'temperature',
      entityId: 'sensor.slow_temperature',
    });
    const ready = await service.onboarding('user-1', followUp.id);
    expect(ready).toMatchObject({ status: 'DEVICE_FOUND', detectedDevice: { id: 'slow' } });
    const last = await service.completeOnboarding('user-1', ready.id, install('Climat'));
    expect(last.nextSession).toBeNull();
  });

  it('keeps the search going when one device fails its interview but another succeeds', async () => {
    const good = zigbeeDevice('good', '0xd2', 'SNZB-04P', ['contact'], 10);
    const sessions = [waitingSession()];
    const sensors = [] as FakeSensor[];
    const { service } = fakeHub({
      devices: [good.device],
      sensors,
      sessions,
      joined: () => ['0xd1', '0xd2'],
      failedInterviews: () => ['0xd1'],
    });

    // The good device is still interviewing: one failure must not end the search.
    await expect(service.onboarding('user-1', 'search-1')).resolves.toMatchObject({
      status: 'WAITING_FOR_DEVICE',
    });
    sensors.push(...good.sensors);
    await expect(service.onboarding('user-1', 'search-1')).resolves.toMatchObject({
      status: 'DEVICE_FOUND',
      detectedDevice: { id: 'good' },
      pendingDevices: [],
    });
  });

  it('still reports the failure when the only device of the search fails its interview', async () => {
    const sessions = [waitingSession()];
    const { service } = fakeHub({
      devices: [],
      sensors: [],
      sessions,
      joined: () => ['0xe1'],
      failedInterviews: () => ['0xe1'],
    });

    await expect(service.onboarding('user-1', 'search-1')).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERVIEW_FAILED',
    });
  });
});
