import type { HomePlan } from '@michel/contracts';
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers use `any`. */
import { describe, expect, it } from 'vitest';
import { equipmentCoverage, profileFor, SENSOR_PROFILES } from './equipment-coverage';

const plan: HomePlan = {
  schemaVersion: 3,
  revision: 0,
  configured: true,
  levels: [
    {
      id: 'floor',
      name: 'RDC',
      floor: 0,
      order: 0,
      width: 1_000,
      height: 800,
      scaleCmPerUnit: 1,
      rooms: [
        {
          id: 'kitchen',
          name: 'Cuisine',
          kind: 'KITCHEN',
          geometry: {
            color: '#E8F0F3',
            points: [
              { x: 100, y: 100 },
              { x: 600, y: 100 },
              { x: 600, y: 500 },
              { x: 100, y: 500 },
            ],
          },
        },
      ],
      openings: [
        {
          id: 'entrance',
          kind: 'DOOR',
          roomIds: ['kitchen'],
          hostRoomId: 'kitchen',
          x: 100,
          y: 250,
          width: 90,
          rotation: 90,
          isMainEntrance: true,
        },
      ],
      stairs: [],
      items: [
        {
          id: 'sink',
          kind: 'SINK',
          roomId: 'kitchen',
          x: 250,
          y: 150,
          width: 120,
          height: 60,
          rotation: 0,
        },
        {
          id: 'coffee',
          kind: 'COFFEE_MACHINE',
          roomId: 'kitchen',
          x: 350,
          y: 150,
          width: 45,
          height: 40,
          rotation: 0,
        },
      ],
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
};

describe('equipment coverage', () => {
  it('contains every model in the physical test inventory and keeps the dongle out of the plan', () => {
    expect(SENSOR_PROFILES.flatMap(({ models }) => models)).toEqual([
      '3RPL01084Z',
      '3RDS17BZ',
      '3RMS16BZ',
      '3RTHS0224Z',
      '3RWS18BZ',
      '3RSPE01044BZ',
      '3RSB22BZ',
      'SDO-4-1-00',
      'STPH-4-1-00',
      'SDC-4-1-00',
      'SEM-4-1-00',
    ]);
    expect(
      SENSOR_PROFILES.some(({ models }) => models.some((model) => /dongle/i.test(model))),
    ).toBe(false);
  });

  it('maps the NodOn dry-contact capability to an opening recommendation', () => {
    const coverage = equipmentCoverage(plan, [
      {
        id: 'nodon-contact',
        name: 'Contact filaire',
        manufacturer: 'NodOn',
        model: 'SDC-4-1-00',
        capabilities: [{ sensorId: 'dry', capability: 'dry_contact' }],
      },
    ]);
    expect(
      coverage.recommendations.find(
        ({ target, capability }) => target.id === 'entrance' && capability === 'contact',
      ),
    ).toMatchObject({ compatibleDeviceIds: ['nodon-contact'] });
  });

  it('falls back to capabilities for an unknown manufacturer and model', () => {
    expect(
      profileFor({
        id: 'unknown',
        name: 'Capteur futur',
        manufacturer: 'Future',
        model: 'X-2040',
        capabilities: [{ sensorId: 'entity', capability: 'contact' }],
      }),
    ).toMatchObject({
      id: 'generic:unknown',
      capabilities: ['contact'],
      targetTypes: ['OPENING', 'ROOM'],
    });
  });

  it('uses room categories after retiring furniture targets', () => {
    const coverage = equipmentCoverage(plan, [
      {
        id: 'contact',
        name: 'Contact',
        manufacturer: null,
        model: '3RDS17BZ',
        capabilities: [{ sensorId: 'c', capability: 'contact' }],
      },
      {
        id: 'leak',
        name: 'Fuite',
        manufacturer: null,
        model: '3RWS18BZ',
        capabilities: [{ sensorId: 'w', capability: 'water_leak' }],
      },
      {
        id: 'plug',
        name: 'Prise',
        manufacturer: null,
        model: '3RSPE01044BZ',
        capabilities: [{ sensorId: 'p', capability: 'power' }],
      },
    ]);
    expect(
      coverage.recommendations.find(
        ({ target, capability }) => target.id === 'entrance' && capability === 'contact',
      ),
    ).toMatchObject({ priority: 'ESSENTIAL' });
    expect(coverage.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: expect.objectContaining({ id: 'kitchen' }),
          capability: 'water_leak',
        }),
        expect.objectContaining({
          target: expect.objectContaining({ id: 'kitchen' }),
          capability: 'temperature',
        }),
        expect.objectContaining({
          target: expect.objectContaining({ id: 'kitchen' }),
          capability: 'motion',
        }),
      ]),
    );
    expect(
      coverage.recommendations.some(({ target }) => ['sink', 'coffee'].includes(target.id)),
    ).toBe(false);
  });

  it('counts one multi-capability device once for one target and prefers the detected model', () => {
    const livingPlan = structuredClone(plan);
    livingPlan.levels[0]!.rooms[0]!.id = 'living';
    livingPlan.levels[0]!.rooms[0]!.name = 'Salon';
    livingPlan.levels[0]!.rooms[0]!.kind = 'LIVING_ROOM';
    livingPlan.levels[0]!.openings = [];
    livingPlan.levels[0]!.items = [];
    livingPlan.placements = [
      {
        id: 'placed-presence',
        kind: 'SENSOR',
        equipmentId: 'presence-device',
        equipmentRefKind: 'DEVICE',
        roomId: 'living',
        floorId: 'floor',
        openingId: null,
        targetType: 'ROOM',
        targetId: 'living',
        capabilityBindings: [],
        x: 200,
        y: 200,
        rotation: 0,
      },
    ];

    const coverage = equipmentCoverage(livingPlan, [
      {
        id: 'presence-device',
        name: 'Présence du salon',
        manufacturer: 'Third Reality',
        model: '3RPL01084Z',
        capabilities: [
          { sensorId: 'presence', capability: 'occupancy' },
          { sensorId: 'light', capability: 'illuminance' },
        ],
      },
    ]);

    expect(coverage.summary.optional.find(({ model }) => model === '3RPL01084Z')).toMatchObject({
      model: '3RPL01084Z',
      total: 1,
      covered: 1,
      toAdd: 0,
    });
  });

  it('reports missing plan details without inventing sensors for absent targets', () => {
    const incomplete = structuredClone(plan);
    incomplete.levels.push({
      id: 'first',
      name: 'Étage',
      floor: 1,
      order: 1,
      width: 1_000,
      height: 800,
      scaleCmPerUnit: 1,
      rooms: [],
      openings: [],
      stairs: [],
      items: [],
    });
    incomplete.levels[0]!.openings = [];
    incomplete.levels[0]!.items = [];
    incomplete.understanding.floorsWithoutStairs = ['floor', 'first'];

    const coverage = equipmentCoverage(incomplete, []);

    expect(coverage.summary.warnings).toEqual(
      expect.arrayContaining(['MISSING_MAIN_ENTRANCE', 'MISSING_STAIRS']),
    );
    expect(
      coverage.recommendations.some(
        ({ capability, target }) => capability === 'contact' && target.type === 'OPENING',
      ),
    ).toBe(false);
    expect(coverage.recommendations.some(({ capability }) => capability === 'water_leak')).toBe(
      true,
    );
  });
});
