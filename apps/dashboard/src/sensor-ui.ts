import {
  deviceSupportsCategory,
  sensorErrorCode,
  type RoomSensorCategory,
  type SensorErrorCode,
} from '@elise/contracts';
import { t } from './i18n';

export type SensorRoom = {
  id: string;
  name: string;
  kind: string;
  floor?: number;
  sortOrder?: number;
};
export type SensorUiDevice = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  protocol: string | null;
  integration: string | null;
  room: SensorRoom | null;
  installationStatus: string;
  enabled: boolean;
  placementConfirmedAt: string | null;
  placementNote?: string | null | undefined;
  lastSeenAt: string | null;
  batteryPercent: number | null;
  capabilities: Array<{
    sensorId: string;
    entityId: string;
    capability: string;
    label: string;
    primary: boolean;
    status: string;
    value: Record<string, unknown> | null;
    unit: string | null;
    lastSeenAt?: string | null | undefined;
    classification: { confidence: number; reason: string | null; confirmedAt: string | null };
  }>;
  action: 'CONFIRM' | 'ASSIGN_ROOM' | 'PLACE' | 'TEST' | 'CHECK' | 'NONE';
};

export function connectedDevicesForCategory(
  devices: SensorUiDevice[],
  category: RoomSensorCategory,
) {
  return devices.filter((device) => deviceSupportsCategory(device, category));
}

type HealthCapability = { primary: boolean; status: string };

export function sensorCapabilitiesForHealth<T extends HealthCapability>(capabilities: T[]): T[] {
  const primary = capabilities.filter((capability) => capability.primary);
  return primary.length > 0 ? primary : capabilities;
}

export function sensorDeviceHealthStatus(device: {
  enabled: boolean;
  capabilities: HealthCapability[];
}): 'ONLINE' | 'DEGRADED' | 'OFFLINE' {
  const states = sensorCapabilitiesForHealth(device.capabilities).map(({ status }) => status);
  if (!device.enabled || states.length === 0 || states.every((status) => status === 'OFFLINE'))
    return 'OFFLINE';
  if (states.some((status) => ['DEGRADED', 'OFFLINE', 'UNKNOWN'].includes(status)))
    return 'DEGRADED';
  return 'ONLINE';
}

/** An answer of the API that is not a success; `code` identifies the cases the app translates. */
export class SensorRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: SensorErrorCode | null,
  ) {
    super(message);
    this.name = 'SensorRequestError';
  }
}

export async function sensorRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    throw new SensorRequestError(
      typeof body.message === 'string'
        ? body.message
        : t('sensorUi.connectionFailed', { status: response.status }),
      response.status,
      sensorErrorCode(body.code),
    );
  }
  return result as T;
}
export const sensorJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
