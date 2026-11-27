import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileApi } from './api';
import type { SavedServer } from './discovery/types';

const server: SavedServer = {
  id: 'night-path-test',
  instanceId: 'night-path-test',
  instanceName: 'Test',
  version: '0.1',
  apiVersion: 1,
  serverTime: '2026-11-27T10:00:00Z',
  supportsMobile: true,
  setupRequired: false,
  url: 'http://localhost:3000',
  urls: ['http://localhost:3000'],
  source: 'manual',
  lastConnectedAt: '',
};

const answer = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });

afterEach(() => vi.unstubAllGlobals());

describe('Mobile night path API', () => {
  it('reads the night paths with the session', async () => {
    const fetch = answer({ timezone: 'Europe/Paris', paths: [], rooms: [] });
    vi.stubGlobal('fetch', fetch);
    await expect(mobileApi.nightPaths(server, 'session')).resolves.toMatchObject({ paths: [] });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/night-paths',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer session' }) as unknown,
      }),
    );
  });

  it('creates, updates, deletes and tests with the matching methods', async () => {
    const fetch = answer({ id: 'path 1' });
    vi.stubGlobal('fetch', fetch);
    const input = {
      name: 'Nuit',
      enabled: true,
      triggerRoomIds: ['bedroom'],
      includeBedExit: true,
      lightRoomIds: ['bedroom'],
      startMinute: 1320,
      endMinute: 420,
      brightnessPercent: 25,
      colorTemperatureKelvin: 2200,
      offDelayMinutes: 3 as const,
    };
    await mobileApi.createNightPath(server, 'session', input);
    await mobileApi.updateNightPath(server, 'session', 'path 1', { enabled: false });
    await mobileApi.deleteNightPath(server, 'session', 'path 1');
    await mobileApi.testNightPath(server, 'session', {
      lightRoomIds: ['bedroom'],
      brightnessPercent: 25,
      colorTemperatureKelvin: 2200,
    });
    const calls = (fetch.mock.calls as Array<[string, RequestInit]>).map(([url, init]) => [
      url.replace('http://localhost:3000/api/v1', ''),
      init.method,
      init.body,
    ]);
    expect(calls).toEqual([
      ['/night-paths', 'POST', JSON.stringify(input)],
      ['/night-paths/path%201', 'PATCH', JSON.stringify({ enabled: false })],
      ['/night-paths/path%201', 'DELETE', undefined],
      [
        '/night-paths/test',
        'POST',
        JSON.stringify({
          lightRoomIds: ['bedroom'],
          brightnessPercent: 25,
          colorTemperatureKelvin: 2200,
        }),
      ],
    ]);
  });

  it('reports a refused change with its status', async () => {
    vi.stubGlobal('fetch', answer({ code: 'ADMIN_REQUIRED' }, 403));
    await expect(
      mobileApi.updateNightPath(server, 'session', 'path-1', { enabled: false }),
    ).rejects.toMatchObject({ status: 403, apiCode: 'ADMIN_REQUIRED' });
  });
});
