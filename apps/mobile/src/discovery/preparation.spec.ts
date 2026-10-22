import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPreparation } from './preparation';

const discovery = {
  instanceId: 'pi',
  instanceName: 'Élise OS',
  version: 'v0.1.11',
  apiVersion: 1,
  serverTime: '2026-10-22T10:00:00.000Z',
  supportsMobile: true,
  setupRequired: true,
};

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
    ),
  );

describe('fetchPreparation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports the progress while the box prepares', async () => {
    const preparation = { message: 'Téléchargement', percent: 42, steps: [] };
    respond(200, { ...discovery, preparing: true, preparation });
    await expect(fetchPreparation('http://elise.local')).resolves.toEqual({ preparation });
  });

  it('hands over once the real Élise API answers', async () => {
    respond(200, discovery);
    await expect(fetchPreparation('http://elise.local')).resolves.toEqual({ ready: discovery });
  });

  it('keeps waiting while the dashboard replaces the preparation page', async () => {
    respond(502);
    await expect(fetchPreparation('http://elise.local')).resolves.toEqual({ preparation: null });
  });
});
