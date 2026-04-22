(function(global){
  'use strict';
  function trimTrailingSlashes(value){ return String(value || '').replace(/\/+$/, ''); }
  function resolveLeadSubmitEndpoint(){
    try {
      var runtime = global.__RUNTIME_CONFIG__ || null;
      if (runtime && typeof runtime.resolvePublicApiBaseUrl === 'function') {
        var base = trimTrailingSlashes(runtime.resolvePublicApiBaseUrl() || '');
        if (base) return base + '/api/telemetry?mode=lead_submit';
      }
    } catch (_) {}
    try {
      var direct = trimTrailingSlashes(global.__API_BASE_URL__ || '');
      if (direct) return direct + '/api/telemetry?mode=lead_submit';
    } catch (_) {}
    return '';
  }
  global.__AG_CALCULATOR_CONFIG__ = Object.freeze({
    version: '20260422-f24dy',
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
