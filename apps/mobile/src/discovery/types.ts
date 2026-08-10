export interface DiscoveryInfo {
  instanceId: string;
  instanceName: string;
  version: string;
  apiVersion: 1;
  serverTime: string;
  supportsMobile: true;
  setupRequired: boolean;
}

export interface DiscoveredServer extends DiscoveryInfo {
  id: string;
  url: string;
  host: string;
  port: number;
  source: 'mdns' | 'subnet' | 'manual';
  lastSeenAt: string;
}

export interface SavedServer extends DiscoveryInfo {
  id: string;
  url: string;
  source: 'mdns' | 'subnet' | 'manual';
  lastConnectedAt: string;
}
