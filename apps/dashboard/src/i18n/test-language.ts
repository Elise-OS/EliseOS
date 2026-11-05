import { setLanguage, type Language } from '.';

/** Renders (or computes) in a language for a test, then returns to French. */
export function inLanguage<T>(language: Language, run: () => T): T {
  setLanguage(language);
  try {
    return run();
  } finally {
    setLanguage('fr');
  }
}
