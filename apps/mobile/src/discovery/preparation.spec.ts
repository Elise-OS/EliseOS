import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPreparation, sendPreparationLanguage } from './preparation';

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

describe('sendPreparationLanguage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the app language to the preparing box', async () => {
    respond(200, { language: 'es', languageSource: 'app', changed: true });
    await expect(sendPreparationLanguage('http://elise.local', 'es')).resolves.toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://elise.local/language');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ language: 'es', source: 'app' });
  });

  it('does not insist with an older box that does not know the language', async () => {
    respond(404, { message: 'Introuvable.' });
    await expect(sendPreparationLanguage('http://elise.local', 'pt')).resolves.toBe(true);
  });

  it('reports an unreachable box so the app can try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Network request failed'))),
    );
    await expect(sendPreparationLanguage('http://elise.local', 'fr')).resolves.toBe(false);
  });

  it('gives up on a box that does not answer in time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      ),
    );
    await expect(sendPreparationLanguage('http://elise.local', 'fr', 10)).resolves.toBe(false);
  });
});
