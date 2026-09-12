import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { PrismaService } from '../../platform/prisma.service';
import {
  buildSimulationEvents,
  SIMULATION_SCENARIO_INFO,
  type SimulationScenario,
} from './simulation.scenarios';

@Injectable()
export class SimulationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  public list() {
    return this.enabled() ? SIMULATION_SCENARIO_INFO : [];
  }

  public async run(userId: string, scenario: SimulationScenario, runId: string, now = new Date()) {
    this.assertEnabled();
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              systemRole: { in: ['OWNER', 'ADMINISTRATOR'] },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Administrator access required');

    const events = buildSimulationEvents({ scenario, homeId: home.id, runId, now });
    const results = [];
    for (const event of events) results.push(await this.ingestion.ingest(event));
    return {
      scenario,
      runId,
      generated: events.length,
      accepted: results.filter((result) => result.accepted).length,
      duplicates: results.filter((result) => !result.accepted).length,
      occurredAt: events.map((event) => event.occurredAt),
    };
  }

  private assertEnabled(): void {
    if (!this.enabled()) {
      throw new NotFoundException('Simulation is not enabled');
    }
  }

  private enabled(): boolean {
    return process.env.MICHEL_SIMULATION_MODE === 'true' || process.env.MICHEL_DEMO_MODE === 'true';
  }
}
