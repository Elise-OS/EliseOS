import { BadRequestException, Injectable } from '@nestjs/common';
import { createConnection, isIP } from 'node:net';
import type { CameraNetworkDevice } from '@michel/contracts';

const RTSP_PORTS = [554, 8554, 10554] as const;
const PROBE_PORTS = [...RTSP_PORTS];
const PORT_TIMEOUT_MS = 450;
const RTSP_OPTIONS_TIMEOUT_MS = 900;
const MAX_RTSP_HEADER_BYTES = 8_192;
const HOST_CONCURRENCY = 24;

type NetworkRange = { first: number; last: number };
type RtspProbe = { authenticationRequired: boolean; fingerprint?: string };
type CameraProbe = { device: CameraNetworkDevice; fingerprint?: string };

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function isPrivateIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  );
}

function rtspFingerprint(headers: string): string | undefined {
  const challenge = headers
    .split('\r\n')
    .find((line) => /^www-authenticate:\s*digest\b/i.test(line));
  const realm = challenge?.match(/\brealm=(?:"([^"]+)"|([^,\s]+))/i);
  const deviceToken = (realm?.[1] ?? realm?.[2] ?? '').match(/^Login to ([a-f\d]{16,})$/i)?.[1];
  return deviceToken ? `rtsp-realm:${deviceToken.toLowerCase()}` : undefined;
}

function parseRange(cidr: string): NetworkRange {
  const [address, prefixText] = cidr.trim().split('/');
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (
    !address ||
    isIP(address) !== 4 ||
    !Number.isInteger(prefix) ||
    prefix < 24 ||
    prefix > 32 ||
    !isPrivateIpv4(address)
  ) {
    throw new BadRequestException(
      'La découverte caméra accepte uniquement des plages privées de 256 adresses maximum.',
    );
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipv4ToNumber(address) & mask) >>> 0;
  const last = (network | (~mask >>> 0)) >>> 0;
  return { first: network, last };
}

@Injectable()
export class CameraNetworkDiscoveryService {
  private activeScan: Promise<CameraNetworkDevice[]> | null = null;

  public async discover(): Promise<CameraNetworkDevice[]> {
    if (this.activeScan) return this.activeScan;
    const activeScan = this.scanConfiguredRanges().finally(() => {
      if (this.activeScan === activeScan) this.activeScan = null;
    });
    this.activeScan = activeScan;
    return activeScan;
  }

  private async scanConfiguredRanges(): Promise<CameraNetworkDevice[]> {
    const ranges = this.ranges();
    const addresses = [...new Set(ranges.flatMap(({ first, last }) => this.hosts(first, last)))];
    const found: CameraProbe[] = [];
    for (let offset = 0; offset < addresses.length; offset += HOST_CONCURRENCY) {
      const batch = addresses.slice(offset, offset + HOST_CONCURRENCY);
      const results = await Promise.all(batch.map((address) => this.probeHost(address)));
      found.push(...results.filter((device): device is CameraProbe => Boolean(device)));
    }
    const unique: CameraNetworkDevice[] = [];
    const seenFingerprints = new Set<string>();
    for (const candidate of found.sort(
      (a, b) => ipv4ToNumber(a.device.address) - ipv4ToNumber(b.device.address),
    )) {
      if (candidate.fingerprint && seenFingerprints.has(candidate.fingerprint)) continue;
      if (candidate.fingerprint) seenFingerprints.add(candidate.fingerprint);
      unique.push(candidate.device);
    }
    return unique;
  }

  public async verifyTarget(address: string, port: number): Promise<void> {
    if (!isPrivateIpv4(address) || !this.ranges().some((range) => this.contains(range, address))) {
      throw new BadRequestException(
        'Cette caméra doit se trouver dans une plage privée configurée pour la découverte.',
      );
    }
    if (
      !(RTSP_PORTS as readonly number[]).includes(port) ||
      !(await this.portOpen(address, port))
    ) {
      throw new BadRequestException('Le port RTSP sélectionné ne répond plus sur le réseau local.');
    }
  }

  private ranges(): NetworkRange[] {
    const configured = process.env.MICHEL_CAMERA_DISCOVERY_CIDRS ?? '192.168.1.0/24';
    return configured.split(',').map((cidr) => parseRange(cidr));
  }

  private hosts(first: number, last: number): string[] {
    const hosts: string[] = [];
    const networkSize = last - first + 1;
    const start = networkSize > 2 ? first + 1 : first;
    const end = networkSize > 2 ? last - 1 : last;
    for (let value = start; value <= end; value += 1) hosts.push(numberToIpv4(value));
    return hosts;
  }

  private contains(range: NetworkRange, address: string): boolean {
    const numeric = ipv4ToNumber(address);
    return numeric >= range.first && numeric <= range.last;
  }

  private async probeHost(address: string): Promise<CameraProbe | null> {
    const responses = await Promise.all(
      PROBE_PORTS.map(async (port) => {
        const result = await this.probeRtsp(address, port);
        return result ? { port, ...result } : null;
      }),
    );
    const openPorts = responses
      .filter((response): response is NonNullable<typeof response> => response !== null)
      .map(({ port }) => port);
    const rtspPort = RTSP_PORTS.find((port) => openPorts.includes(port));
    if (!rtspPort) return null;
    const fingerprint = responses.find((response) => response?.fingerprint)?.fingerprint;
    return {
      device: {
        address,
        rtspPort,
        openPorts,
        authenticationRequired: responses.some((response) => response?.authenticationRequired),
      },
      ...(fingerprint ? { fingerprint } : {}),
    };
  }

  private probeRtsp(address: string, port: number): Promise<RtspProbe | null> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: address, port });
      let settled = false;
      let response = '';
      const timeout = { handle: undefined as ReturnType<typeof setTimeout> | undefined };
      const finish = (result: RtspProbe | null) => {
        if (settled) return;
        settled = true;
        if (timeout.handle) clearTimeout(timeout.handle);
        socket.destroy();
        resolve(result);
      };
      timeout.handle = setTimeout(() => finish(null), RTSP_OPTIONS_TIMEOUT_MS);
      socket.once('connect', () => {
        socket.write(
          `OPTIONS rtsp://${address}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: EliseOSCameraDiscovery\r\n\r\n`,
        );
      });
      socket.on('data', (chunk) => {
        response += chunk.toString('latin1');
        if (response.length > MAX_RTSP_HEADER_BYTES) {
          finish(null);
          return;
        }
        const headerEnd = response.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const headers = response.slice(0, headerEnd);
        const statusCode = headers.match(/^RTSP\/1\.[01]\s+(\d{3})(?:\s|$)/i)?.[1];
        if (!statusCode) {
          finish(null);
          return;
        }
        const fingerprint = rtspFingerprint(headers);
        finish({
          authenticationRequired: statusCode === '401',
          ...(fingerprint ? { fingerprint } : {}),
        });
      });
      socket.once('error', () => finish(null));
    });
  }

  private portOpen(address: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: address, port });
      let settled = false;
      const timeout = { handle: undefined as ReturnType<typeof setTimeout> | undefined };
      const finish = (open: boolean) => {
        if (settled) return;
        settled = true;
        if (timeout.handle) clearTimeout(timeout.handle);
        socket.destroy();
        resolve(open);
      };
      timeout.handle = setTimeout(() => finish(false), PORT_TIMEOUT_MS);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
  }
}
