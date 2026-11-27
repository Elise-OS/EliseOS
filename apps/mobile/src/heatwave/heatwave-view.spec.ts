import { DEFAULT_HEATWAVE_SETTINGS, type HeatwaveStatus } from '@elise/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { mockDemoRequest, resetDemoSession } from '../demo/mock-api';
import {
  duration,
  heatwaveFacts,
  heatwaveStateText,
  heatwaveStatusLabel,
  heatwaveSummary,
  settingsValid,
  stepValue,
  withEndHour,
  withStartHour,
} from './heatwave-view';

afterEach(() => {
  setLanguage('fr');
  resetDemoSession();
});

describe('heatwave view', () => {
  it('tells durations and the default settings in plain French', () => {
    setLanguage('fr');
    expect(duration(30)).toBe('30 min');
    expect(duration(60)).toBe('1 h');
    expect(duration(90)).toBe('1 h 30');
    expect(heatwaveSummary(DEFAULT_HEATWAVE_SETTINGS)).toEqual([
      'Élise active le mode canicule quand une pièce atteint 28 °C pendant 30 min, ou quand la météo annonce 33 °C ou plus pour aujourd’hui ou demain.',
      'Pendant le mode, la TV propose un verre d’eau toutes les 2 h, de 9 h à 20 h.',
      'Elle donne aussi des conseils selon le moment de la journée.',
      'La famille est alertée si une pièce reste à 31 °C ou plus pendant 1 h.',
    ]);
  });

  it('keeps the steppers and the reminder hours inside what the box accepts', () => {
    expect(stepValue(28, 0.5, 24, 40, 0.5)).toBe(28.5);
    expect(stepValue(40, 0.5, 24, 40, 0.5)).toBe(40);
    expect(stepValue(10, -10, 10, 240, 10)).toBe(10);
    const late = withStartHour(DEFAULT_HEATWAVE_SETTINGS, 20);
    expect(late.reminders).toMatchObject({ startHour: 20, endHour: 21 });
    expect(withEndHour(late, 19).reminders.endHour).toBe(21);
    expect(settingsValid(late)).toBe(true);
  });

  it('reads the demo heatwave status and lets the family turn it on', () => {
    setLanguage('fr');
    resetDemoSession();
    const idle = mockDemoRequest<HeatwaveStatus>('/heatwave');
    expect(heatwaveStatusLabel(idle)).toBe('En veille');
    expect(heatwaveStateText(idle)).toContain('Élise l’activera');

    const on = mockDemoRequest<HeatwaveStatus>('/heatwave/manual', {
      method: 'POST',
      body: JSON.stringify({ active: true }),
    });
    expect(heatwaveStatusLabel(on)).toBe('Activé');
    expect(heatwaveStateText(on)).toBe(
      'Activé par la famille. Il reste actif jusqu’à ce que vous le désactiviez.',
    );
    const facts = heatwaveFacts(on);
    expect(facts.map(({ key }) => key)).toEqual(['indoor', 'forecast', 'reminders']);
    expect(facts[1]?.label).toBe('Prévision à Lyon');
    expect(facts[2]?.value).toBe('0 confirmé · 0 sans réponse');

    const saved = mockDemoRequest<HeatwaveStatus>('/heatwave/settings', {
      method: 'PUT',
      body: JSON.stringify({
        ...DEFAULT_HEATWAVE_SETTINGS,
        reminders: { ...DEFAULT_HEATWAVE_SETTINGS.reminders, enabled: false },
      }),
    });
    expect(heatwaveFacts(saved)[2]?.value).toBe('Rappels désactivés');
    expect(() =>
      mockDemoRequest('/heatwave/settings', { method: 'PUT', body: JSON.stringify({}) }),
    ).toThrow();
  });

  it('speaks the visitor’s language', () => {
    setLanguage('en');
    resetDemoSession();
    const status = mockDemoRequest<HeatwaveStatus>('/heatwave');
    expect(heatwaveStatusLabel(status)).toBe('Standing by');
  });
});
