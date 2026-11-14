import type { BoxHealthCheck, BoxHealthCheckLevel, BoxHealthVerdict } from '@elise/contracts';

export function check(
  id: string,
  level: BoxHealthCheckLevel,
  params: Record<string, unknown> = {},
  detail?: string,
  action?: BoxHealthCheck['action'],
): BoxHealthCheck {
  return { id, level, params, ...(detail ? { detail } : {}), ...(action ? { action } : {}) };
}
export function percentLevel(
  value: unknown,
  warning: number,
  critical: number,
): BoxHealthCheckLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return value > critical ? 'critical' : value > warning ? 'warning' : 'ok';
}
export function verdictFor(levels: BoxHealthCheckLevel[]): BoxHealthVerdict {
  if (levels.includes('critical')) return 'critical';
  if (levels.some((level) => level === 'warning' || level === 'unknown')) return 'warning';
  return 'ok';
}

export function temperatureLevel(value: unknown): BoxHealthCheckLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return value > 75 ? 'warning' : 'ok';
}

export function throttlingLevel(flags: unknown, applicable: unknown): BoxHealthCheckLevel {
  if (flags == null) return applicable === false ? 'ok' : 'unknown';
  return typeof flags === 'number' && Number.isFinite(flags)
    ? (flags & 0xf) !== 0
      ? 'critical'
      : 'ok'
    : 'unknown';
}

export function backupLevel(
  backup: { at?: string; ok?: boolean } | null | undefined,
  now = Date.now(),
): BoxHealthCheckLevel {
  if (!backup) return 'warning';
  if (backup.ok !== true) return 'critical';
  const age =
    typeof backup.at === 'string' ? (now - Date.parse(backup.at)) / 86_400_000 : Number.NaN;
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  return age > 7 ? 'critical' : age > 3 ? 'warning' : 'ok';
}

export function batteryLevel(value: unknown): BoxHealthCheckLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return value <= 10 ? 'critical' : value <= 20 ? 'warning' : 'ok';
}

export function storageErrorLevel(count: unknown): BoxHealthCheckLevel {
  return typeof count !== 'number' || !Number.isFinite(count)
    ? 'unknown'
    : count > 0
      ? 'critical'
      : 'ok';
}

export function containerLevel(containers: unknown): BoxHealthCheckLevel {
  if (!Array.isArray(containers)) return 'unknown';
  const entries: unknown[] = containers;
  if (entries.length === 0) return 'unknown';
  const records = entries.filter(isRecord);
  if (records.length !== entries.length) return 'unknown';
  if (records.some((item) => item.oomKilled === true)) return 'critical';
  if (records.some((item) => item.status !== 'running')) return 'critical';
  return records.some(
    (item) =>
      item.health === 'unhealthy' ||
      (typeof item.restartCount === 'number' && item.restartCount > 0),
  )
    ? 'warning'
    : 'ok';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface DatabaseSizeBaseline {
  bytes: number;
  at: string;
}

export function databaseGrowth(
  currentBytes: unknown,
  baseline: DatabaseSizeBaseline | null,
  now = Date.now(),
): { level: BoxHealthCheckLevel; percent: number | null; refreshBaseline: boolean } {
  if (typeof currentBytes !== 'number' || !Number.isFinite(currentBytes) || currentBytes < 0)
    return { level: 'unknown', percent: null, refreshBaseline: false };
  if (
    !baseline ||
    typeof baseline.bytes !== 'number' ||
    !Number.isFinite(baseline.bytes) ||
    baseline.bytes <= 0 ||
    !Number.isFinite(Date.parse(baseline.at))
  ) {
    return { level: 'unknown', percent: null, refreshBaseline: true };
  }
  const elapsedHours = (now - Date.parse(baseline.at)) / 3_600_000;
  if (elapsedHours < 23) return { level: 'unknown', percent: null, refreshBaseline: false };
  if (elapsedHours > 36) return { level: 'unknown', percent: null, refreshBaseline: true };
  const percent = ((currentBytes - baseline.bytes) / baseline.bytes) * 100;
  return { level: percent > 50 ? 'warning' : 'ok', percent, refreshBaseline: true };
}
