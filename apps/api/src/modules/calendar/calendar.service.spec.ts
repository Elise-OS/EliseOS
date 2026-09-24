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
  it('generates one appointment for each day in a seven-day repetition', async () => {
    const { service, tx } = fixture();
    await service.create(
      'writer',
      calendarCreateSchema.parse({
        type: 'APPOINTMENT',
        title: 'Médecin',
        startsAt: '2026-09-21T08:00:00.000Z',
        endsAt: '2026-09-21T09:00:00.000Z',
        location: null,
        notes: null,
        recurrence: 'DAILY',
        recurrenceUntil: '2026-09-27T23:59:00.000Z',
      }),
    );
    expect(tx.appointment.create).toHaveBeenCalledTimes(7);
    const calls = tx.appointment.create.mock.calls as unknown as Array<
      [{ data: { startsAt: Date; seriesId?: string } }]
    >;
    expect(calls.map((call) => call[0].data.startsAt.toISOString().slice(0, 10))).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(new Set(calls.map((call) => call[0].data.seriesId)).size).toBe(1);
  });

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
    const calls = tx.visit.create.mock.calls as unknown as Array<[{ data: { seriesId?: string } }]>;
    expect(calls.every((call) => call[0].data.seriesId)).toBe(true);
    expect(new Set(calls.map((call) => call[0].data.seriesId)).size).toBe(1);
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
    const homeQuery = {
      where: expect.objectContaining({ homeId: 'home' }) as unknown,
    };
    expect(prisma.visit.findMany).toHaveBeenCalledWith(
      expect.objectContaining(homeQuery) as unknown,
    );
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining(homeQuery) as unknown,
    );
  });
});
