import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWakeSignal } from './wake-signal.js';

describe('createWakeSignal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('wakes as soon as a notification arrives', async () => {
    const signal = createWakeSignal();
    const done = vi.fn();
    const waiting = signal.wait(1_000).then(done);
    await vi.advanceTimersByTimeAsync(10);
    expect(done).not.toHaveBeenCalled();
    signal.notify();
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('falls back to the timeout when nothing arrives', async () => {
    const signal = createWakeSignal();
    const done = vi.fn();
    void signal.wait(1_000).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('remembers a notification received while the worker was busy, once', async () => {
    const signal = createWakeSignal();
    signal.notify();
    const first = vi.fn();
    await signal.wait(1_000).then(first);
    expect(first).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    void signal.wait(1_000).then(second);
    await vi.advanceTimersByTimeAsync(500);
    expect(second).not.toHaveBeenCalled();
  });
});
