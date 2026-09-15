import { appointmentPictogramSchema, screenMessageSchema } from '@michel/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { interval, startWith, switchMap } from 'rxjs';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ScreenService } from './screen.service';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Controller('screen')
@UseGuards(SessionGuard)
export class ScreenController {
  constructor(private readonly screens: ScreenService) {}
  @Sse('events') events(@Req() r: AuthenticatedRequest) {
    return interval(2000).pipe(
      startWith(0),
      switchMap(async () => {
        await this.screens.snapshot(r.userId);
        return { data: { type: 'screen' } };
      }),
    );
  }
  @Post('mobile-session') mobileSession(@Req() r: AuthenticatedRequest, @Res() res: Response) {
    const bearer = r.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!bearer) throw new BadRequestException();
    res.cookie('michel_session', bearer, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    res.redirect(303, '/screen-control');
  }
  @Get() state(@Req() r: AuthenticatedRequest) {
    return this.screens.snapshot(r.userId);
  }
  @Get('host') host(@Req() r: AuthenticatedRequest) {
    return this.screens.hostStatus(r.userId);
  }
  @Post('host/pair') hostPair(@Req() r: AuthenticatedRequest) {
    return this.screens.hostPair(r.userId);
  }
  @Post('host/button') buttonDevice(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.screens.buttonDevice(
      r.userId,
      parseRequest(z.object({ path: z.string().max(300) }), b).path,
    );
  }
  @Post('host/network') network(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.screens.network(
      r.userId,
      parseRequest(
        z.object({
          enabled: z.boolean(),
          primaryInterface: z.string().max(40).optional(),
          apn: z.string().max(100).optional(),
          pin: z.string().max(8).optional(),
        }),
        b,
      ),
    );
  }
  @Post('pairing') pair(@Req() r: AuthenticatedRequest) {
    return this.screens.pairCode(r.userId);
  }
  @Patch('settings') settings(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.screens.settings(r.userId, b);
  }
  @Patch('message') message(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.screens.message(r.userId, parseRequest(screenMessageSchema, b));
  }
  @Get('appointments') appointments(@Req() r: AuthenticatedRequest) {
    return this.screens.appointments(r.userId);
  }
  @Post('appointments') appointment(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    const input = parseRequest(
      z.object({
        title: z.string().trim().min(1).max(150),
        startsAt: z.coerce.date(),
        pictogram: appointmentPictogramSchema.default('calendar'),
      }),
      b,
    );
    return this.screens.addAppointment(r.userId, input);
  }
  @Patch('appointments/:id') appointmentPictogram(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.screens.updateAppointmentPictogram(
      r.userId,
      id,
      parseRequest(z.object({ pictogram: appointmentPictogramSchema }), b).pictogram,
    );
  }
  @Delete('appointments/:id') removeAppointment(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.screens.removeAppointment(r.userId, id);
  }
  @Get('radio/search') radioSearch(@Req() r: AuthenticatedRequest, @Query('q') query: string) {
    return this.screens.searchRadio(r.userId, query);
  }
  @Post('commands') command(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.screens.command(r.userId, b);
  }
  @Post('media') media(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.screens.media(r.userId, b);
  }
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  upload(
    @Req() r: AuthenticatedRequest,
    @UploadedFile() f: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!f) throw new BadRequestException();
    return this.screens.upload(r.userId, f);
  }
  @Delete('media/:id') remove(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.screens.removeMedia(r.userId, id);
  }
  @Post('calls') call(@Req() r: AuthenticatedRequest) {
    return this.screens.startCall(r.userId);
  }
  @Delete('calls/:id') end(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.screens.endCall(r.userId, id);
  }
  @Post('calls/:id/join') join(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.screens.join(r.userId, undefined, id);
  }
}
@Controller('screen-device')
export class ScreenDeviceController {
  constructor(private readonly screens: ScreenService) {}
  @Post('pair') pair(@Body() b: unknown) {
    return this.screens.pair(parseRequest(z.object({ code: z.string().max(100) }), b).code);
  }
  @Post('heartbeat') heartbeat(@Headers('x-screen-token') token: string, @Body() b: unknown) {
    return this.screens.heartbeat(
      token,
      parseRequest(z.record(z.string().max(40), z.boolean()), b),
    );
  }
  @Sse('events') events(@Headers('x-screen-token') token: string) {
    return interval(2000).pipe(
      startWith(0),
      switchMap(async () => {
        await this.screens.device(token);
        return { data: { type: 'screen' } };
      }),
    );
  }
  @Post('button') button(@Headers('x-screen-token') t: string) {
    return this.screens.button(t);
  }
  @Post('calls/:id/join') join(@Headers('x-screen-token') t: string, @Param('id') id: string) {
    return this.screens.join(undefined, t, id);
  }
  @Delete('calls/:id') end(@Headers('x-screen-token') t: string, @Param('id') id: string) {
    return this.screens.deviceEnd(t, id);
  }
  @Post('commands/:id/ack') ack(
    @Headers('x-screen-token') t: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.screens.ack(
      t,
      id,
      parseRequest(z.object({ error: z.string().max(200).optional() }), b).error,
    );
  }
  @Post('conference-auth') async conference(
    @Headers('x-elise-auth') signature: string,
    @Body() b: unknown,
  ) {
    const { room, participant } = parseRequest(
      z.object({ room: z.string().max(100), participant: z.string().max(100) }),
      b,
    );
    const expected = createHmac('sha256', process.env.ELISE_JITSI_SECRET ?? '')
      .update(`${room}:${participant}`)
      .digest('hex');
    const a = Buffer.from(signature ?? ''),
      e = Buffer.from(expected);
    if (!process.env.ELISE_JITSI_SECRET || a.length !== e.length || !timingSafeEqual(a, e))
      return { allowed: false };
    return { allowed: await this.screens.authorizeConference(room, participant) };
  }
}
@Controller('screen-media')
@UseGuards(SessionGuard)
export class ScreenMediaController {
  constructor(private readonly screens: ScreenService) {}
  @Get(':home/:id') async file(
    @Req() r: AuthenticatedRequest,
    @Param('home') home: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const f = await this.screens.mediaPath(home, id, r.userId);
    res.type(f.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(f.path);
  }
}
@Controller('screen-device/media')
export class ScreenDeviceMediaController {
  constructor(private readonly screens: ScreenService) {}
  @Get(':home/:id') async file(
    @Headers('x-screen-token') token: string,
    @Param('home') home: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const f = await this.screens.mediaPath(home, id, undefined, token);
    res.type(f.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(f.path);
  }
}
