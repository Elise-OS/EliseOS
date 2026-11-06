import { isLocale, t } from '../i18n';
import { uiLocale } from '../screen-locale';
import { DEMO_CALL_EVENT } from './DemoCall';
import { handleDemoRequest } from './router';

// Imported right after the frozen clock: the page never reaches a real Élise API.

const API_PREFIX = '/api/v1';
const realFetch = window.fetch.bind(window);
const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const openStream = () =>
  new Response(new ReadableStream<Uint8Array>({ start() {} }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, window.location.origin);
  // Demo radios and podcasts point to a reserved domain: answer at once instead of trying the network.
  if (url.hostname.endsWith('.invalid')) return new Response(null, { status: 404 });
  if (url.origin !== window.location.origin) return realFetch(input, init);
  // The resident screen checks for a newer kiosk shell; the demo shell never changes.
  if (url.pathname === '/resident-screen') return new Response(null, { status: 204 });
  if (!url.pathname.startsWith(`${API_PREFIX}/`)) return realFetch(input, init);

  const path = `${url.pathname.slice(API_PREFIX.length)}${url.search}`;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (path.split('?')[0]?.endsWith('/events')) return openStream();

  // A short pause keeps loading states and transitions as they are on a real installation.
  await pause(method === 'GET' ? 90 : 180);
  const answer = handleDemoRequest(
    method,
    path,
    typeof init?.body === 'string' ? init.body : undefined,
  );
  // Calling the resident opens the pretend call instead of a video room.
  if (method === 'POST' && path === '/screen/calls' && answer.status < 300)
    window.dispatchEvent(new Event(DEMO_CALL_EVENT));
  if (answer.status === 404 && import.meta.env.DEV)
    console.warn(`[démo] ${method} ${path} sans réponse`);
  return new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? null), {
    status: answer.status,
    headers: { 'content-type': 'application/json' },
  });
};

/** Live updates are not needed: the demo home only changes when the visitor acts. */
class DemoEventSource extends EventTarget {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSED = 2;
  public readonly CONNECTING = 0;
  public readonly OPEN = 1;
  public readonly CLOSED = 2;
  public readonly url: string;
  public readonly withCredentials = false;
  public readyState = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;

  public constructor(url: string | URL) {
    super();
    this.url = String(url);
    window.setTimeout(() => this.onopen?.(new Event('open')), 0);
  }

  public close() {
    this.readyState = 2;
  }
}
window.EventSource = DemoEventSource as unknown as typeof EventSource;

// The resident screen registers a kiosk service worker; the demo must not install one on the site.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register = () =>
    Promise.reject(new Error('Service worker disabled in the demo'));
}

const lang = new URLSearchParams(window.location.search).get('lang');
try {
  if (isLocale(lang)) window.localStorage.setItem('elise_locale', lang);
  // The demo home is built in one language: a language picked in the settings reloads it in that one.
  // Patched on the prototype: assigning to localStorage itself would store a key instead.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    const previous = this.getItem(key);
    setItem.call(this, key, value);
    if (this === window.localStorage && key === 'elise_locale' && value !== previous) {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', value);
      window.location.replace(url);
    }
  };
  // Visitors discover the app through its navigation, so the sidebar starts open in the demo.
  if (window.localStorage.getItem('elise_sidebar_auto_hide') === null)
    window.localStorage.setItem('elise_sidebar_auto_hide', 'false');
} catch {
  // Private browsing: the dashboard keeps its defaults.
}
// The demo page is written in French: name it in the visitor's language.
document.documentElement.lang = uiLocale();
document.title = t('install.documentTitle');
document
  .querySelector('meta[name="description"]')
  ?.setAttribute('content', t('install.documentDescription'));
