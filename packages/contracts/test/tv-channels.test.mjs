import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const repoFile = (path) => new URL(`../../../${path}`, import.meta.url);

test('every channel has its official logo bundled in the web and mobile apps', () => {
  const mobileLogos = readFileSync(repoFile('apps/mobile/src/screen/TvChannelLogo.tsx'), 'utf8');
  for (const channel of TV_CHANNELS) {
    assert.match(channel.logo ?? '', /^[a-z0-9-]+$/, channel.id);
    const svg = repoFile(`apps/dashboard/public/tv-logos/${channel.logo}.svg`);
    assert.ok(existsSync(svg), `${channel.id}: ${svg.pathname}`);
    const source = readFileSync(svg, 'utf8');
    assert.match(source, /^<svg[^>]*viewBox=/, channel.id);
    // Served as is to every screen: nothing that runs or fetches.
    assert.doesNotMatch(
      source,
      /<script|<foreignObject|\son[a-z]+=|href="(?!#)|url\((?!#)/i,
      channel.id,
    );
    assert.ok(existsSync(repoFile(`apps/mobile/assets/tv-logos/${channel.logo}.png`)), channel.id);
    assert.ok(mobileLogos.includes(`assets/tv-logos/${channel.logo}.png'`), channel.id);
  }
});

test('a French screen keeps the four historical channels', () => {
  assert.deepEqual(ids(defaultTvChannels('fr', 'Europe/Paris')), FRENCH);
  assert.deepEqual(ids(tvChannelLineup('fr-FR', undefined, 'Europe/Paris')), FRENCH);
});

test('a Spanish screen gets Spanish channels; RTVE channels blocked abroad only in Spain', () => {
  const abroad = ids(defaultTvChannels('es', 'Europe/Paris'));
  assert.deepEqual(abroad, ['canal24h', 'france24Es', 'dwEspanol']);
  const inSpain = ids(defaultTvChannels('es', 'Europe/Madrid'));
  for (const id of ['la1', 'la2', 'clan', 'canal24h']) assert.ok(inSpain.includes(id), id);
  assert.ok(!abroad.some((id) => FRENCH.includes(id)));
});

test('an Italian screen gets the Italian channels, none of them blocked abroad', () => {
  const channels = ids(defaultTvChannels('it', 'Europe/Paris'));
  assert.deepEqual(channels, ['rai3Trento', 'rai3Bolzano', 'rai3Friuli', 'tv2000', 'euronewsIt']);
  assert.deepEqual(ids(defaultTvChannels('it-IT', 'Europe/Rome')), channels);
  assert.equal(tvChannelLanguage('IT'), 'it');
});

test('a Portuguese screen gets the RTP channels, in Portugal, in France and in Brazil', () => {
  const channels = ids(defaultTvChannels('pt', 'Europe/Paris'));
  assert.deepEqual(channels, [
    'rtp1',
    'rtp2',
    'rtpNoticias',
    'rtpMundo',
    'rtpMemoria',
    'rtpAfrica',
  ]);
  assert.deepEqual(ids(defaultTvChannels('pt-PT', 'Europe/Lisbon')), channels);
  assert.deepEqual(ids(defaultTvChannels('pt-BR', 'America/Sao_Paulo')), channels);
  assert.equal(tvChannelLanguage('PT'), 'pt');
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
  choices = toggleTvChannel(choices, 'dwEspanol', false, 'es', 'Europe/Paris');
  assert.deepEqual(choices, { added: ['arte'], removed: ['dwEspanol'] });
  const lineup = ids(tvChannelLineup('es', choices, 'Europe/Paris'));
  assert.ok(
    lineup.includes('arte') && lineup.includes('canal24h') && !lineup.includes('dwEspanol'),
  );
  choices = toggleTvChannel(choices, 'arte', false, 'es', 'Europe/Paris');
  choices = toggleTvChannel(choices, 'dwEspanol', true, 'es', 'Europe/Paris');
  assert.deepEqual(choices, { added: [], removed: [] });
});

test('screens set up before keep the French channels in any language', () => {
  for (const language of ['fr', 'en', 'es', 'it', 'pt']) {
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
  assert.equal(installationTvLanguage('Italiano'), 'it');
  assert.equal(installationTvLanguage('Português'), 'pt');
  assert.equal(installationTvLanguage('Klingon'), null);
});
