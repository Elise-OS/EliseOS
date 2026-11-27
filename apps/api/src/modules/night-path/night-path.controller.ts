import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { NightPathService } from './night-path.service';

/** Night path lighting: soft light on the resident's way at night. */
@ApiTags('night-paths')
@Controller('night-paths')
@UseGuards(SessionGuard)
export class NightPathController {
  public constructor(private readonly nightPaths: NightPathService) {}

  @Get()
  public overview(@Req() request: AuthenticatedRequest) {
    return this.nightPaths.overview(request.userId);
  }

  @Post()
  public create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.nightPaths.create(request.userId, body);
  }

  @Post('test')
  public test(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.nightPaths.test(request.userId, body);
  }

  @Patch(':id')
  public update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.nightPaths.update(request.userId, id, body);
  }

  @Delete(':id')
  public remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.nightPaths.remove(request.userId, id);
  }
}
