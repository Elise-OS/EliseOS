import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DiscoveryInfo } from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';

const INSTANCE_ID_KEY = 'discovery.instanceId';

@Injectable()
export class DiscoveryService {
  public constructor(private readonly prisma: PrismaService) {}

  public async info(): Promise<DiscoveryInfo> {
    const [instanceId, userCount] = await Promise.all([
      this.instanceId(),
      this.prisma.user.count(),
    ]);
    return {
      instanceId,
      instanceName: process.env.MICHEL_DISCOVERY_NAME?.trim() || 'Élise OS',
      version: process.env.MICHEL_VERSION ?? 'dev',
      apiVersion: 1,
      serverTime: new Date().toISOString(),
      supportsMobile: true,
      setupRequired: userCount === 0,
    };
  }

  private async instanceId(): Promise<string> {
    const configured = process.env.MICHEL_INSTANCE_ID?.trim();
    if (configured) return configured;

    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: INSTANCE_ID_KEY },
    });
    if (existing) return existing.value;

    const value = randomUUID();
    try {
      const created = await this.prisma.systemSetting.create({
        data: { key: INSTANCE_ID_KEY, value },
      });
      return created.value;
    } catch {
      const raced = await this.prisma.systemSetting.findUniqueOrThrow({
        where: { key: INSTANCE_ID_KEY },
      });
      return raced.value;
    }
  }
}
