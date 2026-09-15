import { z } from 'zod';

export const roomSensorCategorySchema = z.enum([
  'temperature',
  'humidity',
  'motion',
  'presence',
  'fall_detection',
  'button',
  'contact',
  'water_leak',
  'smoke',
  'carbon_monoxide',
  'air_quality',
  'illuminance',
  'camera',
]);
export type RoomSensorCategory = z.infer<typeof roomSensorCategorySchema>;

export const contactRoleSchema = z.enum([
  'MAIN_ENTRANCE',
  'FRIDGE',
  'DOOR',
  'WINDOW',
  'VERANDA',
  'OTHER',
]);
export type ContactRole = z.infer<typeof contactRoleSchema>;
export const CONTACT_TYPES: Array<{ id: ContactRole; label: string; labelEn: string }> = [
  { id: 'MAIN_ENTRANCE', label: 'Ouverture principale', labelEn: 'Main entrance' },
  { id: 'FRIDGE', label: 'Frigo', labelEn: 'Fridge' },
  { id: 'DOOR', label: 'Porte', labelEn: 'Door' },
  { id: 'WINDOW', label: 'Fenêtre', labelEn: 'Window' },
  { id: 'VERANDA', label: 'Véranda', labelEn: 'Veranda' },
  { id: 'OTHER', label: 'Autre', labelEn: 'Other' },
];

export const ROOM_SENSOR_CATEGORIES: Array<{
  id: RoomSensorCategory;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
}> = [
  {
    id: 'temperature',
    label: 'Température',
    labelEn: 'Temperature',
    description: 'Le confort de la pièce',
    descriptionEn: 'Room comfort',
  },
  {
    id: 'humidity',
    label: 'Humidité',
    labelEn: 'Humidity',
    description: 'L’équilibre de l’air ambiant',
    descriptionEn: 'Indoor humidity',
  },
  {
    id: 'motion',
    label: 'Mouvement',
    labelEn: 'Motion',
    description: 'Les déplacements et passages',
    descriptionEn: 'Movement and passages',
  },
  {
    id: 'presence',
    label: 'Présence',
    labelEn: 'Presence',
    description: 'Une présence, même immobile',
    descriptionEn: 'Presence, even when still',
  },
  {
    id: 'fall_detection',
    label: 'Détection de chute',
    labelEn: 'Fall detection',
    description: 'Les chutes signalées par un détecteur',
    descriptionEn: 'Falls reported by a detector',
  },
  {
    id: 'button',
    label: 'Bouton d’assistance',
    labelEn: 'Assistance button',
    description: 'Un bouton à portée de main',
    descriptionEn: 'A button within reach',
  },
  {
    id: 'contact',
    label: 'Ouverture',
    labelEn: 'Contact',
    description: 'Les portes, fenêtres et autres ouvrants',
    descriptionEn: 'Doors and windows',
  },
  {
    id: 'camera',
    label: 'Caméras',
    labelEn: 'Cameras',
    description: 'Les caméras de la pièce',
    descriptionEn: 'Room cameras',
  },
  {
    id: 'water_leak',
    label: 'Fuite d’eau',
    labelEn: 'Water leak',
    description: 'Les points d’eau à surveiller',
    descriptionEn: 'Water points to monitor',
  },
  {
    id: 'smoke',
    label: 'Fumée',
    labelEn: 'Smoke',
    description: 'Les signaux du détecteur de fumée',
    descriptionEn: 'Smoke detector signals',
  },
  {
    id: 'carbon_monoxide',
    label: 'Monoxyde de carbone',
    labelEn: 'Carbon monoxide',
    description: 'Les signaux du détecteur de CO',
    descriptionEn: 'CO detector signals',
  },
  {
    id: 'air_quality',
    label: 'Qualité de l’air',
    labelEn: 'Air quality',
    description: 'CO₂, particules et qualité de l’air',
    descriptionEn: 'CO₂, particles and air quality',
  },
  {
    id: 'illuminance',
    label: 'Luminosité',
    labelEn: 'Light level',
    description: 'La lumière dans la pièce',
    descriptionEn: 'Light in the room',
  },
];

export const ROOM_SENSOR_PRESETS: Record<string, readonly RoomSensorCategory[]> = {
  LIVING_ROOM: [
    'temperature',
    'humidity',
    'motion',
    'presence',
    'fall_detection',
    'button',
    'contact',
  ],
  BEDROOM: ['temperature', 'humidity', 'motion', 'presence', 'fall_detection', 'button', 'contact'],
  KITCHEN: ['temperature', 'humidity', 'motion', 'water_leak', 'contact'],
  BATHROOM: ['temperature', 'humidity', 'presence', 'fall_detection', 'button', 'water_leak'],
  TOILET: ['motion', 'presence', 'fall_detection', 'button', 'water_leak'],
  ENTRANCE: ['motion', 'contact', 'button'],
  HALLWAY: ['motion', 'smoke'],
  DINING_ROOM: ['temperature', 'humidity', 'motion', 'presence', 'button'],
  GARAGE: ['temperature', 'motion', 'contact', 'water_leak'],
  GARDEN: ['temperature', 'motion', 'illuminance'],
  TERRACE: ['temperature', 'motion', 'illuminance'],
  OTHER: ['temperature', 'motion', 'presence'],
};

export const roomSensorPreferencesSchema = z.object({
  added: z.array(roomSensorCategorySchema).max(13).default([]),
  hidden: z.array(roomSensorCategorySchema).max(13).default([]),
});
export type RoomSensorPreferences = z.infer<typeof roomSensorPreferencesSchema>;

export function visibleRoomCategories(
  kind: string,
  preferences?: RoomSensorPreferences,
  equipped: RoomSensorCategory[] = [],
) {
  const visible = new Set([
    ...(ROOM_SENSOR_PRESETS[kind] ?? ROOM_SENSOR_PRESETS.OTHER!),
    ...(preferences?.added ?? []),
  ]);
  for (const category of preferences?.hidden ?? []) visible.delete(category);
  for (const category of equipped) visible.add(category);
  return ROOM_SENSOR_CATEGORIES.filter(({ id }) => visible.has(id)).map(({ id }) => id);
}

// Occupancy is also emitted by PIR motion sensors. Only documented radar models
// or an explicitly classified person_presence capability imply still presence.
const STILL_PRESENCE_MODELS = new Set([
  'SNZB-06P',
  'SNZB-06P24',
  '3RPL01084Z',
  'FP1',
  'FP1E',
  'PS-S02D',
]);
const STILL_PRESENCE_MODEL_NAMES = ['SMARTPRESENCESENSORR3', 'MULTIFUNCTIONSMARTPRESENCESENSORR3'];
const MOTION_MODELS = new Set(['SNZB-03P', 'SNZB-03', '3RMS16BZ', '3RMS16BZ-NEW', '3RSM0147Z']);
const MOTION_MODEL_NAMES = ['WIRELESSMOTIONSENSOR'];
export type CategoryDevice = { model: string | null; capabilities: Array<{ capability: string }> };
export function deviceSupportsCategory(
  device: CategoryDevice,
  category: RoomSensorCategory,
): boolean {
  const values = new Set(device.capabilities.map(({ capability }) => capability));
  const model = device.model?.trim().toUpperCase() ?? '';
  const normalizedModel = model.replace(/[^A-Z0-9]/g, '');
  const stillPresenceModel =
    STILL_PRESENCE_MODELS.has(model) ||
    STILL_PRESENCE_MODEL_NAMES.some((name) => normalizedModel.includes(name));
  const motionModel =
    MOTION_MODELS.has(model) || MOTION_MODEL_NAMES.some((name) => normalizedModel.includes(name));
  if (category === 'presence')
    return (
      !motionModel &&
      (values.has('person_presence') || (stillPresenceModel && values.has('occupancy')))
    );
  if (category === 'motion')
    return values.has('motion') || (motionModel && values.has('occupancy'));
  if (category === 'contact') return values.has('contact') || values.has('dry_contact');
  if (category === 'air_quality')
    return ['co2', 'voc', 'total_volatile_organic_compounds', 'pm25', 'air_quality'].some((value) =>
      values.has(value),
    );
  return values.has(category);
}

export type SensorProduct = {
  recommendation?: {
    mode: 'ROOM' | 'DETECTION' | 'TARGET' | 'APPLIANCE' | 'HOME';
    detectionDistanceM?: number;
    advice: string;
    adviceEn: string;
    sourceUrl: string;
  };
  id: string;
  brand: string;
  model: string;
  name: string;
  nameEn: string;
  kind: 'ROOM_SENSOR' | 'SMART_PLUG' | 'ENERGY_MONITOR';
  testQuantity: number;
  categories: RoomSensorCategory[];
  protocol: 'zigbee' | 'wifi' | 'esphome';
  image: string;
  sourceUrl: string;
  manualUrl: string;
  integrationUrl: string;
  power: string;
  powerEn: string;
  features: string[];
  featuresEn: string[];
  preparation: string[];
  preparationEn: string[];
  placement: string[];
  placementEn: string[];
  outdoor: boolean;
  compatibility: 'DOCUMENTED' | 'UNVERIFIED';
  verifiedAt: string;
  eliseValidated: boolean;
};
