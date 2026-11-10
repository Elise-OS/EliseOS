import { describe, expect, it, vi } from 'vitest';
import { remoteUrlFromDeepLink } from './helpers';
import { isAppLink, isPrivateIpv4, parseSetupLink, resolveSetupLinkTarget } from './setupLink';
import type { DiscoveredServer, SavedServer } from './types';

const BOX = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b';
const link = (query: string, base = 'https://eliseos.paulbreton.dev/setup/') => `${base}?${query}`;

describe('parseSetupLink', () => {
  it('reads the universal link of the TV, with or without the trailing slash', () => {
    const expected = { box: BOX, ip: '192.168.1.42', lang: 'it' };
    expect(parseSetupLink(link(`box=${BOX}&ip=192.168.1.42&lang=it`))).toEqual(expected);
    expect(
      parseSetupLink(
        link(`box=${BOX}&ip=192.168.1.42&lang=it`, 'https://eliseos.paulbreton.dev/setup'),
      ),
    ).toEqual(expected);
  });

  it('reads the same link through the app scheme', () => {
    expect(parseSetupLink(`elise://setup?box=${BOX}&ip=10.0.0.7`)).toEqual({
      box: BOX,
      ip: '10.0.0.7',
      lang: null,
    });
    expect(parseSetupLink(`elise://setup/?box=${BOX}`)).toEqual({ box: BOX, ip: null, lang: null });
  });

  it('ignores other hosts, schemes and paths', () => {
    const query = `box=${BOX}&ip=192.168.1.42`;
    expect(parseSetupLink(link(query, 'https://evil.example/setup/'))).toBeNull();
    expect(
      parseSetupLink(link(query, 'https://eliseos.paulbreton.dev.evil.example/setup/')),
    ).toBeNull();
    expect(parseSetupLink(link(query, 'http://eliseos.paulbreton.dev/setup/'))).toBeNull();
    expect(parseSetupLink(link(query, 'https://eliseos.paulbreton.dev:8443/setup/'))).toBeNull();
    expect(parseSetupLink(link(query, 'https://eliseos.paulbreton.dev/'))).toBeNull();
    expect(parseSetupLink(link(query, 'https://eliseos.paulbreton.dev/setup/other'))).toBeNull();
    expect(parseSetupLink(link(query, 'https://eliseos.paulbreton.dev/setupx'))).toBeNull();
    expect(parseSetupLink(link(query, 'elise://connect'))).toBeNull();
    expect(parseSetupLink('not a url')).toBeNull();
  });

  it('only keeps private IPv4 addresses', () => {
    const ip = (value: string) => parseSetupLink(link(`box=${BOX}&ip=${value}`))?.ip;
    expect(ip('10.20.30.40')).toBe('10.20.30.40');
    expect(ip('172.16.0.1')).toBe('172.16.0.1');
    expect(ip('172.31.255.254')).toBe('172.31.255.254');
    expect(ip('192.168.0.10')).toBe('192.168.0.10');
    // Public, loopback and link-local addresses are dropped, the box id stays.
    expect(ip('8.8.8.8')).toBeNull();
    expect(ip('172.32.0.1')).toBeNull();
    expect(ip('172.15.0.1')).toBeNull();
    expect(ip('127.0.0.1')).toBeNull();
    expect(ip('169.254.1.1')).toBeNull();
    // Malformed addresses.
    expect(ip('192.168.1')).toBeNull();
    expect(ip('192.168.1.256')).toBeNull();
    expect(ip('192.168.01.2')).toBeNull();
    expect(ip('192.168.1.2.3')).toBeNull();
    expect(ip('192.168.1.2:80')).toBeNull();
    expect(ip('evil.example')).toBeNull();
    expect(ip('')).toBeNull();
  });

  it('drops an invalid box id or language', () => {
    expect(parseSetupLink(link('box=abc/def&ip=192.168.1.42'))).toEqual({
      box: null,
      ip: '192.168.1.42',
      lang: null,
    });
    expect(parseSetupLink(link(`box=${'a'.repeat(65)}&ip=192.168.1.42`))?.box).toBeNull();
    expect(parseSetupLink(link(`box=${'a'.repeat(64)}`))?.box).toBe('a'.repeat(64));
    expect(parseSetupLink(link(`box=${BOX}&lang=de`))?.lang).toBeNull();
    expect(parseSetupLink(link(`box=${BOX}&lang=FR`))?.lang).toBe('fr');
  });

  it('needs a valid box or a private address', () => {
    expect(parseSetupLink(link('lang=fr'))).toBeNull();
    expect(parseSetupLink(link('box=%3Cscript%3E&ip=8.8.8.8'))).toBeNull();
    expect(parseSetupLink('https://eliseos.paulbreton.dev/setup/')).toBeNull();
  });

  it('leaves the Tailscale connection link to its own reader', () => {
    const connect = 'elise://connect?url=https%3A%2F%2Felise.example.ts.net%3A8443';
    expect(parseSetupLink(connect)).toBeNull();
    expect(remoteUrlFromDeepLink(connect)).toBe('https://elise.example.ts.net:8443');
  });
});

describe('isPrivateIpv4', () => {
  it('accepts the RFC 1918 ranges only', () => {
    expect(isPrivateIpv4('10.0.0.0')).toBe(true);
    expect(isPrivateIpv4('192.169.0.1')).toBe(false);
    expect(isPrivateIpv4('0.0.0.0')).toBe(false);
  });
});

describe('isAppLink', () => {
  it('recognizes the links meant for the app', () => {
    expect(isAppLink(link(`box=${BOX}`))).toBe(true);
    expect(isAppLink('https://eliseos.paulbreton.dev/setup')).toBe(true);
    expect(isAppLink('elise://connect?url=x')).toBe(true);
    expect(isAppLink('elise://setup')).toBe(true);
    expect(isAppLink('https://example.com/setup')).toBe(false);
    expect(isAppLink('http://eliseos.paulbreton.dev/setup')).toBe(false);
    expect(isAppLink('/')).toBe(false);
  });
});

const discovery = (
  instanceId: string,
  extra: Partial<DiscoveredServer> = {},
): DiscoveredServer => ({
  id: instanceId,
  instanceId,
  instanceName: 'Élise OS',
  version: 'v0.1.23',
  apiVersion: 1,
  serverTime: '2026-11-09T10:00:00.000Z',
  supportsMobile: true,
  setupRequired: true,
  url: 'http://192.168.1.42',
  host: '192.168.1.42',
  port: 80,
  source: 'manual',
  lastSeenAt: '2026-11-09T10:00:00.000Z',
  ...extra,
});

const savedServer = (instanceId: string): SavedServer => ({
  id: instanceId,
  instanceId,
  instanceName: 'Maison',
  version: 'v0.1.23',
  apiVersion: 1,
  serverTime: '2026-11-09T10:00:00.000Z',
  supportsMobile: true,
  setupRequired: false,
  url: 'http://192.168.1.20',
  urls: ['http://192.168.1.20'],
  source: 'mdns',
  lastConnectedAt: '2026-11-08T10:00:00.000Z',
});

describe('resolveSetupLinkTarget', () => {
  const wait = () => Promise.resolve();

  it('opens a box already saved in the app without asking the network', async () => {
    const probe = vi.fn();
    const known = savedServer(BOX);
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: 'fr' },
        saved: [savedServer('other'), known],
        discovered: () => [],
        probe,
        wait,
      }),
    ).resolves.toEqual({ kind: 'saved', server: known });
    expect(probe).not.toHaveBeenCalled();
  });

  it('prefers the box found by the local network scan', async () => {
    const probe = vi.fn();
    const found = discovery(BOX, { source: 'mdns' });
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => [discovery('other'), found],
        probe,
        wait,
      }),
    ).resolves.toEqual({ kind: 'found', server: found });
    expect(probe).not.toHaveBeenCalled();
  });

  it('asks the address of the QR code when the scan has not found the box', async () => {
    const answered = discovery(BOX, { preparing: true });
    const probe = vi.fn(() => Promise.resolve(answered));
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => [],
        probe,
        wait,
      }),
    ).resolves.toEqual({ kind: 'found', server: answered });
    expect(probe).toHaveBeenCalledWith('192.168.1.42');
  });

  it('refuses another box answering at that address', async () => {
    const other = discovery('someone-else');
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => [],
        probe: () => Promise.resolve(other),
        wait,
      }),
    ).resolves.toEqual({ kind: 'mismatch', server: other });
  });

  it('opens whatever box answers when the link only has an address', async () => {
    const answered = discovery('pi');
    await expect(
      resolveSetupLinkTarget({
        link: { box: null, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => [],
        probe: () => Promise.resolve(answered),
        wait,
      }),
    ).resolves.toEqual({ kind: 'found', server: answered });
  });

  it('keeps the saved entry when the address leads to a known box', async () => {
    const known = savedServer('pi');
    await expect(
      resolveSetupLinkTarget({
        link: { box: null, ip: '192.168.1.42', lang: null },
        saved: [known],
        discovered: () => [],
        probe: () => Promise.resolve(discovery('pi')),
        wait,
      }),
    ).resolves.toEqual({ kind: 'saved', server: known });
  });

  it('tries the address again while the scan goes on', async () => {
    const found = discovery(BOX, { source: 'mdns' });
    let scanned: DiscoveredServer[] = [];
    const probe = vi.fn(() => {
      scanned = [found];
      return Promise.reject(new Error('timeout'));
    });
    const delays: number[] = [];
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => scanned,
        probe,
        wait: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
        retryDelayMs: 1000,
      }),
    ).resolves.toEqual({ kind: 'found', server: found });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([1000]);
  });

  it('gives up after a few tries when nothing answers', async () => {
    const probe = vi.fn(() => Promise.reject(new Error('timeout')));
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => [],
        probe,
        wait,
        attempts: 3,
      }),
    ).resolves.toEqual({ kind: 'unreachable' });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('only watches the scan when the link has no address', async () => {
    const probe = vi.fn();
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: null, lang: null },
        saved: [],
        discovered: () => [],
        probe,
        wait,
      }),
    ).resolves.toEqual({ kind: 'unreachable' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('stops when the link is no longer wanted', async () => {
    const probe = vi.fn(() => Promise.reject(new Error('timeout')));
    let tries = 0;
    await expect(
      resolveSetupLinkTarget({
        link: { box: BOX, ip: '192.168.1.42', lang: null },
        saved: [],
        discovered: () => [],
        probe,
        wait,
        cancelled: () => ++tries > 2,
      }),
    ).resolves.toEqual({ kind: 'unreachable' });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
