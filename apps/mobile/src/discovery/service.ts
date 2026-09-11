import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import Zeroconf, { ImplType, type ZeroconfService } from 'react-native-zeroconf';
import { normalizeUrl, parseDiscoveryInfo, subnetCandidates } from './helpers';
import type { DiscoveredServer } from './types';

type Listener = (servers: DiscoveredServer[]) => void;
type ErrorListener = (message: string) => void;

const SERVICE_TYPE = 'michel';
const SERVICE_PROTOCOL = 'tcp';
const SERVICE_DOMAIN = 'local.';
const PORTS = [8080, 8090] as const;
const PORT = PORTS[0];
const PROBE_TIMEOUT = 700;
const CONCURRENCY = 32;

const firstAddress = (addresses?: string[]) =>
  addresses?.find((address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address)) ?? addresses?.[0];

export class DiscoveryService {
  private zeroconf: Zeroconf | null = null;
  private servers = new Map<string, DiscoveredServer>();
  private listeners = new Set<Listener>();
  private errorListeners = new Set<ErrorListener>();
  private scanning = false;
  private session = 0;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  onError(listener: ErrorListener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  start() {
    if (this.scanning || Platform.OS === 'web') return;
    this.scanning = true;
    const session = ++this.session;
    try {
      this.zeroconf = new Zeroconf();
      this.zeroconf.on('resolved', (service) => void this.handleResolved(service));
      this.zeroconf.on('remove', (name) => this.remove(name));
      this.zeroconf.on('error', (error) => this.emitError(error.message));
      const implementations =
        Platform.OS === 'android' ? [ImplType.DNSSD, ImplType.NSD] : [undefined];
      for (const implementation of implementations) {
        try {
          this.zeroconf.scan(SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_DOMAIN, implementation);
        } catch {
          // Android devices differ in the DNS-SD implementation they expose.
        }
      }
      void this.scanFallback(session);
    } catch {
      this.emitError('La découverte réseau local est indisponible sur cet appareil.');
    }
  }

  restart() {
    this.stop();
    this.start();
  }

  stop() {
    if (!this.scanning) return;
    this.scanning = false;
    this.session += 1;
    try {
      this.zeroconf?.stop();
      this.zeroconf?.removeDeviceListeners();
    } catch {
      // The native scanner may already have been stopped by the OS.
    }
    this.zeroconf = null;
  }

  async manual(input: string): Promise<DiscoveredServer> {
    const url = normalizeUrl(input);
    if (!url) throw new Error('Adresse manquante');
    return this.probe(url, 'manual', 5000);
  }

  async refreshServer(server: DiscoveredServer): Promise<DiscoveredServer> {
    return this.probe(server.url, server.source, 5000);
  }

  private async handleResolved(service: ZeroconfService) {
    const txt = service.txt ?? {};
    const address = firstAddress(service.addresses) || String(txt.host ?? '');
    const port = Number(txt.port || service.port || PORT);
    if (!address || !port) return;
    try {
      this.add(await this.probe(`http://${address}:${port}`, 'mdns', 5000));
    } catch {
      // TXT records are intentionally not trusted without the HTTP identity probe.
    }
  }

  private async scanFallback(session: number) {
    const network = await NetInfo.fetch();
    if (!this.current(session)) return;
    const address = (network.details as { ipAddress?: string | null } | null)?.ipAddress;
    const candidates = subnetCandidates(address, PORTS);

    let index = 0;
    const worker = async () => {
      while (this.current(session) && index < candidates.length) {
        const url = candidates[index++];
        if (!url) continue;
        try {
          this.add(await this.probe(url, 'subnet', PROBE_TIMEOUT));
        } catch {
          // Most candidate addresses are expected not to contain Michel.
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  private async probe(
    baseUrl: string,
    source: DiscoveredServer['source'],
    timeoutMs: number,
  ): Promise<DiscoveredServer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = normalizeUrl(baseUrl);
    try {
      const response = await fetch(`${url}/api/v1/discovery`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const info = parseDiscoveryInfo(await response.json());
      const parsed = new URL(url);
      return {
        ...info,
        id: info.instanceId,
        url,
        host: parsed.hostname,
        port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
        source,
        lastSeenAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private add(server: DiscoveredServer) {
    this.servers.set(server.instanceId, server);
    this.emit();
  }

  private remove(name: string) {
    for (const [key, server] of this.servers) {
      if (server.id === name || server.instanceName === name) this.servers.delete(key);
    }
    this.emit();
  }

  private current(session: number) {
    return this.scanning && session === this.session;
  }

  private snapshot() {
    return [...this.servers.values()].sort((a, b) => a.instanceName.localeCompare(b.instanceName));
  }

  private emit() {
    const servers = this.snapshot();
    for (const listener of this.listeners) listener(servers);
  }

  private emitError(message: string) {
    for (const listener of this.errorListeners) listener(message);
  }
}

export const discoveryService = new DiscoveryService();
