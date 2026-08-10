import { describe, expect, it } from 'vitest';
import { LEARNED_HABIT_STATUS, shouldCreateAnomalyAlert } from './policy.js';

describe('anomaly alert policy', () => {
  it('uses a HabitStatus supported by the Prisma schema for learned routines', () => {
    expect(LEARNED_HABIT_STATUS).toBe('CONFIRMED');
  });

  it('requires two confident and persistent evaluations', () => {
    expect(shouldCreateAnomalyAlert({ score: 0.91, confidence: 0.9, isAnomaly: true })).toBe(false);
    expect(
      shouldCreateAnomalyAlert(
        { score: 0.91, confidence: 0.9, isAnomaly: true },
        { score: 0.88, confidence: 0.85 },
      ),
    ).toBe(true);
  });

  it('never escalates a low-confidence model result', () => {
    expect(
      shouldCreateAnomalyAlert(
        { score: 0.95, confidence: 0.4, isAnomaly: true },
        { score: 0.95, confidence: 0.9 },
      ),
    ).toBe(false);
  });
});
