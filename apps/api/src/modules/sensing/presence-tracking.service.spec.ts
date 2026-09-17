import type { HomePlan } from '@michel/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  PresenceTrackingService,
  presenceGraph,
  shortestPresencePath,
  type TrackingEvidence,
} from './presence-tracking.service';

const room = (id: string) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  kind: 'OTHER',
  geometry: {
    color: '#fff',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  },
});

const plan: HomePlan = {
  schemaVersion: 4,
  revision: 1,
  configured: true,
  levels: [
    {
      id: 'ground',
      name: 'RDC',
      floor: 0,
      order: 0,
      width: 1_000,
      height: 600,
      scaleCmPerUnit: 1,
      rooms: [room('cuisine'), room('couloir'), room('salon')],
      openings: [],
      stairs: [],
      items: [],
    },
  ],
  placements: [],
  connections: [
    { id: 'a', kind: 'PASSAGE', fromRoomId: 'cuisine', toRoomId: 'couloir' },
    { id: 'b', kind: 'DOOR', fromRoomId: 'couloir', toRoomId: 'salon' },
  ],
  adjacencies: [],
  understanding: {
    levels: [],
    isolatedRoomIds: [],
    adjacentWithoutPassage: [],
    nearAdjacencyIds: [],
    floorsWithoutStairs: [],
    incompleteStairIds: [],
  },
};

function harness() {
  let state: Record<string, unknown> | null = null;
  const decisions: Array<Record<string, unknown>> = [];
  const tx = {
    presenceTrackingState: {
      findUnique: vi.fn(() => Promise.resolve(state)),
      upsert: vi.fn(
        ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          state = state
            ? { ...state, ...update }
            : {
                id: 'tracking-1',
                inconsistencyCount: 0,
                inconsistencyWindowAt: null,
                trackingDegraded: false,
                ...create,
              };
          return Promise.resolve(state);
        },
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        state = { ...state, ...data };
        return Promise.resolve(state);
      }),
    },
    presenceTransitionDecision: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        decisions.push(data);
        return Promise.resolve(data);
      }),
    },
    sensor: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { tx, decisions, state: () => state };
}

function evidence(
  roomId: string,
  seconds: number,
  overrides: Partial<TrackingEvidence> = {},
): TrackingEvidence {
  return {
    eventId: `event-${roomId}-${seconds}`,
    homeId: 'home',
    residentId: 'resident',
    roomId,
    sensorId: `sensor-${roomId}`,
    capability: 'occupancy',
    active: true,
    occurredAt: new Date(Date.UTC(2026, 7, 30, 8, 0, seconds)),
    confidence: 'HIGH',
    source: 'SENSOR',
    plan,
    ...overrides,
  };
}

describe('topological presence graph', () => {
  it('finds the only valid path through the corridor', () => {
    expect(shortestPresencePath(presenceGraph(plan), 'cuisine', 'salon')).toEqual([
      'cuisine',
      'couloir',
      'salon',
    ]);
  });

  it('returns no path for a disconnected room', () => {
    expect(shortestPresencePath(presenceGraph(plan), 'cuisine', 'inconnue')).toBeNull();
  });
});

describe('PresenceTrackingService', () => {
  it('confirms a directly detected non-adjacent destination immediately', async () => {
    const { tx, state, decisions } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('cuisine', 0));
    const result = await service.process(tx as never, evidence('salon', 5));

    expect(result.acceptedForSession).toBe(true);
    expect(state()).toMatchObject({
      status: 'CONFIRMED',
      confirmedRoomId: 'salon',
      candidateRoomId: null,
    });
    expect(decisions.at(-1)).toMatchObject({
      outcome: 'CONFIRMED',
      reasonCodes: ['DIRECT_DETECTION', 'INFERRED_PATH'],
    });
  });

  it('lets every newer positive detection become the current room', async () => {
    const { tx, state, decisions } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('cuisine', 0));
    await service.process(tx as never, evidence('salon', 5));
    await service.process(tx as never, evidence('cuisine', 10));

    expect(state()).toMatchObject({
      status: 'CONFIRMED',
      confirmedRoomId: 'cuisine',
      candidateRoomId: null,
    });
    expect(decisions.at(-1)).toMatchObject({
      outcome: 'CONFIRMED',
      reasonCodes: ['DIRECT_DETECTION', 'INFERRED_PATH'],
    });
  });

  it('confirms a direct detection even when the plan is disconnected', async () => {
    const { tx, state, decisions } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('cuisine', 0));
    const result = await service.process(tx as never, evidence('inconnue', 5));

    expect(result.acceptedForSession).toBe(true);
    expect(state()).toMatchObject({
      status: 'CONFIRMED',
      confirmedRoomId: 'inconnue',
    });
    expect(decisions.at(-1)).toMatchObject({
      outcome: 'CONFIRMED',
      reasonCodes: ['DIRECT_DETECTION', 'PLAN_DISCONNECTED'],
    });
  });

  it('falls back to another sensor that is still active when the current room turns off', async () => {
    const { tx, state, decisions } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('salon', 0));
    await service.process(tx as never, evidence('cuisine', 100));
    tx.sensor.findMany.mockResolvedValueOnce([
      {
        id: 'sensor-salon',
        device: {
          model: 'Multi-function smart presence sensor R3',
          enabled: true,
          installationStatus: 'OPERATIONAL',
        },
        events: [
          {
            id: 'event-salon-active',
            roomId: 'salon',
            capability: 'occupancy',
            payload: { active: true },
            occurredAt: evidence('salon', 0).occurredAt,
            roomConfidence: 'HIGH',
          },
        ],
      },
    ]);

    const result = await service.process(tx as never, evidence('cuisine', 120, { active: false }));

    expect(state()).toMatchObject({
      status: 'CONFIRMED',
      confirmedRoomId: 'salon',
      candidateRoomId: null,
    });
    expect(result.replacementEvidence).toMatchObject({ roomId: 'salon', active: true });
    expect(decisions.at(-1)).toMatchObject({
      outcome: 'CONFIRMED',
      reasonCodes: ['ACTIVE_SENSOR_REMAINS'],
    });
  });

  it('becomes stale when the current room turns off and no sensor remains active', async () => {
    const { tx, state } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('salon', 0));
    await service.process(tx as never, evidence('salon', 30, { active: false }));

    expect(state()).toMatchObject({
      status: 'STALE',
      confirmedRoomId: 'salon',
      candidateRoomId: null,
      reasonCodes: ['EXPLICIT_ABSENCE'],
    });
  });

  it('does not restore an older room when a different room turns off', async () => {
    const { tx, state } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('salon', 0));
    await service.process(tx as never, evidence('cuisine', 30, { active: false }));

    expect(state()).toMatchObject({ status: 'CONFIRMED', confirmedRoomId: 'salon' });
    expect(tx.sensor.findMany).not.toHaveBeenCalled();
  });
});
