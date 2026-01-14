/* Service Worker (stable mode) - v20260113191733
   Goals:
   - Never break CORS / texture loading.
   - No caching of cross-origin assets (Yandex Object Storage).
   - No waitUntil misuse.
   - Allow instant upgrade (skipWaiting + clients.claim).
*/
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Optional: support skipWaiting message from the page (robust updates)
self.addEventListener('message', (event) => {
  if (event?.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// We intentionally DO NOT implement any fetch caching here.
// If you need caching, implement it at the application layer, not SW,
// because mixed CORS/no-cors requests can produce opaque responses
// and break Three.js TextureLoader in production.
