/* Cache only the resident shell and immutable build assets, never family API data. */
const SHELL = 'elise-screen-shell-v1';
self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add('/resident-screen'))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
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
            if (response.ok) {
              const copy = response.clone();
              void caches.open(SHELL).then((cache) => cache.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
});
