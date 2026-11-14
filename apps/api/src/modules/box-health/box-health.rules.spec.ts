import { describe, expect, it } from 'vitest';
import {
  backupLevel,
  batteryLevel,
  containerLevel,
  databaseGrowth,
  percentLevel,
  storageErrorLevel,
  temperatureLevel,
  throttlingLevel,
  verdictFor,
} from './box-health.rules';

describe('box health rules', () => {
  it('applies the disk thresholds and treats missing readings as unknown', () => {
    expect(percentLevel(70, 80, 92)).toBe('ok');
    expect(percentLevel(85, 80, 92)).toBe('warning');
    expect(percentLevel(93, 80, 92)).toBe('critical');
    expect(percentLevel(null, 80, 92)).toBe('unknown');
  });
  it('keeps every unavailable indicator in the warning verdict', () => {
    expect(verdictFor(['ok', 'unknown'])).toBe('warning');
    expect(verdictFor(['ok', 'critical'])).toBe('critical');
    expect(verdictFor(['ok'])).toBe('ok');
  });
  it('applies temperature, throttling, storage and container thresholds', () => {
    expect(temperatureLevel(75)).toBe('ok');
    expect(temperatureLevel(75.1)).toBe('warning');
    expect(temperatureLevel(null)).toBe('unknown');
    expect(throttlingLevel(null, false)).toBe('ok');
    expect(throttlingLevel(null, true)).toBe('unknown');
    expect(throttlingLevel(0x1, true)).toBe('critical');
    expect(storageErrorLevel(0)).toBe('ok');
    expect(storageErrorLevel(1)).toBe('critical');
    expect(storageErrorLevel(null)).toBe('unknown');
    expect(containerLevel(null)).toBe('unknown');
    expect(containerLevel([])).toBe('unknown');
    expect(containerLevel([{ status: 'running', health: 'unhealthy' }])).toBe('warning');
    expect(containerLevel([{ status: 'exited' }])).toBe('critical');
    expect(containerLevel([{ oomKilled: true }])).toBe('critical');
  });
  it('applies battery and backup age thresholds, including unreadable dates', () => {
    expect(batteryLevel(20)).toBe('warning');
    expect(batteryLevel(10)).toBe('critical');
    expect(batteryLevel(null)).toBe('unknown');
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    const atDays = (days: number) => new Date(now - days * 86400000).toISOString();
    expect(backupLevel({ ok: true, at: atDays(2) }, now)).toBe('ok');
    expect(backupLevel({ ok: true, at: atDays(4) }, now)).toBe('warning');
    expect(backupLevel({ ok: true, at: atDays(8) }, now)).toBe('critical');
    expect(backupLevel({ ok: true, at: 'invalid' }, now)).toBe('unknown');
    expect(backupLevel({ ok: false, at: atDays(0) }, now)).toBe('critical');
    expect(backupLevel(null, now)).toBe('warning');
  });
  it('compares database size only against a dated baseline from roughly the previous day', () => {
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    const baseline = { bytes: 1000, at: new Date(now - 24 * 3600000).toISOString() };
    expect(databaseGrowth(1501, baseline, now).level).toBe('warning');
    expect(databaseGrowth(1500, baseline, now).level).toBe('ok');
    expect(
      databaseGrowth(1000, { ...baseline, at: new Date(now - 2 * 3600000).toISOString() }, now)
        .level,
    ).toBe('unknown');
    expect(databaseGrowth(1000, null, now)).toMatchObject({
      level: 'unknown',
      refreshBaseline: true,
    });
  });
});
