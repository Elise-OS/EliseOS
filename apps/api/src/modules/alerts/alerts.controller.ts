import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { alertRuleSettingsSchema } from '@michel/contracts';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AlertsService } from './alerts.service';
import { SessionGuard } from '../auth/session.guard';

const transitionSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']),
  note: z.string().trim().max(1_000).optional(),
});

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

@ApiTags('alerts')
@Controller('alerts')
@UseGuards(SessionGuard)
export class AlertsController {
  public constructor(private readonly alerts: AlertsService) {}

  @Get()
  public list(@Req() request: AuthenticatedRequest) {
    return this.alerts.list(request.userId);
  }

  @Get('feed')
  public feed(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const query = parseRequest(feedQuerySchema, { limit: limit ?? 30, cursor });
    return this.alerts.feed(request.userId, query.limit, query.cursor);
  }

  @Get('rules')
  public rules(@Req() request: AuthenticatedRequest) {
    return this.alerts.rules(request.userId);
  }

  @Patch('rules')
  public updateRules(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.alerts.updateRules(request.userId, parseRequest(alertRuleSettingsSchema, body));
  }

  @Patch(':id')
  public transition(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(transitionSchema, body);
    return this.alerts.transition(request.userId, id, input.status, input.note);
  }
}
