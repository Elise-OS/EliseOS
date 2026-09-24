import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALERT_RULE_SETTINGS } from '@michel/contracts';
import { AlertsService } from './alerts.service';

describe('AlertsService rules', () => {
  it('counts urgent active alerts only within an active membership', async () => {
    const prisma = { alert: { count: vi.fn().mockResolvedValue(2) } };
    const result = await new AlertsService(prisma as never).summary('member-1');

    expect(result).toEqual({ urgentCount: 2 });
    expect(prisma.alert.count).toHaveBeenCalledWith({
      where: {
        home: { organization: { memberships: { some: { userId: 'member-1', disabledAt: null } } } },
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        severity: 'URGENT',
      },
    });
  });

  it('does not reveal a detail outside the member home', async () => {
    const prisma = { alert: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(
      new AlertsService(prisma as never).detail('member-1', 'other-alert'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.alert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'other-alert',
          home: {
            organization: { memberships: { some: { userId: 'member-1', disabledAt: null } } },
          },
        },
      }),
    );
  });

  it('uses only the alert sensor and its active period for evidence', async () => {
    const openedAt = new Date('2026-09-23T10:00:00.000Z');
    const resolvedAt = new Date('2026-09-23T11:00:00.000Z');
    const prisma = {
      alert: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'alert-1',
          homeId: 'home-1',
          ruleKey: 'temperature-low:sensor-1',
          openedAt,
          resolvedAt,
        }),
      },
      sensor: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sensor-1', capability: 'temperature' }),
      },
      observationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await new AlertsService(prisma as never).detail('member-1', 'alert-1');

    expect(prisma.sensor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sensor-1', homeId: 'home-1' } }),
    );
    expect(prisma.observationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          homeId: 'home-1',
          sensorId: 'sensor-1',
          occurredAt: {
            gte: new Date('2026-09-23T09:30:00.000Z'),
            lte: new Date('2026-09-23T11:30:00.000Z'),
          },
        },
      }),
    );
  });

  it('returns prudent defaults when no rule revision exists', async () => {
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      configurationRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new AlertsService(prisma as never);

    await expect(service.rules('owner-1')).resolves.toEqual(DEFAULT_ALERT_RULE_SETTINGS);
  });

  it('requires an active membership to read rule settings', async () => {
    const prisma = { home: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new AlertsService(prisma as never);

    await expect(service.rules('viewer-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates an additive configuration revision and audit entry', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      configurationRevision: {
        findFirst: vi.fn().mockResolvedValue({ version: 3, settings: { locale: 'fr' } }),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AlertsService(prisma as never);

    await service.updateRules('owner-1', DEFAULT_ALERT_RULE_SETTINGS);

    expect(tx.configurationRevision.create).toHaveBeenCalledOnce();
    const createCall = tx.configurationRevision.create.mock.calls[0]?.[0] as unknown as {
      data: { homeId: string; version: number; settings: Record<string, unknown> };
    };
    expect(createCall.data.homeId).toBe('home-1');
    expect(createCall.data.version).toBe(4);
    expect(createCall.data.settings).toEqual({
      locale: 'fr',
      alertRules: DEFAULT_ALERT_RULE_SETTINGS,
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('does not allow a viewer to transition an alert', async () => {
    const prisma = { alert: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new AlertsService(prisma as never);

    await expect(service.transition('viewer-1', 'alert-1', 'RESOLVED')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const accessCall = prisma.alert.findFirst.mock.calls[0]?.[0] as unknown as {
      where: {
        id: string;
        home: {
          organization: {
            memberships: { some: { userId: string; systemRole: { in: string[] } } };
          };
        };
      };
    };
    expect(accessCall.where.id).toBe('alert-1');
    expect(accessCall.where.home.organization.memberships.some).toEqual({
      userId: 'viewer-1',
      disabledAt: null,
      systemRole: { in: ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] },
    });
  });

  it('rejects a transition from a closed alert', async () => {
    const prisma = {
      alert: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'alert-1',
          homeId: 'home-1',
          status: 'RESOLVED',
        }),
      },
      $transaction: vi.fn(),
    };
    await expect(
      new AlertsService(prisma as never).transition('owner-1', 'alert-1', 'ACKNOWLEDGED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records one valid transition without sending a new-alert push', async () => {
    const alert = {
      id: 'alert-1',
      homeId: 'home-1',
      status: 'OPEN',
      acknowledgedAt: null,
    };
    const tx = {
      alert: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...alert, status: 'ACKNOWLEDGED' }),
      },
      alertTransition: { create: vi.fn() },
      outboxMessage: { create: vi.fn() },
    };
    const prisma = {
      alert: { findFirst: vi.fn().mockResolvedValue(alert) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    await new AlertsService(prisma as never).transition('owner-1', alert.id, 'ACKNOWLEDGED');
    expect(tx.alert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: alert.id, status: 'OPEN' } }),
    );
    expect(tx.alertTransition.create).toHaveBeenCalledOnce();
    expect(tx.outboxMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxMessage.create).toHaveBeenCalledWith({
      data: {
        homeId: 'home-1',
        topic: 'webhook',
        payload: { event: 'alert.acknowledged', alertId: 'alert-1' },
      },
    });
  });

  it('rejects a concurrent status change before writing the history', async () => {
    const tx = {
      alert: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      alertTransition: { create: vi.fn() },
    };
    const prisma = {
      alert: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'alert-1',
          homeId: 'home-1',
          status: 'OPEN',
          acknowledgedAt: null,
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    await expect(
      new AlertsService(prisma as never).transition('owner-1', 'alert-1', 'RESOLVED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.alertTransition.create).not.toHaveBeenCalled();
  });
});
