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
import { ApiTags } from '@nestjs/swagger';
import {
  createPersonSchema,
  updatePersonAccessSchema,
  updatePersonSchema,
} from '@michel/contracts';
import { z } from 'zod';
import { parseRequest } from '../../platform/zod-validation';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { PeopleService } from './people.service';

@ApiTags('people')
@Controller('household/people')
@UseGuards(SessionGuard)
export class PeopleController {
  public constructor(private readonly people: PeopleService) {}

  @Get()
  public list(@Req() request: AuthenticatedRequest, @Query('archived') archived?: string) {
    const query = parseRequest(z.object({ archived: z.coerce.boolean().default(false) }), {
      archived: archived ?? false,
    });
    return this.people.list(request.userId, query.archived);
  }

  @Post()
  public create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.people.create(request.userId, parseRequest(createPersonSchema, body));
  }

  @Patch(':id')
  public update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.update(request.userId, id, parseRequest(updatePersonSchema, body));
  }

  @Patch(':id/access')
  public access(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.updateAccess(
      request.userId,
      id,
      parseRequest(updatePersonAccessSchema, body),
    );
  }

  @Delete(':id')
  public archive(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.people.archive(request.userId, id);
  }
}
