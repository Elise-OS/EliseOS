import { Controller, ForbiddenException, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../../platform/prisma.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { rolesFor } from '../auth/access-policy';
import { HealthAgentClient } from './health-agent.client';
import { BoxHealthService } from './box-health.service';

@ApiTags('system')
@Controller('system/box-health')
@UseGuards(SessionGuard)
export class BoxHealthController {
  public constructor(private readonly prisma: PrismaService, private readonly health: BoxHealthService, private readonly agent: HealthAgentClient) {}
  @Get() public report(@Req() request: AuthenticatedRequest) { return this.asManager(request, () => this.health.report()); }
  @Post('backup') @HttpCode(202) public backup(@Req() request: AuthenticatedRequest) { return this.asManager(request, () => this.agent.backup()); }
  private async asManager<T>(request: Request, action: () => Promise<T>): Promise<T> {
    if (!['local', 'remote'].includes(request.header('x-elise-gateway') ?? '')) throw new ForbiddenException('La santé de la box est réservée au réseau local ou Tailscale.');
    const membership = await this.prisma.membership.findFirst({ where: { userId: (request as AuthenticatedRequest).userId, disabledAt: null, systemRole: { in: rolesFor('configuration:manage') } }, select: { id: true } });
    if (!membership) throw new ForbiddenException('Droits administrateur requis.');
    return action();
  }
}
