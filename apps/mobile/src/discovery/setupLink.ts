import { isLanguage, type Language } from '@elise/i18n';
import type { DiscoveredServer, SavedServer } from './types';

/** Host of the universal links printed as a QR code on the TV during a box's first boot. */
export const SETUP_LINK_HOST = 'eliseos.paulbreton.dev';

/** What the TV's QR code says about the box being installed. */
export interface SetupLink {
  /** instanceId of the box, as its /api/v1/discovery answers it. */
  box: string | null;
  /** Its private IPv4 address on the home network. */
  ip: string | null;
  /** Language the TV shows; informative only, it never changes the app's language. */
  lang: Language | null;
}

const BOX_ID = /^[A-Za-z0-9-]{1,64}$/;
const OCTET = /^(0|[1-9]\d{0,2})$/;

const ipv4Octets = (value: string) => {
  const parts = value.split('.');
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
};

/** True for a dotted IPv4 address of a home network (RFC 1918): 10/8, 172.16/12, 192.168/16. */
export const isPrivateIpv4 = (value: string) => {
  const octets = ipv4Octets(value);
  if (!octets) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const parseUrl = (input: string) => {
  try {
    return new URL(input.trim());
  } catch {
    return null;
  }
};

/**
 * True for every link meant for this app (elise://… and https://eliseos.paulbreton.dev/…),
 * whose path is not a screen of the app: the router must not try to open it.
 */
export const isAppLink = (input: string) => {
  const url = parseUrl(input);
  if (!url) return false;
  return (
    url.protocol === 'elise:' || (url.protocol === 'https:' && url.hostname === SETUP_LINK_HOST)
  );
};

/**
 * Reads the link of the TV's QR code: https://eliseos.paulbreton.dev/setup/?box=…&ip=…&lang=…
 * (or elise://setup?…). Invalid values are dropped one by one; null when the link is not a
 * setup link or names neither a box nor a private address.
 */
export const parseSetupLink = (input: string): SetupLink | null => {
  const url = parseUrl(input);
  if (!url) return null;
  const isUniversal =
    url.protocol === 'https:' &&
    url.hostname === SETUP_LINK_HOST &&
    !url.port &&
    !url.username &&
    !url.password &&
    (url.pathname === '/setup' || url.pathname === '/setup/');
  // elise://setup?… and elise://setup/?… (the host of a custom scheme is "setup").
  const isCustom =
    url.protocol === 'elise:' &&
    url.hostname === 'setup' &&
    (url.pathname === '' || url.pathname === '/');
  if (!isUniversal && !isCustom) return null;

  const box = url.searchParams.get('box')?.trim() ?? '';
  const ip = url.searchParams.get('ip')?.trim() ?? '';
  const lang = url.searchParams.get('lang')?.trim().toLowerCase() ?? '';
  const link: SetupLink = {
    box: BOX_ID.test(box) ? box : null,
    ip: isPrivateIpv4(ip) ? ip : null,
    lang: isLanguage(lang) ? lang : null,
  };
  return link.box || link.ip ? link : null;
};

export type SetupLinkTarget =
  /** The box is already saved in the app: open it the usual way, nothing is overwritten. */
  | { kind: 'saved'; server: SavedServer }
  /** A new box answered, mDNS or its address: open its preparation (or setup, or sign-in). */
  | { kind: 'found'; server: DiscoveredServer }
  /** Another box answers at that address: do not open it. */
  | { kind: 'mismatch'; server: DiscoveredServer }
  /** Nothing answered (yet): the discovery screen keeps scanning. */
  | { kind: 'unreachable' };

/**
 * Finds the box named by a setup link: among the saved boxes, then those discovered on the
 * local network, then at the address the TV gave (tried a few times while mDNS scans).
 */
export async function resolveSetupLinkTarget({
  link,
  saved,
  discovered,
  probe,
  attempts = 3,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryDelayMs = 2500,
  cancelled = () => false,
}: {
  link: SetupLink;
  saved: readonly SavedServer[];
  /** Boxes found so far; read again before every try, the scan goes on meanwhile. */
  discovered: () => readonly DiscoveredServer[];
  /** Asks http://<ip>/api/v1/discovery; rejects when nothing Élise answers. */
  probe: (ip: string) => Promise<DiscoveredServer>;
  attempts?: number;
  wait?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  cancelled?: () => boolean;
}): Promise<SetupLinkTarget> {
  const savedBox = (id: string) => saved.find((server) => server.instanceId === id);
  const known = link.box ? savedBox(link.box) : undefined;
  if (known) return { kind: 'saved', server: known };

  const discoveredBox = () =>
    link.box ? discovered().find((server) => server.instanceId === link.box) : undefined;

  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    if (attempt > 0) await wait(retryDelayMs);
    if (cancelled()) return { kind: 'unreachable' };
    const found = discoveredBox();
    if (found) return { kind: 'found', server: found };
    if (!link.ip) continue;
    const answered = await probe(link.ip).catch(() => null);
    if (cancelled()) return { kind: 'unreachable' };
    if (!answered) continue;
    if (link.box && answered.instanceId !== link.box) return { kind: 'mismatch', server: answered };
    const savedAnswer = savedBox(answered.instanceId);
    return savedAnswer
      ? { kind: 'saved', server: savedAnswer }
      : { kind: 'found', server: answered };
  }
  return { kind: 'unreachable' };
}
