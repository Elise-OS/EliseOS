import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Prisma } from '@prisma/client';
import type { Installation } from '@michel/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../platform/prisma.service';

interface PublicUser {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
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
        !session.user.memberships.some((membership) =>
          ['OWNER', 'ADMINISTRATOR'].includes(membership.systemRole),
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
                    some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] as const } },
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
      where: { OR: [{ username: normalized }, { email: normalized }] },
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
    return { token, user: this.publicUser(user) };
  }

  public async bootstrap(input: {
    email?: string | undefined;
    displayName: string;
    password: string;
    installation: Installation;
  }): Promise<AuthenticatedSession> {
    const passwordHash = await hash(input.password);
    const token = randomBytes(32).toString('base64url');
    const administratorPasswords = new Map<string, string>();
    for (const contact of input.installation.contacts) {
      if (contact.role === 'administrateur' && contact.temporaryPassword) {
        administratorPasswords.set(contact.id, await hash(contact.temporaryPassword));
      }
    }

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
          name: setup.home.name,
          timezone: setup.home.timezone,
          type: setup.home.type,
          address: setup.home.address || null,
          floorCount: setup.home.floors,
          installationStatus: 'LEARNING',
          learningStartedAt: new Date(),
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
      await tx.room.createMany({
        data: setup.rooms.map((room, index) => ({
          homeId: home.id,
          name: room.name,
          kind: room.kind,
          floor: this.floorNumber(room.floor),
          sortOrder: index,
        })),
      });
      await tx.residentContext.create({
        data: {
          residentId: resident.id,
          livesAlone: setup.life.includes('alone'),
          livesWithPartner: setup.life.includes('partner'),
          livesWithRelative: setup.life.includes('relative'),
          receivesHomeHelp: setup.life.includes('home_help'),
          receivesVisits: setup.life.includes('visits'),
          hasPet: setup.life.includes('pet'),
          mobility: this.mobility(setup.mobility),
          hearingDifficulty: setup.senses.includes('hearing'),
          visualDifficulty: setup.senses.includes('vision'),
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
          role: 'ADMINISTRATOR',
          priority: 0,
        },
      });
      for (const [index, contact] of setup.contacts.entries()) {
        let contactUserId: string | undefined;
        if (contact.role === 'administrateur') {
          const password = administratorPasswords.get(contact.id);
          if (!contact.username || !password) throw new Error('Missing administrator credentials');
          const contactUser = await tx.user.create({
            data: {
              username: contact.username.toLowerCase(),
              email: contact.email ? contact.email.toLowerCase() : null,
              phone: contact.phone || null,
              displayName: `${contact.firstName} ${contact.lastName}`.trim(),
              passwordHash: password,
              mustChangePassword: true,
            },
          });
          contactUserId = contactUser.id;
          await tx.membership.create({
            data: {
              organizationId: organization.id,
              userId: contactUser.id,
              systemRole: 'ADMINISTRATOR',
            },
          });
          await tx.caregiverProfile.create({
            data: {
              userId: contactUser.id,
              residentId: resident.id,
              relation: contact.relation || null,
            },
          });
        }
        await tx.trustedContact.create({
          data: {
            homeId: home.id,
            residentId: resident.id,
            userId: contactUserId ?? null,
            firstName: contact.firstName,
            lastName: contact.lastName,
            phone: contact.phone || null,
            email: contact.email ? contact.email.toLowerCase() : null,
            relation: contact.relation || null,
            role: this.contactRole(contact.role),
            priority: index + 1,
          },
        });
      }
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
      const roomIds = new Map(
        (await tx.room.findMany({ where: { homeId: home.id } })).map((room) => [
          room.name,
          room.id,
        ]),
      );
      for (const equipment of setup.equipment) {
        const requestedRoom = setup.rooms.find((room) => room.id === equipment.roomId);
        const roomId = requestedRoom ? roomIds.get(requestedRoom.name) : undefined;
        if (!roomId) throw new Error('Unknown room assignment');
        const updated = await tx.sensor.updateMany({
          where: { id: equipment.id, homeId: home.id },
          data: { roomId },
        });
        if (updated.count !== 1) throw new Error('Unknown equipment');
      }
      const sanitizedSetup = this.sanitizeInstallation(setup);
      await tx.configurationRevision.create({
        data: { homeId: home.id, version: 1, settings: sanitizedSetup as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: user.id,
          action: 'INSTALLATION_COMPLETED',
          target: home.id,
          metadata: { residentId: resident.id, rooms: setup.rooms.length },
        },
      });
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: this.digest(token),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });

      return { token, user: this.publicUser(user), homeId: home.id, residentId: resident.id };
    });
  }

  public async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.publicUser(user);
  }

  public async changePassword(userId: string, newPassword: string): Promise<PublicUser> {
    const passwordHash = await hash(newPassword);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    return this.publicUser(user);
  }

  public async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  private publicUser(user: {
    id: string;
    displayName: string;
    username: string | null;
    email: string | null;
    phone: string | null;
    mustChangePassword: boolean;
  }): PublicUser {
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private mobility(
    value: Installation['mobility'],
  ): 'INDEPENDENT' | 'CANE' | 'WALKER' | 'WHEELCHAIR' {
    return { independent: 'INDEPENDENT', cane: 'CANE', walker: 'WALKER', wheelchair: 'WHEELCHAIR' }[
      value
    ] as 'INDEPENDENT' | 'CANE' | 'WALKER' | 'WHEELCHAIR';
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

  private contactRole(
    value: Installation['contacts'][number]['role'],
  ): 'ADMINISTRATOR' | 'RELATIVE' | 'EMERGENCY' {
    return { administrateur: 'ADMINISTRATOR', proche: 'RELATIVE', urgence: 'EMERGENCY' }[value] as
      'ADMINISTRATOR' | 'RELATIVE' | 'EMERGENCY';
  }

  private floorNumber(value: string): number {
    return value === 'Rez-de-chaussée' ? 0 : Number.parseInt(value, 10) || 0;
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
    return {
      ...setup,
      contacts: setup.contacts.map((contact) => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        relation: contact.relation,
        role: contact.role,
        username: contact.username,
      })),
    };
  }
}
