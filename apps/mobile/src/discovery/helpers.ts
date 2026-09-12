import type { DiscoveryInfo } from './types';

export const normalizeUrl = (input: string) => {
  const value = input.trim().replace(/\/$/, '');
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return value.split('/')[0]?.split(':')[0]?.endsWith('.ts.net')
    ? `https://${value}`
    : `http://${value}`;
};

export const serverUrls = (server: {
  url: string;
  urls?: string[];
  localUrl?: string | null;
  remoteUrl?: string | null;
}) => [
  ...new Set(
    [server.url, ...(server.urls ?? []), server.localUrl, server.remoteUrl]
      .filter((value): value is string => Boolean(value))
      .map(normalizeUrl),
  ),
];

const activeUrls = new Map<string, string>();

export const activeServerUrl = (server: { instanceId: string; url: string }) =>
  activeUrls.get(server.instanceId) ?? server.url;

export const rememberActiveServerUrl = (server: { instanceId: string }, url: string) => {
  activeUrls.set(server.instanceId, url);
};

export const preferredServerUrls = (server: {
  instanceId: string;
  url: string;
  urls?: string[];
  localUrl?: string | null;
  remoteUrl?: string | null;
}) => [...new Set([activeServerUrl(server), ...serverUrls(server)])];

export const remoteUrlFromDeepLink = (input: string) => {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'michel:' || parsed.hostname !== 'connect') return '';
    const target = new URL(parsed.searchParams.get('url') ?? '');
    if (
      target.protocol !== 'https:' ||
      !target.hostname.endsWith('.ts.net') ||
      target.port !== '8443' ||
      target.username ||
      target.password
    )
      return '';
    return target.origin;
  } catch {
    return '';
  }
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
