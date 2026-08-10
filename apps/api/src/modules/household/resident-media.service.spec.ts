import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResidentMediaService } from './resident-media.service';

describe('ResidentMediaService', () => {
  let mediaRoot: string | undefined;

  afterEach(async () => {
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    delete process.env.MEDIA_ROOT;
    mediaRoot = undefined;
  });

  it('stores, reads and removes a local WebP while keeping only its path in PostgreSQL', async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'elise-media-'));
    process.env.MEDIA_ROOT = mediaRoot;
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
      Buffer.from('local-image'),
    ]);
    const prisma = {
      resident: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'resident-1' })
          .mockResolvedValueOnce({
            photoPath: 'residents/resident-1.webp',
            photoMimeType: 'image/webp',
          })
          .mockResolvedValueOnce({ id: 'resident-1' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ photoPath: 'residents/resident-1.webp' }),
        update: vi.fn().mockResolvedValue({ id: 'resident-1' }),
      },
    };
    const service = new ResidentMediaService(prisma as never);

    await expect(
      service.save('admin-1', 'resident-1', {
        buffer: webp,
        mimetype: 'image/webp',
        size: webp.length,
      }),
    ).resolves.toEqual({ photoUrl: '/api/v1/residents/resident-1/photo' });
    expect(await readFile(join(mediaRoot, 'residents/resident-1.webp'))).toEqual(webp);
    expect(prisma.resident.update).toHaveBeenCalledWith({
      where: { id: 'resident-1' },
      data: { photoPath: 'residents/resident-1.webp', photoMimeType: 'image/webp' },
    });

    await expect(service.read('admin-1', 'resident-1')).resolves.toEqual({
      content: webp,
      mimeType: 'image/webp',
    });
    await service.remove('admin-1', 'resident-1');
    await expect(readFile(join(mediaRoot, 'residents/resident-1.webp'))).rejects.toThrow();
    expect(prisma.resident.update).toHaveBeenLastCalledWith({
      where: { id: 'resident-1' },
      data: { photoPath: null, photoMimeType: null },
    });
  });
});
