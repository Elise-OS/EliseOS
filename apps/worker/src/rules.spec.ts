import { describe, expect, it } from 'vitest';
import {
  countNightActivity,
  isDoorOpenTooLong,
  isInMinuteWindow,
  isStale,
  numericPayload,
  persistentTemperatureViolation,
  sensorCoverageState,
} from './rules.js';

const now = new Date('2026-08-09T12:00:00.000Z');

describe('deterministic alert rules', () => {
  it('marks missing or old sensors as stale and accepts a recent sensor', () => {
    expect(isStale(null, now, 120)).toBe(true);
    expect(isStale(new Date('2026-08-09T09:59:00.000Z'), now, 120)).toBe(true);
    expect(isStale(new Date('2026-08-09T11:30:00.000Z'), now, 120)).toBe(false);
  });

  it('requires a door to remain open for the configured duration', () => {
    expect(isDoorOpenTooLong({ open: true }, new Date('2026-08-09T11:54:00Z'), now, 5)).toBe(true);
    expect(isDoorOpenTooLong({ open: false }, new Date('2026-08-09T11:50:00Z'), now, 5)).toBe(
      false,
    );
  });

  it('requires a continuous temperature violation and resets after normal data', () => {
    const low = persistentTemperatureViolation(
      [
        { occurredAt: new Date('2026-08-09T11:40:00Z'), value: 16.8 },
        { occurredAt: new Date('2026-08-09T11:50:00Z'), value: 16.5 },
      ],
      now,
      17,
      15,
      'low',
    );
    expect(low.active).toBe(true);
    const recovered = persistentTemperatureViolation(
      [
        { occurredAt: new Date('2026-08-09T11:30:00Z'), value: 16.5 },
        { occurredAt: new Date('2026-08-09T11:55:00Z'), value: 18 },
      ],
      now,
      17,
      15,
      'low',
    );
    expect(recovered.active).toBe(false);
  });

  it('supports an overnight activity window in the home timezone', () => {
    expect(isInMinuteWindow(23 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(isInMinuteWindow(3 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(isInMinuteWindow(12 * 60, 22 * 60, 6 * 60)).toBe(false);
    expect(
      countNightActivity(
        [new Date('2026-08-09T00:10:00Z'), new Date('2026-08-09T10:00:00Z')],
        'Europe/Paris',
        22 * 60,
        6 * 60,
      ),
    ).toBe(1);
  });

  it('reads safe numeric values from sensor payloads', () => {
    expect(numericPayload({ value: 8 })).toBe(8);
    expect(numericPayload({ value: '15.5' })).toBe(15.5);
    expect(numericPayload({ value: 'unknown' })).toBeNull();
  });

  it('does not report a coverage outage before a real sensor is configured', () => {
    expect(sensorCoverageState(0, 0)).toBe('UNCONFIGURED');
    expect(sensorCoverageState(2, 0)).toBe('OUTAGE');
    expect(sensorCoverageState(2, 1)).toBe('READY');
  });
});
