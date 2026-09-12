import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { RemoteAccessStatus } from '@michel/contracts';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../platform/prisma.service';
import { RemoteAccessAgentClient } from './remote-access-agent.client';

@Injectable()
export class RemoteAccessService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly agent: RemoteAccessAgentClient,
  ) {}

  public async status(request: Request): Promise<RemoteAccessStatus> {
    await this.authorize(request);
    const result = await this.agent.status();
    return this.isLocal(request) ? result : { ...result, authUrl: null };
  }

  public async connect(request: Request, hostname?: string): Promise<RemoteAccessStatus> {
    await this.authorizeLocalAction(request);
    return this.agent.connect(hostname);
  }

  public async enable(request: Request): Promise<RemoteAccessStatus> {
    await this.authorizeLocalAction(request);
    return this.agent.enable();
  }

  public async disable(request: Request): Promise<RemoteAccessStatus> {
    await this.authorizeLocalAction(request);
    return this.agent.disable();
  }

  private async authorizeLocalAction(request: Request): Promise<void> {
    if (!this.isLocal(request)) {
      throw new ForbiddenException('Remote access settings can only be changed from home');
    }
    await this.authorize(request);
  }

  private async authorize(request: Request): Promise<void> {
    if ((await this.prisma.user.count()) === 0) {
      if (!this.isLocal(request)) throw new ForbiddenException('Local setup only');
      return;
    }

    const authorization = request.header('authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer ?? (request.cookies?.michel_session as string | undefined);
    if (!token) throw new UnauthorizedException('Authentication required');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    if (!session || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: session.userId,
        disabledAt: null,
        systemRole: { in: ['OWNER', 'ADMINISTRATOR'] },
      },
    });
    if (!membership) throw new ForbiddenException('Administrator access required');
  }

  private isLocal(request: Request): boolean {
    return request.header('x-elise-gateway') === 'local';
  }
}
