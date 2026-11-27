import {
  DEFAULT_HEATWAVE_SETTINGS,
  HYDRATION_REMINDER_MINUTES,
  heatwaveLocalClock,
  heatwaveRegistryDue,
  heatwaveSettingsSchema,
  heatwaveTip,
  nextHydrationReminder,
  type HeatwaveScreenView,
  type HeatwaveSettings,
  type HeatwaveSource,
  type HeatwaveStatus,
} from './heatwave.js';

/**
 * Heatwave mode of the "Maison Martin" demos (web and mobile), in memory. The answers have the
 * shape of the real API. `heat: true` starts during a heat episode (hot forecast, warm rooms,
 * a drink reminder on the TV); otherwise the mode waits and the family can turn it on by hand.
 * Reminders are only shown: they leave the TV by themselves, nobody answers them.
 */
export interface HeatwaveDemoResponse {
  status: number;
  body?: unknown;
}

export interface HeatwaveDemo {
  handle(method: string, pathname: string, rawBody?: string): HeatwaveDemoResponse | null;
}

export function createHeatwaveDemo(
  options: {
    heat?: boolean;
    timeZone?: string;
    city?: string;
    /** Room names in the visitor's language: the warmest one, and the one of a mild day. */
    rooms?: { warm: string; mild: string };
  } = {},
): HeatwaveDemo {
  const timeZone = options.timeZone ?? 'Europe/Paris';
  const heat = options.heat === true;
  const minute = 60_000;
  const now = () => new Date();
  let settings: HeatwaveSettings = structuredClone(DEFAULT_HEATWAVE_SETTINGS);
  let active = heat;
  let source: HeatwaveSource | null = heat ? 'FORECAST' : null;
  let manual: 'ON' | 'OFF' | null = null;
  let activatedAt: string | null = heat
    ? new Date(Date.now() - 26 * 60 * minute).toISOString()
    : null;
  let deactivatedAt: string | null = null;
  let registryYear: number | null = null;
  let reminder: { id: string; scheduledFor: string; expiresAt: string } | null = null;
  // Reminders already shown today: the earlier ones of the heat episode, then the current one.
  let shown = heat ? 1 : 0;

  const showReminder = () => {
    const at = now();
    reminder = {
      id: `hydration-demo-${at.getTime()}`,
      scheduledFor: new Date(at.getTime() - 2 * minute).toISOString(),
      expiresAt: new Date(at.getTime() + (HYDRATION_REMINDER_MINUTES - 2) * minute).toISOString(),
    };
    shown += 1;
  };
  if (heat) showReminder();

  const currentReminder = () =>
    active && reminder && new Date(reminder.expiresAt) > now() ? reminder : null;

  const status = (): HeatwaveStatus => ({
    settings,
    active,
    source,
    manual,
    activatedAt,
    deactivatedAt,
    timezone: timeZone,
    indoor: heat
      ? { sensors: 4, current: 28.6, maxToday: 29.4, maxTodayRoom: options.rooms?.warm ?? null }
      : { sensors: 4, current: 21.4, maxToday: 22.1, maxTodayRoom: options.rooms?.mild ?? null },
    forecast: {
      available: true,
      city: options.city ?? 'Lyon',
      todayMax: heat ? 34 : 18,
      tomorrowMax: heat ? 35 : 17,
      outdoorNow: heat ? 27 : 14,
      fetchedAt: new Date(Date.now() - 12 * minute).toISOString(),
    },
    reminders: {
      shown,
      next: active
        ? (nextHydrationReminder(settings, now(), timeZone)?.toISOString() ?? null)
        : null,
    },
    registry: heatwaveRegistryDue({ now: now(), timeZone, acknowledgedYear: registryYear, active }),
    canManage: true,
    canToggle: true,
  });

  const screen = (): HeatwaveScreenView => {
    const current = currentReminder();
    return {
      active,
      tip: active
        ? heatwaveTip({
            settings,
            minute: heatwaveLocalClock(now(), timeZone).minute,
            outdoor: heat ? 27 : 14,
            indoor: heat ? 28.6 : 21.4,
          })
        : null,
      reminder: current
        ? { id: current.id, scheduledFor: current.scheduledFor, expiresAt: current.expiresAt }
        : null,
    };
  };

  const parse = (rawBody?: string): unknown => {
    try {
      return rawBody ? (JSON.parse(rawBody) as unknown) : {};
    } catch {
      return {};
    }
  };

  return {
    handle(method, pathname, rawBody) {
      if (!pathname.startsWith('/heatwave')) return null;
      const body = parse(rawBody) as Record<string, unknown>;
      if (pathname === '/heatwave' && method === 'GET') return { status: 200, body: status() };
      if (pathname === '/heatwave/screen') return { status: 200, body: screen() };
      if (pathname === '/heatwave/settings' && method === 'PUT') {
        const parsed = heatwaveSettingsSchema.safeParse(body);
        if (!parsed.success) return { status: 400, body: { message: 'Invalid settings' } };
        settings = parsed.data;
        return { status: 200, body: status() };
      }
      if (pathname === '/heatwave/manual' && method === 'POST') {
        const wanted = body.active === true;
        if (wanted && !active) {
          activatedAt = now().toISOString();
          showReminder();
        }
        if (!wanted && active) deactivatedAt = now().toISOString();
        active = wanted;
        source = wanted ? 'MANUAL' : null;
        manual = wanted ? 'ON' : 'OFF';
        return { status: 200, body: status() };
      }
      if (pathname === '/heatwave/registry' && method === 'POST') {
        registryYear = typeof body.year === 'number' ? body.year : now().getFullYear();
        return { status: 200, body: status() };
      }
      return { status: 404, body: { message: 'Not found' } };
    },
  };
}
