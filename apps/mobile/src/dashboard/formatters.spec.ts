import { describe, expect, it } from 'vitest';
import { friendlyValue, relativeTime, roomOf } from './formatters';

describe('dashboard formatters', () => {
  it('formats local sensor values without exposing raw payloads', () => {
    expect(friendlyValue({ value: 21.4, unit: '°C' })).toBe('21.4 °C');
    expect(friendlyValue({ open: false })).toBe('Fermé');
    expect(friendlyValue({ active: true })).toBe('Détecté');
  });

  it('formats cached timestamps and room fallbacks', () => {
    const now = new Date('2026-08-03T12:00:00.000Z').getTime();
    expect(relativeTime('2026-08-03T11:42:00.000Z', now)).toBe('Il y a 18 min');
    expect(
      roomOf({
        id: 'event-1',
        capability: 'motion',
        payload: {},
        occurredAt: new Date(now).toISOString(),
      }),
    ).toBe('Maison');
  });
});
