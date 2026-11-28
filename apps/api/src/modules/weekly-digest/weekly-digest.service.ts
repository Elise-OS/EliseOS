import {
  LIFE_ACTIVITY_CAPABILITIES,
  WEEKLY_DIGEST_BASELINE_WEEKS,
  buildWeeklyDigest,
  buildWeeklyDigestPdf,
  digestLocalClock,
  digestShiftDate,
  digestWeekClosed,
  digestWeekStart,
  digestZonedTime,
  emptyWeeklyDigestMetrics,
  homePlanSchema,
  latestDigestWeek,
  parseWeeklyDigestMetrics,
  weeklyDigestPdfName,
  type HomePlan,
  type WeeklyDigest,
  type WeeklyDigestContext,
  type WeeklyDigestLanguage,
  type WeeklyDigestMeal,
  type WeeklyDigestMetrics,
  type WeeklyDigestSensorIssue,
} from '@elise/contracts';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership } from '../auth/access-policy';
import { computeWeekMetrics } from './week-metrics';

const DAY = 86_400_000;
/** Raw events are deleted after 90 days (worker retention): older weeks need their snapshot. */
const RAW_RETENTION_DAYS = 89;
/** The TV keeps 30 days of call history. */
const CALL_HISTORY_DAYS = 30;
const DIGEST_CAPABILITIES = ['contact', 'dry_contact', 'motion', 'occupancy', 'person_presence'];
const WATCHED_CAPABILITIES = new Set<string>([
  ...LIFE_ACTIVITY_CAPABILITIES,
  'contact',
  'dry_contact',
  'water_leak',
  'smoke',
  'carbon_monoxide',
  'button',
]);
const MEAL_HABITS: Record<string, WeeklyDigestMeal> = {
  BREAKFAST: 'BREAKFAST',
  LUNCH: 'LUNCH',
  DINNER: 'DINNER',
};

type DigestHome = {
  id: string;
  timezone: string;
  createdAt: Date;
  residentName: string | null;
  residentFullName: string | null;
  residentId: string | null;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Weekly digest of the notebook. Computed on the box, without Internet, for the week from Monday
 * to Sunday; ready on Sunday evening. Every member of the household who can read the notebook can
 * read it and export it as a PDF, made here with jsPDF (pure JavaScript, no browser).
 */
@Injectable()
export class WeeklyDigestService {
  public constructor(private readonly prisma: PrismaService) {}

  private async home(userId: string): Promise<DigestHome> {
    const home = await this.prisma.home.findFirst({
      where: { organization: { memberships: { some: activeMembership(userId) } } },
      select: {
        id: true,
        timezone: true,
        createdAt: true,
        primaryResident: {
          select: { id: true, firstName: true, preferredName: true, displayName: true },
        },
      },
    });
    if (!home) throw new ForbiddenException('Access denied');
    const resident = home.primaryResident;
    return {
      id: home.id,
      timezone: home.timezone,
      createdAt: home.createdAt,
      residentId: resident?.id ?? null,
      residentName:
        resident?.firstName?.trim() ||
        resident?.preferredName?.trim().split(/\s+/)[0] ||
        resident?.displayName.trim().split(/\s+/)[0] ||
        null,
      residentFullName: resident?.displayName.trim() || null,
    };
  }

  public async digest(userId: string, week?: string, now = new Date()): Promise<WeeklyDigest> {
    return this.build(await this.home(userId), week, now);
  }

  public async pdf(
    userId: string,
    week: string | undefined,
    language: WeeklyDigestLanguage,
    now = new Date(),
  ): Promise<{ fileName: string; bytes: Uint8Array }> {
    const home = await this.home(userId);
    const digest = await this.build(home, week, now);
    const bytes = buildWeeklyDigestPdf((options) => new jsPDF(options), digest, {
      language,
      personName: home.residentFullName,
      generatedAt: now,
    });
    return { fileName: weeklyDigestPdfName(digest.weekStart, language), bytes };
  }

  private async build(home: DigestHome, week: string | undefined, now: Date) {
    const latest = latestDigestWeek(now, home.timezone);
    const weekStart = week ? digestWeekStart(week) : latest;
    const earliest = digestWeekStart(digestLocalClock(home.createdAt, home.timezone).dateKey);
    if (weekStart > latest) throw new NotFoundException('Ce bilan sera prêt dimanche soir.');
    if (weekStart < earliest) throw new NotFoundException('Aucun bilan pour cette semaine.');
    const baselineWeeks = Array.from({ length: WEEKLY_DIGEST_BASELINE_WEEKS }, (_, index) =>
      digestShiftDate(weekStart, -7 * (index + 1)),
    ).filter((value) => value >= earliest);
    const metrics = await this.metrics(home, weekStart, now);
    const baseline: WeeklyDigestMetrics[] = [];
    for (const value of baselineWeeks) baseline.push(await this.metrics(home, value, now));
    const context = await this.context(home, weekStart, now, {
      previousWeek: weekStart > earliest ? digestShiftDate(weekStart, -7) : null,
      nextWeek: weekStart < latest ? digestShiftDate(weekStart, 7) : null,
    });
    return buildWeeklyDigest(context, metrics, baseline);
  }

  /** Measures of a week: from its snapshot once the week is over, from the raw events otherwise. */
  private async metrics(home: DigestHome, weekStart: string, now: Date) {
    const stored = await this.prisma.weeklyDigestSnapshot.findUnique({
      where: { homeId_weekStart: { homeId: home.id, weekStart } },
      select: { metrics: true },
    });
    const parsed = parseWeeklyDigestMetrics(stored?.metrics);
    if (parsed) return parsed;
    const from = digestZonedTime(weekStart, 0, home.timezone);
    // Raw events of that week are gone: say so rather than show a half-empty week.
    if (now.getTime() - from.getTime() > RAW_RETENTION_DAYS * DAY)
      return emptyWeeklyDigestMetrics(weekStart);
    const metrics = await this.computeMetrics(home, weekStart, now);
    if (digestWeekClosed(weekStart, now, home.timezone))
      await this.prisma.weeklyDigestSnapshot.upsert({
        where: { homeId_weekStart: { homeId: home.id, weekStart } },
        create: { homeId: home.id, weekStart, metrics: json(metrics) },
        update: { metrics: json(metrics) },
      });
    return metrics;
  }

  private async computeMetrics(
    home: DigestHome,
    weekStart: string,
    now: Date,
  ): Promise<WeeklyDigestMetrics> {
    const from = digestZonedTime(weekStart, 0, home.timezone);
    const to = digestZonedTime(digestShiftDate(weekStart, 7), 0, home.timezone);
    const until = new Date(Math.min(now.getTime(), to.getTime()));
    // The night of Sunday to Monday starts the evening before the week.
    const lookback = new Date(from.getTime() - 6 * 60 * 60_000);
    const [
      sensors,
      rooms,
      storedPlan,
      events,
      priorStates,
      deviceDays,
      homeDays,
      sessions,
      screen,
      habits,
    ] = await Promise.all([
      this.prisma.sensor.findMany({
        where: { homeId: home.id, analysisEnabled: true, removedAt: null },
        include: { device: { select: { model: true, lastSeenAt: true } } },
      }),
      this.prisma.room.findMany({
        where: { homeId: home.id },
        select: { id: true, name: true, kind: true },
      }),
      this.prisma.homePlan.findUnique({ where: { homeId: home.id } }),
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          capability: { in: DIGEST_CAPABILITIES },
          occurredAt: { gte: lookback, lte: until },
          sensor: { analysisEnabled: true },
        },
        select: {
          id: true,
          sensorId: true,
          roomId: true,
          capability: true,
          payload: true,
          quality: true,
          occurredAt: true,
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          capability: { in: DIGEST_CAPABILITIES },
          occurredAt: { lt: lookback },
          sensor: { analysisEnabled: true },
        },
        distinct: ['sensorId'],
        orderBy: { occurredAt: 'desc' },
        select: {
          id: true,
          sensorId: true,
          roomId: true,
          capability: true,
          payload: true,
          quality: true,
          occurredAt: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ key: string; day: string }>>`
          SELECT COALESCE(s."deviceId", s.id) AS key,
                 to_char(e."occurredAt" AT TIME ZONE ${home.timezone}, 'YYYY-MM-DD') AS day
          FROM "ObservationEvent" e
          JOIN "Sensor" s ON s.id = e."sensorId"
          WHERE e."homeId" = ${home.id} AND e."occurredAt" >= ${lookback} AND e."occurredAt" < ${until}
          GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ day: string }>>`
          SELECT DISTINCT to_char("occurredAt" AT TIME ZONE ${home.timezone}, 'YYYY-MM-DD') AS day
          FROM "ObservationEvent"
          WHERE "homeId" = ${home.id} AND "occurredAt" >= ${from} AND "occurredAt" < ${until}`,
      this.prisma.roomPresenceSession.findMany({
        where: {
          homeId: home.id,
          ambiguousReason: 'SIMULTANEOUS_ROOMS',
          startedAt: { gte: from, lt: until },
        },
        select: { startedAt: true },
      }),
      this.prisma.residentScreen.findUnique({
        where: { homeId: home.id },
        select: { state: true },
      }),
      home.residentId
        ? this.prisma.habitProfile.findMany({
            where: { residentId: home.residentId, kind: { in: Object.keys(MEAL_HABITS) } },
            select: { kind: true, startMinute: true, endMinute: true },
          })
        : Promise.resolve([]),
    ]);
    const parsedPlan = homePlanSchema.safeParse(storedPlan?.data);
    const plan: HomePlan | null = parsedPlan.success ? parsedPlan.data : null;
    const devices = new Map<string, Set<string>>();
    for (const row of deviceDays) {
      const set = devices.get(row.key) ?? new Set<string>();
      set.add(row.day);
      devices.set(row.key, set);
    }
    const history = (screen?.state as { history?: unknown } | null)?.history;
    const callsKnown =
      Array.isArray(history) && now.getTime() - from.getTime() <= CALL_HISTORY_DAYS * DAY;
    const mealHabits: Partial<
      Record<WeeklyDigestMeal, { startMinute: number; endMinute: number }>
    > = {};
    for (const habit of habits) {
      const meal = MEAL_HABITS[habit.kind];
      if (meal && habit.startMinute !== null && habit.endMinute !== null)
        mealHabits[meal] = { startMinute: habit.startMinute, endMinute: habit.endMinute };
    }
    return computeWeekMetrics({
      weekStart,
      timezone: home.timezone,
      now,
      sensors: sensors.map((sensor) => ({ ...sensor, events: [] })),
      events: events,
      priorStates: priorStates,
      plan,
      rooms,
      homeDays: new Set(homeDays.map((row) => row.day)),
      deviceDays: devices,
      simultaneousPresence: sessions.map((session) => session.startedAt),
      calls: callsKnown
        ? (history as unknown[]).flatMap((item) => {
            const call = item as Record<string, unknown>;
            return typeof call.startedAt === 'number' &&
              typeof call.endedAt === 'number' &&
              typeof call.result === 'string'
              ? [{ startedAt: call.startedAt, endedAt: call.endedAt, result: call.result }]
              : [];
          })
        : null,
      mealHabits,
    });
  }

  /** Calendar, alerts and sensor health of the week. */
  private async context(
    home: DigestHome,
    weekStart: string,
    now: Date,
    navigation: { previousWeek: string | null; nextWeek: string | null },
  ): Promise<WeeklyDigestContext> {
    const from = digestZonedTime(weekStart, 0, home.timezone);
    const to = digestZonedTime(digestShiftDate(weekStart, 7), 0, home.timezone);
    const until = new Date(Math.min(now.getTime(), to.getTime()));
    const [visits, appointments, alerts, sensors, silent] = await Promise.all([
      this.prisma.visit.findMany({
        where: { homeId: home.id, startsAt: { gte: from, lt: to } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, visitorName: true, startsAt: true, completedAt: true },
      }),
      this.prisma.appointment.findMany({
        where: { homeId: home.id, startsAt: { gte: from, lt: to } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, title: true, startsAt: true },
      }),
      this.prisma.alert.findMany({
        where: { homeId: home.id, openedAt: { gte: from, lt: to } },
        orderBy: { openedAt: 'asc' },
        select: {
          id: true,
          openedAt: true,
          title: true,
          severity: true,
          type: true,
          status: true,
          ruleKey: true,
          room: { select: { name: true } },
        },
      }),
      this.prisma.sensor.findMany({
        where: { homeId: home.id, analysisEnabled: true, removedAt: null },
        select: {
          id: true,
          deviceId: true,
          entityId: true,
          capability: true,
          status: true,
          available: true,
          sourceName: true,
          lastSeenAt: true,
          unavailableSince: true,
          createdAt: true,
          room: { select: { name: true } },
          device: { select: { name: true, displayName: true, lastSeenAt: true } },
        },
      }),
      this.prisma.$queryRaw<Array<{ key: string }>>`
        SELECT DISTINCT COALESCE(s."deviceId", s.id) AS key
        FROM "ObservationEvent" e
        JOIN "Sensor" s ON s.id = e."sensorId"
        WHERE e."homeId" = ${home.id} AND e."occurredAt" >= ${from} AND e."occurredAt" < ${until}`,
    ]);
    const heard = new Set(silent.map((row) => row.key));
    const issues = new Map<string, WeeklyDigestSensorIssue>();
    const weekLongEnough = until.getTime() - from.getTime() >= 3 * DAY;
    const nameOf = (sensor: (typeof sensors)[number]) =>
      sensor.device?.displayName?.trim() ||
      sensor.device?.name?.trim() ||
      sensor.sourceName?.trim() ||
      sensor.entityId;
    const byId = new Map(sensors.map((sensor) => [sensor.id, sensor]));
    // Sensor alerts of the week: what went wrong, even if it works again now.
    for (const alert of alerts) {
      if (alert.type !== 'LOW_BATTERY' && alert.type !== 'SENSOR_OFFLINE') continue;
      const sensor = byId.get(alert.ruleKey?.split(':')[1] ?? '');
      const key = sensor ? (sensor.deviceId ?? sensor.id) : `alert:${alert.id}`;
      const kind = alert.type === 'LOW_BATTERY' ? 'LOW_BATTERY' : 'OFFLINE';
      const existing = issues.get(key);
      if (existing && (existing.kind === 'OFFLINE' || kind === 'LOW_BATTERY')) continue;
      issues.set(key, {
        id: key,
        name: sensor ? nameOf(sensor) : alert.title,
        roomName: sensor?.room?.name ?? alert.room?.name ?? null,
        kind,
        since: alert.openedAt.toISOString(),
      });
    }
    for (const sensor of sensors) {
      if (!WATCHED_CAPABILITIES.has(sensor.capability)) continue;
      const key = sensor.deviceId ?? sensor.id;
      if (issues.get(key)?.kind === 'OFFLINE') continue;
      const lastSeen = sensor.device?.lastSeenAt ?? sensor.lastSeenAt;
      const offline = !sensor.available || sensor.status === 'OFFLINE';
      if (offline && (!lastSeen || lastSeen < until)) {
        issues.set(key, {
          id: key,
          name: nameOf(sensor),
          roomName: sensor.room?.name ?? null,
          kind: 'OFFLINE',
          since: (sensor.unavailableSince ?? lastSeen)?.toISOString() ?? null,
        });
      } else if (weekLongEnough && sensor.createdAt < from && !heard.has(key) && !issues.has(key)) {
        // Not a single message all week, not even its battery level: the sensor was silent.
        issues.set(key, {
          id: key,
          name: nameOf(sensor),
          roomName: sensor.room?.name ?? null,
          kind: 'NO_SIGNAL',
          since: null,
        });
      }
    }
    return {
      weekStart,
      timezone: home.timezone,
      residentName: home.residentName,
      generatedAt: now.toISOString(),
      ...navigation,
      visits: visits.map((visit) => ({
        id: visit.id,
        name: visit.visitorName,
        startsAt: visit.startsAt.toISOString(),
        confirmed: visit.completedAt !== null,
      })),
      appointments: appointments.map((item) => ({
        id: item.id,
        title: item.title,
        startsAt: item.startsAt.toISOString(),
      })),
      alerts: alerts.map((alert) => ({
        id: alert.id,
        openedAt: alert.openedAt.toISOString(),
        title: alert.title,
        severity: alert.severity,
        type: alert.type,
        status: alert.status,
      })),
      sensorIssues: [...issues.values()],
    };
  }
}
