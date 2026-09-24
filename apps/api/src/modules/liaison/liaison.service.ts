import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LiaisonCreate, LiaisonQuery, LiaisonUpdate } from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership } from '../auth/access-policy';
import { scheduledDate } from '../medications/medication-time';

const writers = ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] as const;
const person = { select: { id: true, displayName: true } };
const people = { author: person, assignee: person, completedBy: person };

function localDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class LiaisonService {
  constructor(private readonly prisma: PrismaService) {}

  private async home(userId: string, write = false) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: { some: activeMembership(userId, write ? writers : undefined) },
        },
      },
      select: {
        id: true,
        organizationId: true,
        timezone: true,
        primaryResident: {
          select: { firstName: true, preferredName: true, displayName: true },
        },
      },
    });
    if (!home) throw new ForbiddenException('Access denied');
    const residentName =
      home.primaryResident?.firstName?.trim() ||
      home.primaryResident?.preferredName?.trim().split(/\s+/)[0] ||
      home.primaryResident?.displayName.trim().split(/\s+/)[0] ||
      null;
    return { ...home, residentName };
  }

  async list(userId: string, query: LiaisonQuery) {
    const home = await this.home(userId);
    const now = new Date();
    const appointmentEnd = scheduledDate(
      shiftDateKey(localDateKey(now, home.timezone), 8),
      0,
      home.timezone,
    );
    if (
      query.cursor &&
      !(await this.prisma.liaisonEntry.findFirst({ where: { id: query.cursor, homeId: home.id } }))
    ) {
      throw new NotFoundException('Entry not found');
    }
    const [items, memberships, visits, appointments, openTasks] = await Promise.all([
      this.prisma.liaisonEntry.findMany({
        where: {
          homeId: home.id,
          ...(query.filter === 'ALL'
            ? {}
            : { kind: 'TASK', completedAt: query.filter === 'OPEN' ? null : { not: null } }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: people,
      }),
      this.prisma.membership.findMany({
        where: { organizationId: home.organizationId, disabledAt: null },
        select: { userId: true, systemRole: true, user: person },
      }),
      this.prisma.visit.findMany({
        where: {
          homeId: home.id,
          startsAt: {
            gte: new Date(Date.now() - 30 * 86400000),
            lte: new Date(Date.now() + 90 * 86400000),
          },
        },
        orderBy: { startsAt: 'asc' },
        include: { completedBy: person },
      }),
      this.prisma.appointment.findMany({
        where: { homeId: home.id, startsAt: { gte: now, lt: appointmentEnd } },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          location: true,
          notes: true,
        },
      }),
      this.prisma.liaisonEntry.findMany({
        where: { homeId: home.id, kind: 'TASK', completedAt: null },
        orderBy: [{ dueOn: 'asc' }, { createdAt: 'desc' }],
        take: 3,
        include: people,
      }),
    ]);
    const page = items.slice(0, query.limit);
    return {
      items: page,
      nextCursor: items.length > query.limit ? page.at(-1)!.id : null,
      openTasks,
      members: memberships
        .filter((m) => writers.some((role) => role === m.systemRole))
        .map((m) => m.user),
      currentUser: memberships.find((m) => m.userId === userId)?.user,
      canWrite: memberships.some(
        (m) => m.userId === userId && writers.some((role) => role === m.systemRole),
      ),
      timezone: home.timezone,
      residentName: home.residentName,
      today: localDateKey(now, home.timezone),
      visits,
      appointments,
    };
  }

  async create(userId: string, input: LiaisonCreate) {
    const home = await this.home(userId, true);
    if (input.kind === 'TASK' && input.assigneeId) {
      const member = await this.prisma.membership.findFirst({
        where: {
          organizationId: home.organizationId,
          ...activeMembership(input.assigneeId, writers),
        },
      });
      if (!member) throw new BadRequestException('Choose an active caregiver in this household');
    }
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.liaisonEntry.create({
        data: { ...input, tags: input.tags ?? [], homeId: home.id, authorId: userId },
        include: people,
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'LIAISON_CREATED',
          target: entry.id,
          metadata: { kind: input.kind },
        },
      });
      return entry;
    });
  }

  async update(userId: string, id: string, input: LiaisonUpdate) {
    const home = await this.home(userId, true);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`liaison:${home.id}:false:${id}`}))`;
      const item = await tx.liaisonEntry.findFirst({ where: { id, homeId: home.id } });
      if (!item) throw new NotFoundException('Entry not found');
      const updated = await tx.liaisonEntry.update({
        where: { id },
        data: { body: input.body, ...(input.tags ? { tags: input.tags } : {}) },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'LIAISON_UPDATED',
          target: id,
          metadata: { kind: item.kind },
        },
      });
      return updated;
    });
  }

  async remove(userId: string, id: string) {
    const home = await this.home(userId, true);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`liaison:${home.id}:false:${id}`}))`;
      const item = await tx.liaisonEntry.findFirst({ where: { id, homeId: home.id } });
      if (!item) throw new NotFoundException('Entry not found');
      await tx.liaisonEntry.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'LIAISON_DELETED',
          target: id,
          metadata: { kind: item.kind },
        },
      });
      return { id, deleted: true };
    });
  }

  async complete(userId: string, id: string, completed: boolean, visit = false) {
    const home = await this.home(userId, true);
    return this.prisma.$transaction(async (tx) => {
      // Serialize competing confirmations: repeating “done” preserves the original author and time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`liaison:${home.id}:${visit}:${id}`}))`;
      const item = visit
        ? await tx.visit.findFirst({ where: { id, homeId: home.id } })
        : await tx.liaisonEntry.findFirst({ where: { id, homeId: home.id, kind: 'TASK' } });
      if (!item) throw new NotFoundException('Item not found');
      if (visit && completed && item && 'startsAt' in item && item.startsAt > new Date()) {
        throw new BadRequestException('A future visit cannot be completed');
      }
      if (Boolean(item.completedAt) === completed) return { id, completedAt: item.completedAt };
      const data = {
        completedAt: completed ? new Date() : null,
        completedById: completed ? userId : null,
      };
      if (visit) await tx.visit.update({ where: { id }, data });
      else await tx.liaisonEntry.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: visit ? 'VISIT_COMPLETION_CHANGED' : 'LIAISON_COMPLETION_CHANGED',
          target: id,
          metadata: { completed },
        },
      });
      return { id, ...data };
    });
  }
}
