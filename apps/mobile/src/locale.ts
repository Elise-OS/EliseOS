export type AppLocale = 'fr' | 'en';

let current: AppLocale = 'fr';

/** Kept in step with the language chosen on the welcome screen or in the settings. */
export function setAppLocale(locale: AppLocale) {
  current = locale;
}

export const appLocale = () => current;
export const dateLocale = () => (current === 'fr' ? 'fr-FR' : 'en-GB');
export const tr = (fr: string, en: string) => (current === 'fr' ? fr : en);
