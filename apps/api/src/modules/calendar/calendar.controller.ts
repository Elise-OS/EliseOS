import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  calendarCreateSchema,
  calendarDeleteSchema,
  calendarUpdateSchema,
} from '@michel/contracts';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { CalendarService } from './calendar.service';
import { z } from 'zod';

const rangeSchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 86400000)),
  to: z.coerce.date().default(() => new Date(Date.now() + 365 * 86400000)),
});

@Controller('calendar')
@UseGuards(SessionGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const range = parseRequest(rangeSchema, query);
    return this.calendar.list(req.userId, range.from, range.to);
  }
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.calendar.create(req.userId, parseRequest(calendarCreateSchema, body));
  }
  @Patch(':id')
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.calendar.update(req.userId, id, parseRequest(calendarUpdateSchema, body));
  }
  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.calendar.remove(req.userId, id, parseRequest(calendarDeleteSchema, query).scope);
  }
}
