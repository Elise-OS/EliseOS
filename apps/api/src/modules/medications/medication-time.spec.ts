import { describe, expect, it } from 'vitest';
import { localDateKey, minuteFromTime, scheduledDate, weekdayForDateKey } from './medication-time';

describe('medication local scheduling', () => {
  it('builds a Europe/Paris dose in winter and summer', () => {
    expect(scheduledDate('2026-01-10', 8 * 60, 'Europe/Paris').toISOString()).toBe(
      '2026-01-10T07:00:00.000Z',
    );
    expect(scheduledDate('2026-08-10', 8 * 60, 'Europe/Paris').toISOString()).toBe(
      '2026-08-10T06:00:00.000Z',
    );
  });

  it('keeps the local date around the UTC day boundary', () => {
    expect(localDateKey(new Date('2026-08-09T22:30:00.000Z'), 'Europe/Paris')).toBe('2026-08-10');
    expect(weekdayForDateKey('2026-08-10')).toBe(1);
    expect(minuteFromTime('08:30')).toBe(510);
  });
});
