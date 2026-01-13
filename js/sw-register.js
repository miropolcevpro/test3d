// Service Worker registration (generated 20260113145858)
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Project Pages base path: "/<repo>/"
  const parts = location.pathname.split('/').filter(Boolean);
  const base = parts.length ? `/${parts[0]}/` : '/';

  const SW_BUILD = "20260113145858";
  const swUrl = base + 'sw.js?v=' + SW_BUILD;

  navigator.serviceWorker.register(swUrl).catch((err) => {
    console.warn('[SW] register failed', err);
  });

  // Ask for persistent storage to reduce cache eviction on Android
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (e) {}
})();
