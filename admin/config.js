// Admin config
// Priority:
//  1) query param ?api=https://...   (stored to localStorage)
//  2) localStorage key: admin_api_base_url
//  3) existing window.API_BASE_URL (if set before this script)
//  4) fallback default (current API Gateway)
(() => {
  const LS_KEY = 'admin_api_base_url';
  const DEFAULT_API = 'https://d5d1712p9mu7k3aurh9s.laqt4bj7.apigw.yandexcloud.net';

  try {
    const u = new URL(window.location.href);
    const qp = (u.searchParams.get('api') || '').trim();
    if (qp) {
      const normalized = qp.replace(/\/+$/, '');
      localStorage.setItem(LS_KEY, normalized);
      window.API_BASE_URL = normalized;
      return;
    }
  } catch {}

  try {
    const saved = (localStorage.getItem(LS_KEY) || '').trim();
    if (saved) {
      window.API_BASE_URL = saved.replace(/\/+$/, '');
      return;
    }
  } catch {}

  if (window.API_BASE_URL) {
    window.API_BASE_URL = String(window.API_BASE_URL).replace(/\/+$/, '');
    return;
  }

  window.API_BASE_URL = DEFAULT_API;
})();
