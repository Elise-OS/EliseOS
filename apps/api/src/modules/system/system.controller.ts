import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { updateCredentialsSchema } from '@michel/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../../platform/prisma.service';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { parseRequest } from '../../platform/zod-validation';
import { UpdateAgentClient } from './update-agent.client';

@ApiTags('system')
@Controller('system')
export class SystemController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly updateAgent: UpdateAgentClient,
  ) {}

  @Get('health')
  public async health(): Promise<Record<string, unknown>> {
    await this.prisma.$queryRaw`SELECT 1`;
    const equipment = await this.prisma.equipmentSyncState.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        bridgeConnected: true,
        homeAssistantSeenAt: true,
        inventorySeenAt: true,
        entityCount: true,
        deviceCount: true,
      },
    });
    return {
      status: 'ok',
      service: 'michel-core',
      version: process.env.MICHEL_VERSION ?? 'dev',
      localOnly: true,
      integrations: {
        homeAssistant: {
          connected: equipment?.bridgeConnected ?? false,
          lastSeenAt: equipment?.homeAssistantSeenAt ?? null,
          inventorySeenAt: equipment?.inventorySeenAt ?? null,
          entities: equipment?.entityCount ?? 0,
          devices: equipment?.deviceCount ?? 0,
        },
      },
    };
  }

  @Get('update')
  @UseGuards(SessionGuard)
  public updateStatus(@Req() request: AuthenticatedRequest) {
    return this.withAdministrator(request, () => this.updateAgent.status());
  }

  @Post('update/check')
  @UseGuards(SessionGuard)
  public checkUpdate(@Req() request: AuthenticatedRequest) {
    return this.withAdministrator(request, () => this.updateAgent.check());
  }

  @Put('update/credentials')
  @UseGuards(SessionGuard)
  public saveUpdateCredentials(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const credentials = parseRequest(updateCredentialsSchema, body);
    return this.withAdministrator(request, () => this.updateAgent.credentials(credentials));
  }

  @Delete('update/credentials')
  @UseGuards(SessionGuard)
  public deleteUpdateCredentials(@Req() request: AuthenticatedRequest) {
    return this.withAdministrator(request, () => this.updateAgent.deleteCredentials());
  }

  @Post('update/install')
  @HttpCode(202)
  @UseGuards(SessionGuard)
  public installUpdate(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const version = parseRequest(updateVersionSchema, body).version;
    return this.withAdministrator(request, () => this.updateAgent.install(version));
  }

  private async withAdministrator<T>(request: Request, action: () => Promise<T>): Promise<T> {
    const gateway = request.header('x-elise-gateway');
    if (gateway !== 'local' && gateway !== 'remote') {
      throw new ForbiddenException('Les mises à jour exigent le réseau local ou Tailscale.');
    }
    const userId = (request as AuthenticatedRequest).userId;
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        disabledAt: null,
        systemRole: { in: ['OWNER', 'ADMINISTRATOR'] },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('Droits administrateur requis.');
    return action();
  }
}

const updateVersionSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/),
});
