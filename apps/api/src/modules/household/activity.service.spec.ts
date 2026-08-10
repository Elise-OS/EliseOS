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
    };
    const result = await new ActivityService(prisma as never).summary('user-1', '24h');

    expect(result.buckets).toHaveLength(24);
    expect(result.total).toBe(2);
    expect(result.byRoom).toEqual([{ id: 'room-1', name: 'Salon', count: 2 }]);
    expect(result.byCapability).toEqual([
      { capability: 'motion', count: 1 },
      { capability: 'contact', count: 1 },
    ]);
  });
});
