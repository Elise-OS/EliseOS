import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PeopleService } from './people.service';

const actorMembership = (role: 'OWNER' | 'ADMINISTRATOR') => ({
  organizationId: 'org-1',
  systemRole: role,
  organization: { homes: [{ id: 'home-1', primaryResidentId: 'resident-1' }] },
});

describe('PeopleService access hierarchy', () => {
  it('only lets the owner create another administrator', async () => {
    const prisma = {
      membership: { findFirst: vi.fn().mockResolvedValue(actorMembership('ADMINISTRATOR')) },
    };
    const service = new PeopleService(prisma as never);

    await expect(
      service.create('admin-1', {
        firstName: 'Sophie',
        lastName: 'Martin',
        phone: '0600000000',
        email: '',
        relation: 'Fille',
        isEmergency: false,
        access: {
          role: 'ADMINISTRATOR',
          username: 'sophie',
          temporaryPassword: 'Temporaire-2026!',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never lets the protected owner be disabled', async () => {
    const prisma = {
      membership: { findFirst: vi.fn().mockResolvedValue(actorMembership('OWNER')) },
      trustedContact: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: 'owner-contact',
          userId: 'owner-1',
          user: {
            memberships: [{ id: 'membership-owner', systemRole: 'OWNER', disabledAt: null }],
          },
        }),
      },
    };
    const service = new PeopleService(prisma as never);

    await expect(
      service.updateAccess('owner-1', 'owner-contact', { action: 'disable' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revokes sessions while preserving the contact when access is disabled', async () => {
    const tx = {
      membership: { update: vi.fn() },
      session: { deleteMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      membership: { findFirst: vi.fn().mockResolvedValue(actorMembership('ADMINISTRATOR')) },
      trustedContact: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: 'caregiver-contact',
          userId: 'caregiver-1',
          user: {
            memberships: [
              { id: 'membership-caregiver', systemRole: 'CAREGIVER', disabledAt: null },
            ],
          },
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PeopleService(prisma as never);

    await service.updateAccess('admin-1', 'caregiver-contact', { action: 'disable' });

    const membershipUpdate = tx.membership.update.mock.calls[0]?.[0] as
      { where: { id: string }; data: { disabledAt: Date } } | undefined;
    expect(membershipUpdate?.where.id).toBe('membership-caregiver');
    expect(membershipUpdate?.data.disabledAt).toBeInstanceOf(Date);
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'caregiver-1' } });
    expect(prisma.trustedContact.findFirstOrThrow).toHaveBeenCalledOnce();
  });
});
