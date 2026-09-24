import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  calendarRecurrenceSchema,
  type CalendarCreate,
  type CalendarUpdate,
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership } from '../auth/access-policy';
import { scheduledDate } from '../medications/medication-time';

const writers = ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] as const;
type Scope = 'ONE' | 'SERIES';

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour') % 24,
    minute: value('minute'),
  };
}
function dateKey(parts: ReturnType<typeof localParts>) {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}
function nextKey(key: string, recurrence: string) {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (recurrence === 'DAILY') result.setUTCDate(result.getUTCDate() + 1);
  if (recurrence === 'WEEKLY') result.setUTCDate(result.getUTCDate() + 7);
  if (recurrence === 'MONTHLY') {
    const originalDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(originalDay, last));
  }
  return result.toISOString().slice(0, 10);
}

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  private async home(userId: string, write = false) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: { some: activeMembership(userId, write ? writers : undefined) },
        },
      },
      select: { id: true, timezone: true },
    });
    if (!home) throw new ForbiddenException('Access denied');
    return home;
  }

  private occurrences(input: CalendarCreate, timezone: string) {
    const start = new Date(input.startsAt);
    const end = input.endsAt ? new Date(input.endsAt) : null;
    if (!Number.isFinite(start.getTime()) || (end && end < start))
      throw new BadRequestException('Invalid event dates');
    const recurrence = input.recurrence ?? 'NONE';
    if (recurrence === 'NONE') return [{ startsAt: start, endsAt: end }];
    const until = input.recurrenceUntil
      ? new Date(input.recurrenceUntil)
      : new Date(start.getTime() + 365 * 86400000);
    const hardLimit = new Date(start.getTime() + 366 * 86400000);
    if (until < start || until > hardLimit)
      throw new BadRequestException('Recurrence must stay within the next 12 months');
    const parts = localParts(start, timezone);
    const minute = parts.hour * 60 + parts.minute;
    const duration = end ? end.getTime() - start.getTime() : null;
    const result: Array<{ startsAt: Date; endsAt: Date | null }> = [];
    let key = dateKey(parts);
    for (let index = 0; index < 400; index += 1) {
      const occurrenceStart = scheduledDate(key, minute, timezone);
      if (occurrenceStart > until) break;
      result.push({
        startsAt: occurrenceStart,
        endsAt: duration === null ? null : new Date(occurrenceStart.getTime() + duration),
      });
      key = nextKey(key, recurrence);
    }
    return result;
  }

  async list(userId: string, from: Date, to: Date) {
    const home = await this.home(userId);
    const [visits, appointments] = await Promise.all([
      this.prisma.visit.findMany({
        where: { homeId: home.id, startsAt: { gte: from, lte: to } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { homeId: home.id, startsAt: { gte: from, lte: to } },
        orderBy: { startsAt: 'asc' },
      }),
    ]);
    return {
      items: [
        ...visits.map((item) => ({
          id: item.id,
          type: 'VISIT' as const,
          title: item.visitorName,
          startsAt: item.startsAt.toISOString(),
          endsAt: item.endsAt?.toISOString() ?? null,
          detail: null,
          notes: item.notes,
          seriesId: item.seriesId,
          recurrence: calendarRecurrenceSchema.catch('NONE').parse(item.recurrence),
          recurrenceUntil: item.recurrenceUntil?.toISOString() ?? null,
        })),
        ...appointments.map((item) => ({
          id: item.id,
          type: 'APPOINTMENT' as const,
          title: item.title,
          startsAt: item.startsAt.toISOString(),
          endsAt: item.endsAt?.toISOString() ?? null,
          detail: item.location,
          notes: item.notes,
          seriesId: item.seriesId,
          recurrence: calendarRecurrenceSchema.catch('NONE').parse(item.recurrence),
          recurrenceUntil: item.recurrenceUntil?.toISOString() ?? null,
        })),
      ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
      timezone: home.timezone,
      canWrite: Boolean(
        await this.prisma.membership.findFirst({
          where: {
            userId,
            organization: { homes: { some: { id: home.id } } },
            disabledAt: null,
            systemRole: { in: [...writers] },
          },
        }),
      ),
    };
  }

  async create(userId: string, input: CalendarCreate) {
    const home = await this.home(userId, true);
    const seriesId = input.recurrence === 'NONE' ? null : randomUUID();
    const occurrences = this.occurrences(input, home.timezone);
    return this.prisma.$transaction(async (tx) => {
      const rows = [] as Array<{ id: string }>;
      for (const occurrence of occurrences) {
        if (input.type === 'VISIT') {
          rows.push(
            await tx.visit.create({
              data: {
                homeId: home.id,
                visitorName: input.visitorName,
                startsAt: occurrence.startsAt,
                endsAt: occurrence.endsAt,
                notes: input.notes,
                seriesId,
                recurrence: input.recurrence,
                recurrenceUntil: input.recurrenceUntil ? new Date(input.recurrenceUntil) : null,
              },
              select: { id: true },
            }),
          );
        } else {
          rows.push(
            await tx.appointment.create({
              data: {
                homeId: home.id,
                title: input.title,
                startsAt: occurrence.startsAt,
                endsAt: occurrence.endsAt,
                location: input.location,
                notes: input.notes,
                seriesId,
                recurrence: input.recurrence,
                recurrenceUntil: input.recurrenceUntil ? new Date(input.recurrenceUntil) : null,
              },
              select: { id: true },
            }),
          );
        }
      }
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'CALENDAR_CREATED',
          target: rows[0]?.id ?? seriesId ?? 'calendar',
          metadata: { type: input.type, recurrence: input.recurrence, seriesId },
        },
      });
      await tx.$executeRaw`SELECT pg_notify('michel_updates', ${JSON.stringify({ homeId: home.id, type: 'schedule', entityId: rows[0]?.id })})`;
      return { id: rows[0]?.id, seriesId, count: rows.length };
    });
  }

  async update(userId: string, id: string, input: CalendarUpdate) {
    const home = await this.home(userId, true);
    const scope: Scope = input.scope ?? 'ONE';
    return this.prisma.$transaction(async (tx) => {
      const existingVisit = await tx.visit.findFirst({ where: { id, homeId: home.id } });
      const existingAppointment = existingVisit
        ? null
        : await tx.appointment.findFirst({ where: { id, homeId: home.id } });
      const existing = existingVisit ?? existingAppointment;
      if (!existing) throw new NotFoundException('Event not found');
      const seriesId = existing.seriesId;
      const where =
        scope === 'SERIES' && seriesId ? { homeId: home.id, seriesId } : { id, homeId: home.id };
      const title = input.type === 'APPOINTMENT' ? input.title : input.visitorName;
      const recurrenceData = {
        recurrence: input.recurrence,
        recurrenceUntil: input.recurrenceUntil ? new Date(input.recurrenceUntil) : null,
      };
      if (existingVisit)
        await tx.visit.updateMany({
          where,
          data: {
            visitorName: title,
            notes: input.notes,
            ...recurrenceData,
            ...(scope === 'ONE'
              ? {
                  startsAt: new Date(input.startsAt),
                  endsAt: input.endsAt ? new Date(input.endsAt) : null,
                }
              : {}),
          },
        });
      else
        await tx.appointment.updateMany({
          where,
          data: {
            title,
            location: input.type === 'APPOINTMENT' ? input.location : existingAppointment!.location,
            notes: input.notes,
            ...recurrenceData,
            ...(scope === 'ONE'
              ? {
                  startsAt: new Date(input.startsAt),
                  endsAt: input.endsAt ? new Date(input.endsAt) : null,
                }
              : {}),
          },
        });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'CALENDAR_UPDATED',
          target: id,
          metadata: { scope, seriesId },
        },
      });
      await tx.$executeRaw`SELECT pg_notify('michel_updates', ${JSON.stringify({ homeId: home.id, type: 'schedule', entityId: id })})`;
      return { id, scope };
    });
  }

  async remove(userId: string, id: string, scope: Scope) {
    const home = await this.home(userId, true);
    return this.prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({
        where: { id, homeId: home.id },
        select: { seriesId: true },
      });
      const appointment = visit
        ? null
        : await tx.appointment.findFirst({
            where: { id, homeId: home.id },
            select: { seriesId: true },
          });
      const existing = visit ?? appointment;
      if (!existing) throw new NotFoundException('Event not found');
      if (scope === 'SERIES' && existing.seriesId) {
        await tx.visit.deleteMany({ where: { homeId: home.id, seriesId: existing.seriesId } });
        await tx.appointment.deleteMany({
          where: { homeId: home.id, seriesId: existing.seriesId },
        });
      } else {
        await tx.visit.deleteMany({ where: { id, homeId: home.id } });
        await tx.appointment.deleteMany({ where: { id, homeId: home.id } });
      }
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'CALENDAR_DELETED',
          target: id,
          metadata: { scope, seriesId: existing.seriesId },
        },
      });
      await tx.$executeRaw`SELECT pg_notify('michel_updates', ${JSON.stringify({ homeId: home.id, type: 'schedule', entityId: id })})`;
      return { id, scope };
    });
  }
}
