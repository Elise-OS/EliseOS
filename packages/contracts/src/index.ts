import { z } from 'zod';

export const capabilitySchema = z.enum([
  'motion',
  'occupancy',
  'contact',
  'button',
  'temperature',
  'humidity',
  'power',
  'energy',
  'battery',
]);

export const compatibilitySchema = z.enum(['VALIDATED', 'RECOGNIZED', 'PARTIAL', 'UNSUPPORTED']);

export const mappingTransformSchema = z.enum(['ON_OFF', 'OPEN_CLOSED', 'NUMERIC', 'EVENT_ACTION']);

export const homeAssistantDeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  manufacturer: z.string().nullish(),
  model: z.string().nullish(),
});

export const homeAssistantEntitySchema = z.object({
  entityId: z.string().min(1),
  deviceId: z.string().nullish(),
  name: z.string().min(1),
  domain: z.string().min(1),
  deviceClass: z.string().nullish(),
  unit: z.string().nullish(),
  available: z.boolean(),
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
});

export const DEFAULT_ALERT_RULE_SETTINGS = {
  inactivity: { enabled: true, minutes: 180 },
  doorOpen: { enabled: true, minutes: 5 },
  lowTemperature: { enabled: true, celsius: 17, minutes: 15 },
  highTemperature: { enabled: true, celsius: 30, minutes: 15 },
  nightActivity: { enabled: true, startMinute: 22 * 60, endMinute: 6 * 60, minimumEvents: 3 },
  sensorOffline: { enabled: true, minutes: 120 },
  lowBattery: { enabled: true, percent: 15 },
} satisfies z.infer<typeof alertRuleSettingsSchema>;

export type AlertRuleSettings = z.infer<typeof alertRuleSettingsSchema>;

export const webhookEnvelopeSchema = z.object({
  schemaVersion: z.literal('1.0'),
  deliveryId: z.string(),
  event: z.enum(['alert.opened', 'alert.acknowledged', 'alert.resolved']),
  occurredAt: z.iso.datetime(),
  alert: alertSchema,
});

export type Capability = z.infer<typeof capabilitySchema>;
export type Compatibility = z.infer<typeof compatibilitySchema>;
export type MappingTransform = z.infer<typeof mappingTransformSchema>;
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
});

export type SetupState = z.infer<typeof setupStateSchema>;
export type DiscoveryInfo = z.infer<typeof discoveryInfoSchema>;

export const setupContactSchema = z
  .object({
    id: z.string().min(1).max(100),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(40).default(''),
    email: z.union([z.literal(''), z.email().max(254)]).default(''),
    relation: z.string().trim().max(100).default(''),
    role: z.enum(['proche', 'administrateur', 'urgence']),
    username: z.string().trim().min(3).max(100).optional(),
    temporaryPassword: z.string().min(12).max(256).optional(),
  })
  .superRefine((contact, context) => {
    if (!contact.phone && !contact.email) {
      context.addIssue({ code: 'custom', message: 'Un téléphone ou un email est requis.' });
    }
    if (contact.role === 'administrateur' && (!contact.username || !contact.temporaryPassword)) {
      context.addIssue({
        code: 'custom',
        message: 'Un identifiant et un mot de passe temporaire sont requis pour un administrateur.',
      });
    }
  });

export const installationSchema = z.object({
  username: z.string().trim().min(3).max(100),
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
  home: z.object({
    name: z.string().trim().min(1).max(150),
    type: z.string().trim().min(1).max(100),
    floors: z.coerce.number().int().min(1).max(20),
    address: z.string().trim().max(500),
    timezone: z.string().trim().min(1).max(100),
  }),
  rooms: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        kind: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(100),
        floor: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(100),
  contacts: z.array(setupContactSchema).max(100),
  habits: z.record(
    z.string().min(1).max(100),
    z.object({
      from: z.string().regex(/^\d{2}:\d{2}$/),
      to: z.string().regex(/^\d{2}:\d{2}$/),
      unknown: z.boolean(),
    }),
  ),
  equipment: z.array(
    z.object({
      id: z.string().min(1),
      roomId: z.string().min(1),
    }),
  ),
});

export type Installation = z.infer<typeof installationSchema>;

export const dashboardPeriodSchema = z.enum(['24h', '7d']);

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
      role: z.enum(['ADMINISTRATOR', 'RELATIVE', 'EMERGENCY']),
      priority: z.number().int(),
      hasAccount: z.boolean(),
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
