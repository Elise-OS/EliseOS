/* eslint-disable @typescript-eslint/require-await -- the in-memory Prisma fake mirrors the async client API. */
import { ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IngestedObservation } from '../sensing/ingestion.service';
import { NightPathService, nightPathTrigger } from './night-path.service';

type Row = Record<string, unknown> & { id: string };
type Light = { entityId: string; roomId: string; state: string; features?: unknown };

const HOME = 'home-1';
// 23:30 in Paris (UTC+1 in winter).
const NIGHT = new Date('2026-12-01T22:30:00.000Z');

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const test = condition as Record<string, unknown>;
      if ('in' in test) return (test.in as unknown[]).includes(value);
      if ('lte' in test) return (value as Date) <= (test.lte as Date);
      if ('gte' in test) return (value as Date) >= (test.gte as Date);
      if ('not' in test) return value !== test.not;
    }
    return value === condition;
  });
}

/** Just enough of Prisma, in memory, for the night path service. */
function fakeDatabase(options: {
  role?: string;
  lights?: Light[];
  events?: Array<{ sensorId: string; roomId: string; payload: unknown; occurredAt: Date }>;
}) {
  const paths: Row[] = [];
  const activations: Row[] = [];
  const audit: Row[] = [];
  const lights = options.lights ?? [];
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const rooms = [
    { id: 'bedroom', name: 'Chambre', kind: 'BEDROOM' },
    { id: 'hallway', name: 'Couloir', kind: 'HALLWAY' },
    { id: 'toilet', name: 'Toilettes', kind: 'TOILET' },
    { id: 'living', name: 'Séjour', kind: 'LIVING_ROOM' },
  ];
  const role = options.role ?? 'OWNER';
  const db = {
    paths,
    activations,
    audit,
    home: {
      findFirst: vi.fn(
        async (args: {
          where: { organization: { memberships: { some: { systemRole?: { in: string[] } } } } };
        }) => {
          const roles = args.where.organization.memberships.some.systemRole?.in;
          return !roles || roles.includes(role) ? { id: HOME, timezone: 'Europe/Paris' } : null;
        },
      ),
      findUnique: vi.fn(async () => ({ timezone: 'Europe/Paris' })),
    },
    room: {
      count: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          rooms.filter(({ id: roomId }) => where.id.in.includes(roomId)).length,
      ),
      findMany: vi.fn(async () => rooms),
    },
    homePlan: { findUnique: vi.fn(async () => null) },
    device: {
      findMany: vi.fn(async () => [
        { roomId: 'bedroom', model: 'SNZB-03P', sensors: [{ capability: 'occupancy' }] },
        ...lights.map((light) => ({
          roomId: light.roomId,
          model: 'FL 230 C',
          sensors: [{ capability: 'light' }],
        })),
      ]),
    },
    sensor: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { capability?: string; OR?: Array<{ roomId?: { in: string[] } }> };
        }) => {
          if (where.capability !== 'light') return [];
          const roomIds = where.OR?.[0]?.roomId?.in ?? [];
          return lights
            .filter((light) => roomIds.includes(light.roomId))
            .map((light) => ({
              entityId: light.entityId,
              available: true,
              device: { enabled: true },
            }));
        },
      ),
    },
    deviceEntity: {
      findMany: vi.fn(async ({ where }: { where: { entityId: { in: string[] } } }) =>
        lights
          .filter((light) => where.entityId.in.includes(light.entityId))
          .map((light) => ({
            entityId: light.entityId,
            state: light.state,
            available: true,
            lightFeatures: light.features ?? null,
          })),
      ),
      findFirst: vi.fn(async ({ where }: { where: { entityId: string } }) => {
        const light = lights.find(({ entityId }) => entityId === where.entityId);
        return light ? { lightFeatures: light.features ?? null } : null;
      }),
    },
    observationEvent: {
      findMany: vi.fn(
        async ({ where }: { where: { roomId: { in: string[] }; occurredAt: { gte: Date } } }) =>
          (options.events ?? [])
            .filter(
              (event) =>
                where.roomId.in.includes(event.roomId) && event.occurredAt >= where.occurredAt.gte,
            )
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
      ),
    },
    nightLightPath: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        paths.filter((path) => matches(path, where)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          paths.find((path) => matches(path, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('path'), createdAt: new Date(), updatedAt: new Date(), ...data };
        paths.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = paths.find((path) => path.id === where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        paths.splice(
          paths.findIndex((path) => path.id === where.id),
          1,
        );
      }),
    },
    nightLightActivation: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        activations.filter((row) => matches(row, where)),
      ),
      findFirst: vi.fn(
        async () =>
          [...activations].sort(
            (a, b) => (a.offAt as Date).getTime() - (b.offAt as Date).getTime(),
          )[0] ?? null,
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          Object.assign(
            activations.find((row) => row.id === where.id)!,
            data,
          );
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          for (const row of activations.filter((item) => matches(item, where)))
            Object.assign(row, data);
        },
      ),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        activations.push({ id: id('activation'), ...create });
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = activations.findIndex((row) => row.id === where.id);
        if (index >= 0) activations.splice(index, 1);
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audit.push({ id: id('audit'), ...data });
      }),
    },
    $transaction: vi.fn(async (task: (tx: unknown) => unknown) => task(db)),
  };
  return db;
}

class TestNightPathService extends NightPathService {
  public clock = NIGHT;
  protected override now() {
    return this.clock;
  }
}

function setup(options: Parameters<typeof fakeDatabase>[0] = {}) {
  const db = fakeDatabase(options);
  type Command = {
    domain: string;
    service: string;
    target: { entity_id: string };
    data?: Record<string, unknown>;
  };
  const commands: Command[] = [];
  const mqtt = {
    executeHomeAssistantCommand: vi.fn((command: Command) => commands.push(command)),
  };
  let listener: ((observation: IngestedObservation) => void) | undefined;
  const ingestion = {
    onIngested: vi.fn((callback: (observation: IngestedObservation) => void) => {
      listener = callback;
      return () => undefined;
    }),
  };
  const service = new TestNightPathService(db as never, ingestion as never, mqtt as never);
  const observe = (overrides: Partial<IngestedObservation> = {}) =>
    service.enqueue(() =>
      service.handleObservation({
        homeId: HOME,
        sensorId: 'sensor-bedroom',
        roomId: 'bedroom',
        capability: 'occupancy',
        quality: 'good',
        payload: { active: true },
        role: 'OCCUPANCY',
        bedOccupiedWhen: null,
        model: 'SNZB-03P',
        enabled: true,
        occurredAt: service.clock,
        ...overrides,
      }),
    );
  const tick = () => service.enqueue(() => service.turnOffDue());
  return { db, service, commands, observe, tick, ingestion, emit: () => listener };
}

const strip = (roomId: string, state = 'off'): Light => ({
  entityId: `light.ruban_${roomId}`,
  roomId,
  state,
  features: {
    brightness: true,
    colorTemperature: true,
    transition: true,
    minKelvin: 1_000,
    maxKelvin: 20_000,
  },
});

const bedroomToToilet = {
  name: 'Chambre → toilettes',
  triggerRoomIds: ['bedroom'],
  lightRoomIds: ['bedroom', 'hallway', 'toilet'],
  startMinute: 22 * 60,
  endMinute: 7 * 60,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('NightPathService', () => {
  it('lights every room of the path, including rooms without a sensor, softly and warmly', async () => {
    const { service, commands, observe } = setup({
      lights: [strip('bedroom'), strip('hallway'), strip('toilet'), strip('living')],
    });
    await service.create('owner', bedroomToToilet);

    await observe();

    expect(commands.map(({ target }) => target.entity_id).sort()).toEqual([
      'light.ruban_bedroom',
      'light.ruban_hallway',
      'light.ruban_toilet',
    ]);
    expect(commands[0]).toMatchObject({
      domain: 'light',
      service: 'turn_on',
      data: { brightness_pct: 25, color_temp_kelvin: 2_200, transition: 2 },
    });
  });

  it('does nothing outside the night window', async () => {
    const { service, commands, observe } = setup({ lights: [strip('hallway')] });
    await service.create('owner', bedroomToToilet);
    service.clock = new Date('2026-12-01T11:00:00.000Z'); // noon in Paris
    await observe();
    service.clock = new Date('2026-12-01T06:30:00.000Z'); // 07:30 in Paris
    await observe();
    expect(commands).toEqual([]);
  });

  it('handles a night window across midnight', async () => {
    const { service, commands, observe } = setup({ lights: [strip('hallway')] });
    await service.create('owner', bedroomToToilet);
    service.clock = new Date('2026-12-02T00:15:00.000Z'); // 01:15 in Paris
    await observe();
    expect(commands).toHaveLength(1);
  });

  it('starts from any of several trigger rooms', async () => {
    const { service, commands, observe } = setup({ lights: [strip('hallway')] });
    await service.create('owner', { ...bedroomToToilet, triggerRoomIds: ['bedroom', 'living'] });
    await observe({ roomId: 'living', sensorId: 'sensor-living' });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.target.entity_id).toBe('light.ruban_hallway');
  });

  it('is not started by movement in a lit room that is not a trigger room', async () => {
    const { service, commands, observe } = setup({ lights: [strip('hallway')] });
    await service.create('owner', bedroomToToilet);
    await observe({ roomId: 'toilet', sensorId: 'sensor-toilet' });
    expect(commands).toEqual([]);
  });

  it('turns the lights off after the delay without movement, not before', async () => {
    const { service, commands, observe, tick, db } = setup({
      lights: [strip('bedroom'), strip('hallway')],
    });
    await service.create('owner', bedroomToToilet);
    await observe();
    commands.length = 0;

    service.clock = new Date(NIGHT.getTime() + 2 * 60_000 + 59_000);
    await tick();
    expect(commands).toEqual([]);

    service.clock = new Date(NIGHT.getTime() + 3 * 60_000);
    await tick();
    expect(commands.map(({ service: action }) => action)).toEqual(['turn_off', 'turn_off']);
    expect(commands[0]?.data).toEqual({ transition: 2 });
    expect(db.activations).toEqual([]);
  });

  it('keeps the path lit while the resident moves along it', async () => {
    const { service, commands, observe, tick } = setup({ lights: [strip('hallway')] });
    await service.create('owner', bedroomToToilet);
    await observe();
    service.clock = new Date(NIGHT.getTime() + 2 * 60_000);
    await observe({ roomId: 'toilet', sensorId: 'sensor-toilet', occurredAt: service.clock });
    commands.length = 0;

    service.clock = new Date(NIGHT.getTime() + 4 * 60_000);
    await tick();
    expect(commands).toEqual([]);

    service.clock = new Date(NIGHT.getTime() + 5 * 60_000);
    await tick();
    expect(commands.map(({ service: action }) => action)).toEqual(['turn_off']);
  });

  it('waits while a presence sensor of the path still reports someone', async () => {
    const { service, commands, observe, tick } = setup({
      lights: [strip('hallway')],
      events: [
        {
          sensorId: 'radar-toilet',
          roomId: 'toilet',
          payload: { active: true },
          occurredAt: new Date(NIGHT.getTime() + 60_000),
        },
      ],
    });
    await service.create('owner', bedroomToToilet);
    await observe();
    commands.length = 0;
    service.clock = new Date(NIGHT.getTime() + 3 * 60_000);
    await tick();
    expect(commands).toEqual([]);
  });

  it('never turns on, nor off, a light the person had already turned on', async () => {
    const { service, commands, observe, tick } = setup({
      lights: [strip('bedroom', 'on'), strip('hallway')],
    });
    await service.create('owner', bedroomToToilet);
    await observe();
    expect(commands.map(({ target }) => target.entity_id)).toEqual(['light.ruban_hallway']);
    commands.length = 0;
    service.clock = new Date(NIGHT.getTime() + 10 * 60_000);
    await tick();
    expect(commands.map(({ target }) => target.entity_id)).toEqual(['light.ruban_hallway']);
  });

  it('drives an on/off only light without brightness, colour or transition', async () => {
    const { service, commands, observe, tick } = setup({
      lights: [
        {
          entityId: 'light.veilleuse',
          roomId: 'hallway',
          state: 'off',
          features: { brightness: false, colorTemperature: false, transition: false },
        },
      ],
    });
    await service.create('owner', bedroomToToilet);
    await observe();
    expect(commands).toEqual([
      { domain: 'light', service: 'turn_on', target: { entity_id: 'light.veilleuse' } },
    ]);
    service.clock = new Date(NIGHT.getTime() + 3 * 60_000);
    await tick();
    expect(commands[1]).toEqual({
      domain: 'light',
      service: 'turn_off',
      target: { entity_id: 'light.veilleuse' },
    });
  });

  it('starts on bed exit only when asked, and never when the person lies down', async () => {
    const bedExit = {
      sensorId: 'bed-strip',
      capability: 'occupancy',
      role: 'BED',
      bedOccupiedWhen: 'OPEN' as const,
      model: 'TS0601_bed_presence_sensor',
    };
    const { service, commands, observe } = setup({ lights: [strip('hallway')] });
    await service.create('owner', bedroomToToilet);
    await observe({ ...bedExit, payload: { active: true } });
    expect(commands).toEqual([]);
    await observe({ ...bedExit, payload: { active: false } });
    expect(commands).toHaveLength(1);

    const other = setup({ lights: [strip('hallway')] });
    await other.service.create('owner', { ...bedroomToToilet, includeBedExit: false });
    await other.observe({ ...bedExit, payload: { active: false } });
    expect(other.commands).toEqual([]);
  });

  it('ignores replayed, disabled or degraded observations and disabled paths', async () => {
    const { service, commands, observe } = setup({ lights: [strip('hallway')] });
    const path = await service.create('owner', bedroomToToilet);
    await observe({ occurredAt: new Date(NIGHT.getTime() - 10 * 60_000) });
    await observe({ enabled: false });
    await observe({ quality: 'degraded' });
    await service.update('owner', path.id, { enabled: false });
    await observe();
    expect(commands).toEqual([]);
  });

  it('turns off the lights of a path switched off while it is lit', async () => {
    const { service, commands, observe, db } = setup({ lights: [strip('hallway')] });
    const path = await service.create('owner', bedroomToToilet);
    await observe();
    await service.update('owner', path.id, { enabled: false });
    expect(commands.map(({ service: action }) => action)).toEqual(['turn_on', 'turn_off']);
    expect(db.activations).toEqual([]);
  });

  it('turns off after a restart the lights it had turned on', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NIGHT);
    const first = setup({ lights: [strip('hallway')] });
    await first.service.create('owner', bedroomToToilet);
    await first.observe();
    first.service.onModuleDestroy();

    // A new process, same database: the light is still recorded as Élise's.
    const commands: unknown[] = [];
    const restarted = new TestNightPathService(
      first.db as never,
      { onIngested: () => () => undefined } as never,
      { executeHomeAssistantCommand: (command: unknown) => commands.push(command) } as never,
    );
    restarted.clock = new Date(NIGHT.getTime() + 10 * 60_000);
    restarted.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(commands).toEqual([
      {
        domain: 'light',
        service: 'turn_off',
        target: { entity_id: 'light.ruban_hallway' },
        data: { transition: 2 },
      },
    ]);
    restarted.onModuleDestroy();
  });

  it('tests a path for a few seconds, whatever the time', async () => {
    const { service, commands, tick, db } = setup({ lights: [strip('hallway'), strip('toilet')] });
    service.clock = new Date('2026-12-01T11:00:00.000Z');
    await expect(service.test('owner', { lightRoomIds: ['hallway', 'toilet'] })).resolves.toEqual({
      lights: 2,
      seconds: 20,
    });
    expect(commands.filter(({ service: action }) => action === 'turn_on')).toHaveLength(2);
    service.clock = new Date(service.clock.getTime() + 20_000);
    await tick();
    expect(commands.filter(({ service: action }) => action === 'turn_off')).toHaveLength(2);
    expect(db.audit.map(({ action }) => action)).toContain('NIGHT_PATH_TESTED');
  });

  it('is managed by owners and administrators only, and audited', async () => {
    const viewer = setup({ role: 'VIEWER' });
    await expect(viewer.service.create('viewer', bedroomToToilet)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(viewer.service.overview('viewer')).resolves.toMatchObject({ paths: [] });

    const owner = setup();
    const path = await owner.service.create('owner', bedroomToToilet);
    await owner.service.update('owner', path.id, { brightnessPercent: 15 });
    await owner.service.remove('owner', path.id);
    expect(owner.db.audit.map(({ action }) => action)).toEqual([
      'NIGHT_PATH_CREATED',
      'NIGHT_PATH_UPDATED',
      'NIGHT_PATH_DELETED',
    ]);
  });

  it('refuses unknown rooms and identical start and end times', async () => {
    const { service } = setup();
    await expect(
      service.create('owner', { ...bedroomToToilet, lightRoomIds: ['attic'] }),
    ).rejects.toThrow();
    const path = await service.create('owner', bedroomToToilet);
    await expect(service.update('owner', path.id, { endMinute: 22 * 60 })).rejects.toThrow();
  });

  it('lists the rooms that can start a path and the rooms that can be lit', async () => {
    const { service } = setup({ lights: [strip('hallway')] });
    const overview = await service.overview('owner');
    expect(overview.rooms.find(({ id }) => id === 'bedroom')).toMatchObject({
      presenceSensors: 1,
      lights: 0,
    });
    expect(overview.rooms.find(({ id }) => id === 'hallway')).toMatchObject({
      presenceSensors: 0,
      lights: 1,
    });
  });

  it('listens to every committed observation', () => {
    const { service, ingestion } = setup();
    service.onModuleInit();
    expect(ingestion.onIngested).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });
});

describe('nightPathTrigger', () => {
  const base: IngestedObservation = {
    homeId: HOME,
    sensorId: 's',
    roomId: 'bedroom',
    capability: 'motion',
    quality: 'good',
    payload: { active: true },
    role: null,
    bedOccupiedWhen: null,
    model: null,
    enabled: true,
    occurredAt: NIGHT,
  };

  it('reads movement, end of presence and bed exit', () => {
    expect(nightPathTrigger(base)).toBe('MOVEMENT');
    expect(nightPathTrigger({ ...base, payload: { active: false } })).toBe('PRESENCE_ENDED');
    expect(
      nightPathTrigger({
        ...base,
        capability: 'contact',
        role: 'BED',
        bedOccupiedWhen: 'CLOSED',
        payload: { open: true },
      }),
    ).toBe('BED_EXIT');
    expect(
      nightPathTrigger({
        ...base,
        capability: 'contact',
        role: 'BED',
        bedOccupiedWhen: 'CLOSED',
        payload: { open: false },
      }),
    ).toBeNull();
    expect(
      nightPathTrigger({ ...base, capability: 'temperature', payload: { value: 19 } }),
    ).toBeNull();
    expect(nightPathTrigger({ ...base, capability: 'light' })).toBeNull();
  });
});
