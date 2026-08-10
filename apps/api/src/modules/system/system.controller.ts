import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../platform/prisma.service';

@ApiTags('system')
@Controller('system')
export class SystemController {
  public constructor(private readonly prisma: PrismaService) {}

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
}
