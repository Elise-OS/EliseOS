import type { Locale } from './i18n';

/** The language chosen in this browser (or ?lang= in the address); French by default. */
export function uiLocale(): Locale {
  if (typeof window === 'undefined') return 'fr';
  const asked = new URLSearchParams(window.location.search).get('lang');
  if (asked === 'fr' || asked === 'en') return asked;
  try {
    return window.localStorage.getItem('elise_locale') === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

export const dateLocale = () => (uiLocale() === 'fr' ? 'fr-FR' : 'en-GB');
export const tr = (fr: string, en: string) => (uiLocale() === 'fr' ? fr : en);
