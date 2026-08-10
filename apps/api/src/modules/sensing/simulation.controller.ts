import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionGuard } from '../auth/session.guard';
import { parseRequest } from '../../platform/zod-validation';
import { SIMULATION_SCENARIOS } from './simulation.scenarios';
import { SimulationService } from './simulation.service';

const scenarioSchema = z.object({ scenario: z.enum(SIMULATION_SCENARIOS) });
const runSchema = z.object({
  runId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  at: z.iso.datetime().optional(),
});

@Controller('simulation/scenarios')
@UseGuards(SessionGuard)
export class SimulationController {
  public constructor(private readonly simulation: SimulationService) {}

  @Get()
  public list() {
    return this.simulation.list();
  }

  @Post(':scenario')
  public run(
    @Req() request: AuthenticatedRequest,
    @Param('scenario') scenario: string,
    @Body() body: unknown,
  ) {
    const parsedScenario = parseRequest(scenarioSchema, { scenario });
    const input = parseRequest(runSchema, body);
    return this.simulation.run(
      request.userId,
      parsedScenario.scenario,
      input.runId,
      input.at ? new Date(input.at) : new Date(),
    );
  }
}
