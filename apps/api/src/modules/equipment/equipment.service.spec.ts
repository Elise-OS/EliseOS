import { describe, expect, it, vi } from 'vitest';
import { EquipmentService } from './equipment.service';

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
    const prisma = { sensor: { findUnique: vi.fn().mockResolvedValue({ mapping: null }) } };
    const ingestion = { ingest: vi.fn() };
    const service = new EquipmentService(prisma as never, ingestion as never);

    await service.ingestMappedState(state);

    expect(ingestion.ingest).not.toHaveBeenCalled();
  });
});
