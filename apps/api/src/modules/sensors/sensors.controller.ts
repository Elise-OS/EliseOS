import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { SensorsService } from './sensors.service';

@ApiTags('sensors')
@Controller('sensor-devices')
@UseGuards(SessionGuard)
export class SensorsController {
  public constructor(private readonly sensors: SensorsService) {}

  @Get()
  public list(@Req() request: AuthenticatedRequest) {
    return this.sensors.list(request.userId);
  }

  @Get('protocols')
  public protocols(@Req() request: AuthenticatedRequest) {
    return this.sensors.protocols(request.userId);
  }

  @Post('onboarding-sessions')
  public createOnboarding(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.sensors.createOnboarding(request.userId, body);
  }

  @Get('onboarding-sessions/current')
  public currentOnboarding(@Req() request: AuthenticatedRequest) {
    return this.sensors.currentOnboarding(request.userId);
  }

  @Get('onboarding-sessions/:id')
  public onboarding(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sensors.onboarding(request.userId, id);
  }

  @Post('onboarding-sessions/:id/complete')
  public completeOnboarding(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sensors.completeOnboarding(request.userId, id, body);
  }

  @Delete('onboarding-sessions/:id')
  public cancel(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sensors.cancelOnboarding(request.userId, id);
  }

  @Patch(':id')
  public update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sensors.update(request.userId, id, body);
  }

  @Delete(':id')
  public remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sensors.remove(request.userId, id);
  }

  @Post(':id/classifications')
  public confirm(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sensors.confirm(request.userId, id, body);
  }

  @Post(':id/commands')
  public command(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sensors.command(request.userId, id, body);
  }

  @Get(':id/placement-guide')
  public guide(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sensors.guide(request.userId, id);
  }

  @Post(':id/verification-sessions')
  public verify(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sensors.startVerification(request.userId, id);
  }

  @Get('verification-sessions/:id')
  public verification(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sensors.verification(request.userId, id);
  }
}
