import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobileApiNetworkError, MobileApiError, mobileApi } from './api';
import type { SavedServer } from './discovery/types';

const server: SavedServer = {
  id: 'network-test',
  instanceId: 'network-test',
  instanceName: 'Test',
  version: '0.1',
  apiVersion: 1,
  serverTime: '2026-09-20T10:00:00Z',
  supportsMobile: true,
  setupRequired: false,
  url: 'https://remote.example.ts.net:8443',
  urls: ['https://remote.example.ts.net:8443', 'http://elise.local:8090'],
  localUrl: 'http://elise.local:8090',
  remoteUrl: 'https://remote.example.ts.net:8443',
  source: 'manual',
  lastConnectedAt: '',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('mobile API connectivity', () => {
  it('falls back to the alternate local or Tailscale endpoint after a transport failure', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetch);

    await mobileApi.overview(server, 'session');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://remote.example.ts.net:8443/api/v1/overview');
    expect(fetch.mock.calls[1]?.[0]).toBe('http://elise.local:8090/api/v1/overview');
  });

  it('turns a hanging endpoint into a typed timeout error', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    vi.stubGlobal('fetch', fetch);

    const pending = mobileApi
      .overview(
        {
          ...server,
          id: 'network-timeout-test',
          instanceId: 'network-timeout-test',
          urls: [server.url],
          localUrl: null,
          remoteUrl: null,
        },
        'session',
      )
      .then(() => null)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(8_000);

    const error = await pending;
    expect(error).toBeInstanceOf(MobileApiError);
    expect(error).toMatchObject({ code: 'TIMEOUT' });
    expect(isMobileApiNetworkError(new MobileApiError('timeout', 'TIMEOUT'))).toBe(true);
  });
});
