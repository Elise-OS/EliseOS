import { describe, expect, it, vi } from 'vitest';
import {
  readWorkerState,
  WORKER_STALE_AFTER_MS,
  WorkerWatchdogService,
} from './worker-watchdog.service';

const now = new Date('2026-11-14T10:00:00.000Z');
const heartbeat = (ageMs: number, failingTasks: string[] = []) =>
  JSON.stringify({ at: new Date(now.getTime() - ageMs).toISOString(), failingTasks });

describe('readWorkerState', () => {
  it('is healthy with a recent heartbeat and no failing task', () => {
    expect(readWorkerState(heartbeat(20_000), now).healthy).toBe(true);
  });

  it('is unhealthy without a heartbeat, with a stale one or an unreadable one', () => {
    expect(readWorkerState(null, now).healthy).toBe(false);
    expect(readWorkerState(heartbeat(WORKER_STALE_AFTER_MS), now).healthy).toBe(false);
    expect(readWorkerState('not json', now)).toEqual({
      healthy: false,
      lastSeenAt: null,
      failingTasks: [],
    });
  });

  it('is unhealthy when an evaluation keeps failing, even with a fresh heartbeat', () => {
    const state = readWorkerState(heartbeat(1_000, ['sensor-rules']), now);
    expect(state.healthy).toBe(false);
    expect(state.failingTasks).toEqual(['sensor-rules']);
  });
});

describe('WorkerWatchdogService', () => {
  const build = (value: string | null, latest: unknown) => {
    const prisma = {
      systemSetting: { findUnique: vi.fn().mockResolvedValue(value ? { value } : null) },
      home: { findMany: vi.fn().mockResolvedValue([{ id: 'home_1' }]) },
      alert: {
        findFirst: vi.fn().mockResolvedValue(latest),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      alertTransition: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const service = new WorkerWatchdogService(prisma as never);
    // Past the start-up grace period.
    const later = new Date(Date.now() + WORKER_STALE_AFTER_MS + 1_000);
    return { prisma, service, later };
  };

  it('does not judge the worker during the start-up grace period', async () => {
    const { prisma, service } = build(null, null);
    await service.check(new Date());
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('opens an urgent system alert when the worker has stopped', async () => {
    const { prisma, service, later } = build(null, null);
    await service.check(later);
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        homeId: 'home_1',
        type: 'SYSTEM',
        severity: 'URGENT',
        ruleKey: 'system:worker',
      }) as unknown,
    });
  });

  it('does not re-open an alert closed by hand while the worker is still down', async () => {
    const { prisma, service, later } = build(null, {
      id: 'alert_1',
      status: 'RESOLVED',
      conditionClearedAt: null,
    });
    await service.check(later);
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('resolves the alert once the worker is back', async () => {
    const { prisma, service, later } = build(
      JSON.stringify({ at: new Date(Date.now() + WORKER_STALE_AFTER_MS).toISOString() }),
      { id: 'alert_1', status: 'OPEN', conditionClearedAt: null },
    );
    await service.check(later);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.alertTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertId: 'alert_1',
        from: 'OPEN',
        to: 'RESOLVED',
      }) as unknown,
    });
  });
});
