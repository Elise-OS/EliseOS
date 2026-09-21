import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { calendarCreateSchema } from '@michel/contracts';
import { CalendarService } from './calendar.service';

function fixture() {
  const tx = {
    visit: {
      create: vi.fn().mockResolvedValue({ id: 'visit-1' }),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    appointment: {
      create: vi.fn().mockResolvedValue({ id: 'appointment-1' }),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
  const prisma = {
    home: { findFirst: vi.fn().mockResolvedValue({ id: 'home', timezone: 'Europe/Paris' }) },
    visit: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    appointment: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    membership: { findFirst: vi.fn().mockResolvedValue({ userId: 'writer' }) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx, service: new CalendarService(prisma as never) };
}

describe('shared calendar', () => {
  it('generates weekly occurrences and keeps them in one series', async () => {
    const { service, tx } = fixture();
    await service.create(
      'writer',
      calendarCreateSchema.parse({
        type: 'VISIT',
        visitorName: 'Sophie',
        startsAt: '2026-09-21T08:00:00.000Z',
        endsAt: '2026-09-21T09:00:00.000Z',
        notes: null,
        recurrence: 'WEEKLY',
        recurrenceUntil: '2026-10-12T23:59:00.000Z',
      }),
    );
    expect(tx.visit.create).toHaveBeenCalledTimes(4);
    expect(tx.visit.create.mock.calls.every((call) => call[0].data.seriesId)).toBe(true);
    expect(new Set(tx.visit.create.mock.calls.map((call) => call[0].data.seriesId)).size).toBe(1);
  });

  it('refuses every write without the caregiver role', async () => {
    const { service, prisma, tx } = fixture();
    prisma.home.findFirst.mockResolvedValue(null);
    await expect(
      service.create(
        'reader',
        calendarCreateSchema.parse({
          type: 'APPOINTMENT',
          title: 'Médecin',
          startsAt: '2026-09-21T08:00:00.000Z',
          endsAt: null,
          location: null,
          notes: null,
          recurrence: 'NONE',
          recurrenceUntil: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.visit.create).not.toHaveBeenCalled();
  });

  it('isolates reads to the authenticated home and returns write capability', async () => {
    const { service, prisma } = fixture();
    await service.list('writer', new Date('2026-09-01'), new Date('2026-10-01'));
    expect(prisma.visit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ homeId: 'home' }) }),
    );
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ homeId: 'home' }) }),
    );
  });
});
