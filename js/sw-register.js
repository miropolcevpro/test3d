// Service Worker register (robust update) - v20260113191733
//
// This SW is intentionally "stable mode" (no caching) to avoid opaque/CORS issues.
// We also force-update and activate immediately so old buggy SW versions are replaced.

(function() {
  if (!('serviceWorker' in navigator)) return;

  var SW_URL = (function() {
    // Respect GitHub Pages base path (usually /test3d/)
    var base = (location.pathname.startsWith('/test3d/') ? '/test3d' : '');
    return base + '/sw.js?v=20260113191733';
  })();

  function forceReloadOnce() {
    try {
      var key = 'sw_reload_done_20260113191733';
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      location.reload();
    } catch (e) {
      location.reload();
    }
  }

  function requestSkipWaiting(reg) {
    try {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (e) {}
  }

  navigator.serviceWorker.register(SW_URL, { scope: (location.pathname.startsWith('/test3d/') ? '/test3d/' : '/') })
    .then(function(reg) {
      // Trigger update check ASAP
      try { reg.update(); } catch (e) {}

      // If there's a waiting worker, activate it immediately
      requestSkipWaiting(reg);

      // When a new worker is found, ask it to skip waiting
      reg.addEventListener('updatefound', function() {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function() {
          if (w.state === 'installed') {
            // If there's an existing controller, we need to claim and reload once
            requestSkipWaiting(reg);
          }
        });
      });
    })
    .catch(function(err) {
      // Don't block app on SW errors
      console.warn('[SW] register failed', err);
    });

  // When controller changes, reload once to ensure the page is controlled by the newest SW
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    forceReloadOnce();
  });
})();
