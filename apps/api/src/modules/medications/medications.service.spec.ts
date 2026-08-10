import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MedicationsService } from './medications.service';

const home = {
  id: 'home-1',
  timezone: 'Europe/Paris',
  primaryResidentId: 'resident-1',
};

function medication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'medication-1',
    active: true,
    startsOn: null,
    endsOn: null,
    schedules: [
      {
        id: 'schedule-1',
        minuteOfDay: 8 * 60 + 30,
        graceMinutes: 60,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        active: true,
      },
    ],
    ...overrides,
  };
}

describe('MedicationsService', () => {
  it('generates a daily dose through the unique schedule/time key', async () => {
    const uniqueDoses = new Set<string>();
    const upsert = vi.fn(({ where }: { where: { scheduleId_scheduledFor: object } }) => {
      uniqueDoses.add(JSON.stringify(where.scheduleId_scheduledFor));
      return Promise.resolve();
    });
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(home) },
      medication: { findMany: vi.fn().mockResolvedValue([medication()]) },
      medicationDose: { upsert, findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new MedicationsService(prisma as never);

    await service.doses('caregiver-1', '2026-08-09', '2026-08-09');
    await service.doses('caregiver-1', '2026-08-09', '2026-08-09');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(uniqueDoses.size).toBe(1);
    const upsertCall = upsert.mock.calls[0]?.[0];
    expect(upsertCall?.where.scheduleId_scheduledFor).toEqual({
      scheduleId: 'schedule-1',
      scheduledFor: new Date('2026-08-09T06:30:00.000Z'),
    });
  });

  it('does not generate a dose after a treatment end date', async () => {
    const upsert = vi.fn();
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(home) },
      medication: {
        findMany: vi
          .fn()
          .mockResolvedValue([medication({ endsOn: new Date('2026-08-08T12:00:00.000Z') })]),
      },
      medicationDose: { upsert, findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new MedicationsService(prisma as never);

    await service.doses('caregiver-1', '2026-08-09', '2026-08-09');

    expect(upsert).not.toHaveBeenCalled();
  });

  it('confirms a late dose and resolves its prudent alert', async () => {
    const tx = {
      medicationDose: {
        update: vi.fn().mockResolvedValue({
          id: 'dose-1',
          status: 'TAKEN',
          schedule: { medication: { name: 'Traitement du matin' } },
        }),
      },
      alert: {
        findFirst: vi.fn().mockResolvedValue({ id: 'alert-1', status: 'OPEN' }),
        update: vi.fn(),
      },
      alertTransition: { create: vi.fn() },
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(home) },
      medicationDose: { findFirst: vi.fn().mockResolvedValue({ id: 'dose-1' }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MedicationsService(prisma as never);

    await service.confirm('caregiver-1', 'dose-1', 'TAKEN');

    expect(tx.alert.findFirst).toHaveBeenCalledWith({
      where: {
        homeId: 'home-1',
        ruleKey: 'medication:dose-1',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    });
    const alertUpdate = tx.alert.update.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
      data: { status: string; resolvedAt: unknown };
    };
    expect(alertUpdate.where).toEqual({ id: 'alert-1' });
    expect(alertUpdate.data.status).toBe('RESOLVED');
    expect(alertUpdate.data.resolvedAt).toBeInstanceOf(Date);
    const transition = tx.alertTransition.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(transition.data).toEqual({
      alertId: 'alert-1',
      userId: 'caregiver-1',
      from: 'OPEN',
      to: 'RESOLVED',
      note: 'Prise confirmée',
    });
  });

  it('allows a caregiver to confirm but denies a reader', async () => {
    const allowedPrisma = {
      home: { findFirst: vi.fn().mockResolvedValue(home) },
      medicationDose: { findFirst: vi.fn().mockResolvedValue({ id: 'dose-1' }) },
      $transaction: vi.fn(() => Promise.resolve({ id: 'dose-1', status: 'TAKEN' })),
    };
    await expect(
      new MedicationsService(allowedPrisma as never).confirm('caregiver-1', 'dose-1', 'TAKEN'),
    ).resolves.toEqual({ id: 'dose-1', status: 'TAKEN' });

    const deniedPrisma = { home: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(
      new MedicationsService(deniedPrisma as never).confirm('reader-1', 'dose-1', 'TAKEN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const deniedAccess = deniedPrisma.home.findFirst.mock.calls[0]?.[0] as unknown as {
      where: {
        organization: { memberships: { some: { systemRole: { in: string[] } } } };
      };
    };
    expect(deniedAccess.where.organization.memberships.some.systemRole.in).toEqual([
      'OWNER',
      'ADMINISTRATOR',
      'CAREGIVER',
    ]);
  });
});
