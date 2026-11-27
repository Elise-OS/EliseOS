import { DEFAULT_HEATWAVE_SETTINGS, initialScreenState } from '@elise/contracts';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCityForecast } from '../screen/screen.service';
import { HeatwaveService, heatwaveForecastFrom, storedForecast } from './heatwave.service';

const home = (role: string) => ({
  id: 'home-1',
  timezone: 'Europe/Paris',
  organization: { memberships: [{ systemRole: role }] },
});

function prismaFor(role = 'OWNER', row: Record<string, unknown> | null = null) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    heatwaveMode: {
      findUnique: vi.fn().mockResolvedValue(row),
      upsert: vi.fn().mockResolvedValue({}),
    },
    outboxMessage: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    home: {
      findFirst: vi.fn(
        ({
          where,
        }: {
          where: { organization: { memberships: { some: { systemRole?: { in: string[] } } } } };
        }) => {
          const allowed = where.organization.memberships.some.systemRole?.in;
          return Promise.resolve(!allowed || allowed.includes(role) ? home(role) : null);
        },
      ),
    },
    sensor: { count: vi.fn().mockResolvedValue(2) },
    hydrationReminder: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    residentScreen: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { prisma, tx };
}

afterEach(() => vi.unstubAllGlobals());

type Call = {
  where?: unknown;
  update?: unknown;
  data: { action?: string; topic?: string; payload?: unknown };
};
/** First argument of the first call of a Prisma mock. */
const firstCall = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls[0]?.[0] as Call;

describe('HeatwaveService', () => {
  it('reads today and tomorrow from one Open-Meteo request, without changing the TV weather', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ results: [{ name: 'Lyon', latitude: 45.76, longitude: 4.84 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            current: { time: '2026-07-15T14:00', temperature_2m: 31.2, weather_code: 0 },
            daily: {
              temperature_2m_min: [20, 21],
              temperature_2m_max: [34.5, 36],
              weather_code: [0, 1],
            },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const reading = await fetchCityForecast('Lyon heatwave test');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('forecast_days=2');
    expect(reading).toMatchObject({ maximum: 34.5, tomorrowMaximum: 36, temperature: 31.2 });
    const forecast = heatwaveForecastFrom(
      reading!,
      new Date('2026-07-15T12:00:00Z'),
      'Europe/Paris',
    );
    expect(forecast).toMatchObject({
      date: '2026-07-15',
      todayMax: 34.5,
      tomorrowMax: 36,
      outdoorNow: 31.2,
      city: 'Lyon',
    });
    expect(storedForecast(JSON.parse(JSON.stringify(forecast)) as never)).toEqual(forecast);
    expect(storedForecast({ nonsense: true })).toBeNull();
  });

  it('stores the forecast of each home whose TV has a weather city', async () => {
    const state = initialScreenState();
    state.settings.weatherCity = 'Lyon heatwave test';
    const { prisma, tx } = prismaFor();
    prisma.residentScreen.findMany.mockResolvedValue([
      { homeId: 'home-1', state, home: { timezone: 'Europe/Paris' } },
      { homeId: 'home-2', state: initialScreenState(), home: { timezone: 'Europe/Paris' } },
    ]);
    const service = new HeatwaveService(prisma as never);
    // The reading of the previous test is cached: no network here.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await service.refreshForecasts(new Date('2026-07-15T12:30:00Z'))).toBe(1);
    expect(tx.heatwaveMode.upsert).toHaveBeenCalledTimes(1);
    expect(firstCall(tx.heatwaveMode.upsert).where).toEqual({ homeId: 'home-1' });
  });

  it('keeps settings to owners and administrators', async () => {
    const caregiver = new HeatwaveService(prismaFor('CAREGIVER').prisma as never);
    await expect(
      caregiver.updateSettings('user-1', DEFAULT_HEATWAVE_SETTINGS),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const { prisma, tx } = prismaFor('ADMINISTRATOR');
    const status = await new HeatwaveService(prisma as never).updateSettings(
      'user-1',
      DEFAULT_HEATWAVE_SETTINGS,
    );
    expect(firstCall(tx.auditLog.create).data.action).toBe('HEATWAVE_SETTINGS_UPDATED');
    expect(status.canManage).toBe(true);
  });

  it('lets a caregiver turn the mode on, pushes a minimal notice to the others and audits it', async () => {
    const { prisma, tx } = prismaFor('CAREGIVER');
    const service = new HeatwaveService(prisma as never);
    const status = await service.setManual('user-1', true, new Date('2026-07-15T08:00:00Z'));
    expect(firstCall(tx.heatwaveMode.upsert).update).toMatchObject({
      active: true,
      source: 'MANUAL',
      manual: 'ON',
    });
    const push = firstCall(tx.outboxMessage.create).data;
    expect(push.topic).toBe('push');
    expect(push.payload).toEqual({
      kind: 'heatwave',
      title: 'Élise · Mode canicule activé',
      body: 'Ouvrez Élise pour voir les conseils du jour.',
      excludeUserId: 'user-1',
    });
    expect(firstCall(tx.auditLog.create).data.action).toBe('HEATWAVE_TURNED_ON');
    expect(status.canToggle).toBe(true);
    expect(status.canManage).toBe(false);
  });

  it('turns the mode off until the heat is over, without a notification', async () => {
    const { prisma, tx } = prismaFor('OWNER', { active: true, source: 'INDOOR', manual: null });
    await new HeatwaveService(prisma as never).setManual('user-1', false);
    expect(firstCall(tx.heatwaveMode.upsert).update).toMatchObject({
      active: false,
      manual: 'OFF',
    });
    expect(tx.outboxMessage.create).not.toHaveBeenCalled();
  });

  it('refuses viewers', async () => {
    const service = new HeatwaveService(prismaFor('VIEWER').prisma as never);
    await expect(service.setManual('user-1', true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('confirms a reminder of the home and refuses one of another home', async () => {
    const { prisma } = prismaFor('OWNER', { active: false });
    const service = new HeatwaveService(prisma as never);
    await service.confirmForUser('user-1', 'reminder-1');
    expect(prisma.hydrationReminder.updateMany).toHaveBeenCalledWith({
      where: { id: 'reminder-1', homeId: 'home-1', status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: expect.any(Date) as Date },
    });
    prisma.hydrationReminder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.confirmForUser('user-1', 'elsewhere')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows nothing on the TV while the mode is off', async () => {
    const { prisma } = prismaFor('OWNER', { active: false });
    const view = await new HeatwaveService(prisma as never).screenForUser('user-1');
    expect(view).toEqual({ active: false, tip: null, reminder: null });
  });

  it('shows the pending reminder and the advice of the moment while the mode is on', async () => {
    const now = new Date('2026-07-15T08:05:00Z'); // 10:05 in Paris
    const { prisma } = prismaFor('OWNER', {
      active: true,
      settings: DEFAULT_HEATWAVE_SETTINGS,
      forecast: null,
    });
    prisma.hydrationReminder.findFirst.mockResolvedValue({
      id: 'reminder-1',
      scheduledFor: new Date('2026-07-15T08:00:00Z'),
      expiresAt: new Date('2026-07-15T08:10:00Z'),
    });
    const view = await new HeatwaveService(prisma as never).screenForUser('user-1', now);
    expect(view).toEqual({
      active: true,
      tip: 'closeShutters',
      reminder: {
        id: 'reminder-1',
        scheduledFor: '2026-07-15T08:00:00.000Z',
        expiresAt: '2026-07-15T08:10:00.000Z',
      },
    });
  });

  it('counts confirmed and unconfirmed reminders of the day for the card', async () => {
    const now = new Date('2026-07-15T12:00:00Z');
    const { prisma } = prismaFor('OWNER', {
      active: true,
      source: 'FORECAST',
      settings: DEFAULT_HEATWAVE_SETTINGS,
      forecast: {
        date: '2026-07-15',
        todayMax: 34,
        tomorrowMax: 35,
        outdoorNow: 30,
        city: 'Lyon',
        fetchedAt: now.toISOString(),
      },
      registryAcknowledgedYear: 2026,
    });
    prisma.hydrationReminder.findMany.mockResolvedValue([
      { status: 'CONFIRMED', expiresAt: new Date('2026-07-15T07:10:00Z') },
      { status: 'MISSED', expiresAt: new Date('2026-07-15T09:10:00Z') },
      { status: 'PENDING', expiresAt: new Date('2026-07-15T11:10:00Z') },
    ]);
    const status = await new HeatwaveService(prisma as never).status('user-1', now);
    expect(status.reminders).toEqual({
      confirmed: 1,
      missed: 2,
      pending: 0,
      next: '2026-07-15T13:00:00.000Z',
    });
    expect(status.forecast).toMatchObject({ available: true, todayMax: 34, tomorrowMax: 35 });
    expect(status.registry.due).toBe(false);
  });
});
