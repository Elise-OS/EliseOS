import { setTimeout as delay } from 'node:timers/promises';
import { pool } from './db.js';
import {
  evaluateInactivity,
  evaluateMedicationDoses,
  evaluateSensorRules,
  resolveClearedSecurityAlerts,
} from './evaluators.js';
import { beat, trackFailingTasks } from './heartbeat.js';
import { listenForOutbox } from './outbox-listener.js';
import { processNextMessage } from './outbox.js';
import {
  calculatePresenceAggregates,
  evaluateBehavioralDwell,
  maintainPresenceSessions,
  maintainTopologicalPresence,
  scorePresenceSessionsInShadowMode,
  trainEligibleHomes,
} from './presence.js';
import { applyRetention } from './retention.js';
import { createScheduler, type PeriodicTask } from './scheduler.js';
import { createWakeSignal } from './wake-signal.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Messages handled per cycle before the periodic tasks get their turn again. */
const OUTBOX_BATCH = 25;

const tasks: PeriodicTask[] = [
  { name: 'sensor-rules', everyMs: MINUTE, run: evaluateSensorRules },
  { name: 'cleared-security-alerts', everyMs: MINUTE, run: resolveClearedSecurityAlerts },
  { name: 'inactivity', everyMs: MINUTE, run: evaluateInactivity },
  { name: 'medication-doses', everyMs: MINUTE, run: evaluateMedicationDoses },
  {
    name: 'presence-sessions',
    everyMs: MINUTE,
    run: async () => {
      await maintainPresenceSessions();
      await evaluateBehavioralDwell();
      await scorePresenceSessionsInShadowMode();
    },
  },
  { name: 'topological-presence', everyMs: 5_000, run: maintainTopologicalPresence },
  { name: 'presence-aggregates', everyMs: DAY, run: calculatePresenceAggregates },
  { name: 'retention', everyMs: DAY, run: applyRetention },
  { name: 'training', everyMs: DAY, run: trainEligibleHomes },
];

let running = true;
const wakeSignal = createWakeSignal();
const stop = (): void => {
  running = false;
  wakeSignal.notify();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function main(): Promise<void> {
  const taskNames = tasks.map((task) => task.name);
  const failing = trackFailingTasks();
  const heartbeat = (): Promise<void> =>
    beat(failing.persistent()).catch((error: unknown) =>
      console.error('Worker heartbeat could not be recorded.', error),
    );
  const scheduler = createScheduler(tasks, {
    onError: (task, error) =>
      console.error(`Worker task "${task}" failed; the other tasks keep running.`, error),
    // A long task (model training, daily aggregates) must not look like a stalled worker.
    afterEach: heartbeat,
  });
  const listener = listenForOutbox(process.env.DATABASE_URL, () => wakeSignal.notify());

  while (running) {
    // The outbox goes first: a queued SOS push must never wait behind, or be blocked by,
    // a periodic evaluation.
    let processed = 0;
    let outboxFailed = false;
    try {
      while (running && processed < OUTBOX_BATCH && (await processNextMessage())) processed += 1;
    } catch (error) {
      outboxFailed = true;
      console.error('Worker outbox cycle failed; retrying.', error);
    }

    failing.record(await scheduler.runDue(), taskNames);
    await heartbeat();

    if (outboxFailed) await delay(5_000);
    else if (processed < OUTBOX_BATCH) await wakeSignal.wait(1_000);
  }
  await listener.close();
  await pool.end();
}

void main();
