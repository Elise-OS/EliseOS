import { describe, expect, it, vi } from 'vitest';
import {
  homeAssistantInventorySchema,
  homePlanSchema,
  normalizedEventSchema,
} from '@elise/contracts';
import { IngestionService } from './ingestion.service';

describe('normalized Élise event', () => {
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

  it('opens a new SOS for every press once the previous one is closed', async () => {
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
    const press = (eventId: string, occurredAt: string) =>
      service.ingest({
        schemaVersion: '1.0',
        eventId,
        occurredAt,
        receivedAt: occurredAt,
        homeId: 'home-1',
        source: { platform: 'home-assistant', entityId: 'event.snzb_01p_bouton_action' },
        capability: 'button',
        quality: 'good',
        payload: { action: 'sos' },
      });

    await press('evt-1', '2026-11-12T08:00:00.000Z');
    await press('evt-2', '2026-11-12T08:00:20.000Z');
    // A second press while the first SOS is still open does not duplicate it.
    expect(alerts).toHaveLength(1);
    alerts[0]!.status = 'RESOLVED';
    // No "released" report ever arrives from a button: the next press must alert again.
    await press('evt-3', '2026-11-12T08:30:00.000Z');
    expect(alerts).toHaveLength(2);
    expect(alerts[1]?.ruleKey).toBe('security:SOS:event.snzb_01p_bouton_action');
  });

  describe('SNZB-01P assistance button (Zigbee2MQTT 2.13 event entity)', () => {
    const entityId = 'event.snzb_01p_bouton_action';
    const assistancePlan = {
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
          rooms: [
            {
              id: 'salon',
              name: 'Salon',
              kind: 'LIVING_ROOM',
              geometry: {
                color: '#ffffff',
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                  { x: 100, y: 100 },
                  { x: 0, y: 100 },
                ],
              },
            },
          ],
          openings: [],
          stairs: [],
          items: [],
        },
      ],
      placements: [
        {
          id: 'button-placement',
          kind: 'SENSOR',
          floorId: 'ground',
          x: 10,
          y: 10,
          equipmentId: entityId,
          roomId: 'salon',
          capabilityBindings: [{ sensorId: entityId, capability: 'button', role: 'ASSISTANCE' }],
        },
      ],
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

    it('uses a valid home plan fixture', () => {
      expect(homePlanSchema.safeParse(assistancePlan).success).toBe(true);
    });

    const harness = (plan: unknown) => {
      const alerts: Array<{ id: string; ruleKey: string; type: string; status: string }> = [];
      const tx = {
        sensor: {
          upsert: vi.fn((args: { where: { homeId_entityId: { entityId: string } } }) => ({
            id: args.where.homeId_entityId.entityId,
            roomId: 'salon',
            analysisEnabled: true,
          })),
        },
        homePlan: { findUnique: vi.fn().mockResolvedValue(plan ? { data: plan } : null) },
        observationEvent: {
          create: vi.fn().mockResolvedValue({ id: 'saved-event' }),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        outboxMessage: { create: vi.fn() },
        alertTransition: { create: vi.fn() },
        roomPresenceSession: { findFirst: vi.fn().mockResolvedValue(null) },
        $executeRaw: vi.fn(),
        alert: {
          findFirst: vi.fn(
            (args: { where: { ruleKey: string } }) =>
              alerts.filter((item) => item.ruleKey === args.where.ruleKey).at(-1) ?? null,
          ),
          create: vi.fn((args: { data: { ruleKey: string; type: string } }) => {
            const alert = {
              id: `alert-${alerts.length + 1}`,
              ruleKey: args.data.ruleKey,
              type: args.data.type,
              status: 'OPEN',
            };
            alerts.push(alert);
            return alert;
          }),
          update: vi.fn(),
        },
      };
      const prisma = {
        observationEvent: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const service = new IngestionService(prisma as never);
      const press = (action: string) =>
        service.ingest({
          schemaVersion: '1.0',
          eventId: `evt-${action}`,
          occurredAt: '2026-11-12T08:00:00.000Z',
          receivedAt: '2026-11-12T08:00:00.100Z',
          homeId: 'home-1',
          source: { platform: 'home-assistant', entityId },
          capability: 'button',
          quality: 'good',
          payload: { action },
        });
      return { alerts, press };
    };

    it.each(['single', 'double', 'long'])(
      'raises an SOS for a %s press of a button with the assistance role',
      async (action) => {
        const { alerts, press } = harness(assistancePlan);
        await press(action);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({ type: 'SOS', ruleKey: `security:SOS:${entityId}` });
      },
    );

    it.each(['single', 'double', 'long'])(
      'keeps a %s press of a button without the assistance role out of SOS',
      async (action) => {
        const { alerts, press } = harness(null);
        await press(action);
        expect(alerts).toHaveLength(0);
      },
    );
  });

  describe('HEIMAN HS1SA-E smoke detector (Zigbee2MQTT 2.13)', () => {
    const entityId = 'binary_sensor.detecteur_fumee_cuisine_smoke';
    const harness = (existing?: { status: string }) => {
      const alerts: Array<{
        id: string;
        ruleKey: string;
        type: string;
        status: string;
        conditionClearedAt: Date | null;
      }> = existing
        ? [
            {
              id: 'alert-0',
              ruleKey: `security:SMOKE:${entityId}`,
              type: 'SMOKE',
              status: existing.status,
              conditionClearedAt: null,
            },
          ]
        : [];
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
          create: vi.fn((args: { data: { ruleKey: string; type: string; severity: string } }) => {
            const alert = {
              id: `alert-${alerts.length + 1}`,
              ruleKey: args.data.ruleKey,
              type: args.data.type,
              status: 'OPEN',
              conditionClearedAt: null,
            };
            alerts.push(alert);
            return alert;
          }),
          update: vi.fn(),
        },
      };
      const prisma = {
        observationEvent: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const service = new IngestionService(prisma as never);
      // Payloads as forwarded by the Élise bridge from the Z2M state
      // {"smoke":true,"test":true,"battery_low":false,"tamper":false,...}.
      const report = (payload: Record<string, unknown>) =>
        service.ingest({
          schemaVersion: '1.0',
          eventId: `evt-${JSON.stringify(payload)}`,
          occurredAt: '2026-11-12T08:00:00.000Z',
          receivedAt: '2026-11-12T08:00:00.100Z',
          homeId: 'home-1',
          source: {
            platform: 'home-assistant',
            entityId,
            manufacturer: 'HEIMAN',
            model: 'HS1SA-E',
          },
          capability: 'smoke',
          quality: 'good',
          payload,
        });
      return { alerts, tx, report };
    };

    it('records a test button press without an urgent smoke alert', async () => {
      const { alerts, tx, report } = harness();
      await report({ active: true, test: true });
      expect(tx.observationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            capability: 'smoke',
            payload: expect.objectContaining({ active: true, test: true }) as unknown,
          }) as unknown,
        }),
      );
      expect(alerts).toHaveLength(0);
    });

    it('raises an urgent smoke alert when the test flag is absent', async () => {
      const { alerts, tx, report } = harness();
      await report({ active: true });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.type).toBe('SMOKE');
      expect(tx.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ severity: 'URGENT' }) as unknown,
        }),
      );
    });

    it('raises an urgent smoke alert when the test flag is false', async () => {
      const { alerts, report } = harness();
      await report({ active: true, test: false });
      expect(alerts).toHaveLength(1);
    });

    it('never clears a real smoke alert because of a test press', async () => {
      const { alerts, tx, report } = harness({ status: 'OPEN' });
      await report({ active: true, test: true });
      expect(tx.alert.update).not.toHaveBeenCalled();
      expect(alerts[0]?.conditionClearedAt).toBeNull();
    });
  });
});
