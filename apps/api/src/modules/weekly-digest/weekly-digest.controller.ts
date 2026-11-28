import {
  weeklyDigestLanguage,
  weeklyDigestPdfQuerySchema,
  weeklyDigestQuerySchema,
} from '@elise/contracts';
import { Controller, Get, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { parseRequest } from '../../platform/zod-validation';
import { LOCALE_HEADER } from '../../platform/i18n/locale.interceptor';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { WeeklyDigestService } from './weekly-digest.service';

/** Weekly digest of the notebook, for every member of the household who can read the notebook. */
@Controller('weekly-digest')
@UseGuards(SessionGuard)
export class WeeklyDigestController {
  public constructor(private readonly digests: WeeklyDigestService) {}

  /** The latest ready digest, or the week holding `?week=YYYY-MM-DD`. */
  @Get()
  public digest(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.digests.digest(request.userId, parseRequest(weeklyDigestQuerySchema, query).week);
  }

  /** The same digest as a one-page A4 PDF, made on the box, for the doctor or the nurse. */
  @Get('pdf')
  public async pdf(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(weeklyDigestPdfQuerySchema, query);
    const header = request.headers[LOCALE_HEADER];
    const language =
      typeof (query as Record<string, unknown> | null)?.lang === 'string'
        ? input.lang
        : weeklyDigestLanguage(typeof header === 'string' ? header : undefined);
    const file = await this.digests.pdf(request.userId, input.week, language);
    response.set({
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(Buffer.from(file.bytes), { type: 'application/pdf' });
  }
}
