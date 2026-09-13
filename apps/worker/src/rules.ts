export interface TimedValue {
  occurredAt: Date;
  value: number;
}

export function elapsedMinutes(since: Date | null, now: Date): number {
  if (!since) return 0;
  return Math.max(0, (now.getTime() - since.getTime()) / 60_000);
}

export function isStale(lastSeenAt: Date | null, now: Date, minutes: number): boolean {
  return !lastSeenAt || elapsedMinutes(lastSeenAt, now) >= minutes;
}

export function isSensorConnectionStale(
  sensorLastSeenAt: Date | null,
  deviceLastSeenAt: Date | null,
  now: Date,
  minutes: number,
): boolean {
  const lastContact =
    deviceLastSeenAt && (!sensorLastSeenAt || deviceLastSeenAt > sensorLastSeenAt)
      ? deviceLastSeenAt
      : sensorLastSeenAt;
  return isStale(lastContact, now, minutes);
}

export type SensorCoverageState = 'UNCONFIGURED' | 'OUTAGE' | 'READY';

export function sensorCoverageState(
  configuredSensors: number,
  activeSensors: number,
): SensorCoverageState {
  if (configuredSensors <= 0) return 'UNCONFIGURED';
  return activeSensors <= 0 ? 'OUTAGE' : 'READY';
}

export function isDoorOpenTooLong(
  payload: unknown,
  occurredAt: Date | null,
  now: Date,
  minutes: number,
): boolean {
  const open = Boolean((payload as { open?: unknown } | null)?.open);
  return open && elapsedMinutes(occurredAt, now) >= minutes;
}

export function persistentTemperatureViolation(
  values: TimedValue[],
  now: Date,
  threshold: number,
  minutes: number,
  direction: 'low' | 'high',
): { active: boolean; since: Date | null; latest: number | null } {
  let since: Date | null = null;
  let latest: number | null = null;
  for (const reading of [...values].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    latest = reading.value;
    const outside = direction === 'low' ? reading.value < threshold : reading.value > threshold;
    since = outside ? (since ?? reading.occurredAt) : null;
  }
  return {
    active: since !== null && elapsedMinutes(since, now) >= minutes,
    since,
    latest,
  };
}

export function localMinute(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function isInMinuteWindow(minute: number, startMinute: number, endMinute: number): boolean {
  return startMinute <= endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}

export function countNightActivity(
  occurredAt: Date[],
  timezone: string,
  startMinute: number,
  endMinute: number,
): number {
  return occurredAt.filter((date) =>
    isInMinuteWindow(localMinute(date, timezone), startMinute, endMinute),
  ).length;
}

export function numericPayload(payload: unknown): number | null {
  const value = (payload as { value?: unknown } | null)?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
