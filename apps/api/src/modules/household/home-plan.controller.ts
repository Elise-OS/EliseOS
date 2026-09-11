import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { HomePlanService } from './home-plan.service';

@ApiTags('household')
@Controller('household')
@UseGuards(SessionGuard)
export class HomePlanController {
  public constructor(private readonly plans: HomePlanService) {}

  @Get('plan')
  public plan(@Req() request: AuthenticatedRequest) {
    return this.plans.get(request.userId);
  }

  @Put('plan')
  public save(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.plans.save(request.userId, body);
  }

  @Get('presence')
  public presence(@Req() request: AuthenticatedRequest) {
    return this.plans.presence(request.userId);
  }

  @Get('presence/history')
  public presenceHistory(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const query = parseRequest(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().min(1).optional(),
      }),
      { limit, cursor },
    );
    return this.plans.presenceHistory(request.userId, query.limit, query.cursor);
  }

  @Get('plan/equipment-coverage')
  public coverage(@Req() request: AuthenticatedRequest) {
    return this.plans.coverage(request.userId);
  }
}
