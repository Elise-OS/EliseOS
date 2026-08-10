import { describe, expect, it } from 'vitest';
import { buildSimulationEvents, SIMULATION_SCENARIOS } from './simulation.scenarios';

describe('simulation scenarios', () => {
  it('builds deterministic, valid and home-scoped events for every scenario', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    for (const scenario of SIMULATION_SCENARIOS) {
      const first = buildSimulationEvents({ scenario, homeId: 'home-1', runId: 'run-1', now });
      const replay = buildSimulationEvents({ scenario, homeId: 'home-1', runId: 'run-1', now });
      expect(first).toEqual(replay);
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((event) => event.homeId === 'home-1')).toBe(true);
      expect(first.every((event) => event.source.platform === 'simulator')).toBe(true);
      expect(new Set(first.map((event) => event.eventId)).size).toBe(first.length);
    }
  });

  it('changes identifiers when the home or run changes', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const event = buildSimulationEvents({
      scenario: 'sos',
      homeId: 'home-1',
      runId: 'run-1',
      now,
    })[0]!;
    const anotherHome = buildSimulationEvents({
      scenario: 'sos',
      homeId: 'home-2',
      runId: 'run-1',
      now,
    })[0]!;
    const anotherRun = buildSimulationEvents({
      scenario: 'sos',
      homeId: 'home-1',
      runId: 'run-2',
      now,
    })[0]!;

    expect(new Set([event.eventId, anotherHome.eventId, anotherRun.eventId]).size).toBe(3);
  });
});
