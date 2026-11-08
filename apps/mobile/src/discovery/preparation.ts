import { parseDiscoveryInfo } from './helpers';
import type { DiscoveryInfo, PreparationStatus } from './types';

/** Reads the preparation page, then hands over once the real Élise API answers. */
export async function fetchPreparation(
  url: string,
  timeoutMs = 5000,
): Promise<{ ready: DiscoveryInfo } | { preparation: PreparationStatus | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/v1/discovery`, { signal: controller.signal });
    // The dashboard replaces the preparation page on the same port: a gap is expected.
    if (!response.ok) return { preparation: null };
    const info = parseDiscoveryInfo(await response.json());
    return info.preparing ? { preparation: info.preparation ?? null } : { ready: info };
  } catch {
    return { preparation: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells the preparing box which language the app shows, so its TV and preparation page follow.
 * Resolves true once the box answered, even with a refusal or an older box's 404: there is
 * nothing to retry. False when it could not be reached: the caller tries again later.
 */
export async function sendPreparationLanguage(
  url: string,
  language: string,
  timeoutMs = 4000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${url}/language`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language, source: 'app' }),
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
