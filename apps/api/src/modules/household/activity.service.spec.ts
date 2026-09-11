import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityService } from './activity.service';

describe('ActivityService analytics', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z')));

  it('creates complete hourly buckets and room totals', async () => {
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          timezone: 'Europe/Paris',
          organizationId: 'org-1',
          rooms: [],
          primaryResident: null,
        }),
      },
      observationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'event-1',
            capability: 'motion',
            occurredAt: new Date('2026-08-03T10:10:00.000Z'),
            sensor: { room: { id: 'room-1', name: 'Salon' } },
          },
          {
            id: 'event-2',
            capability: 'contact',
            occurredAt: new Date('2026-08-03T10:25:00.000Z'),
            sensor: { room: { id: 'room-1', name: 'Salon' } },
          },
        ]),
      },
      roomPresenceSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'session-1',
            roomId: 'room-1',
            room: { id: 'room-1', name: 'Salon' },
            startedAt: new Date('2026-08-03T10:00:00.000Z'),
            lastConfirmedAt: new Date('2026-08-03T10:20:00.000Z'),
            endedAt: new Date('2026-08-03T10:30:00.000Z'),
            state: 'CLOSED',
            confidence: 'HIGH',
            excludedFromLearning: false,
          },
        ]),
      },
    };
    const result = await new ActivityService(prisma as never).summary('user-1', '24h');

    expect(result.buckets).toHaveLength(24);
    expect(result.total).toBe(2);
    expect(result.byRoom).toEqual([{ id: 'room-1', name: 'Salon', count: 2 }]);
    expect(result.byCapability).toEqual([
      { capability: 'motion', count: 1 },
      { capability: 'contact', count: 1 },
    ]);
    expect(result.dwellByRoom).toEqual([
      expect.objectContaining({ id: 'room-1', totalSeconds: 1_800, medianSeconds: 1_800 }),
    ]);
  });

  it('never reports normal reassurance when no sensor is installed', async () => {
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          name: 'Maison',
          type: 'HOUSE',
          timezone: 'Europe/Paris',
          learningStartedAt: new Date('2026-07-01T00:00:00.000Z'),
          primaryResident: null,
          rooms: [],
        }),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', displayName: 'Paul Test' }),
      },
      observationEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      alert: { count: vi.fn().mockResolvedValue(0) },
      sensor: { findMany: vi.fn().mockResolvedValue([]) },
      visit: { findFirst: vi.fn().mockResolvedValue(null) },
      appointment: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const result = await new ActivityService(prisma as never).overview('user-1');

    expect(result.reassurance).toBe('INSUFFICIENT_DATA');
  });

  it('confirms a room routine only after coverage, 14 days and 10 reliable sessions', async () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      id: `session-${index}`,
      roomId: 'room-1',
      room: { id: 'room-1', name: 'Salon' },
      startedAt: new Date(`2026-07-${String(20 + index).padStart(2, '0')}T08:00:00.000Z`),
      endedAt: new Date(`2026-07-${String(20 + index).padStart(2, '0')}T08:30:00.000Z`),
      durationSeconds: 1_800,
      state: 'CLOSED',
      confidence: 'HIGH',
      excludedFromLearning: false,
    }));
    const prisma = {
      home: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'home-1',
          timezone: 'Europe/Paris',
          learningStartedAt: new Date('2026-07-01T00:00:00.000Z'),
          rooms: [{ id: 'room-1', name: 'Salon' }],
          primaryResident: null,
        }),
      },
      roomPresenceSession: { findMany: vi.fn().mockResolvedValue(sessions) },
      sensor: { findMany: vi.fn().mockResolvedValue([{ status: 'ONLINE' }]) },
      configurationRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const result = await new ActivityService(prisma as never).routines('user-1');

    expect(result.coverageSufficient).toBe(true);
    expect(result.behavioralAlertsEnabled).toBe(false);
    expect(result.rooms[0]).toMatchObject({ status: 'CONFIRMED', medianSeconds: 1_800 });
  });
});
