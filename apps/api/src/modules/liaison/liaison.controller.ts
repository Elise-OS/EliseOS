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
  liaisonCompletionSchema,
  liaisonCreateSchema,
  liaisonQuerySchema,
  liaisonUpdateSchema,
} from '@michel/contracts';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { LiaisonService } from './liaison.service';

@Controller('liaison')
@UseGuards(SessionGuard)
export class LiaisonController {
  constructor(private readonly liaison: LiaisonService) {}
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.liaison.list(req.userId, parseRequest(liaisonQuerySchema, query));
  }
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.liaison.create(req.userId, parseRequest(liaisonCreateSchema, body));
  }
  @Patch(':id')
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.liaison.update(req.userId, id, parseRequest(liaisonUpdateSchema, body));
  }
  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.liaison.remove(req.userId, id);
  }
  @Patch(':id/completion')
  complete(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.liaison.complete(
      req.userId,
      id,
      parseRequest(liaisonCompletionSchema, body).completed,
    );
  }
  @Patch('visits/:id/completion')
  visit(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.liaison.complete(
      req.userId,
      id,
      parseRequest(liaisonCompletionSchema, body).completed,
      true,
    );
  }
}
