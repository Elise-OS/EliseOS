import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { rolesFor } from '../auth/access-policy';
import { localDateKey, minuteFromTime, scheduledDate, weekdayForDateKey } from './medication-time';

export interface MedicationInput {
  name: string;
  dosage: string;
  instructions?: string | undefined;
  startsOn?: string | undefined;
  endsOn?: string | undefined;
  schedules: Array<{ time: string; daysOfWeek: number[]; graceMinutes: number }>;
}

export interface MedicationPatch {
  name?: string | undefined;
  dosage?: string | undefined;
  instructions?: string | null | undefined;
  active?: boolean | undefined;
  startsOn?: string | null | undefined;
  endsOn?: string | null | undefined;
}

export interface ScheduleInput {
  time: string;
  daysOfWeek: number[];
  graceMinutes: number;
  active?: boolean | undefined;
}

const MEDICATION_EDITOR_ROLES = rolesFor('medications:manage');

@Injectable()
export class MedicationsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(userId: string) {
    const home = await this.homeFor(userId);
    return this.prisma.medication.findMany({
      where: { homeId: home.id },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { schedules: { orderBy: { minuteOfDay: 'asc' } } },
    });
  }

  public async create(userId: string, input: MedicationInput) {
    const home = await this.homeFor(userId, MEDICATION_EDITOR_ROLES);
    if (!home.primaryResidentId) throw new ForbiddenException('A resident is required');
    return this.prisma.$transaction(async (tx) => {
      const medication = await tx.medication.create({
        data: {
          homeId: home.id,
          residentId: home.primaryResidentId!,
          name: input.name,
          dosage: input.dosage,
          instructions: input.instructions || null,
          startsOn: input.startsOn ? new Date(`${input.startsOn}T12:00:00.000Z`) : null,
          endsOn: input.endsOn ? new Date(`${input.endsOn}T12:00:00.000Z`) : null,
          schedules: {
            create: input.schedules.map((schedule) => ({
              minuteOfDay: minuteFromTime(schedule.time),
              daysOfWeek: schedule.daysOfWeek,
              graceMinutes: schedule.graceMinutes,
            })),
          },
        },
        include: { schedules: true },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'MEDICATION_CREATED',
          target: medication.id,
          metadata: { name: medication.name },
        },
      });
      return medication;
    });
  }

  public async update(userId: string, medicationId: string, input: MedicationPatch) {
    const home = await this.homeFor(userId, MEDICATION_EDITOR_ROLES);
    const existing = await this.prisma.medication.findFirst({
      where: { id: medicationId, homeId: home.id },
    });
    if (!existing) throw new NotFoundException('Medication not found');
    return this.prisma.medication.update({
      where: { id: medicationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.dosage !== undefined ? { dosage: input.dosage } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.startsOn !== undefined
          ? { startsOn: input.startsOn ? new Date(`${input.startsOn}T12:00:00.000Z`) : null }
          : {}),
        ...(input.endsOn !== undefined
          ? { endsOn: input.endsOn ? new Date(`${input.endsOn}T12:00:00.000Z`) : null }
          : {}),
      },
      include: { schedules: true },
    });
  }

  public async addSchedule(userId: string, medicationId: string, input: ScheduleInput) {
    const home = await this.homeFor(userId, MEDICATION_EDITOR_ROLES);
    const medication = await this.prisma.medication.findFirst({
      where: { id: medicationId, homeId: home.id },
      select: { id: true },
    });
    if (!medication) throw new NotFoundException('Medication not found');
    return this.prisma.medicationSchedule.create({
      data: {
        medicationId,
        minuteOfDay: minuteFromTime(input.time),
        daysOfWeek: input.daysOfWeek,
        graceMinutes: input.graceMinutes,
        active: input.active ?? true,
      },
    });
  }

  public async updateSchedule(userId: string, scheduleId: string, input: ScheduleInput) {
    const home = await this.homeFor(userId, MEDICATION_EDITOR_ROLES);
    const schedule = await this.prisma.medicationSchedule.findFirst({
      where: { id: scheduleId, medication: { homeId: home.id } },
      select: { id: true },
    });
    if (!schedule) throw new NotFoundException('Medication schedule not found');
    return this.prisma.medicationSchedule.update({
      where: { id: scheduleId },
      data: {
        minuteOfDay: minuteFromTime(input.time),
        daysOfWeek: input.daysOfWeek,
        graceMinutes: input.graceMinutes,
        active: input.active ?? true,
      },
    });
  }

  public async doses(userId: string, from: string, to: string) {
    const home = await this.homeFor(userId);
    const dateKeys = this.dateKeys(from, to);
    for (const dateKey of dateKeys) await this.ensureDoses(home, dateKey);
    const rangeStart = scheduledDate(from, 0, home.timezone);
    const rangeEnd = new Date(scheduledDate(to, 23 * 60 + 59, home.timezone).getTime() + 60_000);
    return this.prisma.medicationDose.findMany({
      where: {
        schedule: { medication: { homeId: home.id } },
        scheduledFor: { gte: rangeStart, lt: rangeEnd },
      },
      orderBy: { scheduledFor: 'asc' },
      include: {
        schedule: {
          include: { medication: true },
        },
        confirmedBy: { select: { id: true, displayName: true } },
      },
    });
  }

  public async today(userId: string, now = new Date()) {
    const home = await this.homeFor(userId);
    const dateKey = localDateKey(now, home.timezone);
    return this.doses(userId, dateKey, dateKey);
  }

  public async confirm(userId: string, doseId: string, status: 'TAKEN' | 'SKIPPED', note?: string) {
    const home = await this.homeFor(userId, MEDICATION_EDITOR_ROLES);
    const dose = await this.prisma.medicationDose.findFirst({
      where: { id: doseId, schedule: { medication: { homeId: home.id } } },
    });
    if (!dose) throw new NotFoundException('Medication dose not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.medicationDose.update({
        where: { id: doseId },
        data: { status, confirmedAt: now, confirmedById: userId, note: note || null },
        include: { schedule: { include: { medication: true } } },
      });
      const alert = await tx.alert.findFirst({
        where: {
          homeId: home.id,
          ruleKey: `medication:${doseId}`,
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
      });
      if (alert) {
        await tx.alert.update({
          where: { id: alert.id },
          data: { status: 'RESOLVED', resolvedAt: now },
        });
        await tx.alertTransition.create({
          data: {
            alertId: alert.id,
            userId,
            from: alert.status,
            to: 'RESOLVED',
            note: status === 'TAKEN' ? 'Prise confirmée' : 'Prise ignorée par un aidant',
          },
        });
      }
      return updated;
    });
  }

  private async ensureDoses(
    home: { id: string; timezone: string; primaryResidentId: string | null },
    dateKey: string,
  ): Promise<void> {
    const weekday = weekdayForDateKey(dateKey);
    const medications = await this.prisma.medication.findMany({
      where: {
        homeId: home.id,
        active: true,
        schedules: { some: { active: true, daysOfWeek: { has: weekday } } },
      },
      include: {
        schedules: { where: { active: true, daysOfWeek: { has: weekday } } },
      },
    });
    for (const medication of medications) {
      if (medication.startsOn && localDateKey(medication.startsOn, home.timezone) > dateKey)
        continue;
      if (medication.endsOn && localDateKey(medication.endsOn, home.timezone) < dateKey) continue;
      for (const schedule of medication.schedules) {
        const scheduledFor = scheduledDate(dateKey, schedule.minuteOfDay, home.timezone);
        await this.prisma.medicationDose.upsert({
          where: { scheduleId_scheduledFor: { scheduleId: schedule.id, scheduledFor } },
          create: { scheduleId: schedule.id, scheduledFor },
          update: {},
        });
      }
    }
  }

  private dateKeys(from: string, to: string): string[] {
    const start = new Date(`${from}T12:00:00.000Z`);
    const end = new Date(`${to}T12:00:00.000Z`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (days < 0 || days > 90) throw new ForbiddenException('Invalid medication history range');
    return Array.from({ length: days + 1 }, (_, index) =>
      new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10),
    );
  }

  private async homeFor(userId: string, roles?: MembershipRole[]) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              ...(roles ? { systemRole: { in: roles } } : {}),
            },
          },
        },
      },
      select: { id: true, timezone: true, primaryResidentId: true },
    });
    if (!home) throw new ForbiddenException('Medication access denied');
    return home;
  }
}
