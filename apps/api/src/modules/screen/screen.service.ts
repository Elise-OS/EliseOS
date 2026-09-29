import {
  appointmentPictogramSchema,
  screenMessageSchema,
  type ScreenMessageInput,
  type AppointmentPictogram,
  type ScreenScheduledContentInput,
  type ScreenPodcastEpisode,
  type ScreenPodcastSearchResult,
  type ScreenPodcastSubscription,
  type ScreenMedia,
} from '@michel/contracts';
import { request as httpRequest } from 'node:http';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  advanceScreenSchedule,
  initialScreenState,
  screenIsQuiet,
  screenLocalTime,
  screenCommandSchema,
  screenMediaSchema,
  screenSettingsSchema,
  type ScreenState,
  type ScreenGrant,
  type ScreenSnapshot,
  type ScreenTvControl,
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { parseRequest } from '../../platform/zod-validation';
import { decryptCameraSecret, encryptCameraSecret } from '../cameras/camera-crypto';
import { scheduledDate } from '../medications/medication-time';
import { MqttIngestionService } from '../sensing/mqtt-ingestion.service';
import { fetchPodcastEpisodes } from './podcast-feed';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const json = (s: unknown) => JSON.parse(JSON.stringify(s)) as Prisma.InputJsonValue;
const podcastCatalogBase = 'https://api.podcastindex.org';
function podcastHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href.slice(0, 2048)
      : undefined;
  } catch {
    return undefined;
  }
}
function boundedCatalogText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
    : '';
}
const noRights: ScreenGrant = {
  call: false,
  autoAnswer: false,
  message: false,
  control: false,
  administer: false,
};
const adminRights: ScreenGrant = {
  ...noRights,
  call: true,
  message: true,
  control: true,
  administer: true,
};
const mediaRoot = path.resolve(process.env.MEDIA_ROOT ?? '/var/lib/elise/media', 'screen');
type CityWeather = ScreenSnapshot['weather'];
const weatherCache = new Map<string, { expiresAt: number; value: Promise<CityWeather> }>();
const podcastEpisodeCache = new Map<
  string,
  { expiresAt: number; value: Promise<ScreenPodcastEpisode[]> }
>();
const youtubeOAuthStates = new Map<string, { userId: string; expiresAt: number }>();
function nextDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
const YOUTUBE_SCOPE = 'openid email profile https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';
export interface RadioStationResult {
  id: string;
  name: string;
  url: string;
  country: string;
  codec: string;
  bitrate: number;
  artworkUrl?: string;
}
type PodcastDirectoryResponse = {
  resultCount?: number;
  results?: Array<Record<string, unknown>>;
};
export interface WeatherCityResult {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
}
export interface YouTubeAccountResult {
  configured: boolean;
  connected: boolean;
  email: string | null;
  channelTitle: string | null;
}
export interface YouTubePlaylistResult {
  id: string;
  title: string;
  description: string;
  itemCount: number;
  thumbnailUrl: string | null;
}
export interface GoogleSettingsResult {
  configured: boolean;
  clientId: string;
  redirectUri: string | null;
  youtubeEnabled: boolean;
  calendarEnabled: boolean;
  youtubeConnected: boolean;
}
type HomeAssistantTvCandidate = {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  protocols: string[];
  homeAssistantEntityId: string;
  homeAssistantName: string;
  available: boolean;
};
function jsonObjects(value: Prisma.JsonValue): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>);
}

export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const country = /^(france|belgique|belgium|suisse|switzerland|luxembourg)$/i;
  if (parts.length > 1 && country.test(parts.at(-1)!)) parts.pop();
  const postalPart = [...parts].reverse().find((part) => /\b\d{4,5}\b/.test(part));
  if (postalPart) {
    const city = postalPart.replace(/^.*?\b\d{4,5}\b\s*/, '').trim();
    if (city) return city;
  }
  const candidate = parts.at(-1) ?? '';
  return candidate && !/^\d/.test(candidate) ? candidate : null;
}

async function fetchCityWeather(address: string | null | undefined): Promise<CityWeather> {
  const requestedCity = cityFromAddress(address);
  if (!requestedCity) return null;
  const key = requestedCity.toLocaleLowerCase('fr-FR');
  const cached = weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async () => {
    try {
      const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geocodingUrl.searchParams.set('name', requestedCity);
      geocodingUrl.searchParams.set('count', '1');
      geocodingUrl.searchParams.set('language', 'fr');
      geocodingUrl.searchParams.set('format', 'json');
      const geocodingResponse = await fetch(geocodingUrl, { signal: AbortSignal.timeout(4000) });
      if (!geocodingResponse.ok) return null;
      const geocoding = (await geocodingResponse.json()) as {
        results?: Array<{ name?: string; latitude?: number; longitude?: number }>;
      };
      const location = geocoding.results?.[0];
      if (
        !location?.name ||
        !Number.isFinite(location.latitude) ||
        !Number.isFinite(location.longitude)
      )
        return null;
      const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
      forecastUrl.searchParams.set('latitude', String(location.latitude));
      forecastUrl.searchParams.set('longitude', String(location.longitude));
      forecastUrl.searchParams.set('current', 'temperature_2m,weather_code');
      forecastUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code');
      forecastUrl.searchParams.set('forecast_days', '1');
      forecastUrl.searchParams.set('timezone', 'auto');
      const forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(4000) });
      if (!forecastResponse.ok) return null;
      const forecast = (await forecastResponse.json()) as {
        current?: { time?: string; temperature_2m?: number; weather_code?: number };
        daily?: {
          temperature_2m_min?: number[];
          temperature_2m_max?: number[];
          weather_code?: number[];
        };
      };
      const temperature = Number(forecast.current?.temperature_2m);
      const weatherCode = Number(
        forecast.current?.weather_code ?? forecast.daily?.weather_code?.[0],
      );
      if (!Number.isFinite(temperature) || !Number.isFinite(weatherCode)) return null;
      const minimum = Number(forecast.daily?.temperature_2m_min?.[0]);
      const maximum = Number(forecast.daily?.temperature_2m_max?.[0]);
      return {
        city: location.name,
        temperature,
        minimum: Number.isFinite(minimum) ? minimum : null,
        maximum: Number.isFinite(maximum) ? maximum : null,
        weatherCode,
        observedAt: forecast.current?.time ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  })();
  weatherCache.set(key, { expiresAt: Date.now() + 15 * 60 * 1000, value });
  // A transient network failure must not make the weather unavailable for the
  // whole cache window. Keep successful readings for 15 minutes, but retry a
  // failed lookup on the next screen refresh.
  void value.then((result) => {
    if (result === null) {
      const current = weatherCache.get(key);
      if (current?.value === value) weatherCache.delete(key);
    }
  });
  return value;
}

export interface ScreenTvGuideProgramResult {
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
}
export interface ScreenTvGuideChannelResult {
  id: string;
  name: string;
  current: ScreenTvGuideProgramResult | null;
  next: ScreenTvGuideProgramResult | null;
}
export interface ScreenTvGuideResult {
  channels: ScreenTvGuideChannelResult[];
  retrievedAt: string;
  stale: boolean;
}
type XmlTvProgram = ScreenTvGuideProgramResult & { startMs: number; endMs: number };
const TV_GUIDE_SOURCE_URL = 'https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz';
const TV_GUIDE_CHANNELS = [
  { id: 'Arte.fr', name: 'ARTE' },
  { id: 'Cherie25.fr', name: 'RMC Life' },
  { id: 'Numero23.fr', name: 'RMC Story' },
  { id: 'RMCDecouverte.fr', name: 'RMC Découverte' },
] as const;
const TV_GUIDE_REFRESH_MS = 6 * 60 * 60 * 1000;
const TV_GUIDE_RETRY_MS = 5 * 60 * 1000;
const TV_GUIDE_STALE_MAX_MS = 48 * 60 * 60 * 1000;
let tvGuideCache: { retrievedAtMs: number; programs: Map<string, XmlTvProgram[]> } | null = null;
let tvGuideRefresh: Promise<void> | null = null;
let tvGuideRetryAt = 0;

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#(\d+);/g, (_match, digits: string) => {
      const codePoint = Number.parseInt(digits, 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTvTag(content: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(content);
  if (!match) return null;
  const value = decodeXmlText(match[1]!);
  return value || null;
}

function xmlTvDate(value: string | undefined): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2}):?(\d{2})|Z)?$/.exec(
    value?.trim() ?? '',
  );
  if (!match) return null;
  const year = match[1]!;
  const month = match[2]!;
  const day = match[3]!;
  const hour = match[4]!;
  const minute = match[5]!;
  const second = match[6]!;
  const sign = match[7];
  const offsetHour = match[8];
  const offsetMinute = match[9];
  const localAsUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const offset = sign ? (+offsetHour! * 60 + +offsetMinute!) * 60_000 : 0;
  return localAsUtc - (sign === '+' ? offset : -offset);
}

function parseXmlTvGuide(xml: string): Map<string, XmlTvProgram[]> {
  const programs = new Map<string, XmlTvProgram[]>(TV_GUIDE_CHANNELS.map(({ id }) => [id, []]));
  const attribute = (attributes: string, name: string) =>
    new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(attributes)?.[1];
  for (const match of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/gi)) {
    const attributes = match[1]!;
    const content = match[2]!;
    const channelId = attribute(attributes, 'channel');
    const channelPrograms = channelId ? programs.get(channelId) : undefined;
    if (!channelPrograms) continue;
    const startMs = xmlTvDate(attribute(attributes, 'start'));
    const endMs = xmlTvDate(attribute(attributes, 'stop'));
    const title = xmlTvTag(content, 'title');
    if (startMs === null || endMs === null || endMs <= startMs || !title) continue;
    const description = xmlTvTag(content, 'desc');
    channelPrograms.push({
      title: title.slice(0, 180),
      description: description?.slice(0, 360) ?? null,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      startMs,
      endMs,
    });
  }
  if ([...programs.values()].every((channelPrograms) => channelPrograms.length === 0))
    throw new Error('The XMLTV guide contained no supported channels.');
  for (const channelPrograms of programs.values())
    channelPrograms.sort((left, right) => left.startMs - right.startMs);
  return programs;
}

async function refreshTvGuide(): Promise<void> {
  const response = await fetch(TV_GUIDE_SOURCE_URL, {
    headers: { 'user-agent': 'Michel household TV guide/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`XMLTV source returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024)
    throw new Error('XMLTV source file exceeded the expected size.');
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (compressed.byteLength > 5 * 1024 * 1024)
    throw new Error('XMLTV source file exceeded the expected size.');
  const xml = gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8');
  if (!xml.startsWith('<?xml') && !xml.includes('<tv'))
    throw new Error('XMLTV source did not contain a valid guide.');
  tvGuideCache = { retrievedAtMs: Date.now(), programs: parseXmlTvGuide(xml) };
  tvGuideRetryAt = 0;
}

async function screenTvGuide(): Promise<ScreenTvGuideResult> {
  const now = Date.now();
  if (!tvGuideCache || now - tvGuideCache.retrievedAtMs >= TV_GUIDE_REFRESH_MS) {
    if (now >= tvGuideRetryAt) {
      tvGuideRefresh ??= refreshTvGuide()
        .catch((error: unknown) => {
          tvGuideRetryAt = Date.now() + TV_GUIDE_RETRY_MS;
          console.warn('[screen] TV guide refresh failed; retaining the last valid guide.', error);
        })
        .finally(() => {
          tvGuideRefresh = null;
        });
    }
    if (tvGuideRefresh) await tvGuideRefresh;
  }
  const cache = tvGuideCache;
  if (!cache || Date.now() - cache.retrievedAtMs > TV_GUIDE_STALE_MAX_MS)
    throw new ServiceUnavailableException('Le programme TV est temporairement indisponible.');
  const currentTime = Date.now();
  return {
    retrievedAt: new Date(cache.retrievedAtMs).toISOString(),
    stale: currentTime - cache.retrievedAtMs >= TV_GUIDE_REFRESH_MS,
    channels: TV_GUIDE_CHANNELS.map(({ id, name }) => {
      const upcoming = (cache.programs.get(id) ?? []).filter(({ endMs }) => endMs > currentTime);
      const currentIndex = upcoming.findIndex(
        ({ startMs, endMs }) => startMs <= currentTime && endMs > currentTime,
      );
      const current = currentIndex >= 0 ? (upcoming[currentIndex] ?? null) : null;
      const following =
        currentIndex >= 0 ? (upcoming[currentIndex + 1] ?? null) : (upcoming[0] ?? null);
      const toResult = ({ title, description, startAt, endAt }: XmlTvProgram) => ({
        title,
        description,
        startAt,
        endAt,
      });
      return {
        id,
        name,
        current: current ? toResult(current) : null,
        next: following ? toResult(following) : null,
      };
    }),
  };
}

@Injectable()
export class ScreenService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private tvRecoveryTimer?: NodeJS.Timeout;
  private tvGuideTimer?: NodeJS.Timeout;
  private readonly homeAssistantCommandAt = new Map<string, number>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt?: MqttIngestionService,
  ) {}
  async onModuleInit() {
    await fs.mkdir(mediaRoot, { recursive: true });
    void screenTvGuide().catch(() => undefined);
    this.tvGuideTimer = setInterval(
      () => void screenTvGuide().catch(() => undefined),
      TV_GUIDE_RETRY_MS,
    );
    this.tvGuideTimer.unref();
    // A process restart never resurrects a conference or replays pending commands.
    for (const row of await this.prisma.residentScreen.findMany())
      await this.mutate(row.homeId, (s) => {
        s.settings.weatherCity ??= '';
        s.settings.slideshowSeconds ??= 15;
        s.activity ??= [];
        s.scheduledContent ??= [];
        this.finish(s, 'restart');
        s.commands.forEach((c) => {
          if (c.status === 'pending') {
            c.status = 'expired';
            if (c.previousPlayback && c.revision === s.playback.revision)
              s.playback = c.previousPlayback;
          }
        });
      });
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 1000);
    this.timer.unref();
    this.tvRecoveryTimer = setInterval(() => {
      void this.automaticTvRecovery().catch(() => undefined);
    }, 30_000);
    this.tvRecoveryTimer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.tvRecoveryTimer) clearInterval(this.tvRecoveryTimer);
    if (this.tvGuideTimer) clearInterval(this.tvGuideTimer);
  }
  private async home(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      include: {
        primaryResident: true,
        organization: {
          include: { memberships: { where: { disabledAt: null }, include: { user: true } } },
        },
      },
    });
    if (!home) throw new ForbiddenException();
    return home;
  }
  private async ensure(homeId: string) {
    return this.prisma.residentScreen.upsert({
      where: { homeId },
      create: { homeId, state: json(initialScreenState()) },
      update: {},
    });
  }
  private rights(state: ScreenState, userId: string, role: string): ScreenGrant {
    const explicit = state.settings.grants[userId];
    return explicit ?? (['OWNER', 'ADMINISTRATOR'].includes(role) ? adminRights : noRights);
  }
  private async access(userId: string, capability?: keyof ScreenGrant) {
    const home = await this.home(userId);
    const row = await this.ensure(home.id);
    const state = row.state as unknown as ScreenState;
    const membership = home.organization.memberships.find((m) => m.userId === userId)!;
    const grant = this.rights(state, userId, membership.systemRole);
    if (capability && !grant[capability]) throw new ForbiddenException('Droit écran insuffisant.');
    return { home, row, state, grant };
  }
  private async mutate(homeId: string, fn: (state: ScreenState) => void | Promise<void>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ResidentScreen" WHERE "homeId" = ${homeId} FOR UPDATE`;
      const row = await tx.residentScreen.findUniqueOrThrow({ where: { homeId } });
      const s = row.state as unknown as ScreenState;
      const before = JSON.stringify(s);
      await fn(s);
      if (JSON.stringify(s) === before) return s;
      await tx.residentScreen.update({ where: { homeId }, data: { state: json(s) } });
      await tx.$executeRaw`SELECT pg_notify('michel_updates', ${JSON.stringify({ homeId, type: 'screen' })})`;
      return s;
    });
  }
  private finish(s: ScreenState, result: string) {
    if (s.call) {
      s.history.push({
        id: s.call.id,
        name: s.call.name,
        startedAt: s.call.createdAt,
        endedAt: Date.now(),
        result,
      });
      const activity = (s.activity ?? []).find((item) => item.id === s.call?.id);
      if (activity) {
        activity.status = result === 'ended' ? 'applied' : 'failed';
        activity.detail = result;
      }
    }
    s.call = null;
    s.history = s.history.filter((h) => h.endedAt > Date.now() - 30 * 86400000).slice(-500);
  }
  private addActivity(
    s: ScreenState,
    event: Omit<ScreenState['activity'][number], 'createdAt'> & { createdAt?: number },
  ) {
    s.activity ??= [];
    s.activity.push({ ...event, createdAt: event.createdAt ?? Date.now() });
    s.activity = s.activity
      .filter((item) => item.createdAt > Date.now() - 30 * 86400000)
      .slice(-500);
  }
  private agent(method: string, route: string, body?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        {
          socketPath: process.env.ELISE_SCREEN_AGENT_SOCKET ?? '/run/elise-screen/agent.sock',
          path: route,
          method,
          headers: {
            'content-type': 'application/json',
            ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let value = '';
          res.on('data', (chunk: Buffer) => {
            value += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode !== 200)
              return reject(
                new ConflictException('Agent écran indisponible ou paramètres invalides.'),
              );
            try {
              resolve(JSON.parse(value) as Record<string, unknown>);
            } catch {
              reject(new ConflictException('Réponse agent invalide.'));
            }
          });
        },
      );
      req.setTimeout(55000, () => req.destroy(new Error('Agent timeout')));
      req.on('error', () =>
        reject(new ConflictException('Installez le mode écran sur cette machine.')),
      );
      req.end(data);
    });
  }
  async hostStatus(userId: string) {
    await this.access(userId, 'administer');
    try {
      return await this.agent('GET', '/status');
    } catch {
      return { installed: false };
    }
  }
  async hostPair(userId: string) {
    const { home } = await this.access(userId, 'administer');
    await this.agent('GET', '/status');
    const token = randomBytes(32).toString('hex');
    await this.prisma.residentScreen.update({
      where: { homeId: home.id },
      data: { tokenHash: hash(token), lastSeenAt: null },
    });
    await this.mutate(home.id, (s) => this.finish(s, 'repaired'));
    await this.agent('POST', '/pair', {
      token,
      url: process.env.ELISE_SCREEN_LOCAL_URL ?? 'http://127.0.0.1:8080',
    });
    return { ok: true };
  }
  async tvStatus(userId: string) {
    const { home, state } = await this.access(userId, 'control');
    const homeAssistantTvs = await this.homeAssistantTvs(home.id).catch(() => []);
    let status: Record<string, unknown> = {};
    let installed = false;
    try {
      status = await this.agent('GET', '/status');
      installed = status.installed === true;
    } catch {
      status = {};
    }
    const agentNetworkTv = (status.networkTv ?? {}) as Record<string, unknown>;
    const networkTv = (
      state.tvControl === null
        ? {}
        : state.tvControl
          ? agentNetworkTv.id === state.tvControl.id
            ? { ...state.tvControl, ...agentNetworkTv }
            : state.tvControl
          : agentNetworkTv
    ) as {
      id?: unknown;
      homeAssistantEntityId?: unknown;
    };
    return {
      installed,
      display: status.display ?? {},
      cec: status.cec ?? {},
      networkTv,
      networkTvStatus:
        typeof networkTv.id === 'string' && agentNetworkTv.id === networkTv.id
          ? (status.networkTvStatus ?? {})
          : {},
      homeAssistantTv:
        homeAssistantTvs.find(
          (candidate) => candidate.homeAssistantEntityId === networkTv.homeAssistantEntityId,
        ) ?? null,
    };
  }
  async tvGuide(userId: string): Promise<ScreenTvGuideResult> {
    await this.access(userId, 'control');
    return screenTvGuide();
  }
  async reclaimTv(userId: string) {
    const { home, state } = await this.access(userId, 'control');
    await this.mutate(home.id, (state) => {
      state.playback.asleep = false;
      state.playback.revision++;
    });
    const homeAssistantEntityId =
      typeof state.tvControl?.homeAssistantEntityId === 'string'
        ? state.tvControl.homeAssistantEntityId
        : undefined;
    const [local, homeAssistant] = await Promise.all([
      this.agent('POST', '/cec/reclaim', {}).catch(() => ({
        ok: false,
        reason: 'Agent TV temporairement indisponible ; la demande reste enregistrée.',
      })),
      homeAssistantEntityId
        ? this.controlHomeAssistantTv(home.id, homeAssistantEntityId, false).catch(() => ({
            sent: false,
            reason: 'Secours Home Assistant indisponible.',
          }))
        : Promise.resolve({ sent: false, reason: 'Aucune TV Home Assistant associée.' }),
    ]);
    return { accepted: true, ...local, homeAssistant };
  }
  async scanTvs(userId: string) {
    const { home } = await this.access(userId, 'administer');
    const [local, homeAssistant] = await Promise.all([
      this.agent('POST', '/tv/scan', {}).catch(() => ({ devices: [] })),
      this.homeAssistantTvs(home.id).catch(() => []),
    ]);
    const localDevices = Array.isArray(local.devices)
      ? (local.devices as Array<Record<string, unknown>>)
      : [];
    return { devices: this.mergeTvCandidates(localDevices, homeAssistant) };
  }
  async selectTv(userId: string, body: unknown) {
    const { home } = await this.access(userId, 'administer');
    const homeAssistantEntityId =
      typeof body === 'object' &&
      body !== null &&
      'homeAssistantEntityId' in body &&
      typeof body.homeAssistantEntityId === 'string'
        ? body.homeAssistantEntityId
        : undefined;
    if (
      homeAssistantEntityId &&
      !(await this.homeAssistantTvs(home.id)).some(
        (candidate) => candidate.homeAssistantEntityId === homeAssistantEntityId,
      )
    )
      throw new BadRequestException('Cette TV Home Assistant n’est pas disponible.');
    await this.mutate(home.id, (state) => {
      state.tvControl = body as ScreenTvControl;
    });
    return this.agent('POST', '/tv/select', body).catch(() => ({
      ok: true,
      agentPending: true,
    }));
  }
  async forgetTv(userId: string) {
    const { home } = await this.access(userId, 'administer');
    await this.mutate(home.id, (state) => {
      state.tvControl = null;
    });
    return this.agent('POST', '/tv/forget', {}).catch(() => ({
      ok: true,
      agentPending: true,
    }));
  }
  private async homeAssistantTvs(homeId: string) {
    const entities = await this.prisma.deviceEntity.findMany({
      where: { homeId, domain: 'media_player', removedAt: null },
      include: { device: true },
      orderBy: { name: 'asc' },
    });
    return entities.flatMap<HomeAssistantTvCandidate>((entity) => {
      const actions = jsonObjects(entity.actions);
      const canTurnOn = actions.some(
        (action) =>
          action.service === 'turn_on' &&
          (action.domain === 'media_player' || action.domain === 'homeassistant'),
      );
      if (!canTurnOn) return [];
      return [
        {
          id: hash(`home-assistant:${entity.entityId}`).slice(0, 16),
          name: (entity.device?.displayName ?? entity.device?.name ?? entity.name).slice(0, 200),
          manufacturer: (entity.device?.manufacturer ?? 'Home Assistant').slice(0, 200),
          model: (entity.device?.model ?? entity.integration ?? 'TV connectée').slice(0, 200),
          protocols: [
            'home-assistant',
            ...(entity.integration ? [entity.integration.slice(0, 40)] : []),
          ],
          homeAssistantEntityId: entity.entityId,
          homeAssistantName: entity.name.slice(0, 200),
          available: entity.available,
        },
      ];
    });
  }
  private mergeTvCandidates(
    localDevices: Array<Record<string, unknown>>,
    homeAssistantTvs: HomeAssistantTvCandidate[],
  ) {
    const normalize = (value: unknown) => {
      if (typeof value !== 'string') return '';
      return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    };
    const used = new Set<string>();
    const merged = localDevices.map((device) => {
      const match = homeAssistantTvs.find((candidate) => {
        if (used.has(candidate.homeAssistantEntityId)) return false;
        const sameModel =
          normalize(device.model).length > 2 &&
          normalize(device.model) === normalize(candidate.model) &&
          normalize(device.manufacturer) === normalize(candidate.manufacturer);
        const sameName =
          normalize(device.name).length > 3 && normalize(device.name) === normalize(candidate.name);
        return sameModel || sameName;
      });
      if (!match) return device;
      used.add(match.homeAssistantEntityId);
      return {
        ...device,
        homeAssistantEntityId: match.homeAssistantEntityId,
        homeAssistantName: match.homeAssistantName,
        protocols: [
          ...new Set([
            ...(Array.isArray(device.protocols) ? (device.protocols as string[]) : []),
            ...match.protocols,
          ]),
        ],
      };
    });
    return [
      ...merged,
      ...homeAssistantTvs.filter((candidate) => !used.has(candidate.homeAssistantEntityId)),
    ];
  }
  private async controlHomeAssistantTv(homeId: string, entityId: string, asleep: boolean) {
    const entity = await this.prisma.deviceEntity.findFirst({
      where: { homeId, entityId, domain: 'media_player', removedAt: null },
    });
    const actions = entity ? jsonObjects(entity.actions) : [];
    const service = asleep ? 'turn_off' : 'turn_on';
    const action = actions.find(
      (action) =>
        action.service === service &&
        (action.domain === 'media_player' || action.domain === 'homeassistant'),
    );
    if (!entity || !action || typeof action.domain !== 'string')
      return {
        sent: false,
        reason: `Commande Home Assistant ${asleep ? 'de veille' : 'd’allumage'} indisponible.`,
      };
    if (!this.mqtt) return { sent: false, reason: 'Pont Home Assistant indisponible.' };
    this.mqtt.executeHomeAssistantCommand({
      domain: action.domain,
      service,
      target: { entity_id: entity.entityId },
    });
    this.homeAssistantCommandAt.set(`${entity.entityId}:${service}`, Date.now());
    return { sent: true, entityId: entity.entityId, service };
  }
  private async automaticTvRecovery() {
    let status: Record<string, unknown>;
    try {
      status = await this.agent('GET', '/status');
    } catch {
      const screens = await this.prisma.residentScreen.findMany({
        where: { lastSeenAt: { gte: new Date(Date.now() - 60_000) } },
      });
      await Promise.all(
        screens.map((screen) =>
          this.sendAutomaticHomeAssistant(
            screen.homeId,
            screen.state as unknown as ScreenState,
          ).catch(() => undefined),
        ),
      );
      return;
    }
    const selected = status.networkTv as { homeAssistantEntityId?: unknown } | undefined;
    if (typeof selected?.homeAssistantEntityId !== 'string') return;
    const cec = status.cec as
      | {
          tvAcknowledged?: unknown;
          activeSourceSent?: unknown;
          updatedAt?: unknown;
        }
      | undefined;
    const recentScreens = await this.prisma.residentScreen.findMany({
      where: { lastSeenAt: { gte: new Date(Date.now() - 60_000) } },
    });
    const matchingScreens = recentScreens.filter(
      (screen) =>
        (screen.state as unknown as ScreenState).tvControl?.homeAssistantEntityId ===
        selected.homeAssistantEntityId,
    );
    if (matchingScreens.length !== 1) return;
    const screen = matchingScreens[0]!;
    const state = screen.state as unknown as ScreenState;
    const asleep = state.playback.asleep;
    const cecFresh = typeof cec?.updatedAt === 'number' && Date.now() / 1000 - cec.updatedAt < 45;
    const cecExpectedState = asleep
      ? (status.cec as { asleepRequested?: unknown } | undefined)?.asleepRequested === true
      : cec?.activeSourceSent === true;
    if (cecFresh && cec?.tvAcknowledged === true && cecExpectedState) return;
    await this.sendAutomaticHomeAssistant(screen.homeId, state);
  }
  private async sendAutomaticHomeAssistant(homeId: string, state: ScreenState) {
    const entityId = state.tvControl?.homeAssistantEntityId;
    if (!entityId) return;
    const asleep = state.playback.asleep;
    const service = asleep ? 'turn_off' : 'turn_on';
    const commandKey = `${entityId}:${service}`;
    const lastCommand = this.homeAssistantCommandAt.get(commandKey) ?? 0;
    if (Date.now() - lastCommand < 60_000) return;
    await this.controlHomeAssistantTv(homeId, entityId, asleep);
  }
  async buttonDevice(userId: string, path: string) {
    await this.access(userId, 'administer');
    return this.agent('POST', '/button-device', { path });
  }
  async network(userId: string, body: unknown) {
    await this.access(userId, 'administer');
    return this.agent('POST', '/network', body);
  }
  async snapshot(userId: string): Promise<ScreenSnapshot> {
    const a = await this.access(userId);
    if (a.state.call?.userId === userId)
      await this.mutate(a.home.id, (s) => {
        if (s.call?.userId === userId) s.call.callerSeenAt = Date.now();
      });
    return this.present(a.row.homeId, a.grant, userId);
  }
  private async present(
    homeId: string,
    grant = noRights,
    userId?: string,
  ): Promise<ScreenSnapshot> {
    const row = await this.ensure(homeId);
    const home = await this.prisma.home.findUniqueOrThrow({
      where: { id: homeId },
      include: { primaryResident: true },
    });
    const state = row.state as unknown as ScreenState;
    const now = new Date();
    const today = screenLocalTime(now, home.timezone).date;
    const dayStart = scheduledDate(today, 0, home.timezone);
    const dayEnd = scheduledDate(nextDateKey(today), 0, home.timezone);
    const [visits, appointments, weather, membershipRows] = await Promise.all([
      this.prisma.visit.findMany({
        where: { homeId, startsAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { homeId, startsAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startsAt: 'asc' },
      }),
      fetchCityWeather(state.settings.weatherCity),
      grant.administer
        ? this.prisma.membership.findMany({
            where: { organizationId: home.organizationId, disabledAt: null },
            include: { user: true },
          })
        : Promise.resolve([]),
    ]);
    const agenda = [
      ...visits.map((visit) => ({
        id: visit.id,
        type: 'visit' as const,
        title: visit.visitorName,
        startsAt: visit.startsAt,
      })),
      ...appointments.map((appointment) => ({
        id: appointment.id,
        type: 'appointment' as const,
        title: appointment.title,
        pictogram: appointmentPictogramSchema.catch('calendar').parse(appointment.pictogram),
        startsAt: appointment.startsAt,
      })),
    ]
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
      .map((item) => ({ ...item, startsAt: item.startsAt.toISOString() }));
    const nextVisit = visits.find((visit) => visit.startsAt >= now);
    const members = grant.administer
      ? membershipRows.map((membership) => ({
          id: membership.userId,
          name: membership.user.displayName,
        }))
      : undefined;
    if (!grant.administer) state.settings.grants = {};
    if (!userId) {
      state.history = [];
      state.activity = [];
      state.scheduledContent = [];
    } else {
      state.scheduledContent = (state.scheduledContent ?? []).filter((item) =>
        item.kind === 'message' ? grant.message : grant.control,
      );
    }
    return {
      state,
      paired: !!row.tokenHash,
      online: !!row.lastSeenAt && Date.now() - row.lastSeenAt.getTime() < 15000,
      lastSeen: row.lastSeenAt?.toISOString() ?? null,
      capabilities: row.capabilities as Record<string, boolean>,
      grant,
      userId,
      jitsiUrl: process.env.ELISE_JITSI_URL ?? null,
      resident: home.primaryResident?.displayName ?? 'Bienvenue',
      timezone: home.timezone,
      visit: nextVisit
        ? { visitorName: nextVisit.visitorName, startsAt: nextVisit.startsAt.toISOString() }
        : null,
      agenda,
      weather,
      members,
    };
  }
  async pairCode(userId: string) {
    const { home } = await this.access(userId, 'administer');
    const code = randomBytes(12).toString('hex');
    await this.prisma.residentScreen.update({
      where: { homeId: home.id },
      data: { pairingHash: hash(code), pairingExpiresAt: new Date(Date.now() + 300000) },
    });
    return { code, expiresIn: 300 };
  }
  async pair(code: string) {
    if (!/^[a-f0-9]{24}$/.test(code)) throw new UnauthorizedException();
    const token = randomBytes(32).toString('hex');
    const count = await this.prisma.residentScreen.updateMany({
      where: { pairingHash: hash(code), pairingExpiresAt: { gt: new Date() } },
      data: { tokenHash: hash(token), pairingHash: null, pairingExpiresAt: null, lastSeenAt: null },
    });
    if (count.count !== 1) throw new UnauthorizedException('Code expiré ou déjà utilisé.');
    const row = await this.prisma.residentScreen.findUniqueOrThrow({
      where: { tokenHash: hash(token) },
    });
    await this.mutate(row.homeId, (s) => this.finish(s, 'repaired'));
    return { token };
  }
  async device(token: string) {
    if (!token) throw new UnauthorizedException();
    const row = await this.prisma.residentScreen.findUnique({ where: { tokenHash: hash(token) } });
    if (!row) throw new UnauthorizedException();
    return row;
  }
  async heartbeat(token: string, capabilities: Record<string, boolean>) {
    const row = await this.device(token);
    const storedCapabilities = row.capabilities as Record<string, boolean>;
    const updatedCapabilities = { ...storedCapabilities, ...capabilities };
    if (!capabilities.host && storedCapabilities.host === true) {
      for (const key of ['camera', 'microphone']) {
        if (typeof storedCapabilities[key] === 'boolean')
          updatedCapabilities[key] = storedCapabilities[key];
        else delete updatedCapabilities[key];
      }
    }
    await this.prisma.residentScreen.update({
      where: { id: row.id },
      data: {
        ...(capabilities.host ? {} : { lastSeenAt: new Date() }),
        capabilities: json(updatedCapabilities),
      },
    });
    return this.present(row.homeId);
  }
  async settings(userId: string, body: unknown) {
    const { home } = await this.access(userId, 'administer');
    const input = parseRequest(screenSettingsSchema, body);
    const actor = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    await this.mutate(home.id, (s) => {
      s.settings = input;
      s.playback.volume = input.volume;
      if (!input.consent) this.finish(s, 'consent_revoked');
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'settings',
        title: 'Réglages de l’écran mis à jour',
        actor: actor.displayName,
        status: 'applied',
      });
    });
    return this.snapshot(userId);
  }
  async message(userId: string, input: string | ScreenMessageInput) {
    const parsed = screenMessageSchema.safeParse(
      typeof input === 'string' ? { message: input } : input,
    );
    if (!parsed.success) throw new BadRequestException('Messages ou durée invalides.');
    const messages =
      parsed.data.messages ?? (parsed.data.message?.trim() ? [parsed.data.message.trim()] : []);
    const message = messages[0] ?? '';
    const { home } = await this.access(userId, 'message');
    if (typeof message !== 'string' || message.length > 1000) throw new BadRequestException();
    const author = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    await this.mutate(home.id, (s) => {
      s.message = message;
      s.messages = messages;
      s.messageIntervalSeconds =
        parsed.data.messageIntervalSeconds ?? s.messageIntervalSeconds ?? 20;
      s.messageAuthor = message ? author.displayName : null;
      s.messageUpdatedAt = message ? Date.now() : null;
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'message',
        title: message ? 'Message affiché sur la TV' : 'Message retiré de la TV',
        ...(message ? { detail: message.slice(0, 240) } : {}),
        actor: author.displayName,
        status: 'applied',
      });
    });
    return this.snapshot(userId);
  }
  async scheduleContent(userId: string, input: ScreenScheduledContentInput) {
    const scheduledAt = input.scheduledAt.getTime();
    if (scheduledAt <= Date.now())
      throw new BadRequestException('Choisissez une date et une heure à venir.');
    if (scheduledAt > Date.now() + 366 * 86400000)
      throw new BadRequestException('La programmation est limitée à un an.');
    const { home } = await this.access(userId, input.kind === 'message' ? 'message' : 'control');
    const actor = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    await this.mutate(home.id, (s) => {
      s.scheduledContent ??= [];
      if (s.scheduledContent.length >= 100)
        throw new BadRequestException('Trop de contenus sont déjà programmés.');
      if (input.kind === 'photo') {
        const media = s.media.find((item) => item.id === input.mediaId && item.kind === 'photo');
        if (!media) throw new NotFoundException('Photo introuvable.');
        s.scheduledContent.push({
          id: randomUUID(),
          kind: 'photo',
          mediaId: media.id,
          title: media.title,
          scheduledAt,
          createdAt: Date.now(),
          actor: actor.displayName,
        });
      } else {
        s.scheduledContent.push({
          id: randomUUID(),
          kind: 'message',
          messages: input.messages,
          messageIntervalSeconds: input.messageIntervalSeconds,
          title: input.messages[0]!.slice(0, 120),
          scheduledAt,
          createdAt: Date.now(),
          actor: actor.displayName,
        });
      }
      s.scheduledContent.sort((left, right) => left.scheduledAt - right.scheduledAt);
    });
    return this.snapshot(userId);
  }
  async cancelScheduledContent(userId: string, id: string) {
    const { home, state, grant } = await this.access(userId);
    const scheduled = (state.scheduledContent ?? []).find((item) => item.id === id);
    if (!scheduled) throw new NotFoundException('Contenu programmé introuvable.');
    if (scheduled.kind === 'message' ? !grant.message : !grant.control)
      throw new ForbiddenException('Droit écran insuffisant.');
    await this.mutate(home.id, (s) => {
      s.scheduledContent = (s.scheduledContent ?? []).filter((item) => item.id !== id);
    });
    return this.snapshot(userId);
  }
  async appointments(userId: string) {
    const { home } = await this.access(userId, 'control');
    const rows = await this.prisma.appointment.findMany({
      where: { homeId: home.id, startsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 20,
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      pictogram: appointmentPictogramSchema.catch('calendar').parse(row.pictogram),
      startsAt: row.startsAt.toISOString(),
    }));
  }
  async addAppointment(
    userId: string,
    input: { title: string; startsAt: Date; pictogram?: AppointmentPictogram },
  ) {
    const { home } = await this.access(userId, 'control');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const row = await this.prisma.appointment.create({
      data: {
        homeId: home.id,
        title: input.title,
        startsAt: input.startsAt,
        pictogram: input.pictogram ?? 'calendar',
      },
    });
    await this.mutate(home.id, (s) =>
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'appointment',
        title: 'Rendez-vous ajouté à la TV',
        detail: `${row.title} · ${row.startsAt.toISOString()}`,
        actor: actor.displayName,
        status: 'applied',
      }),
    );
    return { id: row.id, title: row.title, startsAt: row.startsAt.toISOString() };
  }
  async updateAppointmentPictogram(userId: string, id: string, pictogram: AppointmentPictogram) {
    const { home } = await this.access(userId, 'control');
    const value = appointmentPictogramSchema.safeParse(pictogram);
    if (!value.success) throw new BadRequestException('Pictogramme invalide.');
    const result = await this.prisma.appointment.updateMany({
      where: { id, homeId: home.id },
      data: { pictogram: value.data },
    });
    if (!result.count) throw new NotFoundException('Rendez-vous introuvable.');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.mutate(home.id, (state) =>
      this.addActivity(state, {
        id: randomUUID(),
        kind: 'appointment',
        title: 'Pictogramme du rendez-vous modifié',
        actor: actor.displayName,
        status: 'applied',
      }),
    );
    return this.appointments(userId);
  }
  async removeAppointment(userId: string, id: string) {
    const { home } = await this.access(userId, 'control');
    const [appointment, actor] = await Promise.all([
      this.prisma.appointment.findFirst({ where: { id, homeId: home.id } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    const deleted = await this.prisma.appointment.deleteMany({ where: { id, homeId: home.id } });
    if (deleted.count !== 1) throw new NotFoundException('Rendez-vous introuvable.');
    await this.mutate(home.id, (s) =>
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'appointment',
        title: 'Rendez-vous retiré de la TV',
        ...(appointment?.title ? { detail: appointment.title } : {}),
        actor: actor.displayName,
        status: 'applied',
      }),
    );
    return { ok: true };
  }
  private async podcastCatalogRequest(url: URL): Promise<PodcastDirectoryResponse> {
    const response = await fetch(url, {
      headers: { 'user-agent': 'MichelOS/0.1 (+https://elise.local)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Podcast catalog HTTP ${response.status}.`);
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== 'object') throw new Error('Podcast catalog response invalide.');
    return body;
  }

  private async podcastFeedDetails(feedId: string): Promise<ScreenPodcastSubscription> {
    const url = new URL('/lookup', podcastCatalogBase);
    url.searchParams.set('entity', 'podcast');
    url.searchParams.set('id', feedId);
    const response = await this.podcastCatalogRequest(url);
    const row = response.results?.find((item) => {
      const id = item.collectionId ?? item.trackId;
      return (typeof id === 'string' || typeof id === 'number') && `${id}` === feedId;
    });
    if (!row) throw new NotFoundException('Podcast introuvable dans le catalogue.');
    const title = boundedCatalogText(row.collectionName ?? row.trackName, 120);
    const feedUrl = podcastHttpsUrl(row.feedUrl);
    if (!title || !feedUrl) throw new ConflictException('Flux de ce podcast indisponible.');
    const artworkUrl = podcastHttpsUrl(row.artworkUrl600 ?? row.artworkUrl100);
    return {
      id: feedId,
      title,
      author: boundedCatalogText(row.artistName, 120),
      episodeCount:
        typeof row.trackCount === 'number' && Number.isFinite(row.trackCount)
          ? Math.max(0, Math.min(100000, Math.trunc(row.trackCount)))
          : 0,
      ...(typeof row.primaryGenreName === 'string'
        ? { genre: boundedCatalogText(row.primaryGenreName, 80) }
        : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      feedUrl,
    };
  }

  private async episodesForPodcast(
    podcast: ScreenPodcastSubscription,
  ): Promise<ScreenPodcastEpisode[]> {
    const cached = podcastEpisodeCache.get(podcast.feedUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = fetchPodcastEpisodes(podcast.feedUrl, podcast.artworkUrl);
    podcastEpisodeCache.set(podcast.feedUrl, { expiresAt: Date.now() + 5 * 60_000, value });
    if (podcastEpisodeCache.size > 60) {
      const oldestKey = podcastEpisodeCache.keys().next().value;
      if (oldestKey) podcastEpisodeCache.delete(oldestKey);
    }
    try {
      return await value;
    } catch (error) {
      if (podcastEpisodeCache.get(podcast.feedUrl)?.value === value)
        podcastEpisodeCache.delete(podcast.feedUrl);
      throw error;
    }
  }

  async searchPodcasts(
    userId: string,
    rawQuery: string | undefined,
  ): Promise<ScreenPodcastSearchResult[]> {
    await this.access(userId, 'control');
    const query = rawQuery?.trim() ?? '';
    if (query.length < 2 || query.length > 80)
      throw new BadRequestException('Saisissez au moins deux caractères.');
    const url = new URL('/search', podcastCatalogBase);
    url.searchParams.set('term', query);
    try {
      const response = await this.podcastCatalogRequest(url);
      const seen = new Set<string>();
      return (response.results ?? [])
        .flatMap((row): ScreenPodcastSearchResult[] => {
          const idValue = row.collectionId ?? row.trackId;
          const id = typeof idValue === 'number' ? String(Math.trunc(idValue)) : '';
          const title = boundedCatalogText(row.collectionName ?? row.trackName, 120);
          if (!/^\d{1,20}$/.test(id) || !title || seen.has(id)) return [];
          seen.add(id);
          const artworkUrl = podcastHttpsUrl(row.artworkUrl600 ?? row.artworkUrl100);
          const item: ScreenPodcastSearchResult = {
            id,
            title,
            author: boundedCatalogText(row.artistName, 120),
            episodeCount:
              typeof row.trackCount === 'number' && Number.isFinite(row.trackCount)
                ? Math.max(0, Math.min(100000, Math.trunc(row.trackCount)))
                : 0,
            ...(typeof row.primaryGenreName === 'string'
              ? { genre: boundedCatalogText(row.primaryGenreName, 80) }
              : {}),
            ...(artworkUrl ? { artworkUrl } : {}),
          };
          return [item];
        })
        .slice(0, 24);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ConflictException('La recherche de podcasts est momentanément indisponible.');
    }
  }

  async followPodcast(userId: string, rawFeedId: string) {
    const feedId = rawFeedId.trim();
    if (!/^\d{1,20}$/.test(feedId)) throw new BadRequestException('Podcast invalide.');
    const { home, state } = await this.access(userId, 'control');
    if ((state.podcasts ?? []).some((podcast) => podcast.id === feedId))
      return this.snapshot(userId);
    let podcast: ScreenPodcastSubscription;
    try {
      podcast = await this.podcastFeedDetails(feedId);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
      throw new ConflictException('Impossible de récupérer ce podcast pour le moment.');
    }
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.mutate(home.id, (s) => {
      s.podcasts ??= [];
      if (s.podcasts.some((item) => item.id === feedId)) return;
      s.podcasts.push(podcast);
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'content',
        title: 'Podcast ajouté à la bibliothèque',
        detail: podcast.title,
        actor: actor.displayName,
        status: 'applied',
      });
    });
    return this.snapshot(userId);
  }

  async unfollowPodcast(userId: string, rawFeedId: string) {
    const feedId = rawFeedId.trim();
    if (!/^\d{1,20}$/.test(feedId)) throw new BadRequestException('Podcast invalide.');
    const { home } = await this.access(userId, 'control');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.mutate(home.id, (s) => {
      const podcast = (s.podcasts ?? []).find((item) => item.id === feedId);
      if (!podcast) throw new NotFoundException('Podcast introuvable dans la bibliothèque.');
      s.podcasts = (s.podcasts ?? []).filter((item) => item.id !== feedId);
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'content',
        title: 'Podcast retiré de la bibliothèque',
        detail: podcast.title,
        actor: actor.displayName,
        status: 'applied',
      });
    });
    return this.snapshot(userId);
  }

  async podcastEpisodes(userId: string, rawFeedId: string): Promise<ScreenPodcastEpisode[]> {
    const feedId = rawFeedId.trim();
    const { state } = await this.access(userId, 'control');
    if (!/^\d{1,20}$/.test(feedId)) throw new BadRequestException('Podcast invalide.');
    let podcast = (state.podcasts ?? []).find((item) => item.id === feedId);
    if (!podcast) {
      try {
        podcast = await this.podcastFeedDetails(feedId);
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
        throw new ConflictException('Impossible de récupérer ce podcast pour le moment.');
      }
    }
    try {
      return await this.episodesForPodcast(podcast);
    } catch {
      throw new ConflictException('Les épisodes de ce podcast sont momentanément indisponibles.');
    }
  }

  async playPodcastEpisode(userId: string, rawFeedId: string, episodeId: string) {
    const feedId = rawFeedId.trim();
    if (!/^\d{1,20}$/.test(feedId) || !episodeId.trim() || episodeId.length > 500)
      throw new BadRequestException('Épisode invalide.');
    const { home, row, state } = await this.access(userId, 'control');
    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 15000)
      throw new ConflictException('Écran hors ligne.');
    const podcast = (state.podcasts ?? []).find((item) => item.id === feedId);
    if (!podcast) throw new NotFoundException('Podcast introuvable dans la bibliothèque.');
    let episodes: ScreenPodcastEpisode[];
    try {
      episodes = await this.episodesForPodcast(podcast);
    } catch {
      throw new ConflictException('Les épisodes de ce podcast sont momentanément indisponibles.');
    }
    const selectedIndex = episodes.findIndex((episode) => episode.id === episodeId);
    if (selectedIndex < 0) throw new NotFoundException('Épisode introuvable dans ce podcast.');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const queue = episodes.slice(selectedIndex, selectedIndex + 50);
    const queueMedia: ScreenMedia[] = queue.map((episode) => {
      const existing = state.media.find(
        (media) =>
          media.kind === 'podcast' &&
          media.podcastFeedId === feedId &&
          media.podcastEpisodeId === episode.id,
      );
      return {
        id: existing?.id ?? randomUUID(),
        kind: 'podcast',
        title: episode.title,
        url: episode.enclosureUrl,
        podcastFeedId: feedId,
        podcastEpisodeId: episode.id,
        podcastShowTitle: podcast.title,
        podcastPublishedAt: episode.publishedAt ?? 0,
        ...(episode.durationSeconds ? { podcastDurationSeconds: episode.durationSeconds } : {}),
        ...((episode.artworkUrl ?? podcast.artworkUrl)
          ? { artworkUrl: episode.artworkUrl ?? podcast.artworkUrl }
          : {}),
      };
    });
    const commandId = randomUUID();
    await this.mutate(home.id, (s) => {
      const queuedIds = new Set(queueMedia.map((media) => media.id));
      let remaining = (s.media ?? []).filter(
        (media) =>
          !queuedIds.has(media.id) && !(media.kind === 'podcast' && media.podcastFeedId === feedId),
      );
      const scheduledIds = new Set((s.scheduledContent ?? []).map((slot) => slot.mediaId));
      const protectedIds = new Set([s.playback.mediaId, ...scheduledIds]);
      let excess = remaining.length + queueMedia.length - 200;
      if (excess > 0) {
        const removable = remaining
          .filter((media) => media.kind === 'podcast' && !protectedIds.has(media.id))
          .sort((a, b) => (a.podcastPublishedAt ?? 0) - (b.podcastPublishedAt ?? 0));
        const removeIds = new Set(removable.slice(0, excess).map((media) => media.id));
        remaining = remaining.filter((media) => !removeIds.has(media.id));
        excess = remaining.length + queueMedia.length - 200;
      }
      if (excess > 0) throw new ConflictException('La bibliothèque de médias est pleine.');
      s.media = [...remaining, ...queueMedia];
      const previousPlayback = { ...s.playback };
      s.playback.mediaId = queueMedia[0]!.id;
      s.playback.paused = false;
      s.playback.asleep = false;
      s.playback.revision++;
      s.commands.push({
        id: commandId,
        action: 'play',
        previousPlayback,
        revision: s.playback.revision,
        createdAt: Date.now(),
        expiresAt: Date.now() + 15000,
        status: 'pending',
      });
      s.commands = s.commands.slice(-50);
      this.addActivity(s, {
        id: commandId,
        kind: 'content',
        title: 'Podcast lancé',
        detail: `${queueMedia[0]!.title} · ${podcast.title}`,
        actor: actor.displayName,
        status: 'pending',
      });
    });
    return this.snapshot(userId);
  }

  async searchRadio(userId: string, rawQuery: string | undefined): Promise<RadioStationResult[]> {
    await this.access(userId, 'control');
    const query = rawQuery?.trim() ?? '';
    if (query.length < 2 || query.length > 60)
      throw new BadRequestException('Saisissez au moins deux caractères.');
    const url = new URL('https://de1.api.radio-browser.info/json/stations/search');
    url.searchParams.set('name', query);
    url.searchParams.set('countrycode', 'FR');
    url.searchParams.set('hidebroken', 'true');
    url.searchParams.set('is_https', 'true');
    url.searchParams.set('order', 'votes');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', '30');
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'EliseOS/0.1 (+https://elise.local)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows)) throw new Error('Réponse incorrecte');
      const seen = new Set<string>();
      return rows
        .flatMap((row): RadioStationResult[] => {
          if (!row || typeof row !== 'object') return [];
          const value = row as Record<string, unknown>;
          const stream = typeof value.url_resolved === 'string' ? value.url_resolved : '';
          const name = typeof value.name === 'string' ? value.name.trim() : '';
          const id = typeof value.stationuuid === 'string' ? value.stationuuid : '';
          const codec = typeof value.codec === 'string' ? value.codec.toUpperCase() : '';
          const favicon = typeof value.favicon === 'string' ? value.favicon.trim() : '';
          if (!id || !name || seen.has(stream) || !['MP3', 'AAC', 'AAC+', 'OGG'].includes(codec))
            return [];
          try {
            if (new URL(stream).protocol !== 'https:') return [];
          } catch {
            return [];
          }
          let artworkUrl = '';
          try {
            if (favicon && new URL(favicon).protocol === 'https:') artworkUrl = favicon;
          } catch {
            artworkUrl = '';
          }
          seen.add(stream);
          return [
            {
              id,
              name: name.slice(0, 120),
              url: stream.slice(0, 2048),
              country: typeof value.country === 'string' ? value.country.slice(0, 80) : '',
              codec,
              bitrate: typeof value.bitrate === 'number' ? value.bitrate : 0,
              ...(artworkUrl ? { artworkUrl: artworkUrl.slice(0, 2048) } : {}),
            },
          ];
        })
        .slice(0, 12);
    } catch {
      throw new ConflictException('Le catalogue des radios est momentanément indisponible.');
    }
  }
  async searchWeatherCities(
    userId: string,
    rawQuery: string | undefined,
  ): Promise<WeatherCityResult[]> {
    await this.access(userId, 'administer');
    const query = rawQuery?.trim() ?? '';
    if (query.length < 2 || query.length > 80)
      throw new BadRequestException('Saisissez au moins deux caractères.');
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', '8');
    url.searchParams.set('language', 'fr');
    url.searchParams.set('format', 'json');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as {
        results?: Array<{
          name?: string;
          admin1?: string;
          country?: string;
          latitude?: number;
          longitude?: number;
        }>;
      };
      const seen = new Set<string>();
      return (payload.results ?? []).flatMap((city): WeatherCityResult[] => {
        const name = city.name?.trim() ?? '';
        const latitude = Number(city.latitude);
        const longitude = Number(city.longitude);
        const details = [city.admin1, city.country]
          .filter((part): part is string => typeof part === 'string' && !!part.trim())
          .map((part) => part.trim());
        const label = [name, ...details].join(', ');
        const key = `${label.toLocaleLowerCase('fr-FR')}:${latitude}:${longitude}`;
        if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || seen.has(key))
          return [];
        seen.add(key);
        return [{ name, label, latitude, longitude }];
      });
    } catch {
      throw new ConflictException('La recherche de villes est momentanément indisponible.');
    }
  }
  private envGoogleConfig(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } | null {
    const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
    const configuredRedirect = process.env.YOUTUBE_REDIRECT_URI?.trim();
    const publicUrl =
      process.env.MICHEL_REMOTE_URL?.trim() || process.env.MICHEL_PUBLIC_URL?.trim();
    const redirectUri =
      configuredRedirect ||
      (publicUrl ? new URL('/api/v1/screen/youtube/callback', publicUrl).toString() : undefined);
    if (!clientId || !clientSecret || !redirectUri) return null;
    return { clientId, clientSecret, redirectUri };
  }
  private async googleConfig(userId: string) {
    const { home } = await this.access(userId, 'control');
    const integration = await this.prisma.googleIntegration.findUnique({
      where: { homeId: home.id },
    });
    if (integration) {
      return {
        clientId: integration.clientId,
        clientSecret: decryptCameraSecret(integration.clientSecretEncrypted),
        redirectUri: integration.redirectUri || this.defaultGoogleRedirectUri(),
        youtubeEnabled: integration.youtubeEnabled,
        calendarEnabled: integration.calendarEnabled,
      };
    }
    const env = this.envGoogleConfig();
    return env ? { ...env, youtubeEnabled: true, calendarEnabled: true } : null;
  }
  private defaultGoogleRedirectUri(requestOrigin?: string): string | null {
    const publicUrl =
      process.env.MICHEL_REMOTE_URL?.trim() ||
      process.env.MICHEL_PUBLIC_URL?.trim() ||
      requestOrigin;
    if (!publicUrl) return null;
    return new URL('/api/v1/screen/youtube/callback', publicUrl).toString();
  }
  async googleSettings(userId: string, requestOrigin?: string): Promise<GoogleSettingsResult> {
    const { home } = await this.access(userId, 'administer');
    const [integration, connection] = await Promise.all([
      this.prisma.googleIntegration.findUnique({ where: { homeId: home.id } }),
      this.prisma.youTubeConnection.findUnique({ where: { homeId: home.id } }),
    ]);
    const env = this.envGoogleConfig();
    return {
      configured: !!integration || !!env,
      clientId: integration?.clientId ?? env?.clientId ?? '',
      redirectUri:
        integration?.redirectUri ??
        env?.redirectUri ??
        this.defaultGoogleRedirectUri(requestOrigin),
      youtubeEnabled: integration?.youtubeEnabled ?? true,
      calendarEnabled: integration?.calendarEnabled ?? true,
      youtubeConnected: !!connection,
    };
  }
  async saveGoogleSettings(
    userId: string,
    input: {
      clientId: string;
      clientSecret?: string | undefined;
      redirectUri?: string | undefined;
      youtubeEnabled: boolean;
      calendarEnabled: boolean;
    },
    requestOrigin?: string,
  ): Promise<GoogleSettingsResult> {
    const { home } = await this.access(userId, 'administer');
    const existing = await this.prisma.googleIntegration.findUnique({ where: { homeId: home.id } });
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret?.trim();
    if (!clientId || clientId.length > 300)
      throw new BadRequestException('Client ID Google invalide.');
    if (!existing && !clientSecret)
      throw new BadRequestException('Saisissez le secret client Google.');
    if (clientSecret && clientSecret.length > 500)
      throw new BadRequestException('Secret Google invalide.');
    const redirectUri = input.redirectUri?.trim() || this.defaultGoogleRedirectUri(requestOrigin);
    if (redirectUri) {
      try {
        const parsed = new URL(redirectUri);
        if (
          parsed.protocol !== 'https:' &&
          !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
        )
          throw new Error();
      } catch {
        throw new BadRequestException('URI de redirection Google invalide.');
      }
    }
    await this.prisma.googleIntegration.upsert({
      where: { homeId: home.id },
      create: {
        homeId: home.id,
        clientId,
        clientSecretEncrypted: encryptCameraSecret(clientSecret!),
        redirectUri,
        youtubeEnabled: input.youtubeEnabled,
        calendarEnabled: input.calendarEnabled,
      },
      update: {
        clientId,
        ...(clientSecret ? { clientSecretEncrypted: encryptCameraSecret(clientSecret) } : {}),
        redirectUri,
        youtubeEnabled: input.youtubeEnabled,
        calendarEnabled: input.calendarEnabled,
      },
    });
    return this.googleSettings(userId, requestOrigin);
  }
  async removeGoogleSettings(userId: string): Promise<GoogleSettingsResult> {
    const { home } = await this.access(userId, 'administer');
    await this.prisma.$transaction([
      this.prisma.youTubeConnection.deleteMany({ where: { homeId: home.id } }),
      this.prisma.googleIntegration.deleteMany({ where: { homeId: home.id } }),
    ]);
    return this.googleSettings(userId);
  }
  async youtubeAuthorization(userId: string): Promise<string> {
    await this.access(userId, 'control');
    const config = await this.googleConfig(userId);
    if (!config || !config.youtubeEnabled || !config.redirectUri)
      throw new ConflictException(
        'YouTube doit être configuré par l’administrateur avant de connecter un compte.',
      );
    const state = randomBytes(32).toString('base64url');
    youtubeOAuthStates.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });
    for (const [key, value] of youtubeOAuthStates)
      if (value.expiresAt < Date.now()) youtubeOAuthStates.delete(key);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return url.toString();
  }
  async youtubeCallback(state: string | undefined, code: string | undefined): Promise<void> {
    const pending = state ? youtubeOAuthStates.get(state) : undefined;
    if (state) youtubeOAuthStates.delete(state);
    if (!pending || pending.expiresAt < Date.now() || !code)
      throw new BadRequestException('Connexion YouTube expirée ou refusée.');
    const config = await this.googleConfig(pending.userId);
    if (!config || !config.youtubeEnabled || !config.redirectUri)
      throw new ConflictException('YouTube n’est pas configuré.');
    const tokenResponse = await fetch(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok)
      throw new ConflictException('Google n’a pas validé la connexion YouTube.');
    const token = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
    };
    if (!token.access_token) throw new ConflictException('Jeton YouTube absent.');
    const current = await this.youtubeConnection(pending.userId);
    const refreshToken =
      token.refresh_token ?? (current ? decryptCameraSecret(current.refreshTokenEncrypted) : '');
    if (!refreshToken)
      throw new ConflictException('Google n’a pas fourni de jeton de renouvellement.');
    const [profile, channel] = await Promise.all([
      this.googleJson<{ email?: string }>(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        token.access_token,
      ).catch(() => ({ email: undefined })),
      this.googleJson<{ items?: Array<{ snippet?: { title?: string } }> }>(
        `${YOUTUBE_API_URL}/channels?part=snippet&mine=true`,
        token.access_token,
      ),
    ]);
    const home = (await this.access(pending.userId, 'control')).home;
    await this.prisma.youTubeConnection.upsert({
      where: { homeId: home.id },
      create: {
        homeId: home.id,
        googleAccountEmail: profile.email?.trim() || null,
        channelTitle: channel.items?.[0]?.snippet?.title?.trim() || null,
        refreshTokenEncrypted: encryptCameraSecret(refreshToken),
        scope: token.scope ?? YOUTUBE_SCOPE,
      },
      update: {
        googleAccountEmail: profile.email?.trim() || null,
        channelTitle: channel.items?.[0]?.snippet?.title?.trim() || null,
        ...(token.refresh_token
          ? { refreshTokenEncrypted: encryptCameraSecret(refreshToken) }
          : {}),
        scope: token.scope ?? YOUTUBE_SCOPE,
      },
    });
  }
  private async youtubeConnection(userId: string) {
    const { home } = await this.access(userId, 'control');
    return this.prisma.youTubeConnection.findUnique({ where: { homeId: home.id } });
  }
  async youtubeAccount(userId: string): Promise<YouTubeAccountResult> {
    const connection = await this.youtubeConnection(userId);
    const config = await this.googleConfig(userId);
    return {
      configured: !!config && config.youtubeEnabled,
      connected: !!connection,
      email: connection?.googleAccountEmail ?? null,
      channelTitle: connection?.channelTitle ?? null,
    };
  }
  private async googleJson<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new ConflictException('YouTube est momentanément indisponible.');
    return (await response.json()) as T;
  }
  private async youtubeAccessToken(
    userId: string,
  ): Promise<{ accessToken: string; homeId: string }> {
    const connection = await this.youtubeConnection(userId);
    const config = await this.googleConfig(userId);
    if (!config || !config.youtubeEnabled || !connection)
      throw new ConflictException('Connectez d’abord votre compte YouTube.');
    const refreshToken = decryptCameraSecret(connection.refreshTokenEncrypted);
    const response = await fetch(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new ConflictException('Reconnectez votre compte YouTube.');
    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token) throw new ConflictException('Jeton YouTube absent.');
    return { accessToken: token.access_token, homeId: connection.homeId };
  }
  async youtubePlaylists(userId: string): Promise<YouTubePlaylistResult[]> {
    const { accessToken } = await this.youtubeAccessToken(userId);
    const rows: YouTubePlaylistResult[] = [];
    let pageToken = '';
    do {
      const url = new URL(`${YOUTUBE_API_URL}/playlists`);
      url.searchParams.set('part', 'snippet,contentDetails');
      url.searchParams.set('mine', 'true');
      url.searchParams.set('maxResults', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.googleJson<{
        items?: Array<{
          id?: string;
          snippet?: {
            title?: string;
            description?: string;
            thumbnails?: { medium?: { url?: string } };
          };
          contentDetails?: { itemCount?: number };
        }>;
        nextPageToken?: string;
      }>(url.toString(), accessToken);
      for (const item of response.items ?? []) {
        if (!item.id || !item.snippet?.title) continue;
        const thumbnail = item.snippet.thumbnails?.medium?.url;
        rows.push({
          id: item.id,
          title: item.snippet.title.slice(0, 120),
          description: (item.snippet.description ?? '').slice(0, 300),
          itemCount: item.contentDetails?.itemCount ?? 0,
          thumbnailUrl: thumbnail?.startsWith('https://') ? thumbnail : null,
        });
      }
      pageToken = response.nextPageToken ?? '';
    } while (pageToken && rows.length < 200);
    return rows.slice(0, 200);
  }
  async youtubeImportPlaylist(userId: string, playlistId: string) {
    if (!/^[A-Za-z0-9_-]{5,150}$/.test(playlistId))
      throw new BadRequestException('Playlist invalide.');
    const { accessToken } = await this.youtubeAccessToken(userId);
    const playlist = await this.googleJson<{
      items?: Array<{ snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } } }>;
    }>(
      `${YOUTUBE_API_URL}/playlists?part=snippet&id=${encodeURIComponent(playlistId)}`,
      accessToken,
    );
    const details = playlist.items?.[0]?.snippet;
    if (!details?.title) throw new NotFoundException('Playlist YouTube introuvable.');
    const videoIds: string[] = [];
    let pageToken = '';
    do {
      const url = new URL(`${YOUTUBE_API_URL}/playlistItems`);
      url.searchParams.set('part', 'snippet,contentDetails');
      url.searchParams.set('playlistId', playlistId);
      url.searchParams.set('maxResults', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.googleJson<{
        items?: Array<{
          contentDetails?: { videoId?: string };
          snippet?: { resourceId?: { videoId?: string } };
        }>;
        nextPageToken?: string;
      }>(url.toString(), accessToken);
      for (const item of response.items ?? []) {
        const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
        if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) videoIds.push(id);
        if (videoIds.length >= 50) break;
      }
      pageToken = videoIds.length >= 50 ? '' : (response.nextPageToken ?? '');
    } while (pageToken);
    if (!videoIds.length)
      throw new ConflictException('Cette playlist ne contient aucune vidéo lisible.');
    const { state } = await this.access(userId, 'control');
    const existing = state.media.find((media) => media.youtubePlaylistId === playlistId);
    const mediaId = existing?.id ?? randomUUID();
    const snapshot = await this.media(userId, {
      id: mediaId,
      title: details.title.slice(0, 120),
      kind: 'youtube',
      url: `https://www.youtube.com/watch?v=${videoIds[0]}`,
      playlistUrls: videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`),
      youtubePlaylistId: playlistId,
      ...(details.thumbnails?.medium?.url?.startsWith('https://')
        ? { artworkUrl: details.thumbnails.medium.url }
        : {}),
    });
    return {
      media: snapshot.state.media.find((media) => media.id === mediaId),
      importedCount: videoIds.length,
      truncated: !!pageToken,
    };
  }
  async youtubeDisconnect(userId: string): Promise<YouTubeAccountResult> {
    const connection = await this.youtubeConnection(userId);
    if (connection) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: decryptCameraSecret(connection.refreshTokenEncrypted),
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Removing the local connection still prevents any further API access.
      }
      await this.prisma.youTubeConnection.delete({ where: { homeId: connection.homeId } });
    }
    return this.youtubeAccount(userId);
  }
  async command(userId: string, body: unknown) {
    const { home, row } = await this.access(userId, 'control');
    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 15000)
      throw new ConflictException('Écran hors ligne.');
    const input = parseRequest(screenCommandSchema, body);
    const id = randomUUID();
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.mutate(home.id, (s) => {
      const previousPlayback = { ...s.playback };
      const p = s.playback;
      if (input.action === 'play') {
        if (!s.media.some((m) => m.id === input.mediaId))
          throw new BadRequestException('Contenu introuvable');
        p.mediaId = input.mediaId!;
        p.paused = false;
        p.asleep = false;
      }
      if (input.action === 'pause') p.paused = true;
      if (input.action === 'resume') {
        p.paused = false;
        p.asleep = false;
      }
      if (input.action === 'stop') {
        p.mediaId = null;
        p.paused = false;
      }
      if (input.action === 'sleep') {
        p.asleep = true;
        this.finish(s, 'sleep');
      }
      if (input.action === 'wake') p.asleep = false;
      if (input.action === 'volume') {
        if (input.volume === undefined) throw new BadRequestException();
        p.volume = input.volume;
        s.settings.volume = input.volume;
      }
      const currentMedia = s.media.find((media) => media.id === p.mediaId);
      if (input.action === 'next' && currentMedia?.kind === 'podcast') {
        const podcastQueue = s.media
          .filter(
            (media) =>
              media.kind === 'podcast' && media.podcastFeedId === currentMedia.podcastFeedId,
          )
          .sort(
            (a, b) =>
              (b.podcastPublishedAt ?? 0) - (a.podcastPublishedAt ?? 0) ||
              s.media.indexOf(a) - s.media.indexOf(b),
          );
        const currentIndex = podcastQueue.findIndex((media) => media.id === currentMedia.id);
        const nextEpisode = currentIndex >= 0 ? podcastQueue[currentIndex + 1] : undefined;
        if (nextEpisode) {
          p.mediaId = nextEpisode.id;
          p.paused = false;
          p.asleep = false;
        }
      }
      if (
        input.action === 'next' &&
        currentMedia?.kind !== 'youtube' &&
        currentMedia?.kind !== 'tv' &&
        currentMedia?.kind !== 'podcast' &&
        s.media.some((media) => media.kind === 'photo')
      ) {
        const photos = s.media.filter((media) => media.kind === 'photo');
        p.mediaId =
          photos[(photos.findIndex((media) => media.id === p.mediaId) + 1) % photos.length]!.id;
        p.paused = false;
      }
      if (input.action === 'next' && currentMedia?.kind === 'youtube') p.paused = false;
      if (input.action === 'planning') s.lastSlot = '';
      p.revision++;
      const target = s.media.find((media) => media.id === p.mediaId);
      s.commands.push({
        id,
        action: input.action,
        previousPlayback,
        revision: p.revision,
        createdAt: Date.now(),
        expiresAt:
          Date.now() +
          (target?.kind === 'tv' && ['play', 'resume'].includes(input.action) ? 120_000 : 15_000),
        status: 'pending',
      });
      s.commands = s.commands.slice(-50);
      const labels: Record<string, string> = {
        play:
          target?.kind === 'stream'
            ? 'Radio lancée'
            : target?.kind === 'podcast'
              ? 'Podcast lancé'
              : target?.kind === 'tv'
                ? target.title
                  ? `${target.title} lancée`
                  : 'Chaîne TV lancée'
                : target?.kind === 'youtube'
                  ? 'Playlist YouTube lancée'
                  : 'Photo affichée',
        pause: 'Diffusion mise en pause',
        resume: 'Diffusion reprise',
        next:
          target?.kind === 'youtube'
            ? 'Vidéo suivante demandée'
            : target?.kind === 'podcast'
              ? 'Épisode suivant demandé'
              : 'Contenu suivant demandé',
        stop: 'Retour à l’accueil demandé',
        wake: 'Réveil de l’écran demandé',
        sleep: 'Mise au repos demandée',
        planning: 'Reprise du planning demandée',
        volume: `Volume réglé à ${p.volume} %`,
      };
      this.addActivity(s, {
        id,
        kind: input.action === 'play' ? 'content' : 'control',
        title: labels[input.action] ?? input.action,
        ...(target?.title ? { detail: target.title } : {}),
        actor: actor.displayName,
        status: 'pending',
      });
    });
    return { id };
  }
  async ack(token: string, id: string, error?: string) {
    const row = await this.device(token);
    await this.mutate(row.homeId, (s) => {
      const c = s.commands.find((c) => c.id === id);
      if (c?.status === 'pending') {
        c.status = c.expiresAt < Date.now() ? 'expired' : error ? 'failed' : 'applied';
        if (error) c.error = error.slice(0, 200);
        if (c.status !== 'applied' && c.previousPlayback && c.revision === s.playback.revision)
          s.playback = c.previousPlayback;
        const activity = (s.activity ?? []).find((item) => item.id === id);
        if (activity) {
          activity.status = c.status;
          if (error) activity.detail = activity.detail ? `${activity.detail} · ${error}` : error;
        }
      }
    });
    return { ok: true };
  }
  async media(userId: string, body: unknown) {
    const { home } = await this.access(userId, 'control');
    const m = parseRequest(screenMediaSchema, body);
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const u = new URL(m.url, 'http://local');
    if (m.artworkUrl && new URL(m.artworkUrl).protocol !== 'https:')
      throw new BadRequestException('Logo HTTPS requis.');
    if (m.url.startsWith('/api/v1/screen-media/')) {
      if (!m.url.startsWith(`/api/v1/screen-media/${home.id}/`)) throw new ForbiddenException();
    } else {
      if (u.protocol !== 'https:') throw new BadRequestException('Adresse HTTPS requise.');
      if (
        m.kind === 'youtube' &&
        !['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(u.hostname)
      )
        throw new BadRequestException('Lien YouTube requis.');
      if (['photo', 'audio', 'video'].includes(m.kind))
        throw new BadRequestException('Déposez un fichier local.');
    }
    await this.mutate(home.id, (s) => {
      const existing = s.media.find((x) => x.id === m.id);
      s.media = s.media.filter((x) => x.id !== m.id);
      if (s.media.length >= 200) throw new BadRequestException('Bibliothèque pleine.');
      s.media.push(m);
      this.addActivity(s, {
        id: randomUUID(),
        kind: 'content',
        title: existing
          ? m.kind === 'photo'
            ? 'Commentaire de photo modifié'
            : m.kind === 'stream'
              ? 'Radio mise à jour'
              : 'Contenu mis à jour'
          : m.kind === 'photo'
            ? 'Photo ajoutée à l’album'
            : m.kind === 'stream'
              ? 'Radio ajoutée aux favoris'
              : 'Contenu ajouté',
        detail: m.title,
        actor: actor.displayName,
        status: 'applied',
      });
    });
    return this.snapshot(userId);
  }
  async upload(userId: string, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    const { home } = await this.access(userId, 'control');
    const kinds: Record<string, string> = {
      'image/jpeg': 'photo',
      'image/png': 'photo',
      'image/webp': 'photo',
      'audio/mpeg': 'audio',
      'audio/ogg': 'audio',
      'video/mp4': 'video',
      'video/webm': 'video',
    };
    const kind = kinds[file.mimetype];
    if (!kind) throw new BadRequestException('Format non pris en charge.');
    const id = randomUUID();
    await fs.mkdir(path.join(mediaRoot, home.id), { recursive: true });
    await fs.writeFile(path.join(mediaRoot, home.id, id), file.buffer, { flag: 'wx' });
    try {
      return await this.media(userId, {
        id,
        title: file.originalname.slice(0, 120),
        kind,
        mimeType: file.mimetype,
        url: `/api/v1/screen-media/${home.id}/${id}`,
      });
    } catch (e) {
      await fs.unlink(path.join(mediaRoot, home.id, id));
      throw e;
    }
  }
  async removeMedia(userId: string, id: string) {
    const { home } = await this.access(userId, 'control');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let localFile = false;
    await this.mutate(home.id, (s) => {
      const removed = s.media.find((m) => m.id === id);
      localFile = s.media.some(
        (m) => m.id === id && m.url === `/api/v1/screen-media/${home.id}/${id}`,
      );
      s.media = s.media.filter((m) => m.id !== id);
      s.settings.schedule = s.settings.schedule.filter((x) => x.mediaId !== id);
      s.scheduledContent = (s.scheduledContent ?? []).filter((x) => x.mediaId !== id);
      if (s.playback.mediaId === id) s.playback.mediaId = null;
      if (removed)
        this.addActivity(s, {
          id: randomUUID(),
          kind: 'content',
          title:
            removed.kind === 'stream'
              ? 'Radio retirée des favoris'
              : removed.kind === 'youtube'
                ? 'Playlist retirée'
                : removed.kind === 'tv'
                  ? 'Chaîne retirée'
                  : 'Photo retirée',
          detail: removed.title,
          actor: actor.displayName,
          status: 'applied',
        });
    });
    if (localFile) {
      await fs.unlink(path.join(mediaRoot, home.id, id)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return this.snapshot(userId);
  }
  async mediaPath(homeId: string, id: string, userId?: string, token?: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(homeId) || !/^[a-f0-9-]{36}$/.test(id))
      throw new NotFoundException();
    if (token) {
      if ((await this.device(token)).homeId !== homeId) throw new ForbiddenException();
    } else if (!userId || (await this.home(userId)).id !== homeId) throw new ForbiddenException();
    const row = await this.ensure(homeId);
    const m = (row.state as unknown as ScreenState).media.find((x) => x.id === id);
    if (!m) throw new NotFoundException();
    return {
      path: path.join(mediaRoot, homeId, id),
      kind: m.kind,
      mimeType: m.mimeType ?? 'application/octet-stream',
    };
  }
  async startCall(userId: string) {
    const { home, row, grant } = await this.access(userId, 'call');
    if (!process.env.ELISE_JITSI_URL || !process.env.ELISE_JITSI_SECRET)
      throw new ConflictException('Jitsi doit être installé.');
    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 15000)
      throw new ConflictException('Écran hors ligne.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.mutate(home.id, (s) => {
      if (!s.settings.consent) throw new ForbiddenException('Accord visio requis.');
      if (s.call) throw new ConflictException('Le résident est déjà en communication.');
      if (
        s.playback.asleep ||
        screenIsQuiet(s.settings, screenLocalTime(new Date(), home.timezone).time)
      )
        throw new ConflictException('Le résident est au repos.');
      const id = randomUUID();
      s.call = {
        id,
        room: `elise${id.replaceAll('-', '')}`,
        userId,
        name: user.displayName,
        automatic: grant.autoAnswer,
        createdAt: Date.now(),
        acceptedAt: null,
        callerSeenAt: Date.now(),
        deadline: Date.now() + (grant.autoAnswer ? 5000 : 30000),
      };
      this.addActivity(s, {
        id,
        kind: 'call',
        title: `Appel de ${user.displayName}`,
        detail: grant.autoAnswer ? 'Décrochage automatique' : 'En attente de réponse',
        actor: user.displayName,
        status: 'pending',
      });
    });
    return this.snapshot(userId);
  }
  async endCall(userId: string, id: string) {
    const { home } = await this.access(userId, 'call');
    await this.mutate(home.id, (s) => {
      if (s.call?.id === id) {
        if (s.call.userId !== userId) throw new ForbiddenException();
        this.finish(s, 'ended');
      }
    });
    return { ok: true };
  }
  async button(token: string) {
    const row = await this.device(token);
    await this.mutate(row.homeId, (s) => {
      if (s.call) {
        if (!s.call.automatic && !s.call.acceptedAt) {
          s.call.acceptedAt = Date.now();
        } else this.finish(s, s.call.acceptedAt ? 'ended' : 'refused');
      } else s.playback.asleep = !s.playback.asleep;
    });
    return { ok: true };
  }
  async deviceEnd(token: string, id: string) {
    const row = await this.device(token);
    await this.mutate(row.homeId, (s) => {
      if (s.call?.id === id) this.finish(s, 'ended');
    });
    return { ok: true };
  }
  async join(userId: string | undefined, token: string | undefined, id: string) {
    const row = token ? await this.device(token) : (await this.access(userId!, 'call')).row;
    const s = row.state as unknown as ScreenState;
    const c = s.call;
    if (!c || c.id !== id || !c.acceptedAt || (!token && c.userId !== userId))
      throw new ForbiddenException();
    const participant = token ? `screen:${row.id}` : userId!;
    const now = Math.floor(Date.now() / 1000);
    const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const payload = {
      aud: 'elise',
      iss: 'elise',
      sub: 'meet.jitsi',
      room: c.room,
      iat: now,
      nbf: now - 5,
      exp: now + 120,
      context: { user: { id: participant, name: token ? 'Résident' : c.name } },
    };
    const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
    const secret = process.env.ELISE_JITSI_SECRET;
    if (!secret) throw new ConflictException('Jitsi indisponible');
    return {
      url: process.env.ELISE_JITSI_URL!,
      room: c.room,
      jwt: `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`,
      name: token ? 'Résident' : c.name,
    };
  }
  async authorizeConference(room: string, participant: string) {
    const row = await this.prisma.residentScreen.findFirst({
      where: { state: { path: ['call', 'room'], equals: room } },
    });
    if (!row) return false;
    const s = row.state as unknown as ScreenState;
    if (
      !s.call?.acceptedAt ||
      !s.settings.consent ||
      !row.lastSeenAt ||
      Date.now() - row.lastSeenAt.getTime() > 15000
    )
      return false;
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: row.homeId } });
    const m = await this.prisma.membership.findFirst({
      where: { organizationId: home.organizationId, userId: s.call.userId, disabledAt: null },
    });
    return (
      !!m &&
      this.rights(s, m.userId, m.systemRole).call &&
      (participant === s.call.userId || participant === `screen:${row.id}`)
    );
  }
  private async tick() {
    for (const row of await this.prisma.residentScreen.findMany()) {
      const home = await this.prisma.home.findUniqueOrThrow({ where: { id: row.homeId } });
      await this.mutate(home.id, async (s) => {
        const now = Date.now();
        if (s.call) {
          const m = await this.prisma.membership.findFirst({
            where: { organizationId: home.organizationId, userId: s.call.userId, disabledAt: null },
          });
          if (!m || !this.rights(s, m.userId, m.systemRole).call) this.finish(s, 'revoked');
          else if (now - (s.call.callerSeenAt ?? s.call.createdAt) > 45000)
            this.finish(s, 'caller_disconnected');
          else if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > 15000)
            this.finish(s, 'offline');
          else if (!s.call.acceptedAt && now >= s.call.deadline) {
            if (s.call.automatic) s.call.acceptedAt = now;
            else this.finish(s, 'missed');
          }
        }
        for (const c of s.commands)
          if (c.status === 'pending' && c.expiresAt < now) {
            c.status = 'expired';
            if (c.previousPlayback && c.revision === s.playback.revision)
              s.playback = c.previousPlayback;
          }
        if (advanceScreenSchedule(s, new Date(), home.timezone)) this.finish(s, 'quiet');
        s.scheduledContent ??= [];
        const due = s.scheduledContent.filter((item) => item.scheduledAt <= now);
        s.scheduledContent = s.scheduledContent.filter((item) => item.scheduledAt > now);
        for (const item of due) {
          if (item.kind === 'message') {
            const messages = item.messages?.filter(Boolean) ?? [];
            s.message = messages[0] ?? '';
            s.messages = messages;
            s.messageIntervalSeconds = item.messageIntervalSeconds ?? 20;
            s.messageAuthor = item.actor;
            s.messageUpdatedAt = now;
            this.addActivity(s, {
              id: randomUUID(),
              kind: 'message',
              title: 'Message programmé affiché sur la TV',
              ...(s.message ? { detail: s.message.slice(0, 240) } : {}),
              actor: item.actor,
              status: 'applied',
            });
            continue;
          }
          const media = s.media.find(
            (candidate) => candidate.id === item.mediaId && candidate.kind === 'photo',
          );
          if (!media) {
            this.addActivity(s, {
              id: randomUUID(),
              kind: 'content',
              title: 'Photo programmée introuvable',
              detail: item.title,
              actor: item.actor,
              status: 'failed',
            });
            continue;
          }
          const id = randomUUID();
          const previousPlayback = { ...s.playback };
          s.playback.mediaId = media.id;
          s.playback.paused = false;
          s.playback.asleep = false;
          s.playback.revision++;
          s.commands.push({
            id,
            action: 'play',
            previousPlayback,
            revision: s.playback.revision,
            createdAt: now,
            expiresAt: now + 15000,
            status: 'pending',
          });
          s.commands = s.commands.slice(-50);
          this.addActivity(s, {
            id,
            kind: 'content',
            title: 'Photo programmée affichée',
            detail: media.title,
            actor: item.actor,
            status: 'pending',
          });
        }
        s.history = s.history.filter((h) => h.endedAt > now - 30 * 86400000);
      });
    }
  }
}
