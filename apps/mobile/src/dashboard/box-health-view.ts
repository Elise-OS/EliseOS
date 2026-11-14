import type {
  BoxHealthAction,
  BoxHealthCheck,
  BoxHealthLevel,
  BoxHealthReport,
  MembershipRole,
} from '@elise/contracts';

/**
 * Pure rules of the "Box health" screen, kept apart from React so they can be tested.
 * Product rule: a check Élise could not read ('unknown') is never shown as fine.
 */

export const BOX_HEALTH_GROUP_IDS = [
  'monitoring',
  'home',
  'notifications',
  'box',
  'data',
  'access',
] as const;
export type BoxHealthGroupId = (typeof BOX_HEALTH_GROUP_IDS)[number];

export const BOX_HEALTH_CHECK_IDS = [
  'worker',
  'last-event',
  'coverage',
  'home-assistant',
  'zigbee',
  'sensors-offline',
  'sensors-battery',
  'deliveries',
  'outbox',
  'disk',
  'memory',
  'temperature',
  'throttling',
  'containers',
  'storage-errors',
  'backup',
  'db-size',
  'remote-access',
] as const;
export type BoxHealthCheckId = (typeof BOX_HEALTH_CHECK_IDS)[number];

/** How a level looks: 'unknown' looks like "to keep an eye on", never like "ok". */
export type BoxHealthTone = 'ok' | 'warning' | 'critical';
/** What the banner says. 'unchecked' = verdict ok on paper, but some points could not be read. */
export type BoxHealthBanner = 'ok' | 'warning' | 'unchecked' | 'critical' | 'unavailable';

/** Only owners and administrators see and open the box health screen. */
export const canManageBox = (role: MembershipRole) => role === 'OWNER' || role === 'ADMINISTRATOR';

export const toneOf = (level: BoxHealthLevel): BoxHealthTone =>
  level === 'ok' ? 'ok' : level === 'critical' ? 'critical' : 'warning';

const allChecks = (report: BoxHealthReport) => report.groups.flatMap((group) => group.checks);

/** The banner never says "all good" while a point is unreadable or worse. */
export function bannerOf(report: BoxHealthReport | null, failed: boolean): BoxHealthBanner {
  if (failed || !report) return 'unavailable';
  const checks = allChecks(report);
  if (report.verdict === 'critical' || checks.some((check) => check.level === 'critical'))
    return 'critical';
  if (report.verdict === 'warning' || checks.some((check) => check.level === 'warning'))
    return 'warning';
  if (checks.some((check) => check.level === 'unknown')) return 'unchecked';
  return 'ok';
}

export const isKnownGroup = (id: string): id is BoxHealthGroupId =>
  (BOX_HEALTH_GROUP_IDS as readonly string[]).includes(id);
export const isKnownCheck = (id: string): id is BoxHealthCheckId =>
  (BOX_HEALTH_CHECK_IDS as readonly string[]).includes(id);

/** Known groups first, in the order of the screen; unknown groups keep their order at the end. */
export function orderedGroups(report: BoxHealthReport) {
  const rank = (id: string) => {
    const index = (BOX_HEALTH_GROUP_IDS as readonly string[]).indexOf(id);
    return index < 0 ? BOX_HEALTH_GROUP_IDS.length : index;
  };
  return report.groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.checks.length > 0)
    .sort((a, b) => rank(a.group.id) - rank(b.group.id) || a.index - b.index)
    .map(({ group }) => group);
}

/** The worst tone of a group, for the small badge on its card. */
export function groupTone(checks: BoxHealthCheck[]): BoxHealthTone {
  if (checks.some((check) => check.level === 'critical')) return 'critical';
  if (checks.some((check) => check.level !== 'ok')) return 'warning';
  return 'ok';
}

type Measure = 'duration' | 'percent' | 'celsius' | 'count' | 'failed';
/** Which value a sentence with figures needs; without it, the plain sentence is used. */
const MEASURED: Partial<Record<BoxHealthCheckId, { needs: Measure; levels: BoxHealthLevel[] }>> = {
  'last-event': { needs: 'duration', levels: ['warning', 'critical'] },
  coverage: { needs: 'percent', levels: ['warning', 'critical'] },
  'sensors-offline': { needs: 'count', levels: ['warning', 'critical'] },
  'sensors-battery': { needs: 'count', levels: ['warning', 'critical'] },
  deliveries: { needs: 'failed', levels: ['warning', 'critical'] },
  outbox: { needs: 'count', levels: ['warning', 'critical'] },
  disk: { needs: 'percent', levels: ['ok', 'warning', 'critical'] },
  memory: { needs: 'percent', levels: ['ok', 'warning', 'critical'] },
  temperature: { needs: 'celsius', levels: ['ok', 'warning', 'critical'] },
  containers: { needs: 'count', levels: ['warning', 'critical'] },
  'storage-errors': { needs: 'count', levels: ['warning', 'critical'] },
  backup: { needs: 'duration', levels: ['ok', 'warning', 'critical'] },
};

const numberParam = (check: BoxHealthCheck, name: string) => {
  const value = check.params?.[name];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
};

/** A duration in minutes, whichever unit the box used. */
export function durationMinutes(check: BoxHealthCheck) {
  const minutes = numberParam(check, 'minutes');
  if (minutes !== undefined) return minutes;
  const hours = numberParam(check, 'hours');
  if (hours !== undefined) return hours * 60;
  const days = numberParam(check, 'days');
  return days === undefined ? undefined : days * 1440;
}

/** The duration in the unit a person would use: minutes, then hours, then days. */
export function durationParts(minutes: number): {
  unit: 'minutes' | 'hours' | 'days';
  count: number;
} {
  if (minutes < 120) return { unit: 'minutes', count: Math.max(1, Math.round(minutes)) };
  if (minutes < 48 * 60) return { unit: 'hours', count: Math.round(minutes / 60) };
  return { unit: 'days', count: Math.round(minutes / 1440) };
}

export interface CheckCopy {
  /** Key of the sentence under `boxHealth.` in the catalogs. */
  path: string;
  /** Values for the sentence; `count` drives the plural forms. */
  values: Record<string, string | number>;
  /** When set, the caller translates it into `values.duration`. */
  duration?: { unit: 'minutes' | 'hours' | 'days'; count: number };
}

/** Which sentence tells this check, with its figures when the box gave them. */
export function checkCopy(check: BoxHealthCheck): CheckCopy {
  if (!isKnownCheck(check.id)) return { path: `generic.${check.level}`, values: {} };
  const base = `checks.${check.id}.${check.level}`;
  const measured = MEASURED[check.id];
  if (!measured || !measured.levels.includes(check.level)) return { path: base, values: {} };
  const path = `${base}Measured`;
  switch (measured.needs) {
    case 'duration': {
      const minutes = durationMinutes(check);
      if (minutes === undefined) return { path: base, values: {} };
      return { path, values: {}, duration: durationParts(minutes) };
    }
    case 'failed': {
      const failed = numberParam(check, 'failed');
      const total = numberParam(check, 'total');
      if (failed === undefined || total === undefined) return { path: base, values: {} };
      return { path, values: { count: failed, failed, total } };
    }
    case 'percent':
    case 'celsius': {
      const value = numberParam(check, measured.needs);
      if (value === undefined) return { path: base, values: {} };
      return { path, values: { [measured.needs]: Math.round(value) } };
    }
    case 'count': {
      const count = numberParam(check, 'count');
      if (count === undefined) return { path: base, values: {} };
      return { path, values: { count } };
    }
  }
}

export type BoxHealthDestination = 'zigbee' | 'sensors' | 'remote-access' | 'backup';

/** Where an action button leads; null hides the button when the app has no such place. */
export function actionDestination(
  action: BoxHealthAction | undefined,
  available: ReadonlySet<BoxHealthDestination>,
): BoxHealthDestination | null {
  const destination: BoxHealthDestination | null =
    action === 'open-zigbee'
      ? 'zigbee'
      : action === 'open-sensors'
        ? 'sensors'
        : action === 'open-remote-access'
          ? 'remote-access'
          : action === 'run-backup'
            ? 'backup'
            : null;
  return destination && available.has(destination) ? destination : null;
}

export const backupRunning = (report: BoxHealthReport | null) => report?.backup?.running === true;

/** While a backup runs, the screen asks again every 5 seconds. */
export const BACKUP_POLL_MS = 5000;

/** Raw values of `report.technical`, flattened into readable "path: value" lines. */
export function technicalLines(value: unknown, prefix = '', out: string[] = [], depth = 0) {
  if (depth > 4) {
    out.push(`${prefix}: …`);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      if (value.length) out.push(`${prefix}: ${value.map(String).join(', ')}`);
      else out.push(`${prefix}: —`);
    } else
      value.forEach((item, index) => technicalLines(item, `${prefix}[${index}]`, out, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      technicalLines(item, prefix ? `${prefix}.${key}` : key, out, depth + 1);
  } else if (prefix) {
    out.push(`${prefix}: ${value === null || value === undefined ? '—' : String(value)}`);
  }
  return out;
}
