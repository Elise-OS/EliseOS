import {
  ROOM_SENSOR_CATEGORIES,
  deviceSupportsCategory,
  type EquipmentCoverage,
  type HomePlan,
  type RoomSensorCategory,
} from '@michel/contracts';
import { SENSOR_PRODUCTS } from './sensor-products';
import { sensorCapabilitiesForHealth, type SensorUiDevice } from './sensor-ui';

export type CoverageType = RoomSensorCategory | 'energy';
export const COVERAGE_TYPES = [
  ...ROOM_SENSOR_CATEGORIES,
  {
    id: 'energy' as const,
    label: 'Énergie',
    labelEn: 'Energy',
    description: 'La consommation des appareils et du logement',
    descriptionEn: 'Appliance and home energy use',
  },
];
export const COVERAGE_FAMILIES: { label: string; labelEn: string; types: CoverageType[] }[] = [
  {
    label: 'Présence et déplacements',
    labelEn: 'Presence and movement',
    types: ['presence', 'motion'],
  },
  {
    label: 'Confort et qualité de l’air',
    labelEn: 'Comfort and air quality',
    types: ['temperature', 'humidity', 'air_quality', 'illuminance'],
  },
  { label: 'Ouvertures', labelEn: 'Openings', types: ['contact'] },
  {
    label: 'Eau et sécurité',
    labelEn: 'Water and safety',
    types: ['water_leak', 'smoke', 'carbon_monoxide', 'fall_detection'],
  },
  { label: 'Assistance', labelEn: 'Assistance', types: ['button'] },
  { label: 'Énergie', labelEn: 'Energy', types: ['energy'] },
];
export const coverageProducts = (type: CoverageType, outdoor = false) =>
  SENSOR_PRODUCTS.filter(
    (p) =>
      p.compatibility === 'DOCUMENTED' &&
      (type === 'energy' ? p.kind !== 'ROOM_SENSOR' : p.categories.includes(type)) &&
      (!outdoor || p.outdoor),
  );
const matches = (capability: string, type: CoverageType) =>
  type === 'presence'
    ? ['person_presence', 'presence'].includes(capability)
    : type === 'air_quality'
      ? ['air_quality', 'co2', 'voc', 'pm25', 'total_volatile_organic_compounds'].includes(
          capability,
        )
      : type === 'contact'
        ? ['contact', 'dry_contact'].includes(capability)
        : type === 'energy'
          ? ['power', 'energy'].includes(capability)
          : capability === type;
export function coverageNeeds(
  type: CoverageType,
  coverage: EquipmentCoverage,
  plan: HomePlan | null,
  devices: SensorUiDevice[],
) {
  const recommendations = coverage.recommendations.filter((r) => matches(r.capability, type));
  // A specific opening replaces the generic room opening suggestion.
  const specificRooms = new Set(
    recommendations.filter((r) => r.target.type !== 'ROOM').map((r) => r.target.roomId),
  );
  return recommendations
    .filter((r) => r.target.type !== 'ROOM' || !specificRooms.has(r.target.roomId))
    .map((r) => {
      const floor = plan?.levels.find((l) => l.rooms.some((room) => room.id === r.target.roomId));
      const room = floor?.rooms.find((room) => room.id === r.target.roomId);
      const assigned = devices.filter(
        (d) =>
          d.room?.id === r.target.roomId &&
          (type === 'energy'
            ? d.capabilities.some((c) => matches(c.capability, type))
            : deviceSupportsCategory(d, type)),
      );
      const covered =
        Boolean(r.fulfilledByPlacementId) || (r.target.type === 'ROOM' && assigned.length > 0);
      const needsCheck = assigned.some(
        (d) =>
          !d.enabled ||
          sensorCapabilitiesForHealth(d.capabilities).some((c) => c.status !== 'ONLINE'),
      );
      return { ...r, room, floor, covered, needsCheck };
    });
}
export type CoverageState = 'COVERED' | 'MISSING' | 'AVAILABLE' | 'NO_PRODUCT';
export function coverageState(
  type: CoverageType,
  coverage: EquipmentCoverage,
  plan: HomePlan | null,
  devices: SensorUiDevice[],
): CoverageState {
  const needs = coverageNeeds(type, coverage, plan, devices);
  if (needs.length && needs.every((n) => n.covered)) return 'COVERED';
  if (
    type === 'energy' &&
    devices.some((d) => d.room && d.capabilities.some((c) => matches(c.capability, type)))
  )
    return 'COVERED';
  if (!coverageProducts(type).length) return 'NO_PRODUCT';
  return needs.length ? 'MISSING' : 'AVAILABLE';
}
