import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from './scheduler.js';

describe('createScheduler', () => {
  it('keeps running the other tasks when one keeps failing', async () => {
    const time = 0;
    const broken = vi.fn().mockRejectedValue(new Error('boom'));
    const healthy = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = createScheduler(
      [
        { name: 'broken', everyMs: 60_000, run: broken },
        { name: 'healthy', everyMs: 60_000, run: healthy },
      ],
      { now: () => time, onError },
    );

    await expect(scheduler.runDue()).resolves.toEqual(['broken']);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('broken', expect.any(Error));
  });

  it('retries a failed task after the retry delay, not on every cycle', async () => {
    let time = 0;
    const broken = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = createScheduler([{ name: 'broken', everyMs: 60_000, run: broken }], {
      now: () => time,
      retryMs: 5_000,
    });

    await scheduler.runDue();
    time = 1_000;
    await scheduler.runDue();
    expect(broken).toHaveBeenCalledTimes(1);
    time = 5_000;
    await scheduler.runDue();
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it('waits for the full interval after a success', async () => {
    let time = 0;
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler([{ name: 'task', everyMs: 60_000, run }], {
      now: () => time,
    });

    await scheduler.runDue();
    time = 59_999;
    await scheduler.runDue();
    expect(run).toHaveBeenCalledTimes(1);
    time = 60_000;
    await scheduler.runDue();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
