import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { SystemController } from './system.controller';

const request = (gateway: 'local' | 'remote' | undefined) =>
  ({
    userId: 'admin',
    sessionId: 'session',
    header: vi.fn((name: string) =>
      name.toLowerCase() === 'x-elise-gateway' ? gateway : undefined,
    ),
  }) as unknown as Request & { userId: string; sessionId: string };

describe('SystemController update endpoints', () => {
  it('allows an administrator on local and Tailscale gateways', async () => {
    const prisma = {
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };
    const updateAgent = { status: vi.fn().mockResolvedValue({ state: 'UP_TO_DATE' }) };
    const controller = new SystemController(prisma as never, updateAgent as never);

    await expect(controller.updateStatus(request('local'))).resolves.toEqual({
      state: 'UP_TO_DATE',
    });
    await expect(controller.updateStatus(request('remote'))).resolves.toEqual({
      state: 'UP_TO_DATE',
    });
  });

  it('refuses viewers and requests outside the two trusted gateways', async () => {
    const prisma = { membership: { findFirst: vi.fn().mockResolvedValue(null) } };
    const updateAgent = { status: vi.fn() };
    const controller = new SystemController(prisma as never, updateAgent as never);

    await expect(controller.updateStatus(request('local'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.updateStatus(request(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateAgent.status).not.toHaveBeenCalled();
  });
});
