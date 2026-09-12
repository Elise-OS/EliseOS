/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers use `any`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedService } from './seed.service';

vi.mock('@node-rs/argon2', () => ({ hash: vi.fn().mockResolvedValue('demo-password-hash') }));

function createPrisma(organizationCount = 0) {
  const create = () =>
    vi.fn(({ data }: { data: { id?: string } }) =>
      Promise.resolve({
        ...data,
        id: data.id ?? 'generated-id',
      }),
    );
  const createMany = () =>
    vi.fn(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  const tx = {
    organization: { create: vi.fn().mockResolvedValue({ id: 'org_demo' }) },
    home: {
      create: vi.fn().mockResolvedValue({ id: 'home_demo' }),
      update: vi.fn().mockResolvedValue({ id: 'home_demo' }),
    },
    resident: { create: vi.fn().mockResolvedValue({ id: 'resident_demo' }) },
    user: { create: vi.fn().mockResolvedValue({ id: 'user_demo_paul' }) },
    membership: { create: create() },
    caregiverProfile: { create: create() },
    residentContext: { create: create() },
    supportNeed: { createMany: createMany() },
    trustedContact: { createMany: createMany() },
    habitProfile: { createMany: createMany() },
    room: { create: create() },
    device: { create: create() },
    sensor: { create: create() },
    observationEvent: { create: create() },
    configurationRevision: { create: create() },
    journalEntry: { createMany: createMany() },
    alert: { createMany: createMany() },
    visit: { create: create() },
    appointment: { create: create() },
    medication: { createMany: createMany() },
    medicationSchedule: { createMany: createMany() },
    medicationDose: { createMany: createMany() },
  };
  const prisma = {
    organization: { count: vi.fn().mockResolvedValue(organizationCount) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) =>
      callback(tx),
    ),
  };
  return { prisma, tx };
}

describe('SeedService', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z')));

  afterEach(() => {
    delete process.env.MICHEL_DEMO_MODE;
    delete process.env.DEMO_PASSWORD;
    vi.useRealTimers();
  });

  it('does not inspect or write the database outside demo mode', async () => {
    const { prisma } = createPrisma();

    await new SeedService(prisma as never).onModuleInit();

    expect(prisma.organization.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not duplicate demo data when an organization already exists', async () => {
    process.env.MICHEL_DEMO_MODE = 'true';
    const { prisma } = createPrisma(1);

    await new SeedService(prisma as never).onModuleInit();

    expect(prisma.organization.count).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a complete, directly accessible demo household', async () => {
    process.env.MICHEL_DEMO_MODE = 'true';
    const { prisma, tx } = createPrisma();

    await new SeedService(prisma as never).onModuleInit();

    expect(tx.home.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'home_demo',
        installationStatus: 'LEARNING',
        learningStartedAt: new Date('2026-08-24T12:00:00.000Z'),
      }),
    });
    expect(tx.residentContext.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ livesAlone: true, mobility: 'CANE' }),
    });
    expect(tx.trustedContact.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ id: 'contact_demo_paul', isEmergency: true }),
        expect.objectContaining({ id: 'contact_demo_sophie', isEmergency: true }),
      ]),
    });
    expect(tx.room.create).toHaveBeenCalledTimes(5);
    expect(tx.device.create).toHaveBeenCalledTimes(5);
    expect(tx.sensor.create).toHaveBeenCalledTimes(7);
    expect(tx.observationEvent.create).toHaveBeenCalledTimes(7);
    expect(tx.alert.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ status: 'OPEN' }),
        expect.objectContaining({ status: 'RESOLVED' }),
      ]),
    });
    expect(tx.medication.createMany).toHaveBeenCalledWith({ data: expect.any(Array) });
    expect(tx.medicationDose.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ status: 'TAKEN' }),
        expect.objectContaining({ status: 'MISSED' }),
        expect.objectContaining({ status: 'PENDING' }),
      ]),
    });
  });
});
