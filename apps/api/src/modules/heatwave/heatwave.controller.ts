import {
  heatwaveManualSchema,
  heatwaveRegistrySchema,
  heatwaveSettingsSchema,
} from '@elise/contracts';
import { Body, Controller, Get, Headers, Post, Put, Req, UseGuards } from '@nestjs/common';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { HeatwaveService } from './heatwave.service';

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
}

/** The paired TV of the resident, authenticated by its screen token. It only reads: the TV shows
 * reminders and never asks the resident for anything. */
@Controller('screen-device/heatwave')
export class HeatwaveScreenDeviceController {
  public constructor(private readonly heatwave: HeatwaveService) {}

  @Get()
  public screen(@Headers('x-screen-token') token: string) {
    return this.heatwave.screenForToken(token);
  }
}
