import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { localDateKey } from './medication-time';
import { MedicationsService } from './medications.service';

const scheduleSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  graceMinutes: z.number().int().min(5).max(720).default(60),
  active: z.boolean().optional(),
});

const medicationSchema = z.object({
  name: z.string().trim().min(1).max(150),
  dosage: z.string().trim().min(1).max(150),
  instructions: z.string().trim().max(1_000).optional(),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().optional(),
  schedules: z.array(scheduleSchema).min(1).max(20),
});

const medicationPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    dosage: z.string().trim().min(1).max(150).optional(),
    instructions: z.string().trim().max(1_000).nullable().optional(),
    active: z.boolean().optional(),
    startsOn: z.iso.date().nullable().optional(),
    endsOn: z.iso.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const dosesQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

const confirmationSchema = z.object({
  status: z.enum(['TAKEN', 'SKIPPED']),
  note: z.string().trim().max(500).optional(),
});

@Controller('medications')
@UseGuards(SessionGuard)
export class MedicationsController {
  public constructor(private readonly medications: MedicationsService) {}

  @Get()
  public list(@Req() request: AuthenticatedRequest) {
    return this.medications.list(request.userId);
  }

  @Post()
  public create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.medications.create(request.userId, parseRequest(medicationSchema, body));
  }

  @Get('doses/today')
  public today(@Req() request: AuthenticatedRequest) {
    return this.medications.today(request.userId);
  }

  @Get('doses')
  public doses(
    @Req() request: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fallback = localDateKey(new Date(), 'Europe/Paris');
    const range = parseRequest(dosesQuerySchema, { from: from ?? fallback, to: to ?? fallback });
    return this.medications.doses(request.userId, range.from, range.to);
  }

  @Patch('doses/:doseId')
  public confirm(
    @Req() request: AuthenticatedRequest,
    @Param('doseId') doseId: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(confirmationSchema, body);
    return this.medications.confirm(request.userId, doseId, input.status, input.note);
  }

  @Post(':medicationId/schedules')
  public addSchedule(
    @Req() request: AuthenticatedRequest,
    @Param('medicationId') medicationId: string,
    @Body() body: unknown,
  ) {
    return this.medications.addSchedule(
      request.userId,
      medicationId,
      parseRequest(scheduleSchema, body),
    );
  }

  @Patch('schedules/:scheduleId')
  public updateSchedule(
    @Req() request: AuthenticatedRequest,
    @Param('scheduleId') scheduleId: string,
    @Body() body: unknown,
  ) {
    return this.medications.updateSchedule(
      request.userId,
      scheduleId,
      parseRequest(scheduleSchema, body),
    );
  }

  @Patch(':medicationId')
  public update(
    @Req() request: AuthenticatedRequest,
    @Param('medicationId') medicationId: string,
    @Body() body: unknown,
  ) {
    return this.medications.update(
      request.userId,
      medicationId,
      parseRequest(medicationPatchSchema, body),
    );
  }
}
