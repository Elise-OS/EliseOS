import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PushPlatform } from '@prisma/client';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';

@Injectable()
export class NotificationsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async preferences(userId: string): Promise<NotificationPreferences> {
    await this.assertActiveMember(userId);
    const preferences = await this.prisma.notificationPreference.findUnique({
      where: { userId },
      select: {
        fallDetection: true,
        smoke: true,
        waterLeak: true,
        liaisonMessages: true,
        liaisonMoods: true,
      },
    });
    return preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  }

  public async updatePreferences(
    userId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    await this.assertActiveMember(userId);
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...preferences },
      update: preferences,
      select: {
        fallDetection: true,
        smoke: true,
        waterLeak: true,
        liaisonMessages: true,
        liaisonMoods: true,
      },
    });
  }

  public async subscribe(
    userId: string,
    sessionId: string,
    input: { expoPushToken: string; platform: PushPlatform; deviceName?: string | undefined },
  ) {
    await this.assertActiveMember(userId);
    return this.prisma.pushSubscription.upsert({
      where: { expoPushToken: input.expoPushToken },
      update: {
        userId,
        sessionId,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        sessionId,
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
          memberships: {
            some: {
              userId,
              disabledAt: null,
              systemRole: { in: ['OWNER', 'ADMINISTRATOR'] },
            },
          },
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

  private async assertActiveMember(userId: string): Promise<void> {
    if (
      !(await this.prisma.membership.findFirst({
        where: { userId, disabledAt: null },
        select: { id: true },
      }))
    ) {
      throw new ForbiddenException();
    }
  }
}
