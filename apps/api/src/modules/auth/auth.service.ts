import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Prisma } from '@prisma/client';
import type { Installation } from '@michel/contracts';
import type { AccessCapability, MembershipRole } from '@michel/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership, capabilitiesFor } from './access-policy';

interface PublicUser {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
  role: MembershipRole;
  capabilities: AccessCapability[];
}

interface AuthenticatedSession {
  token: string;
  user: PublicUser;
  homeId?: string;
  residentId?: string;
}

@Injectable()
export class AuthService {
  public constructor(private readonly prisma: PrismaService) {}

  public async setupState(): Promise<{ setupRequired: boolean; systemReady: true }> {
    return { setupRequired: (await this.prisma.user.count()) === 0, systemReady: true };
  }

  public async loginOptions(): Promise<
    Array<{ id: string; displayName: string; identifier: string }>
  > {
    const users = await this.prisma.user.findMany({
      where: {
        memberships: { some: { disabledAt: null } },
        OR: [{ username: { not: null } }, { email: { not: null } }],
      },
      select: { id: true, displayName: true, username: true, email: true },
      orderBy: { displayName: 'asc' },
    });
    return users.flatMap((user) => {
      const identifier = user.username ?? user.email;
      return identifier ? [{ id: user.id, displayName: user.displayName, identifier }] : [];
    });
  }

  public async bootstrapEquipment(token?: string) {
    const configured = (await this.prisma.user.count()) > 0;
    let userId: string | undefined;
    if (configured) {
      if (!token) throw new UnauthorizedException('Authentication required');
      const session = await this.prisma.session.findUnique({
        where: { tokenHash: this.digest(token) },
        include: { user: { include: { memberships: true } } },
      });
      if (!session || session.expiresAt <= new Date()) {
        throw new UnauthorizedException('Session expired');
      }
      if (
        session.user.mustChangePassword ||
        !session.user.memberships.some(
          (membership) =>
            !membership.disabledAt && ['OWNER', 'ADMINISTRATOR'].includes(membership.systemRole),
        )
      ) {
        throw new ForbiddenException('Administrator access required');
      }
      userId = session.userId;
    }
    const sensors = await this.prisma.sensor.findMany({
      ...(userId
        ? {
            where: {
              home: {
                organization: {
                  memberships: {
                    some: {
                      userId,
                      disabledAt: null,
                      systemRole: { in: ['OWNER', 'ADMINISTRATOR'] as const },
                    },
                  },
                },
              },
            },
          }
        : {}),
      include: { device: true },
      orderBy: { entityId: 'asc' },
    });
    return sensors.map((sensor) => ({
      id: sensor.id,
      name: sensor.device?.name ?? sensor.entityId,
      type: sensor.capability,
      roomId: '',
      status: sensor.status === 'ONLINE' ? ('online' as const) : ('offline' as const),
    }));
  }

  public async login(identifier: string, password: string): Promise<AuthenticatedSession> {
    const normalized = identifier.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: normalized }, { email: normalized }],
        memberships: { some: { disabledAt: null } },
      },
      include: { memberships: { where: { disabledAt: null }, take: 1 } },
    });
    if (!user || !(await verify(user.passwordHash, password)))
      throw new UnauthorizedException('Invalid credentials');

    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: this.digest(token),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return { token, user: this.publicUser(user, user.memberships[0]!.systemRole) };
  }

  public async bootstrap(input: {
    email?: string | undefined;
    displayName: string;
    password: string;
    installation: Installation;
  }): Promise<AuthenticatedSession> {
    const passwordHash = await hash(input.password);
    const token = randomBytes(32).toString('base64url');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296649292)`;
      if ((await tx.user.count()) > 0) throw new ConflictException('Élise is already configured');

      const organization = await tx.organization.create({ data: { name: 'Ma famille' } });
      const user = await tx.user.create({
        data: {
          username: input.installation.username.toLowerCase(),
          email: input.email?.toLowerCase() ?? null,
          displayName: input.displayName,
          passwordHash,
        },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, systemRole: 'OWNER' },
      });

      const setup = input.installation;
      const home = await tx.home.create({
        data: {
          id: process.env.MICHEL_HOME_ID?.trim() || 'home_demo',
          organizationId: organization.id,
          name: `Logement de ${setup.resident.dailyName}`,
          timezone: setup.timezone,
          type: 'Maison',
          address: null,
          floorCount: 1,
          installationStatus: 'DRAFT',
          learningStartedAt: null,
        },
      });
      const birthYear = /^\d{4}-/.test(setup.resident.birthDate)
        ? Number(setup.resident.birthDate.slice(0, 4))
        : undefined;
      const resident = await tx.resident.create({
        data: {
          homeId: home.id,
          displayName: `${setup.resident.firstName} ${setup.resident.lastName}`.trim(),
          birthYear: birthYear ?? null,
          firstName: setup.resident.firstName,
          lastName: setup.resident.lastName,
          preferredName: setup.resident.dailyName,
          birthDate: setup.resident.birthDate
            ? new Date(`${setup.resident.birthDate}T12:00:00.000Z`)
            : null,
          spokenLanguage: setup.resident.language,
          formOfAddress: this.formOfAddress(setup),
        },
      });
      await tx.home.update({ where: { id: home.id }, data: { primaryResidentId: resident.id } });
      await tx.caregiverProfile.create({
        data: {
          userId: user.id,
          residentId: resident.id,
          relation: setup.caregiver.relation,
          isPrimary: true,
        },
      });
      await tx.residentContext.create({
        data: {
          residentId: resident.id,
          livesAlone: setup.life.length ? setup.life.includes('alone') : null,
          livesWithPartner: setup.life.length ? setup.life.includes('partner') : null,
          livesWithRelative: setup.life.length ? setup.life.includes('relative') : null,
          receivesHomeHelp: setup.life.length ? setup.life.includes('home_help') : null,
          receivesVisits: setup.life.length ? setup.life.includes('visits') : null,
          hasPet: setup.life.length ? setup.life.includes('pet') : null,
          mobility: this.mobility(setup.mobility),
          hearingDifficulty: setup.senses.length ? setup.senses.includes('hearing') : null,
          visualDifficulty: setup.senses.length ? setup.senses.includes('vision') : null,
        },
      });
      const needKinds: Array<
        'MEMORY' | 'PARKINSON' | 'FALL_RISK' | 'VISION' | 'HEARING' | 'OTHER'
      > = setup.important.map((need) => this.supportNeed(need));
      if (setup.importantNote) needKinds.push('OTHER');
      if (needKinds.length) {
        await tx.supportNeed.createMany({
          data: [...new Set(needKinds)].map((kind) => ({
            residentId: resident.id,
            kind,
            note: kind === 'OTHER' ? setup.importantNote : null,
          })),
        });
      }
      await tx.trustedContact.create({
        data: {
          homeId: home.id,
          residentId: resident.id,
          userId: user.id,
          firstName: setup.caregiver.firstName,
          lastName: setup.caregiver.lastName,
          relation: setup.caregiver.relation,
          email: input.email ?? null,
          isEmergency: false,
          priority: 0,
        },
      });
      for (const [kind, habit] of Object.entries(setup.habits)) {
        await tx.habitProfile.create({
          data: {
            homeId: home.id,
            residentId: resident.id,
            kind,
            status: habit.unknown ? 'UNKNOWN' : 'PROVIDED',
            source: 'ONBOARDING',
            startMinute: habit.unknown ? null : this.timeToMinute(habit.from),
            endMinute: habit.unknown ? null : this.timeToMinute(habit.to),
            parameters: { unknown: habit.unknown },
          },
        });
      }
      const sanitizedSetup = this.sanitizeInstallation(setup);
      await tx.configurationRevision.create({
        data: { homeId: home.id, version: 1, settings: sanitizedSetup as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: user.id,
          action: 'ENVIRONMENT_CREATED',
          target: home.id,
          metadata: { residentId: resident.id },
        },
      });
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: this.digest(token),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });

      return {
        token,
        user: this.publicUser(user, 'OWNER'),
        homeId: home.id,
        residentId: resident.id,
      };
    });
  }

  public async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const membership = await this.prisma.membership.findFirst({ where: activeMembership(userId) });
    if (!membership) throw new ForbiddenException('Access disabled');
    return this.publicUser(user, membership.systemRole);
  }

  public async changePassword(userId: string, newPassword: string): Promise<PublicUser> {
    const passwordHash = await hash(newPassword);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    const membership = await this.prisma.membership.findFirstOrThrow({
      where: activeMembership(userId),
    });
    return this.publicUser(user, membership.systemRole);
  }

  public async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  private publicUser(
    user: {
      id: string;
      displayName: string;
      username: string | null;
      email: string | null;
      phone: string | null;
      mustChangePassword: boolean;
    },
    role: MembershipRole,
  ): PublicUser {
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      mustChangePassword: user.mustChangePassword,
      role,
      capabilities: capabilitiesFor(role),
    };
  }

  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private mobility(
    value: Installation['mobility'],
  ): 'INDEPENDENT' | 'CANE' | 'WALKER' | 'WHEELCHAIR' | 'UNKNOWN' {
    return (
      {
        independent: 'INDEPENDENT',
        cane: 'CANE',
        walker: 'WALKER',
        wheelchair: 'WHEELCHAIR',
        unknown: 'UNKNOWN',
      } as const
    )[value];
  }

  private supportNeed(
    value: Installation['important'][number],
  ): 'MEMORY' | 'PARKINSON' | 'FALL_RISK' | 'VISION' | 'HEARING' {
    return {
      memory: 'MEMORY',
      parkinson: 'PARKINSON',
      fall: 'FALL_RISK',
      vision: 'VISION',
      hearing: 'HEARING',
    }[value] as 'MEMORY' | 'PARKINSON' | 'FALL_RISK' | 'VISION' | 'HEARING';
  }

  private timeToMinute(value: string): number {
    const [hour = 0, minute = 0] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  private formOfAddress(setup: Installation): string {
    const resident = setup.resident;
    if (resident.addressAs === 'grandmother') return `Mamie ${resident.dailyName}`;
    if (resident.addressAs === 'grandfather') return `Papi ${resident.dailyName}`;
    if (resident.addressAs === 'formal-f') return `Madame ${resident.lastName}`;
    if (resident.addressAs === 'formal-m') return `Monsieur ${resident.lastName}`;
    if (resident.addressAs === 'nickname') return resident.customAddress || resident.dailyName;
    return resident.dailyName;
  }

  private sanitizeInstallation(setup: Installation): Record<string, unknown> {
    return { ...setup };
  }
}
