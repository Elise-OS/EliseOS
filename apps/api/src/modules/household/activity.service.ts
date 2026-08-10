import { ForbiddenException, Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { DashboardPeriod, Installation } from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';

const ACTIVITY_CAPABILITIES = ['motion', 'occupancy', 'contact', 'button'];

@Injectable()
export class ActivityService {
  public constructor(private readonly prisma: PrismaService) {}

  private async homeFor(userId: string) {
    return this.prisma.home.findFirst({
      where: { organization: { memberships: { some: { userId } } } },
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
          where: { homeId: home.id },
          orderBy: { occurredAt: 'desc' },
          include: { sensor: { include: { room: true } } },
        }),
        this.prisma.alert.count({
          where: { homeId: home.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        }),
        this.prisma.sensor.findMany({
          where: { homeId: home.id },
          include: { room: true },
          orderBy: { lastSeenAt: 'desc' },
        }),
        this.prisma.observationEvent.findMany({
          where: { homeId: home.id },
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
    const degraded = sensors.some((sensor) => ['OFFLINE', 'DEGRADED'].includes(sensor.status));
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
      reassurance: degraded
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
    const from = new Date(to.getTime() - (period === '24h' ? 24 : 7 * 24) * 3_600_000);
    const events = await this.prisma.observationEvent.findMany({
      where: {
        homeId: home.id,
        occurredAt: { gte: from, lte: to },
        capability: { in: ACTIVITY_CAPABILITIES },
      },
      orderBy: { occurredAt: 'asc' },
      include: { sensor: { include: { room: true } } },
    });
    const bucketCount = period === '24h' ? 24 : 7;
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
    };
  }

  public async household(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } },
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
        trustedContacts: { orderBy: { priority: 'asc' }, include: { user: true } },
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
    if (!home) throw new ForbiddenException('Administrator access required');
    const caregivers = await this.prisma.caregiverProfile.findMany({
      where: { resident: { homeId: home.id } },
      include: {
        user: { include: { memberships: { where: { organizationId: home.organizationId } } } },
      },
      orderBy: [{ isPrimary: 'desc' }, { user: { displayName: 'asc' } }],
    });
    const sensorView = (sensor: (typeof home.sensors)[number]) => ({
      id: sensor.id,
      entityId: sensor.entityId,
      capability: sensor.capability,
      status: sensor.status,
      compatibility: sensor.compatibility,
      lastSeenAt: sensor.lastSeenAt?.toISOString() ?? null,
      lastValue: (sensor.events[0]?.payload as Record<string, unknown> | undefined) ?? null,
      device: sensor.device
        ? {
            name: sensor.device.name,
            manufacturer: sensor.device.manufacturer,
            model: sensor.device.model,
          }
        : null,
    });
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
        role: contact.role,
        priority: contact.priority,
        hasAccount: contact.userId !== null,
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
          memberships: { some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } } },
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

  public async createContact(userId: string, contact: Installation['contacts'][number]) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: { some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } } },
        },
      },
      select: { id: true, organizationId: true, primaryResidentId: true },
    });
    if (!home?.primaryResidentId) throw new ForbiddenException('Administrator access required');
    const residentId = home.primaryResidentId;
    const temporaryPasswordHash = contact.temporaryPassword
      ? await hash(contact.temporaryPassword)
      : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296649293)`;
      const last = await tx.trustedContact.findFirst({
        where: { homeId: home.id },
        orderBy: { priority: 'desc' },
        select: { priority: true },
      });
      let accountId: string | null = null;
      if (contact.role === 'administrateur') {
        if (!contact.username || !temporaryPasswordHash) {
          throw new ForbiddenException('Administrator credentials required');
        }
        const account = await tx.user.create({
          data: {
            username: contact.username.toLowerCase(),
            email: contact.email ? contact.email.toLowerCase() : null,
            phone: contact.phone || null,
            displayName: `${contact.firstName} ${contact.lastName}`.trim(),
            passwordHash: temporaryPasswordHash,
            mustChangePassword: true,
          },
        });
        accountId = account.id;
        await tx.membership.create({
          data: {
            organizationId: home.organizationId,
            userId: account.id,
            systemRole: 'ADMINISTRATOR',
          },
        });
        await tx.caregiverProfile.create({
          data: {
            userId: account.id,
            residentId,
            relation: contact.relation || null,
          },
        });
      }
      return tx.trustedContact.create({
        data: {
          homeId: home.id,
          residentId,
          userId: accountId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone || null,
          email: contact.email ? contact.email.toLowerCase() : null,
          relation: contact.relation || null,
          role:
            contact.role === 'administrateur'
              ? 'ADMINISTRATOR'
              : contact.role === 'urgence'
                ? 'EMERGENCY'
                : 'RELATIVE',
          priority: (last?.priority ?? -1) + 1,
        },
      });
    });
  }

  public async assignSensor(userId: string, sensorId: string, roomId: string | null) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: { some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } } },
        },
      },
      select: { id: true, rooms: { select: { id: true } } },
    });
    if (!home) throw new ForbiddenException('Administrator access required');
    if (roomId && !home.rooms.some((room) => room.id === roomId)) {
      throw new ForbiddenException('Unknown room identifier');
    }
    const updated = await this.prisma.sensor.updateMany({
      where: { id: sensorId, homeId: home.id },
      data: { roomId },
    });
    if (updated.count !== 1) throw new ForbiddenException('Unknown sensor identifier');
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
      where: { home: { organization: { memberships: { some: { userId } } } } },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 100),
      include: { sensor: { include: { room: true } } },
    });
  }

  public async activityFeed(userId: string, limit: number, cursor?: string) {
    const items = await this.prisma.observationEvent.findMany({
      where: { home: { organization: { memberships: { some: { userId } } } } },
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
      where: { home: { organization: { memberships: { some: { userId } } } } },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
  }

  public async journalFeed(userId: string, limit: number, cursor?: string) {
    const items = await this.prisma.journalEntry.findMany({
      where: { home: { organization: { memberships: { some: { userId } } } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = items.slice(0, limit);
    return { items: page, nextCursor: items.length > limit ? (page.at(-1)?.id ?? null) : null };
  }
}
