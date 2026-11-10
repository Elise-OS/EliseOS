import { currentLanguage, dateLocale, setLanguage, type Language } from './i18n';

// Former entry point of the app language, kept so existing imports keep working.
export type AppLocale = Language;
export const setAppLocale = setLanguage;
export const appLocale = currentLanguage;
export { dateLocale };
