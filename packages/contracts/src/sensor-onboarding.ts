import { deviceSupportsCategory, type RoomSensorCategory } from './room-equipment.js';
import { productMatchesDetectedModel } from './sensor-products.js';
import type { SensorProduct } from './room-equipment.js';

/**
 * Rules of the "add a sensor" flow shared by the web dashboard and the mobile app,
 * so both behave (and read) the same way.
 */

/** Statuses of a search session the hub is still working on. */
export const ACTIVE_ONBOARDING_STATUSES = [
  'PENDING',
  'WAITING_FOR_DEVICE',
  'DEVICE_FOUND',
] as const;
export const isActiveOnboardingStatus = (status: string) =>
  (ACTIVE_ONBOARDING_STATUSES as readonly string[]).includes(status);

/** The hub listens for four minutes. */
export const SENSOR_SEARCH_SECONDS = 240;
/** After the countdown, the hub gets a few seconds to report a late sensor. */
export const SENSOR_EXPIRY_GRACE_SECONDS = 8;
export const SENSOR_POLL_MS = 1500;
export const SENSOR_POLL_RETRY_MS = 3000;

/** Sensor kinds, gathered the way a family thinks about them. */
export type SensorCategoryGroupId = 'activity' | 'openings' | 'safety' | 'comfort';
export const SENSOR_CATEGORY_GROUPS: Array<{
  id: SensorCategoryGroupId;
  categories: RoomSensorCategory[];
}> = [
  { id: 'activity', categories: ['presence', 'motion', 'fall_detection', 'bed'] },
  { id: 'openings', categories: ['contact', 'button', 'camera'] },
  { id: 'safety', categories: ['smoke', 'carbon_monoxide', 'water_leak'] },
  {
    id: 'comfort',
    categories: ['temperature', 'humidity', 'shower', 'air_quality', 'illuminance'],
  },
];

export const formatSearchCountdown = (seconds: number) => {
  const shown = Math.max(0, Math.floor(seconds));
  return `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
};

export const secondsUntil = (expiresAt: string, now = Date.now()) =>
  Math.ceil((Date.parse(expiresAt) - now) / 1000);

/** True when the search should be declared over: late by more than the grace and nothing seen. */
export const searchTimedOut = (secondsLeft: number, deviceDetected: boolean | undefined) =>
  secondsLeft <= -SENSOR_EXPIRY_GRACE_SECONDS && !deviceDetected;

type DeviceLike = { model: string | null; capabilities: Array<{ capability: string }> };

/** Why a device found by the hub does not fit what the person is installing. */
export function pairingProblems(
  device: DeviceLike,
  options: {
    category?: RoomSensorCategory | undefined;
    targetType?: 'OPENING' | 'STAIR' | undefined;
  },
) {
  const { category, targetType } = options;
  const mismatch = !!category && !deviceSupportsCategory(device, category);
  const wrongTarget =
    (targetType === 'OPENING' && !deviceSupportsCategory(device, 'contact')) ||
    (targetType === 'STAIR' &&
      !(['motion', 'presence'] as RoomSensorCategory[]).some((id) =>
        deviceSupportsCategory(device, id),
      ));
  return { mismatch, wrongTarget };
}

/** A found device that only reports battery or signal: seen, but not usable by Élise yet. */
export const deviceLooksUnsupported = (device: { capabilities: Array<{ capability: string }> }) =>
  !device.capabilities.some(
    ({ capability }) => !['battery', 'signal_strength', 'voltage', 'unknown'].includes(capability),
  );

/** Name proposals, best first, without duplicates. */
export function pairingNameSuggestions(parts: {
  productName?: string | undefined;
  categoryLabel?: string | undefined;
  roomName?: string | undefined;
  deviceName?: string | undefined;
}) {
  return [
    parts.productName,
    parts.categoryLabel && parts.roomName ? `${parts.categoryLabel} ${parts.roomName}` : undefined,
    parts.deviceName,
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);
}

/** Texts (keys of the `sensorSetup.errors` block) for the errors the API reports with a code. */
export const SENSOR_ERROR_CODES = [
  'NO_PAIRING_MODULE',
  'ADMIN_REQUIRED',
  'ACCESS_DENIED',
  'NO_SENSOR_TO_INSTALL',
  'ALREADY_COMPLETED',
] as const;
export type SensorErrorCode = (typeof SENSOR_ERROR_CODES)[number];
export const sensorErrorCode = (value: unknown): SensorErrorCode | null =>
  typeof value === 'string' && (SENSOR_ERROR_CODES as readonly string[]).includes(value)
    ? (value as SensorErrorCode)
    : null;

/**
 * Several devices can join during one search. The hub offers them one after the other:
 * `pendingDevices` lists those still waiting after the one shown, and the completion
 * answer carries the session of the next one.
 */
export const pendingDeviceCount = (
  session: { pendingDevices?: unknown[] | null | undefined } | null | undefined,
) => session?.pendingDevices?.length ?? 0;

/**
 * The person came for one kind of sensor (a category, a precise target, a product): that
 * intent belongs to the first device of the search that fits it. Every other device found
 * by the same search is named and placed as a plain sensor, so another model joined at the
 * same time never blocks the queue. With a single device, the intent always applies (and a
 * mismatch is reported as before).
 */
export function pairingIntentApplies(
  device: DeviceLike,
  options: {
    category?: RoomSensorCategory | undefined;
    targetType?: 'OPENING' | 'STAIR' | undefined;
    product?: SensorProduct | undefined;
    /** The search found more than this device (some still waiting, or already installed). */
    severalDevices: boolean;
    /** An earlier device of the same search already took the intent. */
    intentUsed: boolean;
  },
) {
  if (options.intentUsed) return false;
  if (!options.severalDevices) return true;
  const { mismatch, wrongTarget } = pairingProblems(device, options);
  if (mismatch || wrongTarget) return false;
  return !options.product || productMatchesDetectedModel(options.product, device.model) !== false;
}
