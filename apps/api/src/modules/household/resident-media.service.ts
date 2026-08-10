import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaService } from '../../platform/prisma.service';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Injectable()
export class ResidentMediaService {
  private readonly mediaRoot = process.env.MEDIA_ROOT ?? '/var/lib/elise/media';

  public constructor(private readonly prisma: PrismaService) {}

  public async save(userId: string, residentId: string, file: UploadedImage) {
    await this.assertAdministrator(userId, residentId);
    if (
      file.mimetype !== 'image/webp' ||
      file.size > 2_000_000 ||
      file.buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      file.buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
    ) {
      throw new ForbiddenException('Unsupported resident photo');
    }
    const relativePath = join('residents', `${residentId}.webp`);
    const absolutePath = join(this.mediaRoot, relativePath);
    const temporaryPath = `${absolutePath}.tmp`;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(temporaryPath, file.buffer, { mode: 0o600 });
    await rename(temporaryPath, absolutePath);
    await this.prisma.resident.update({
      where: { id: residentId },
      data: { photoPath: relativePath, photoMimeType: 'image/webp' },
    });
    return { photoUrl: `/api/v1/residents/${residentId}/photo` };
  }

  public async read(userId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: {
        id: residentId,
        home: { organization: { memberships: { some: { userId } } } },
      },
      select: { photoPath: true, photoMimeType: true },
    });
    if (!resident?.photoPath) throw new NotFoundException('Resident photo not found');
    return {
      content: await readFile(join(this.mediaRoot, resident.photoPath)),
      mimeType: resident.photoMimeType ?? 'image/webp',
    };
  }

  public async remove(userId: string, residentId: string): Promise<void> {
    await this.assertAdministrator(userId, residentId);
    const resident = await this.prisma.resident.findUniqueOrThrow({
      where: { id: residentId },
      select: { photoPath: true },
    });
    if (resident.photoPath)
      await unlink(join(this.mediaRoot, resident.photoPath)).catch(() => undefined);
    await this.prisma.resident.update({
      where: { id: residentId },
      data: { photoPath: null, photoMimeType: null },
    });
  }

  private async assertAdministrator(userId: string, residentId: string): Promise<void> {
    const resident = await this.prisma.resident.findFirst({
      where: {
        id: residentId,
        home: {
          organization: {
            memberships: {
              some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!resident) throw new ForbiddenException('Administrator access required');
  }
}
