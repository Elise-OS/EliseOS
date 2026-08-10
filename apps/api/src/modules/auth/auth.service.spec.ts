import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const createdUser = {
  id: 'user-1',
  email: 'paul@example.com',
  username: 'paul',
  phone: null,
  displayName: 'Paul Martin',
  passwordHash: 'hash',
  mustChangePassword: false,
};

const installation = {
  username: 'paul',
  caregiver: { firstName: 'Paul', lastName: 'Martin', relation: 'Petit-fils' },
  resident: {
    firstName: 'Madeleine',
    lastName: 'Martin',
    dailyName: 'Madeleine',
    birthDate: '1942-04-03',
    language: 'Français' as const,
    addressAs: 'daily',
    customAddress: '',
  },
  life: ['alone' as const],
  mobility: 'independent' as const,
  senses: [],
  important: ['memory' as const, 'fall' as const],
  importantNote: 'Rassurer avec des phrases courtes.',
  home: {
    name: 'Maison de Madeleine',
    type: 'Maison',
    floors: 1,
    address: '',
    timezone: 'Europe/Paris',
  },
  rooms: [{ id: 'room-client', name: 'Salon', kind: 'LIVING_ROOM', floor: 'Rez-de-chaussée' }],
  contacts: [
    {
      id: 'contact-admin',
      firstName: 'Sophie',
      lastName: 'Martin',
      phone: '0600000000',
      email: 'sophie@example.com',
      relation: 'Infirmière',
      role: 'administrateur' as const,
      username: 'sophie',
      temporaryPassword: 'Temporaire-2026!',
    },
  ],
  habits: {
    Lever: { from: '07:30', to: '09:00', unknown: false },
    Coucher: { from: '21:00', to: '23:00', unknown: true },
  },
  equipment: [],
};

describe('AuthService bootstrap', () => {
  it('creates the first owner and an authenticated session atomically', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      user: {
        count: vi.fn().mockResolvedValue(0),
        create: vi
          .fn()
          .mockResolvedValueOnce(createdUser)
          .mockResolvedValueOnce({ ...createdUser, id: 'user-2', username: 'sophie' }),
      },
      organization: { create: vi.fn().mockResolvedValue({ id: 'org-1' }) },
      membership: { create: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
      session: { create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
      home: { create: vi.fn().mockResolvedValue({ id: 'home-1' }), update: vi.fn() },
      resident: { create: vi.fn().mockResolvedValue({ id: 'resident-1' }) },
      caregiverProfile: { create: vi.fn() },
      room: {
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 'room-1', name: 'Salon' }]),
      },
      residentContext: { create: vi.fn() },
      supportNeed: { createMany: vi.fn() },
      trustedContact: { create: vi.fn() },
      habitProfile: { create: vi.fn() },
      sensor: { updateMany: vi.fn() },
      configurationRevision: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const service = new AuthService(prisma as never);

    const result = await service.bootstrap({
      email: 'Paul@Example.com',
      displayName: 'Paul Martin',
      password: 'Michel-Test-2026!',
      installation,
    });

    expect(result.user).toEqual(
      expect.objectContaining({ email: 'paul@example.com', phone: null }),
    );
    expect(result.token).toHaveLength(43);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'user-1', systemRole: 'OWNER' },
    });
    expect(tx.session.create).toHaveBeenCalledTimes(1);
    const contextCreate = tx.residentContext.create.mock.calls[0]?.[0] as
      { data: { livesAlone: boolean } } | undefined;
    expect(contextCreate?.data.livesAlone).toBe(true);
    const needsCreate = tx.supportNeed.createMany.mock.calls[0]?.[0] as
      { data: Array<{ kind: string }> } | undefined;
    expect(needsCreate?.data.map((need) => need.kind)).toEqual(['MEMORY', 'FALL_RISK', 'OTHER']);
    expect(tx.habitProfile.create).toHaveBeenCalledTimes(2);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'user-2', systemRole: 'ADMINISTRATOR' },
    });
    const revision = tx.configurationRevision.create.mock.calls[0]?.[0] as {
      data: { settings: unknown };
    };
    expect(JSON.stringify(revision.data.settings)).not.toContain('Temporaire-2026!');
    expect(JSON.stringify(revision.data.settings)).not.toContain('Michel-Test-2026!');
  });

  it('refuses a second owner claim', async () => {
    const tx = { $executeRaw: vi.fn(), user: { count: vi.fn().mockResolvedValue(1) } };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const service = new AuthService(prisma as never);

    await expect(
      service.bootstrap({
        email: 'second@example.com',
        displayName: 'Second Owner',
        password: 'Michel-Test-2026!',
        installation,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AuthService equipment discovery', () => {
  it('requires a session after the first account has been configured', async () => {
    const prisma = {
      user: { count: vi.fn().mockResolvedValue(1) },
      session: { findUnique: vi.fn() },
      sensor: { findMany: vi.fn() },
    };
    const service = new AuthService(prisma as never);

    await expect(service.bootstrapEquipment()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sensor.findMany).not.toHaveBeenCalled();
  });

  it('limits configured equipment discovery to an administrator home', async () => {
    const prisma = {
      user: { count: vi.fn().mockResolvedValue(1) },
      session: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user-1',
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            mustChangePassword: false,
            memberships: [{ systemRole: 'OWNER' }],
          },
        }),
      },
      sensor: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new AuthService(prisma as never);

    await expect(service.bootstrapEquipment('session-token')).resolves.toEqual([]);
    expect(prisma.sensor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          home: {
            organization: {
              memberships: {
                some: {
                  userId: 'user-1',
                  systemRole: { in: ['OWNER', 'ADMINISTRATOR'] },
                },
              },
            },
          },
        },
      }),
    );
  });
});
