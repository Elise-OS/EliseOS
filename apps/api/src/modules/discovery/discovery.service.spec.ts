import { describe, expect, it, vi } from 'vitest';
import { DiscoveryService } from './discovery.service';

describe('DiscoveryService', () => {
  it('returns stable public metadata and setup state', async () => {
    const settings = new Map<string, { key: string; value: string }>();
    const prisma = {
      user: { count: vi.fn().mockResolvedValue(0) },
      systemSetting: {
        findUnique: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(settings.get(where.key)),
        ),
        create: vi.fn(({ data }: { data: { key: string; value: string } }) => {
          settings.set(data.key, data);
          return Promise.resolve(data);
        }),
        findUniqueOrThrow: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(settings.get(where.key)),
        ),
      },
    };
    const service = new DiscoveryService(prisma as never);

    const first = await service.info();
    const second = await service.info();

    expect(first.instanceId).toBe(second.instanceId);
    expect(first).toEqual(
      expect.objectContaining({
        instanceName: 'Élise OS',
        apiVersion: 1,
        supportsMobile: true,
        setupRequired: true,
      }),
    );
    expect(prisma.systemSetting.create).toHaveBeenCalledTimes(1);
  });
});
