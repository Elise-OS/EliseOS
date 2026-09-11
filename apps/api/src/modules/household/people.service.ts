import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type {
  CreatePerson,
  MembershipRole,
  UpdatePerson,
  UpdatePersonAccess,
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { activeMembership } from '../auth/access-policy';

@Injectable()
export class PeopleService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(userId: string, includeArchived = false) {
    const context = await this.context(userId);
    const contacts = await this.prisma.trustedContact.findMany({
      where: { homeId: context.homeId, ...(includeArchived ? {} : { archivedAt: null }) },
      include: {
        user: { include: { memberships: { where: { organizationId: context.organizationId } } } },
      },
      orderBy: [{ archivedAt: 'asc' }, { priority: 'asc' }, { lastName: 'asc' }],
    });
    return contacts.map((contact) => this.view(contact, userId));
  }

  public async create(userId: string, input: CreatePerson) {
    const context = await this.managementContext(userId);
    if (input.access?.role === 'ADMINISTRATOR' && context.role !== 'OWNER') {
      throw new ForbiddenException('Seul le propriétaire peut nommer un administrateur.');
    }
    const passwordHash = input.access ? await hash(input.access.temporaryPassword) : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.trustedContact.findFirst({
          where: { homeId: context.homeId },
          orderBy: { priority: 'desc' },
          select: { priority: true },
        });
        let accountId: string | null = null;
        if (input.access && passwordHash) {
          const account = await tx.user.create({
            data: {
              username: input.access.username.toLowerCase(),
              email: input.email ? input.email.toLowerCase() : null,
              phone: input.phone || null,
              displayName: `${input.firstName} ${input.lastName}`.trim(),
              passwordHash,
              mustChangePassword: true,
            },
          });
          accountId = account.id;
          await tx.membership.create({
            data: {
              organizationId: context.organizationId,
              userId: account.id,
              systemRole: input.access.role,
            },
          });
          await tx.caregiverProfile.create({
            data: {
              userId: account.id,
              residentId: context.residentId,
              relation: input.relation || null,
            },
          });
        }
        const contact = await tx.trustedContact.create({
          data: {
            homeId: context.homeId,
            residentId: context.residentId,
            userId: accountId,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone || null,
            email: input.email ? input.email.toLowerCase() : null,
            relation: input.relation || null,
            isEmergency: input.isEmergency,
            priority: input.priority ?? (last?.priority ?? -1) + 1,
          },
          include: {
            user: {
              include: { memberships: { where: { organizationId: context.organizationId } } },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            homeId: context.homeId,
            actorId: userId,
            action: input.access ? 'PERSON_ACCESS_CREATED' : 'PERSON_CREATED',
            target: contact.id,
            metadata: { role: input.access?.role ?? null },
          },
        });
        return this.view(contact, userId);
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Identifiant, email, téléphone ou priorité déjà utilisé.');
      }
      throw error;
    }
  }

  public async update(userId: string, personId: string, input: UpdatePerson) {
    const context = await this.managementContext(userId);
    const contact = await this.target(context.homeId, context.organizationId, personId);
    this.assertTarget(context.role, contact.user?.memberships[0]?.systemRole ?? null);
    const firstName = input.firstName ?? contact.firstName;
    const lastName = input.lastName ?? contact.lastName;
    return this.prisma.$transaction(async (tx) => {
      if (contact.userId) {
        await tx.user.update({
          where: { id: contact.userId },
          data: {
            displayName: `${firstName} ${lastName}`.trim(),
            ...(input.email !== undefined
              ? { email: input.email ? input.email.toLowerCase() : null }
              : {}),
            ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
          },
        });
        if (input.relation !== undefined) {
          await tx.caregiverProfile.updateMany({
            where: { userId: contact.userId },
            data: { relation: input.relation || null },
          });
        }
      }
      const updated = await tx.trustedContact.update({
        where: { id: personId },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
          ...(input.email !== undefined
            ? { email: input.email ? input.email.toLowerCase() : null }
            : {}),
          ...(input.relation !== undefined ? { relation: input.relation || null } : {}),
          ...(input.isEmergency !== undefined ? { isEmergency: input.isEmergency } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
        },
        include: {
          user: {
            include: { memberships: { where: { organizationId: context.organizationId } } },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          homeId: context.homeId,
          actorId: userId,
          action: 'PERSON_UPDATED',
          target: personId,
          metadata: {},
        },
      });
      return this.view(updated, userId);
    });
  }

  public async updateAccess(userId: string, personId: string, input: UpdatePersonAccess) {
    const context = await this.managementContext(userId);
    const contact = await this.target(context.homeId, context.organizationId, personId);
    const membership = contact.user?.memberships[0];
    if (input.action === 'create') {
      if (contact.userId || membership) throw new ConflictException('Un compte est déjà associé.');
      if (input.role === 'ADMINISTRATOR' && context.role !== 'OWNER') {
        throw new ForbiddenException('Seul le propriétaire peut nommer un administrateur.');
      }
      const passwordHash = await hash(input.temporaryPassword);
      await this.prisma.$transaction(async (tx) => {
        const account = await tx.user.create({
          data: {
            username: input.username.toLowerCase(),
            email: contact.email,
            phone: contact.phone,
            displayName: `${contact.firstName} ${contact.lastName}`.trim(),
            passwordHash,
            mustChangePassword: true,
          },
        });
        await tx.membership.create({
          data: {
            organizationId: context.organizationId,
            userId: account.id,
            systemRole: input.role,
          },
        });
        await tx.caregiverProfile.create({
          data: {
            userId: account.id,
            residentId: context.residentId,
            relation: contact.relation,
          },
        });
        await tx.trustedContact.update({ where: { id: personId }, data: { userId: account.id } });
        await tx.auditLog.create({
          data: {
            homeId: context.homeId,
            actorId: userId,
            action: 'PERSON_ACCESS_CREATED',
            target: personId,
            metadata: { role: input.role },
          },
        });
      });
      return this.list(userId, true).then((people) =>
        people.find((person) => person.id === personId),
      );
    }
    if (!contact.userId || !membership) throw new NotFoundException('Aucun compte associé.');
    this.assertTarget(context.role, membership.systemRole);
    if (input.action === 'role' && input.role === 'ADMINISTRATOR' && context.role !== 'OWNER') {
      throw new ForbiddenException('Seul le propriétaire peut nommer un administrateur.');
    }
    const passwordHash =
      input.action === 'reset-password' ? await hash(input.temporaryPassword) : null;
    await this.prisma.$transaction(async (tx) => {
      if (input.action === 'role') {
        await tx.membership.update({
          where: { id: membership.id },
          data: { systemRole: input.role },
        });
      } else if (input.action === 'disable') {
        await tx.membership.update({
          where: { id: membership.id },
          data: { disabledAt: new Date() },
        });
        await tx.session.deleteMany({ where: { userId: contact.userId! } });
      } else if (input.action === 'enable') {
        await tx.membership.update({ where: { id: membership.id }, data: { disabledAt: null } });
      } else if (passwordHash) {
        await tx.user.update({
          where: { id: contact.userId! },
          data: { passwordHash, mustChangePassword: true },
        });
        await tx.session.deleteMany({ where: { userId: contact.userId! } });
      }
      await tx.auditLog.create({
        data: {
          homeId: context.homeId,
          actorId: userId,
          action: `PERSON_ACCESS_${input.action.toUpperCase().replace('-', '_')}`,
          target: personId,
          metadata: input.action === 'role' ? { role: input.role } : {},
        },
      });
    });
    return this.list(userId, true).then((people) =>
      people.find((person) => person.id === personId),
    );
  }

  public async archive(userId: string, personId: string) {
    const context = await this.managementContext(userId);
    const contact = await this.target(context.homeId, context.organizationId, personId);
    const membership = contact.user?.memberships[0];
    this.assertTarget(context.role, membership?.systemRole ?? null);
    await this.prisma.$transaction(async (tx) => {
      await tx.trustedContact.update({ where: { id: personId }, data: { archivedAt: new Date() } });
      if (membership && contact.userId) {
        await tx.membership.update({
          where: { id: membership.id },
          data: { disabledAt: new Date() },
        });
        await tx.session.deleteMany({ where: { userId: contact.userId } });
      }
      await tx.auditLog.create({
        data: {
          homeId: context.homeId,
          actorId: userId,
          action: 'PERSON_ARCHIVED',
          target: personId,
          metadata: {},
        },
      });
    });
    return { id: personId, archived: true };
  }

  private async context(userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: activeMembership(userId),
      include: { organization: { include: { homes: { take: 1 } } } },
    });
    const home = membership?.organization.homes[0];
    if (!membership || !home?.primaryResidentId) throw new ForbiddenException('Accès refusé.');
    return {
      homeId: home.id,
      residentId: home.primaryResidentId,
      organizationId: membership.organizationId,
      role: membership.systemRole,
    };
  }

  private async managementContext(userId: string) {
    const context = await this.context(userId);
    if (!['OWNER', 'ADMINISTRATOR'].includes(context.role)) {
      throw new ForbiddenException('Accès administrateur requis.');
    }
    return context;
  }

  private target(homeId: string, organizationId: string, personId: string) {
    return this.prisma.trustedContact.findFirstOrThrow({
      where: { id: personId, homeId },
      include: { user: { include: { memberships: { where: { organizationId } } } } },
    });
  }

  private assertTarget(actorRole: MembershipRole, targetRole: MembershipRole | null) {
    if (targetRole === 'OWNER') throw new ForbiddenException('Le propriétaire est protégé.');
    if (targetRole === 'ADMINISTRATOR' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Seul le propriétaire peut gérer un administrateur.');
    }
  }

  private view(
    contact: {
      id: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      email: string | null;
      relation: string | null;
      isEmergency: boolean;
      priority: number;
      archivedAt: Date | null;
      userId: string | null;
      user: null | {
        username: string | null;
        memberships: Array<{ systemRole: MembershipRole; disabledAt: Date | null }>;
      };
    },
    currentUserId: string,
  ) {
    const membership = contact.user?.memberships[0];
    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      email: contact.email,
      relation: contact.relation,
      role: membership?.systemRole ?? null,
      isEmergency: contact.isEmergency,
      priority: contact.priority,
      hasAccount: contact.userId !== null,
      accessDisabled: membership?.disabledAt !== null && membership?.disabledAt !== undefined,
      archived: contact.archivedAt !== null,
      isCurrentUser: contact.userId === currentUserId,
      username: contact.user?.username ?? null,
    };
  }
}
