import { promises as fs } from 'node:fs';
import { pool } from './db.js';

export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
const HEARTBEAT_FILE = process.env.ELISE_WORKER_HEARTBEAT_FILE ?? '/tmp/elise-worker-heartbeat';
const DATABASE_INTERVAL_MS = 15_000;
/** A task must fail for this long before the family is told the worker needs attention. */
export const FAILING_TASK_GRACE_MS = 5 * 60_000;

/** Names of the tasks that have been failing without interruption for longer than the grace period. */
export function trackFailingTasks(now: () => number = Date.now) {
  const failingSince = new Map<string, number>();
  return {
    record(failedThisCycle: string[], allTasks: string[]): void {
      for (const name of allTasks) {
        if (!failedThisCycle.includes(name)) failingSince.delete(name);
        else if (!failingSince.has(name)) failingSince.set(name, now());
      }
    },
    persistent(): string[] {
      return [...failingSince.entries()]
        .filter(([, since]) => now() - since >= FAILING_TASK_GRACE_MS)
        .map(([name]) => name)
        .sort();
    },
  };
}

let lastDatabaseBeat = 0;

/**
 * Proves the worker loop is alive: a file for the container healthcheck, and a database row
 * the API reads to raise an explicit system alert when the worker stops or keeps failing.
 */
export async function beat(failingTasks: string[]): Promise<void> {
  await fs.writeFile(HEARTBEAT_FILE, new Date().toISOString()).catch(() => undefined);
  if (Date.now() - lastDatabaseBeat < DATABASE_INTERVAL_MS) return;
  await pool.query(
    `INSERT INTO "SystemSetting" (key, value, "createdAt", "updatedAt") VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [WORKER_HEARTBEAT_KEY, JSON.stringify({ at: new Date().toISOString(), failingTasks })],
  );
  lastDatabaseBeat = Date.now();
}
