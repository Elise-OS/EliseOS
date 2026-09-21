import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiaisonCreate } from '@michel/contracts';
import { mobileApi } from './api';
import type { SavedServer } from './discovery/types';

const server: SavedServer = {
  id: 'liaison-test',
  instanceId: 'liaison-test',
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
describe('Mobile family notebook API', () => {
  it('sends the session token, filter and encoded cursor when reading', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    vi.stubGlobal('fetch', fetch);
    await mobileApi.liaison(server, 'test-session', 'OPEN', 'entry&cursor');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/liaison?filter=OPEN&cursor=entry%26cursor',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-session' }) as unknown,
      }),
    );
  });
  it('creates a task and confirms visits through the shared API', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'entry' }) });
    vi.stubGlobal('fetch', fetch);
    const task: LiaisonCreate = {
      kind: 'TASK',
      body: 'Pain',
      dueOn: '2026-10-01',
      assigneeId: 'paul',
    };
    await mobileApi.createLiaison(server, 'test-session', task);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(task) });
    await mobileApi.completeLiaison(server, 'test-session', 'visit1', true, true);
    expect(fetch.mock.calls[1]).toEqual([
      'http://localhost:3000/api/v1/liaison/visits/visit1/completion',
      expect.objectContaining({ method: 'PATCH', body: '{"completed":true}' }),
    ]);
  });
  it('reports failed writes instead of treating them as saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(
      mobileApi.createLiaison(server, 'test-session', { kind: 'NOTE', body: 'Bonjour' }),
    ).rejects.toThrow('403');
  });
});
