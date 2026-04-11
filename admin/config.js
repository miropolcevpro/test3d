// Admin config
// Priority:
//  1) query param ?api=https://...
//  2) localStorage key: admin_api_base_url
//  3) existing window.API_BASE_URL / window.__API_BASE_URL__
//  4) runtime default API Gateway
(() => {
  const runtime = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
  const resolved = runtime && typeof runtime.resolveAdminApiBaseUrl === 'function'
    ? runtime.resolveAdminApiBaseUrl()
    : ((window.API_BASE_URL || window.__API_BASE_URL__ || '').replace(/\/+$/, ''));

  window.API_BASE_URL = resolved ? String(resolved).replace(/\/+$/, '') : '';
})();
