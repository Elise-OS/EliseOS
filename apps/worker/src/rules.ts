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

export function isUnavailableLongEnough(
  available: boolean,
  unavailableSince: Date | null,
  now: Date,
  minutes: number,
): boolean {
  return (
    !available && unavailableSince !== null && elapsedMinutes(unavailableSince, now) >= minutes
  );
}

export function clearanceConfirmed(
  conditionClearedAt: Date | null,
  now: Date,
  minutes = 2,
): boolean {
  return conditionClearedAt !== null && elapsedMinutes(conditionClearedAt, now) >= minutes;
}

export type SensorCoverageState = 'UNCONFIGURED' | 'OUTAGE' | 'READY';

export function sensorCoverageState(
  configuredSensors: number,
  activeSensors: number,
): SensorCoverageState {
  if (configuredSensors <= 0) return 'UNCONFIGURED';
  // A partial outage is not reliable coverage for an inactivity conclusion.
  return activeSensors < configuredSensors ? 'OUTAGE' : 'READY';
}

export function shouldOpenInactivityAlert(
  lastActivity: Date | null,
  now: Date,
  minutes: number,
  coverage: SensorCoverageState,
): boolean {
  return (
    coverage === 'READY' && lastActivity !== null && elapsedMinutes(lastActivity, now) >= minutes
  );
}

export function isDoorOpenTooLong(
  payload: unknown,
  occurredAt: Date | null,
  now: Date,
  minutes: number,
): boolean {
  const open = (payload as { open?: unknown } | null)?.open === true;
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
  let outsideReadings = 0;
  let latestAt: Date | null = null;
  for (const reading of [...values].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    latest = reading.value;
    latestAt = reading.occurredAt;
    const outside = direction === 'low' ? reading.value < threshold : reading.value > threshold;
    since = outside ? (since ?? reading.occurredAt) : null;
    outsideReadings = outside ? outsideReadings + 1 : 0;
  }
  return {
    active:
      since !== null &&
      outsideReadings >= 2 &&
      latestAt !== null &&
      elapsedMinutes(since, latestAt) >= minutes &&
      elapsedMinutes(latestAt, now) <= Math.max(30, minutes * 2),
    since,
    latest,
  };
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (part: string) => parts.find((item) => item.type === part)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function previousDateKey(key: string): string {
  const day = new Date(`${key}T12:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

export function countCurrentNightActivity(
  occurredAt: Date[],
  now: Date,
  timezone: string,
  startMinute: number,
  endMinute: number,
): number {
  const nowMinute = localMinute(now, timezone);
  if (!isInMinuteWindow(nowMinute, startMinute, endMinute)) return 0;
  const overnight = startMinute > endMinute;
  const anchor = (date: Date) => {
    const key = localDateKey(date, timezone);
    return overnight && localMinute(date, timezone) < endMinute ? previousDateKey(key) : key;
  };
  const currentAnchor = anchor(now);
  const relevant = occurredAt
    .filter(
      (date) =>
        date.getTime() <= now.getTime() &&
        isInMinuteWindow(localMinute(date, timezone), startMinute, endMinute) &&
        anchor(date) === currentAnchor,
    )
    .sort((left, right) => left.getTime() - right.getTime());
  let episodes = 0;
  let lastEpisodeAt: Date | null = null;
  for (const date of relevant) {
    if (lastEpisodeAt === null || elapsedMinutes(lastEpisodeAt, date) >= 5) {
      episodes += 1;
      lastEpisodeAt = date;
    }
  }
  return episodes;
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
