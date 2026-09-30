import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedServer } from '../discovery/types';
import { prefetchHomeData } from './prefetchHomeData';

const server = {
  id: 'home-loading-test',
  instanceId: 'home-loading-test',
  instanceName: 'Élise OS',
  version: '0.1',
  apiVersion: 1,
  serverTime: '2026-09-29T10:00:00Z',
  supportsMobile: true,
  setupRequired: false,
  url: 'https://elise.example.ts.net:8443',
  urls: ['https://elise.example.ts.net:8443'],
  localUrl: null,
  remoteUrl: 'https://elise.example.ts.net:8443',
  source: 'manual',
  lastConnectedAt: '',
} satisfies SavedServer;

const response = (data: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(data),
});

afterEach(() => vi.unstubAllGlobals());

describe('Accueil initial loading', () => {
  it('waits for the daily summaries before revealing the dashboard', async () => {
    let finishSummaries: ((value: ReturnType<typeof response>) => void) | undefined;
    const summaries = new Promise<ReturnType<typeof response>>((resolve) => {
      finishSummaries = resolve;
    });
    let summaryCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/analytics/activity')) {
          summaryCalls += 1;
          return summaries;
        }
        if (url.includes('/home-summary'))
          return Promise.resolve(response({ timezone: 'Indian/Reunion' }));
        if (url.includes('/activity/feed'))
          return Promise.resolve(response({ items: [], nextCursor: null }));
        return Promise.resolve(response({}));
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolved = false;
    const pending = prefetchHomeData(client, server, 'session').then(() => {
      resolved = true;
    });

    await vi.waitFor(() => expect(summaryCalls).toBe(2));
    expect(resolved).toBe(false);
    finishSummaries?.(response({ sequences: [] }));
    await pending;

    expect(client.getQueryData(['michel', server.id, 'home-summary'])).toEqual({
      timezone: 'Indian/Reunion',
    });
    expect(resolved).toBe(true);
    client.clear();
  });
});
