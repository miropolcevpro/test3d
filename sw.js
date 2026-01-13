/* WebAR Service Worker (STABLE MODE)
 * Build: 20260113203000
 *
 * Goal: eliminate "opaque/no-cors" and "waitUntil InvalidState" issues while keeping modest speedups.
 *
 * Key rules:
 *  - NEVER cache or intercept Object Storage (storage.yandexcloud.net/webar3dtexture/...).
 *    Textures are cached at app level, not SW level.
 *  - Do not cache SW scripts or sw-register.
 *  - Use network-first for HTML to avoid "stuck on old SW" on GitHub Pages.
 */

const VERSION = '20260113203000';
const STATIC_CACHE = `webar-static-${VERSION}`;
const MAX_STATIC = 80;

const BUCKET_HOST = 'storage.yandexcloud.net';
const BUCKET_ROOT = '/webar3dtexture/';

function isBucket(url) {
  return url.hostname === BUCKET_HOST && url.pathname.startsWith(BUCKET_ROOT);
}

function isApiGateway(url) {
  return url.hostname.endsWith('.apigw.yandexcloud.net');
}

function isHtml(url) {
  return url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');
}

function isBypass(url) {
  // Never cache SW internals
  const p = url.pathname;
  if (p.endsWith('/sw.js') || p.endsWith('/js/sw-register.js')) return true;
  if (p.endsWith('sw.js') || p.endsWith('sw-register.js')) return true;
  return false;
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const extra = keys.length - maxEntries;
  if (extra <= 0) return;
  // Simple FIFO trimming (good enough for static assets)
  for (let i = 0; i < extra; i++) {
    await cache.delete(keys[i]);
  }
}

async function networkFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await cache.put(request, res.clone());
      event.waitUntil(trimCache(cacheName, MAX_STATIC));
    }
    return res;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const fetchPromise = fetch(request)
    .then(res => {
      if (res && res.ok) {
        // Do not cache opaque responses; they can break later CORS fetches.
        cache.put(request, res.clone()).catch(() => {});
        event.waitUntil(trimCache(cacheName, MAX_STATIC));
      }
      return res;
    })
    .catch(() => null);

  // If cached exists, serve it immediately; revalidate in background.
  if (cached) {
    event.waitUntil(fetchPromise);
    return cached;
  }
  // else return network
  const res = await fetchPromise;
  if (res) return res;
  // last resort: try cache again
  const cached2 = await cache.match(request, { ignoreSearch: false });
  if (cached2) return cached2;
  return Response.error();
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Best-effort shell
    try {
      await cache.addAll([
        './',
        './index.html',
        './css/style.css',
      ]);
    } catch (e) {}
    await trimCache(STATIC_CACHE, MAX_STATIC);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const keep = new Set([STATIC_CACHE]);
    await Promise.all(names.map(n => (keep.has(n) ? Promise.resolve() : caches.delete(n))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch API Gateway
  if (isApiGateway(url)) return;

  // Never touch Object Storage bucket (prevents opaque/CORS regressions)
  if (isBucket(url)) return;

  // Bypass SW internals
  if (isBypass(url)) return;

  // HTML: network-first to avoid stuck old versions
  if (url.origin === self.location.origin && isHtml(url)) {
    event.respondWith(networkFirst(event, request, STATIC_CACHE));
    return;
  }

  // Static assets: stale-while-revalidate (same-origin only)
  if (url.origin === self.location.origin) {
    const p = url.pathname.toLowerCase();
    if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.png') || p.endsWith('.webp') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.ico') || p.endsWith('.json') || p.endsWith('.woff2')) {
      event.respondWith(staleWhileRevalidate(event, request, STATIC_CACHE));
      return;
    }
  }
  // default passthrough
});
