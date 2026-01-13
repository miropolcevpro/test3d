// Service Worker control & recovery (stable)
// Build: 20260113203000
(function () {
  if (!('serviceWorker' in navigator)) return;

  const BUILD = '20260113203000';

  // GitHub Pages repo base: "/<repo>/"
  const parts = location.pathname.split('/').filter(Boolean);
  const base = parts.length ? `/${parts[0]}/` : '/';
  const swUrl = base + 'sw.js?v=' + BUILD;

  // Hard recovery: unregister any existing SW + clear CacheStorage.
  // Triggered when:
  //  - URL has ?swreset=1
  //  - controlling SW scriptURL is not current build
  //  - we detect a previous recovery did not complete
  async function hardReset(reason) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => {})));
    } catch (e) {}
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
    } catch (e) {}

    // Avoid infinite reload loops
    try {
      sessionStorage.setItem('sw_reset_done_' + BUILD, '1');
    } catch (e) {}

    // Reload with cache-buster so old SW cache can't serve stale HTML/JS.
    const u = new URL(location.href);
    u.searchParams.delete('swreset');
    u.searchParams.set('cb', String(Date.now()));
    location.replace(u.toString());
  }

  async function main() {
    const u = new URL(location.href);
    const forceReset = u.searchParams.get('swreset') === '1';
    const resetDone = (function () {
      try { return sessionStorage.getItem('sw_reset_done_' + BUILD) === '1'; } catch (e) { return false; }
    })();

    // If we are controlled by an older SW build, reset.
    const ctrl = navigator.serviceWorker.controller;
    const ctrlUrl = ctrl && ctrl.scriptURL ? String(ctrl.scriptURL) : '';
    const ctrlIsOld = ctrlUrl && !ctrlUrl.includes('v=' + BUILD);

    if ((forceReset || ctrlIsOld) && !resetDone) {
      await hardReset(forceReset ? 'query' : 'old-controller');
      return;
    }

    // Register SW.
    // SW is kept minimal and NEVER caches Object Storage (bucket) to avoid opaque/CORS issues.
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('[SW] register failed', err);
    });

    // Ask for persistent storage to reduce eviction on Android.
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
    } catch (e) {}
  }

  main().catch(() => {});
})();
