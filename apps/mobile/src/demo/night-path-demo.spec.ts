import {
  nightPathOverviewSchema,
  nightPathSchema,
  type NightPath,
  type NightPathOverview,
  type NightPathTestResult,
  type SensorDevice,
  type SensorOnboardingSession,
} from '@elise/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileApiError } from '../api';
import { mockDemoRequest, resetDemoSession } from './mock-api';

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

beforeEach(() => resetDemoSession());

describe('demo: night path lighting', () => {
  it('has a bedroom motion sensor and three Innr strips', () => {
    const devices = mockDemoRequest<SensorDevice[]>('/sensor-devices');
    const strips = devices.filter(({ model }) => model === 'FL 230 C');
    expect(strips.map(({ room }) => room?.id)).toEqual([
      'room-bedroom',
      'room-living',
      'room-bathroom',
    ]);
    for (const strip of strips) {
      expect(strip).toMatchObject({ manufacturer: 'Innr', batteryPercent: null });
      expect(strip.capabilities).toEqual([
        expect.objectContaining({ capability: 'light', value: { active: false } }),
      ]);
    }
    expect(devices.find(({ id }) => id === 'sensor-bedroom-motion')).toMatchObject({
      model: '3RMS16BZ',
      room: { id: 'room-bedroom' },
    });
  });

  it('lists the bedroom → bathroom path with the rooms that can use it', () => {
    const overview = nightPathOverviewSchema.parse(
      mockDemoRequest<NightPathOverview>('/night-paths'),
    );
    expect(overview.paths).toEqual([
      expect.objectContaining({
        name: 'Chambre → salle de bains',
        enabled: true,
        triggerRoomIds: ['room-bedroom'],
        includeBedExit: true,
        lightRoomIds: ['room-bedroom', 'room-living', 'room-bathroom'],
        startMinute: 22 * 60,
        endMinute: 7 * 60,
        brightnessPercent: 25,
        colorTemperatureKelvin: 2_200,
        offDelayMinutes: 3,
      }),
    ]);
    const bedroom = overview.rooms.find(({ id }) => id === 'room-bedroom');
    expect(bedroom).toMatchObject({ presenceSensors: 1, lights: 1 });
    expect(overview.rooms.find(({ id }) => id === 'room-bathroom')).toMatchObject({
      presenceSensors: 0,
      lights: 1,
    });
  });

  it('creates, pauses and deletes a path', () => {
    const created = mockDemoRequest<NightPath>(
      '/night-paths',
      json('POST', {
        name: 'Salon',
        enabled: true,
        triggerRoomIds: ['room-living'],
        includeBedExit: false,
        lightRoomIds: ['room-living'],
        startMinute: 23 * 60,
        endMinute: 6 * 60,
        brightnessPercent: 30,
        colorTemperatureKelvin: 2_700,
        offDelayMinutes: 5,
      }),
    );
    expect(nightPathSchema.parse(created)).toMatchObject({ name: 'Salon', activeUntil: null });
    expect(mockDemoRequest<NightPathOverview>('/night-paths').paths).toHaveLength(2);

    const paused = mockDemoRequest<NightPath>(
      `/night-paths/${created.id}`,
      json('PATCH', { enabled: false }),
    );
    expect(paused).toMatchObject({ id: created.id, enabled: false, brightnessPercent: 30 });

    mockDemoRequest(`/night-paths/${created.id}`, { method: 'DELETE' });
    expect(mockDemoRequest<NightPathOverview>('/night-paths').paths.map(({ id }) => id)).toEqual([
      'night-path-bedroom-bathroom',
    ]);
    expect(() =>
      mockDemoRequest(`/night-paths/${created.id}`, json('PATCH', { enabled: true })),
    ).toThrowError(MobileApiError);
  });

  it('finds an Innr strip as a light when it is chosen in the catalogue', () => {
    vi.useFakeTimers();
    try {
      mockDemoRequest(
        '/sensor-devices/onboarding-sessions',
        json('POST', { demoModel: 'FL 230 C' }),
      );
      vi.advanceTimersByTime(6_000);
      const session = mockDemoRequest<SensorOnboardingSession | null>(
        '/sensor-devices/onboarding-sessions/current',
      );
      expect(session?.detectedDevice).toMatchObject({
        manufacturer: 'Innr',
        model: 'FL 230 C',
        detectedType: 'LIGHT',
        batteryPercent: null,
      });
      expect(session?.detectedDevice?.capabilities.map(({ capability }) => capability)).toEqual([
        'light',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tests the lights of the chosen rooms for 20 seconds', () => {
    expect(
      mockDemoRequest<NightPathTestResult>(
        '/night-paths/test',
        json('POST', {
          lightRoomIds: ['room-bedroom', 'room-bathroom', 'room-kitchen'],
          brightnessPercent: 25,
          colorTemperatureKelvin: 2_200,
        }),
      ),
    ).toEqual({ lights: 2, seconds: 20 });
  });
});
