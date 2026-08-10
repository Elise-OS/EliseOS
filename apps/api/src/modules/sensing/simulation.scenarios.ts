import type { NormalizedEvent } from '@michel/contracts';

export const SIMULATION_SCENARIOS = [
  'normal_morning',
  'door_cycle',
  'door_left_open',
  'inactivity',
  'low_temperature',
  'night_activity',
  'low_battery',
  'sensor_offline',
  'sos',
] as const;

export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number];

export interface SimulationScenarioInfo {
  id: SimulationScenario;
  title: string;
  description: string;
}

export const SIMULATION_SCENARIO_INFO: SimulationScenarioInfo[] = [
  {
    id: 'normal_morning',
    title: 'Matinée habituelle',
    description: 'Mouvements, passage en cuisine et température confortable.',
  },
  {
    id: 'door_cycle',
    title: 'Porte ouverte puis refermée',
    description: 'Simule un passage normal par la porte d’entrée.',
  },
  {
    id: 'door_left_open',
    title: 'Porte laissée ouverte',
    description: 'Laisse la porte d’entrée ouverte depuis dix minutes.',
  },
  {
    id: 'inactivity',
    title: 'Absence prolongée de mouvement',
    description: 'Place la dernière activité fiable quatre heures auparavant.',
  },
  {
    id: 'low_temperature',
    title: 'Température basse',
    description: 'Place le salon à 15,5 °C depuis quinze minutes.',
  },
  {
    id: 'night_activity',
    title: 'Activité nocturne répétée',
    description: 'Ajoute plusieurs mouvements rapprochés pendant la nuit.',
  },
  {
    id: 'low_battery',
    title: 'Batterie faible',
    description: 'Place la batterie du capteur d’entrée à 8 %.',
  },
  {
    id: 'sensor_offline',
    title: 'Capteur silencieux',
    description: 'Place la dernière communication du capteur trois heures auparavant.',
  },
  {
    id: 'sos',
    title: 'Bouton SOS',
    description: 'Déclenche un appel immédiat de démonstration.',
  },
];

interface EventSeed {
  entityId: string;
  capability: NormalizedEvent['capability'];
  minutesAgo: number;
  payload: Record<string, unknown>;
  quality?: NormalizedEvent['quality'];
}

function nightDate(reference: Date, minuteOffset: number): Date {
  const night = new Date(reference);
  night.setHours(2, 10 + minuteOffset, 0, 0);
  if (night > reference) night.setDate(night.getDate() - 1);
  return night;
}

function seeds(scenario: SimulationScenario): EventSeed[] {
  switch (scenario) {
    case 'normal_morning':
      return [
        {
          entityId: 'simulator.bedroom_motion',
          capability: 'motion',
          minutesAgo: 45,
          payload: { active: true },
        },
        {
          entityId: 'simulator.kitchen_motion',
          capability: 'motion',
          minutesAgo: 30,
          payload: { active: true },
        },
        {
          entityId: 'simulator.living_temperature',
          capability: 'temperature',
          minutesAgo: 15,
          payload: { value: 20.5, unit: '°C' },
        },
      ];
    case 'door_cycle':
      return [
        {
          entityId: 'simulator.entrance_door',
          capability: 'contact',
          minutesAgo: 10,
          payload: { open: true },
        },
        {
          entityId: 'simulator.entrance_door',
          capability: 'contact',
          minutesAgo: 9,
          payload: { open: false },
        },
      ];
    case 'door_left_open':
      return [
        {
          entityId: 'simulator.entrance_door',
          capability: 'contact',
          minutesAgo: 10,
          payload: { open: true },
        },
      ];
    case 'inactivity':
      return [
        {
          entityId: 'simulator.living_motion',
          capability: 'motion',
          minutesAgo: 240,
          payload: { active: true },
        },
      ];
    case 'low_temperature':
      return [
        {
          entityId: 'simulator.living_temperature',
          capability: 'temperature',
          minutesAgo: 15,
          payload: { value: 15.5, unit: '°C' },
        },
      ];
    case 'night_activity':
      return [0, 8, 17].map((offset) => ({
        entityId: 'simulator.hallway_motion',
        capability: 'motion' as const,
        minutesAgo: -offset,
        payload: { active: true, nightOffset: offset },
      }));
    case 'low_battery':
      return [
        {
          entityId: 'simulator.entrance_battery',
          capability: 'battery',
          minutesAgo: 2,
          payload: { value: 8, unit: '%' },
        },
      ];
    case 'sensor_offline':
      return [
        {
          entityId: 'simulator.bathroom_motion',
          capability: 'motion',
          minutesAgo: 180,
          payload: { active: true },
        },
      ];
    case 'sos':
      return [
        {
          entityId: 'simulator.sos_button',
          capability: 'button',
          minutesAgo: 0,
          payload: { action: 'sos' },
        },
      ];
  }
}

export function buildSimulationEvents(input: {
  scenario: SimulationScenario;
  homeId: string;
  runId: string;
  now: Date;
}): NormalizedEvent[] {
  return seeds(input.scenario).map((seed, index) => {
    const occurredAt =
      input.scenario === 'night_activity'
        ? nightDate(input.now, Math.max(0, -seed.minutesAgo))
        : new Date(input.now.getTime() - seed.minutesAgo * 60_000);
    return {
      schemaVersion: '1.0',
      eventId: `simulation:${input.homeId}:${input.scenario}:${input.runId}:${index}`,
      occurredAt: occurredAt.toISOString(),
      receivedAt: input.now.toISOString(),
      homeId: input.homeId,
      source: {
        platform: 'simulator',
        entityId: seed.entityId,
        deviceId: `simulation:${seed.entityId}`,
      },
      capability: seed.capability,
      quality: seed.quality ?? 'good',
      payload: seed.payload,
    };
  });
}
