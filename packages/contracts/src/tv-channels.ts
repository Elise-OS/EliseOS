import { z } from 'zod';

/**
 * Live TV channels offered on the resident screen.
 *
 * One catalog for every language: adding a language means adding rows here (plus a description
 * per channel in the dashboard and mobile catalogs). The screen proposes by default the channels
 * of its language, or the English ones when that language has none; the caregiver can add
 * channels of other languages. Only the URLs of this catalog can be played as live TV.
 */

/** XMLTV files the API reads the "on now / next" guide from, one per source. */
export const TV_GUIDE_SOURCES = {
  xmltvfr: {
    url: 'https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz',
    label: 'XMLTV France',
    site: 'https://www.xmltvfr.fr/xmltv.php',
  },
  tdtchannels: {
    url: 'https://www.tdtchannels.com/epg/TV.xml.gz',
    label: 'TDTChannels',
    site: 'https://www.tdtchannels.com/',
  },
  // epg.pw publishes one small XMLTV file per channel (not compressed).
  epgpwDwEnglish: {
    url: 'https://epg.pw/api/epg.xml?channel_id=55871',
    label: 'epg.pw',
    site: 'https://epg.pw/',
  },
  epgpwFrance24En: {
    url: 'https://epg.pw/api/epg.xml?channel_id=443227',
    label: 'epg.pw',
    site: 'https://epg.pw/',
  },
  epgpwFrance24Es: {
    url: 'https://epg.pw/api/epg.xml?channel_id=448584',
    label: 'epg.pw',
    site: 'https://epg.pw/',
  },
  // One file for all Italian channels (1.7 MB, 13.5 MB once decompressed: close to the API limit).
  epgshareIt: {
    url: 'https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz',
    label: 'EPG Share',
    site: 'https://epgshare01.online/',
  },
  epgpwAlJazeeraEn: {
    url: 'https://epg.pw/api/epg.xml?channel_id=443134',
    label: 'epg.pw',
    site: 'https://epg.pw/',
  },
} as const;
export type TvGuideSourceId = keyof typeof TV_GUIDE_SOURCES;

export interface TvChannel {
  /** Stable identifier, stored in the screen choices; also the key of its description texts. */
  id: string;
  name: string;
  /** Languages (ISO 639-1) whose screens get this channel by default. */
  languages: readonly string[];
  /** Country of the broadcaster (ISO 3166-1). */
  country: string;
  /** Official HLS stream. */
  url: string;
  /**
   * Official logo, embedded in the apps (no network at run time): file name without extension of
   * `apps/dashboard/public/tv-logos/<logo>.svg` and `apps/mobile/assets/tv-logos/<logo>.png`.
   * Sources and licences: THIRD_PARTY_LOGOS.md.
   */
  logo?: string;
  /** Text logo, shown when the logo is missing or does not load: short label and its colors. */
  badge: { label: string; color: string; background: string };
  /** Programme guide: XMLTV source and channel id in that file. No guide when absent. */
  guide?: { source: TvGuideSourceId; id: string };
  /**
   * The stream only plays from this country (rights). Offered by default only to homes whose
   * time zone is in the country; elsewhere the caregiver can still add it.
   */
  geoRestriction?: { country: string; timezones: readonly string[] };
}

const SPAIN_TIMEZONES = ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'] as const;

const CHANNELS = [
  {
    id: 'arte',
    name: 'ARTE',
    languages: ['fr'],
    country: 'FR',
    url: 'https://artesimulcast.akamaized.net/hls/live/2031003/artelive_fr/master.m3u8',
    logo: 'arte',
    badge: { label: 'arte', color: '#f0673c', background: '#fff4ec' },
    guide: { source: 'xmltvfr', id: 'Arte.fr' },
  },
  {
    id: 'rmcLife',
    name: 'RMC Life',
    languages: ['fr'],
    country: 'FR',
    url: 'https://d3dcdjv6dx07iz.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-eaaww2dyp3iih/RMC_Life_FR.m3u8',
    logo: 'rmc-life',
    badge: { label: 'RMC', color: '#ffffff', background: '#19365b' },
    guide: { source: 'xmltvfr', id: 'Cherie25.fr' },
  },
  {
    id: 'rmcStory',
    name: 'RMC Story',
    languages: ['fr'],
    country: 'FR',
    url: 'https://d15aro46bnpfm8.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-fqkqiax1078up/RMC_Story_FR.m3u8',
    logo: 'rmc-story',
    badge: { label: 'RMC', color: '#ffffff', background: '#19365b' },
    guide: { source: 'xmltvfr', id: 'Numero23.fr' },
  },
  {
    id: 'rmcDecouverte',
    name: 'RMC Découverte',
    languages: ['fr'],
    country: 'FR',
    url: 'https://d16zzycxcd0m0r.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-hixvx5kymecr9/RMC_Decouverte_FR.m3u8',
    logo: 'rmc-decouverte',
    badge: { label: 'RMC', color: '#ffffff', background: '#19365b' },
    guide: { source: 'xmltvfr', id: 'RMCDecouverte.fr' },
  },
  // RTVE blocks La 1, La 2 and Clan outside Spain for many programmes (tested from France on
  // 2026-11-06: segments refused); 24h plays abroad.
  {
    id: 'la1',
    name: 'La 1',
    languages: ['es'],
    country: 'ES',
    url: 'https://rtvelivestream.rtve.es/rtvesec/la1/la1_main_dvr.m3u8',
    logo: 'la1',
    badge: { label: 'La 1', color: '#ffffff', background: '#c8102e' },
    guide: { source: 'tdtchannels', id: 'La1.TV' },
    geoRestriction: { country: 'ES', timezones: SPAIN_TIMEZONES },
  },
  {
    id: 'la2',
    name: 'La 2',
    languages: ['es'],
    country: 'ES',
    url: 'https://rtvelivestream.rtve.es/rtvesec/la2/la2_main_dvr.m3u8',
    logo: 'la2',
    badge: { label: 'La 2', color: '#ffffff', background: '#1f4e8c' },
    guide: { source: 'tdtchannels', id: 'La2.TV' },
    geoRestriction: { country: 'ES', timezones: SPAIN_TIMEZONES },
  },
  {
    id: 'canal24h',
    name: '24h',
    languages: ['es'],
    country: 'ES',
    url: 'https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8',
    logo: '24h',
    badge: { label: '24h', color: '#ffffff', background: '#a5162b' },
    guide: { source: 'tdtchannels', id: '24Horas.TV' },
  },
  {
    id: 'clan',
    name: 'Clan',
    languages: ['es'],
    country: 'ES',
    url: 'https://rtvelivestream.rtve.es/rtvesec/clan/clan_main_dvr.m3u8',
    logo: 'clan',
    badge: { label: 'Clan', color: '#ffffff', background: '#e8710a' },
    guide: { source: 'tdtchannels', id: 'Clan.TV' },
    geoRestriction: { country: 'ES', timezones: SPAIN_TIMEZONES },
  },
  {
    id: 'france24Es',
    name: 'France 24 Español',
    languages: ['es'],
    country: 'FR',
    url: 'https://live.france24.com/hls/live/2037220-b/F24_ES_HI_HLS/master_2300.m3u8',
    logo: 'france24',
    badge: { label: 'F24', color: '#ffffff', background: '#0083c1' },
    guide: { source: 'epgpwFrance24Es', id: '448584' },
  },
  {
    id: 'dwEspanol',
    name: 'DW Español',
    languages: ['es'],
    country: 'DE',
    url: 'https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8',
    logo: 'dw',
    badge: { label: 'DW', color: '#ffffff', background: '#05141f' },
  },
  // Rai 3 national programmes with the regional news windows (TGR) of three regions: official Rai
  // streams that play abroad (tested from France 2026-11-07). The RaiPlay relinker URLs of Rai 1,
  // Rai 2, Rai 3 and Rai News 24 are not usable: geo-blocked outside Italy, tokenised, and no CORS
  // for other origins.
  {
    id: 'rai3Trento',
    name: 'Rai 3 Trento',
    languages: ['it'],
    country: 'IT',
    url: 'https://tgrtrento-live.akamaized.net/hls/live/2025575/tgrtrento/tgrtrento/playlist.m3u8',
    logo: 'rai-3',
    badge: { label: 'Rai 3', color: '#ffffff', background: '#00b26a' },
    guide: { source: 'epgshareIt', id: 'Rai3.it' },
  },
  {
    id: 'rai3Bolzano',
    name: 'Rai 3 Bolzano',
    languages: ['it'],
    country: 'IT',
    url: 'https://tgrbolzano-live.akamaized.net/hls/live/2025560/tgrbolzano/tgrbolzano/playlist.m3u8',
    logo: 'rai-3',
    badge: { label: 'Rai 3', color: '#ffffff', background: '#00b26a' },
    guide: { source: 'epgshareIt', id: 'Rai3.it' },
  },
  {
    id: 'rai3Friuli',
    name: 'Rai 3 Friuli-Venezia Giulia',
    languages: ['it'],
    country: 'IT',
    url: 'https://tgrfriuli-live.akamaized.net/hls/live/2025564/tgrfriuli/tgrfriuli/playlist.m3u8',
    logo: 'rai-3',
    badge: { label: 'Rai 3', color: '#ffffff', background: '#00b26a' },
    guide: { source: 'epgshareIt', id: 'Rai3.it' },
  },
  {
    id: 'tv2000',
    name: 'TV2000',
    languages: ['it'],
    country: 'IT',
    url: 'https://hls-live-tv2000.akamaized.net/hls/live/2028510/tv2000/master.m3u8',
    logo: 'tv2000',
    badge: { label: 'TV2000', color: '#ffffff', background: '#0065b2' },
  },
  // Euronews Italiano as distributed by Wurl (Euronews has no HLS URL on its own domain).
  {
    id: 'euronewsIt',
    name: 'Euronews Italiano',
    languages: ['it'],
    country: 'FR',
    url: 'https://acb6ca89.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/UmxheHhUVi1ldV9FdXJvbmV3c0l0YWxpYW5vX0hMUw/playlist.m3u8',
    logo: 'euronews',
    badge: { label: 'euronews', color: '#ffffff', background: '#0072f5' },
    guide: { source: 'epgshareIt', id: 'Euronews.it' },
  },
  {
    id: 'dwEnglish',
    name: 'DW English',
    languages: ['en'],
    country: 'DE',
    url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
    logo: 'dw',
    badge: { label: 'DW', color: '#ffffff', background: '#05141f' },
    guide: { source: 'epgpwDwEnglish', id: '55871' },
  },
  {
    id: 'france24En',
    name: 'France 24 English',
    languages: ['en'],
    country: 'FR',
    url: 'https://live.france24.com/hls/live/2037218-b/F24_EN_HI_HLS/master_2300.m3u8',
    logo: 'france24',
    badge: { label: 'F24', color: '#ffffff', background: '#0083c1' },
    guide: { source: 'epgpwFrance24En', id: '443227' },
  },
  {
    id: 'alJazeeraEn',
    name: 'Al Jazeera English',
    languages: ['en'],
    country: 'QA',
    url: 'https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8',
    logo: 'al-jazeera-english',
    badge: { label: 'AJ', color: '#ffffff', background: '#b8862b' },
    guide: { source: 'epgpwAlJazeeraEn', id: '443134' },
  },
] as const satisfies readonly TvChannel[];

export const TV_CHANNELS: readonly TvChannel[] = CHANNELS;
export type TvChannelId = (typeof CHANNELS)[number]['id'];

/** Language whose channels a screen gets when its own language has none (as for the texts). */
export const TV_CHANNEL_FALLBACK_LANGUAGE = 'en';

const channelsById = new Map<string, TvChannel>(
  TV_CHANNELS.map((channel) => [channel.id, channel]),
);
const channelsByUrl = new Map<string, TvChannel>(
  TV_CHANNELS.map((channel) => [channel.url, channel]),
);

export const tvChannelById = (id: string): TvChannel | undefined => channelsById.get(id);
export const tvChannelByUrl = (url: string): TvChannel | undefined => channelsByUrl.get(url);
/** Only the streams of the catalog can be played as live TV. */
export const isSupportedTvLiveUrl = (url: string) => channelsByUrl.has(url);

/** Languages that have channels, in catalog order. */
export const tvChannelLanguages = (): string[] => [
  ...new Set(TV_CHANNELS.flatMap((channel) => channel.languages)),
];

/** "es-ES", "ES" → "es"; anything else → null. */
export function tvLanguageCode(value: string | null | undefined): string | null {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0];
  return code && /^[a-z]{2,3}$/.test(code) ? code : null;
}

/** The language whose channels are proposed: the screen's, or English when it has none. */
export function tvChannelLanguage(language: string | null | undefined): string {
  const code = tvLanguageCode(language);
  return code && TV_CHANNELS.some((channel) => channel.languages.includes(code))
    ? code
    : TV_CHANNEL_FALLBACK_LANGUAGE;
}

/** Channels a screen in this language gets without any choice of the caregiver. */
export function defaultTvChannels(
  language: string | null | undefined,
  timezone?: string | null,
): TvChannel[] {
  const channelLanguage = tvChannelLanguage(language);
  return TV_CHANNELS.filter(
    (channel) =>
      channel.languages.includes(channelLanguage) &&
      (!channel.geoRestriction ||
        (!!timezone && channel.geoRestriction.timezones.includes(timezone))),
  );
}

export const tvChannelChoicesSchema = z.object({
  /** Channels added on top of the default ones (often from another language). */
  added: z.array(z.string().max(40)).max(100),
  /** Default channels the caregiver took off the screen. */
  removed: z.array(z.string().max(40)).max(100),
});
export type TvChannelChoices = z.infer<typeof tvChannelChoicesSchema>;

/** Unknown identifiers (channel retired from the catalog) are dropped. */
export function cleanTvChannelChoices(choices: TvChannelChoices): TvChannelChoices {
  const known = (ids: string[]) => [...new Set(ids)].filter((id) => channelsById.has(id));
  return { added: known(choices.added), removed: known(choices.removed) };
}

/**
 * Channels offered on a screen: the default ones for its language and time zone, minus those the
 * caregiver removed, plus those they added. Catalog order, so languages stay grouped.
 */
export function tvChannelLineup(
  language: string | null | undefined,
  choices?: TvChannelChoices | null,
  timezone?: string | null,
): TvChannel[] {
  const defaults = new Set(defaultTvChannels(language, timezone).map(({ id }) => id));
  const added = new Set(choices?.added ?? []);
  const removed = new Set(choices?.removed ?? []);
  return TV_CHANNELS.filter(({ id }) => (defaults.has(id) && !removed.has(id)) || added.has(id));
}

/** Choices after the caregiver switched one channel on or off. */
export function toggleTvChannel(
  choices: TvChannelChoices | null | undefined,
  channelId: string,
  enabled: boolean,
  language: string | null | undefined,
  timezone?: string | null,
): TvChannelChoices {
  const isDefault = defaultTvChannels(language, timezone).some(({ id }) => id === channelId);
  const added = (choices?.added ?? []).filter((id) => id !== channelId);
  const removed = (choices?.removed ?? []).filter((id) => id !== channelId);
  if (enabled && !isDefault) added.push(channelId);
  if (!enabled && isDefault) removed.push(channelId);
  return { added, removed };
}

/**
 * Screens set up before channels followed the language had the French channels for everyone:
 * they keep them, whatever language their TV shows.
 */
export const LEGACY_TV_CHANNEL_CHOICES: TvChannelChoices = {
  added: ['arte', 'rmcLife', 'rmcStory', 'rmcDecouverte'],
  removed: [],
};

/** "fr" from the language picked at installation ("Français", "English", "Español"…). */
export function installationTvLanguage(spokenLanguage: string | null | undefined): string | null {
  const name = spokenLanguage?.trim().toLowerCase() ?? '';
  if (/^(fran[cç]ais|french|franc[eé]s)/.test(name)) return 'fr';
  if (/^(english|anglais|ingl[eé]s)/.test(name)) return 'en';
  if (/^(espa[nñ]ol|spanish|espagnol|castellano)/.test(name)) return 'es';
  if (/^(italiano|italian|italien)/.test(name)) return 'it';
  return tvLanguageCode(name.length <= 3 ? name : null);
}
