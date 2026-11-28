import { createWeeklyDigestDemo, emptyWeeklyDigestMetrics } from '@elise/contracts';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../platform/prisma.service';
import { WeeklyDigestService } from './weekly-digest.service';

const NOW = new Date('2026-11-25T10:00:00Z'); // Wednesday: the latest ready week is 16–22 Nov.

/** Measures of the demo, used as stored snapshots. */
const demo = createWeeklyDigestDemo({
  now: () => new Date('2026-11-23T10:00:00Z'),
  labels: {
    visitors: { help: 'Sophie', son: 'Luc', daughter: 'Claire' },
    appointment: 'Dr Bernard',
    alertMorning: 'Pas de mouvement ce matin',
    alertBattery: 'Pile faible',
    sensorName: 'Détecteur',
    sensorRoom: 'Salle de bain',
  },
});

function prismaFor(options: { member?: boolean; snapshots?: boolean } = {}) {
  const member = options.member ?? true;
  const snapshots = options.snapshots ?? true;
  const prisma = {
    home: {
      findFirst: vi.fn().mockResolvedValue(
        member
          ? {
              id: 'home-1',
              timezone: 'Europe/Paris',
              createdAt: new Date('2026-08-01T10:00:00Z'),
              primaryResident: {
                id: 'resident-1',
                firstName: 'Jeanne',
                preferredName: null,
                displayName: 'Jeanne Martin',
              },
            }
          : null,
      ),
    },
    weeklyDigestSnapshot: {
      findUnique: vi.fn(({ where }: { where: { homeId_weekStart: { weekStart: string } } }) => {
        if (!snapshots) return Promise.resolve(null);
        const week = where.homeId_weekStart.weekStart;
        return Promise.resolve({
          metrics: demo.digest(week)?.metrics ?? emptyWeeklyDigestMetrics(week),
        });
      }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    sensor: { findMany: vi.fn().mockResolvedValue([]) },
    room: { findMany: vi.fn().mockResolvedValue([]) },
    homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
    observationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    roomPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
    residentScreen: { findUnique: vi.fn().mockResolvedValue(null) },
    habitProfile: { findMany: vi.fn().mockResolvedValue([]) },
    visit: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'visit-1',
          visitorName: 'Sophie Bernard',
          startsAt: new Date('2026-11-18T09:00:00Z'),
          completedAt: new Date('2026-11-18T11:00:00Z'),
        },
      ]),
    },
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
    alert: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'alert-1',
          openedAt: new Date('2026-11-20T17:00:00Z'),
          title: 'Batterie faible pour Détecteur salle de bain',
          severity: 'INFO',
          type: 'LOW_BATTERY',
          status: 'OPEN',
          ruleKey: 'low-battery:sensor-battery',
          room: { name: 'Salle de bain' },
        },
      ]),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return prisma;
}

const service = (prisma: ReturnType<typeof prismaFor>) =>
  new WeeklyDigestService(prisma as unknown as PrismaService);

describe('WeeklyDigestService', () => {
  it('only answers members of the household', async () => {
    await expect(
      service(prismaFor({ member: false })).digest('user', undefined, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives the latest ready week, with the calendar and the alerts of the week', async () => {
    const prisma = prismaFor();
    const digest = await service(prisma).digest('user', undefined, NOW);
    expect(digest.weekStart).toBe('2026-11-16');
    expect(digest.weekEnd).toBe('2026-11-22');
    expect(digest.residentName).toBe('Jeanne');
    expect(digest.previousWeek).toBe('2026-11-09');
    expect(digest.nextWeek).toBeNull();
    expect(digest.comparisonWeeks).toBe(4);
    expect(digest.visits).toEqual([
      {
        id: 'visit-1',
        name: 'Sophie Bernard',
        startsAt: '2026-11-18T09:00:00.000Z',
        confirmed: true,
      },
    ]);
    expect(digest.sensorIssues).toEqual([
      expect.objectContaining({ kind: 'LOW_BATTERY', roomName: 'Salle de bain' }),
    ]);
    expect(digest.changes.some((item) => item.key === 'wakeLater')).toBe(true);
    // Stored weeks are read back, not computed again.
    expect(prisma.observationEvent.findMany).not.toHaveBeenCalled();
  });

  it('refuses a week that is not over yet, or older than the home', async () => {
    await expect(service(prismaFor()).digest('user', '2026-11-24', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service(prismaFor()).digest('user', '2026-07-01', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('computes a finished week from the events and keeps its measures', async () => {
    const prisma = prismaFor({ snapshots: false });
    const digest = await service(prisma).digest('user', '2026-11-16', NOW);
    expect(prisma.observationEvent.findMany).toHaveBeenCalled();
    expect(prisma.weeklyDigestSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { homeId_weekStart: { homeId: 'home-1', weekStart: '2026-11-16' } },
      }),
    );
    // No sensor at all: nothing is invented.
    expect(digest.nights.state).toBe('NOT_EQUIPPED');
    expect(digest.summary.key).toBe('summaryNoData');
  });

  it('does not keep the measures of a week still in progress', async () => {
    const prisma = prismaFor({ snapshots: false });
    // Sunday 22 November at 21:00 in Paris: the week is ready but its night is not over.
    await service(prisma).digest('user', undefined, new Date('2026-11-22T20:00:00Z'));
    const stored = prisma.weeklyDigestSnapshot.upsert.mock.calls.map(
      (call) => (call[0] as { create: { weekStart: string } }).create.weekStart,
    );
    expect(stored).not.toContain('2026-11-16');
    expect(stored).toContain('2026-11-09');
  });

  it('makes a real one-page PDF on the box', async () => {
    const file = await service(prismaFor()).pdf('user', undefined, 'fr', NOW);
    expect(file.fileName).toBe('bilan-semaine-2026-11-16.pdf');
    expect(file.bytes.length).toBeGreaterThan(5_000);
    const head = Buffer.from(file.bytes.slice(0, 5)).toString('latin1');
    expect(head).toBe('%PDF-');
    const text = Buffer.from(file.bytes).toString('latin1');
    expect(text).toMatch(/\/Count 1\b/);
  });
});
