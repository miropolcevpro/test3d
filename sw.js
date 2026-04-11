/* Service Worker (stable mode)
   Goals:
   - Never break CORS / texture loading.
   - No caching of cross-origin assets (Yandex Object Storage).
   - Clean, predictable activation flow.
   - Allow instant upgrade (skipWaiting + clients.claim).
   - Report the active SW version back to the page.
*/

try {
  importScripts('./js/runtime-config.js');
  importScripts('./js/sw-meta.js');
} catch (e) {
  // Keep the worker alive even if metadata fails to load.
}

var SW_META = (typeof self !== 'undefined' && self.__SW_META__) ? self.__SW_META__ : {};
var SW_VERSION = String(SW_META.version || 'dev');
var SW_MESSAGES = SW_META.messages || {};
var SW_MSG_SKIP_WAITING = SW_MESSAGES.skipWaiting || 'SKIP_WAITING';
var SW_MSG_GET_VERSION = SW_MESSAGES.getVersion || 'GET_VERSION';
var SW_MSG_ACTIVATED = SW_MESSAGES.activated || 'SW_ACTIVATED';
var SW_MSG_VERSION = SW_MESSAGES.version || 'SW_VERSION';

async function broadcastToWindows(message) {
  var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (var i = 0; i < clients.length; i += 1) {
    try {
      clients[i].postMessage(message);
    } catch (e) {}
  }
}

self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
  event.waitUntil((async function() {
    await self.clients.claim();
    await broadcastToWindows({ type: SW_MSG_ACTIVATED, version: SW_VERSION });
  })());
});

self.addEventListener('message', function(event) {
  var data = event && event.data ? event.data : null;
  if (!data) return;

  if (data.type === SW_MSG_SKIP_WAITING) {
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(self.skipWaiting());
      return;
    }
    self.skipWaiting();
    return;
  }

  if (data.type === SW_MSG_GET_VERSION) {
    var port = event.ports && event.ports[0];
    if (port) {
      try {
        port.postMessage({ type: SW_MSG_VERSION, version: SW_VERSION });
      } catch (e) {}
    }
  }
});

// We intentionally DO NOT implement any fetch caching here.
// If you need caching, implement it at the application layer, not SW,
// because mixed CORS/no-cors requests can produce opaque responses
// and break Three.js TextureLoader in production.
