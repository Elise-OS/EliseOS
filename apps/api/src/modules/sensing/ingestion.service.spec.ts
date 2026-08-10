import { describe, expect, it } from 'vitest';
import { homeAssistantInventorySchema, normalizedEventSchema } from '@michel/contracts';

describe('normalized Michel event', () => {
  it('accepts a privacy-minimised motion event', () => {
    const event = normalizedEventSchema.parse({
      schemaVersion: '1.0',
      eventId: 'evt-1',
      occurredAt: '2026-08-03T08:00:00.000Z',
      receivedAt: '2026-08-03T08:00:01.000Z',
      homeId: 'home-1',
      source: { platform: 'home-assistant', entityId: 'binary_sensor.kitchen_motion' },
      capability: 'motion',
      quality: 'good',
      payload: { active: true },
    });
    expect(event.capability).toBe('motion');
  });
});

describe('Home Assistant universal inventory', () => {
  it('accepts entities independently from their radio protocol and keeps unknown ones visible', () => {
    const inventory = homeAssistantInventorySchema.parse({
      schemaVersion: '1.0',
      homeId: 'home-1',
      generatedAt: '2026-08-10T12:00:00.000Z',
      full: true,
      devices: [
        { deviceId: 'matter-1', name: 'Présence salon', manufacturer: 'Any vendor' },
        { deviceId: 'zwave-1', name: 'Contact entrée' },
      ],
      entities: [
        {
          entityId: 'binary_sensor.salon_presence',
          deviceId: 'matter-1',
          name: 'Présence salon',
          domain: 'binary_sensor',
          deviceClass: 'occupancy',
          available: true,
          capability: 'occupancy',
          compatibility: 'RECOGNIZED',
        },
        {
          entityId: 'sensor.vendor_specific_score',
          deviceId: 'zwave-1',
          name: 'Score propriétaire',
          domain: 'sensor',
          available: true,
          capability: null,
          compatibility: 'UNSUPPORTED',
        },
      ],
    });
    expect(inventory.entities).toHaveLength(2);
    expect(inventory.entities[1]?.compatibility).toBe('UNSUPPORTED');
  });
});
