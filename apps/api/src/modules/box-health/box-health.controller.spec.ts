import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BoxHealthController } from './box-health.controller';

const req = (gateway: string) =>
  ({
    userId: 'user-1',
    sessionId: 'session-1',
    header: vi.fn(() => gateway),
  }) as unknown as Request & { userId: string; sessionId: string };
type MembershipQuery = {
  where: { userId: string; disabledAt: null; systemRole: { in: string[] } };
  select: { id: true };
};
function build(member: { id: string } | null) {
  const prisma = {
    membership: {
      findFirst: vi.fn((query: MembershipQuery) => {
        void query;
        return Promise.resolve(member);
      }),
    },
  };
  const health = { report: vi.fn().mockResolvedValue({ verdict: 'ok' }) };
  const agent = { backup: vi.fn().mockResolvedValue({ accepted: true }) };
  return {
    prisma,
    health,
    agent,
    controller: new BoxHealthController(prisma as never, health as never, agent as never),
  };
}

describe('BoxHealthController access', () => {
  it('refuses requests without an administrator membership or trusted gateway', async () => {
    const denied = build(null);
    await expect(denied.controller.report(req('local'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(denied.controller.backup(req('remote'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const untrusted = build({ id: 'member' });
    await expect(untrusted.controller.report(req('internet'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(denied.health.report).not.toHaveBeenCalled();
    expect(denied.agent.backup).not.toHaveBeenCalled();
  });
  it('allows an administrator and restricts the lookup to configuration managers', async () => {
    const allowed = build({ id: 'member' });
    await expect(allowed.controller.report(req('local'))).resolves.toEqual({ verdict: 'ok' });
    expect(allowed.prisma.membership.findFirst.mock.calls[0]?.[0]).toEqual({
      where: { userId: 'user-1', disabledAt: null, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } },
      select: { id: true },
    });
  });
});
