import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { MqttIngestionService } from '../sensing/mqtt-ingestion.service';
import { EquipmentService } from './equipment.service';

const pairingSchema = z.object({ durationSeconds: z.number().int().min(60).max(600).default(180) });

@ApiTags('equipment')
@Controller('equipment')
@UseGuards(SessionGuard)
export class EquipmentController {
  public constructor(
    private readonly equipment: EquipmentService,
    private readonly mqtt: MqttIngestionService,
  ) {}

  @Get('status')
  public status(@Req() request: AuthenticatedRequest) {
    return this.equipment.status(request.userId);
  }

  @Get('candidates')
  public candidates(@Req() request: AuthenticatedRequest) {
    return this.equipment.candidates(request.userId);
  }

  @Post('sync')
  public async sync(@Req() request: AuthenticatedRequest) {
    const homeId = await this.equipment.markSyncRequested(request.userId);
    this.mqtt.requestInventory(homeId);
    return { requested: true };
  }

  @Patch('entities/:entityId/mapping')
  public mapping(
    @Req() request: AuthenticatedRequest,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
  ) {
    return this.equipment.updateMapping(request.userId, entityId, body);
  }

  @Post('pairing-sessions')
  public async startPairing(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseRequest(pairingSchema, body ?? {});
    const session = await this.equipment.setPairing(request.userId, true, input.durationSeconds);
    this.mqtt.setZigbeePairing(true, input.durationSeconds);
    return session;
  }

  @Delete('pairing-sessions/current')
  public async stopPairing(@Req() request: AuthenticatedRequest) {
    const session = await this.equipment.setPairing(request.userId, false);
    this.mqtt.setZigbeePairing(false, 0);
    return session;
  }
}
