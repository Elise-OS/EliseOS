import type { HomePlan, SensorDevice, SensorOnboardingSession } from '@elise/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileApiError } from '../api';
import { mockDemoRequest } from './mock-api';

const SESSIONS = '/sensor-devices/onboarding-sessions';
const post = (path: string, body: unknown = {}) =>
  mockDemoRequest<SensorOnboardingSession>(path, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('demo: add a sensor', () => {
  it('walks through listening, spotting and finding the chosen sensor', () => {
    const started = post(SESSIONS, { demoModel: '3RDS17BZ' });
    expect(started).toMatchObject({ status: 'WAITING_FOR_DEVICE', detectedDevice: null });
    expect(started.connection).toMatchObject({ pairingOpen: true, deviceDetected: false });

    vi.advanceTimersByTime(3_500);
    const spotted = mockDemoRequest<SensorOnboardingSession>(`${SESSIONS}/${started.id}`);
    expect(spotted.status).toBe('WAITING_FOR_DEVICE');
    expect(spotted.connection?.deviceDetected).toBe(true);

    vi.advanceTimersByTime(2_000);
    const ready = mockDemoRequest<SensorOnboardingSession>(`${SESSIONS}/${started.id}`);
    expect(ready.status).toBe('DEVICE_FOUND');
    expect(ready.detectedDevice).toMatchObject({
      model: '3RDS17BZ',
      room: null,
      detectedType: 'CONTACT',
    });
    expect(
      ready.detectedDevice?.capabilities.some(({ capability }) => capability === 'contact'),
    ).toBe(true);
    // The current search is what the app resumes after a restart.
    expect(mockDemoRequest<SensorOnboardingSession | null>(`${SESSIONS}/current`)?.id).toBe(
      started.id,
    );
  });

  it('installs the sensor in the chosen room and lists it afterwards', () => {
    const started = post(SESSIONS, { demoModel: '3RDS17BZ' });
    vi.advanceTimersByTime(6_000);
    const plan = mockDemoRequest<HomePlan>('/household/plan');
    const target = plan.levels.flatMap((level) => level.rooms)[0]!;
    const done = mockDemoRequest<{ device: SensorDevice }>(`${SESSIONS}/${started.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Porte du salon', roomId: target.id }),
    });
    expect(done.device).toMatchObject({ name: 'Porte du salon', room: { id: target.id } });
    const devices = mockDemoRequest<SensorDevice[]>('/sensor-devices');
    expect(devices.filter(({ name }) => name === 'Porte du salon')).toHaveLength(1);
    // A finished search is no longer offered for resuming.
    expect(mockDemoRequest<SensorOnboardingSession | null>(`${SESSIONS}/current`)).toBeNull();
  });

  it('refuses to install before a sensor is found', () => {
    const started = post(SESSIONS);
    expect(() =>
      mockDemoRequest(`${SESSIONS}/${started.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Too early', roomId: 'x' }),
      }),
    ).toThrowError(MobileApiError);
  });

  it('stops the search when it is cancelled', () => {
    const started = post(SESSIONS);
    const cancelled = mockDemoRequest<SensorOnboardingSession>(`${SESSIONS}/${started.id}`, {
      method: 'DELETE',
    });
    expect(cancelled.status).toBe('CANCELLED');
    vi.advanceTimersByTime(10_000);
    expect(mockDemoRequest<SensorOnboardingSession>(`${SESSIONS}/${started.id}`).status).toBe(
      'CANCELLED',
    );
  });

  it('finds a motion detector when the person does not pick a listed model', () => {
    post(SESSIONS);
    vi.advanceTimersByTime(6_000);
    const current = mockDemoRequest<SensorOnboardingSession | null>(`${SESSIONS}/current`);
    expect(current?.detectedDevice?.detectedType).toBe('MOTION');
  });
});
