import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  homePlanSchema,
  liaisonMoodLabel,
  type DashboardPeriod,
  type HomeSummary,
  type PresenceEstimate,
  type HomePlan,
} from '@michel/contracts';
import { Prisma, type ObservationEvent } from '@prisma/client';
import { buildEntranceSummary, ENTRANCE_WINDOW_MS } from './entrance-summary';
import { buildHomeCards, buildSleepSummary, latestPresenceEvidence } from './home-summary';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership, rolesFor } from '../auth/access-policy';

const HOME_EDIT_ROLES = rolesFor('configuration:manage');

const ACTIVITY_CAPABILITIES = [
  'motion',
  'occupancy',
  'person_presence',
  'contact',
  'dry_contact',
  'button',
];
const LIFE_CAPABILITIES = new Set([
  'motion',
  'occupancy',
  'person_presence',
  'contact',
  'dry_contact',
]);
const ENVIRONMENT_CAPABILITIES = new Set([
  'temperature',
  'humidity',
  'power',
  'energy',
  'switch',
  'current',
  'voltage',
  'battery',
  'co2',
  'voc',
  'pm25',
  'air_quality',
  'illuminance',
  'signal_strength',
]);
const SAFETY_CAPABILITIES = new Set([
  'button',
  'water_leak',
  'smoke',
  'carbon_monoxide',
  'fall_detection',
  'vibration',
]);
const SEQUENCE_CAPABILITIES = new Set([...LIFE_CAPABILITIES, ...SAFETY_CAPABILITIES]);
const MAX_SEQUENCE_EVENTS = 500;
const MAX_EVENTS_PER_SEQUENCE = 30;
const SEQUENCE_GAP_MS = 20 * 60_000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function minuteOfDay(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(value);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return number('hour') * 60 + number('minute');
}

function localDateKey(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(value);
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function zonedMidnight(value: string, timezone: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const desired = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  let timestamp = desired;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).formatToParts(new Date(timestamp));
    const number = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(
      number('year'),
      number('month') - 1,
      number('day'),
      number('hour'),
      number('minute'),
      number('second'),
    );
    const difference = desired - represented;
    timestamp += difference;
    if (difference === 0) break;
  }
  return new Date(timestamp);
}

function formatLocalTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(value);
}

function activityWindow(
  period: DashboardPeriod,
  selectedDate: string | undefined,
  timezone: string,
  now: Date,
) {
  const today = localDateKey(now, timezone);
  const endDate = selectedDate ?? today;
  const dayCount = period === '24h' ? 1 : period === '7d' ? 7 : 28;
  const fromDate = shiftDateKey(endDate, -(dayCount - 1));
  const from = zonedMidnight(fromDate, timezone);
  const selectedEnd = zonedMidnight(shiftDateKey(endDate, 1), timezone);
  const to = endDate === today ? now : selectedEnd;
  const buckets: Array<{ start: Date; end: Date; label: string }> = [];

  if (period === '24h') {
    for (let start = from; start < to; start = new Date(start.getTime() + 3_600_000)) {
      const end = new Date(Math.min(to.getTime(), start.getTime() + 3_600_000));
      buckets.push({
        start,
        end,
        label: new Intl.DateTimeFormat('fr-FR', {
          hour: '2-digit',
          timeZone: timezone,
        }).format(start),
      });
    }
  } else {
    for (let index = 0; index < dayCount; index += 1) {
      const key = shiftDateKey(fromDate, index);
      const start = zonedMidnight(key, timezone);
      const next = zonedMidnight(shiftDateKey(key, 1), timezone);
      if (start >= to) break;
      buckets.push({
        start,
        end: new Date(Math.min(to.getTime(), next.getTime())),
        label: new Intl.DateTimeFormat('fr-FR', {
          weekday: 'short',
          timeZone: timezone,
        }).format(start),
      });
    }
  }

  return { from, to, buckets };
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function numericPayload(payload: unknown): number | null {
  const record = payloadRecord(payload);
  const raw = record.value ?? record.state;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

function displayPayload(payload: unknown): string {
  const record = payloadRecord(payload);
  const raw = record.value ?? record.state;
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'boolean') return raw ? 'Actif' : 'Inactif';
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
  return '—';
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const interval of intervals.sort((left, right) => left[0] - right[0])) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval] as [number, number]);
  }
  return merged;
}

@Injectable()
export class ActivityService {
  public constructor(private readonly prisma: PrismaService) {}

  private async homeFor(userId: string, roles?: readonly (typeof HOME_EDIT_ROLES)[number][]) {
    return this.prisma.home.findFirst({
      where: { organization: { memberships: { some: activeMembership(userId, roles) } } },
      include: {
        primaryResident: { include: { supportNeeds: true, habits: true } },
        rooms: true,
      },
    });
  }

  public async homeSummary(userId: string, presence: PresenceEstimate): Promise<HomeSummary> {
    const home = await this.homeFor(userId);
    if (!home) throw new ForbiddenException();
    const { from, to } = activityWindow('24h', undefined, home.timezone, new Date());
    const lookback = new Date(from.getTime() - 2 * ENTRANCE_WINDOW_MS);
    const sleepLookback = new Date(from.getTime() - 12 * 60 * 60_000);
    const [
      sensors,
      events,
      storedPlan,
      alerts,
      revision,
      priorStates,
      sleepEvents,
      priorSleepStates,
    ] = await Promise.all([
      this.prisma.sensor.findMany({
        where: { homeId: home.id, analysisEnabled: true, removedAt: null },
        include: {
          device: { select: { model: true, lastSeenAt: true } },
          events: { orderBy: { occurredAt: 'desc' }, take: 1, where: { occurredAt: { lte: to } } },
        },
      }),
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          occurredAt: { gte: lookback, lte: to },
          sensor: { analysisEnabled: true, removedAt: null },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.homePlan.findUnique({ where: { homeId: home.id } }),
      this.prisma.alert.findMany({
        where: { homeId: home.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.configurationRevision.findFirst({
        where: { homeId: home.id },
        orderBy: { version: 'desc' },
        select: { settings: true },
      }),
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          capability: 'contact',
          occurredAt: { lt: lookback },
          sensor: { analysisEnabled: true, removedAt: null },
        },
        distinct: ['sensorId'],
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          capability: { in: ['contact', 'dry_contact'] },
          occurredAt: { gte: sleepLookback, lte: to },
          sensor: { analysisEnabled: true, removedAt: null },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          capability: { in: ['contact', 'dry_contact'] },
          occurredAt: { lt: sleepLookback },
          sensor: { analysisEnabled: true, removedAt: null },
        },
        distinct: ['sensorId'],
        orderBy: { occurredAt: 'desc' },
      }),
    ]);
    const parsed = homePlanSchema.safeParse(storedPlan?.data);
    const settings = revision?.settings as Record<string, unknown> | undefined;
    const parsedRules = alertRuleSettingsSchema.safeParse(settings?.alertRules);
    const rules = parsedRules.success ? parsedRules.data : DEFAULT_ALERT_RULE_SETTINGS;
    const facts = buildHomeCards(
      sensors,
      events.filter((e) => e.occurredAt >= from),
      parsed.success ? parsed.data : null,
      home.rooms,
      rules,
      to,
    );
    const sleep = buildSleepSummary(
      sensors,
      sleepEvents,
      priorSleepStates,
      parsed.success ? parsed.data : null,
      home.rooms,
      home.timezone,
      to,
    );
    const entrance = buildEntranceSummary(
      sensors,
      events,
      parsed.success ? parsed.data : null,
      to,
      priorStates,
    );
    const latestPresenceEvent = latestPresenceEvidence(sensors, events, to);
    const enabledIds = new Set(
      sensors.filter((s) => s.available && s.status === 'ONLINE').map((s) => s.id),
    );
    const confirmedEvidence = presence.evidenceSummary
      .filter((e) => e.roomId === presence.confirmedRoomId && e.observed !== false)
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))[0];
    if (presence.trackingState === 'CONFIRMED' && confirmedEvidence?.sensorId) {
      presence = {
        ...presence,
        trackingDegraded: !enabledIds.has(confirmedEvidence.sensorId),
      };
    } else if (presence.evidenceSummary.some((e) => e.sensorId && !enabledIds.has(e.sensorId))) {
      presence = { ...presence, trackingDegraded: true };
    }
    const alert =
      alerts.find((a) => a.severity === 'URGENT') ??
      alerts.find((a) => a.severity === 'ATTENTION') ??
      alerts[0];
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: home.timezone,
      residentName:
        home.primaryResident?.preferredName ?? home.primaryResident?.displayName ?? 'Le résident',
      presence,
      rooms: home.rooms.map(({ id, name, kind }) => ({ id, name, kind })),
      ...facts,
      sleep,
      latestPresence: latestPresenceEvent
        ? {
            roomId: latestPresenceEvent.roomId!,
            occurredAt: latestPresenceEvent.occurredAt.toISOString(),
            capability: latestPresenceEvent.capability as
              'motion' | 'occupancy' | 'person_presence',
          }
        : null,
      entrance,
      alert: alert
        ? {
            id: alert.id,
            title: alert.title,
            severity: alert.severity,
            roomName: home.rooms.find((room) => room.id === alert.roomId)?.name ?? null,
          }
        : null,
    };
  }

  public async overview(userId: string) {
    const home = await this.homeFor(userId);
    if (!home) return { onboardingRequired: true };
    const now = new Date();
    const [currentUser, lastEvent, openAlerts, sensors, recent, nextVisit, nextAppointment] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        this.prisma.observationEvent.findFirst({
          where: { homeId: home.id, sensor: { analysisEnabled: true } },
          orderBy: { occurredAt: 'desc' },
          include: { sensor: { include: { room: true } } },
        }),
        this.prisma.alert.count({
          where: { homeId: home.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        }),
        this.prisma.sensor.findMany({
          where: { homeId: home.id, analysisEnabled: true },
          include: { room: true },
          orderBy: { lastSeenAt: 'desc' },
        }),
        this.prisma.observationEvent.findMany({
          where: {
            homeId: home.id,
            capability: { not: 'illuminance' },
            sensor: { analysisEnabled: true },
          },
          orderBy: { occurredAt: 'desc' },
          take: 8,
          include: { sensor: { include: { room: true } } },
        }),
        this.prisma.visit.findFirst({
          where: { homeId: home.id, startsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
        }),
        this.prisma.appointment.findFirst({
          where: { homeId: home.id, startsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
        }),
      ]);
    const learningDays = home.learningStartedAt
      ? Math.floor((Date.now() - home.learningStartedAt.getTime()) / 86_400_000)
      : 0;
    const insufficientCoverage =
      sensors.length === 0 ||
      sensors.some((sensor) => ['OFFLINE', 'DEGRADED', 'UNKNOWN'].includes(sensor.status));
    const upcoming = [
      nextVisit
        ? {
            id: nextVisit.id,
            type: 'VISIT' as const,
            title: nextVisit.visitorName,
            startsAt: nextVisit.startsAt,
          }
        : null,
      nextAppointment
        ? {
            id: nextAppointment.id,
            type: 'APPOINTMENT' as const,
            title: nextAppointment.title,
            startsAt: nextAppointment.startsAt,
          }
        : null,
    ]
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    return {
      onboardingRequired: false,
      currentUser: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        firstName: currentUser.displayName.split(' ')[0] ?? currentUser.displayName,
      },
      home: {
        id: home.id,
        name: home.name,
        type: home.type,
        resident: home.primaryResident?.displayName ?? null,
      },
      resident: home.primaryResident
        ? {
            id: home.primaryResident.id,
            displayName: home.primaryResident.displayName,
            preferredName: home.primaryResident.preferredName ?? home.primaryResident.displayName,
            photoUrl: home.primaryResident.photoPath
              ? `/api/v1/residents/${home.primaryResident.id}/photo`
              : null,
            supportNeeds: home.primaryResident.supportNeeds.map((need) => need.kind),
            knownHabits: home.primaryResident.habits.filter((habit) => habit.status !== 'UNKNOWN')
              .length,
          }
        : null,
      reassurance: insufficientCoverage
        ? 'INSUFFICIENT_DATA'
        : openAlerts > 0
          ? 'ATTENTION'
          : learningDays < 14
            ? 'LEARNING'
            : 'NORMAL',
      learningDays: Math.min(learningDays, 14),
      openAlerts,
      sensors: {
        total: sensors.length,
        online: sensors.filter((sensor) => sensor.status === 'ONLINE').length,
        degraded: sensors.filter((sensor) => sensor.status === 'DEGRADED').length,
        offline: sensors.filter((sensor) => sensor.status === 'OFFLINE').length,
      },
      nextSchedule: upcoming ? { ...upcoming, startsAt: upcoming.startsAt.toISOString() } : null,
      lastActivity: lastEvent
        ? {
            occurredAt: lastEvent.occurredAt,
            capability: lastEvent.capability,
            room: lastEvent.sensor?.room?.name ?? null,
          }
        : null,
      rooms: home.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        kind: room.kind,
        sensors: sensors.filter((sensor) => sensor.roomId === room.id).length,
      })),
      activity: recent.map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt,
        capability: event.capability,
        room: event.sensor?.room?.name ?? 'Maison',
        payload: event.payload,
      })),
    };
  }

  public async updateHome(
    userId: string,
    input: { name: string; type: string; address: string; timezone: string },
  ) {
    const home = await this.homeFor(userId, HOME_EDIT_ROLES);
    if (!home) throw new ForbiddenException('Home unavailable');
    return this.prisma.home.update({
      where: { id: home.id },
      data: {
        name: input.name,
        type: input.type,
        address: input.address || null,
        timezone: input.timezone,
      },
      select: { id: true, name: true, type: true, address: true, timezone: true, floorCount: true },
    });
  }

  public async summary(userId: string, period: DashboardPeriod, selectedDate?: string) {
    const home = await this.homeFor(userId);
    if (!home)
      return {
        period,
        from: new Date().toISOString(),
        to: new Date().toISOString(),
        total: 0,
        buckets: [],
        byRoom: [],
        byCapability: [],
        dwellByRoom: [],
        unknownSeconds: 0,
        reliableBuckets: [],
        observedSeconds: 0,
        unobservedSeconds: 0,
        lastReliableActivity: null,
        rooms: [],
        sequences: [],
        hasMoreSequences: false,
      };
    const {
      from,
      to,
      buckets: bucketWindows,
    } = activityWindow(period, selectedDate, home.timezone, new Date());
    const [events, sessions, sensors, cameras, storedPlan] = await Promise.all([
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          occurredAt: { gte: from, lte: to },
        },
        orderBy: { occurredAt: 'asc' },
        include: { room: true, sensor: { include: { room: true, device: true } } },
      }),
      this.prisma.roomPresenceSession.findMany({
        where: {
          homeId: home.id,
          startedAt: { lte: to },
          OR: [{ endedAt: { gte: from } }, { endedAt: null }],
        },
        include: { room: true },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.sensor.findMany({
        where: { homeId: home.id, analysisEnabled: true, removedAt: null },
        include: { room: true, device: true },
      }),
      this.prisma.camera.findMany({
        where: { homeId: home.id },
        select: { personEntityId: true, deviceId: true },
      }),
      this.prisma.homePlan.findUnique({ where: { homeId: home.id } }),
    ]);
    const parsedPlan = storedPlan ? homePlanSchema.safeParse(storedPlan.data) : null;
    const plan: HomePlan | null = parsedPlan?.success ? parsedPlan.data : null;
    const cameraEntityIds = new Set(cameras.flatMap(({ personEntityId }) => personEntityId ?? []));
    const cameraDeviceIds = new Set(cameras.flatMap(({ deviceId }) => deviceId ?? []));
    const roomNames = new Map(home.rooms.map((room) => [room.id, room.name]));
    const levels = plan?.levels ?? [];
    const stairs = new Map(
      levels.flatMap((level) => level.stairs).map((stair) => [stair.id, stair] as const),
    );
    const levelNames = new Map(levels.map((level) => [level.id, level.name] as const));
    const placements = plan?.placements.filter(({ kind }) => kind === 'SENSOR') ?? [];
    const targetTypes = new Set(['ROOM', 'ITEM', 'OPENING', 'STAIR']);

    const normalizedEvents = events.flatMap((event) => {
      if (
        cameraEntityIds.has(event.sensor?.entityId ?? '') ||
        cameraDeviceIds.has(event.sensor?.deviceId ?? '')
      )
        return [];
      const payload = payloadRecord(event.payload);
      const context = payloadRecord(payload.context);
      const roomId =
        event.room?.id ??
        event.roomId ??
        event.sensor?.room?.id ??
        (typeof context.roomId === 'string' ? context.roomId : null);
      if (!roomId || !roomNames.has(roomId)) return [];
      const rawTargetType = typeof context.targetType === 'string' ? context.targetType : null;
      const targetType = rawTargetType && targetTypes.has(rawTargetType) ? rawTargetType : null;
      const targetId = typeof context.targetId === 'string' ? context.targetId : null;
      const stair = targetType === 'STAIR' && targetId ? stairs.get(targetId) : null;
      const passage = stair
        ? {
            fromLevelId: stair.fromFloorId,
            fromLevelName: levelNames.get(stair.fromFloorId) ?? stair.fromFloorId,
            toLevelId: stair.toFloorId,
            toLevelName: levelNames.get(stair.toFloorId) ?? stair.toFloorId,
          }
        : null;
      return [
        {
          id: event.id,
          occurredAt: event.occurredAt.toISOString(),
          capability: event.capability,
          quality: event.quality,
          payload: event.payload,
          roomId,
          roomName: roomNames.get(roomId)!,
          sensorId: event.sensorId ?? event.sensor?.id ?? null,
          sensorName:
            event.sensor?.device?.displayName ??
            event.sensor?.device?.name ??
            event.sensor?.sourceName ??
            null,
          sensorStatus: event.sensor?.status ?? null,
          unit: event.sensor?.unit ?? (typeof payload.unit === 'string' ? payload.unit : null),
          targetType: targetType as 'ROOM' | 'ITEM' | 'OPENING' | 'STAIR' | null,
          targetId,
          passage,
        },
      ];
    });
    const usefulEvents = normalizedEvents.filter(({ capability }) =>
      ACTIVITY_CAPABILITIES.includes(capability),
    );
    const buckets = bucketWindows.map(({ start, end, label }) => ({
      start: start.toISOString(),
      label,
      count: usefulEvents.filter(({ occurredAt }) => {
        const timestamp = new Date(occurredAt);
        return timestamp >= start && timestamp < end;
      }).length,
    }));
    const roomCounts = new Map<string, { id: string | null; name: string; count: number }>();
    const capabilityCounts = new Map<string, number>();
    for (const event of usefulEvents) {
      const current = roomCounts.get(event.roomId) ?? {
        id: event.roomId,
        name: event.roomName,
        count: 0,
      };
      current.count += 1;
      roomCounts.set(event.roomId, current);
      capabilityCounts.set(event.capability, (capabilityCounts.get(event.capability) ?? 0) + 1);
    }
    const dwell = new Map<
      string,
      {
        id: string;
        name: string;
        durations: number[];
        totalSeconds: number;
        reliableSessions: number;
        ambiguousSeconds: number;
      }
    >();
    const intervals: Array<[number, number]> = [];
    const reliableIntervals: Array<{ start: number; end: number; roomId: string }> = [];
    const sensorSessions = sessions.filter((session) => session.source !== 'CAMERA');
    for (const session of sensorSessions) {
      const start = Math.max(from.getTime(), session.startedAt.getTime());
      const end = Math.min(to.getTime(), session.endedAt?.getTime() ?? to.getTime());
      if (end <= start) continue;
      const seconds = Math.round((end - start) / 1_000);
      intervals.push([start, end]);
      const current = dwell.get(session.roomId) ?? {
        id: session.roomId,
        name: session.room.name,
        durations: [],
        totalSeconds: 0,
        reliableSessions: 0,
        ambiguousSeconds: 0,
      };
      current.totalSeconds += seconds;
      if (session.state === 'AMBIGUOUS') current.ambiguousSeconds += seconds;
      if (
        !session.excludedFromLearning &&
        session.confidence !== 'LOW' &&
        session.state !== 'AMBIGUOUS'
      ) {
        current.durations.push(seconds);
        current.reliableSessions += 1;
        reliableIntervals.push({ start, end, roomId: session.roomId });
      }
      dwell.set(session.roomId, current);
    }
    const knownSeconds = mergeIntervals(intervals).reduce(
      (sum, [start, end]) => sum + Math.round((end - start) / 1_000),
      0,
    );
    const observedSeconds = mergeIntervals(
      reliableIntervals.map(({ start, end }) => [start, end]),
    ).reduce((sum, [start, end]) => sum + Math.round((end - start) / 1_000), 0);
    const reliableBuckets = bucketWindows.map(({ start, end, label }) => {
      const overlaps = reliableIntervals
        .map(({ start: intervalStart, end: intervalEnd, roomId }) => ({
          start: Math.max(intervalStart, start.getTime()),
          end: Math.min(intervalEnd, end.getTime()),
          roomId,
        }))
        .filter(({ start: intervalStart, end: intervalEnd }) => intervalEnd > intervalStart);
      const roomIds = new Set(overlaps.map(({ roomId }) => roomId));
      const byRoom = Object.fromEntries(
        [...roomIds].map((roomId) => [
          roomId,
          mergeIntervals(
            overlaps
              .filter((interval) => interval.roomId === roomId)
              .map((interval) => [interval.start, interval.end]),
          ).reduce(
            (sum, [intervalStart, intervalEnd]) =>
              sum + Math.round((intervalEnd - intervalStart) / 1_000),
            0,
          ),
        ]),
      );
      return {
        start: start.toISOString(),
        label,
        seconds: mergeIntervals(overlaps.map((interval) => [interval.start, interval.end])).reduce(
          (sum, [intervalStart, intervalEnd]) =>
            sum + Math.round((intervalEnd - intervalStart) / 1_000),
          0,
        ),
        byRoom,
      };
    });

    const environmentByRoom = new Map<string, Map<string, typeof normalizedEvents>>();
    for (const event of normalizedEvents) {
      if (!ENVIRONMENT_CAPABILITIES.has(event.capability)) continue;
      const byCapability =
        environmentByRoom.get(event.roomId) ?? new Map<string, typeof normalizedEvents>();
      const readings = byCapability.get(event.capability) ?? [];
      readings.push(event);
      byCapability.set(event.capability, readings);
      environmentByRoom.set(event.roomId, byCapability);
    }
    const environmentForRoom = (roomId: string) =>
      [...(environmentByRoom.get(roomId)?.entries() ?? [])].map(([capability, readings]) => {
        const latest = readings.at(-1)!;
        const numeric = readings
          .map((event) => ({ event, value: numericPayload(event.payload) }))
          .filter(
            (item): item is { event: (typeof readings)[number]; value: number } =>
              item.value !== null,
          );
        const step = Math.max(1, Math.ceil(numeric.length / 24));
        const points = numeric
          .filter((_, index) => index % step === 0 || index === numeric.length - 1)
          .map(({ event, value }) => ({ occurredAt: event.occurredAt, value }));
        const values = numeric.map(({ value }) => value);
        return {
          capability,
          latestValue: displayPayload(latest.payload),
          numericValue: numericPayload(latest.payload),
          unit: latest.unit,
          minimum: values.length ? Math.min(...values) : null,
          maximum: values.length ? Math.max(...values) : null,
          points,
        };
      });

    const placementRoom = (sensor: (typeof sensors)[number]) =>
      placements.find(
        (placement) =>
          placement.equipmentId === sensor.id ||
          (placement.equipmentRefKind === 'DEVICE' && placement.equipmentId === sensor.deviceId),
      )?.roomId ?? sensor.roomId;
    const sensorsByRoom = new Map<string, typeof sensors>();
    for (const sensor of sensors) {
      if (cameraEntityIds.has(sensor.entityId) || cameraDeviceIds.has(sensor.deviceId ?? ''))
        continue;
      const roomId = placementRoom(sensor);
      if (!roomId || !roomNames.has(roomId)) continue;
      const items = sensorsByRoom.get(roomId) ?? [];
      items.push(sensor);
      sensorsByRoom.set(roomId, items);
    }
    const learningDays = home.learningStartedAt
      ? Math.max(0, Math.floor((Date.now() - home.learningStartedAt.getTime()) / 86_400_000))
      : 0;
    const lifeByRoom = new Map<string, typeof normalizedEvents>();
    const safetyByRoom = new Map<string, typeof normalizedEvents>();
    for (const event of normalizedEvents) {
      if (LIFE_CAPABILITIES.has(event.capability)) {
        const values = lifeByRoom.get(event.roomId) ?? [];
        values.push(event);
        lifeByRoom.set(event.roomId, values);
      }
      if (SAFETY_CAPABILITIES.has(event.capability)) {
        const values = safetyByRoom.get(event.roomId) ?? [];
        values.push(event);
        safetyByRoom.set(event.roomId, values);
      }
    }
    const roomOverviews = [...home.rooms]
      .sort((left, right) => left.floor - right.floor || left.sortOrder - right.sortOrder)
      .map((room) => {
        const roomSensors = sensorsByRoom.get(room.id) ?? [];
        const lifeSensors = roomSensors.filter((sensor) =>
          LIFE_CAPABILITIES.has(sensor.capability),
        );
        const environmentSensors = roomSensors.filter((sensor) =>
          ENVIRONMENT_CAPABILITIES.has(sensor.capability),
        );
        const roomLife = lifeByRoom.get(room.id) ?? [];
        const safety = safetyByRoom.get(room.id) ?? [];
        const latestSafety = [
          ...new Map(safety.map((event) => [event.capability, event])).values(),
        ];
        const equipmentIssue = lifeSensors.some(
          (sensor) =>
            !sensor.available || sensor.status !== 'ONLINE' || sensor.device?.enabled === false,
        );
        const state =
          lifeSensors.length === 0
            ? ('NOT_EQUIPPED' as const)
            : equipmentIssue
              ? ('EQUIPMENT_ISSUE' as const)
              : learningDays < 14
                ? ('LEARNING' as const)
                : roomLife.length === 0
                  ? ('NO_ACTIVITY' as const)
                  : ('OBSERVED' as const);
        const environmentIssue = environmentSensors.some(
          (sensor) =>
            !sensor.available || sensor.status !== 'ONLINE' || sensor.device?.enabled === false,
        );
        const environment = environmentForRoom(room.id);
        const environmentState =
          environmentSensors.length === 0
            ? ('NOT_EQUIPPED' as const)
            : environmentIssue
              ? ('EQUIPMENT_ISSUE' as const)
              : environment.length === 0
                ? ('NO_ACTIVITY' as const)
                : ('OBSERVED' as const);
        return {
          id: room.id,
          name: room.name,
          kind: room.kind,
          floor: room.floor,
          state,
          environmentState,
          sensorCount: roomSensors.length,
          lastActivity: roomLife.at(-1) ?? null,
          environment,
          safety: latestSafety,
        };
      });

    const sequenceEvents = normalizedEvents.filter(({ capability }) =>
      SEQUENCE_CAPABILITIES.has(capability),
    );
    const hasMoreSequences = sequenceEvents.length > MAX_SEQUENCE_EVENTS;
    const recentSequenceEvents = sequenceEvents.slice(-MAX_SEQUENCE_EVENTS);
    const groups: Array<typeof normalizedEvents> = [];
    for (const event of recentSequenceEvents) {
      const current = groups.at(-1);
      const previous = current?.at(-1);
      if (
        !current ||
        !previous ||
        new Date(event.occurredAt).getTime() - new Date(previous.occurredAt).getTime() >
          SEQUENCE_GAP_MS
      )
        groups.push([event]);
      else current.push(event);
    }
    const sequences = groups
      .map((group) => {
        const shownEvents = group.slice(-MAX_EVENTS_PER_SEQUENCE);
        const rooms = group
          .map(({ roomId, roomName }) => ({ roomId, roomName }))
          .filter((room, index, items) => index === 0 || room.roomId !== items[index - 1]?.roomId);
        const passageMap = new Map(
          group
            .flatMap(({ passage }) => (passage ? [passage] : []))
            .map((passage) => [`${passage.fromLevelId}:${passage.toLevelId}`, passage] as const),
        );
        const startedAt = group[0]!.occurredAt;
        const endedAt = group.at(-1)!.occurredAt;
        return {
          id: `sequence-${group[0]!.id}`,
          startedAt,
          endedAt,
          durationSeconds: Math.max(
            0,
            Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1_000),
          ),
          roomIds: rooms.map(({ roomId }) => roomId),
          roomNames: rooms.map(({ roomName }) => roomName),
          passages: [...passageMap.values()],
          totalEventCount: group.length,
          hiddenEventCount: Math.max(0, group.length - shownEvents.length),
          events: shownEvents,
        };
      })
      .reverse();
    const reliableActivity = normalizedEvents
      .filter(({ capability, quality }) => LIFE_CAPABILITIES.has(capability) && quality === 'good')
      .at(-1);
    const windowSeconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1_000));
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      total: usefulEvents.length,
      buckets,
      byRoom: [...roomCounts.values()].sort((a, b) => b.count - a.count),
      byCapability: [...capabilityCounts.entries()]
        .map(([capability, count]) => ({ capability, count }))
        .sort((a, b) => b.count - a.count),
      dwellByRoom: [...dwell.values()]
        .map((item) => ({
          id: item.id,
          name: item.name,
          totalSeconds: item.totalSeconds,
          averageSeconds: item.durations.length
            ? Math.round(
                item.durations.reduce((sum, value) => sum + value, 0) / item.durations.length,
              )
            : 0,
          medianSeconds: median(item.durations),
          sessions: sensorSessions.filter((session) => session.roomId === item.id).length,
          reliableSessions: item.reliableSessions,
          ambiguousSeconds: item.ambiguousSeconds,
          confidenceRate: sensorSessions.filter((session) => session.roomId === item.id).length
            ? item.reliableSessions /
              sensorSessions.filter((session) => session.roomId === item.id).length
            : 0,
        }))
        .sort((a, b) => b.totalSeconds - a.totalSeconds),
      unknownSeconds: Math.max(0, windowSeconds - knownSeconds),
      reliableBuckets,
      observedSeconds,
      unobservedSeconds: Math.max(0, windowSeconds - observedSeconds),
      lastReliableActivity: reliableActivity ?? null,
      rooms: roomOverviews,
      sequences,
      hasMoreSequences,
    };
  }

  public async routines(userId: string) {
    const home = await this.homeFor(userId);
    const now = new Date();
    if (!home) {
      return {
        learningDays: 0,
        requiredLearningDays: 14,
        progress: 0,
        coverageSufficient: false,
        behavioralAlertsEnabled: false,
        window: { from: now.toISOString(), to: now.toISOString() },
        rooms: [],
        changes: [],
      };
    }
    const from = new Date(now.getTime() - 28 * 86_400_000);
    const [sessions, sensors, revision, cameras] = await Promise.all([
      this.prisma.roomPresenceSession.findMany({
        where: { homeId: home.id, startedAt: { gte: from } },
        include: { room: true },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.sensor.findMany({
        where: {
          homeId: home.id,
          analysisEnabled: true,
          capability: { in: ['motion', 'occupancy', 'person_presence'] },
        },
        select: { status: true, entityId: true, deviceId: true },
      }),
      this.prisma.configurationRevision.findFirst({
        where: { homeId: home.id },
        orderBy: { version: 'desc' },
        select: { settings: true },
      }),
      this.prisma.camera.findMany({
        where: { homeId: home.id },
        select: { personEntityId: true, deviceId: true },
      }),
    ]);
    const settings = revision?.settings as Record<string, unknown> | undefined;
    const parsedRules = alertRuleSettingsSchema.safeParse(settings?.alertRules);
    const rules = parsedRules.success ? parsedRules.data : DEFAULT_ALERT_RULE_SETTINGS;
    const learningDays = home.learningStartedAt
      ? Math.max(0, Math.floor((now.getTime() - home.learningStartedAt.getTime()) / 86_400_000))
      : 0;
    const cameraEntities = new Set(cameras.flatMap(({ personEntityId }) => personEntityId ?? []));
    const cameraDevices = new Set(cameras.flatMap(({ deviceId }) => deviceId ?? []));
    const householdSensors = sensors.filter(
      (sensor) => !cameraEntities.has(sensor.entityId) && !cameraDevices.has(sensor.deviceId ?? ''),
    );
    const sensorSessions = sessions.filter((session) => session.source !== 'CAMERA');
    const coverageSufficient =
      householdSensors.length > 0 && householdSensors.every((sensor) => sensor.status === 'ONLINE');
    const today = localDateKey(now, home.timezone);
    const roomRoutines = home.rooms.map((room) => {
      const roomSessions = sensorSessions.filter((session) => session.roomId === room.id);
      const reliable = roomSessions.filter(
        (session) =>
          session.durationSeconds !== null &&
          session.state === 'CLOSED' &&
          session.confidence !== 'LOW' &&
          !session.excludedFromLearning,
      );
      const durations = reliable.map((session) => session.durationSeconds!);
      const dates = new Set(
        reliable.map((session) => localDateKey(session.startedAt, home.timezone)),
      );
      const middle = median(durations);
      const mad = median(durations.map((duration) => Math.abs(duration - middle)));
      const dailyTotals = new Map<string, number>();
      for (const session of reliable) {
        const key = localDateKey(session.startedAt, home.timezone);
        dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + session.durationSeconds!);
      }
      const minutes = reliable.map((session) => minuteOfDay(session.startedAt, home.timezone));
      return {
        roomId: room.id,
        roomName: room.name,
        status:
          learningDays >= 14 && durations.length >= 10 && coverageSufficient
            ? ('CONFIRMED' as const)
            : ('LEARNING' as const),
        sampleDays: dates.size,
        sessions: reliable.length,
        averageSeconds: durations.length
          ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
          : 0,
        medianSeconds: middle,
        madSeconds: mad,
        averageDailySeconds: dailyTotals.size
          ? Math.round(
              [...dailyTotals.values()].reduce((sum, value) => sum + value, 0) / dailyTotals.size,
            )
          : 0,
        firstMinute: minutes.length ? Math.min(...minutes) : null,
        lastMinute: reliable.length
          ? Math.max(...reliable.map((session) => minuteOfDay(session.endedAt!, home.timezone)))
          : null,
        confidenceRate: roomSessions.length ? reliable.length / roomSessions.length : 0,
        todaySeconds: roomSessions
          .filter((session) => localDateKey(session.startedAt, home.timezone) === today)
          .reduce((sum, session) => {
            const end = session.endedAt ?? now;
            return (
              sum + Math.max(0, Math.round((end.getTime() - session.startedAt.getTime()) / 1_000))
            );
          }, 0),
      };
    });
    return {
      learningDays,
      requiredLearningDays: 14,
      progress: Math.min(1, learningDays / 14),
      coverageSufficient,
      behavioralAlertsEnabled: rules.behavioral.enabled,
      window: { from: from.toISOString(), to: now.toISOString() },
      rooms: roomRoutines,
      changes: roomRoutines
        .filter(
          (room) =>
            room.status === 'CONFIRMED' &&
            room.averageDailySeconds > 0 &&
            Math.abs(room.todaySeconds - room.averageDailySeconds) / room.averageDailySeconds >=
              0.5,
        )
        .map((room) => ({
          roomId: room.roomId,
          roomName: room.roomName,
          kind: 'DAILY_DWELL' as const,
          direction:
            room.todaySeconds > room.averageDailySeconds ? ('HIGHER' as const) : ('LOWER' as const),
          observedSeconds: room.todaySeconds,
          baselineSeconds: room.averageDailySeconds,
        })),
    };
  }

  public async household(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: { userId, disabledAt: null },
          },
        },
      },
      include: {
        residents: {
          include: {
            context: true,
            supportNeeds: { orderBy: { createdAt: 'asc' } },
            habits: { orderBy: { kind: 'asc' } },
          },
        },
        trustedContacts: {
          where: { archivedAt: null },
          orderBy: { priority: 'asc' },
          include: { user: { include: { memberships: true } } },
        },
        rooms: {
          orderBy: { name: 'asc' },
          include: {
            sensors: {
              orderBy: { entityId: 'asc' },
              include: { device: true },
            },
          },
        },
      },
    });
    if (!home) throw new ForbiddenException('Access denied');
    const [caregivers, latestSensorEvents] = await Promise.all([
      this.prisma.caregiverProfile.findMany({
        where: { resident: { homeId: home.id } },
        include: {
          user: { include: { memberships: { where: { organizationId: home.organizationId } } } },
        },
        orderBy: [{ isPrimary: 'desc' }, { user: { displayName: 'asc' } }],
      }),
      this.latestEvents(home.rooms.flatMap((room) => room.sensors.map((sensor) => sensor.id))),
    ]);
    const sensorView = (sensor: (typeof home.rooms)[number]['sensors'][number]) => {
      const live = sensor.available && sensor.status === 'ONLINE';
      const latestEvent = latestSensorEvents.get(sensor.id);
      return {
        id: sensor.id,
        entityId: sensor.entityId,
        capability: sensor.capability,
        status: live ? sensor.status : 'OFFLINE',
        compatibility: sensor.compatibility,
        lastSeenAt: sensor.lastSeenAt?.toISOString() ?? null,
        lastValue: live
          ? ((latestEvent?.payload as Record<string, unknown> | undefined) ?? null)
          : null,
        device: sensor.device
          ? {
              name: sensor.device.name,
              manufacturer: sensor.device.manufacturer,
              model: sensor.device.model,
            }
          : null,
      };
    };
    return {
      home: {
        id: home.id,
        name: home.name,
        timezone: home.timezone,
        type: home.type,
        address: home.address,
        floorCount: home.floorCount,
        installationStatus: home.installationStatus,
        learningStartedAt: home.learningStartedAt?.toISOString() ?? null,
      },
      rooms: home.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        kind: room.kind,
        floor: room.floor,
        sortOrder: room.sortOrder,
        sensors: room.sensors.map(sensorView),
      })),
      unassignedSensors: [],
      residents: home.residents.map((resident) => ({
        id: resident.id,
        displayName: resident.displayName,
        firstName: resident.firstName,
        lastName: resident.lastName,
        preferredName: resident.preferredName,
        birthDate: resident.birthDate?.toISOString().slice(0, 10) ?? null,
        birthYear: resident.birthYear,
        spokenLanguage: resident.spokenLanguage,
        formOfAddress: resident.formOfAddress,
        photoUrl: resident.photoPath ? `/api/v1/residents/${resident.id}/photo` : null,
        context: resident.context,
        supportNeeds: resident.supportNeeds.map((need) => ({
          id: need.id,
          kind: need.kind,
          note: need.note,
        })),
        habits: resident.habits.map((habit) => ({
          id: habit.id,
          kind: habit.kind,
          status: habit.status,
          source: habit.source,
          startMinute: habit.startMinute,
          endMinute: habit.endMinute,
        })),
        primary: resident.id === home.primaryResidentId,
      })),
      trustedContacts: home.trustedContacts.map((contact) => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        relation: contact.relation,
        role:
          contact.user?.memberships.find(
            (membership) => membership.organizationId === home.organizationId,
          )?.systemRole ?? null,
        isEmergency: contact.isEmergency,
        priority: contact.priority,
        hasAccount: contact.userId !== null,
        accessDisabled: Boolean(
          contact.user?.memberships.find(
            (membership) => membership.organizationId === home.organizationId,
          )?.disabledAt,
        ),
        archived: contact.archivedAt !== null,
        isCurrentUser: contact.userId === userId,
        username: contact.user?.username ?? null,
      })),
      caregivers: caregivers.map((caregiver) => ({
        id: caregiver.id,
        displayName: caregiver.user.displayName,
        relation: caregiver.relation,
        isPrimary: caregiver.isPrimary,
        role: caregiver.user.memberships[0]?.systemRole ?? null,
      })),
    };
  }

  public async reorderContacts(userId: string, orderedIds: string[]) {
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new ForbiddenException('Invalid contact order');
    }
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: { userId, disabledAt: null, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } },
          },
        },
      },
      select: { id: true, trustedContacts: { select: { id: true } } },
    });
    if (!home) throw new ForbiddenException('Administrator access required');
    const currentIds = home.trustedContacts.map((contact) => contact.id).sort();
    if (currentIds.join('|') !== [...orderedIds].sort().join('|')) {
      throw new ForbiddenException('Unknown contact identifier');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.trustedContact.update({ where: { id }, data: { priority: -index - 1 } });
      }
      for (const [index, id] of orderedIds.entries()) {
        await tx.trustedContact.update({ where: { id }, data: { priority: index } });
      }
    });
    return { orderedIds };
  }

  public async assignSensor(userId: string, sensorId: string, roomId: string | null) {
    if (!roomId) throw new ForbiddenException('Un capteur installé doit appartenir à une pièce.');
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: { userId, disabledAt: null, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } },
          },
        },
      },
      select: { id: true, rooms: { select: { id: true } } },
    });
    if (!home) throw new ForbiddenException('Administrator access required');
    if (roomId && !home.rooms.some((room) => room.id === roomId)) {
      throw new ForbiddenException('Unknown room identifier');
    }
    const sensor = await this.prisma.sensor.findFirst({
      where: { id: sensorId, homeId: home.id },
      select: { id: true, deviceId: true },
    });
    if (!sensor) throw new ForbiddenException('Unknown sensor identifier');
    if (sensor.deviceId) {
      await this.prisma.$transaction([
        this.prisma.device.update({
          where: { id: sensor.deviceId },
          data: { roomId, installationStatus: 'NEEDS_PLACEMENT' },
        }),
        this.prisma.sensor.updateMany({
          where: { deviceId: sensor.deviceId, homeId: home.id },
          data: { roomId },
        }),
      ]);
    } else {
      await this.prisma.sensor.update({ where: { id: sensor.id }, data: { roomId } });
    }
    return { sensorId, roomId };
  }

  public async schedule(userId: string, from: Date, to: Date) {
    const home = await this.homeFor(userId);
    if (!home) return [];
    const [visits, appointments] = await Promise.all([
      this.prisma.visit.findMany({ where: { homeId: home.id, startsAt: { gte: from, lte: to } } }),
      this.prisma.appointment.findMany({
        where: { homeId: home.id, startsAt: { gte: from, lte: to } },
      }),
    ]);
    return [
      ...visits.map((visit) => ({
        id: visit.id,
        type: 'VISIT' as const,
        title: visit.visitorName,
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
        detail: null,
        notes: visit.notes,
        seriesId: visit.seriesId,
        recurrence: visit.recurrence,
        recurrenceUntil: visit.recurrenceUntil,
      })),
      ...appointments.map((appointment) => ({
        id: appointment.id,
        type: 'APPOINTMENT' as const,
        title: appointment.title,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        detail: appointment.location,
        notes: appointment.notes,
        seriesId: appointment.seriesId,
        recurrence: appointment.recurrence,
        recurrenceUntil: appointment.recurrenceUntil,
      })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  public async timeline(userId: string, limit = 50) {
    return this.prisma.observationEvent.findMany({
      where: { home: { organization: { memberships: { some: { userId, disabledAt: null } } } } },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 100),
      include: { sensor: { include: { room: true } } },
    });
  }

  private async latestEvents(sensorIds: string[]): Promise<Map<string, ObservationEvent>> {
    if (sensorIds.length === 0) return new Map();
    const events = await this.prisma.$queryRaw<ObservationEvent[]>`
      SELECT latest.*
      FROM unnest(ARRAY[${Prisma.join(sensorIds)}]::text[]) AS target(id)
      JOIN LATERAL (
        SELECT * FROM "ObservationEvent" AS event
        WHERE event."sensorId" = target.id
        ORDER BY event."occurredAt" DESC
        LIMIT 1
      ) AS latest ON true
    `;
    return new Map(events.flatMap((event) => (event.sensorId ? [[event.sensorId, event]] : [])));
  }

  public async activityFeed(userId: string, limit: number, cursor?: string) {
    const items = await this.prisma.observationEvent.findMany({
      where: {
        home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { sensor: { include: { room: true } } },
    });
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return { items: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  public async journal(userId: string) {
    const [journalEntries, homes] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: {
          home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
        },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
      this.prisma.home.findMany({
        where: { organization: { memberships: { some: activeMembership(userId) } } },
        select: {
          id: true,
          timezone: true,
          primaryResident: {
            select: { firstName: true, preferredName: true, displayName: true },
          },
        },
      }),
    ]);

    if (homes.length === 0) return journalEntries;

    const now = new Date();
    const homeWindows = new Map(
      homes.map((home) => {
        const today = localDateKey(now, home.timezone);
        const firstDay = shiftDateKey(today, -6);
        const residentName =
          home.primaryResident?.firstName?.trim() ||
          home.primaryResident?.preferredName?.trim().split(/\s+/)[0] ||
          home.primaryResident?.displayName.trim().split(/\s+/)[0] ||
          null;
        return [home.id, { timezone: home.timezone, today, firstDay, residentName }];
      }),
    );
    const earliestStart = new Date(
      Math.min(
        ...homes.map((home) =>
          zonedMidnight(homeWindows.get(home.id)!.firstDay, home.timezone).getTime(),
        ),
      ),
    );
    const liaisonEntries = await this.prisma.liaisonEntry.findMany({
      where: {
        homeId: { in: homes.map((home) => home.id) },
        createdAt: { gte: earliestStart, lte: now },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { author: { select: { displayName: true } } },
    });

    type RecentLiaisonEntry = (typeof liaisonEntries)[number];
    const grouped = new Map<
      string,
      { homeId: string; day: string; timezone: string; entries: RecentLiaisonEntry[] }
    >();
    for (const entry of liaisonEntries) {
      const window = homeWindows.get(entry.homeId);
      if (!window) continue;
      const day = localDateKey(entry.createdAt, window.timezone);
      if (day < window.firstDay || day > window.today) continue;
      const key = `${entry.homeId}:${day}`;
      const group = grouped.get(key) ?? {
        homeId: entry.homeId,
        day,
        timezone: window.timezone,
        entries: [],
      };
      group.entries.push(entry);
      grouped.set(key, group);
    }

    const dailySummaries = [...grouped.values()].map((group) => {
      const entries = [...group.entries].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
      return {
        id: `liaison-summary:${group.homeId}:${group.day}`,
        homeId: group.homeId,
        kind: 'DAILY_SUMMARY',
        title: 'Résumé du carnet de liaison',
        body: entries
          .map((entry) => {
            const time = formatLocalTime(entry.createdAt, group.timezone);
            const mood = entry.tags.includes('MOOD') ? liaisonMoodLabel(entry.body) : null;
            if (mood) {
              const residentName = homeWindows.get(group.homeId)?.residentName;
              return `• ${time} — ${residentName ? `Humeur de ${residentName}` : 'Humeur du résident'} : ${mood}`;
            }
            return `• ${time} — ${entry.author?.displayName ?? '—'} : ${entry.body}`;
          })
          .join('\n'),
        occurredAt: entries.at(-1)!.createdAt,
      };
    });

    return [...journalEntries, ...dailySummaries].sort(
      (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
    );
  }

  public async journalFeed(userId: string, limit: number, cursor?: string) {
    const items = await this.prisma.journalEntry.findMany({
      where: {
        home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = items.slice(0, limit);
    return { items: page, nextCursor: items.length > limit ? (page.at(-1)?.id ?? null) : null };
  }
}
