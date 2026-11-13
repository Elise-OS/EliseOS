/** Warm DNS/TLS and cache Jitsi's iframe API before an incoming call is accepted. */
export async function preloadMobileJitsi(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const url = new URL('/external_api.js', baseUrl);
  if (url.protocol !== 'https:') return false;
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/javascript' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
