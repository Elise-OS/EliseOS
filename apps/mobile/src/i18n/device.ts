import { matchLanguage, type Language } from '@elise/i18n';
import { I18nManager, Platform, Settings } from 'react-native';

/**
 * Languages chosen in the phone settings, most preferred first. Hermes' Intl does not see
 * them on iOS (it always answers English), so they are read from each platform instead.
 */
function preferredLanguages(): string[] {
  try {
    if (Platform.OS === 'ios') {
      const languages: unknown = Settings.get('AppleLanguages');
      if (Array.isArray(languages)) return languages.filter((tag) => typeof tag === 'string');
      const locale: unknown = Settings.get('AppleLocale');
      if (typeof locale === 'string') return [locale];
    }
    if (Platform.OS === 'android') {
      const { localeIdentifier } = I18nManager.getConstants() as { localeIdentifier?: string };
      if (localeIdentifier) return [localeIdentifier];
    }
    if (typeof navigator !== 'undefined' && navigator.languages?.length)
      return [...navigator.languages];
  } catch {
    // An unreadable setting only means falling back on Intl below.
  }
  return [Intl.DateTimeFormat().resolvedOptions().locale];
}

/** The phone's own language when Élise speaks it (English otherwise), until the user picks one. */
export function deviceLanguage(): Language {
  return matchLanguage(preferredLanguages());
}
