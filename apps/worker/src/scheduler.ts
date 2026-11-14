export interface PeriodicTask {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

export interface SchedulerOptions {
  now?: () => number;
  onError?: (task: string, error: unknown) => void;
  /** A failing task is retried after this delay instead of on every cycle. */
  retryMs?: number;
  /** Called after every task, whatever its outcome (the worker records its heartbeat there). */
  afterEach?: () => Promise<void>;
}

/**
 * Runs each periodic task in isolation: one task that keeps failing never prevents
 * the others, nor the outbox, from running.
 */
export function createScheduler(tasks: PeriodicTask[], options: SchedulerOptions = {}) {
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? 5_000;
  const nextRunAt = new Map<string, number>(tasks.map((task) => [task.name, 0]));
  return {
    async runDue(): Promise<string[]> {
      const failed: string[] = [];
      for (const task of tasks) {
        if (now() < (nextRunAt.get(task.name) ?? 0)) continue;
        try {
          await task.run();
          nextRunAt.set(task.name, now() + task.everyMs);
        } catch (error) {
          failed.push(task.name);
          nextRunAt.set(task.name, now() + Math.min(retryMs, task.everyMs));
          options.onError?.(task.name, error);
        }
        await options.afterEach?.();
      }
      return failed;
    },
  };
}
