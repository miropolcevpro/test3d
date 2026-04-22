(function(global){
  'use strict';
  function trimTrailingSlashes(value){ return String(value || '').replace(/\/+$/, ''); }
  function appendLeadSubmitMode(url){
    var raw = trimTrailingSlashes(url || '');
    if (!raw) return '';
    return raw + (raw.indexOf('?') >= 0 ? '&mode=lead_submit' : '?mode=lead_submit');
  }
  function resolveLeadSubmitEndpoint(){
    try {
      var runtime = global.__RUNTIME_CONFIG__ || null;
      if (runtime && typeof runtime.resolveTelemetryEndpoint === 'function') {
        var telemetry = trimTrailingSlashes(runtime.resolveTelemetryEndpoint() || '');
        if (telemetry) return appendLeadSubmitMode(telemetry);
      }
    } catch (_) {}
    try {
      var runtime2 = global.__RUNTIME_CONFIG__ || null;
      if (runtime2 && typeof runtime2.resolvePublicApiBaseUrl === 'function') {
        var base = trimTrailingSlashes(runtime2.resolvePublicApiBaseUrl() || '');
        if (base) return base + '/api/telemetry?mode=lead_submit';
      }
    } catch (_) {}
    try {
      var runtime3 = global.__RUNTIME_CONFIG__ || null;
      if (runtime3 && typeof runtime3.resolveAdminApiBaseUrl === 'function') {
        var adminBase = trimTrailingSlashes(runtime3.resolveAdminApiBaseUrl() || '');
        if (adminBase) return adminBase + '/api/telemetry?mode=lead_submit';
      }
    } catch (_) {}
    try {
      var direct = trimTrailingSlashes(global.__API_BASE_URL__ || global.API_BASE_URL || '');
      if (direct) return direct + '/api/telemetry?mode=lead_submit';
    } catch (_) {}
    return '';
  }
  global.__AG_CALCULATOR_CONFIG__ = Object.freeze({
    version: '20260422-f24dz',
    submitMode: 'standalone',
    submitEndpoint: resolveLeadSubmitEndpoint(),
    telegramShareBaseUrl: '',
    telegramUsername: '',
    managerPhone: '+79780224411',
    draftStorageKey: 'ag_calculator_last_draft_v1',
    privacyPolicyUrl: 'https://ag-ru.com/',
    successMessage: 'Заявка отправлена. Мы свяжемся с вами в ближайшее время.'
  });
})(window);
