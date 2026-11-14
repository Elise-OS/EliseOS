import {
  addCatalog,
  blockReader,
  createI18n,
  FALLBACK_LANGUAGE,
  isLanguage,
  LANGUAGES,
  languageInfo,
  SOURCE_LANGUAGE,
  type Language,
  type PathValue,
} from '@elise/i18n';
import type fr from './locales/fr.json';

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

type Catalog = typeof fr;

// One entry per language: TypeScript flags a language of LANGUAGES without catalog here.
// Each catalog is its own file, downloaded only by the people who read that language.
const catalogFiles: Record<Language, () => Promise<{ default: unknown }>> = {
  fr: () => import('./locales/fr.json'),
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  it: () => import('./locales/it.json'),
  pt: () => import('./locales/pt.json'),
};

const i18n = createI18n({}, initialLanguage());
let source: Catalog | null = null;
const loading = new Map<Language, Promise<void>>();

function loadCatalog(language: Language): Promise<void> {
  let pending = loading.get(language);
  if (!pending) {
    pending = catalogFiles[language]().then((file) => {
      const catalog = file.default as Catalog;
      addCatalog(i18n, language, catalog);
      if (language === SOURCE_LANGUAGE) source = catalog;
    });
    // A failed download (network drop) can be tried again.
    pending.catch(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/**
 * Downloads what a language needs before anything is displayed in it: its own catalog and
 * the French one, whose layout shapes the text blocks. To call before the first render and
 * before every change of language.
 */
export async function loadLanguage(language: Language): Promise<void> {
  await Promise.all([loadCatalog(SOURCE_LANGUAGE), loadCatalog(language)]);
  // The fallback only fills a text missing from a translation: it arrives in the background.
  if (language !== SOURCE_LANGUAGE) void loadCatalog(FALLBACK_LANGUAGE).catch(() => undefined);
}

/** Every catalog at once, for the tests, which switch language synchronously. */
export async function loadAllLanguages(): Promise<void> {
  await Promise.all(LANGUAGES.map(({ code }) => loadCatalog(code)));
}

/**
 * Translated text for a key of locales/fr.json, in the current language.
 * Values are inserted with {{name}}: t('welcomePage.greeting', { name }).
 */
export const t = i18n.t.bind(i18n);

/** A whole block of texts with the layout of fr.json: textBlock('app.copy'). */
export const textBlock = <P extends string>(path: P): PathValue<Catalog, P> => {
  if (!source) throw new Error('loadLanguage() must finish before texts are read');
  return blockReader(i18n, source)(path);
};

/** Kept in step with the language chosen in the setup or the settings. */
export function setLanguage(language: Language) {
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

export const currentLanguage = () => i18n.language as Language;

/** BCP 47 tag for Intl dates and numbers ("fr-FR", "en-GB"…). */
export const dateLocale = () => languageInfo(currentLanguage()).dateLocale;
