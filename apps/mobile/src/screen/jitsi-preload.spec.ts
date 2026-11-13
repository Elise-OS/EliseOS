import { describe, expect, it, vi } from 'vitest';
import { preloadMobileJitsi } from './jitsi-preload';

describe('Jitsi preloading', () => {
  it('warms the private external API before a call', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    await expect(preloadMobileJitsi('https://box.example:8444', fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      'https://box.example:8444/external_api.js',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('never preloads an insecure video endpoint', async () => {
    const fetcher = vi.fn();
    await expect(preloadMobileJitsi('http://box.example', fetcher)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
