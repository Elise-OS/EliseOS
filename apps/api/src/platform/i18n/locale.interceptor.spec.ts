import { describe, expect, it } from 'vitest';
import { wantsEnglish } from './locale.interceptor';

const withLanguage = (language?: string) =>
  ({ headers: language === undefined ? {} : { 'x-elise-locale': language } }) as never;

describe('Language of the answers', () => {
  it('keeps French without header or for French', () => {
    expect(wantsEnglish(withLanguage())).toBe(false);
    expect(wantsEnglish(withLanguage(''))).toBe(false);
    expect(wantsEnglish(withLanguage('fr'))).toBe(false);
    expect(wantsEnglish(withLanguage('fr-CA'))).toBe(false);
  });

  it('answers in English for English and the languages the server does not speak yet', () => {
    expect(wantsEnglish(withLanguage('en'))).toBe(true);
    expect(wantsEnglish(withLanguage('es'))).toBe(true);
    expect(wantsEnglish(withLanguage('it'))).toBe(true);
    expect(wantsEnglish(withLanguage('pt'))).toBe(true);
    expect(wantsEnglish(withLanguage('de'))).toBe(true);
  });
});
