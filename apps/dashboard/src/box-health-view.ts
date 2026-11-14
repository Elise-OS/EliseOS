import type {
  BoxHealthAction,
  BoxHealthCheck,
  BoxHealthReport as ContractReport,
} from '@elise/contracts';

export type BoxHealthLevel = BoxHealthCheck['level'];

/**
 * The report as the screen reads it: the contract, plus two optional fields the box may add —
 * a backup in progress and raw values for the technical details.
 */
export type BoxHealthReport = Omit<ContractReport, 'backup' | 'technical'> & {
  backup?: { running: boolean };
  technical?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keeps `backup` and `technical` even when the contract schema strips unknown fields. */
export function withExtras(parsed: ContractReport, raw: unknown): BoxHealthReport {
  const source = isRecord(raw) ? raw : {};
  const { backup, technical } = source;
  return {
    ...parsed,
    backup: isRecord(backup) ? { running: backup.running === true } : undefined,
    technical: isRecord(technical) ? technical : undefined,
  };
}

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

export const BOX_HEALTH_GROUPS = [
  'monitoring',
  'home',
  'notifications',
  'box',
  'data',
  'access',
] as const;
export type BoxHealthGroupId = (typeof BOX_HEALTH_GROUPS)[number];

/** Checks the catalog has sentences for; any other id gets the generic sentence. */
export const KNOWN_BOX_HEALTH_CHECKS = [
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
export type KnownBoxHealthCheck = (typeof KNOWN_BOX_HEALTH_CHECKS)[number];

export const isKnownCheck = (id: string): id is KnownBoxHealthCheck =>
  (KNOWN_BOX_HEALTH_CHECKS as readonly string[]).includes(id);

export const isKnownGroup = (id: string): id is BoxHealthGroupId =>
  (BOX_HEALTH_GROUPS as readonly string[]).includes(id);

/** Catalog key fragment of each action (catalog keys stay camelCase). */
export const ACTION_KEYS: Record<BoxHealthAction, string> = {
  'open-zigbee': 'openZigbee',
  'open-sensors': 'openSensors',
  'run-backup': 'runBackup',
  'open-remote-access': 'openRemoteAccess',
};

const severity: Record<BoxHealthLevel, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };

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
  const worst = worstLevel(allChecks(report));
  if (report.verdict === 'critical' || worst === 'critical') return 'critical';
  if (report.verdict === 'warning' || worst === 'warning' || worst === 'unknown') return 'warning';
  // A report without a single point cannot vouch for anything.
  return allChecks(report).length ? 'ok' : 'warning';
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
    const index = (BOX_HEALTH_GROUPS as readonly string[]).indexOf(id);
    return index < 0 ? BOX_HEALTH_GROUPS.length : index;
  };
  return report.groups
    .filter((group) => group.checks.length > 0)
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group.id) - rank(b.group.id) || a.index - b.index)
    .map(({ group }) => group);
}

/** Values a sentence may insert: only the ones the box gave, whole numbers for reading. */
export function sentenceParams(check: BoxHealthCheck): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries((check.params ?? {}) as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) params[name] = Math.round(value);
    else if (typeof value === 'string' && value) params[name] = value;
  }
  return params;
}

/** A sentence is unusable when a value it needs is missing or its key does not exist. */
export const isUsableSentence = (text: string, key: string) =>
  Boolean(text) && text !== key && !text.includes('{{') && !text.startsWith('boxHealth.');

/** While a backup runs the screen asks often; otherwise once a minute. */
export const BOX_HEALTH_REFRESH_MS = 60_000;
export const BOX_HEALTH_BACKUP_REFRESH_MS = 5_000;
export const refreshDelay = (backupRunning: boolean) =>
  backupRunning ? BOX_HEALTH_BACKUP_REFRESH_MS : BOX_HEALTH_REFRESH_MS;
