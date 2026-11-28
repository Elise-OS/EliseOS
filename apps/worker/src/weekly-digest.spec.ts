import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = { query: vi.fn(), release: vi.fn() };
const pool = { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) };
vi.mock('./db.js', () => ({ pool }));

const { notifyWeeklyDigests, weeklyDigestDue, WEEKLY_DIGEST_PUSH } =
  await import('./weekly-digest.js');

describe('weekly digest push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [{ homeId: 'home-1', timezone: 'Europe/Paris' }] });
  });

  it('is due on Sunday from 20:00, local time, for the week that ends', () => {
    // Paris is UTC+1 on 22 November 2026.
    expect(weeklyDigestDue(new Date('2026-11-22T18:59:00Z'), 'Europe/Paris')).toBeNull();
    expect(weeklyDigestDue(new Date('2026-11-22T19:00:00Z'), 'Europe/Paris')).toBe('2026-11-16');
    expect(weeklyDigestDue(new Date('2026-11-22T22:59:00Z'), 'Europe/Paris')).toBe('2026-11-16');
    expect(weeklyDigestDue(new Date('2026-11-23T08:00:00Z'), 'Europe/Paris')).toBeNull();
    expect(weeklyDigestDue(new Date('2026-11-21T20:00:00Z'), 'Europe/Paris')).toBeNull();
  });

  it('queues one push without any detail of the week, then remembers it', async () => {
    client.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('FROM "AuditLog"') ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] },
      ),
    );
    expect(await notifyWeeklyDigests(new Date('2026-11-22T19:05:00Z'))).toBe(1);
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('"OutboxMessage"'));
    expect(insert?.[1]).toEqual([
      'home-1',
      '2026-11-16',
      WEEKLY_DIGEST_PUSH.title,
      WEEKLY_DIGEST_PUSH.body,
    ]);
    expect(String(insert?.[0])).toContain("'liaisonMessages'");
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('WEEKLY_DIGEST_READY')),
    ).toBe(true);
    expect(WEEKLY_DIGEST_PUSH.body).not.toMatch(/\d/);
  });

  it('never sends the same week twice', async () => {
    client.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('FROM "AuditLog"') ? { rowCount: 1, rows: [{}] } : { rowCount: 1, rows: [] },
      ),
    );
    expect(await notifyWeeklyDigests(new Date('2026-11-22T19:30:00Z'))).toBe(0);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('"OutboxMessage"'))).toBe(
      false,
    );
  });

  it('sends nothing on other days', async () => {
    expect(await notifyWeeklyDigests(new Date('2026-11-20T19:30:00Z'))).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
