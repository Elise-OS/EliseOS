import type fr from './locales/fr.json';

// Keys passed to t() are checked against the French catalog, the source of every translation.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof fr };
    returnNull: false;
  }
}
