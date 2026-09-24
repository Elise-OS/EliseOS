import { Body, Controller, Delete, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { NotificationsService } from './notifications.service';

const subscriptionSchema = z.object({
  expoPushToken: z.string().regex(/^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/),
  platform: z.enum(['IOS', 'ANDROID']),
  deviceName: z.string().trim().min(1).max(150).optional(),
});

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  public constructor(private readonly notifications: NotificationsService) {}

  @Put('subscriptions')
  public subscribe(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.notifications.subscribe(
      request.userId,
      request.sessionId,
      parseRequest(subscriptionSchema, body),
    );
  }

  @Delete('subscriptions/:id')
  public remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notifications.remove(request.userId, id);
  }

  @Post('test')
  public test(@Req() request: AuthenticatedRequest) {
    return this.notifications.test(request.userId);
  }
}
