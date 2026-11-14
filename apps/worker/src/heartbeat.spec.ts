import { describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ pool: { query: vi.fn() } }));

const { FAILING_TASK_GRACE_MS, trackFailingTasks } = await import('./heartbeat.js');

describe('trackFailingTasks', () => {
  const all = ['sensor-rules', 'inactivity'];

  it('reports a task only once it has failed without interruption past the grace period', () => {
    let time = 0;
    const failing = trackFailingTasks(() => time);
    failing.record(['sensor-rules'], all);
    expect(failing.persistent()).toEqual([]);
    time = FAILING_TASK_GRACE_MS;
    failing.record(['sensor-rules'], all);
    expect(failing.persistent()).toEqual(['sensor-rules']);
  });

  it('forgets a task as soon as it succeeds again', () => {
    let time = 0;
    const failing = trackFailingTasks(() => time);
    failing.record(['sensor-rules'], all);
    time = FAILING_TASK_GRACE_MS;
    failing.record([], all);
    expect(failing.persistent()).toEqual([]);
  });
});
