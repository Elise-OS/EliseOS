import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  type DashboardPeriod,
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';

const ACTIVITY_CAPABILITIES = ['motion', 'occupancy', 'person_presence', 'contact', 'button'];

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

@Injectable()
export class ActivityService {
  public constructor(private readonly prisma: PrismaService) {}

  private async homeFor(userId: string) {
    return this.prisma.home.findFirst({
      where: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      include: {
        primaryResident: { include: { supportNeeds: true, habits: true } },
        rooms: true,
      },
    });
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
          where: { homeId: home.id, sensor: { analysisEnabled: true } },
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
    const home = await this.homeFor(userId);
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

  public async summary(userId: string, period: DashboardPeriod) {
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
      };
    const to = new Date();
    const periodHours = period === '24h' ? 24 : period === '7d' ? 7 * 24 : 28 * 24;
    const from = new Date(to.getTime() - periodHours * 3_600_000);
    const [events, sessions] = await Promise.all([
      this.prisma.observationEvent.findMany({
        where: {
          homeId: home.id,
          occurredAt: { gte: from, lte: to },
          capability: { in: ACTIVITY_CAPABILITIES },
        },
        orderBy: { occurredAt: 'asc' },
        include: { sensor: { include: { room: true } } },
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
    ]);
    const bucketCount = period === '24h' ? 24 : period === '7d' ? 7 : 28;
    const bucketMs = period === '24h' ? 3_600_000 : 86_400_000;
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const start = new Date(from.getTime() + index * bucketMs);
      const end = new Date(start.getTime() + bucketMs);
      return {
        start: start.toISOString(),
        label:
          period === '24h'
            ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', timeZone: home.timezone }).format(
                start,
              )
            : new Intl.DateTimeFormat('fr-FR', {
                weekday: 'short',
                timeZone: home.timezone,
              }).format(start),
        count: events.filter((event) => event.occurredAt >= start && event.occurredAt < end).length,
      };
    });
    const roomCounts = new Map<string, { id: string | null; name: string; count: number }>();
    const capabilityCounts = new Map<string, number>();
    for (const event of events) {
      const room = event.sensor?.room;
      const key = room?.id ?? 'unassigned';
      const current = roomCounts.get(key) ?? {
        id: room?.id ?? null,
        name: room?.name ?? 'Maison',
        count: 0,
      };
      current.count += 1;
      roomCounts.set(key, current);
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
    for (const session of sessions) {
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
      }
      dwell.set(session.roomId, current);
    }
    const merged: Array<[number, number]> = [];
    for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval] as [number, number]);
    }
    const knownSeconds = merged.reduce(
      (sum, [start, end]) => sum + Math.round((end - start) / 1_000),
      0,
    );
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      total: events.length,
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
          sessions: sessions.filter((session) => session.roomId === item.id).length,
          reliableSessions: item.reliableSessions,
          ambiguousSeconds: item.ambiguousSeconds,
          confidenceRate: sessions.filter((session) => session.roomId === item.id).length
            ? item.reliableSessions /
              sessions.filter((session) => session.roomId === item.id).length
            : 0,
        }))
        .sort((a, b) => b.totalSeconds - a.totalSeconds),
      unknownSeconds: Math.max(0, periodHours * 3_600 - knownSeconds),
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
    const [sessions, sensors, revision] = await Promise.all([
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
        select: { status: true },
      }),
      this.prisma.configurationRevision.findFirst({
        where: { homeId: home.id },
        orderBy: { version: 'desc' },
        select: { settings: true },
      }),
    ]);
    const settings = revision?.settings as Record<string, unknown> | undefined;
    const parsedRules = alertRuleSettingsSchema.safeParse(settings?.alertRules);
    const rules = parsedRules.success ? parsedRules.data : DEFAULT_ALERT_RULE_SETTINGS;
    const learningDays = home.learningStartedAt
      ? Math.max(0, Math.floor((now.getTime() - home.learningStartedAt.getTime()) / 86_400_000))
      : 0;
    const coverageSufficient =
      sensors.length > 0 && sensors.every((sensor) => sensor.status === 'ONLINE');
    const today = localDateKey(now, home.timezone);
    const roomRoutines = home.rooms.map((room) => {
      const roomSessions = sessions.filter((session) => session.roomId === room.id);
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
              include: { device: true, events: { orderBy: { occurredAt: 'desc' }, take: 1 } },
            },
          },
        },
        sensors: {
          where: { roomId: null },
          orderBy: { entityId: 'asc' },
          include: { device: true, events: { orderBy: { occurredAt: 'desc' }, take: 1 } },
        },
      },
    });
    if (!home) throw new ForbiddenException('Access denied');
    const caregivers = await this.prisma.caregiverProfile.findMany({
      where: { resident: { homeId: home.id } },
      include: {
        user: { include: { memberships: { where: { organizationId: home.organizationId } } } },
      },
      orderBy: [{ isPrimary: 'desc' }, { user: { displayName: 'asc' } }],
    });
    const sensorView = (sensor: (typeof home.sensors)[number]) => {
      const live = sensor.available && sensor.status === 'ONLINE';
      return {
        id: sensor.id,
        entityId: sensor.entityId,
        capability: sensor.capability,
        status: live ? sensor.status : 'OFFLINE',
        compatibility: sensor.compatibility,
        lastSeenAt: sensor.lastSeenAt?.toISOString() ?? null,
        lastValue: live
          ? ((sensor.events[0]?.payload as Record<string, unknown> | undefined) ?? null)
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
      unassignedSensors: home.sensors.map(sensorView),
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
      })),
      ...appointments.map((appointment) => ({
        id: appointment.id,
        type: 'APPOINTMENT' as const,
        title: appointment.title,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        detail: appointment.location,
        notes: appointment.notes,
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
    return this.prisma.journalEntry.findMany({
      where: {
        home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
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
