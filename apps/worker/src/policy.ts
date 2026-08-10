export interface ScoreLike {
  score: number;
  confidence: number;
  isAnomaly?: boolean;
}

// HabitStatus is a PostgreSQL enum. Keep the worker on a value defined by the
// Prisma schema and use validTo to retire the previous learned profile.
export const LEARNED_HABIT_STATUS = 'CONFIRMED' as const;

export function shouldCreateAnomalyAlert(current: ScoreLike, previous?: ScoreLike): boolean {
  return Boolean(
    current.isAnomaly &&
    current.score >= 0.85 &&
    current.confidence >= 0.8 &&
    previous &&
    previous.score >= 0.85 &&
    previous.confidence >= 0.8,
  );
}
