import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ZigbeeController } from './zigbee.controller';

const request = (gateway: 'local' | 'remote' | undefined) =>
  ({
    userId: 'admin',
    sessionId: 'session',
    header: vi.fn((name: string) =>
      name.toLowerCase() === 'x-elise-gateway' ? gateway : undefined,
    ),
  }) as unknown as Request & { userId: string; sessionId: string };

function build(membership: { id: string } | null = { id: 'membership' }) {
  const prisma = { membership: { findFirst: vi.fn().mockResolvedValue(membership) } };
  const agent = {
    status: vi.fn().mockResolvedValue({ state: 'READY' }),
    scan: vi.fn().mockResolvedValue({ state: 'NO_KEY' }),
    probe: vi.fn().mockResolvedValue({ answered: true }),
    testNetwork: vi.fn().mockResolvedValue({ answered: true }),
    forgetNetwork: vi.fn().mockResolvedValue({ state: 'NO_KEY' }),
    install: vi.fn().mockResolvedValue({ state: 'RUNNING' }),
    installProgress: vi.fn().mockResolvedValue({ state: 'RUNNING' }),
    cancelInstall: vi.fn().mockResolvedValue({ state: 'RUNNING' }),
  };
  return { prisma, agent, controller: new ZigbeeController(prisma as never, agent as never) };
}

const installation = {
  candidateId: 'a1b2c3d4e5f6',
  adapter: 'ember',
  baudrate: 115200,
  rtscts: false,
};

describe('ZigbeeController access', () => {
  it('lets the owner or an administrator in from the local network and from Tailscale', async () => {
    const { controller, prisma } = build();
    await expect(controller.status(request('local'))).resolves.toEqual({ state: 'READY' });
    await expect(controller.status(request('remote'))).resolves.toEqual({ state: 'READY' });
    // Only the roles that hold "configuration:manage" are accepted.
    const lookup = prisma.membership.findFirst.mock.calls[0]?.[0] as {
      where: { systemRole: { in: string[] }; disabledAt: null };
    };
    expect(lookup.where.systemRole.in).toEqual(['OWNER', 'ADMINISTRATOR']);
    expect(lookup.where.disabledAt).toBeNull();
  });

  it('refuses caregivers, viewers and requests outside the two trusted gateways', async () => {
    const refused = build(null);
    for (const call of [
      () => refused.controller.status(request('local')),
      () => refused.controller.scan(request('local'), {}),
      () => refused.controller.probe(request('local'), { candidateId: 'a1b2c3d4e5f6' }),
      () => refused.controller.install(request('local'), installation),
      () => refused.controller.cancelInstall(request('local')),
    ])
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    const open = build();
    await expect(open.controller.install(request(undefined), installation)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    for (const method of Object.values(refused.agent)) expect(method).not.toHaveBeenCalled();
    expect(open.agent.install).not.toHaveBeenCalled();
  });
});

describe('ZigbeeController requests', () => {
  it('forwards a valid installation with the default of keeping the Zigbee network', async () => {
    const { controller, agent } = build();
    await controller.install(request('local'), installation);
    expect(agent.install).toHaveBeenCalledWith({ ...installation, networkMode: 'keep' });
  });

  it('rejects dangerous or incomplete installations before the agent sees them', async () => {
    const { controller, agent } = build();
    for (const body of [
      {},
      { ...installation, candidateId: undefined },
      { ...installation, port: '/etc/passwd', candidateId: undefined },
      { ...installation, adapter: 'ezsp' },
      { ...installation, baudrate: 1 },
      { ...installation, networkMode: 'new' },
      { ...installation, candidateId: '../../etc' },
    ])
      await expect(controller.install(request('local'), body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    expect(agent.install).not.toHaveBeenCalled();
  });

  it('allows a new Zigbee network only with an explicit confirmation', async () => {
    const { controller, agent } = build();
    await controller.install(request('local'), {
      ...installation,
      networkMode: 'new',
      confirmNewNetwork: true,
    });
    expect(agent.install).toHaveBeenCalledWith(
      expect.objectContaining({ networkMode: 'new', confirmNewNetwork: true }),
    );
  });

  it('scans USB only by default and the network when asked', async () => {
    const { controller, agent } = build();
    await controller.scan(request('local'), undefined);
    await controller.scan(request('local'), { network: true });
    expect(agent.scan).toHaveBeenNthCalledWith(1, false);
    expect(agent.scan).toHaveBeenNthCalledWith(2, true);
  });

  it('validates the probe, the network test and the forget request', async () => {
    const { controller, agent } = build();
    await expect(controller.probe(request('local'), { candidateId: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.testNetwork(request('local'), { host: 'a;b' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await controller.testNetwork(request('local'), { host: '192.168.1.50' });
    expect(agent.testNetwork).toHaveBeenCalledWith('192.168.1.50', 6638);
    await controller.forgetNetwork(request('local'), { candidateId: 'a1b2c3d4e5f6' });
    expect(agent.forgetNetwork).toHaveBeenCalledWith('a1b2c3d4e5f6');
  });
});
