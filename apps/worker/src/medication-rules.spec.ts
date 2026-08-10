import { describe, expect, it } from 'vitest';
import { isDosePastConfirmationWindow, missedDoseCopy } from './medication-rules.js';

describe('medication rules', () => {
  it('waits for the complete confirmation margin before flagging a dose', () => {
    const scheduledFor = new Date('2026-08-09T06:30:00.000Z');

    expect(
      isDosePastConfirmationWindow(scheduledFor, 60, new Date('2026-08-09T07:29:59.999Z')),
    ).toBe(false);
    expect(
      isDosePastConfirmationWindow(scheduledFor, 60, new Date('2026-08-09T07:30:00.000Z')),
    ).toBe(true);
  });

  it('uses prudent wording for an unconfirmed dose', () => {
    const copy = missedDoseCopy('Traitement du matin', '1 comprimé', '08:30');

    expect(copy.title).toBe('Prise de 08:30 non confirmée');
    expect(copy.explanation).toContain('Un oubli est possible');
    expect(copy.explanation).not.toContain('n’a pas été pris');
  });
});
