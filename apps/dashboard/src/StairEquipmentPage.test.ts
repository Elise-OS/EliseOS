import type { HomePlan, SensorDevice } from '@michel/contracts';
import { describe, expect, it } from 'vitest';
import { stairCategoryDevices } from './StairEquipmentPage';

describe('stair equipment', () => {
  it('only counts compatible devices placed directly on the selected stair', () => {
    const plan = {
      placements: [
        {
          kind: 'SENSOR',
          equipmentId: 'motion-device',
          targetType: 'STAIR',
          targetId: 'stairs-1',
        },
        {
          kind: 'SENSOR',
          equipmentId: 'other-device',
          targetType: 'ROOM',
          targetId: 'hall',
        },
      ],
    } as HomePlan;
    const devices = [
      {
        id: 'motion-device',
        model: '3RMS16BZ',
        capabilities: [{ sensorId: 'motion-entity', capability: 'occupancy' }],
      },
      {
        id: 'other-device',
        model: '3RMS16BZ',
        capabilities: [{ sensorId: 'other-entity', capability: 'occupancy' }],
      },
    ] as SensorDevice[];

    expect(stairCategoryDevices(plan, 'stairs-1', devices, 'motion')).toEqual([devices[0]]);
    expect(stairCategoryDevices(plan, 'stairs-1', devices, 'presence')).toEqual([]);
  });

  it('resolves placements that reference an individual sensor entity', () => {
    const plan = {
      placements: [
        {
          kind: 'SENSOR',
          equipmentId: 'presence-entity',
          targetType: 'STAIR',
          targetId: 'stairs-1',
        },
      ],
    } as HomePlan;
    const device = {
      id: 'presence-device',
      model: 'FP1',
      capabilities: [{ sensorId: 'presence-entity', capability: 'person_presence' }],
    } as SensorDevice;

    expect(stairCategoryDevices(plan, 'stairs-1', [device], 'presence')).toEqual([device]);
  });
});
