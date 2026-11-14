import type { BoxHealthCheck, BoxHealthCheckLevel, BoxHealthVerdict } from '@elise/contracts';

export function check(id: string, level: BoxHealthCheckLevel, params: Record<string, unknown> = {}, detail?: string, action?: BoxHealthCheck['action']): BoxHealthCheck {
  return { id, level, params, ...(detail ? { detail } : {}), ...(action ? { action } : {}) };
}
export function percentLevel(value: unknown, warning: number, critical: number): BoxHealthCheckLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return value > critical ? 'critical' : value > warning ? 'warning' : 'ok';
}
export function verdictFor(levels: BoxHealthCheckLevel[]): BoxHealthVerdict {
  if (levels.includes('critical')) return 'critical';
  if (levels.some((level) => level === 'warning' || level === 'unknown')) return 'warning';
  return 'ok';
}
