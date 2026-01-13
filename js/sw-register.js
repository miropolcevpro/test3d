// Service Worker registration (generated 20260113203500)
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Project Pages base path: "/<repo>/"
  const parts = location.pathname.split('/').filter(Boolean);
  const base = parts.length ? `/${parts[0]}/` : '/';

  const SW_BUILD = "20260113203500";
  const swUrl = base + 'sw.js?v=' + SW_BUILD;

  // Self-heal: if an old/broken SW is controlling this page, unregister it and re-register.
  // This prevents "white textures" failures caused by outdated fetch handlers.
  const flagKey = '__sw_selfheal_done__' + SW_BUILD;

  const register = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      // If we are controlled by an old SW (different scriptURL), uninstall it once.
      const ctl = navigator.serviceWorker.controller;
      if (ctl && ctl.scriptURL && !ctl.scriptURL.includes('sw.js?v=' + SW_BUILD) && !sessionStorage.getItem(flagKey)) {
        sessionStorage.setItem(flagKey, '1');
        await Promise.all(regs.map(r => r.unregister().catch(() => {})));
        if (window.caches && caches.keys) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n).catch(() => {})));
        }
        location.reload();
        return;
      }

      const reg = await navigator.serviceWorker.register(swUrl, { scope: base });
      // Force an update check (helps GH Pages caching edge cases)
      try { await reg.update(); } catch (e) {}
    } catch (err) {
      console.warn('[SW] register failed', err);
    }
  };

  register();

  // Ask for persistent storage to reduce cache eviction on Android
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (e) {}
})();
