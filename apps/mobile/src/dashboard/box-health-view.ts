import type {
  BoxHealthCheck,
  BoxHealthCheckLevel,
  BoxHealthReport,
  MembershipRole,
} from '@elise/contracts';

/**
 * Pure rules of the "Box health" screen, kept apart from React so they can be tested.
 * Product rule: a value Élise could not read is never shown as fine: it becomes "unable to check".
 * The reading of the values mirrors apps/dashboard/src/box-health-view.ts.
 */

type BoxHealthLevel = BoxHealthCheckLevel;

/** Groups of the API, in the order of the screen. `monitoring` is the provisional name of `surveillance`. */
export const BOX_HEALTH_GROUP_IDS = [
  'surveillance',
  'home',
  'notifications',
  'box',
  'data',
  'access',
] as const;
export type BoxHealthGroupId = (typeof BOX_HEALTH_GROUP_IDS)[number];
const GROUP_ALIASES: Record<string, BoxHealthGroupId> = { monitoring: 'surveillance' };

/** Catalog key of a group, or null when the box speaks of a group the screen does not know. */
export function groupKey(id: string): BoxHealthGroupId | null {
  if ((BOX_HEALTH_GROUP_IDS as readonly string[]).includes(id)) return id as BoxHealthGroupId;
  return GROUP_ALIASES[id] ?? null;
}

export const BOX_HEALTH_CHECK_IDS = [
  'worker',
  'zigbee',
  'sensors',
  'notifications',
  'outbox',
  'disk',
  'swap',
  'temperature',
  'throttling',
  'containers',
  'disk-errors',
  'backup',
  'database',
  'remote-access',
] as const;
export type BoxHealthCheckId = (typeof BOX_HEALTH_CHECK_IDS)[number];

export const isKnownCheck = (id: string): id is BoxHealthCheckId =>
  (BOX_HEALTH_CHECK_IDS as readonly string[]).includes(id);

/** How a level looks: 'unknown' looks like "to keep an eye on", never like "ok". */
export type BoxHealthTone = 'ok' | 'warning' | 'critical';
/** What the banner says. 'unchecked' = nothing wrong found, but some points could not be read. */
export type BoxHealthBanner = 'ok' | 'warning' | 'unchecked' | 'critical' | 'unavailable';

/** Only owners and administrators (configuration:manage) see and open the box health screen. */
export const canManageBox = (role: MembershipRole) => role === 'OWNER' || role === 'ADMINISTRATOR';

export const toneOf = (level: BoxHealthLevel): BoxHealthTone =>
  level === 'ok' ? 'ok' : level === 'critical' ? 'critical' : 'warning';

// Reading the values of a check. `params` is free-form: every value is checked before use.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A finite number, or undefined. Numeric strings are accepted, nothing else. */
export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

const readCount = (value: unknown) => {
  const count = readNumber(value);
  return count !== undefined && count >= 0 ? Math.round(count) : undefined;
};

const readTime = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
};

export type DurationUnit = 'minutes' | 'hours' | 'days';
export interface Duration {
  unit: DurationUnit;
  count: number;
}

/** A duration in the unit a person would use: minutes, then hours, then days. */
export function durationParts(minutes: number): Duration {
  if (minutes < 120) return { unit: 'minutes', count: Math.max(1, Math.round(minutes)) };
  if (minutes < 48 * 60) return { unit: 'hours', count: Math.round(minutes / 60) };
  return { unit: 'days', count: Math.round(minutes / 1440) };
}

export type SizeUnit = 'kb' | 'mb' | 'gb';
export interface Size {
  unit: SizeUnit;
  value: number;
}

/** A size in bytes, in kB, MB or GB with one decimal at most. */
export function sizeParts(bytes: number): Size {
  if (bytes >= 1024 ** 3) return { unit: 'gb', value: Math.round((bytes / 1024 ** 3) * 10) / 10 };
  if (bytes >= 1024 ** 2) return { unit: 'mb', value: Math.round((bytes / 1024 ** 2) * 10) / 10 };
  return { unit: 'kb', value: Math.max(1, Math.round(bytes / 1024)) };
}

export interface CheckReading {
  /** The level shown: the box's level, or `unknown` when an « ok » rests on a value we cannot read. */
  level: BoxHealthLevel;
  /** Catalog fragment of the sentence: the level, or a finer case (`never`, `failed`, `failing`, `none`). */
  variant: string;
  /** Figures for the sentence (`count` drives plural forms). */
  values: Record<string, number>;
  /** When set, the caller inserts it as `{{duration}}`. */
  duration?: Duration | undefined;
  /** When set, the caller inserts it as `{{size}}`. */
  size?: Size | undefined;
}

interface Measure {
  /** false: the value the level rests on is missing or unreadable. */
  readable: boolean;
  variant?: string | undefined;
  values?: Record<string, number> | undefined;
  duration?: Duration | undefined;
  size?: Size | undefined;
}

const UNREADABLE: Measure = { readable: false };

const percentMeasure = (params: Record<string, unknown>): Measure => {
  const percent = readNumber(params.usedPercent) ?? readNumber(params.percent);
  if (percent === undefined || percent < 0 || percent > 100) return UNREADABLE;
  return { readable: true, values: { percent: Math.round(percent) } };
};

const countMeasure = (value: unknown): Measure => {
  const count = readCount(value);
  return count === undefined ? UNREADABLE : { readable: true, values: { count } };
};

function measure(check: BoxHealthCheck, now: number): Measure {
  const params: Record<string, unknown> = isRecord(check.params) ? check.params : {};
  switch (check.id) {
    case 'disk':
    case 'swap':
      return percentMeasure(params);
    case 'temperature': {
      const raw = Array.isArray(params.celsius) ? params.celsius : [params.celsius];
      const readings = raw.map(readNumber).filter((value) => value !== undefined);
      if (!readings.length) return UNREADABLE;
      return { readable: true, values: { celsius: Math.round(Math.max(...readings)) } };
    }
    case 'throttling':
      return { readable: readNumber(params.flags) !== undefined };
    case 'containers': {
      if (!Array.isArray(params.containers)) return UNREADABLE;
      const items = params.containers.filter(isRecord);
      if (!items.length) return UNREADABLE;
      const troubled = items.filter(
        (item) =>
          item.oomKilled === true ||
          item.health === 'unhealthy' ||
          (readNumber(item.restartCount) ?? 0) > 0,
      ).length;
      return { readable: true, values: troubled ? { count: troubled, total: items.length } : {} };
    }
    case 'disk-errors':
      return countMeasure(params.count);
    case 'sensors': {
      const count = readCount(params.count);
      if (count === undefined) return UNREADABLE;
      return { readable: true, variant: count === 0 ? 'none' : undefined, values: { count } };
    }
    case 'notifications':
      return countMeasure(params.failed24h ?? params.failed);
    case 'outbox':
      return countMeasure(params.failed ?? params.count);
    case 'database': {
      const bytes = readNumber(params.sizeBytes);
      if (bytes === undefined || bytes < 0) return UNREADABLE;
      return { readable: true, size: sizeParts(bytes) };
    }
    case 'zigbee':
    case 'remote-access':
      // The service answered: `available` must say so in so many words.
      return { readable: params.available === true };
    case 'worker': {
      const state = params.state;
      if (!isRecord(state)) return UNREADABLE;
      const failing = Array.isArray(state.failingTasks) ? state.failingTasks.length : 0;
      if (check.level !== 'ok' && failing > 0)
        return { readable: true, variant: 'failing', values: { count: failing } };
      const seen = readTime(state.lastSeenAt);
      const silentMinutes = seen === undefined ? undefined : (now - seen) / 60_000;
      // A worker heard within two minutes has nothing to report in figures.
      return silentMinutes !== undefined && silentMinutes >= 2
        ? { readable: true, duration: durationParts(silentMinutes) }
        : { readable: true };
    }
    case 'backup': {
      if (!('last' in params)) return UNREADABLE;
      const last = params.last;
      if (last === null) return { readable: true, variant: 'never' };
      if (!isRecord(last) || typeof last.ok !== 'boolean') return UNREADABLE;
      const at = readTime(last.at);
      const duration = at === undefined ? undefined : durationParts(Math.max(0, now - at) / 60_000);
      if (!last.ok) return { readable: true, variant: 'failed', duration };
      return at === undefined ? UNREADABLE : { readable: true, duration };
    }
    default: {
      // A check the screen does not know: the level of the box, told by the generic sentence.
      return { readable: true };
    }
  }
}

/** How a check reads on screen. Never softer than the box; harder when its value is unreadable. */
export function readCheck(check: BoxHealthCheck, now = Date.now()): CheckReading {
  const found = measure(check, now);
  if (check.level === 'unknown' || (check.level === 'ok' && !found.readable))
    return { level: 'unknown', variant: 'unknown', values: {} };
  return {
    level: check.level,
    variant: found.variant ?? check.level,
    values: found.values ?? {},
    duration: found.duration,
    size: found.size,
  };
}

/**
 * Catalog paths to try (under `boxHealth.`), best first: the sentence with figures (`…Measured`),
 * then the plain one, then the same for the level itself, then the generic sentence.
 */
export function sentenceKeys(check: BoxHealthCheck, reading: CheckReading): string[] {
  const generic = `generic.${reading.level}`;
  if (!isKnownCheck(check.id)) return [generic];
  const keys = [
    `${reading.variant}Measured`,
    reading.variant,
    `${reading.level}Measured`,
    reading.level,
  ];
  return [...new Set(keys)].map((key) => `checks.${check.id}.${key}`).concat(generic);
}

/** A sentence is unusable when a value it needs is missing or its key does not exist. */
export const isUsableSentence = (text: string, key: string) =>
  Boolean(text) && text !== key && !text.includes('{{') && !text.startsWith('boxHealth.');

const allChecks = (report: BoxHealthReport) => report.groups.flatMap((group) => group.checks);

/** The report with the levels the screen shows (see `readCheck`). */
export function readReport(report: BoxHealthReport, now = Date.now()): BoxHealthReport {
  return {
    ...report,
    groups: report.groups.map((group) => ({
      ...group,
      checks: group.checks.map((check) => ({ ...check, level: readCheck(check, now).level })),
    })),
  };
}

/** The banner never says "all good" while a point is unreadable or worse. */
export function bannerOf(report: BoxHealthReport | null, failed: boolean): BoxHealthBanner {
  if (failed || !report) return 'unavailable';
  const checks = allChecks(report);
  if (report.verdict === 'critical' || checks.some((check) => check.level === 'critical'))
    return 'critical';
  if (checks.some((check) => check.level === 'warning')) return 'warning';
  if (checks.some((check) => check.level === 'unknown')) return 'unchecked';
  // A warning verdict is never softened; a report without a single point vouches for nothing.
  if (report.verdict === 'warning') return 'warning';
  return checks.length ? 'ok' : 'unchecked';
}

/** Known groups first, in the order of the screen; unknown groups keep their order at the end. */
export function orderedGroups(report: BoxHealthReport) {
  const rank = (id: string) => {
    const key = groupKey(id);
    return key ? BOX_HEALTH_GROUP_IDS.indexOf(key) : BOX_HEALTH_GROUP_IDS.length;
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

export type BoxHealthDestination = 'zigbee' | 'sensors' | 'remote-access' | 'backup';

/**
 * Where an action button leads; null hides it. A backup can always be started; a place is only
 * offered when its row asks for attention (a calm report stays calm), and when the app has it.
 */
export function actionDestination(
  check: Pick<BoxHealthCheck, 'action' | 'level'>,
  available: ReadonlySet<BoxHealthDestination>,
): BoxHealthDestination | null {
  const { action } = check;
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
  if (!destination || !available.has(destination)) return null;
  return destination === 'backup' || check.level !== 'ok' ? destination : null;
}

/** Every minute while the screen is open; every 5 seconds while a backup started here runs. */
export const REFRESH_MS = 60_000;
export const BACKUP_POLL_MS = 5000;
/** After this delay the screen stops waiting and says the result will show up later. */
export const BACKUP_WATCH_MS = 10 * 60_000;

export interface LastBackup {
  at: number;
  ok: boolean;
}

/** The last backup the report knows of, or null (never made, or unreadable). */
export function lastBackup(report: BoxHealthReport | null): LastBackup | null {
  const check = report ? allChecks(report).find((item) => item.id === 'backup') : undefined;
  const last = isRecord(check?.params) ? check.params.last : undefined;
  if (!isRecord(last) || typeof last.ok !== 'boolean') return null;
  const at = readTime(last.at);
  return at === undefined ? null : { at, ok: last.ok };
}

/**
 * The API does not say a backup is running: the screen remembers the button press and waits for
 * a report whose last backup is newer than the one it knew.
 */
export interface BackupWatch {
  startedAt: number;
  knownAt: number | null;
}

export const watchBackup = (report: BoxHealthReport | null, now = Date.now()): BackupWatch => ({
  startedAt: now,
  knownAt: lastBackup(report)?.at ?? null,
});

export function backupProgress(
  watch: BackupWatch,
  report: BoxHealthReport | null,
  now = Date.now(),
): 'running' | 'done' | 'failed' | 'timeout' {
  const last = lastBackup(report);
  if (last && (watch.knownAt === null || last.at > watch.knownAt))
    return last.ok ? 'done' : 'failed';
  return now - watch.startedAt > BACKUP_WATCH_MS ? 'timeout' : 'running';
}

/** Raw values flattened into readable "path: value" lines, for the technical details. */
export function technicalLines(value: unknown, prefix = '', out: string[] = [], depth = 0) {
  if (depth > 4) {
    out.push(`${prefix}: …`);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      out.push(
        `${prefix}: ${value.length ? value.map((item) => String(item as string)).join(', ') : '—'}`,
      );
    } else
      value.forEach((item, index) => technicalLines(item, `${prefix}[${index}]`, out, depth + 1));
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length && prefix) out.push(`${prefix}: —`);
    for (const [key, item] of entries)
      technicalLines(item, prefix ? `${prefix}.${key}` : key, out, depth + 1);
  } else if (prefix) {
    const text =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '—';
    out.push(`${prefix}: ${text}`);
  }
  return out;
}
