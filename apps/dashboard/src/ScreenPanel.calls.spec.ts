import { afterEach, describe, expect, it, vi } from 'vitest';
import { startResidentScreenCall } from './ScreenPanel';

afterEach(() => vi.unstubAllGlobals());

describe('appel depuis une alerte', () => {
  it('uses the existing screen call endpoint after checking permission and consent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            grant: { call: true },
            online: true,
            state: { settings: { consent: true }, call: null },
          }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'call-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await startResidentScreenCall();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/screen',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/screen/calls',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not start a call when the screen is offline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          grant: { call: true },
          online: false,
          state: { settings: { consent: true }, call: null },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startResidentScreenCall()).rejects.toThrow('hors ligne');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
