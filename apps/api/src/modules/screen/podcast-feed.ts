import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { ScreenPodcastEpisode } from '@michel/contracts';

// Popular shows often publish large RSS archives, including over 10 MiB after
// decompression. Keep a firm memory/network bound while allowing those feeds.
const MAX_FEED_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const publicHostChecks = new Map<string, { expiresAt: number; value: Promise<void> }>();

function publicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 198 && b >= 18 && b <= 19)
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return publicIp(normalized.slice(7));
  // Public IPv6 unicast addresses are in 2000::/3.
  return normalized[0] === '2' || normalized[0] === '3';
}

async function assertPublicHttpsUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Flux de podcast HTTPS invalide.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
    throw new Error('Hôte de podcast non autorisé.');
  if (isIP(hostname)) {
    if (!publicIp(hostname)) throw new Error('Hôte de podcast non autorisé.');
    return;
  }
  let check = publicHostChecks.get(hostname)?.value;
  if (!check || (publicHostChecks.get(hostname)?.expiresAt ?? 0) <= Date.now()) {
    check = lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !publicIp(address)))
        throw new Error('Hôte de podcast non autorisé.');
    });
    publicHostChecks.set(hostname, { expiresAt: Date.now() + 120_000, value: check });
    if (publicHostChecks.size > 256) {
      const oldestHostname = publicHostChecks.keys().next().value;
      if (oldestHostname) publicHostChecks.delete(oldestHostname);
    }
  }
  try {
    await check;
  } catch (error) {
    if (publicHostChecks.get(hostname)?.value === check) publicHostChecks.delete(hostname);
    throw error;
  }
}

async function readFeed(url: URL): Promise<string> {
  let current = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertPublicHttpsUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        'user-agent': 'MichelOS/0.1 (+https://elise.local)',
      },
      signal: AbortSignal.timeout(9000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS)
        throw new Error('Redirection RSS invalide.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Flux RSS HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_FEED_BYTES) throw new Error('Flux RSS trop volumineux.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error('Flux RSS trop volumineux.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Trop de redirections RSS.');
}

function childElements(parent: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1) result.push(child as XmlElement);
  }
  return result;
}

function elementName(element: XmlElement): string {
  return (element.localName || element.nodeName.split(':').at(-1) || '').toLowerCase();
}

function firstChild(parent: XmlElement, name: string): XmlElement | undefined {
  return childElements(parent).find((child) => elementName(child) === name.toLowerCase());
}

function childText(parent: XmlElement, name: string): string {
  return firstChild(parent, name)?.textContent?.trim() ?? '';
}

function plainText(value: string, maxLength: number): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function durationSeconds(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return Math.min(Number(normalized), 86400);
  if (!/^\d{1,3}:\d{1,2}:\d{1,2}$|^\d{1,3}:\d{1,2}$/.test(normalized)) return null;
  const parts = normalized.split(':').map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) ? Math.min(seconds, 86400) : null;
}

function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href.slice(0, 2048)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchPodcastEpisodes(
  feedUrl: string,
  fallbackArtworkUrl?: string,
): Promise<ScreenPodcastEpisode[]> {
  const safeFeedUrl = httpsUrl(feedUrl);
  if (!safeFeedUrl) throw new Error('Adresse du podcast invalide.');
  const xml = await readFeed(new URL(safeFeedUrl));
  if (/<!DOCTYPE/i.test(xml)) throw new Error('Flux RSS non pris en charge.');
  const parserErrors: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') parserErrors.push(message);
    },
  }).parseFromString(xml, 'application/xml');
  if (parserErrors.length) throw new Error('Flux RSS illisible.');
  const root = document.documentElement;
  if (!root) throw new Error('Flux RSS illisible.');
  const channel = childElements(root).find((element) => elementName(element) === 'channel');
  if (!channel) throw new Error('Ce flux ne contient pas de podcast.');

  const items = childElements(channel).filter((element) => elementName(element) === 'item');
  const episodes: ScreenPodcastEpisode[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const enclosure = firstChild(item, 'enclosure');
    const enclosureUrl = httpsUrl(enclosure?.getAttribute('url') ?? '');
    const contentType = enclosure?.getAttribute('type')?.toLowerCase().trim() ?? '';
    if (!enclosureUrl || (contentType && !contentType.startsWith('audio/'))) continue;
    try {
      await assertPublicHttpsUrl(new URL(enclosureUrl));
    } catch {
      continue;
    }
    const guid = plainText(childText(item, 'guid'), 500);
    const id = guid || createHash('sha256').update(enclosureUrl).digest('hex');
    if (seen.has(id)) continue;
    const title = plainText(childText(item, 'title'), 120);
    if (!title) continue;
    const image = firstChild(item, 'image')?.getAttribute('href') ?? '';
    const publishedAtValue = Date.parse(childText(item, 'pubDate'));
    const artworkUrl = httpsUrl(image) ?? fallbackArtworkUrl;
    episodes.push({
      id,
      title,
      description: plainText(childText(item, 'description'), 800),
      enclosureUrl,
      publishedAt:
        Number.isFinite(publishedAtValue) && publishedAtValue > 0 ? publishedAtValue : null,
      durationSeconds: durationSeconds(childText(item, 'duration')),
      ...(artworkUrl ? { artworkUrl } : {}),
    });
    seen.add(id);
    if (episodes.length >= 50) break;
  }
  return episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}
