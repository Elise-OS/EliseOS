import type { DiscoveryInfo } from './types';

export const normalizeUrl = (input: string) => {
  const value = input.trim().replace(/\/$/, '');
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
};

export const subnetPrefix = (address?: string | null) =>
  address?.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/)?.[1] ?? null;

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
