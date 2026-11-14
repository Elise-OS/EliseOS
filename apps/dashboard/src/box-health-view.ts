import type {
  BoxHealthAction,
  BoxHealthCheck,
  BoxHealthCheckLevel,
  BoxHealthReport,
} from '@elise/contracts';

/**
 * Pure rules of the « Santé de la box » tab, kept apart from React so they can be tested.
 * Product rule: a value Élise could not read is never « OK »: it becomes « impossible de vérifier ».
 */

export type BoxHealthLevel = BoxHealthCheckLevel;
export type { BoxHealthReport };

/** Tabs of the settings page, in the order they are shown. */
export type SettingsTab = 'general' | 'zigbee' | 'health' | 'rules';

/**
 * Tabs a person may open. The Zigbee key and the box health speak about the appliance itself:
 * only people who manage the configuration see them.
 */
export function visibleSettingsTabs(capabilities: readonly string[]): SettingsTab[] {
  const manager = capabilities.includes('configuration:manage');
  return manager ? ['general', 'zigbee', 'health', 'rules'] : ['general', 'rules'];
}

/** What the banner says: `unverifiable` when the box could not be asked at all. */
export type BoxHealthTone = 'ok' | 'warning' | 'critical' | 'unverifiable';

/** Groups of the API, in the order of the screen. `monitoring` is the provisional name of `surveillance`. */
export const BOX_HEALTH_GROUPS = [
  'surveillance',
  'home',
  'notifications',
  'box',
  'data',
  'access',
] as const;
export type BoxHealthGroupId = (typeof BOX_HEALTH_GROUPS)[number];
const GROUP_ALIASES: Record<string, BoxHealthGroupId> = { monitoring: 'surveillance' };

/** Catalog key of a group, or null when the box speaks of a group the screen does not know. */
export function groupKey(id: string): BoxHealthGroupId | null {
  if ((BOX_HEALTH_GROUPS as readonly string[]).includes(id)) return id as BoxHealthGroupId;
  return GROUP_ALIASES[id] ?? null;
}

/** Checks the catalog has sentences for; any other id gets the generic sentence. */
export const KNOWN_BOX_HEALTH_CHECKS = [
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
export type KnownBoxHealthCheck = (typeof KNOWN_BOX_HEALTH_CHECKS)[number];

export const isKnownCheck = (id: string): id is KnownBoxHealthCheck =>
  (KNOWN_BOX_HEALTH_CHECKS as readonly string[]).includes(id);

/** Catalog key fragment of each action (catalog keys stay camelCase). */
export const ACTION_KEYS: Record<BoxHealthAction, string> = {
  'open-zigbee': 'openZigbee',
  'open-sensors': 'openSensors',
  'run-backup': 'runBackup',
  'open-remote-access': 'openRemoteAccess',
};

// ---------------------------------------------------------------------------------------------
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
 * Catalog keys to try, best first, under `boxHealth.check.<id>.`: the sentence with figures,
 * then the same without them (`…Short`), then the plain sentence of the level.
 */
export function sentenceKeys(check: BoxHealthCheck, reading: CheckReading): string[] {
  if (!isKnownCheck(check.id)) return [];
  const keys = [reading.variant, `${reading.variant}Short`, reading.level, `${reading.level}Short`];
  return [...new Set(keys)].map((key) => `boxHealth.check.${check.id}.${key}`);
}

/** A sentence is unusable when a value it needs is missing or its key does not exist. */
export const isUsableSentence = (text: string, key: string) =>
  Boolean(text) && text !== key && !text.includes('{{') && !text.startsWith('boxHealth.');

// ---------------------------------------------------------------------------------------------
// The report as the screen reads it.

const severity: Record<BoxHealthLevel, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };

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

export const allChecks = (report: BoxHealthReport): BoxHealthCheck[] =>
  report.groups.flatMap((group) => group.checks);

/** Worst level of a list of checks; an empty list says nothing, so it is `unknown`. */
export function worstLevel(checks: readonly BoxHealthCheck[]): BoxHealthLevel {
  if (!checks.length) return 'unknown';
  return checks.reduce<BoxHealthLevel>(
    (worst, check) => (severity[check.level] > severity[worst] ? check.level : worst),
    'ok',
  );
}

/**
 * The verdict the family sees. The box's own verdict is never softened, and it is raised when
 * a point says more than it does: a point that could not be read turns « ok » into « warning ».
 */
export function effectiveVerdict(report: BoxHealthReport): 'ok' | 'warning' | 'critical' {
  const checks = allChecks(report);
  const worst = worstLevel(checks);
  if (report.verdict === 'critical' || worst === 'critical') return 'critical';
  if (report.verdict === 'warning' || worst === 'warning' || worst === 'unknown') return 'warning';
  // A report without a single point cannot vouch for anything.
  return checks.length ? 'ok' : 'warning';
}

/** The banner: no report (yet) because of an error is `unverifiable`, never « all is well ». */
export function bannerTone(report: BoxHealthReport | null, failed: boolean): BoxHealthTone {
  if (failed || !report) return 'unverifiable';
  return effectiveVerdict(report);
}

export interface BoxHealthCounts {
  ok: number;
  warning: number;
  critical: number;
  unknown: number;
}

export function countLevels(report: BoxHealthReport): BoxHealthCounts {
  const counts: BoxHealthCounts = { ok: 0, warning: 0, critical: 0, unknown: 0 };
  for (const check of allChecks(report)) counts[check.level] += 1;
  return counts;
}

/**
 * Which sentence the banner uses. A warning that only comes from unreadable points says so,
 * instead of pretending something is wrong.
 */
export function bannerMessage(
  report: BoxHealthReport | null,
  failed: boolean,
): 'ok' | 'warning' | 'warningUnknown' | 'critical' | 'unverifiable' {
  const tone = bannerTone(report, failed);
  if (tone !== 'warning' || !report) return tone;
  const counts = countLevels(report);
  return counts.warning === 0 && counts.critical === 0 && counts.unknown > 0
    ? 'warningUnknown'
    : 'warning';
}

/** Groups in the expected order; unknown groups follow, so nothing the box says is lost. */
export function orderedGroups(report: BoxHealthReport): BoxHealthReport['groups'] {
  const rank = (id: string) => {
    const key = groupKey(id);
    return key ? BOX_HEALTH_GROUPS.indexOf(key) : BOX_HEALTH_GROUPS.length;
  };
  return report.groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.checks.length > 0)
    .sort((a, b) => rank(a.group.id) - rank(b.group.id) || a.index - b.index)
    .map(({ group }) => group);
}

/**
 * Action buttons: a backup can always be started; a place is only worth opening when its row
 * asks for attention, so a calm report stays calm.
 */
export const showsAction = (check: BoxHealthCheck) =>
  Boolean(check.action) && (check.action === 'run-backup' || check.level !== 'ok');

// ---------------------------------------------------------------------------------------------
// Backup started from the screen. The API does not say a backup is running: the screen remembers
// the click and waits for a report whose last backup is newer than the one it knew.

export const BOX_HEALTH_REFRESH_MS = 60_000;
export const BOX_HEALTH_BACKUP_REFRESH_MS = 5_000;
/** After this delay the screen stops waiting and says the result will show up later. */
export const BOX_HEALTH_BACKUP_WATCH_MS = 10 * 60_000;
export const refreshDelay = (backupRunning: boolean) =>
  backupRunning ? BOX_HEALTH_BACKUP_REFRESH_MS : BOX_HEALTH_REFRESH_MS;

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

export interface BackupWatch {
  startedAt: number;
  /** Time of the last backup known when the button was pressed. */
  knownAt: number | null;
}

export const watchBackup = (report: BoxHealthReport | null, now = Date.now()): BackupWatch => ({
  startedAt: now,
  knownAt: lastBackup(report)?.at ?? null,
});

/** Where a backup started from the screen stands, given the latest report. */
export function backupProgress(
  watch: BackupWatch,
  report: BoxHealthReport | null,
  now = Date.now(),
): 'running' | 'done' | 'failed' | 'timeout' {
  const last = lastBackup(report);
  if (last && (watch.knownAt === null || last.at > watch.knownAt))
    return last.ok ? 'done' : 'failed';
  return now - watch.startedAt > BOX_HEALTH_BACKUP_WATCH_MS ? 'timeout' : 'running';
}
