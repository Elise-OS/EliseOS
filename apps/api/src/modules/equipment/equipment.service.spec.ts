import { describe, expect, it, vi } from 'vitest';
import {
  activeZigbeeInventoryOnly,
  EquipmentService,
  sensorInventoryOnly,
} from './equipment.service';

const state = {
  schemaVersion: '1.0',
  eventId: 'raw-event-1',
  homeId: 'home-1',
  entityId: 'binary_sensor.custom_presence',
  occurredAt: '2026-08-10T12:00:00.000Z',
  state: 'on',
};

describe('EquipmentService manual mappings', () => {
  it('transforms a manually mapped state without vendor-specific code', async () => {
    const prisma = {
      deviceEntity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      sensor: {
        findUnique: vi.fn().mockResolvedValue({
          sourceName: 'Présence personnalisée',
          mapping: { enabled: true, capability: 'occupancy', transform: 'ON_OFF' },
          device: { sourceDeviceId: 'device-1', manufacturer: 'Vendor', model: 'P1' },
        }),
      },
    };
    const ingestion = { ingest: vi.fn().mockResolvedValue({ accepted: true }) };
    const service = new EquipmentService(prisma as never, ingestion as never);

    await service.ingestMappedState(state);

    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'occupancy', payload: { active: true } }),
    );
  });

  it('does not use an unknown entity until an administrator maps it', async () => {
    const prisma = {
      deviceEntity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      sensor: { findUnique: vi.fn().mockResolvedValue({ mapping: null }) },
    };
    const ingestion = { ingest: vi.fn() };
    const service = new EquipmentService(prisma as never, ingestion as never);

    await service.ingestMappedState(state);

    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('ignores a late state from a sensor removed from the Zigbee network', async () => {
    const prisma = {
      deviceEntity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      sensor: {
        findUnique: vi.fn().mockResolvedValue({
          removedAt: new Date(),
          mapping: { enabled: true, capability: 'occupancy', transform: 'ON_OFF' },
        }),
      },
    };
    const ingestion = { ingest: vi.fn() };

    await new EquipmentService(prisma as never, ingestion as never).ingestMappedState(state);

    expect(ingestion.ingest).not.toHaveBeenCalled();
  });
});

describe('sensorInventoryOnly', () => {
  it('does not recreate a removed Zigbee capteur from stale Home Assistant inventory', () => {
    const inventory = {
      schemaVersion: '1.0',
      homeId: 'home-1',
      generatedAt: '2026-09-13T15:30:00.000Z',
      full: true,
      devices: [
        { deviceId: 'removed', name: 'Motion', networkIdentifier: '0xb40e060fffe70ddc' },
        { deviceId: 'installed', name: 'R3', networkIdentifier: '0x7c3e82d7648b0000' },
      ],
      entities: [
        {
          entityId: 'binary_sensor.0xb40e060fffe70ddc_occupancy',
          deviceId: 'removed',
          name: 'Occupancy',
          domain: 'binary_sensor',
          available: false,
          actions: [],
          compatibility: 'RECOGNIZED',
        },
        {
          entityId: 'binary_sensor.0x7c3e82d7648b0000_occupancy',
          deviceId: 'installed',
          name: 'Occupancy',
          domain: 'binary_sensor',
          available: true,
          actions: [],
          compatibility: 'RECOGNIZED',
        },
      ],
    } as Parameters<typeof activeZigbeeInventoryOnly>[0];

    const result = activeZigbeeInventoryOnly(inventory, new Set(['0x7c3e82d7648b0000']));
    expect(result.devices.map(({ deviceId }) => deviceId)).toEqual(['installed']);
    expect(result.entities.map(({ deviceId }) => deviceId)).toEqual(['installed']);
  });

  it('hides Home Assistant internal services and their orphan devices', () => {
    const filtered = sensorInventoryOnly({
      schemaVersion: '1.0',
      homeId: 'home-1',
      generatedAt: '2026-08-17T12:00:00.000Z',
      full: true,
      devices: [
        { deviceId: 'sun-device', name: 'Sun' },
        { deviceId: 'backup-device', name: 'Backup', manufacturer: 'Home Assistant' },
        { deviceId: 'bridge-device', name: 'Zigbee2MQTT Bridge' },
        { deviceId: 'motion-device', name: 'Détecteur du salon' },
      ],
      entities: [
        {
          entityId: 'sensor.sun_next_rising',
          deviceId: 'sun-device',
          name: 'Next rising',
          domain: 'sensor',
          deviceClass: 'timestamp',
          integration: 'sun',
          protocol: 'wifi',
          available: true,
          actions: [],
          compatibility: 'UNSUPPORTED',
        },
        {
          entityId: 'event.backup_automatic_backup',
          deviceId: 'backup-device',
          name: 'Automatic backup',
          domain: 'event',
          integration: 'backup',
          protocol: 'wifi',
          available: true,
          actions: [],
          compatibility: 'UNSUPPORTED',
        },
        {
          entityId: 'switch.zigbee2mqtt_bridge_permit_join',
          deviceId: 'bridge-device',
          name: 'Permit join',
          domain: 'switch',
          integration: 'mqtt',
          protocol: 'zigbee',
          available: true,
          actions: [],
          capability: 'switch',
          compatibility: 'RECOGNIZED',
        },
        {
          entityId: 'binary_sensor.salon_motion',
          deviceId: 'motion-device',
          name: 'Mouvement salon',
          domain: 'binary_sensor',
          deviceClass: 'motion',
          integration: 'zha',
          protocol: 'zigbee',
          available: true,
          actions: [],
          capability: 'motion',
          compatibility: 'RECOGNIZED',
        },
      ],
    });

    expect(filtered.devices).toEqual([{ deviceId: 'motion-device', name: 'Détecteur du salon' }]);
    expect(filtered.entities.map((entity) => entity.entityId)).toEqual([
      'binary_sensor.salon_motion',
    ]);
  });
});

describe('EquipmentService universal actions', () => {
  it('only forwards the action and fields advertised by Home Assistant', async () => {
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      deviceEntity: {
        findFirst: vi.fn().mockResolvedValue({
          entityId: 'media_player.salon',
          available: true,
          actions: [
            {
              id: 'media_player.play_media',
              domain: 'media_player',
              service: 'play_media',
              label: 'Diffuser un média',
              fields: ['media_content_id', 'media_content_type'],
            },
          ],
        }),
      },
    };
    const service = new EquipmentService(prisma as never, {} as never);

    const command = await service.prepareAction('admin-1', {
      entityId: 'media_player.salon',
      actionId: 'media_player.play_media',
      data: {
        media_content_id: 'https://example.test/ring.mp3',
        media_content_type: 'music',
        dangerous_extra: 'ignored',
      },
      confirmed: true,
    });

    expect(command).toEqual({
      domain: 'media_player',
      service: 'play_media',
      target: { entity_id: 'media_player.salon' },
      data: {
        media_content_id: 'https://example.test/ring.mp3',
        media_content_type: 'music',
      },
    });
  });
});
