import { z } from 'zod';

/** Zigbee2MQTT drivers a key can be installed with. `ezsp` is the old name of `ember`. */
export const zigbeeTechnologySchema = z.enum(['zstack', 'ember', 'deconz', 'zigate', 'zboss']);
export type ZigbeeTechnology = z.infer<typeof zigbeeTechnologySchema>;

export const ZIGBEE_BAUDRATES = [38400, 57600, 115200, 230400, 460800, 921600] as const;

export const zigbeeKindSchema = z.enum(['usb', 'network', 'gpio']);
export const zigbeeModelStatusSchema = z.enum([
  'recommended',
  'supported',
  'experimental',
  'discouraged',
]);
/** How sure the box is about a key: `ambiguous` and `unknown` need a probe or a choice. */
export const zigbeeConfidenceSchema = z.enum(['high', 'medium', 'ambiguous', 'unknown']);

/** One possible way to run a key: a technology with its speed, and the model it corresponds to. */
export const zigbeeOptionSchema = z.object({
  technology: zigbeeTechnologySchema,
  baudrate: z.number().int(),
  rtscts: z.boolean(),
  modelId: z.string().nullable(),
  modelName: z.string().nullable(),
});

export const zigbeeIdentitySchema = z.object({
  modelId: z.string().nullable(),
  name: z.string().nullable(),
  vendor: z.string().nullable(),
  chip: z.string().nullable(),
  status: zigbeeModelStatusSchema.nullable(),
  confidence: zigbeeConfidenceSchema,
  source: z.enum(['usb-id', 'by-id', 'hostname', 'probe', 'generic', 'unknown']),
  /** Codes of the remarks to show (translated by the apps). */
  notes: z.array(z.string()),
  /** Proposals, best first; a single one when the key is known or probed. */
  options: z.array(zigbeeOptionSchema),
});

export const zigbeeUsbSchema = z.object({
  vid: z.string(),
  pid: z.string(),
  manufacturer: z.string().nullable(),
  product: z.string().nullable(),
  serial: z.string().nullable(),
});

export const zigbeeCandidateSchema = z.object({
  id: z.string(),
  kind: zigbeeKindSchema,
  /** What goes into the configuration: a /dev/serial/by-id path or a tcp:// address. */
  port: z.string(),
  portStability: z.enum(['by-id', 'by-path', 'raw', 'network']),
  device: z.string().nullable(),
  usb: zigbeeUsbSchema.nullable(),
  driver: z.string().nullable(),
  network: z
    .object({
      host: z.string(),
      port: z.number().int(),
      name: z.string().nullable(),
      service: z.string().nullable(),
    })
    .nullable(),
  busy: z.object({ by: z.string() }).nullable(),
  isCurrent: z.boolean(),
  identity: zigbeeIdentitySchema,
});

export const zigbeeCoordinatorSchema = z.object({
  type: z.string().nullable(),
  firmware: z.string().nullable(),
  ieee: z.string().nullable(),
  channel: z.number().int().nullable(),
  panId: z.string().nullable(),
  extendedPanId: z.string().nullable(),
});

export const zigbeeCurrentSchema = z.object({
  port: z.string(),
  adapter: z.string(),
  baudrate: z.number().int().nullable(),
  rtscts: z.boolean().nullable(),
  /** `manual`: the family chose this key; a new one is only proposed, never installed alone. */
  mode: z.enum(['auto', 'manual']),
  present: z.boolean(),
  candidateId: z.string(),
  model: z
    .object({
      id: z.string(),
      name: z.string(),
      vendor: z.string(),
      chip: z.string(),
      status: zigbeeModelStatusSchema,
      notes: z.array(z.string()),
    })
    .nullable(),
  usb: zigbeeUsbSchema.nullable(),
  z2m: z.object({
    container: z.enum(['running', 'restarting', 'stopped', 'missing']),
    bridge: z.enum(['online', 'offline', 'unknown']),
  }),
  coordinator: zigbeeCoordinatorSchema.nullable(),
  deviceCount: z.number().int().nullable(),
  firmware: z.enum(['ok', 'old', 'unknown']),
});

export const zigbeeInstallStepIdSchema = z.enum([
  'check',
  'backup',
  'configure',
  'restart',
  'verify',
]);

export const zigbeeInstallSchema = z.object({
  state: z.enum(['IDLE', 'RUNNING', 'SUCCEEDED', 'ROLLED_BACK', 'FAILED', 'CANCELLED']),
  step: z.union([zigbeeInstallStepIdSchema, z.literal('rollback')]).nullable(),
  steps: z.array(
    z.object({
      id: zigbeeInstallStepIdSchema,
      state: z.enum(['pending', 'running', 'done', 'failed']),
    }),
  ),
  progress: z.number().int().min(0).max(100).nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  target: z
    .object({
      port: z.string(),
      adapter: z.string(),
      baudrate: z.number().int(),
      rtscts: z.boolean(),
      modelName: z.string().nullable(),
    })
    .nullable(),
  networkMode: z.enum(['keep', 'new']),
  /**
   * PORT_BUSY, KEY_UNREACHABLE, NO_Z2M, PORT_UNAVAILABLE, FIRMWARE_OLD, NO_ANSWER, WRONG_ADAPTER, NETWORK_MISMATCH,
   * TIMEOUT, CANCELLED, INTERRUPTED, ROLLBACK_FAILED, INTERNAL
   */
  errorCode: z.string().nullable(),
  /** Last technical line, shown in the advanced details only. */
  detail: z.string().nullable(),
  rolledBack: z.boolean(),
  backupId: z.string().nullable(),
  coordinator: zigbeeCoordinatorSchema.nullable(),
});

/**
 * NEW_KEY: a key is plugged and nothing works yet · READY: all good · ATTENTION: key present but
 * Zigbee2MQTT is stopped/offline · KEY_MISSING: the configured key is unplugged · NO_KEY: nothing.
 */
export const zigbeeStateSchema = z.enum([
  'READY',
  'NO_KEY',
  'KEY_MISSING',
  'NEW_KEY',
  'ATTENTION',
  'INSTALLING',
]);

/**
 * How each channel of a search went: `ok`, `failed` (error or too slow), `unavailable` (the box
 * cannot do it) or `skipped` (not asked). A failing channel never hides the results of the other.
 */
export const zigbeeSearchChannelSchema = z.enum(['ok', 'failed', 'unavailable', 'skipped']);
export const zigbeeScanOutcomeSchema = z.object({
  usb: zigbeeSearchChannelSchema,
  network: zigbeeSearchChannelSchema,
});

export const zigbeeStatusSchema = z.object({
  state: zigbeeStateSchema,
  current: zigbeeCurrentSchema.nullable(),
  candidates: z.array(zigbeeCandidateSchema),
  install: zigbeeInstallSchema,
  /**
   * multiple-keys, other-key-plugged, z2m-stopped, z2m-offline, firmware-old, port-busy,
   * model-discouraged, model-experimental
   */
  issues: z.array(z.string()),
  checkedAt: z.iso.datetime(),
  /** Present on the answer of a search (older boxes do not send it). */
  scan: zigbeeScanOutcomeSchema.optional(),
});

export type ZigbeeScanOutcome = z.infer<typeof zigbeeScanOutcomeSchema>;
export type ZigbeeCandidate = z.infer<typeof zigbeeCandidateSchema>;
export type ZigbeeIdentity = z.infer<typeof zigbeeIdentitySchema>;
export type ZigbeeOption = z.infer<typeof zigbeeOptionSchema>;
export type ZigbeeCurrent = z.infer<typeof zigbeeCurrentSchema>;
export type ZigbeeCoordinator = z.infer<typeof zigbeeCoordinatorSchema>;
export type ZigbeeInstall = z.infer<typeof zigbeeInstallSchema>;
export type ZigbeeInstallStepId = z.infer<typeof zigbeeInstallStepIdSchema>;
export type ZigbeeStatus = z.infer<typeof zigbeeStatusSchema>;
export type ZigbeeState = z.infer<typeof zigbeeStateSchema>;

const zigbeePortSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^(?:\/dev\/[A-Za-z0-9._:+@=/-]+|tcp:\/\/[A-Za-z0-9.:[\]-]+:\d{1,5})$/);

/** Start of an installation: a detected key (candidateId) or an advanced manual port. */
export const zigbeeInstallRequestSchema = z
  .object({
    candidateId: z
      .string()
      .regex(/^[0-9a-f]{12}$/)
      .optional(),
    port: zigbeePortSchema.optional(),
    adapter: zigbeeTechnologySchema,
    baudrate: z
      .number()
      .int()
      .refine((value) => (ZIGBEE_BAUDRATES as readonly number[]).includes(value)),
    rtscts: z.boolean(),
    /** keep: the same Zigbee network moves to the new key; new: a fresh network (re-pair everything). */
    networkMode: z.enum(['keep', 'new']).default('keep'),
    confirmNewNetwork: z.boolean().optional(),
    modelId: z.string().max(80).optional(),
  })
  .refine((value) => Boolean(value.candidateId ?? value.port), {
    message: 'candidateId or port is required',
  })
  .refine((value) => value.networkMode !== 'new' || value.confirmNewNetwork === true, {
    message: 'A new Zigbee network needs an explicit confirmation',
  });
export type ZigbeeInstallRequest = z.input<typeof zigbeeInstallRequestSchema>;

/** `network: true` searches the home network too, next to the keys plugged on the box. */
export const zigbeeScanRequestSchema = z.object({ network: z.boolean().optional() });
export const zigbeeProbeRequestSchema = z.object({
  candidateId: z.string().regex(/^[0-9a-f]{12}$/),
});
export const zigbeeNetworkTestSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.:-]+$/),
  port: z.number().int().min(1).max(65535).default(6638),
});
export const zigbeeForgetSchema = z.object({
  candidateId: z.string().regex(/^[0-9a-f]{12}$/),
});

export const zigbeeProbeResultSchema = z.object({
  candidate: zigbeeCandidateSchema,
  /** False when the key stayed silent: the identity is unchanged and the user may choose. */
  answered: z.boolean(),
});
export type ZigbeeProbeResult = z.infer<typeof zigbeeProbeResultSchema>;

/** Technologies in the order shown in the advanced choice, with their usual speeds. */
export const ZIGBEE_TECHNOLOGY_DEFAULTS: Record<
  ZigbeeTechnology,
  { baudrates: readonly number[]; rtscts: boolean }
> = {
  zstack: { baudrates: [115200], rtscts: false },
  ember: { baudrates: [115200, 460800], rtscts: false },
  deconz: { baudrates: [115200, 38400], rtscts: false },
  zigate: { baudrates: [115200], rtscts: false },
  zboss: { baudrates: [115200], rtscts: false },
};
