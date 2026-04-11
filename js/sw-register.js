// Service Worker register (stable update flow)
//
// Principles:
// - No network-response caching in SW itself.
// - One shared version source via js/sw-meta.js.
// - Skip waiting on updates, but avoid a forced reload on the very first install.
// - Reload only when a genuinely newer SW version takes control.

(function() {
  if (!('serviceWorker' in navigator)) return;

  var siteEnv = (typeof window !== 'undefined' && window.__SITE_ENV__) ? window.__SITE_ENV__ : null;
  var swMeta = (typeof window !== 'undefined' && window.__SW_META__) ? window.__SW_META__ : {};
  var swMessages = swMeta.messages || {};

  var SW_VERSION = String(swMeta.version || 'dev');
  var SW_FILENAME = String(swMeta.scriptFilename || 'sw.js');
  var SW_MSG_SKIP_WAITING = swMessages.skipWaiting || 'SKIP_WAITING';
  var SW_MSG_GET_VERSION = swMessages.getVersion || 'GET_VERSION';
  var SW_MSG_ACTIVATED = swMessages.activated || 'SW_ACTIVATED';
  var SW_SCOPE = (siteEnv && siteEnv.siteBasePath) ? siteEnv.siteBasePath : (function() {
    try {
      return new URL('./', window.location.href).pathname || '/';
    } catch (e) {
      return '/';
    }
  })();
  var SW_URL = (function() {
    try {
      if (siteEnv && typeof siteEnv.resolveSiteUrl === 'function') {
        return siteEnv.resolveSiteUrl(SW_FILENAME + '?v=' + encodeURIComponent(SW_VERSION));
      }
      var base = (siteEnv && siteEnv.siteBaseUrl) ? siteEnv.siteBaseUrl : window.location.href;
      return new URL(SW_FILENAME + '?v=' + encodeURIComponent(SW_VERSION), base).toString();
    } catch (e) {
      return SW_FILENAME + '?v=' + encodeURIComponent(SW_VERSION);
    }
  })();

  var STORAGE_KEY = 'sw:last-ack-version:' + SW_SCOPE;
  var isReloading = false;
  var suppressNextActivationReload = !navigator.serviceWorker.controller;

  function getAckVersion() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setAckVersion(version) {
    if (!version) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(version));
    } catch (e) {}
  }

  function requestSkipWaiting(reg) {
    try {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: SW_MSG_SKIP_WAITING });
      }
    } catch (e) {}
  }

  function reloadForVersion(version) {
    if (isReloading) return;
    isReloading = true;
    if (version) setAckVersion(version);
    window.location.reload();
  }

  function extractVersionFromScriptUrl(scriptURL) {
    try {
      if (!scriptURL) return '';
      var url = new URL(String(scriptURL), window.location.href);
      return url.searchParams.get('v') || '';
    } catch (e) {
      return '';
    }
  }

  function queryControllerVersion(controller) {
    return new Promise(function(resolve) {
      if (!controller) {
        resolve('');
        return;
      }

      var fallbackVersion = extractVersionFromScriptUrl(controller.scriptURL);
      if (typeof MessageChannel === 'undefined') {
        resolve(fallbackVersion);
        return;
      }

      var settled = false;
      var channel = new MessageChannel();
      var timer = window.setTimeout(function() {
        if (settled) return;
        settled = true;
        resolve(fallbackVersion);
      }, 1200);

      channel.port1.onmessage = function(event) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        var data = event && event.data ? event.data : null;
        resolve(data && data.version ? String(data.version) : fallbackVersion);
      };

      try {
        controller.postMessage({ type: SW_MSG_GET_VERSION }, [channel.port2]);
      } catch (e) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallbackVersion);
      }
    });
  }

  function readCurrentControllerVersion(options) {
    var controller = navigator.serviceWorker.controller;
    var persist = !options || options.persist !== false;
    if (!controller) return Promise.resolve('');
    return queryControllerVersion(controller).then(function(version) {
      if (persist && version) setAckVersion(version);
      return version;
    }).catch(function() {
      return '';
    });
  }

  function handleActivatedVersion(version) {
    var nextVersion = version ? String(version) : '';
    if (!nextVersion) return;

    if (suppressNextActivationReload) {
      setAckVersion(nextVersion);
      suppressNextActivationReload = false;
      return;
    }

    if (getAckVersion() === nextVersion) return;
    reloadForVersion(nextVersion);
  }

  navigator.serviceWorker.register(SW_URL, {
    scope: SW_SCOPE,
    updateViaCache: 'none'
  })
    .then(function(reg) {
      readCurrentControllerVersion({ persist: true }).catch(function() {});

      try { reg.update(); } catch (e) {}
      requestSkipWaiting(reg);

      reg.addEventListener('updatefound', function() {
        var installing = reg.installing;
        if (!installing) return;

        installing.addEventListener('statechange', function() {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            requestSkipWaiting(reg);
          }
        });
      });
    })
    .catch(function(err) {
      console.warn('[SW] register failed', err);
    });

  navigator.serviceWorker.addEventListener('message', function(event) {
    var data = event && event.data ? event.data : null;
    if (!data) return;

    if (data.type === SW_MSG_ACTIVATED) {
      handleActivatedVersion(data.version);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', function() {
    window.setTimeout(function() {
      readCurrentControllerVersion({ persist: false }).then(function(version) {
        if (!version) return;
        if (suppressNextActivationReload) {
          setAckVersion(version);
          suppressNextActivationReload = false;
          return;
        }
        if (getAckVersion() !== version) {
          reloadForVersion(version);
        }
      }).catch(function() {});
    }, 150);
  });
})();
