import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  zigbeeForgetSchema,
  zigbeeInstallRequestSchema,
  zigbeeNetworkTestSchema,
  zigbeeProbeRequestSchema,
  zigbeeScanRequestSchema,
} from '@elise/contracts';
import { UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../platform/prisma.service';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { rolesFor } from '../auth/access-policy';
import { SessionGuard } from '../auth/session.guard';
import { ZigbeeAgentClient } from './zigbee-agent.client';

const ZIGBEE_MANAGERS = rolesFor('configuration:manage');

/**
 * The Zigbee key of the box: what is plugged, what runs, and the guided installation of a new one.
 * Hardware is reached through the host agent only, and only by the owner or an administrator
 * coming from the local network or Tailscale.
 */
@ApiTags('zigbee')
@Controller('zigbee/adapter')
@UseGuards(SessionGuard)
export class ZigbeeController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly agent: ZigbeeAgentClient,
  ) {}

  @Get()
  public async status(@Req() request: AuthenticatedRequest) {
    return await this.asManager(request, () => this.agent.status());
  }

  @Post('scan')
  @HttpCode(200)
  public async scan(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const { network } = parseRequest(zigbeeScanRequestSchema, body ?? {});
    return await this.asManager(request, () => this.agent.scan(network === true));
  }

  @Post('probe')
  @HttpCode(200)
  public async probe(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const { candidateId } = parseRequest(zigbeeProbeRequestSchema, body);
    return await this.asManager(request, () => this.agent.probe(candidateId));
  }

  @Post('network/test')
  @HttpCode(200)
  public async testNetwork(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const { host, port } = parseRequest(zigbeeNetworkTestSchema, body);
    return await this.asManager(request, () => this.agent.testNetwork(host, port));
  }

  @Post('network/forget')
  @HttpCode(200)
  public async forgetNetwork(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const { candidateId } = parseRequest(zigbeeForgetSchema, body);
    return await this.asManager(request, () => this.agent.forgetNetwork(candidateId));
  }

  @Post('install')
  @HttpCode(202)
  public async install(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const installation = parseRequest(zigbeeInstallRequestSchema, body);
    return await this.asManager(request, () => this.agent.install({ ...installation }));
  }

  @Get('install')
  public async installProgress(@Req() request: AuthenticatedRequest) {
    return await this.asManager(request, () => this.agent.installProgress());
  }

  @Post('install/cancel')
  @HttpCode(200)
  public async cancelInstall(@Req() request: AuthenticatedRequest) {
    return await this.asManager(request, () => this.agent.cancelInstall());
  }

  private async asManager<T>(request: Request, action: () => Promise<T>): Promise<T> {
    const gateway = request.header('x-elise-gateway');
    if (gateway !== 'local' && gateway !== 'remote') {
      throw new ForbiddenException('La clé Zigbee se gère depuis le réseau local ou Tailscale.');
    }
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: (request as AuthenticatedRequest).userId,
        disabledAt: null,
        systemRole: { in: ZIGBEE_MANAGERS },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('Droits administrateur requis.');
    return action();
  }
}
