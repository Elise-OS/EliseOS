import { blockReader, createI18n, languageInfo, type Language } from '@elise/i18n';
import en from './locales/en.json';
import fr from './locales/fr.json';

// One import per language: TypeScript flags a language of LANGUAGES without catalog here.
const i18n = createI18n({ fr, en });

export type { Language } from '@elise/i18n';
export { isLanguage, LANGUAGES } from '@elise/i18n';

/**
 * Translated text for a key of locales/fr.json, in the current language.
 * Values are inserted with {{name}}: t('home.greeting', { name }).
 */
export const t = i18n.t.bind(i18n);

/** A whole block of texts with the layout of fr.json: textBlock('welcomeExperience.copy'). */
export const textBlock = blockReader(i18n, fr);

/** Kept in step with the language chosen on the welcome screen or in the settings. */
export function setLanguage(language: Language) {
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

export const currentLanguage = () => i18n.language as Language;

/** BCP 47 tag for Intl dates and numbers ("fr-FR", "en-GB"…). */
export const dateLocale = () => languageInfo(currentLanguage()).dateLocale;
