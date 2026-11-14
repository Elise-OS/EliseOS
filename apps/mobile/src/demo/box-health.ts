import type { BoxHealthCheck, BoxHealthReport } from '@elise/contracts';

/**
 * Demo answers of GET /system/box-health and POST /system/box-health/backup, shaped like the real
 * API (apps/api/src/modules/box-health/box-health.service.ts).
 *
 * Screenshots: build the demo app with `EXPO_PUBLIC_BOX_HEALTH_DEMO=<state>` (or, on the web
 * build, add `?boxHealth=<state>` to the address), then open Réglages › Santé de la box.
 * Mirrors apps/dashboard/src/demo/box-health.ts.
 *   ok        everything in order
 *   warning   (default) a few points worth a look, one « impossible de vérifier »
 *   critical  disk almost full, a service stopped for lack of memory, last backup failed
 *   unknown   the host agent does not answer: the box rows cannot be checked
 *   loading   the request never ends (skeleton)
 *   error     the API answers 503 (« Impossible de vérifier »)
 *   backup    like warning, but a backup is already running on the box (as if started from
 *             another device) and never ends
 *             (« Sauvegarde en cours… » stays on screen)
 * Without the parameter (or with `warning`), a backup started from the page ends after 8 s.
 */
export const BOX_HEALTH_DEMO_STATES = [
  'ok',
  'warning',
  'critical',
  'unknown',
  'loading',
  'error',
  'backup',
] as const;
export type BoxHealthDemoState = (typeof BOX_HEALTH_DEMO_STATES)[number];

export const isBoxHealthDemoState = (value: unknown): value is BoxHealthDemoState =>
  (BOX_HEALTH_DEMO_STATES as readonly unknown[]).includes(value);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DEMO_BACKUP_MS = 8_000;

const CONTAINERS = [
  'api',
  'worker',
  'dashboard',
  'postgres',
  'homeassistant',
  'zigbee2mqtt',
  'mosquitto',
];

const containers = (trouble: Record<string, Record<string, unknown>> = {}) =>
  CONTAINERS.map((name) => ({
    name,
    health: name === 'api' || name === 'worker' || name === 'postgres' ? 'healthy' : null,
    restartCount: 0,
    oomKilled: false,
    ...trouble[name],
  }));

const check = (
  id: string,
  level: BoxHealthCheck['level'],
  params: Record<string, unknown>,
  action?: BoxHealthCheck['action'],
): BoxHealthCheck => ({ id, level, params, ...(action ? { action } : {}) });

const verdictOf = (checks: BoxHealthCheck[]): BoxHealthReport['verdict'] =>
  checks.some((item) => item.level === 'critical')
    ? 'critical'
    : checks.some((item) => item.level !== 'ok')
      ? 'warning'
      : 'ok';

/**
 * A report in the given state; `backupAt` is the time of a backup made from the demo page,
 * `backupRunning` whether the box says a backup is on its way.
 */
export function demoBoxHealthReport(
  state: Exclude<BoxHealthDemoState, 'loading' | 'error'>,
  now: number,
  backupAt: number | null = null,
  backupRunning = false,
): BoxHealthReport {
  const hostDown = state === 'unknown';
  const critical = state === 'critical';
  const calm = state === 'ok';
  const lastBackup =
    backupAt !== null
      ? {
          at: new Date(backupAt).toISOString(),
          ok: true,
          sizeBytes: 18_734_112,
          file: 'elise-demo.dump',
          error: null,
        }
      : critical
        ? {
            at: new Date(now - 26 * HOUR).toISOString(),
            ok: false,
            sizeBytes: null,
            file: null,
            error: 'La sauvegarde ou sa vérification a échoué',
          }
        : calm
          ? {
              at: new Date(now - 9 * HOUR).toISOString(),
              ok: true,
              sizeBytes: 18_402_304,
              file: 'elise-demo.dump',
              error: null,
            }
          : hostDown
            ? null
            : {
                at: new Date(now - 4 * DAY - 3 * HOUR).toISOString(),
                ok: true,
                sizeBytes: 17_960_448,
                file: 'elise-demo.dump',
                error: null,
              };
  const backupLevel: BoxHealthCheck['level'] =
    lastBackup === null
      ? 'warning'
      : !lastBackup.ok
        ? 'critical'
        : now - Date.parse(lastBackup.at) > 3 * DAY
          ? 'warning'
          : 'ok';

  const worker = check('worker', 'ok', {
    state: { healthy: true, lastSeenAt: new Date(now - 20_000).toISOString(), failingTasks: [] },
  });
  const zigbee = check('zigbee', 'ok', { available: true }, 'open-zigbee');
  const sensors = check('sensors', 'ok', { count: 9 }, 'open-sensors');
  const notifications = check('notifications', calm || hostDown ? 'ok' : 'warning', {
    failed24h: calm || hostDown ? 0 : 2,
  });
  const outbox = check('outbox', 'ok', { failed: 0 });
  const box = hostDown
    ? [
        check('disk', 'unknown', { usedPercent: null }),
        check('swap', 'unknown', { usedPercent: null }),
        check('temperature', 'unknown', { celsius: null }),
        check('throttling', 'unknown', { flags: null }),
        check('containers', 'unknown', { containers: null }),
        check('disk-errors', 'unknown', { count: null }, 'open-remote-access'),
      ]
    : [
        check('disk', critical ? 'critical' : 'ok', { usedPercent: critical ? 94.2 : 38.4 }),
        check('swap', critical ? 'warning' : 'ok', { usedPercent: critical ? 63.5 : 3.1 }),
        check('temperature', 'ok', { celsius: critical ? [71.2, 68.9] : [51.6, 49.8] }),
        calm || critical
          ? check('throttling', 'ok', { flags: 0 })
          : check('throttling', 'unknown', { flags: null }),
        check('containers', critical ? 'critical' : 'ok', {
          containers: critical
            ? containers({ worker: { restartCount: 3, oomKilled: true } })
            : containers(),
        }),
        check('disk-errors', 'ok', { count: 0 }, 'open-remote-access'),
      ];
  const backup = check('backup', backupLevel, { last: lastBackup }, 'run-backup');
  const database = check('database', 'ok', { sizeBytes: 152_436_736 });
  const remote = check('remote-access', 'ok', { available: true }, 'open-remote-access');

  const groups = [
    { id: 'surveillance', checks: [worker] },
    { id: 'home', checks: [zigbee, sensors] },
    { id: 'notifications', checks: [notifications, outbox] },
    { id: 'box', checks: [...box, backup] },
    { id: 'data', checks: [database] },
    { id: 'access', checks: [remote] },
  ];
  return {
    verdict: verdictOf(groups.flatMap((group) => group.checks)),
    checkedAt: new Date(now).toISOString(),
    groups,
    backup: { running: backupRunning },
  };
}

let backupStartedAt: number | null = null;
// Once a demo backup is over, later reports keep it as the last backup.
let lastDemoBackup: number | null = null;

/** The state asked in the address (`?boxHealth=`), `warning` otherwise. */
export function boxHealthDemoState(search: string): BoxHealthDemoState {
  const asked = new URLSearchParams(search).get('boxHealth');
  return isBoxHealthDemoState(asked) ? asked : 'warning';
}

/**
 * The answer of a box health request, `pending` for a request that never ends, or null when the
 * path is not a box health one.
 */
export function boxHealthDemoAnswer(
  method: string,
  pathname: string,
  state: BoxHealthDemoState,
  now = Date.now(),
): { status: number; body?: unknown } | 'pending' | null {
  if (pathname !== '/system/box-health' && pathname !== '/system/box-health/backup') return null;
  if (state === 'loading') return 'pending';
  if (state === 'error') return { status: 503, body: { message: 'Agent de santé indisponible' } };
  if (pathname.endsWith('/backup')) {
    if (method !== 'POST') return { status: 404 };
    backupStartedAt ??= now;
    return { status: 202, body: { accepted: true } };
  }
  if (method !== 'GET') return { status: 404 };
  if (backupStartedAt !== null && state !== 'backup' && now - backupStartedAt >= DEMO_BACKUP_MS) {
    lastDemoBackup = backupStartedAt + DEMO_BACKUP_MS;
    backupStartedAt = null;
  }
  const running = state === 'backup' || backupStartedAt !== null;
  return { status: 200, body: demoBoxHealthReport(state, now, lastDemoBackup, running) };
}
