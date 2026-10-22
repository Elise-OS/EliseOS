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
