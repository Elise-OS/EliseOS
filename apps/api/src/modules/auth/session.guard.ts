import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../platform/prisma.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(private readonly prisma: PrismaService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer ?? (request.cookies?.michel_session as string | undefined);
    if (!token) throw new UnauthorizedException('Authentication required');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException('Session expired');
    const activeMembership = await this.prisma.membership.findFirst({
      where: { userId: session.userId, disabledAt: null },
      select: { id: true },
    });
    if (!activeMembership) throw new UnauthorizedException('Access disabled');
    const passwordChangeRoute = request.path.endsWith('/auth/change-password');
    const logoutRoute = request.path.endsWith('/auth/logout');
    const meRoute = request.path.endsWith('/auth/me');
    if (session.user.mustChangePassword && !passwordChangeRoute && !logoutRoute && !meRoute) {
      throw new ForbiddenException('Password change required');
    }
    (request as AuthenticatedRequest).userId = session.userId;
    (request as AuthenticatedRequest).sessionId = session.id;
    return true;
  }
}
