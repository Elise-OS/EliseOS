import { describe, expect, it } from 'vitest';
import { clockToDate, dateToClock, isClock, shiftClock } from './clock';

describe('clock', () => {
  it('accepts only 24-hour HH:MM times', () => {
    expect(isClock('07:30')).toBe(true);
    expect(isClock('23:59')).toBe(true);
    expect(isClock('24:00')).toBe(false);
    expect(isClock('7:30')).toBe(false);
    expect(isClock('7h30')).toBe(false);
    expect(isClock('ab:cd')).toBe(false);
  });

  it('moves by quarters of an hour across midnight', () => {
    expect(shiftClock('07:30', 15)).toBe('07:45');
    expect(shiftClock('23:50', 15)).toBe('00:05');
    expect(shiftClock('00:10', -15)).toBe('23:55');
  });

  it('falls back to a sensible time when the stored value is invalid', () => {
    expect(shiftClock('n/a', 15)).toBe('08:15');
    expect(dateToClock(clockToDate('lettres'))).toBe('08:00');
  });

  it('round-trips through the native picker date', () => {
    expect(dateToClock(clockToDate('21:05'))).toBe('21:05');
  });
});
