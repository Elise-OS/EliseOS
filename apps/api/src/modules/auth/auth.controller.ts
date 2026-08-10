import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { installationSchema } from '@michel/contracts';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from './authenticated-request';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(12).max(256),
});

const bootstrapSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  email: z.email().max(254).optional(),
  password: z.string().min(12).max(256),
  installation: installationSchema,
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(12).max(256),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  public constructor(private readonly auth: AuthService) {}

  @Get('setup-state')
  public setupState() {
    return this.auth.setupState();
  }

  @Get('bootstrap-equipment')
  public bootstrapEquipment(@Req() request: Request) {
    const authorization = request.header('authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer ?? (request.cookies?.michel_session as string | undefined);
    return this.auth.bootstrapEquipment(token);
  }

  @Post('login')
  @HttpCode(200)
  public async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parseRequest(loginSchema, body);
    const result = await this.auth.login(input.identifier, input.password);
    this.setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Post('mobile-login')
  @HttpCode(200)
  public async mobileLogin(@Body() body: unknown) {
    const input = parseRequest(loginSchema, body);
    const result = await this.auth.login(input.identifier, input.password);
    return { accessToken: result.token, user: result.user };
  }

  @Post('bootstrap')
  public async bootstrap(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parseRequest(bootstrapSchema, body);
    const result = await this.auth.bootstrap(input);
    this.setSessionCookie(response, result.token);
    return { user: result.user, homeId: result.homeId, residentId: result.residentId };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  public me(@Req() request: AuthenticatedRequest) {
    return this.auth.currentUser(request.userId);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  public async changePassword(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseRequest(changePasswordSchema, body);
    return { user: await this.auth.changePassword(request.userId, input.newPassword) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  public async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(request.sessionId);
    response.clearCookie('michel_session', { path: '/' });
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie('michel_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 30 * 86_400_000,
      path: '/',
    });
  }
}
