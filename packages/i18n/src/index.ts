import i18next, { type i18n, type Resource } from 'i18next';

/**
 * Languages offered by Élise OS. Adding a language: add a line here, its flag in flags.ts,
 * then a catalog (`<code>.json`) next to the French one in each app. TypeScript and
 * `elise-i18n-check` list what is missing.
 */
export const LANGUAGES = [
  { code: 'fr', name: 'Français', dateLocale: 'fr-FR' },
  { code: 'en', name: 'English', dateLocale: 'en-GB' },
  { code: 'es', name: 'Español', dateLocale: 'es-ES' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];
export type LanguageInfo = (typeof LANGUAGES)[number];

/** Catalogs are written in French first; the others are translations of it. */
export const SOURCE_LANGUAGE: Language = 'fr';
/** Shown when a text is missing in the chosen language. */
export const FALLBACK_LANGUAGE: Language = 'en';

export const LANGUAGE_CODES: readonly Language[] = LANGUAGES.map(({ code }) => code);

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

export function languageInfo(language: Language): LanguageInfo {
  return LANGUAGES.find(({ code }) => code === language) ?? LANGUAGES[0];
}

/**
 * First supported language among BCP 47 tags in order of preference ("de-CH", "en-US"…),
 * or the fallback language when none matches.
 */
export function matchLanguage(tags: readonly (string | null | undefined)[]): Language {
  for (const tag of tags) {
    const base = tag?.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return FALLBACK_LANGUAGE;
}

/** A ready, synchronous i18next instance: every catalog is bundled with the app. */
export function createI18n(
  catalogs: Record<Language, Record<string, unknown>>,
  language: Language = SOURCE_LANGUAGE,
): i18n {
  const resources: Resource = {};
  for (const code of LANGUAGE_CODES) resources[code] = { translation: catalogs[code] };
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...LANGUAGE_CODES],
    initAsync: false,
    returnNull: false,
    // React escapes values itself; double escaping would show "&amp;" in the app.
    interpolation: { escapeValue: false },
  });
  return instance;
}

/** Type of the value at a dotted path of a catalog ("screen.copy.hero"). */
export type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * Reader for whole blocks of texts (a screen's copy): it rebuilds the block from the source
 * catalog's layout and reads each text on its own, so a text missing in a translation falls
 * back to English instead of leaving a hole in the block.
 */
export function blockReader<Source>(instance: i18n, source: Source) {
  const translate = instance.t.bind(instance) as unknown as (key: string) => string;
  const build = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') return translate(path);
    if (Array.isArray(node)) return node.map((item, index) => build(item, `${path}.${index}`));
    if (node && typeof node === 'object')
      return Object.fromEntries(
        Object.entries(node).map(([key, item]) => [key, build(item, `${path}.${key}`)]),
      );
    return node;
  };
  return <P extends string>(path: P): PathValue<Source, P> => {
    const node = path
      .split('.')
      .reduce<unknown>(
        (value, key) => (value as Record<string, unknown> | undefined)?.[key],
        source,
      );
    if (node === undefined) throw new Error(`No text block "${path}" in the catalog`);
    return build(node, path) as PathValue<Source, P>;
  };
}

export { FLAG_VIEWBOX, FLAGS, type FlagShape } from './flags.js';
