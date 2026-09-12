import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { RemoteAccessStatus } from '@michel/contracts';
import { RemoteAccessService } from './remote-access.service';

const ready: RemoteAccessStatus = {
  state: 'READY',
  installed: true,
  remoteUrl: 'https://elise.example.ts.net:8443',
  hostname: 'elise',
  servePort: 8443,
  keyExpiresAt: null,
  httpsAvailable: true,
  webrtcAvailable: true,
  authUrl: null,
  actionRequired: 'NONE',
};

const request = (gateway: 'local' | 'remote') =>
  ({
    header: vi.fn((name: string) =>
      name.toLowerCase() === 'x-elise-gateway' ? gateway : undefined,
    ),
    cookies: {},
  }) as unknown as Request;

describe('RemoteAccessService', () => {
  it('allows status and setup actions locally before the first account exists', async () => {
    const prisma = { user: { count: vi.fn().mockResolvedValue(0) } };
    const agent = {
      status: vi.fn().mockResolvedValue(ready),
      connect: vi.fn().mockResolvedValue(ready),
    };
    const service = new RemoteAccessService(prisma as never, agent as never);

    await expect(service.status(request('local'))).resolves.toEqual(ready);
    await expect(service.connect(request('local'), 'elise')).resolves.toEqual(ready);
  });

  it('always refuses access changes through the remote gateway', async () => {
    const prisma = { user: { count: vi.fn().mockResolvedValue(0) } };
    const agent = { enable: vi.fn() };
    const service = new RemoteAccessService(prisma as never, agent as never);

    await expect(service.enable(request('remote'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(agent.enable).not.toHaveBeenCalled();
  });

  it('hides the interactive authorization URL on the remote gateway', async () => {
    const authorizing = {
      ...ready,
      state: 'AUTHORIZING' as const,
      authUrl: 'https://login.tailscale.com/a/test',
    };
    const prisma = {
      user: { count: vi.fn().mockResolvedValue(1) },
      session: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }),
      },
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
    };
    const agent = { status: vi.fn().mockResolvedValue(authorizing) };
    const remoteRequest = request('remote');
    remoteRequest.cookies = { michel_session: 'secret' };
    const service = new RemoteAccessService(prisma as never, agent as never);

    await expect(service.status(remoteRequest)).resolves.toEqual({ ...authorizing, authUrl: null });
  });
});
