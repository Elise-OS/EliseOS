import {
  heatwaveLocalClock,
  heatwaveRegistryDue,
  heatwaveTip,
  heatwaveZonedDate,
  nextHydrationReminder,
  parseHeatwaveSettings,
  relevantForecastMaxima,
  HEATWAVE_FRESH_MINUTES,
  type HeatwaveForecast,
  type HeatwaveManual,
  type HeatwaveScreenView,
  type HeatwaveSettings,
  type HeatwaveSource,
  type HeatwaveStatus,
  type ScreenState,
} from '@elise/contracts';
import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import type { MembershipRole, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../platform/prisma.service';
import { rolesFor } from '../auth/access-policy';
import { fetchCityForecast, type CityForecast } from '../screen/screen.service';

const SETTINGS_MANAGERS = rolesFor('configuration:manage');
const MODE_TOGGLERS = rolesFor('alerts:manage');
const FORECAST_REFRESH_MS = 15 * 60_000;
/** An outdoor temperature older than this cannot decide the evening advice. */
const OUTDOOR_FRESH_MS = 2 * 60 * 60_000;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

interface HomeAccess {
  id: string;
  timezone: string;
  role: MembershipRole;
}

/** The forecast row the heatwave mode keeps, built from the TV weather of the city. */
export function heatwaveForecastFrom(
  reading: CityForecast,
  now: Date,
  timeZone: string,
): HeatwaveForecast {
  // Open-Meteo answers in the city's local time ("2026-07-15T14:00"): its date is the forecast day.
  const observedDate = /^\d{4}-\d{2}-\d{2}/.exec(reading.observedAt)?.[0];
  return {
    date: observedDate ?? heatwaveLocalClock(now, timeZone).dateKey,
    todayMax: reading.maximum,
    tomorrowMax: reading.tomorrowMaximum,
    outdoorNow: reading.temperature,
    city: reading.city,
    fetchedAt: now.toISOString(),
  };
}

export function storedForecast(
  value: Prisma.JsonValue | null | undefined,
): HeatwaveForecast | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const forecast = value as Record<string, unknown>;
  const number = (key: string) =>
    typeof forecast[key] === 'number' && Number.isFinite(forecast[key]) ? forecast[key] : null;
  if (typeof forecast.date !== 'string' || typeof forecast.fetchedAt !== 'string') return null;
  return {
    date: forecast.date,
    todayMax: number('todayMax'),
    tomorrowMax: number('tomorrowMax'),
    outdoorNow: number('outdoorNow'),
    city: typeof forecast.city === 'string' ? forecast.city : null,
    fetchedAt: forecast.fetchedAt,
  };
}

@Injectable()
export class HeatwaveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeatwaveService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstRun: ReturnType<typeof setTimeout> | null = null;

  public constructor(private readonly prisma: PrismaService) {}

  public onModuleInit(): void {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    // The forecast is refreshed here, with the TV weather cache, so the worker never needs the
    // Internet: it reads the last forecast stored in the database.
    this.firstRun = setTimeout(() => void this.refreshForecasts(), 20_000);
    this.timer = setInterval(() => void this.refreshForecasts(), FORECAST_REFRESH_MS);
    this.firstRun.unref?.();
    this.timer.unref?.();
  }

  public onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  /** Stores today's and tomorrow's forecast of each home whose TV has a weather city. */
  public async refreshForecasts(now = new Date()): Promise<number> {
    let stored = 0;
    try {
      const screens = await this.prisma.residentScreen.findMany({
        select: { homeId: true, state: true, home: { select: { timezone: true } } },
      });
      for (const screen of screens) {
        const city = (screen.state as unknown as ScreenState | null)?.settings?.weatherCity;
        if (!city?.trim()) continue;
        const reading = await fetchCityForecast(city);
        if (!reading) continue;
        const forecast = json(heatwaveForecastFrom(reading, now, screen.home.timezone));
        await this.prisma.heatwaveMode.upsert({
          where: { homeId: screen.homeId },
          create: { homeId: screen.homeId, forecast },
          update: { forecast },
        });
        stored += 1;
      }
    } catch (error) {
      this.logger.warn(
        `Heatwave forecast refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return stored;
  }

  public async status(userId: string, now = new Date()): Promise<HeatwaveStatus> {
    const home = await this.homeFor(userId);
    const row = await this.prisma.heatwaveMode.findUnique({ where: { homeId: home.id } });
    const settings = parseHeatwaveSettings(row?.settings);
    const forecast = storedForecast(row?.forecast);
    const { dateKey } = heatwaveLocalClock(now, home.timezone);
    const dayStart = heatwaveZonedDate(dateKey, 0, home.timezone);
    const dayEnd = new Date(dayStart.getTime() + 36 * 60 * 60_000);
    const nextDayStart = heatwaveZonedDate(
      heatwaveLocalClock(dayEnd, home.timezone).dateKey,
      0,
      home.timezone,
    );
    const [indoor, reminders] = await Promise.all([
      this.indoor(home.id, dayStart, now),
      this.prisma.hydrationReminder.findMany({
        where: { homeId: home.id, scheduledFor: { gte: dayStart, lt: nextDayStart } },
        select: { scheduledFor: true },
      }),
    ]);
    const active = row?.active ?? false;
    return {
      settings,
      active,
      source: (row?.source as HeatwaveSource | null) ?? null,
      manual: (row?.manual as HeatwaveManual | null) ?? null,
      activatedAt: row?.activatedAt?.toISOString() ?? null,
      deactivatedAt: row?.deactivatedAt?.toISOString() ?? null,
      timezone: home.timezone,
      indoor,
      forecast: {
        available: relevantForecastMaxima(forecast, dateKey).length > 0,
        city: forecast?.city ?? null,
        todayMax: forecast?.date === dateKey ? forecast.todayMax : (forecast?.tomorrowMax ?? null),
        tomorrowMax: forecast?.date === dateKey ? forecast.tomorrowMax : null,
        outdoorNow: forecast?.outdoorNow ?? null,
        fetchedAt: forecast?.fetchedAt ?? null,
      },
      reminders: {
        shown: reminders.filter((reminder) => reminder.scheduledFor <= now).length,
        next: active
          ? (nextHydrationReminder(settings, now, home.timezone)?.toISOString() ?? null)
          : null,
      },
      registry: heatwaveRegistryDue({
        now,
        timeZone: home.timezone,
        acknowledgedYear: row?.registryAcknowledgedYear ?? null,
        active,
      }),
      canManage: SETTINGS_MANAGERS.includes(home.role),
      canToggle: MODE_TOGGLERS.includes(home.role),
    };
  }

  public async updateSettings(userId: string, settings: HeatwaveSettings) {
    const home = await this.homeFor(userId, SETTINGS_MANAGERS);
    await this.prisma.$transaction(async (tx) => {
      await tx.heatwaveMode.upsert({
        where: { homeId: home.id },
        create: { homeId: home.id, settings: json(settings) },
        update: { settings: json(settings) },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'HEATWAVE_SETTINGS_UPDATED',
          target: home.id,
          metadata: json({
            indoor: settings.indoorTrigger.enabled,
            forecast: settings.forecastTrigger.enabled,
            reminders: settings.reminders.enabled,
            tips: settings.tips.enabled,
            alert: settings.alert.enabled,
          }),
        },
      });
    });
    return this.status(userId);
  }

  /**
   * The family turns the mode on (it stays on until turned off) or off (it stays off until the
   * heat is over, then the automatic triggers are armed again).
   */
  public async setManual(userId: string, active: boolean, now = new Date()) {
    const home = await this.homeFor(userId, MODE_TOGGLERS);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`heatwave:${home.id}`}))`;
      const current = await tx.heatwaveMode.findUnique({ where: { homeId: home.id } });
      const wasActive = current?.active ?? false;
      const data = active
        ? {
            active: true,
            source: 'MANUAL',
            manual: 'ON',
            ...(wasActive ? {} : { activatedAt: now }),
          }
        : {
            active: false,
            source: null,
            manual: 'OFF',
            ...(wasActive ? { deactivatedAt: now } : {}),
          };
      await tx.heatwaveMode.upsert({
        where: { homeId: home.id },
        create: { homeId: home.id, ...data },
        update: data,
      });
      if (active && !wasActive)
        await tx.outboxMessage.create({
          data: {
            homeId: home.id,
            topic: 'push',
            payload: {
              kind: 'heatwave',
              title: 'Élise · Mode canicule activé',
              body: 'Ouvrez Élise pour voir les conseils du jour.',
              excludeUserId: userId,
            },
          },
        });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: active ? 'HEATWAVE_TURNED_ON' : 'HEATWAVE_TURNED_OFF',
          target: home.id,
          metadata: json({ wasActive }),
        },
      });
    });
    return this.status(userId, now);
  }

  public async acknowledgeRegistry(userId: string, year: number) {
    const home = await this.homeFor(userId, MODE_TOGGLERS);
    await this.prisma.heatwaveMode.upsert({
      where: { homeId: home.id },
      create: { homeId: home.id, registryAcknowledgedYear: year },
      update: { registryAcknowledgedYear: year },
    });
    await this.prisma.auditLog.create({
      data: {
        homeId: home.id,
        actorId: userId,
        action: 'HEATWAVE_REGISTRY_ACKNOWLEDGED',
        target: home.id,
        metadata: json({ year }),
      },
    });
    return this.status(userId);
  }

  /** What the TV of the home shows, for the paired TV (token) or a family preview (session). */
  public async screenForToken(token: string, now = new Date()) {
    return this.screenView(await this.homeForToken(token), now);
  }

  public async screenForUser(userId: string, now = new Date()) {
    return this.screenView(await this.homeFor(userId), now);
  }

  private async screenView(
    home: { id: string; timezone: string },
    now: Date,
  ): Promise<HeatwaveScreenView> {
    const row = await this.prisma.heatwaveMode.findUnique({ where: { homeId: home.id } });
    if (!row?.active) return { active: false, tip: null, reminder: null };
    const settings = parseHeatwaveSettings(row.settings);
    const forecast = storedForecast(row.forecast);
    const [reminder, indoor] = await Promise.all([
      this.prisma.hydrationReminder.findFirst({
        where: {
          homeId: home.id,
          scheduledFor: { lte: now },
          expiresAt: { gt: now },
        },
        orderBy: { scheduledFor: 'desc' },
      }),
      this.currentIndoor(home.id, now),
    ]);
    const outdoorFresh =
      forecast && now.getTime() - new Date(forecast.fetchedAt).getTime() <= OUTDOOR_FRESH_MS;
    return {
      active: true,
      tip: heatwaveTip({
        settings,
        minute: heatwaveLocalClock(now, home.timezone).minute,
        outdoor: outdoorFresh ? forecast.outdoorNow : null,
        indoor,
      }),
      reminder: reminder
        ? {
            id: reminder.id,
            scheduledFor: reminder.scheduledFor.toISOString(),
            expiresAt: reminder.expiresAt.toISOString(),
          }
        : null,
    };
  }

  /** Warmest current reading among the rooms whose sensor spoke recently. */
  private async currentIndoor(homeId: string, now: Date): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ value: number | null }>>`
      SELECT MAX((latest.payload->>'value')::double precision) AS value
      FROM "Sensor" s
      JOIN LATERAL (
        SELECT e.payload, e."occurredAt" FROM "ObservationEvent" e
        WHERE e."sensorId" = s.id AND e.capability = 'temperature' AND e.quality = 'good'
          AND e."occurredAt" <= ${now}
        ORDER BY e."occurredAt" DESC LIMIT 1
      ) latest ON true
      WHERE s."homeId" = ${homeId} AND s.capability = 'temperature'
        AND s."analysisEnabled" = true AND s."removedAt" IS NULL
        AND latest."occurredAt" >= ${new Date(now.getTime() - HEATWAVE_FRESH_MINUTES * 60_000)}
        AND jsonb_typeof(latest.payload->'value') = 'number'`;
    const value = rows[0]?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private async indoor(
    homeId: string,
    dayStart: Date,
    now: Date,
  ): Promise<HeatwaveStatus['indoor']> {
    const [sensors, warmest, current] = await Promise.all([
      this.prisma.sensor.count({
        where: {
          homeId,
          capability: 'temperature',
          analysisEnabled: true,
          removedAt: null,
          roomId: { not: null },
        },
      }),
      this.prisma.$queryRaw<Array<{ value: number; roomName: string | null }>>`
        SELECT (e.payload->>'value')::double precision AS value, r.name AS "roomName"
        FROM "ObservationEvent" e
        JOIN "Sensor" s ON s.id = e."sensorId"
        LEFT JOIN "Room" r ON r.id = s."roomId"
        WHERE e."homeId" = ${homeId} AND e.capability = 'temperature' AND e.quality = 'good'
          AND s."analysisEnabled" = true AND s."removedAt" IS NULL
          AND e."occurredAt" >= ${dayStart} AND e."occurredAt" <= ${now}
          AND jsonb_typeof(e.payload->'value') = 'number'
          AND (e.payload->>'value')::double precision BETWEEN -10 AND 60
        ORDER BY value DESC LIMIT 1`,
      this.currentIndoor(homeId, now),
    ]);
    return {
      sensors,
      current,
      maxToday: warmest[0]?.value ?? null,
      maxTodayRoom: warmest[0]?.roomName ?? null,
    };
  }

  private async homeFor(userId: string, roles?: MembershipRole[]): Promise<HomeAccess> {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: { userId, disabledAt: null, ...(roles ? { systemRole: { in: roles } } : {}) },
          },
        },
      },
      select: {
        id: true,
        timezone: true,
        organization: {
          select: {
            memberships: {
              where: { userId, disabledAt: null },
              select: { systemRole: true },
              take: 1,
            },
          },
        },
      },
    });
    const role = home?.organization.memberships[0]?.systemRole;
    if (!home || !role) throw new ForbiddenException('Heatwave access denied');
    return { id: home.id, timezone: home.timezone, role };
  }

  private async homeForToken(token: string): Promise<{ id: string; timezone: string }> {
    if (!token) throw new UnauthorizedException();
    const screen = await this.prisma.residentScreen.findUnique({
      where: { tokenHash: hash(token) },
      select: { home: { select: { id: true, timezone: true } } },
    });
    if (!screen) throw new UnauthorizedException();
    return screen.home;
  }
}
