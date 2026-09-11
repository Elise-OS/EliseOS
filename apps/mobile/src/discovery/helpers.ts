import type { DiscoveryInfo } from './types';

export const normalizeUrl = (input: string) => {
  const value = input.trim().replace(/\/$/, '');
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
};

export const subnetPrefix = (address?: string | null) =>
  address?.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/)?.[1] ?? null;

export const subnetCandidates = (
  address?: string | null,
  ports: readonly number[] = [8080, 8090],
) => {
  const candidates = ports.flatMap((port) => [
    `http://elise.local:${port}`,
    `http://michel.local:${port}`,
  ]);
  const prefix = subnetPrefix(address);
  if (!prefix) return candidates;
  for (let suffix = 1; suffix <= 254; suffix += 1) {
    const host = `${prefix}.${suffix}`;
    if (host === address) continue;
    for (const port of ports) candidates.push(`http://${host}:${port}`);
  }
  return candidates;
};

export const parseDiscoveryInfo = (value: unknown): DiscoveryInfo => {
  const info = value as Partial<DiscoveryInfo> | null;
  if (
    !info?.instanceId ||
    !info.instanceName ||
    info.supportsMobile !== true ||
    info.apiVersion !== 1 ||
    typeof info.setupRequired !== 'boolean'
  ) {
    throw new Error('Serveur Michel invalide');
  }
  return info as DiscoveryInfo;
};
