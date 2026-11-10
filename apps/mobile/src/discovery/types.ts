export interface PreparationStep {
  id: 'settings' | 'network' | 'clock' | 'verify' | 'download' | 'start';
  label: string;
  state: 'done' | 'current' | 'failed' | 'pending';
  detail?: string | null;
}

/** Progress of a Raspberry Pi first boot, reported before the Élise API exists. */
export interface PreparationStatus {
  message: string;
  error: boolean;
  needsGithubAuth: boolean;
  step: PreparationStep['id'];
  steps: PreparationStep[];
  percent: number;
  address?: string | null;
  ipAddress?: string | null;
  version?: string | null;
  /** Language the box and its TV show; null while they take turns in every language. */
  language?: string | null;
  /** Who chose it: older boxes leave both fields out. */
  languageSource?: 'app' | 'config' | 'browser' | 'detected' | null;
}

export interface DiscoveryInfo {
  instanceId: string;
  instanceName: string;
  version: string;
  apiVersion: 1;
  serverTime: string;
  supportsMobile: true;
  setupRequired: boolean;
  localUrl?: string | null;
  remoteUrl?: string | null;
  preparing?: boolean;
  preparation?: PreparationStatus | null;
}

export interface DiscoveredServer extends DiscoveryInfo {
  id: string;
  url: string;
  host: string;
  port: number;
  source: 'mdns' | 'subnet' | 'tailscale' | 'manual';
  lastSeenAt: string;
}

export interface SavedServer extends DiscoveryInfo {
  id: string;
  url: string;
  urls: string[];
  source: 'mdns' | 'subnet' | 'tailscale' | 'manual';
  lastConnectedAt: string;
}
