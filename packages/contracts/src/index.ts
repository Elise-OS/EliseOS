import { z } from 'zod';
import { contactRoleSchema, roomSensorPreferencesSchema } from './room-equipment.js';
import { calendarRecurrenceSchema } from './calendar.js';
export * from './calendar.js';
export * from './room-equipment.js';
export * from './retire-furniture.js';

export const capabilitySchema = z.enum([
  'motion',
  'occupancy',
  'person_presence',
  'contact',
  'dry_contact',
  'button',
  'temperature',
  'humidity',
  'power',
  'energy',
  'switch',
  'current',
  'voltage',
  'battery',
  'water_leak',
  'smoke',
  'carbon_monoxide',
  'co2',
  'voc',
  'pm25',
  'air_quality',
  'illuminance',
  'vibration',
  'fall_detection',
  'camera',
  'signal_strength',
]);

export const sensorInstallationStatusSchema = z.enum([
  'DETECTED',
  'NEEDS_CONFIRMATION',
  'NEEDS_PLACEMENT',
  'NEEDS_TEST',
  'OPERATIONAL',
  'ATTENTION',
  'DISABLED',
]);

export const sensorSessionStatusSchema = z.enum([
  'PENDING',
  'WAITING_FOR_DEVICE',
  'DEVICE_FOUND',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

export const sensorProtocolSchema = z.enum([
  'zigbee',
  'matter',
  'zwave',
  'bluetooth',
  'esphome',
  'wifi',
]);

export const compatibilitySchema = z.enum(['VALIDATED', 'RECOGNIZED', 'PARTIAL', 'UNSUPPORTED']);

export const cameraStatusSchema = z.enum(['ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN']);
export const cameraCompatibilitySchema = z.enum([
  'VALIDATED',
  'RECOGNIZED',
  'PARTIAL',
  'UNSUPPORTED',
]);

export const cameraCapabilitySchema = z.object({
  live: z.boolean(),
  talk: z.boolean(),
  ptz: z.boolean(),
  privacy: z.boolean(),
  snapshot: z.boolean(),
});

export const cameraSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  status: cameraStatusSchema,
  compatibility: cameraCompatibilitySchema,
  room: z.object({ id: z.string(), name: z.string(), kind: z.string() }).nullable(),
  capabilities: cameraCapabilitySchema,
  privacyMode: z.boolean(),
  consentedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  lastPersonSeenAt: z.iso.datetime().nullable(),
});

export const cameraConfigurationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  roomId: z.string().min(1),
  provider: z.string().trim().min(1).max(60).default('onvif'),
  streamEntityId: z.string().trim().min(1).max(255),
  personEntityId: z.string().trim().min(1).max(255).nullable().default(null),
  privacyEntityId: z.string().trim().min(1).max(255).nullable().default(null),
  streamUrl: z
    .string()
    .url()
    .refine((value) => ['rtsp:', 'rtsps:'].includes(new URL(value).protocol), {
      message: 'Only RTSP camera streams are accepted',
    }),
  capabilities: cameraCapabilitySchema,
  compatibility: cameraCompatibilitySchema.default('RECOGNIZED'),
  intimateSpaceConsent: z.literal(true),
});

export const cameraPrivacySchema = z.object({ enabled: z.boolean() });

export const cameraLiveSessionSchema = z.object({
  cameraId: z.string(),
  mediaUrl: z.string(),
  expiresAt: z.iso.datetime(),
  talkEnabled: z.boolean(),
});

export const cameraSnapshotSchema = z.object({
  id: z.string(),
  cameraId: z.string(),
  alertId: z.string(),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  available: z.boolean(),
});

export const mappingTransformSchema = z.enum(['ON_OFF', 'OPEN_CLOSED', 'NUMERIC', 'EVENT_ACTION']);

export const homeAssistantDeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  manufacturer: z.string().nullish(),
  model: z.string().nullish(),
  networkIdentifier: z.string().nullish(),
});

export const equipmentActionSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  service: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(z.string()).default([]),
});

export const homeAssistantEntitySchema = z.object({
  entityId: z.string().min(1),
  deviceId: z.string().nullish(),
  name: z.string().min(1),
  domain: z.string().min(1),
  deviceClass: z.string().nullish(),
  unit: z.string().nullish(),
  integration: z.string().nullish(),
  protocol: z.string().nullish(),
  available: z.boolean(),
  state: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  actions: z.array(equipmentActionSchema).default([]),
  capability: capabilitySchema.nullish(),
  compatibility: compatibilitySchema,
});

export const homeAssistantInventorySchema = z.object({
  schemaVersion: z.literal('1.0'),
  homeId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  full: z.boolean().default(true),
  devices: z.array(homeAssistantDeviceSchema),
  entities: z.array(homeAssistantEntitySchema),
});

export const discoveryFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'password', 'number', 'boolean', 'select', 'multi_select']),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  options: z
    .array(z.object({ value: z.union([z.string(), z.number(), z.boolean()]), label: z.string() }))
    .default([]),
});

export const discoveryStepSchema = z.object({
  type: z.enum(['form', 'menu', 'external', 'progress', 'complete', 'error']),
  stepId: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  fields: z.array(discoveryFieldSchema).default([]),
  menuOptions: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
  externalUrl: z.string().url().nullable().default(null),
  errors: z.record(z.string(), z.string()).default({}),
});

export const equipmentDiscoverySnapshotSchema = z.object({
  schemaVersion: z.literal('1.0'),
  homeId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  full: z.boolean().default(true),
  discoveries: z.array(
    z.object({
      discoveryKey: z.string().min(1),
      flowId: z.string().min(1),
      handler: z.string().min(1),
      source: z.string().min(1),
      title: z.string().min(1),
      step: discoveryStepSchema,
    }),
  ),
});

const configuredEquipmentItemSchema = z.object({
  source: z.literal('configured'),
  id: z.string(),
  name: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  protocol: z.string().nullable(),
  integration: z.string().nullable(),
  room: z.object({ id: z.string(), name: z.string(), kind: z.string() }).nullable(),
  status: z.enum(['OPERATIONAL', 'OFFLINE', 'ATTENTION', 'UNSUPPORTED']),
  entities: z.array(
    z.object({
      id: z.string(),
      entityId: z.string(),
      name: z.string(),
      domain: z.string(),
      deviceClass: z.string().nullable(),
      available: z.boolean(),
      state: z.unknown().nullable(),
      actions: z.array(equipmentActionSchema),
    }),
  ),
});

const discoveredEquipmentItemSchema = z.object({
  source: z.literal('discovered'),
  id: z.string(),
  name: z.string(),
  integration: z.string(),
  protocol: z.string(),
  status: z.enum(['DISCOVERED', 'CONFIGURING', 'FAILED']),
  step: discoveryStepSchema.nullable(),
  error: z.string().nullable(),
});

export const equipmentItemSchema = z.discriminatedUnion('source', [
  configuredEquipmentItemSchema,
  discoveredEquipmentItemSchema,
]);

export const equipmentActionRequestSchema = z.object({
  entityId: z.string().min(1),
  actionId: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
  confirmed: z.literal(true),
});

export const homeAssistantStateSchema = z.object({
  schemaVersion: z.literal('1.0'),
  eventId: z.string().min(1),
  homeId: z.string().min(1),
  entityId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  state: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const normalizedEventSchema = z.object({
  schemaVersion: z.literal('1.0'),
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  homeId: z.string().min(1),
  source: z.object({
    platform: z.enum(['home-assistant', 'simulator']),
    entityId: z.string().min(1),
    deviceId: z.string().nullish(),
    name: z.string().nullish(),
    manufacturer: z.string().nullish(),
    model: z.string().nullish(),
  }),
  capability: capabilitySchema,
  quality: z.enum(['good', 'degraded', 'unknown']),
  payload: z.record(z.string(), z.unknown()),
});

export const alertSchema = z.object({
  id: z.string(),
  type: z.enum([
    'INACTIVITY',
    'DOOR_OPEN',
    'SOS',
    'UNUSUAL_ACTIVITY',
    'TEMPERATURE',
    'SENSOR_OFFLINE',
    'LOW_BATTERY',
    'MEDICATION_MISSED',
    'SYSTEM',
    'WATER_LEAK',
    'SMOKE',
    'CARBON_MONOXIDE',
  ]),
  severity: z.enum(['INFO', 'ATTENTION', 'URGENT']),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']),
  title: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1).nullish(),
  openedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullish(),
});

export const alertRuleSettingsSchema = z.object({
  inactivity: z.object({ enabled: z.boolean(), minutes: z.number().int().min(15).max(1_440) }),
  doorOpen: z.object({ enabled: z.boolean(), minutes: z.number().int().min(1).max(120) }),
  lowTemperature: z.object({
    enabled: z.boolean(),
    celsius: z.number().min(5).max(25),
    minutes: z.number().int().min(1).max(240),
  }),
  highTemperature: z.object({
    enabled: z.boolean(),
    celsius: z.number().min(20).max(45),
    minutes: z.number().int().min(1).max(240),
  }),
  nightActivity: z.object({
    enabled: z.boolean(),
    startMinute: z.number().int().min(0).max(1_439),
    endMinute: z.number().int().min(0).max(1_439),
    minimumEvents: z.number().int().min(2).max(20),
  }),
  sensorOffline: z.object({
    enabled: z.boolean(),
    minutes: z.number().int().min(15).max(10_080),
  }),
  lowBattery: z.object({ enabled: z.boolean(), percent: z.number().min(1).max(50) }),
  behavioral: z.object({ enabled: z.boolean() }).default({ enabled: false }),
});

export const DEFAULT_ALERT_RULE_SETTINGS = {
  inactivity: { enabled: true, minutes: 180 },
  doorOpen: { enabled: true, minutes: 5 },
  lowTemperature: { enabled: true, celsius: 17, minutes: 15 },
  highTemperature: { enabled: true, celsius: 30, minutes: 15 },
  nightActivity: { enabled: true, startMinute: 22 * 60, endMinute: 6 * 60, minimumEvents: 3 },
  sensorOffline: { enabled: true, minutes: 120 },
  lowBattery: { enabled: true, percent: 15 },
  behavioral: { enabled: false },
} satisfies z.infer<typeof alertRuleSettingsSchema>;

export type AlertRuleSettings = z.infer<typeof alertRuleSettingsSchema>;

export const webhookEnvelopeSchema = z.object({
  schemaVersion: z.literal('1.0'),
  deliveryId: z.string(),
  event: z.enum(['alert.opened', 'alert.acknowledged', 'alert.resolved', 'alert.dismissed']),
  occurredAt: z.iso.datetime(),
  alert: alertSchema,
});

export type Capability = z.infer<typeof capabilitySchema>;
export type Compatibility = z.infer<typeof compatibilitySchema>;
export type MappingTransform = z.infer<typeof mappingTransformSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export type CameraConfiguration = z.infer<typeof cameraConfigurationSchema>;
export type CameraLiveSession = z.infer<typeof cameraLiveSessionSchema>;
export type CameraSnapshot = z.infer<typeof cameraSnapshotSchema>;
export type HomeAssistantInventory = z.infer<typeof homeAssistantInventorySchema>;
export type HomeAssistantState = z.infer<typeof homeAssistantStateSchema>;
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type Alert = z.infer<typeof alertSchema>;
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export const setupStateSchema = z.object({
  setupRequired: z.boolean(),
  systemReady: z.boolean(),
});

export const discoveryInfoSchema = z.object({
  instanceId: z.string().min(1),
  instanceName: z.string().min(1),
  version: z.string(),
  apiVersion: z.literal(1),
  serverTime: z.iso.datetime(),
  supportsMobile: z.literal(true),
  setupRequired: z.boolean(),
  localUrl: z.string().url().nullable().default(null),
  remoteUrl: z.string().url().nullable().default(null),
});

export type SetupState = z.infer<typeof setupStateSchema>;
export type DiscoveryInfo = z.infer<typeof discoveryInfoSchema>;

export const remoteAccessStateSchema = z.enum([
  'UNAVAILABLE',
  'SIGNED_OUT',
  'AUTHORIZING',
  'CONFIGURING',
  'READY',
  'DEGRADED',
]);

export const remoteAccessStatusSchema = z.object({
  state: remoteAccessStateSchema,
  installed: z.boolean(),
  remoteUrl: z.string().url().nullable(),
  hostname: z.string().nullable(),
  servePort: z.literal(8443),
  keyExpiresAt: z.iso.datetime().nullable(),
  httpsAvailable: z.boolean(),
  webrtcAvailable: z.boolean(),
  authUrl: z.string().url().nullable(),
  actionRequired: z.enum(['NONE', 'AUTHENTICATE', 'ENABLE_HTTPS', 'RETRY']),
});

export type RemoteAccessState = z.infer<typeof remoteAccessStateSchema>;
export type RemoteAccessStatus = z.infer<typeof remoteAccessStatusSchema>;

export const membershipRoleSchema = z.enum(['OWNER', 'ADMINISTRATOR', 'CAREGIVER', 'VIEWER']);
export const accessCapabilitySchema = z.enum([
  'people:read',
  'people:manage',
  'administrators:manage',
  'configuration:read',
  'configuration:manage',
  'alerts:manage',
  'medications:manage',
  'cameras:view',
  'cameras:manage',
  'cameras:privacy',
]);

const personFieldsSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).default(''),
  email: z.union([z.literal(''), z.email().max(254)]).default(''),
  relation: z.string().trim().max(100).default(''),
  isEmergency: z.boolean().default(false),
  priority: z.number().int().min(0).max(999).optional(),
});

export const createPersonSchema = personFieldsSchema
  .extend({
    access: z
      .object({
        role: z.enum(['ADMINISTRATOR', 'CAREGIVER', 'VIEWER']),
        username: z.string().trim().min(3).max(100),
        temporaryPassword: z.string().min(12).max(256),
      })
      .optional(),
  })
  .superRefine((person, context) => {
    if (!person.phone && !person.email) {
      context.addIssue({ code: 'custom', message: 'Un téléphone ou un email est requis.' });
    }
  });

export const updatePersonSchema = personFieldsSchema.partial();
export const updatePersonAccessSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    role: z.enum(['ADMINISTRATOR', 'CAREGIVER', 'VIEWER']),
    username: z.string().trim().min(3).max(100),
    temporaryPassword: z.string().min(12).max(256),
  }),
  z.object({ action: z.literal('role'), role: z.enum(['ADMINISTRATOR', 'CAREGIVER', 'VIEWER']) }),
  z.object({ action: z.literal('disable') }),
  z.object({ action: z.literal('enable') }),
  z.object({ action: z.literal('restore') }),
  z.object({
    action: z.literal('reset-password'),
    temporaryPassword: z.string().min(12).max(256),
  }),
]);

export const installationSchema = z.object({
  username: z.string().trim().min(3).max(100),
  timezone: z.string().trim().min(1).max(100),
  caregiver: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    relation: z.string().trim().min(1).max(100),
  }),
  resident: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    dailyName: z.string().trim().min(1).max(100),
    birthDate: z.union([z.literal(''), z.iso.date()]),
    language: z.enum(['Français', 'English']),
    addressAs: z.string().trim().min(1).max(100),
    customAddress: z.string().trim().max(100),
  }),
  life: z.array(z.enum(['alone', 'partner', 'relative', 'home_help', 'visits', 'pet'])),
  mobility: z.enum(['independent', 'cane', 'walker', 'wheelchair']),
  senses: z.array(z.enum(['hearing', 'vision'])),
  important: z.array(z.enum(['memory', 'parkinson', 'fall', 'vision', 'hearing'])),
  importantNote: z.string().trim().max(2000),
  habits: z.record(
    z.string().min(1).max(100),
    z.object({
      from: z.string().regex(/^\d{2}:\d{2}$/),
      to: z.string().regex(/^\d{2}:\d{2}$/),
      unknown: z.boolean(),
    }),
  ),
});

export type Installation = z.infer<typeof installationSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type AccessCapability = z.infer<typeof accessCapabilitySchema>;
export type CreatePerson = z.infer<typeof createPersonSchema>;
export type UpdatePerson = z.infer<typeof updatePersonSchema>;
export type UpdatePersonAccess = z.infer<typeof updatePersonAccessSchema>;

const planPointSchema = z.object({
  x: z.number().finite().min(0).max(10_000),
  y: z.number().finite().min(0).max(10_000),
});

export const roomGeometrySchema = z.object({
  points: z.array(planPointSchema).min(3).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#E8F0F3'),
});

export const planRoomSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  kind: z.string().trim().min(1).max(100),
  areaM2: z.number().finite().min(0.1).max(10_000).optional(),
  geometry: roomGeometrySchema,
  sensorPreferences: roomSensorPreferencesSchema.optional(),
});

export const openingSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(['DOOR', 'WINDOW', 'PASSAGE']),
  roomIds: z.array(z.string().min(1)).min(1).max(2),
  x: z.number().finite().min(0).max(10_000),
  y: z.number().finite().min(0).max(10_000),
  width: z.number().finite().min(20).max(1_000),
  rotation: z.number().finite().min(-360).max(360).default(0),
  isMainEntrance: z.boolean().optional(),
  logical: z.boolean().optional(),
  hostRoomId: z.string().min(1).max(100).optional(),
});

export const stairSchema = z.object({
  id: z.string().min(1).max(100),
  fromFloorId: z.string().min(1),
  toFloorId: z.string().min(1),
  fromRoomId: z.string().min(1),
  toRoomId: z.string().min(1),
  x: z.number().finite().min(0).max(10_000),
  y: z.number().finite().min(0).max(10_000),
  width: z.number().finite().min(40).max(2_000),
  height: z.number().finite().min(40).max(4_000),
  rotation: z.number().finite().min(-360).max(360).default(0),
  fromAnchor: planPointSchema.optional(),
  toAnchor: planPointSchema.optional(),
});

export const planItemSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum([
    'BED',
    'SINGLE_BED',
    'SOFA',
    'ARMCHAIR',
    'TABLE',
    'COFFEE_TABLE',
    'CHAIR',
    'DESK',
    'SHOWER',
    'BATHTUB',
    'TOILET',
    'WASHBASIN',
    'CABINET',
    'WARDROBE',
    'DRESSER',
    'BOOKCASE',
    'TV_STAND',
    'KITCHEN_BASE',
    'FRIDGE',
    'OVEN',
    'SINK',
    'WASHING_MACHINE',
    'POWER_OUTLET',
    'LAMP',
    'COFFEE_MACHINE',
    'KETTLE',
    'MICROWAVE',
    'DISHWASHER',
    'MEDICAL_DEVICE',
  ]),
  roomId: z.string().min(1),
  x: z.number().finite().min(0).max(10_000),
  y: z.number().finite().min(0).max(10_000),
  width: z.number().finite().min(20).max(4_000),
  height: z.number().finite().min(20).max(4_000),
  visualScaleX: z.number().finite().min(0.2).max(5).optional(),
  visualScaleY: z.number().finite().min(0.2).max(5).optional(),
  rotation: z.number().finite().min(-360).max(360).default(0),
});

export const equipmentPlacementSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(['SENSOR', 'CAMERA']),
  equipmentId: z.string().min(1),
  roomId: z.string().min(1),
  floorId: z.string().min(1),
  openingId: z.string().min(1).nullable().default(null),
  equipmentRefKind: z.enum(['DEVICE', 'SENSOR_ENTITY', 'CAMERA']).optional(),
  targetType: z.enum(['ROOM', 'ITEM', 'OPENING', 'STAIR']).default('ROOM'),
  targetId: z.string().min(1).nullable().default(null),
  placementNote: z.string().max(500).nullable().optional(),
  capabilityBindings: z
    .array(
      z.object({
        sensorId: z.string().min(1),
        capability: z.string().min(1),
        role: z.string().min(1).max(100),
        bedOccupiedWhen: z.enum(['CLOSED', 'OPEN']).optional(),
      }),
    )
    .max(50)
    .default([]),
  x: z.number().finite().min(0).max(10_000),
  y: z.number().finite().min(0).max(10_000),
  rotation: z.number().finite().min(-360).max(360).default(0),
});

export const roomConnectionSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['DOOR', 'PASSAGE', 'STAIR']),
  fromRoomId: z.string().min(1),
  toRoomId: z.string().min(1),
});

export const roomAdjacencySchema = z.object({
  id: z.string().min(1).max(200),
  floorId: z.string().min(1),
  roomIds: z.tuple([z.string().min(1), z.string().min(1)]),
  sharedWallCm: z.number().finite().nonnegative(),
  gapCm: z.number().finite().nonnegative(),
  quality: z.enum(['EXACT', 'NEAR']),
});

export const floorUnderstandingSchema = z.object({
  floorId: z.string().min(1),
  roomCount: z.number().int().nonnegative(),
  areaM2: z.number().finite().nonnegative(),
  approximate: z.boolean(),
});

export const planUnderstandingSchema = z.object({
  levels: z.array(floorUnderstandingSchema).max(30),
  isolatedRoomIds: z.array(z.string().min(1)).max(100),
  adjacentWithoutPassage: z.array(z.tuple([z.string().min(1), z.string().min(1)])).max(500),
  nearAdjacencyIds: z.array(z.string().min(1)).max(500),
  floorsWithoutStairs: z.array(z.string().min(1)).max(30),
  incompleteStairIds: z.array(z.string().min(1)).max(50),
  mainEntranceOpeningId: z.string().min(1).nullable().optional(),
});

export const floorLayoutSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  floor: z.number().int().min(-10).max(20),
  order: z.number().int().min(0).max(30),
  width: z.number().finite().min(100).max(10_000),
  height: z.number().finite().min(100).max(10_000),
  scaleCmPerUnit: z.number().finite().positive().max(1_000).nullable().default(null),
  rooms: z.array(planRoomSchema).max(100),
  openings: z.array(openingSchema).max(300),
  stairs: z.array(stairSchema).max(50),
  items: z.array(planItemSchema).max(500),
});

export const homeSetupStageSchema = z.enum([
  'DETAILS',
  'ROOMS',
  'EXAMPLE',
  'DRAW',
  'RECOMMENDATIONS',
]);

export const requestedRoomSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  kind: z.string().trim().min(1).max(100),
  floor: z.number().int().min(-10).max(20),
});

export const homeSetupDraftSchema = z.object({
  stage: homeSetupStageSchema,
  requestedRooms: z.array(requestedRoomSchema).max(100),
  tutorialCompleted: z.boolean(),
});

export const homePlanSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  revision: z.number().int().min(0),
  configured: z.boolean(),
  setupDraft: homeSetupDraftSchema.nullable().optional(),
  levels: z.array(floorLayoutSchema).min(1).max(30),
  placements: z.array(equipmentPlacementSchema).max(1_000),
  connections: z.array(roomConnectionSchema).max(500),
  adjacencies: z.array(roomAdjacencySchema).max(500).default([]),
  understanding: planUnderstandingSchema.default({
    levels: [],
    isolatedRoomIds: [],
    adjacentWithoutPassage: [],
    nearAdjacencyIds: [],
    floorsWithoutStairs: [],
    incompleteStairIds: [],
  }),
});

export const equipmentTargetSchema = z.object({
  type: z.enum(['ROOM', 'ITEM', 'OPENING', 'STAIR']),
  id: z.string().min(1),
  roomId: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().min(1),
});

export const sensorProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  manufacturer: z.string().nullable(),
  models: z.array(z.string().min(1)),
  capabilities: z.array(z.string().min(1)),
  targetTypes: z.array(z.enum(['ROOM', 'ITEM', 'OPENING', 'STAIR'])),
});

export const targetRecommendationSchema = z.object({
  id: z.string().min(1),
  target: equipmentTargetSchema,
  capability: z.string().min(1),
  priority: z.enum(['ESSENTIAL', 'RECOMMENDED', 'OPTIONAL']),
  reason: z.string().min(1),
  fulfilledByPlacementId: z.string().nullable(),
  compatibleDeviceIds: z.array(z.string()),
});

export const equipmentCoverageSchema = z.object({
  recommendations: z.array(targetRecommendationSchema),
  profiles: z.array(sensorProfileSchema),
  summary: z.object({
    main: z.array(
      z.object({
        id: z.string().min(1),
        profileId: z.string().min(1),
        label: z.string().min(1),
        manufacturer: z.string().nullable(),
        model: z.string().nullable(),
        capabilities: z.array(z.string().min(1)),
        total: z.number().int().nonnegative(),
        covered: z.number().int().nonnegative(),
        toAdd: z.number().int().nonnegative(),
        targets: z.array(
          z.object({
            target: equipmentTargetSchema,
            capabilities: z.array(z.string().min(1)),
            priority: z.enum(['ESSENTIAL', 'RECOMMENDED', 'OPTIONAL']),
            fulfilled: z.boolean(),
            deviceName: z.string().nullable(),
          }),
        ),
      }),
    ),
    optional: z.array(
      z.object({
        id: z.string().min(1),
        profileId: z.string().min(1),
        label: z.string().min(1),
        manufacturer: z.string().nullable(),
        model: z.string().nullable(),
        capabilities: z.array(z.string().min(1)),
        total: z.number().int().nonnegative(),
        covered: z.number().int().nonnegative(),
        toAdd: z.number().int().nonnegative(),
        targets: z.array(
          z.object({
            target: equipmentTargetSchema,
            capabilities: z.array(z.string().min(1)),
            priority: z.enum(['ESSENTIAL', 'RECOMMENDED', 'OPTIONAL']),
            fulfilled: z.boolean(),
            deviceName: z.string().nullable(),
          }),
        ),
      }),
    ),
    totals: z.object({
      required: z.number().int().nonnegative(),
      covered: z.number().int().nonnegative(),
      toAdd: z.number().int().nonnegative(),
      optional: z.number().int().nonnegative(),
    }),
    warnings: z.array(
      z.enum([
        'EMPTY_PLAN',
        'MISSING_MAIN_ENTRANCE',
        'MISSING_PASSAGES',
        'MISSING_STAIRS',
        'MISSING_WATER_POINTS',
      ]),
    ),
  }),
});

export const observationContextSchema = z.object({
  roomId: z.string().nullable(),
  targetType: z.enum(['ROOM', 'ITEM', 'OPENING', 'STAIR']).nullable(),
  targetId: z.string().nullable(),
  targetKind: z.string().nullable(),
  role: z.string().nullable(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  summary: z.string().nullable(),
});

export const presenceEstimateSchema = z.object({
  sessionId: z.string().nullable().default(null),
  state: z.enum(['OPEN', 'CLOSED', 'AMBIGUOUS', 'UNKNOWN']).default('UNKNOWN'),
  since: z.iso.datetime().nullable().default(null),
  lastConfirmedAt: z.iso.datetime().nullable().default(null),
  durationSeconds: z.number().int().nonnegative().nullable().default(null),
  roomId: z.string().nullable(),
  detectedAt: z.iso.datetime().nullable(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
  identifiedResidentId: z.string().nullable(),
  source: z.enum(['SENSOR', 'CAMERA', 'NONE']),
  plausibleTransition: z.boolean().nullable(),
  ambiguousReason: z.string().nullable().default(null),
  trackingState: z
    .enum(['CONFIRMED', 'IN_TRANSIT', 'AMBIGUOUS', 'STALE', 'UNKNOWN'])
    .default('UNKNOWN'),
  confirmedRoomId: z.string().nullable().default(null),
  candidateRoomId: z.string().nullable().default(null),
  pathRoomIds: z.array(z.string()).default([]),
  confidenceScore: z.number().min(0).max(1).default(0),
  reasonCodes: z.array(z.string()).default([]),
  explanation: z.string().default('Aucune présence fiable pour le moment.'),
  lastEvidenceAt: z.iso.datetime().nullable().default(null),
  evidenceSummary: z
    .array(
      z.object({
        eventId: z.string(),
        sensorId: z.string().nullable(),
        roomId: z.string().nullable(),
        capability: z.string(),
        occurredAt: z.iso.datetime(),
        observed: z.boolean().default(true),
      }),
    )
    .default([]),
  trackingDegraded: z.boolean().default(false),
});

export const presenceTransitionDecisionSchema = z.object({
  id: z.string(),
  fromRoomId: z.string().nullable(),
  toRoomId: z.string().nullable(),
  pathRoomIds: z.array(z.string()),
  outcome: z.enum(['CONFIRMED', 'PENDING', 'AMBIGUOUS', 'CANCELLED', 'STALE']),
  confidenceScore: z.number().min(0).max(1),
  reasonCodes: z.array(z.string()),
  evidenceSummary: presenceEstimateSchema.shape.evidenceSummary,
  explanation: z.string(),
  occurredAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
});

export const presenceHistorySchema = z.object({
  items: z.array(presenceTransitionDecisionSchema),
  nextCursor: z.string().nullable(),
});

export type RoomGeometry = z.infer<typeof roomGeometrySchema>;
export type HomeSetupStage = z.infer<typeof homeSetupStageSchema>;
export type RequestedRoom = z.infer<typeof requestedRoomSchema>;
export type HomeSetupDraft = z.infer<typeof homeSetupDraftSchema>;
export type PlanRoom = z.infer<typeof planRoomSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Stair = z.infer<typeof stairSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type EquipmentPlacement = z.infer<typeof equipmentPlacementSchema>;
export type EquipmentTarget = z.infer<typeof equipmentTargetSchema>;
export type SensorProfile = z.infer<typeof sensorProfileSchema>;
export type TargetRecommendation = z.infer<typeof targetRecommendationSchema>;
export type EquipmentCoverage = z.infer<typeof equipmentCoverageSchema>;
export type ObservationContext = z.infer<typeof observationContextSchema>;
export type RoomConnection = z.infer<typeof roomConnectionSchema>;
export type RoomAdjacency = z.infer<typeof roomAdjacencySchema>;
export type PlanUnderstanding = z.infer<typeof planUnderstandingSchema>;
export type FloorLayout = z.infer<typeof floorLayoutSchema>;
export type HomePlan = z.infer<typeof homePlanSchema>;
export type PresenceEstimate = z.infer<typeof presenceEstimateSchema>;
export type PresenceTransitionDecision = z.infer<typeof presenceTransitionDecisionSchema>;
export type PresenceHistory = z.infer<typeof presenceHistorySchema>;

export const dashboardPeriodSchema = z.enum(['24h', '7d', '28d']);

export const roomDwellSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalSeconds: z.number().int().nonnegative(),
  averageSeconds: z.number().int().nonnegative(),
  medianSeconds: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  reliableSessions: z.number().int().nonnegative(),
  ambiguousSeconds: z.number().int().nonnegative(),
  confidenceRate: z.number().min(0).max(1),
});

export const activityRoomStateSchema = z.enum([
  'NOT_EQUIPPED',
  'EQUIPMENT_ISSUE',
  'LEARNING',
  'NO_ACTIVITY',
  'OBSERVED',
]);

export const activityEventSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  capability: capabilitySchema,
  quality: z.string(),
  payload: z.unknown(),
  roomId: z.string(),
  roomName: z.string(),
  sensorId: z.string().nullable(),
  sensorName: z.string().nullable(),
  sensorStatus: z.string().nullable(),
  unit: z.string().nullable(),
  targetType: z.enum(['ROOM', 'ITEM', 'OPENING', 'STAIR']).nullable(),
  targetId: z.string().nullable(),
  passage: z
    .object({
      fromLevelId: z.string(),
      fromLevelName: z.string(),
      toLevelId: z.string(),
      toLevelName: z.string(),
    })
    .nullable(),
});

export const activitySequenceSchema = z.object({
  id: z.string(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  durationSeconds: z.number().int().nonnegative(),
  roomIds: z.array(z.string()),
  roomNames: z.array(z.string()),
  passages: z.array(activityEventSchema.shape.passage.unwrap()),
  totalEventCount: z.number().int().nonnegative(),
  hiddenEventCount: z.number().int().nonnegative(),
  events: z.array(activityEventSchema),
});

export const activityEnvironmentReadingSchema = z.object({
  capability: capabilitySchema,
  latestValue: z.string(),
  numericValue: z.number().finite().nullable(),
  unit: z.string().nullable(),
  minimum: z.number().finite().nullable(),
  maximum: z.number().finite().nullable(),
  points: z.array(
    z.object({
      occurredAt: z.iso.datetime(),
      value: z.number().finite(),
    }),
  ),
});

export const activityRoomOverviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  floor: z.number().int(),
  state: activityRoomStateSchema,
  environmentState: activityRoomStateSchema,
  sensorCount: z.number().int().nonnegative(),
  lastActivity: activityEventSchema.nullable(),
  environment: z.array(activityEnvironmentReadingSchema),
  safety: z.array(activityEventSchema),
});

export const activitySummarySchema = z.object({
  period: dashboardPeriodSchema,
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  total: z.number().int().nonnegative(),
  buckets: z.array(
    z.object({ start: z.iso.datetime(), label: z.string(), count: z.number().int().nonnegative() }),
  ),
  byRoom: z.array(
    z.object({ id: z.string().nullable(), name: z.string(), count: z.number().int() }),
  ),
  byCapability: z.array(z.object({ capability: capabilitySchema, count: z.number().int() })),
  dwellByRoom: z.array(roomDwellSchema).default([]),
  unknownSeconds: z.number().int().nonnegative().default(0),
  reliableBuckets: z
    .array(
      z.object({
        start: z.iso.datetime(),
        label: z.string(),
        seconds: z.number().int().nonnegative(),
        byRoom: z.record(z.string(), z.number().int().nonnegative()).default({}),
      }),
    )
    .default([]),
  observedSeconds: z.number().int().nonnegative().default(0),
  unobservedSeconds: z.number().int().nonnegative().default(0),
  lastReliableActivity: activityEventSchema.nullable().default(null),
  rooms: z.array(activityRoomOverviewSchema).default([]),
  sequences: z.array(activitySequenceSchema).default([]),
  hasMoreSequences: z.boolean().default(false),
});

export const routineRoomSchema = z.object({
  roomId: z.string(),
  roomName: z.string(),
  status: z.enum(['LEARNING', 'CONFIRMED']),
  sampleDays: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  averageSeconds: z.number().int().nonnegative(),
  medianSeconds: z.number().int().nonnegative(),
  madSeconds: z.number().int().nonnegative(),
  averageDailySeconds: z.number().int().nonnegative(),
  firstMinute: z.number().int().min(0).max(1439).nullable(),
  lastMinute: z.number().int().min(0).max(1439).nullable(),
  confidenceRate: z.number().min(0).max(1),
  todaySeconds: z.number().int().nonnegative(),
});

export const routinesSummarySchema = z.object({
  learningDays: z.number().int().nonnegative(),
  requiredLearningDays: z.number().int().positive(),
  progress: z.number().min(0).max(1),
  coverageSufficient: z.boolean(),
  behavioralAlertsEnabled: z.boolean(),
  window: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  rooms: z.array(routineRoomSchema),
  changes: z.array(
    z.object({
      roomId: z.string(),
      roomName: z.string(),
      kind: z.literal('DAILY_DWELL'),
      direction: z.enum(['LOWER', 'HIGHER']),
      observedSeconds: z.number().int().nonnegative(),
      baselineSeconds: z.number().int().nonnegative(),
    }),
  ),
});

export const sensorDetailSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  capability: capabilitySchema.or(z.string()),
  status: z.enum(['ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN']),
  compatibility: z.string(),
  lastSeenAt: z.iso.datetime().nullable(),
  lastValue: z.record(z.string(), z.unknown()).nullable(),
  device: z
    .object({ name: z.string(), manufacturer: z.string().nullable(), model: z.string().nullable() })
    .nullable(),
});

export const sensorDeviceCapabilitySchema = z.object({
  sensorId: z.string(),
  entityId: z.string(),
  capability: capabilitySchema.or(z.string()),
  label: z.string(),
  primary: z.boolean(),
  status: z.enum(['ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN']),
  value: z.record(z.string(), z.unknown()).nullable(),
  unit: z.string().nullable(),
  lastSeenAt: z.iso.datetime().nullable().optional(),
  classification: z.object({
    source: z.enum(['METADATA', 'MODEL_PROFILE', 'USER']),
    confidence: z.number().min(0).max(1),
    reason: z.string().nullable(),
    confirmedAt: z.iso.datetime().nullable(),
  }),
});

export const sensorDeviceSchema = z.object({
  id: z.string(),
  physicalDeviceId: z.string().nullable(),
  name: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  protocol: z.string().nullable(),
  integration: z.string().nullable(),
  room: z.object({ id: z.string(), name: z.string(), kind: z.string() }).nullable(),
  installationStatus: sensorInstallationStatusSchema,
  enabled: z.boolean(),
  placementConfirmedAt: z.iso.datetime().nullable(),
  placementNote: z.string().nullable().optional(),
  lastSeenAt: z.iso.datetime().nullable(),
  batteryPercent: z.number().nullable(),
  capabilities: z.array(sensorDeviceCapabilitySchema),
  action: z.enum(['CONFIRM', 'ASSIGN_ROOM', 'PLACE', 'TEST', 'CHECK', 'NONE']),
});

export const detectedSensorTypeSchema = z.enum([
  'TEMPERATURE_HUMIDITY',
  'TEMPERATURE',
  'CONTACT',
  'MOTION',
  'PRESENCE',
  'WATER_LEAK',
  'SAFETY',
  'SMART_PLUG',
  'BUTTON',
  'UNKNOWN',
]);

export const detectedSensorDeviceSchema = sensorDeviceSchema.extend({
  detectedType: detectedSensorTypeSchema,
});

export const sensorOnboardingSessionSchema = z.object({
  id: z.string(),
  protocol: sensorProtocolSchema,
  status: sensorSessionStatusSchema,
  step: z.string(),
  deviceId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  connection: z
    .object({
      online: z.boolean(),
      pairingOpen: z.boolean(),
      deviceDetected: z.boolean().default(false),
      updatedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  detectedDevice: detectedSensorDeviceSchema.nullable(),
});

export const sensorOnboardingCompletionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  roomId: z.string().min(1).nullable().default(null),
  placementNote: z.string().trim().max(500).nullable().optional(),
  buttonRole: z.enum(['ASSISTANCE', 'CONFIRMATION', 'LIGHT', 'CUSTOM_ROUTINE']).optional(),
  contactRole: contactRoleSchema.optional(),
  bedOccupiedWhen: z.enum(['CLOSED', 'OPEN']).optional(),
  target: z
    .object({
      type: z.enum(['ROOM', 'ITEM', 'OPENING', 'STAIR']),
      id: z.string().min(1),
    })
    .nullable()
    .optional(),
});

export const sensorVerificationSessionSchema = z.object({
  id: z.string(),
  deviceId: z.string().nullable(),
  sensorId: z.string().nullable(),
  status: sensorSessionStatusSchema,
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  observedAt: z.iso.datetime().nullable(),
});

export const sensorPlacementGuideSchema = z.object({
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  avoid: z.array(z.string()),
  testInstruction: z.string(),
  safetyNote: z.string().nullable(),
});

export type SensorDevice = z.infer<typeof sensorDeviceSchema>;
export type DetectedSensorType = z.infer<typeof detectedSensorTypeSchema>;
export type DetectedSensorDevice = z.infer<typeof detectedSensorDeviceSchema>;
export type SensorOnboardingSession = z.infer<typeof sensorOnboardingSessionSchema>;
export type SensorOnboardingCompletion = z.infer<typeof sensorOnboardingCompletionSchema>;
export type SensorVerificationSession = z.infer<typeof sensorVerificationSessionSchema>;
export type EquipmentAction = z.infer<typeof equipmentActionSchema>;
export type DiscoveryStep = z.infer<typeof discoveryStepSchema>;
export type EquipmentDiscoverySnapshot = z.infer<typeof equipmentDiscoverySnapshotSchema>;
export type EquipmentItem = z.infer<typeof equipmentItemSchema>;
export type SensorPlacementGuide = z.infer<typeof sensorPlacementGuideSchema>;

export const householdSchema = z.object({
  home: z.object({
    id: z.string(),
    name: z.string(),
    timezone: z.string(),
    type: z.string(),
    address: z.string().nullable(),
    floorCount: z.number().int(),
    installationStatus: z.enum(['DRAFT', 'LEARNING', 'ACTIVE']),
    learningStartedAt: z.iso.datetime().nullable(),
  }),
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      floor: z.number().int(),
      sortOrder: z.number().int(),
      sensors: z.array(sensorDetailSchema),
    }),
  ),
  unassignedSensors: z.array(sensorDetailSchema),
  residents: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      preferredName: z.string().nullable(),
      birthDate: z.string().nullable(),
      birthYear: z.number().int().nullable(),
      spokenLanguage: z.string(),
      formOfAddress: z.string().nullable(),
      photoUrl: z.string().nullable(),
      context: z
        .object({
          livesAlone: z.boolean(),
          livesWithPartner: z.boolean(),
          livesWithRelative: z.boolean(),
          receivesHomeHelp: z.boolean(),
          receivesVisits: z.boolean(),
          hasPet: z.boolean(),
          mobility: z.enum(['INDEPENDENT', 'CANE', 'WALKER', 'WHEELCHAIR']),
          hearingDifficulty: z.boolean(),
          visualDifficulty: z.boolean(),
        })
        .nullable(),
      supportNeeds: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['MEMORY', 'PARKINSON', 'FALL_RISK', 'VISION', 'HEARING', 'OTHER']),
          note: z.string().nullable(),
        }),
      ),
      habits: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          status: z.enum(['UNKNOWN', 'PROVIDED', 'LEARNING', 'CONFIRMED']),
          source: z.enum(['ONBOARDING', 'LEARNED', 'USER']),
          startMinute: z.number().int().nullable(),
          endMinute: z.number().int().nullable(),
        }),
      ),
      primary: z.boolean(),
    }),
  ),
  caregivers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      relation: z.string().nullable(),
      isPrimary: z.boolean(),
      role: z.string().nullable(),
    }),
  ),
  trustedContacts: z.array(
    z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      relation: z.string().nullable(),
      role: membershipRoleSchema.nullable(),
      isEmergency: z.boolean(),
      priority: z.number().int(),
      hasAccount: z.boolean(),
      accessDisabled: z.boolean(),
      archived: z.boolean(),
      isCurrentUser: z.boolean(),
      username: z.string().nullable(),
    }),
  ),
});

export const scheduleItemSchema = z.object({
  id: z.string(),
  type: z.enum(['VISIT', 'APPOINTMENT']),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  detail: z.string().nullable(),
  notes: z.string().nullable(),
  seriesId: z.string().nullable().default(null),
  recurrence: calendarRecurrenceSchema.default('NONE'),
  recurrenceUntil: z.iso.datetime().nullable().default(null),
});

export const realtimeEventSchema = z.object({
  type: z.enum([
    'connected',
    'activity',
    'alerts',
    'household',
    'journal',
    'schedule',
    'medications',
    'heartbeat',
  ]),
  entityId: z.string().optional(),
  timestamp: z.iso.datetime(),
});

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
export type ActivitySummary = z.infer<typeof activitySummarySchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivitySequence = z.infer<typeof activitySequenceSchema>;
export type ActivityRoomOverview = z.infer<typeof activityRoomOverviewSchema>;
export type RoomDwell = z.infer<typeof roomDwellSchema>;
export type RoutinesSummary = z.infer<typeof routinesSummarySchema>;
export type SensorDetail = z.infer<typeof sensorDetailSchema>;
export type Household = z.infer<typeof householdSchema>;
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

export const MQTT_TOPICS = {
  events: 'michel/v1/events',
  entityStates: 'michel/v1/entity-states',
  inventory: 'michel/v1/inventory',
  inventoryRequest: 'michel/v1/inventory/request',
  bridgeStatus: 'michel/v1/bridge/status',
  commands: 'michel/v1/commands',
  commandResults: 'michel/v1/commands/results',
} as const;

export * from './screen.js';

export const entranceSummarySchema = z.object({
  state: z.enum([
    'PENDING',
    'ENTRY_LIKELY',
    'EXIT_LIKELY',
    'INSIDE_ACTIVITY',
    'UNCERTAIN',
    'UNAVAILABLE',
    'NO_PASSAGE',
  ]),
  reason: z.enum([
    'WAITING',
    'FOLLOWED_BY_MOVEMENT',
    'NO_MOVEMENT_AFTER_EXIT',
    'LATER_ACTIVITY',
    'INSUFFICIENT_SEQUENCE',
    'SENSOR_UNAVAILABLE',
    'NO_OPENING',
  ]),
  openedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  evidenceAt: z.iso.datetime().nullable(),
  evaluateAfter: z.iso.datetime().nullable(),
  windowSeconds: z.number().int().positive(),
  roomName: z.string(),
});
export type EntranceSummary = z.infer<typeof entranceSummarySchema>;

export const showerDetectionSchema = z.object({
  state: z.enum(['IDLE', 'RISING', 'IN_PROGRESS', 'COMPLETED', 'UNAVAILABLE']),
  currentHumidity: z.number().min(0).max(100).nullable(),
  baselineHumidity: z.number().min(0).max(100).nullable(),
  risePercent: z.number().nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  durationMinutes: z.number().int().nonnegative().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export type ShowerDetection = z.infer<typeof showerDetectionSchema>;

export const homeSummarySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  timezone: z.string(),
  residentName: z.string(),
  presence: presenceEstimateSchema,
  rooms: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })),
  roomSummaries: z.array(
    z.object({
      roomId: z.string(),
      name: z.string(),
      kind: z.string(),
      color: z.string().nullable(),
      shower: showerDetectionSchema.nullable().optional(),
      sensors: z.array(
        z.object({
          capability: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
          unit: z.string().nullable(),
          state: z.enum(['ACTIVE', 'INACTIVE', 'UNKNOWN']),
          available: z.boolean(),
          updatedAt: z.iso.datetime().nullable(),
        }),
      ),
    }),
  ),
  latestPresence: z
    .object({
      roomId: z.string(),
      occurredAt: z.iso.datetime(),
      capability: z.enum(['motion', 'occupancy', 'person_presence']),
    })
    .nullable()
    .optional(),
  activityRooms: z.array(z.string()),
  entrance: entranceSummarySchema.nullable().default(null),
  cards: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(['FRIDGE', 'TOILET', 'OPENING', 'APPLIANCE', 'COMFORT', 'SAFETY', 'ROOM']),
      available: z.boolean(),
      observedToday: z.boolean(),
      countToday: z.number().int().nonnegative(),
      lastObservedAt: z.iso.datetime().nullable(),
      state: z.enum(['ACTIVE', 'INACTIVE', 'UNKNOWN']),
      updatedAt: z.iso.datetime().nullable(),
    }),
  ),
  sleep: z
    .object({
      roomId: z.string().nullable(),
      configured: z.boolean(),
      available: z.boolean(),
      occupied: z.boolean().nullable(),
      bedtimeAt: z.iso.datetime().nullable(),
      wakeAt: z.iso.datetime().nullable(),
    })
    .optional(),
  alert: z
    .object({
      id: z.string(),
      title: z.string(),
      severity: z.string(),
      roomName: z.string().nullable().default(null),
    })
    .nullable(),
});
export type HomeSummary = z.infer<typeof homeSummarySchema>;

export * from './liaison.js';
export * from './update.js';
