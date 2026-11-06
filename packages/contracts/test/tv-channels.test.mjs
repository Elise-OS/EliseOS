import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEGACY_TV_CHANNEL_CHOICES,
  TV_CHANNELS,
  TV_GUIDE_SOURCES,
  cleanTvChannelChoices,
  defaultTvChannels,
  installationTvLanguage,
  isSupportedTvLiveUrl,
  screenMediaSchema,
  toggleTvChannel,
  tvChannelLanguage,
  tvChannelLineup,
} from '../dist/index.js';

const ids = (channels) => channels.map(({ id }) => id);
const FRENCH = ['arte', 'rmcLife', 'rmcStory', 'rmcDecouverte'];

test('the catalog has unique ids and URLs, known guide sources and HTTPS streams', () => {
  assert.equal(new Set(ids(TV_CHANNELS)).size, TV_CHANNELS.length);
  assert.equal(new Set(TV_CHANNELS.map(({ url }) => url)).size, TV_CHANNELS.length);
  for (const channel of TV_CHANNELS) {
    assert.match(channel.url, /^https:\/\/.+\.m3u8$/);
    assert.ok(channel.languages.length > 0, channel.id);
    if (channel.guide) assert.ok(TV_GUIDE_SOURCES[channel.guide.source], channel.id);
  }
});

test('a French screen keeps the four historical channels', () => {
  assert.deepEqual(ids(defaultTvChannels('fr', 'Europe/Paris')), FRENCH);
  assert.deepEqual(ids(tvChannelLineup('fr-FR', undefined, 'Europe/Paris')), FRENCH);
});

test('a Spanish screen gets Spanish channels; La 2 only in Spain', () => {
  const abroad = ids(defaultTvChannels('es', 'Europe/Paris'));
  assert.ok(abroad.includes('la1') && abroad.includes('canal24h'));
  assert.ok(!abroad.includes('la2'));
  assert.ok(ids(defaultTvChannels('es', 'Europe/Madrid')).includes('la2'));
  assert.ok(!abroad.some((id) => FRENCH.includes(id)));
});

test('a language without channels falls back to English', () => {
  assert.equal(tvChannelLanguage('de'), 'en');
  assert.equal(tvChannelLanguage(null), 'en');
  assert.equal(tvChannelLanguage('ES'), 'es');
  assert.deepEqual(ids(defaultTvChannels('de')), ids(defaultTvChannels('en')));
  assert.ok(defaultTvChannels('en').length > 0);
});

test('the caregiver adds channels of another language and removes default ones', () => {
  let choices = toggleTvChannel(undefined, 'arte', true, 'es', 'Europe/Paris');
  assert.deepEqual(choices, { added: ['arte'], removed: [] });
  choices = toggleTvChannel(choices, 'clan', false, 'es', 'Europe/Paris');
  assert.deepEqual(choices, { added: ['arte'], removed: ['clan'] });
  const lineup = ids(tvChannelLineup('es', choices, 'Europe/Paris'));
  assert.ok(lineup.includes('arte') && lineup.includes('la1') && !lineup.includes('clan'));
  choices = toggleTvChannel(choices, 'arte', false, 'es', 'Europe/Paris');
  choices = toggleTvChannel(choices, 'clan', true, 'es', 'Europe/Paris');
  assert.deepEqual(choices, { added: [], removed: [] });
});

test('screens set up before keep the French channels in any language', () => {
  for (const language of ['fr', 'en', 'es']) {
    const lineup = ids(tvChannelLineup(language, LEGACY_TV_CHANNEL_CHOICES, 'Europe/Paris'));
    for (const id of FRENCH) assert.ok(lineup.includes(id), `${language}: ${id}`);
  }
});

test('unknown channel ids are dropped from the choices', () => {
  assert.deepEqual(cleanTvChannelChoices({ added: ['arte', 'gone', 'arte'], removed: ['x'] }), {
    added: ['arte'],
    removed: [],
  });
});

test('only catalog streams are accepted as live TV', () => {
  for (const { url } of TV_CHANNELS) assert.ok(isSupportedTvLiveUrl(url));
  assert.ok(!isSupportedTvLiveUrl('https://example.org/live.m3u8'));
  const media = (url) => ({
    id: '2c1d7a2e-1b7b-4c1b-9d4f-0a6f0b8e9c11',
    title: 'TV',
    kind: 'tv',
    url,
  });
  assert.ok(screenMediaSchema.safeParse(media(TV_CHANNELS.at(-1).url)).success);
  assert.ok(!screenMediaSchema.safeParse(media('https://example.org/live.m3u8')).success);
});

test('the installation language maps to a channel language', () => {
  assert.equal(installationTvLanguage('Français'), 'fr');
  assert.equal(installationTvLanguage('English'), 'en');
  assert.equal(installationTvLanguage('Español'), 'es');
  assert.equal(installationTvLanguage('Klingon'), null);
});
