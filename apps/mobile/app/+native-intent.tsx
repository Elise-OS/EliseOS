import { isAppLink } from '../src/discovery/setupLink';

/**
 * The app has a single screen: links such as https://eliseos.paulbreton.dev/setup/?box=…
 * (the TV's QR code) or elise://connect?url=… are not routes. They open that screen, or leave
 * the running app where it is, and app/index.tsx reads them through Linking.useURL().
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (isAppLink(path)) return initial ? '/' : '';
  } catch {
    // An unreadable link is left to the router.
  }
  return path;
}
