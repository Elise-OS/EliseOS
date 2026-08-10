import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { setupContactSchema } from '@michel/contracts';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ActivityService } from './activity.service';
import { SessionGuard } from '../auth/session.guard';
import { RealtimeService } from './realtime.service';

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

const summaryQuerySchema = z.object({ period: z.enum(['24h', '7d']).default('24h') });
const contactPrioritiesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(100),
});
const sensorRoomSchema = z.object({ roomId: z.string().min(1).nullable() });

const scheduleQuerySchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 86_400_000)),
  to: z.coerce.date().default(() => new Date(Date.now() + 90 * 86_400_000)),
});

@ApiTags('household')
@Controller()
@UseGuards(SessionGuard)
export class ActivityController {
  public constructor(
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('overview')
  public overview(@Req() request: AuthenticatedRequest) {
    return this.activity.overview(request.userId);
  }

  @Get('activity')
  public timeline(@Req() request: AuthenticatedRequest, @Query('limit') limit?: string) {
    const query = parseRequest(timelineQuerySchema, { limit: limit ?? 50 });
    return this.activity.timeline(request.userId, query.limit);
  }

  @Get('activity/feed')
  public activityFeed(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const query = parseRequest(feedQuerySchema, { limit: limit ?? 30, cursor });
    return this.activity.activityFeed(request.userId, query.limit, query.cursor);
  }

  @Get('analytics/activity')
  public summary(@Req() request: AuthenticatedRequest, @Query('period') period?: string) {
    const query = parseRequest(summaryQuerySchema, { period: period ?? '24h' });
    return this.activity.summary(request.userId, query.period);
  }

  @Get('household')
  public household(@Req() request: AuthenticatedRequest) {
    return this.activity.household(request.userId);
  }

  @Patch('household/contacts/priorities')
  public reorderContacts(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseRequest(contactPrioritiesSchema, body);
    return this.activity.reorderContacts(request.userId, input.orderedIds);
  }

  @Post('household/contacts')
  public createContact(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseRequest(setupContactSchema, body);
    return this.activity.createContact(request.userId, input);
  }

  @Patch('household/sensors/:sensorId/room')
  public assignSensor(
    @Req() request: AuthenticatedRequest,
    @Param('sensorId') sensorId: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(sensorRoomSchema, body);
    return this.activity.assignSensor(request.userId, sensorId, input.roomId);
  }

  @Get('schedule')
  public schedule(
    @Req() request: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const query = parseRequest(scheduleQuerySchema, { from, to });
    return this.activity.schedule(request.userId, query.from, query.to);
  }

  @Get('journal')
  public journal(@Req() request: AuthenticatedRequest) {
    return this.activity.journal(request.userId);
  }

  @Get('journal/feed')
  public journalFeed(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const query = parseRequest(feedQuerySchema, { limit: limit ?? 30, cursor });
    return this.activity.journalFeed(request.userId, query.limit, query.cursor);
  }

  @Sse('events')
  public events(@Req() request: AuthenticatedRequest): Observable<{ data: unknown }> {
    return this.realtime.forUser(request.userId);
  }
}
