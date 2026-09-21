import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileApi } from './api';
import type { SavedServer } from './discovery/types';

const server: SavedServer = {
  id: 'calendar-test',
  instanceId: 'calendar-test',
  instanceName: 'Test',
  version: '0.1',
  apiVersion: 1,
  serverTime: '2026-09-20T10:00:00Z',
  supportsMobile: true,
  setupRequired: false,
  url: 'http://localhost:3000',
  urls: ['http://localhost:3000'],
  source: 'manual',
  lastConnectedAt: '',
};
afterEach(() => vi.unstubAllGlobals());
describe('Mobile calendar API', () => {
  it('loads a range with the authenticated session', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], timezone: 'Europe/Paris', canWrite: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await mobileApi.calendar(server, 'session', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/calendar?from='),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer session' }) as unknown,
      }),
    );
  });
});
