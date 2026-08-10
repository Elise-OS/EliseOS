import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALERT_RULE_SETTINGS } from '@michel/contracts';
import { AlertsService } from './alerts.service';

describe('AlertsService rules', () => {
  it('returns prudent defaults when no rule revision exists', async () => {
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      configurationRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new AlertsService(prisma as never);

    await expect(service.rules('owner-1')).resolves.toEqual(DEFAULT_ALERT_RULE_SETTINGS);
  });

  it('requires administrator access to read rule settings', async () => {
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
      systemRole: { in: ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] },
    });
  });
});
