import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { MqttIngestionService } from '../sensing/mqtt-ingestion.service';
import { EquipmentService } from './equipment.service';

const pairingSchema = z.object({ durationSeconds: z.number().int().min(60).max(254).default(180) });
const discoveryAdvanceSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

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

  @Get('items')
  public items(@Req() request: AuthenticatedRequest) {
    return this.equipment.items(request.userId);
  }

  @Get('discoveries/:id')
  public discovery(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.equipment.discovery(request.userId, id);
  }

  @Post('discoveries/:id/advance')
  public async advanceDiscovery(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(discoveryAdvanceSchema, body ?? {});
    const discovery = await this.equipment.prepareDiscoveryCommand(request.userId, id, 'advance');
    const result = await this.mqtt.executeDiscoveryCommand({
      flowId: discovery.flowId,
      action: 'advance',
      userInput: input.input,
    });
    const updated = await this.equipment.recordDiscoveryResult(id, result);
    if (result.status === 'completed') {
      const homeId = await this.equipment.markSyncRequested(request.userId);
      this.mqtt.requestInventory(homeId);
    }
    return updated;
  }

  @Post('discoveries/:id/ignore')
  public async ignoreDiscovery(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const discovery = await this.equipment.prepareDiscoveryCommand(request.userId, id, 'ignore');
    const result = await this.mqtt.executeDiscoveryCommand({
      flowId: discovery.flowId,
      title: discovery.title,
      action: 'ignore',
    });
    return this.equipment.recordDiscoveryResult(id, result);
  }

  @Post('actions')
  public async executeAction(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const command = await this.equipment.prepareAction(request.userId, body);
    this.mqtt.executeHomeAssistantCommand(command);
    return { accepted: true };
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
