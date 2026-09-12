import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import { RemoteAccessService } from './remote-access.service';

const connectSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
});

@ApiTags('remote-access')
@Controller('remote-access')
export class RemoteAccessController {
  public constructor(private readonly remoteAccess: RemoteAccessService) {}

  @Get('status')
  public status(@Req() request: Request) {
    return this.remoteAccess.status(request);
  }

  @Post('connect')
  @HttpCode(200)
  public connect(@Req() request: Request, @Body() body: unknown) {
    return this.remoteAccess.connect(request, parseRequest(connectSchema, body).hostname);
  }

  @Post('enable')
  @HttpCode(200)
  public enable(@Req() request: Request) {
    return this.remoteAccess.enable(request);
  }

  @Post('disable')
  @HttpCode(200)
  public disable(@Req() request: Request) {
    return this.remoteAccess.disable(request);
  }
}
