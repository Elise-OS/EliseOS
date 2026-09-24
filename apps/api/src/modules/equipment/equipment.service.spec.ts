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

  it('recognizes both Zigbee dry-contact states as open and closed', async () => {
    const prisma = {
      deviceEntity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      sensor: {
        findUnique: vi.fn().mockResolvedValue({
          sourceName: 'Contact du lit',
          mapping: { enabled: true, capability: 'contact', transform: 'OPEN_CLOSED' },
          device: { sourceDeviceId: 'bed-device', manufacturer: 'NodOn', model: 'SDC-4-1-00' },
        }),
      },
    };
    const ingestion = { ingest: vi.fn().mockResolvedValue({ accepted: true }) };
    const service = new EquipmentService(prisma as never, ingestion as never);
    await service.ingestMappedState({ ...state, state: 'contact_open' });
    await service.ingestMappedState({ ...state, eventId: 'raw-event-2', state: 'contact_closed' });
    expect(ingestion.ingest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ capability: 'contact', payload: { open: true } }),
    );
    expect(ingestion.ingest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capability: 'contact', payload: { open: false } }),
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

describe('equipment availability for alert rules', () => {
  it('preserves a disabled sensor and its original outage start across inventory refreshes', async () => {
    const unavailableSince = new Date('2026-09-23T10:00:00.000Z');
    const tx = {
      deviceEntity: { upsert: vi.fn(), updateMany: vi.fn() },
      sensor: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { entityId: 'binary_sensor.entry_motion', available: false, unavailableSince },
          ]),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      equipmentSyncState: { upsert: vi.fn() },
    };
    const prisma = {
      home: { findUnique: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EquipmentService(prisma as never, {} as never);
    const inventory = (available: boolean) => ({
      schemaVersion: '1.0',
      homeId: 'home-1',
      generatedAt: '2026-09-23T11:00:00.000Z',
      full: true,
      devices: [],
      entities: [
        {
          entityId: 'binary_sensor.entry_motion',
          name: 'Entrée',
          domain: 'binary_sensor',
          deviceClass: 'motion',
          available,
          capability: 'motion',
          compatibility: 'RECOGNIZED',
          actions: [],
        },
      ],
    });
    await service.ingestInventory(inventory(false));
    const first = tx.sensor.upsert.mock.calls[0]?.[0] as {
      update: { unavailableSince: Date; analysisEnabled?: boolean };
    };
    expect(first.update.unavailableSince).toEqual(unavailableSince);
    expect(first.update).not.toHaveProperty('analysisEnabled');

    await service.ingestInventory(inventory(true));
    const second = tx.sensor.upsert.mock.calls[1]?.[0] as {
      update: { unavailableSince: Date | null };
    };
    expect(second.update.unavailableSince).toBeNull();

    tx.sensor.findMany.mockResolvedValueOnce([
      {
        entityId: 'binary_sensor.entry_motion',
        available: true,
        unavailableSince: null,
        status: 'DEGRADED',
      },
    ]);
    await service.ingestInventory(inventory(true));
    const third = tx.sensor.upsert.mock.calls[2]?.[0] as {
      update: { status: string };
    };
    expect(third.update.status).toBe('DEGRADED');
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
