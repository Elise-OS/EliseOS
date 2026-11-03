import { describe, expect, it } from 'vitest';
import { toEnglish, translateDeep } from './english';

describe('English texts', () => {
  it('translates fixed messages and alerts written by the worker', () => {
    expect(toEnglish('Pièce introuvable.')).toBe('Room not found.');
    expect(toEnglish('Température basse dans le logement')).toBe('Low temperature in the home');
    expect(toEnglish('Aucun mouvement depuis 3 h')).toBe('No movement for 3 hr');
    expect(toEnglish('Prise de 08:00 non confirmée')).toBe('08:00 dose not confirmed');
  });

  it('leaves names typed by the family untouched', () => {
    expect(toEnglish('Cuisine')).toBe('Cuisine');
    expect(toEnglish('Chambre de Jeanne')).toBe('Chambre de Jeanne');
  });

  it('walks answers without touching dates, numbers or keys', () => {
    const at = new Date('2026-11-03T10:00:00Z');
    expect(
      translateDeep({ message: 'Podcast lancé', items: [{ title: 'Radio lancée', at, count: 2 }] }),
    ).toEqual({ message: 'Podcast started', items: [{ title: 'Radio started', at, count: 2 }] });
  });
});
