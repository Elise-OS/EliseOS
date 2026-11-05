import { createI18n, matchLanguage } from '@elise/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { currentLanguage, dateLocale, setLanguage, t } from '.';

afterEach(() => setLanguage('fr'));

describe('App texts', () => {
  it('follow the chosen language, values included', () => {
    setLanguage('fr');
    expect(t('formatters.minAgo', { minutes: 5 })).toBe('Il y a 5 min');
    setLanguage('en');
    expect(currentLanguage()).toBe('en');
    expect(t('formatters.minAgo', { minutes: 5 })).toBe('5 min ago');
    expect(dateLocale()).toBe('en-GB');
  });

  it('use the plural rules of each language', () => {
    setLanguage('fr');
    expect(t('mobileHomePlanPanel.sensorCount', { count: 0 })).toBe('0 capteur');
    expect(t('mobileHomePlanPanel.sensorCount', { count: 1 })).toBe('1 capteur');
    expect(t('mobileHomePlanPanel.sensorCount', { count: 3 })).toBe('3 capteurs');
    setLanguage('en');
    expect(t('mobileHomePlanPanel.sensorCount', { count: 0 })).toBe('0 sensors');
    expect(t('mobileHomePlanPanel.sensorCount', { count: 1 })).toBe('1 sensor');
  });

  it('keep the characters of inserted values', () => {
    setLanguage('en');
    expect(t('mobileWelcomePanel.roomWithArticle.named', { name: 'Salon & bureau' })).toBe(
      'Salon & bureau',
    );
  });

  it('read whole screens as blocks', () => {
    setLanguage('en');
    const copy = t('remoteAccessStep.copy', { returnObjects: true });
    expect(copy.benefits).toHaveLength(3);
    expect(copy.connect).toBe('Link Élise');
  });
});

describe('Language of a new install', () => {
  it('is the phone language when Élise speaks it, English otherwise', () => {
    expect(matchLanguage(['fr-FR'])).toBe('fr');
    expect(matchLanguage(['fr_CA'])).toBe('fr');
    expect(matchLanguage(['en-US'])).toBe('en');
    expect(matchLanguage(['de-DE', 'fr-FR'])).toBe('fr');
    expect(matchLanguage(['ja-JP'])).toBe('en');
    expect(matchLanguage([undefined])).toBe('en');
  });

  it('falls back to English for a text a translation lacks', () => {
    const i18n = createI18n({ fr: { a: 'Bonjour' }, en: { a: 'Hello', b: 'Not translated yet' } });
    // The app's keys are typed; this test catalog has its own.
    const translate = i18n.t.bind(i18n) as unknown as (key: string) => string;
    expect(translate('a')).toBe('Bonjour');
    expect(translate('b')).toBe('Not translated yet');
  });
});
