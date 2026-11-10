// Home network ranges only: Tailscale (100.64/10) and public addresses are left out.
const PRIVATE_IPV4 = /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;

const originOf = (value?: string | null) => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
};

/**
 * Web addresses of the Élise dashboard on the home network, to show after the
 * mobile setup: the ".local" name first, then the local IP the phone reached.
 */
export function homeWebAddresses(server: {
  localUrl?: string | null;
  url: string;
  urls?: string[];
}): { name: string | null; ip: string | null } {
  const name = originOf(server.localUrl);
  const ip =
    [server.url, ...(server.urls ?? [])]
      .map(originOf)
      .find((origin) => origin !== null && PRIVATE_IPV4.test(new URL(origin).hostname)) ?? null;
  return { name, ip };
}
