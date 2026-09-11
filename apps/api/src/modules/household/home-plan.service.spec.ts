import type { HomePlan } from '@michel/contracts';
import { describe, expect, it, vi } from 'vitest';
import { HomePlanService } from './home-plan.service';

const room = (id: string, points: Array<{ x: number; y: number }>) => ({
  id,
  name: id,
  kind: 'OTHER',
  geometry: { points, color: '#E8F0F3' },
});

const plan = (): HomePlan => ({
  schemaVersion: 1,
  revision: 0,
  configured: true,
  levels: [
    {
      id: 'floor-0',
      name: 'Rez-de-chaussée',
      floor: 0,
      order: 0,
      width: 1_200,
      height: 800,
      scaleCmPerUnit: 1,
      rooms: [
        room('salon', [
          { x: 100, y: 100 },
          { x: 500, y: 100 },
          { x: 500, y: 250 },
          { x: 300, y: 250 },
          { x: 300, y: 500 },
          { x: 100, y: 500 },
        ]),
        room('couloir', [
          { x: 500, y: 100 },
          { x: 700, y: 100 },
          { x: 700, y: 250 },
          { x: 500, y: 250 },
        ]),
      ],
      openings: [
        {
          id: 'door-1',
          kind: 'DOOR',
          roomIds: ['salon', 'couloir'],
          x: 500,
          y: 175,
          width: 90,
          rotation: 90,
        },
      ],
      stairs: [],
      items: [],
    },
  ],
  placements: [],
  connections: [],
  adjacencies: [],
  understanding: {
    levels: [],
    isolatedRoomIds: [],
    adjacentWithoutPassage: [],
    nearAdjacencyIds: [],
    floorsWithoutStairs: [],
    incompleteStairIds: [],
  },
});

describe('HomePlanService geometry', () => {
  const service = new HomePlanService({} as never);
  const internals = service as unknown as {
    validateGeometry(value: HomePlan): void;
    connectionsFor(value: HomePlan): HomePlan['connections'];
    adjacenciesFor(value: HomePlan): HomePlan['adjacencies'];
    enrichPlan(value: HomePlan): HomePlan;
  };

  it('accepts an L-shaped room and derives a door connection', () => {
    const value = plan();
    expect(() => internals.validateGeometry(value)).not.toThrow();
    expect(internals.connectionsFor(value)).toEqual([
      { id: 'door:door-1', kind: 'DOOR', fromRoomId: 'salon', toRoomId: 'couloir' },
    ]);
  });

  it('derives the explicit connection between two floors from a stair', () => {
    const value = plan();
    value.levels.push({
      ...structuredClone(value.levels[0]!),
      id: 'floor-1',
      name: '1er étage',
      floor: 1,
      order: 1,
      rooms: [
        room('chambre', [
          { x: 100, y: 100 },
          { x: 500, y: 100 },
          { x: 500, y: 400 },
          { x: 100, y: 400 },
        ]),
      ],
      openings: [],
      stairs: [],
      items: [],
    });
    value.levels[0]!.stairs.push({
      id: 'stair-1',
      fromFloorId: 'floor-0',
      toFloorId: 'floor-1',
      fromRoomId: 'couloir',
      toRoomId: 'chambre',
      x: 600,
      y: 175,
      width: 100,
      height: 180,
      rotation: 0,
    });

    expect(() => internals.validateGeometry(value)).not.toThrow();
    expect(internals.connectionsFor(value)).toContainEqual({
      id: 'stair:stair-1',
      kind: 'STAIR',
      fromRoomId: 'couloir',
      toRoomId: 'chambre',
    });
  });

  it('rejects a self-intersecting room', () => {
    const value = plan();
    value.levels[0]!.rooms = [
      room('invalid', [
        { x: 100, y: 100 },
        { x: 500, y: 500 },
        { x: 100, y: 500 },
        { x: 500, y: 100 },
      ]),
    ];
    value.levels[0]!.openings = [];
    expect(() => internals.validateGeometry(value)).toThrow('invalide');
  });

  it('rejects an opening that is not attached to a wall', () => {
    const value = plan();
    value.levels[0]!.openings[0]!.x = 450;
    value.levels[0]!.openings[0]!.y = 400;
    expect(() => internals.validateGeometry(value)).toThrow('ouverture');
  });

  it('rejects overlapping rooms', () => {
    const value = plan();
    value.levels[0]!.openings = [];
    value.levels[0]!.rooms.push(
      room('overlap', [
        { x: 200, y: 150 },
        { x: 400, y: 150 },
        { x: 400, y: 350 },
        { x: 200, y: 350 },
      ]),
    );
    expect(() => internals.validateGeometry(value)).toThrow('chevauchent');
  });

  it('detects exact and near shared walls without making them navigable', () => {
    const exact = plan();
    exact.levels[0]!.openings = [];
    expect(internals.adjacenciesFor(exact)).toContainEqual(
      expect.objectContaining({
        floorId: 'floor-0',
        roomIds: ['couloir', 'salon'],
        quality: 'EXACT',
        gapCm: 0,
      }),
    );
    const migrated = internals.enrichPlan(exact);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.connections).toEqual([]);
    expect(migrated.understanding.levels).toEqual([
      { floorId: 'floor-0', roomCount: 2, areaM2: 14, approximate: false },
    ]);
    expect(migrated.understanding.isolatedRoomIds).toEqual(['salon', 'couloir']);
    expect(migrated.understanding.adjacentWithoutPassage).toContainEqual(['couloir', 'salon']);

    const near = plan();
    near.levels[0]!.openings = [];
    near.levels[0]!.rooms[1]!.geometry.points.forEach((point) => {
      point.x += 20;
    });
    const enriched = internals.enrichPlan(near);
    expect(enriched.adjacencies).toContainEqual(
      expect.objectContaining({ quality: 'NEAR', gapCm: 20 }),
    );
    expect(enriched.understanding.nearAdjacencyIds).toHaveLength(1);
    expect(enriched.understanding.adjacentWithoutPassage).toContainEqual(['couloir', 'salon']);
  });

  it('uses the declared room surface instead of the visual polygon area', () => {
    const value = plan();
    value.levels[0]!.rooms[0]!.areaM2 = 25;

    const enriched = internals.enrichPlan(value);

    expect(enriched.levels[0]!.rooms[0]!.areaM2).toBe(25);
    expect(enriched.levels[0]!.rooms[1]!.areaM2).toBe(3);
    expect(enriched.understanding.levels[0]!.areaM2).toBe(28);
  });

  it('recognizes one exterior door as the main entrance without making it a room connection', () => {
    const value = plan();
    value.levels[0]!.openings = [
      {
        id: 'main-door',
        kind: 'DOOR',
        roomIds: ['salon'],
        x: 100,
        y: 300,
        width: 90,
        rotation: 90,
        isMainEntrance: true,
      },
    ];

    expect(() => internals.validateGeometry(value)).not.toThrow();
    const enriched = internals.enrichPlan(value);
    expect(enriched.connections).toEqual([]);
    expect(enriched.understanding.mainEntranceOpeningId).toBe('main-door');
  });

  it('accepts an open passage between separated construction blocks', () => {
    const value = plan();
    value.levels[0]!.rooms[1]!.geometry.points.forEach((point) => {
      point.x += 180;
    });
    value.levels[0]!.openings = [
      {
        id: 'logical-passage',
        kind: 'PASSAGE',
        roomIds: ['salon', 'couloir'],
        x: 500,
        y: 175,
        width: 90,
        rotation: 90,
        logical: true,
      },
    ];

    expect(() => internals.validateGeometry(value)).not.toThrow();
    expect(internals.enrichPlan(value).connections).toContainEqual({
      id: 'passage:logical-passage',
      kind: 'PASSAGE',
      fromRoomId: 'salon',
      toRoomId: 'couloir',
    });
  });

  it('keeps the door side attached to one of the two connected rooms', () => {
    const value = plan();
    value.levels[0]!.openings[0]!.hostRoomId = 'salon';
    expect(() => internals.validateGeometry(value)).not.toThrow();

    value.levels[0]!.openings[0]!.hostRoomId = 'unknown-room';
    expect(() => internals.validateGeometry(value)).toThrow('côté choisi');
  });
});

describe('HomePlanService first home completion', () => {
  const prismaForDraft = () => {
    const tx = {
      sensor: { updateMany: vi.fn() },
      device: { updateMany: vi.fn() },
      camera: { updateMany: vi.fn() },
      room: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
      home: { update: vi.fn() },
      homePlan: { create: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          installationStatus: 'DRAFT',
          plan: null,
          rooms: [],
          sensors: [],
          cameras: [],
        }),
      },
      room: { findMany: vi.fn().mockResolvedValue([]) },
      sensor: { findMany: vi.fn().mockResolvedValue([]) },
      device: { findMany: vi.fn().mockResolvedValue([]) },
      camera: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return { prisma, tx };
  };

  it('starts learning only after the configured plan is saved', async () => {
    const { prisma, tx } = prismaForDraft();
    const service = new HomePlanService(prisma as never);

    await service.save('owner-1', plan());

    const homeUpdate = tx.home.update.mock.calls[0]?.[0] as
      { where: { id: string }; data: Record<string, unknown> } | undefined;
    expect(homeUpdate).toMatchObject({
      where: { id: 'home-1' },
      data: { floorCount: 1, installationStatus: 'LEARNING' },
    });
    expect(homeUpdate?.data.learningStartedAt).toBeInstanceOf(Date);
    expect(tx.homePlan.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft untouched when the initial plan is invalid', async () => {
    const { prisma, tx } = prismaForDraft();
    const service = new HomePlanService(prisma as never);
    const invalid = plan();
    invalid.levels[0]!.rooms = [
      room('invalid', [
        { x: 100, y: 100 },
        { x: 500, y: 500 },
        { x: 100, y: 500 },
        { x: 500, y: 100 },
      ]),
    ];
    invalid.levels[0]!.openings = [];

    await expect(service.save('owner-1', invalid)).rejects.toThrow();
    expect(tx.home.update).not.toHaveBeenCalled();
    expect(tx.homePlan.create).not.toHaveBeenCalled();
  });

  it('persists onboarding progress without starting learning', async () => {
    const { prisma, tx } = prismaForDraft();
    const service = new HomePlanService(prisma as never);
    const draft = plan();
    draft.schemaVersion = 4;
    draft.configured = false;
    draft.setupDraft = {
      stage: 'ROOMS',
      requestedRooms: [{ id: 'requested-salon', name: 'Salon', kind: 'LIVING_ROOM', floor: 0 }],
      tutorialCompleted: false,
    };
    draft.levels[0]!.rooms = [];
    draft.levels[0]!.openings = [];

    const saved = await service.save('owner-1', draft);

    expect(saved.configured).toBe(false);
    expect(saved.setupDraft).toEqual(draft.setupDraft);
    expect(tx.home.update).toHaveBeenCalledWith({
      where: { id: 'home-1' },
      data: { floorCount: 1 },
    });
    expect(tx.homePlan.create).toHaveBeenCalledTimes(1);
  });

  it('refuses to confirm a plan without a room', async () => {
    const { prisma, tx } = prismaForDraft();
    const service = new HomePlanService(prisma as never);
    const empty = plan();
    empty.schemaVersion = 4;
    empty.levels[0]!.rooms = [];
    empty.levels[0]!.openings = [];

    await expect(service.save('owner-1', empty)).rejects.toThrow('au moins une pièce');
    expect(tx.home.update).not.toHaveBeenCalled();
    expect(tx.homePlan.create).not.toHaveBeenCalled();
  });
});

describe('HomePlanService legacy plan compatibility', () => {
  const service = new HomePlanService({} as never);
  const defaultPlan = (installationStatus: 'DRAFT' | 'LEARNING') =>
    (
      service as unknown as {
        defaultPlan(home: {
          floorCount: number;
          installationStatus: 'DRAFT' | 'LEARNING';
          rooms: [];
          sensors: [];
          cameras: [];
        }): HomePlan;
      }
    ).defaultPlan({ floorCount: 1, installationStatus, rooms: [], sensors: [], cameras: [] });

  it('does not relaunch setup for an existing home without a versioned plan', () => {
    expect(defaultPlan('LEARNING')).toMatchObject({ configured: true, setupDraft: null });
    expect(defaultPlan('DRAFT')).toMatchObject({
      configured: false,
      setupDraft: { stage: 'DETAILS' },
    });
  });
});
