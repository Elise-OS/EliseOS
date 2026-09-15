import {
  appointmentPictogramSchema,
  screenMessageSchema,
  type ScreenMessageInput,
  type AppointmentPictogram,
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
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
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
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { parseRequest } from '../../platform/zod-validation';
import { decryptCameraSecret, encryptCameraSecret } from '../cameras/camera-crypto';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const json = (s: unknown) => JSON.parse(JSON.stringify(s)) as Prisma.InputJsonValue;
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
const youtubeOAuthStates = new Map<string, { userId: string; expiresAt: number }>();
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
  return value;
}
@Injectable()
export class ScreenService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    await fs.mkdir(mediaRoot, { recursive: true });
    // A process restart never resurrects a conference or replays pending commands.
    for (const row of await this.prisma.residentScreen.findMany())
      await this.mutate(row.homeId, (s) => {
        s.settings.weatherCity ??= '';
        s.settings.slideshowSeconds ??= 15;
        s.activity ??= [];
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
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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
    const rangeStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const [nextVisit, visits, appointments, weather, membershipRows] = await Promise.all([
      this.prisma.visit.findFirst({
        where: { homeId, startsAt: { gte: now } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.visit.findMany({
        where: { homeId, startsAt: { gte: rangeStart, lt: rangeEnd } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { homeId, startsAt: { gte: rangeStart, lt: rangeEnd } },
        orderBy: { startsAt: 'asc' },
      }),
      fetchCityWeather(state.settings.weatherCity || home.address),
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
      .slice(0, 3)
      .map((item) => ({ ...item, startsAt: item.startsAt.toISOString() }));
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
    await this.prisma.residentScreen.update({
      where: { id: row.id },
      data: {
        ...(capabilities.host ? {} : { lastSeenAt: new Date() }),
        capabilities: json({ ...(row.capabilities as Record<string, boolean>), ...capabilities }),
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
  private youtubeConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
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
  youtubeAccountConfigured(): boolean {
    return this.youtubeConfig() !== null;
  }
  async youtubeAuthorization(userId: string): Promise<string> {
    await this.access(userId, 'control');
    const config = this.youtubeConfig();
    if (!config)
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
    const config = this.youtubeConfig();
    if (!config) throw new ConflictException('YouTube n’est pas configuré.');
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
    return {
      configured: this.youtubeAccountConfigured(),
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
    const config = this.youtubeConfig();
    if (!config || !connection)
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
      if (
        input.action === 'next' &&
        s.media.find((media) => media.id === p.mediaId)?.kind !== 'youtube' &&
        s.media.find((media) => media.id === p.mediaId)?.kind !== 'tv' &&
        s.media.some((media) => media.kind === 'photo')
      ) {
        const photos = s.media.filter((media) => media.kind === 'photo');
        p.mediaId =
          photos[(photos.findIndex((media) => media.id === p.mediaId) + 1) % photos.length]!.id;
        p.paused = false;
      }
      if (
        input.action === 'next' &&
        s.media.find((media) => media.id === p.mediaId)?.kind === 'youtube'
      )
        p.paused = false;
      if (input.action === 'planning') s.lastSlot = '';
      p.revision++;
      s.commands.push({
        id,
        action: input.action,
        previousPlayback,
        revision: p.revision,
        createdAt: Date.now(),
        expiresAt: Date.now() + 15000,
        status: 'pending',
      });
      s.commands = s.commands.slice(-50);
      const target = s.media.find((media) => media.id === p.mediaId);
      const labels: Record<string, string> = {
        play:
          target?.kind === 'stream'
            ? 'Radio lancée'
            : target?.kind === 'tv'
              ? 'ARTE lancée'
              : target?.kind === 'youtube'
                ? 'Playlist YouTube lancée'
                : 'Photo affichée',
        pause: 'Diffusion mise en pause',
        resume: 'Diffusion reprise',
        next: target?.kind === 'youtube' ? 'Vidéo suivante demandée' : 'Contenu suivant demandé',
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
        s.history = s.history.filter((h) => h.endedAt > now - 30 * 86400000);
      });
    }
  }
}
