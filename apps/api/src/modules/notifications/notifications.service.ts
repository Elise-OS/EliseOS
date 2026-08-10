import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PushPlatform } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';

@Injectable()
export class NotificationsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async subscribe(
    userId: string,
    input: { expoPushToken: string; platform: PushPlatform; deviceName?: string | undefined },
  ) {
    await this.assertUser(userId);
    return this.prisma.pushSubscription.upsert({
      where: { expoPushToken: input.expoPushToken },
      update: {
        userId,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
      },
      select: { id: true, platform: true, deviceName: true, enabled: true, lastSeenAt: true },
    });
  }

  public async remove(userId: string, id: string) {
    const result = await this.prisma.pushSubscription.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Abonnement de notification introuvable.');
    return { deleted: true };
  }

  public async test(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: { some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } } },
        },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Accès administrateur requis.');
    await this.prisma.outboxMessage.create({
      data: {
        homeId: home.id,
        topic: 'push',
        payload: {
          userId,
          title: 'Élise est bien connectée',
          body: 'Les notifications de votre domicile fonctionnent.',
          kind: 'test',
        },
      },
    });
    return { queued: true };
  }

  private async assertUser(userId: string): Promise<void> {
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      throw new ForbiddenException();
    }
  }
}
