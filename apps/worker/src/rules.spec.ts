import { describe, expect, it } from 'vitest';
import {
  clearanceConfirmed,
  countNightActivity,
  countCurrentNightActivity,
  isDoorOpenTooLong,
  isInMinuteWindow,
  isStale,
  isUnavailableLongEnough,
  numericPayload,
  persistentTemperatureViolation,
  sensorCoverageState,
  shouldOpenInactivityAlert,
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
    expect(isDoorOpenTooLong({ open: 'false' }, new Date('2026-08-09T11:50:00Z'), now, 5)).toBe(
      false,
    );
  });

  it('requires a continuous temperature violation and resets after normal data', () => {
    const low = persistentTemperatureViolation(
      [
        { occurredAt: new Date('2026-08-09T11:30:00Z'), value: 16.8 },
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
    expect(
      persistentTemperatureViolation(
        [{ occurredAt: new Date('2026-08-09T11:40:00Z'), value: 16.5 }],
        now,
        17,
        15,
        'low',
      ).active,
    ).toBe(false);
    expect(
      persistentTemperatureViolation(
        [
          { occurredAt: new Date('2026-08-09T10:00:00Z'), value: 16.5 },
          { occurredAt: new Date('2026-08-09T10:20:00Z'), value: 16.2 },
        ],
        now,
        17,
        15,
        'low',
      ).active,
    ).toBe(false);
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
    const duringNight = new Date('2026-08-09T23:30:00Z');
    expect(
      countCurrentNightActivity(
        [
          new Date('2026-08-09T02:30:00Z'),
          new Date('2026-08-09T21:00:00Z'),
          new Date('2026-08-09T21:02:00Z'),
          new Date('2026-08-09T21:10:00Z'),
          new Date('2026-08-09T23:00:00Z'),
        ],
        duringNight,
        'Europe/Paris',
        22 * 60,
        6 * 60,
      ),
    ).toBe(3);
    expect(
      countCurrentNightActivity(
        [new Date('2026-08-09T21:00:00Z')],
        new Date('2026-08-10T12:00:00Z'),
        'Europe/Paris',
        22 * 60,
        6 * 60,
      ),
    ).toBe(0);
  });

  it('reads safe numeric values from sensor payloads', () => {
    expect(numericPayload({ value: 8 })).toBe(8);
    expect(numericPayload({ value: '15.5' })).toBe(15.5);
    expect(numericPayload({ value: 'unknown' })).toBeNull();
  });

  it('does not report a coverage outage before a real sensor is configured', () => {
    expect(sensorCoverageState(0, 0)).toBe('UNCONFIGURED');
    expect(sensorCoverageState(2, 0)).toBe('OUTAGE');
    expect(sensorCoverageState(2, 1)).toBe('OUTAGE');
    expect(sensorCoverageState(2, 2)).toBe('READY');
    expect(shouldOpenInactivityAlert(null, now, 180, 'READY')).toBe(false);
    expect(shouldOpenInactivityAlert(new Date('2026-08-09T08:00:00Z'), now, 180, 'OUTAGE')).toBe(
      false,
    );
    expect(shouldOpenInactivityAlert(new Date('2026-08-09T08:00:00Z'), now, 180, 'READY')).toBe(
      true,
    );
  });

  it('respects the configured unavailability delay without treating silence as an outage', () => {
    expect(isUnavailableLongEnough(true, new Date('2026-08-09T08:00:00Z'), now, 120)).toBe(false);
    expect(isUnavailableLongEnough(false, null, now, 120)).toBe(false);
    expect(isUnavailableLongEnough(false, new Date('2026-08-09T11:00:00Z'), now, 120)).toBe(false);
    expect(isUnavailableLongEnough(false, new Date('2026-08-09T09:00:00Z'), now, 120)).toBe(true);
  });

  it('requires a sustained return to normal before closing or reopening an alert', () => {
    expect(clearanceConfirmed(null, now)).toBe(false);
    expect(clearanceConfirmed(new Date('2026-08-09T11:59:00Z'), now)).toBe(false);
    expect(clearanceConfirmed(new Date('2026-08-09T11:58:00Z'), now)).toBe(true);
  });
});
