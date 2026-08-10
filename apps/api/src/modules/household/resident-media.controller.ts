import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { ResidentMediaService } from './resident-media.service';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('residents/:residentId/photo')
@UseGuards(SessionGuard)
export class ResidentMediaController {
  public constructor(private readonly media: ResidentMediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 8_000_000, files: 1 } }))
  public upload(
    @Req() request: AuthenticatedRequest,
    @Param('residentId') residentId: string,
    @UploadedFile() file?: UploadedImage,
  ) {
    if (!file) throw new BadRequestException('Resident photo is required');
    return this.media.save(request.userId, residentId, file);
  }

  @Get()
  public async get(@Req() request: AuthenticatedRequest, @Param('residentId') residentId: string) {
    const photo = await this.media.read(request.userId, residentId);
    return new StreamableFile(photo.content, { type: photo.mimeType });
  }

  @Delete()
  @HttpCode(204)
  public remove(@Req() request: AuthenticatedRequest, @Param('residentId') residentId: string) {
    return this.media.remove(request.userId, residentId);
  }
}
