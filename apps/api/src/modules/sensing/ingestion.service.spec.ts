import { describe, expect, it, vi } from 'vitest';
import { homeAssistantInventorySchema, normalizedEventSchema } from '@michel/contracts';
import { IngestionService } from './ingestion.service';

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

  it('accepts camera AI as a normalized fact without any media payload', () => {
    const event = normalizedEventSchema.parse({
      schemaVersion: '1.0',
      eventId: 'evt-camera-person-1',
      occurredAt: '2026-08-10T18:00:00.000Z',
      receivedAt: '2026-08-10T18:00:00.100Z',
      homeId: 'home-1',
      source: { platform: 'home-assistant', entityId: 'binary_sensor.salon_person' },
      capability: 'person_presence',
      quality: 'good',
      payload: { active: true },
    });
    expect(event.payload).toEqual({ active: true });
    expect(JSON.stringify(event)).not.toContain('rtsp');
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

describe('critical alert ingestion', () => {
  it('keeps simultaneous alarms from different sensors separate and suppresses a repeated signal', async () => {
    const alerts: Array<{
      id: string;
      ruleKey: string;
      status: string;
      conditionClearedAt: Date | null;
    }> = [];
    const tx = {
      sensor: {
        upsert: vi.fn((args: { where: { homeId_entityId: { entityId: string } } }) => ({
          id: args.where.homeId_entityId.entityId,
          roomId: null,
          analysisEnabled: true,
        })),
      },
      homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
      observationEvent: {
        create: vi.fn().mockResolvedValue({ id: 'saved-event' }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      outboxMessage: { create: vi.fn() },
      alertTransition: { create: vi.fn() },
      $executeRaw: vi.fn(),
      alert: {
        findFirst: vi.fn(
          (args: { where: { ruleKey: string } }) =>
            alerts.filter((item) => item.ruleKey === args.where.ruleKey).at(-1) ?? null,
        ),
        create: vi.fn((args: { data: { ruleKey: string } }) => {
          const alert = {
            id: `alert-${alerts.length + 1}`,
            ruleKey: args.data.ruleKey,
            status: 'OPEN',
            conditionClearedAt: null,
          };
          alerts.push(alert);
          return alert;
        }),
        update: vi.fn(
          (args: {
            where: { id: string };
            data: { conditionClearedAt?: Date | null; status?: string };
          }) => {
            const alert = alerts.find((item) => item.id === args.where.id)!;
            if ('conditionClearedAt' in args.data)
              alert.conditionClearedAt = args.data.conditionClearedAt ?? null;
            if (args.data.status) alert.status = args.data.status;
            return alert;
          },
        ),
      },
    };
    const prisma = {
      observationEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new IngestionService(prisma as never);
    const ingest = (
      eventId: string,
      entityId: string,
      active: boolean,
      occurredAt = '2026-09-23T12:00:00.000Z',
    ) =>
      service.ingest({
        schemaVersion: '1.0',
        eventId,
        occurredAt,
        receivedAt: occurredAt,
        homeId: 'home-1',
        source: { platform: 'home-assistant', entityId },
        capability: 'smoke',
        quality: 'good',
        payload: { active },
      });

    await ingest('evt-1', 'smoke-kitchen', true);
    await ingest('evt-2', 'smoke-bedroom', true);
    await ingest('evt-3', 'smoke-kitchen', true);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((item) => item.ruleKey)).toEqual([
      'security:SMOKE:smoke-kitchen',
      'security:SMOKE:smoke-bedroom',
    ]);

    await ingest('evt-4', 'smoke-kitchen', false);
    expect(alerts[0]?.status).toBe('OPEN');
    expect(alerts[0]?.conditionClearedAt).toBeInstanceOf(Date);
    alerts[0]!.status = 'RESOLVED';
    await ingest('evt-5', 'smoke-kitchen', true, '2026-09-23T12:03:00.000Z');
    expect(alerts).toHaveLength(3);
    await ingest('evt-6', 'smoke-bedroom', false);
    await ingest('evt-7', 'smoke-bedroom', true, '2026-09-23T12:03:00.000Z');
    expect(alerts).toHaveLength(4);
    expect(alerts[1]?.status).toBe('RESOLVED');
    expect(tx.alertTransition.create).toHaveBeenCalledOnce();
  });
});
