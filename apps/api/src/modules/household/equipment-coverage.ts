import {
  deviceSupportsCategory,
  visibleRoomCategories,
  ROOM_SENSOR_CATEGORIES,
} from '@michel/contracts';
import type {
  EquipmentCoverage,
  EquipmentTarget,
  HomePlan,
  SensorProfile,
  TargetRecommendation,
} from '@michel/contracts';

type CoverageDevice = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  capabilities: Array<{ sensorId: string; capability: string }>;
};

export const SENSOR_PROFILES: SensorProfile[] = [
  {
    id: 'thirdreality-r3',
    label: 'Smart Presence Sensor R3',
    manufacturer: 'Third Reality',
    models: ['3RPL01084Z'],
    capabilities: [
      'person_presence',
      'occupancy',
      'illuminance',
      'total_volatile_organic_compounds',
      'switch',
    ],
    targetTypes: ['ROOM'],
  },
  {
    id: 'thirdreality-contact',
    label: 'Door & Window Sensor',
    manufacturer: 'Third Reality',
    models: ['3RDS17BZ'],
    capabilities: ['contact'],
    targetTypes: ['OPENING', 'ROOM'],
  },
  {
    id: 'thirdreality-motion',
    label: 'Motion Sensor',
    manufacturer: 'Third Reality',
    models: ['3RMS16BZ'],
    capabilities: ['motion', 'occupancy'],
    targetTypes: ['ROOM', 'STAIR'],
  },
  {
    id: 'thirdreality-climate-lite',
    label: 'Temperature & Humidity Sensor Lite',
    manufacturer: 'Third Reality',
    models: ['3RTHS0224Z'],
    capabilities: ['temperature', 'humidity'],
    targetTypes: ['ROOM'],
  },
  {
    id: 'thirdreality-water',
    label: 'Water Leak Sensor',
    manufacturer: 'Third Reality',
    models: ['3RWS18BZ'],
    capabilities: ['water_leak'],
    targetTypes: ['ROOM'],
  },
  {
    id: 'thirdreality-plug-e2',
    label: 'Smart Plug E2 EU',
    manufacturer: 'Third Reality',
    models: ['3RSPE01044BZ'],
    capabilities: ['switch', 'power', 'energy', 'current', 'voltage'],
    targetTypes: ['ROOM'],
  },
  {
    id: 'thirdreality-button',
    label: 'Zigbee Smart Button',
    manufacturer: 'Third Reality',
    models: ['3RSB22BZ'],
    capabilities: ['button'],
    targetTypes: ['ROOM'],
  },
  {
    id: 'nodon-opening',
    label: 'Détecteur d’ouverture Zigbee',
    manufacturer: 'NodOn',
    models: ['SDO-4-1-00'],
    capabilities: ['contact'],
    targetTypes: ['OPENING', 'ROOM'],
  },
  {
    id: 'nodon-climate',
    label: 'Capteur de température et d’humidité Zigbee',
    manufacturer: 'NodOn',
    models: ['STPH-4-1-00'],
    capabilities: ['temperature', 'humidity'],
    targetTypes: ['ROOM'],
  },
  {
    id: 'nodon-dry-contact',
    label: 'Capteur contact sec Zigbee',
    manufacturer: 'NodOn',
    models: ['SDC-4-1-00'],
    capabilities: ['dry_contact'],
    targetTypes: ['OPENING', 'ROOM'],
  },
  {
    id: 'nodon-energy-monitor',
    label: 'Compteur d’énergie Zigbee',
    manufacturer: 'NodOn',
    models: ['SEM-4-1-00'],
    capabilities: ['power', 'energy', 'produced_energy', 'current', 'voltage'],
    targetTypes: ['ROOM'],
  },
];

const CAPABILITY_TARGETS: Record<string, EquipmentTarget['type'][]> = {
  camera: ['ROOM'],
  motion: ['ROOM', 'STAIR'],
  occupancy: ['ROOM', 'STAIR'],
  person_presence: ['ROOM'],
  contact: ['OPENING', 'ROOM'],
  dry_contact: ['OPENING', 'ROOM'],
  temperature: ['ROOM'],
  humidity: ['ROOM'],
  water_leak: ['ROOM'],
  power: ['ROOM'],
  energy: ['ROOM'],
  switch: ['ROOM'],
  button: ['ROOM'],
  illuminance: ['ROOM'],
  voc: ['ROOM'],
  total_volatile_organic_compounds: ['ROOM'],
};

const capabilityMatches = (required: string, available: string) =>
  required === 'person_presence'
    ? ['person_presence', 'occupancy'].includes(available)
    : required === 'shower'
      ? available === 'humidity'
      : required === 'contact'
        ? ['contact', 'dry_contact'].includes(available)
        : required === available;

export function profileFor(device: CoverageDevice): SensorProfile {
  const known = SENSOR_PROFILES.find((profile) =>
    profile.models.some((model) => model.toLowerCase() === device.model?.toLowerCase()),
  );
  if (known) return known;
  const capabilities = [...new Set(device.capabilities.map(({ capability }) => capability))];
  const targetTypes: SensorProfile['targetTypes'] = [
    ...new Set(
      capabilities.flatMap((capability) => CAPABILITY_TARGETS[capability] ?? (['ROOM'] as const)),
    ),
  ];
  return {
    id: `generic:${device.id}`,
    label: device.name,
    manufacturer: device.manufacturer,
    models: device.model ? [device.model] : [],
    capabilities,
    targetTypes,
  };
}

function targetsFor(plan: HomePlan): EquipmentTarget[] {
  return plan.levels.flatMap((level) => [
    ...level.rooms.map((room) => ({
      type: 'ROOM' as const,
      id: room.id,
      roomId: room.id,
      label: room.name,
      kind: room.kind,
    })),
    ...level.openings.map((opening) => ({
      type: 'OPENING' as const,
      id: opening.id,
      roomId: opening.hostRoomId ?? opening.roomIds[0]!,
      label: opening.isMainEntrance
        ? 'Entrée principale'
        : opening.kind === 'WINDOW'
          ? 'Fenêtre'
          : 'Porte',
      kind: opening.isMainEntrance ? 'MAIN_ENTRANCE' : opening.kind,
    })),
    ...level.stairs.map((stair) => ({
      type: 'STAIR' as const,
      id: stair.id,
      roomId: stair.fromRoomId,
      label: 'Escalier',
      kind: 'STAIR',
    })),
  ]);
}

export function equipmentCoverage(plan: HomePlan, devices: CoverageDevice[]): EquipmentCoverage {
  const targets = targetsFor(plan);
  const profiles = devices.map(profileFor);
  const placementsByTarget = new Map<string, HomePlan['placements']>();
  for (const placement of plan.placements) {
    const key = `${placement.targetType ?? 'ROOM'}:${placement.targetId ?? placement.roomId}`;
    placementsByTarget.set(key, [...(placementsByTarget.get(key) ?? []), placement]);
  }
  const recommendations: TargetRecommendation[] = [];
  const add = (
    target: EquipmentTarget,
    capability: string,
    priority: TargetRecommendation['priority'],
    reason: string,
  ) => {
    const placements =
      target.type === 'ROOM'
        ? plan.placements.filter(({ roomId }) => roomId === target.roomId)
        : (placementsByTarget.get(`${target.type}:${target.id}`) ?? []);
    const compatibleDeviceIds = devices
      .filter((device, index) => {
        if (target.type === 'ROOM') {
          const category = capability === 'person_presence' ? 'presence' : capability;
          const definition = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category);
          return definition ? deviceSupportsCategory(device, definition.id) : false;
        }
        return (
          profiles[index]!.targetTypes.includes(target.type) &&
          device.capabilities.some(({ capability: value }) => capabilityMatches(capability, value))
        );
      })
      .map(({ id }) => id);
    recommendations.push({
      id: `${target.type}:${target.id}:${capability}`,
      target,
      capability,
      priority,
      reason,
      fulfilledByPlacementId:
        placements.find((placement) => {
          const deviceId =
            placement.equipmentRefKind === 'SENSOR_ENTITY'
              ? `sensor:${placement.equipmentId}`
              : placement.equipmentId;
          return compatibleDeviceIds.includes(deviceId);
        })?.id ?? null,
      compatibleDeviceIds,
    });
  };

  for (const target of targets) {
    if (target.type === 'OPENING' && target.kind === 'MAIN_ENTRANCE')
      add(target, 'contact', 'ESSENTIAL', 'Détecter les ouvertures de l’entrée principale.');
    if (target.type === 'ROOM') {
      const room = plan.levels.flatMap(({ rooms }) => rooms).find(({ id }) => id === target.id)!;
      for (const category of visibleRoomCategories(room.kind, room.sensorPreferences)) {
        const definition = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category)!;
        add(
          target,
          category === 'presence' ? 'person_presence' : category,
          'OPTIONAL',
          definition.description + '.',
        );
      }
    }
    if (target.type === 'STAIR')
      add(target, 'motion', 'RECOMMENDED', 'Confirmer les changements de niveau.');
  }
  const allProfiles = [
    ...profiles,
    ...SENSOR_PROFILES.filter(
      ({ id }) => !profiles.some((detectedProfile) => detectedProfile.id === id),
    ),
  ];
  const placements = new Map(plan.placements.map((placement) => [placement.id, placement]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const summaryFor = (selected: TargetRecommendation[]): EquipmentCoverage['summary']['main'] => {
    type Assignment = {
      profile: SensorProfile;
      target: EquipmentTarget;
      capabilities: string[];
      priority: TargetRecommendation['priority'];
      fulfilled: boolean;
      deviceName: string | null;
    };
    const assignments: Assignment[] = [];
    const byTarget = new Map<string, TargetRecommendation[]>();
    for (const recommendation of selected) {
      const key = `${recommendation.target.type}:${recommendation.target.id}`;
      byTarget.set(key, [...(byTarget.get(key) ?? []), recommendation]);
    }
    for (const targetRecommendations of byTarget.values()) {
      const handled = new Set<string>();
      const fulfilledGroups = new Map<string, TargetRecommendation[]>();
      for (const recommendation of targetRecommendations) {
        if (!recommendation.fulfilledByPlacementId) continue;
        fulfilledGroups.set(recommendation.fulfilledByPlacementId, [
          ...(fulfilledGroups.get(recommendation.fulfilledByPlacementId) ?? []),
          recommendation,
        ]);
        handled.add(recommendation.id);
      }
      for (const [placementId, group] of fulfilledGroups) {
        const placement = placements.get(placementId);
        const deviceId = placement
          ? placement.equipmentRefKind === 'SENSOR_ENTITY'
            ? `sensor:${placement.equipmentId}`
            : placement.equipmentId
          : '';
        const device = deviceById.get(deviceId);
        const profile = device ? profileFor(device) : allProfiles[0];
        if (!profile) continue;
        assignments.push({
          profile,
          target: group[0]!.target,
          capabilities: group.map(({ capability }) => capability),
          priority: group.some(({ priority }) => priority === 'ESSENTIAL')
            ? 'ESSENTIAL'
            : group[0]!.priority,
          fulfilled: true,
          deviceName: device?.name ?? null,
        });
      }

      let remaining = targetRecommendations.filter(({ id }) => !handled.has(id));
      while (remaining.length) {
        const candidate = allProfiles
          .filter(({ targetTypes }) => targetTypes.includes(remaining[0]!.target.type))
          .map((profile, order) => ({
            profile,
            order,
            covered: remaining.filter(({ capability }) =>
              profile.capabilities.some((available) => capabilityMatches(capability, available)),
            ),
          }))
          .filter(({ covered }) => covered.length)
          .sort(
            (left, right) => right.covered.length - left.covered.length || left.order - right.order,
          )[0];
        if (!candidate) break;
        assignments.push({
          profile: candidate.profile,
          target: remaining[0]!.target,
          capabilities: candidate.covered.map(({ capability }) => capability),
          priority: candidate.covered.some(({ priority }) => priority === 'ESSENTIAL')
            ? 'ESSENTIAL'
            : candidate.covered[0]!.priority,
          fulfilled: false,
          deviceName: null,
        });
        const coveredIds = new Set(candidate.covered.map(({ id }) => id));
        remaining = remaining.filter(({ id }) => !coveredIds.has(id));
      }
    }

    const grouped = new Map<string, (typeof assignments)[number][]>();
    for (const assignment of assignments) {
      const key = assignment.profile.id;
      grouped.set(key, [...(grouped.get(key) ?? []), assignment]);
    }
    return [...grouped.entries()].map(([profileId, entries]) => {
      const profile = entries[0]!.profile;
      return {
        id: `kit:${profileId}`,
        profileId,
        label: profile.label,
        manufacturer: profile.manufacturer,
        model: profile.models[0] ?? null,
        capabilities: [...new Set(entries.flatMap(({ capabilities }) => capabilities))],
        total: entries.length,
        covered: entries.filter(({ fulfilled }) => fulfilled).length,
        toAdd: entries.filter(({ fulfilled }) => !fulfilled).length,
        targets: entries.map((entry) => ({
          target: entry.target,
          capabilities: entry.capabilities,
          priority: entry.priority,
          fulfilled: entry.fulfilled,
          deviceName: entry.deviceName,
        })),
      };
    });
  };
  const main = summaryFor(recommendations.filter(({ priority }) => priority !== 'OPTIONAL'));
  const optional = summaryFor(recommendations.filter(({ priority }) => priority === 'OPTIONAL'));
  const rooms = plan.levels.flatMap(({ rooms }) => rooms);
  const openings = plan.levels.flatMap(({ openings }) => openings);
  const stairs = plan.levels.flatMap(({ stairs: items }) => items);
  const warnings: EquipmentCoverage['summary']['warnings'] = [];
  if (!rooms.length) warnings.push('EMPTY_PLAN');
  if (!openings.some(({ isMainEntrance }) => isMainEntrance))
    warnings.push('MISSING_MAIN_ENTRANCE');
  if (rooms.length > 1 && !openings.some(({ roomIds }) => roomIds.length === 2))
    warnings.push('MISSING_PASSAGES');
  if (plan.levels.length > 1 && (!stairs.length || plan.understanding.floorsWithoutStairs.length))
    warnings.push('MISSING_STAIRS');
  return {
    recommendations,
    profiles: [...SENSOR_PROFILES, ...profiles.filter(({ id }) => id.startsWith('generic:'))],
    summary: {
      main,
      optional,
      totals: {
        required: main.reduce((sum, item) => sum + item.total, 0),
        covered: main.reduce((sum, item) => sum + item.covered, 0),
        toAdd: main.reduce((sum, item) => sum + item.toAdd, 0),
        optional: optional.reduce((sum, item) => sum + item.toAdd, 0),
      },
      warnings,
    },
  };
}
