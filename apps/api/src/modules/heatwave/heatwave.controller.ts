import {
  heatwaveManualSchema,
  heatwaveRegistrySchema,
  heatwaveSettingsSchema,
} from '@elise/contracts';
import { Body, Controller, Get, Headers, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { HeatwaveService } from './heatwave.service';

const reminderId = z.string().trim().min(1).max(100);

/** Heatwave mode for the family: card, settings (owner/administrator), on/off and registry. */
@Controller('heatwave')
@UseGuards(SessionGuard)
export class HeatwaveController {
  public constructor(private readonly heatwave: HeatwaveService) {}

  @Get()
  public status(@Req() request: AuthenticatedRequest) {
    return this.heatwave.status(request.userId);
  }

  @Put('settings')
  public settings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.heatwave.updateSettings(request.userId, parseRequest(heatwaveSettingsSchema, body));
  }

  @Post('manual')
  public manual(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.heatwave.setManual(request.userId, parseRequest(heatwaveManualSchema, body).active);
  }

  @Post('registry')
  public registry(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.heatwave.acknowledgeRegistry(
      request.userId,
      parseRequest(heatwaveRegistrySchema, body).year,
    );
  }

  /** The TV preview opened from the family space. */
  @Get('screen')
  public screen(@Req() request: AuthenticatedRequest) {
    return this.heatwave.screenForUser(request.userId);
  }

  @Post('reminders/:id/confirm')
  public confirm(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.heatwave.confirmForUser(request.userId, parseRequest(reminderId, id));
  }
}

/** The paired TV of the resident, authenticated by its screen token. */
@Controller('screen-device/heatwave')
export class HeatwaveScreenDeviceController {
  public constructor(private readonly heatwave: HeatwaveService) {}

  @Get()
  public screen(@Headers('x-screen-token') token: string) {
    return this.heatwave.screenForToken(token);
  }

  @Post('reminders/:id/confirm')
  public confirm(@Headers('x-screen-token') token: string, @Param('id') id: string) {
    return this.heatwave.confirmForToken(token, parseRequest(reminderId, id));
  }
}
