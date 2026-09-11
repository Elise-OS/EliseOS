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
    observationEvent: { findMany: vi.fn().mockResolvedValue([]) },
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
  it('keeps the reliable room while a non-adjacent destination is pending', async () => {
    const { tx, state } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('cuisine', 0));
    const result = await service.process(tx as never, evidence('salon', 5));

    expect(result.acceptedForSession).toBe(false);
    expect(state()).toMatchObject({
      status: 'IN_TRANSIT',
      confirmedRoomId: 'cuisine',
      candidateRoomId: 'salon',
      pathRoomIds: ['cuisine', 'couloir', 'salon'],
    });
  });

  it('confirms the destination after persistent evidence', async () => {
    const { tx, state, decisions } = harness();
    const service = new PresenceTrackingService();
    await service.process(tx as never, evidence('cuisine', 0));
    await service.process(tx as never, evidence('salon', 5));
    const result = await service.process(tx as never, evidence('salon', 26));

    expect(result.acceptedForSession).toBe(true);
    expect(state()).toMatchObject({
      status: 'CONFIRMED',
      confirmedRoomId: 'salon',
      candidateRoomId: null,
    });
    expect(decisions.at(-1)).toMatchObject({
      outcome: 'CONFIRMED',
      reasonCodes: ['PERSISTENT_DESTINATION', 'INFERRED_PATH'],
    });
  });

  it('cancels a pending route when the origin is observed again', async () => {
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
      outcome: 'CANCELLED',
      reasonCodes: ['ORIGIN_RECONFIRMED'],
    });
  });
});
