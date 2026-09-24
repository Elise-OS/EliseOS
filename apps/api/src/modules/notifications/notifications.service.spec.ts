import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

describe('push subscriptions', () => {
  it('binds a device token to the current session', async () => {
    const prisma = {
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
      pushSubscription: { upsert: vi.fn().mockResolvedValue({ id: 'subscription-1' }) },
    };
    await new NotificationsService(prisma as never).subscribe('member-1', 'session-1', {
      expoPushToken: 'ExponentPushToken[example]',
      platform: 'IOS',
    });
    const call = prisma.pushSubscription.upsert.mock.calls[0]?.[0] as unknown as {
      update: { userId: string; sessionId: string };
      create: { userId: string; sessionId: string };
    };
    expect(call.update.userId).toBe('member-1');
    expect(call.update.sessionId).toBe('session-1');
    expect(call.create.userId).toBe('member-1');
    expect(call.create.sessionId).toBe('session-1');
  });

  it('rejects a user whose membership has been disabled', async () => {
    const prisma = {
      membership: { findFirst: vi.fn().mockResolvedValue(null) },
      pushSubscription: { upsert: vi.fn() },
    };
    await expect(
      new NotificationsService(prisma as never).subscribe('former-member', 'session-1', {
        expoPushToken: 'ExponentPushToken[example]',
        platform: 'IOS',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: 'former-member', disabledAt: null },
      select: { id: true },
    });
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });
});
