import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LiaisonCreate, LiaisonQuery } from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership } from '../auth/access-policy';

const writers = ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] as const;
const person = { select: { id: true, displayName: true } };
const people = { author: person, assignee: person, completedBy: person };

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
      select: { id: true, organizationId: true, timezone: true },
    });
    if (!home) throw new ForbiddenException('Access denied');
    return home;
  }

  async list(userId: string, query: LiaisonQuery) {
    const home = await this.home(userId);
    if (
      query.cursor &&
      !(await this.prisma.liaisonEntry.findFirst({ where: { id: query.cursor, homeId: home.id } }))
    ) {
      throw new NotFoundException('Entry not found');
    }
    const [items, memberships, visits, openTasks] = await Promise.all([
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
      today: new Intl.DateTimeFormat('en-CA', { timeZone: home.timezone }).format(new Date()),
      visits,
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
