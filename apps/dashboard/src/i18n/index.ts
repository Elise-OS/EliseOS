import {
  blockReader,
  createI18n,
  isLanguage,
  LANGUAGES,
  languageInfo,
  SOURCE_LANGUAGE,
  type Language,
} from '@elise/i18n';
import en from './locales/en.json';
import fr from './locales/fr.json';

export type { Language };
export type Locale = Language;
export const isLocale = isLanguage;
/** Choices of the language selectors, with their name and flag. */
export const dashboardLanguages = LANGUAGES;

/** ?lang= in the address (TV, links), then the choice saved in this browser; French otherwise. */
function initialLanguage(): Language {
  if (typeof window === 'undefined') return SOURCE_LANGUAGE;
  const asked = new URLSearchParams(window.location.search).get('lang');
  if (isLanguage(asked)) return asked;
  try {
    const saved = window.localStorage.getItem('elise_locale');
    return isLanguage(saved) ? saved : SOURCE_LANGUAGE;
  } catch {
    return SOURCE_LANGUAGE;
  }
}

// One import per language: TypeScript flags a language of LANGUAGES without catalog here.
const i18n = createI18n({ fr, en }, initialLanguage());

/**
 * Translated text for a key of locales/fr.json, in the current language.
 * Values are inserted with {{name}}: t('welcomePage.greeting', { name }).
 */
export const t = i18n.t.bind(i18n);

/** A whole block of texts with the layout of fr.json: textBlock('app.copy'). */
export const textBlock = blockReader(i18n, fr);

/** Kept in step with the language chosen in the setup or the settings. */
export function setLanguage(language: Language) {
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

export const currentLanguage = () => i18n.language as Language;

/** BCP 47 tag for Intl dates and numbers ("fr-FR", "en-GB"…). */
export const dateLocale = () => languageInfo(currentLanguage()).dateLocale;
