import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationService } from './simulation.service';

describe('SimulationService', () => {
  afterEach(() => {
    delete process.env.MICHEL_SIMULATION_MODE;
    delete process.env.MICHEL_DEMO_MODE;
  });

  it('is unavailable unless simulation or demo mode is explicit', () => {
    const service = new SimulationService({} as never, {} as never);
    expect(() => service.list()).toThrow(NotFoundException);
  });

  it('sends a scenario through ingestion and reports duplicate replays', async () => {
    process.env.MICHEL_SIMULATION_MODE = 'true';
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
    };
    const ingestion = {
      ingest: vi.fn().mockResolvedValueOnce({ accepted: true }).mockResolvedValueOnce({
        accepted: false,
        id: 'existing-event',
      }),
    };
    const service = new SimulationService(prisma as never, ingestion as never);

    const result = await service.run(
      'admin-1',
      'door_cycle',
      'replayable-run',
      new Date('2026-08-09T12:00:00.000Z'),
    );

    expect(result).toEqual(expect.objectContaining({ generated: 2, accepted: 1, duplicates: 1 }));
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(
      ingestion.ingest.mock.calls.every(
        (call) => (call[0] as { homeId: string }).homeId === 'home-1',
      ),
    ).toBe(true);
    expect(prisma.home.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization: {
            memberships: {
              some: {
                userId: 'admin-1',
                systemRole: { in: ['OWNER', 'ADMINISTRATOR'] },
              },
            },
          },
        },
      }),
    );
  });

  it('refuses a user without administrative access', async () => {
    process.env.MICHEL_SIMULATION_MODE = 'true';
    const prisma = { home: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new SimulationService(prisma as never, { ingest: vi.fn() } as never);

    await expect(service.run('viewer-1', 'sos', 'run-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
