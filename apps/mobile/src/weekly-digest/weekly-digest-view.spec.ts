import type { WeeklyDigest } from '@elise/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDemoRequest, resetDemoSession } from '../demo/mock-api';
import { setLanguage } from '../i18n';
import {
  digestAlertsView,
  digestCardView,
  digestChangesView,
  digestChartData,
  digestSensorsView,
  digestThemesView,
  toBase64,
  weeklyDigestPdfPath,
} from './weekly-digest-view';

const latest = () => mockDemoRequest<WeeklyDigest>('/weekly-digest');

describe('weekly digest in the mobile notebook', () => {
  // The demo shows the last week ready: the one of Monday 5 October 2026 here.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T08:40:00Z'));
    setLanguage('fr');
    resetDemoSession();
  });
  afterEach(() => {
    vi.useRealTimers();
    setLanguage('fr');
    resetDemoSession();
  });

  it('gives the card the week, its sentence, what changed first and four themes', () => {
    const view = digestCardView(latest(), 'fr');
    expect(view.title).toBe('Bilan de la semaine');
    expect(view.summary).toBe('4 changements par rapport aux habitudes cette semaine.');
    expect(view.highlights).toHaveLength(2);
    expect(view.highlights[0].text).toMatch(/^Lever en moyenne 40\u00a0min plus tard/);
    expect(view.tiles.map((tile) => tile.theme)).toEqual(['nights', 'meals', 'outings', 'visits']);
    expect(view.tiles[1].value).toBe('3 repas semblent manqués');
    expect(view.tiles[0].trend).toEqual({ tone: 'change', label: '40\u00a0min plus tard' });
  });

  it('lists three to five changes, sensor problems included', () => {
    const changes = digestChangesView(latest(), 'fr');
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(changes.length).toBeLessThanOrEqual(5);
    expect(changes.at(-1)).toMatchObject({ tone: 'warning', theme: 'sensors' });
  });

  it('describes each theme with the usual, its facts and how it is measured', () => {
    const [nights, meals, outings, visits] = digestThemesView(latest(), 'fr');
    expect(nights.stats[1]).toMatchObject({ label: 'Lever', usual: 'D’habitude : 07:18' });
    expect(nights.method).toBe('Mesuré par le capteur du lit.');
    expect(meals.facts[0].text).toBe(
      '3 repas semblent manqués\u00a0: Jeu midi, Ven matin, Sam midi',
    );
    expect(outings.stats[0]).toMatchObject({ value: '3', usual: 'D’habitude : 7' });
    expect(visits.method).toBe(
      'Élise ne reconnaît pas les personnes : les visites viennent du calendrier.',
    );
  });

  it('shows alerts and the sensor that had a problem', () => {
    const digest = latest();
    expect(digestAlertsView(digest, 'fr').items).toHaveLength(2);
    expect(digestSensorsView(digest, 'fr').items[0]).toMatchObject({
      badge: 'Pile faible',
      title: 'Détecteur de mouvement · Salle de bain',
    });
  });

  it('says what is not equipped instead of inventing it', () => {
    const digest = latest();
    const bare: WeeklyDigest = {
      ...digest,
      nights: { ...digest.nights, state: 'NOT_EQUIPPED' },
      outings: { ...digest.outings, state: 'NOT_EQUIPPED' },
      visitSummary: {
        ...digest.visitSummary,
        calls: { ...digest.visitSummary.calls, state: 'NOT_EQUIPPED' },
      },
    };
    const [nights, , outings, visits] = digestThemesView(bare, 'fr');
    expect(nights.message).toBe('Aucun capteur ne permet de suivre les nuits.');
    expect(outings.message).toContain('La porte d’entrée n’a pas de capteur');
    expect(visits.facts.map((fact) => fact.text)).toContain(
      'Les appels vidéo de cette semaine ne sont pas connus.',
    );
  });

  it('gives seven days to every chart', () => {
    const data = digestChartData(latest(), 'fr');
    expect(data.days).toEqual(['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']);
    expect(data.nights).toHaveLength(7);
    expect(data.meals.every((day) => day.length === 3)).toBe(true);
    expect(data.outings).toHaveLength(7);
    expect(data.visits).toHaveLength(7);
  });

  it('follows the language of the app, demo included', () => {
    setLanguage('es');
    resetDemoSession();
    const view = digestCardView(latest(), 'es');
    expect(view.title).toBe('Resumen de la semana');
    expect(digestSensorsView(latest(), 'es').items[0].title).toContain('Detector de movimiento');
  });

  it('asks the box for the PDF of the week, and writes a PDF made on the phone', () => {
    expect(weeklyDigestPdfPath('2026-11-16', 'it')).toBe(
      '/api/v1/weekly-digest/pdf?week=2026-11-16&lang=it',
    );
    expect(toBase64(new TextEncoder().encode('%PDF-1.3'))).toBe('JVBERi0xLjM=');
    expect(toBase64(new Uint8Array([255, 1]))).toBe('/wE=');
  });
});
