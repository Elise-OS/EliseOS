// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { preloadJitsiScript } from './jitsi-preload';

describe('Jitsi preloading', () => {
  it('loads the private iframe API once before the call starts', async () => {
    const first = preloadJitsiScript('https://box.example:8444/room');
    const second = preloadJitsiScript('https://box.example:8444/another-room');
    const scripts = document.querySelectorAll<HTMLScriptElement>('script');

    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe('https://box.example:8444/external_api.js');
    Object.assign(window, { JitsiMeetExternalAPI: class {} });
    scripts[0]?.onload?.(new Event('load'));
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
