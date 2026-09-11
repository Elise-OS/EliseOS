import { describe, expect, it } from 'vitest';
import { normalizeUrl, parseDiscoveryInfo, subnetCandidates, subnetPrefix } from './helpers';

describe('Michel discovery helpers', () => {
  it('normalizes manual local addresses', () => {
    expect(normalizeUrl('192.168.1.50:8080/')).toBe('http://192.168.1.50:8080');
    expect(normalizeUrl('http://michel.local:8080/')).toBe('http://michel.local:8080');
  });

  it('derives the local IPv4 subnet', () => {
    expect(subnetPrefix('192.168.1.42')).toBe('192.168.1');
    expect(subnetPrefix('fe80::1')).toBeNull();
  });

  it('scans every host on both Élise OS ports', () => {
    const candidates = subnetCandidates('192.168.1.20');

    expect(candidates).toContain('http://192.168.1.55:8090');
    expect(candidates).toContain('http://192.168.1.55:8080');
    expect(candidates).not.toContain('http://192.168.1.20:8090');
    expect(candidates).toContain('http://elise.local:8090');
  });

  it('rejects services that do not expose the Michel mobile contract', () => {
    expect(() => parseDiscoveryInfo({ instanceId: 'fake' })).toThrow('Serveur Michel invalide');
    expect(
      parseDiscoveryInfo({
        instanceId: 'michel-1',
        instanceName: 'Michel OS',
        version: '0.1.0',
        apiVersion: 1,
        serverTime: '2026-08-03T10:00:00.000Z',
        supportsMobile: true,
        setupRequired: false,
      }).instanceName,
    ).toBe('Michel OS');
  });
});
