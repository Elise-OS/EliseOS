import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { liaisonCreateSchema, liaisonDateSchema, liaisonUpdateSchema } from '@michel/contracts';
import { LiaisonService } from './liaison.service';

function fixture() {
  const tx = {
    $executeRaw: vi.fn(),
    liaisonEntry: {
      findFirst: vi.fn().mockResolvedValue({ id: 'task', kind: 'TASK', completedAt: null }),
      create: vi.fn().mockResolvedValue({ id: 'entry' }),
      update: vi.fn().mockResolvedValue({ id: 'task', body: 'Updated note' }),
      delete: vi.fn(),
    },
    visit: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'visit', startsAt: new Date('2020-01-01'), completedAt: null }),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    home: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'home',
        organizationId: 'org',
        timezone: 'Europe/Paris',
        primaryResident: {
          firstName: 'Michel',
          preferredName: 'Michel',
          displayName: 'Michel Breton',
        },
      }),
    },
    membership: {
      findFirst: vi.fn().mockResolvedValue({ userId: 'caregiver' }),
      findMany: vi
        .fn()
        .mockResolvedValue([
          { userId: 'reader', systemRole: 'VIEWER', user: { id: 'reader', displayName: 'Reader' } },
        ]),
    },
    liaisonEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    visit: { findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { tx, prisma, service: new LiaisonService(prisma as never) };
}

describe('Family notebook permissions and lifecycle', () => {
  it('rejects impossible dates and task-only fields on notes', () => {
    expect(liaisonDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(liaisonDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(
      liaisonCreateSchema.safeParse({ kind: 'NOTE', body: 'hello', assigneeId: 'someone' }).success,
    ).toBe(false);
    expect(liaisonCreateSchema.safeParse({ kind: 'TASK', body: '  ' }).success).toBe(false);
    expect(
      liaisonCreateSchema.safeParse({ kind: 'NOTE', body: 'hello', tags: ['UNKNOWN'] }).success,
    ).toBe(false);
    expect(
      liaisonCreateSchema.safeParse({ kind: 'NOTE', body: 'hello', homeId: 'other' }).success,
    ).toBe(false);
    expect(liaisonUpdateSchema.safeParse({ body: ' updated ' }).data).toEqual({ body: 'updated' });
    expect(liaisonUpdateSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(liaisonUpdateSchema.safeParse({ body: 'updated', kind: 'TASK' }).success).toBe(false);
  });
  it('allows readers to see the feed but never offers them as assignees', async () => {
    const { service, prisma } = fixture();
    const result = await service.list('reader', { filter: 'ALL', limit: 30 });
    expect(result.canWrite).toBe(false);
    expect(result.residentName).toBe('Michel');
    expect(result.members).toEqual([]);
    expect(prisma.liaisonEntry.findMany.mock.calls[0]![0]).toMatchObject({
      where: { homeId: 'home' },
    });
  });
  it('includes calendar appointments through the end of J+7', async () => {
    const { service, prisma } = fixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    const appointment = {
      id: 'appointment-j7',
      title: 'Consultation',
      startsAt: new Date('2026-09-30T21:00:00.000Z'),
      endsAt: null,
      location: 'Cabinet médical',
      notes: null,
    };
    prisma.appointment.findMany.mockResolvedValue([appointment]);

    try {
      const result = await service.list('reader', { filter: 'ALL', limit: 30 });

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            homeId: 'home',
            startsAt: {
              gte: new Date('2026-09-23T12:00:00.000Z'),
              lt: new Date('2026-09-30T22:00:00.000Z'),
            },
          },
          orderBy: { startsAt: 'asc' },
        }),
      );
      expect(result.appointments).toEqual([appointment]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('requires an active writer role for every write', async () => {
    const { service, prisma, tx } = fixture();
    prisma.home.findFirst.mockResolvedValue(null);
    await expect(service.create('reader', { kind: 'NOTE', body: 'hello' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.complete('reader', 'task', true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.update('reader', 'task', { body: 'updated' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove('reader', 'task')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.complete('reader', 'visit', true, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.home.findFirst.mock.calls[0]![0]).toMatchObject({
      where: {
        organization: {
          memberships: {
            some: {
              userId: 'reader',
              disabledAt: null,
              systemRole: { in: ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] },
            },
          },
        },
      },
    });
    expect(tx.liaisonEntry.create).not.toHaveBeenCalled();
    expect(tx.liaisonEntry.update).not.toHaveBeenCalled();
    expect(tx.liaisonEntry.delete).not.toHaveBeenCalled();
  });
  it('rejects an assignee outside the active household caregivers', async () => {
    const { service, prisma, tx } = fixture();
    prisma.membership.findFirst.mockResolvedValue(null);
    await expect(
      service.create('author', { kind: 'TASK', body: 'Pain', assigneeId: 'outsider', dueOn: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.membership.findFirst.mock.calls[0]![0]).toMatchObject({
      where: {
        organizationId: 'org',
        userId: 'outsider',
        disabledAt: null,
      },
    });
    expect(tx.liaisonEntry.create).not.toHaveBeenCalled();
  });
  it('stores the authenticated author and audits without duplicating message contents', async () => {
    const { service, tx } = fixture();
    await service.create('author', {
      kind: 'TASK',
      body: 'Pain',
      tags: ['MEAL', 'TREATMENT'],
      assigneeId: 'caregiver',
      dueOn: '2026-10-20',
    });
    expect(tx.liaisonEntry.create.mock.calls[0]![0]).toMatchObject({
      data: {
        homeId: 'home',
        authorId: 'author',
        tags: ['MEAL', 'TREATMENT'],
        assigneeId: 'caregiver',
        dueOn: '2026-10-20',
      },
    });
    expect(tx.auditLog.create.mock.calls[0]![0]).toMatchObject({
      data: { metadata: { kind: 'TASK' } },
    });
  });
  it('updates an entry within the current home and audits without storing its text', async () => {
    const { service, prisma, tx } = fixture();
    await service.update('writer', 'task', { body: 'Updated note' });
    expect(tx.liaisonEntry.findFirst).toHaveBeenCalledWith({
      where: { id: 'task', homeId: 'home' },
    });
    expect(tx.liaisonEntry.update).toHaveBeenCalledWith({
      where: { id: 'task' },
      data: { body: 'Updated note' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        homeId: 'home',
        actorId: 'writer',
        action: 'LIAISON_UPDATED',
        target: 'task',
        metadata: { kind: 'TASK' },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
  it('deletes an entry within the current home and records the deletion', async () => {
    const { service, tx } = fixture();
    await expect(service.remove('writer', 'task')).resolves.toEqual({ id: 'task', deleted: true });
    expect(tx.liaisonEntry.delete).toHaveBeenCalledWith({ where: { id: 'task' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        homeId: 'home',
        actorId: 'writer',
        action: 'LIAISON_DELETED',
        target: 'task',
        metadata: { kind: 'TASK' },
      },
    });
  });
  it('does not update or delete an entry from another home', async () => {
    const { service, tx } = fixture();
    tx.liaisonEntry.findFirst.mockResolvedValue(null);
    await expect(
      service.update('writer', 'foreign', { body: 'Updated note' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('writer', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.liaisonEntry.update).not.toHaveBeenCalled();
    expect(tx.liaisonEntry.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects foreign cursors before reading the feed', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.list('reader', { filter: 'ALL', limit: 30, cursor: 'foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.liaisonEntry.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', homeId: 'home' },
    });
    expect(prisma.liaisonEntry.findMany).not.toHaveBeenCalled();
  });
  it('isolates task and visit completion by home', async () => {
    const { service, tx } = fixture();
    tx.liaisonEntry.findFirst.mockResolvedValue(null);
    tx.visit.findFirst.mockResolvedValue(null);
    await expect(service.complete('writer', 'foreign', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.complete('writer', 'foreign', true, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.liaisonEntry.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', homeId: 'home', kind: 'TASK' },
    });
    expect(tx.visit.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', homeId: 'home' } });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('preserves the original confirmation on a repeated completion', async () => {
    const { service, tx } = fixture();
    const completedAt = new Date('2026-01-01');
    tx.liaisonEntry.findFirst.mockResolvedValue({ id: 'task', completedAt });
    await expect(service.complete('second-writer', 'task', true)).resolves.toEqual({
      id: 'task',
      completedAt,
    });
    expect(tx.liaisonEntry.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('clears completion when reopening and records the change', async () => {
    const { service, tx } = fixture();
    tx.liaisonEntry.findFirst.mockResolvedValue({ id: 'task', completedAt: new Date() });
    await service.complete('writer', 'task', false);
    expect(tx.liaisonEntry.update).toHaveBeenCalledWith({
      where: { id: 'task' },
      data: { completedAt: null, completedById: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it('refuses to confirm a visit before its start and allows a past visit', async () => {
    const { service, tx } = fixture();
    tx.visit.findFirst.mockResolvedValueOnce({
      id: 'visit',
      startsAt: new Date(Date.now() + 86400000),
      completedAt: null,
    });
    await expect(service.complete('writer', 'visit', true, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.visit.update).not.toHaveBeenCalled();
    await service.complete('writer', 'visit', true, true);
    expect(tx.visit.update.mock.calls[0]![0]).toMatchObject({
      data: {
        completedById: 'writer',
        completedAt: expect.any(Date) as unknown,
      },
    });
  });
});
