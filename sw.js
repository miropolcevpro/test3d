/* WebAR Service Worker (runtime cache)
 * Version: 20260113145858
 * Caches palettes/palette_settings and hot texture maps (albedo/roughness/normal best-effort).
 *
 * Notes:
 * - We intentionally do NOT cache API Gateway calls (admin backend).
 * - We keep cache sizes bounded with simple LRU stored in IndexedDB.
 */
const SW_VERSION = "20260113182035";
const STATIC_CACHE = `webar-static-${SW_VERSION}`;
const JSON_CACHE   = `webar-json-${SW_VERSION}`;
const TEX_CACHE    = `webar-tex-${SW_VERSION}`;

const MAX_STATIC = 60;
const MAX_JSON   = 40;
const MAX_TEX    = 120; // enough for ~3-5 textures * (albedo+roughness+normal) in 1k/2k variants

const BUCKET_HOST = "storage.yandexcloud.net";
const BUCKET_ROOT = "/webar3dtexture/";

const DB_NAME = "webar-sw";
const DB_STORE = "lru";

// ---------- IndexedDB helpers (tiny) ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAllKeys() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetMany(keys) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const out = new Map();
    let pending = keys.length;
    if (!pending) return resolve(out);
    keys.forEach(k => {
      const r = store.get(k);
      r.onsuccess = () => {
        out.set(k, r.result);
        pending--;
        if (pending === 0) resolve(out);
      };
      r.onerror = () => {
        pending--;
        if (pending === 0) resolve(out);
      };
    });
    tx.onerror = () => reject(tx.error);
  });
}

async function lruTouch(cacheName, url) {
  // store per-cache key
  const key = `${cacheName}|${url}`;
  await idbSet(key, Date.now());
}

async function lruTrim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  // Build list of LRU timestamps
  const urls = keys.map(r => r.url);
  const idbKeys = urls.map(u => `${cacheName}|${u}`);
  const tsMap = await idbGetMany(idbKeys);

  const scored = urls.map(u => {
    const t = tsMap.get(`${cacheName}|${u}`);
    return { url: u, t: typeof t === "number" ? t : 0 };
  });
  scored.sort((a,b) => a.t - b.t); // oldest first

  const toDelete = scored.slice(0, Math.max(0, scored.length - maxEntries));
  for (const item of toDelete) {
    await cache.delete(item.url);
    // keep idb record; it's fine. (optional cleanup)
  }
}

// ---------- URL matchers ----------
function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isBucket(url) {
  return url.hostname === BUCKET_HOST && url.pathname.startsWith(BUCKET_ROOT);
}

function isPaletteJson(url) {
  return isBucket(url) && (url.pathname.includes("/palettes/") || url.pathname.includes("/palette_settings/")) && url.pathname.endsWith(".json");
}

function isTextureMap(url) {
  if (!isBucket(url)) return false;
  if (!url.pathname.includes("/surfaces/")) return false;
  // cache hot maps
  const p = url.pathname.toLowerCase();
  return (
    p.includes("_albedo.") ||
    p.includes("_roughness.") ||
    p.includes("_normal.") ||
    p.includes("_ao.") ||      // optional, cached but trimmed by LRU
    p.includes("_height.")
  );
}

function isApiGateway(url) {
  // do not cache your API gateway (admin backend)
  return url.hostname.endsWith(".apigw.yandexcloud.net");
}

// ---------- caching strategies ----------
async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) {
    lruTouch(cacheName, request.url);
    // Background refresh (best-effort) WITHOUT event.waitUntil (avoids InvalidStateError)
    fetchAndCache(request, cacheName, maxEntries).catch(() => {});
    return cached;
  }
  return fetchAndCache(request, cacheName, maxEntries);
}

async function networkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await cache.put(request, res.clone());
      await lruTouch(cacheName, request.url);
      await lruTrim(cacheName, maxEntries);
    }
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) {
      await lruTouch(cacheName, request.url);
      return cached;
    }
    throw e;
  }
}

async function fetchAndCache(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const res = await fetch(request);
  // IMPORTANT: never cache opaque responses (no-cors). They break later CORS fetches.
  if (res && res.ok && res.type !== "opaque") {
    try {
      await cache.put(request, res.clone());
      await lruTouch(cacheName, request.url);
      await lruTrim(cacheName, maxEntries);
    } catch (e) {
      // ignore cache errors (quota, opaque, etc.)
    }
  }
  return res;
}

function eventWaitUntilSafe(_promise) {
  // no-op: do not call event.waitUntil from async code; it can throw InvalidStateError.
}

// ---------- SW lifecycle ----------
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // cache shell assets (best-effort)
    const urls = [
      "./",
      "./index.html",
      "./css/style.css",
      "./admin/",
    ];
    try { await cache.addAll(urls); } catch (e) {}
    await lruTrim(STATIC_CACHE, MAX_STATIC);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // cleanup old versions
    const names = await caches.keys();
    const keep = new Set([STATIC_CACHE, JSON_CACHE, TEX_CACHE]);
    await Promise.all(names.map(n => keep.has(n) ? Promise.resolve() : caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // never cache api gateway calls
  if (isApiGateway(url)) return;
  // palettes/settings: prefer fresh but fallback cache
  if (isPaletteJson(url)) {
    event.respondWith(networkFirst(request, JSON_CACHE, MAX_JSON));
    return;
  }

  // textures: cache-first (fast) with LRU
  if (isTextureMap(url)) {
    event.respondWith(cacheFirst(request, TEX_CACHE, MAX_TEX));
    return;
  }

  // same-origin static: cache-first for speed (stale-while-revalidate)
  if (isSameOrigin(url) && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".png") || url.pathname.endsWith(".webp") || url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg") || url.pathname.endsWith(".ico") || url.pathname.endsWith(".html"))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE, MAX_STATIC));
    return;
  }

  // default: passthrough
});
