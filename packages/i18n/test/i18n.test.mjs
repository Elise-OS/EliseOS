// Language rules shared by the dashboard and the mobile app. Runs against the built package.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FALLBACK_LANGUAGE,
  LANGUAGE_CODES,
  FLAGS,
  blockReader,
  createI18n,
  isLanguage,
  languageInfo,
  matchLanguage,
} from '../dist/index.js';

const catalogs = Object.fromEntries(
  LANGUAGE_CODES.map((code) => [code, { home: { title: `title-${code}` } }]),
);

describe('language choice', () => {
  it('takes the first supported language of the device preferences', () => {
    assert.equal(matchLanguage(['de-CH', 'it-IT', 'fr-FR']), 'it');
    assert.equal(matchLanguage(['PT_br']), 'pt');
  });

  it('falls back to English when nothing matches', () => {
    assert.equal(matchLanguage(['de-DE', null, undefined]), FALLBACK_LANGUAGE);
    assert.equal(matchLanguage([]), 'en');
  });

  it('recognises only the languages Élise offers', () => {
    assert.equal(isLanguage('es'), true);
    assert.equal(isLanguage('de'), false);
    assert.equal(isLanguage(undefined), false);
    assert.equal(languageInfo('pt').dateLocale, 'pt-PT');
  });

  it('has a flag for every language', () => {
    for (const code of LANGUAGE_CODES) assert.ok(FLAGS[code], code);
  });
});

describe('createI18n', () => {
  it('answers synchronously in the chosen language', () => {
    const i18n = createI18n(catalogs, 'es');
    assert.equal(i18n.t('home.title'), 'title-es');
  });

  it('shows English for a text missing in a translation', () => {
    const i18n = createI18n({ ...catalogs, it: { home: {} } }, 'it');
    assert.equal(i18n.t('home.title'), 'title-en');
  });

  it('keeps inserted values unescaped (React escapes them)', () => {
    const i18n = createI18n({ ...catalogs, fr: { hello: 'Bonjour {{name}}' } }, 'fr');
    assert.equal(i18n.t('hello', { name: 'Paul & Marie' }), 'Bonjour Paul & Marie');
  });
});

describe('blockReader', () => {
  const source = { screen: { title: 'Titre', steps: ['Un', 'Deux'], count: 2 } };

  it('rebuilds a block in the current language, text by text', () => {
    const i18n = createI18n(
      {
        ...catalogs,
        fr: source,
        en: { screen: { title: 'Title', steps: ['One', 'Two'] } },
        es: { screen: { title: 'Título', steps: ['Uno'] } },
      },
      'es',
    );
    const block = blockReader(i18n, source)('screen');
    assert.deepEqual(block, { title: 'Título', steps: ['Uno', 'Two'], count: 2 });
  });

  it('reports a block that does not exist', () => {
    const i18n = createI18n(catalogs, 'fr');
    assert.throws(() => blockReader(i18n, source)('missing.block'), /No text block/);
  });
});
