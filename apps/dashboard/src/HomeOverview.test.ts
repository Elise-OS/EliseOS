import type { EquipmentCoverage, HomePlan, SensorDevice } from '@michel/contracts';
import { describe, expect, it } from 'vitest';
import {
  assembleFloorForOverview,
  getCoverageStatus,
  roomAreaM2,
  roomIconKey,
  summarizeHome,
} from './HomeOverview';

const plan: HomePlan = {
  schemaVersion: 3,
  revision: 3,
  configured: true,
  levels: [
    {
      id: 'ground',
      name: 'RDC',
      floor: 0,
      order: 0,
      width: 1_200,
      height: 800,
      scaleCmPerUnit: null,
      rooms: [
        {
          id: 'living',
          name: 'Salon',
          kind: 'LIVING_ROOM',
          geometry: {
            color: '#E8F0F3',
            points: [
              { x: 0, y: 0 },
              { x: 500, y: 0 },
              { x: 500, y: 400 },
              { x: 0, y: 400 },
            ],
          },
        },
      ],
      openings: [
        {
          id: 'entry',
          kind: 'DOOR',
          roomIds: ['living'],
          x: 0,
          y: 100,
          width: 90,
          rotation: 90,
          isMainEntrance: true,
        },
      ],
      stairs: [],
      items: [],
    },
  ],
  placements: [
    {
      id: 'presence-placement',
      kind: 'SENSOR',
      equipmentId: 'device-1',
      roomId: 'living',
      floorId: 'ground',
      openingId: null,
      equipmentRefKind: 'DEVICE',
      targetType: 'ROOM',
      targetId: 'living',
      capabilityBindings: [],
      x: 100,
      y: 100,
      rotation: 0,
    },
  ],
  connections: [],
  adjacencies: [],
  understanding: {
    levels: [{ floorId: 'ground', roomCount: 1, areaM2: 20, approximate: true }],
    isolatedRoomIds: [],
    adjacentWithoutPassage: [],
    nearAdjacencyIds: [],
    floorsWithoutStairs: [],
    incompleteStairIds: [],
    mainEntranceOpeningId: 'entry',
  },
};

const device = (id: string, physicalDeviceId: string, capability: string): SensorDevice => ({
  id,
  physicalDeviceId,
  name: id,
  manufacturer: null,
  model: null,
  protocol: 'zigbee',
  integration: 'zigbee2mqtt',
  room: { id: 'living', name: 'Salon', kind: 'LIVING_ROOM' },
  installationStatus: 'OPERATIONAL',
  enabled: true,
  placementConfirmedAt: null,
  lastSeenAt: null,
  batteryPercent: null,
  capabilities: [
    {
      sensorId: `${id}-sensor`,
      entityId: `sensor.${id}`,
      capability,
      label: capability,
      primary: true,
      status: 'ONLINE',
      value: null,
      unit: null,
      classification: { source: 'METADATA', confidence: 1, reason: null, confirmedAt: null },
    },
  ],
  action: 'NONE',
});

describe('home overview', () => {
  it('uses the room type icon and infers a useful icon for legacy Other rooms', () => {
    expect(roomIconKey({ kind: 'LIVING_ROOM', name: 'Pièce principale' })).toBe('LIVING_ROOM');
    expect(roomIconKey({ kind: 'OTHER', name: 'Cuisine' })).toBe('KITCHEN');
    expect(roomIconKey({ kind: 'OTHER', name: 'Cagibi' })).toBe('STORAGE');
  });

  it('keeps the real surface independent from the visual room geometry', () => {
    const room = structuredClone(plan.levels[0]!.rooms[0]!);
    room.areaM2 = 18.5;
    room.geometry.points = room.geometry.points.map(({ x, y }) => ({ x: x * 2, y: y * 2 }));

    expect(roomAreaM2(room)).toBe(18.5);
  });

  it('assembles rooms connected by a logical door without changing the saved floor', () => {
    const source = structuredClone(plan.levels[0]!);
    source.rooms[0]!.geometry.points = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
    ];
    source.rooms.push({
      id: 'kitchen',
      name: 'Cuisine',
      kind: 'KITCHEN',
      geometry: {
        color: '#F5EAD8',
        points: [
          { x: 800, y: 0 },
          { x: 1_000, y: 0 },
          { x: 1_000, y: 200 },
          { x: 800, y: 200 },
        ],
      },
    });
    source.openings = [
      {
        id: 'logical-door',
        kind: 'DOOR',
        roomIds: ['living', 'kitchen'],
        hostRoomId: 'living',
        logical: true,
        x: 300,
        y: 100,
        width: 90,
        rotation: 90,
      },
    ];

    const assembled = assembleFloorForOverview(source);
    const livingMaxX = Math.max(...assembled.rooms[0]!.geometry.points.map(({ x }) => x));
    const kitchenMinX = Math.min(...assembled.rooms[1]!.geometry.points.map(({ x }) => x));

    expect(kitchenMinX).toBe(livingMaxX);
    expect(assembled.openings[0]!.x).toBe(livingMaxX);
    expect(source.rooms[1]!.geometry.points[0]!.x).toBe(800);
  });

  it('keeps two rooms with separate doors distinct on the same side of a hallway', () => {
    const source = structuredClone(plan.levels[0]!);
    const rectangle = (x: number, y: number, width: number, height: number) => ({
      color: '#E8F0F3',
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    });
    source.rooms = [
      { id: 'hall', name: 'Couloir', kind: 'HALLWAY', geometry: rectangle(400, 400, 600, 100) },
      { id: 'toilet', name: 'Toilettes', kind: 'TOILET', geometry: rectangle(500, 100, 100, 150) },
      { id: 'storage', name: 'Cagibi', kind: 'OTHER', geometry: rectangle(700, 100, 120, 150) },
    ];
    source.openings = [
      {
        id: 'toilet-door',
        kind: 'DOOR',
        roomIds: ['toilet', 'hall'],
        hostRoomId: 'toilet',
        logical: true,
        x: 550,
        y: 250,
        width: 70,
        rotation: 0,
      },
      {
        id: 'storage-door',
        kind: 'DOOR',
        roomIds: ['storage', 'hall'],
        hostRoomId: 'storage',
        logical: true,
        x: 760,
        y: 250,
        width: 70,
        rotation: 0,
      },
    ];

    const assembled = assembleFloorForOverview(source);
    const toilet = assembled.rooms.find(({ id }) => id === 'toilet')!;
    const storage = assembled.rooms.find(({ id }) => id === 'storage')!;
    const hallway = assembled.rooms.find(({ id }) => id === 'hall')!;
    const toiletBox = toilet.geometry.points;
    const storageBox = storage.geometry.points;

    expect(Math.max(...toiletBox.map(({ y }) => y))).toBe(
      Math.min(...hallway.geometry.points.map(({ y }) => y)),
    );
    expect(Math.max(...storageBox.map(({ y }) => y))).toBe(
      Math.min(...hallway.geometry.points.map(({ y }) => y)),
    );
    expect(Math.max(...toiletBox.map(({ x }) => x))).toBeLessThanOrEqual(
      Math.min(...storageBox.map(({ x }) => x)),
    );
    expect(assembled.openings[0]!.x).not.toBe(assembled.openings[1]!.x);
  });

  it('summarizes floors, approximate area and physical devices without counting capabilities twice', () => {
    const devices = [
      device('device-1', 'physical-1', 'presence'),
      device('device-2', 'physical-1', 'illuminance'),
    ];
    const result = summarizeHome(plan, devices, [
      { id: 'camera', name: 'Salon', status: 'ONLINE', privacyMode: true, room: null },
    ]);

    expect(result.levels).toBe(1);
    expect(result.rooms).toBe(1);
    expect(result.area).toBe(20);
    expect(result.approximate).toBe(true);
    expect(result.physicalDevices).toBe(1);
    expect(result.activeEquipment).toBe(3);
  });

  it('distinguishes complete, partial and missing coverage', () => {
    const coverage: EquipmentCoverage = {
      profiles: [],
      summary: {
        main: [],
        optional: [],
        totals: { required: 0, covered: 0, toAdd: 0, optional: 0 },
        warnings: [],
      },
      recommendations: [
        {
          id: 'presence',
          target: {
            type: 'ROOM',
            id: 'living',
            roomId: 'living',
            label: 'Salon',
            kind: 'LIVING_ROOM',
          },
          capability: 'presence',
          priority: 'ESSENTIAL',
          reason: 'Présence',
          fulfilledByPlacementId: 'presence-placement',
          compatibleDeviceIds: ['device-1'],
        },
        {
          id: 'temperature',
          target: {
            type: 'ROOM',
            id: 'living',
            roomId: 'living',
            label: 'Salon',
            kind: 'LIVING_ROOM',
          },
          capability: 'temperature',
          priority: 'RECOMMENDED',
          reason: 'Climat',
          fulfilledByPlacementId: null,
          compatibleDeviceIds: [],
        },
      ],
    };

    expect(
      getCoverageStatus('presence', plan, [device('device-1', 'physical-1', 'presence')], coverage),
    ).toBe('COVERED');
    expect(
      getCoverageStatus('climate', plan, [device('device-3', 'physical-3', 'humidity')], coverage),
    ).toBe('PARTIAL');
    expect(getCoverageStatus('water', plan, [], coverage)).toBe('NONE');
  });
});
