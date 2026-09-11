import { describe, expect, it, vi } from 'vitest';
import { PresenceSessionService, type PresenceEvidence } from './presence-session.service';

interface SessionRecord {
  id: string;
  roomId: string;
  state: string;
  startedAt: Date;
  lastConfirmedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  excludedFromLearning: boolean;
  [key: string]: unknown;
}

function harness() {
  const sessions: SessionRecord[] = [];
  const tx = {
    roomPresenceSession: {
      findFirst: vi.fn(({ where }: { where: { state?: { in: string[] }; endedAt?: null } }) => {
        const stateCandidates = where.state
          ? sessions.filter((session) => where.state!.in.includes(session.state))
          : sessions;
        const candidates =
          where.endedAt === null
            ? stateCandidates.filter((session) => session.endedAt === null)
            : stateCandidates;
        return Promise.resolve(
          [...candidates].sort(
            (a, b) => b.lastConfirmedAt.getTime() - a.lastConfirmedAt.getTime(),
          )[0] ?? null,
        );
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const session: SessionRecord = {
          ...data,
          id: `session-${sessions.length + 1}`,
          roomId: typeof data.roomId === 'string' ? data.roomId : '',
          state: typeof data.state === 'string' ? data.state : 'OPEN',
          startedAt: data.startedAt instanceof Date ? data.startedAt : new Date(0),
          lastConfirmedAt:
            data.lastConfirmedAt instanceof Date ? data.lastConfirmedAt : new Date(0),
          endedAt: null,
          durationSeconds: null,
          excludedFromLearning: Boolean(data.excludedFromLearning),
        };
        sessions.push(session);
        return Promise.resolve(session);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<SessionRecord> }) => {
        const session = sessions.find((item) => item.id === where.id)!;
        Object.assign(session, data);
        return Promise.resolve(session);
      }),
      deleteMany: vi.fn(),
    },
    visit: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { tx, sessions };
}

function evidence(overrides: Partial<PresenceEvidence> = {}): PresenceEvidence {
  return {
    eventId: 'event-1',
    homeId: 'home-1',
    residentId: 'resident-1',
    roomId: 'salon',
    sensorId: 'sensor-1',
    capability: 'motion',
    active: true,
    occurredAt: new Date('2026-08-21T08:00:00.000Z'),
    confidence: 'HIGH',
    source: 'SENSOR',
    connectedRoomIds: new Set(['couloir:salon', 'couloir:cuisine']),
    ...overrides,
  };
}

describe('PresenceSessionService', () => {
  it('does not create presence from an inactive event or a door contact', async () => {
    const { tx, sessions } = harness();
    const service = new PresenceSessionService();

    await service.process(tx as never, evidence({ active: false }));
    await service.process(tx as never, evidence({ capability: 'contact', active: true }));

    expect(sessions).toHaveLength(0);
  });

  it('extends repeated movement in the same room', async () => {
    const { tx, sessions } = harness();
    const service = new PresenceSessionService();
    await service.process(tx as never, evidence());
    await service.process(
      tx as never,
      evidence({ eventId: 'event-2', occurredAt: new Date('2026-08-21T08:05:00.000Z') }),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.lastConfirmedAt).toEqual(new Date('2026-08-21T08:05:00.000Z'));
  });

  it('builds salon, corridor and kitchen sessions with transition durations', async () => {
    const { tx, sessions } = harness();
    const service = new PresenceSessionService();
    await service.process(tx as never, evidence());
    await service.process(
      tx as never,
      evidence({
        eventId: 'event-2',
        roomId: 'couloir',
        occurredAt: new Date('2026-08-21T08:03:00.000Z'),
      }),
    );
    await service.process(
      tx as never,
      evidence({
        eventId: 'event-3',
        roomId: 'cuisine',
        occurredAt: new Date('2026-08-21T08:07:00.000Z'),
      }),
    );

    expect(sessions.map((session) => session.roomId)).toEqual(['salon', 'couloir', 'cuisine']);
    expect(sessions[0]).toMatchObject({ state: 'CLOSED', durationSeconds: 180 });
    expect(sessions[1]).toMatchObject({ state: 'CLOSED', durationSeconds: 240 });
    expect(sessions[2]).toMatchObject({ state: 'OPEN' });
  });

  it('marks near-simultaneous rooms as ambiguous and excludes them from learning', async () => {
    const { tx, sessions } = harness();
    const service = new PresenceSessionService();
    await service.process(tx as never, evidence({ capability: 'occupancy' }));
    await service.process(
      tx as never,
      evidence({
        eventId: 'event-2',
        roomId: 'couloir',
        occurredAt: new Date('2026-08-21T08:00:30.000Z'),
      }),
    );

    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.state === 'AMBIGUOUS')).toBe(true);
    expect(sessions.every((session) => session.excludedFromLearning)).toBe(true);
  });
});
