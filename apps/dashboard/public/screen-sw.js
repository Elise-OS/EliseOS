/* Cache only the resident shell and immutable build assets, never family API data. */
// v2 drops v1 caches, which could hold an HTML page saved under an /assets/ address.
const SHELL = 'elise-screen-shell-v2';
self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add('/resident-screen'))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== SHELL).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/resident-screen') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put('/resident-screen', copy));
          }
          return response;
        })
        .catch(() => caches.match('/resident-screen')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/'))
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            // An HTML page under /assets/ is a missing file answered by the app shell: never keep it.
            const html = (response.headers.get('content-type') || '').includes('text/html');
            if (response.ok && !html) {
              const copy = response.clone();
              void caches.open(SHELL).then((cache) => cache.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
});
