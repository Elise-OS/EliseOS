import { describe, expect, it } from 'vitest';
import { homeWebAddresses } from './webAddresses';

describe('homeWebAddresses', () => {
  it('returns the .local name and the private IP the phone reached', () => {
    expect(
      homeWebAddresses({
        localUrl: 'http://elise.local',
        url: 'http://192.168.1.42:8080',
        urls: ['https://elise.tail1234.ts.net'],
      }),
    ).toEqual({ name: 'http://elise.local', ip: 'http://192.168.1.42:8080' });
  });

  it('finds the IP among saved addresses and ignores public or Tailscale ones', () => {
    expect(
      homeWebAddresses({
        localUrl: null,
        url: 'https://elise.tail1234.ts.net',
        urls: ['http://100.64.0.3:8080', 'http://10.0.0.7:8080/'],
      }),
    ).toEqual({ name: null, ip: 'http://10.0.0.7:8080' });
  });

  it('returns nothing usable for malformed values', () => {
    expect(homeWebAddresses({ localUrl: 'not a url', url: 'elise' })).toEqual({
      name: null,
      ip: null,
    });
  });
});
