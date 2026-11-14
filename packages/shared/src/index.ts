export type Brand<T, B extends string> = T & { readonly __brand: B };
export type HomeId = Brand<string, 'HomeId'>;
export type ResidentId = Brand<string, 'ResidentId'>;

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type SensorCoverageState = 'UNCONFIGURED' | 'OUTAGE' | 'READY';

export function sensorCoverageState(
  configuredSensors: number,
  activeSensors: number,
): SensorCoverageState {
  if (configuredSensors <= 0) return 'UNCONFIGURED';
  return activeSensors < configuredSensors ? 'OUTAGE' : 'READY';
}

/** Picks a real battery percentage over Zigbee's boolean battery_low projection. */
export function batteryPercentFromSensors(
  sensors: Array<{
    capability: string;
    available: boolean;
    status: string;
    events: Array<{ payload: unknown }>;
  }>,
): number | null {
  const batteries = sensors.filter((sensor) => sensor.capability === 'battery');
  const selected =
    batteries.find(
      (sensor) =>
        !(
          sensor.events[0]?.payload &&
          typeof sensor.events[0].payload === 'object' &&
          'low' in sensor.events[0].payload
        ),
    ) ?? batteries[0];
  const payload = selected?.events[0]?.payload;
  if (
    !selected?.available ||
    selected.status === 'OFFLINE' ||
    !payload ||
    typeof payload !== 'object'
  )
    return null;
  const value = (payload as { value?: unknown }).value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
