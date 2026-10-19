import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { CamerasService } from './cameras.service';

@ApiTags('cameras')
@Controller('cameras')
@UseGuards(SessionGuard)
export class CamerasController {
  public constructor(private readonly cameras: CamerasService) {}

  @Get()
  public list(@Req() request: AuthenticatedRequest) {
    return this.cameras.list(request.userId);
  }

  @Post('network-discovery')
  public discoverNetwork(@Req() request: AuthenticatedRequest) {
    return this.cameras.discoverNetwork(request.userId);
  }

  @Post('network')
  public createNetworkCamera(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.cameras.createNetworkCamera(request.userId, body);
  }

  @Get('recordings')
  public recordings(@Req() request: AuthenticatedRequest) {
    return this.cameras.listRecordings(request.userId);
  }

  @Get('recordings/:id/video')
  public recordingVideo(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.cameras.recordingVideo(request.userId, id);
  }

  @Patch(':id')
  public update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.cameras.update(request.userId, id, body);
  }

  @Post(':id/live-session')
  public live(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.cameras.liveSession(request.userId, id, false);
  }

  @Post(':id/talk-session')
  public talk(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.cameras.liveSession(request.userId, id, true);
  }

  @Patch(':id/privacy')
  public privacy(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.cameras.setPrivacy(request.userId, id, body);
  }
}

@Controller('cameras/media-auth')
export class CameraMediaAuthController {
  public constructor(private readonly cameras: CamerasService) {}

  @Get()
  public async authorize(
    @Query('ticket') ticket = '',
    @Query('src') streamKey = '',
    @Query('talk') talk = '0',
    @Query('path') requestedPath = '',
  ) {
    if (
      requestedPath !== '/camera-media/api/webrtc' ||
      !(await this.cameras.authorizeMedia(ticket, streamKey, talk === '1'))
    ) {
      throw new ForbiddenException();
    }
    return { authorized: true };
  }
}
