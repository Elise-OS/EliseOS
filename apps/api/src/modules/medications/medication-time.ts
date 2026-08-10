export function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function weekdayForDateKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

export function scheduledDate(dateKey: string, minuteOfDay: number, timezone: string): Date {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(desiredAsUtc);
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(candidate);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    const observedAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour') % 24,
      part('minute'),
    );
    const correction = desiredAsUtc - observedAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

export function minuteFromTime(value: string): number {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
}
