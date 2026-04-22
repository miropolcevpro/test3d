(function(global, doc){
  'use strict';

  var CONFIG = global.__AG_CALCULATOR_CONFIG__ || {};
  var ORIGIN = (function(){ try { return global.location.origin; } catch (_) { return '*'; } })();
  var HEIGHT_MESSAGE = 'ag-calc-height';
  var READY_MESSAGE = 'ag-calc-ready';
  var SUBMIT_MESSAGE = 'ag-calc-submit-ready';
  var STATUS_ERROR = '#b91c1c';
  var STATUS_OK = '#166534';
  var statusTimer = 0;

  function $(selector, root){ return (root || doc).querySelector(selector); }
  function safeText(value){ return value == null ? '' : String(value); }
  function nowIso(){ try { return new Date().toISOString(); } catch (_) { return ''; } }
  function digits(value){ return safeText(value).replace(/\D/g, ''); }
  function cloneJson(value){ try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; } }
  function trimTrailingSlashes(value){ return safeText(value).replace(/\/+$/, ''); }
  function buildTransactionId(){ return String(Date.now()) + ':' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0'); }

  function postMessageToParent(type, payload){
    if (!global.parent || global.parent === global) return;
    try { global.parent.postMessage({ type: type, payload: payload || {} }, ORIGIN); } catch (_) {}
  }

  function postHeight(){
    var root = doc.documentElement;
    var body = doc.body;
    var height = Math.max(
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      900
    );
    postMessageToParent(HEIGHT_MESSAGE, { height: height });
  }

  function scheduleHeight(){
    try { global.requestAnimationFrame(postHeight); } catch (_) { postHeight(); }
  }

  function setStatus(message, ok){
    var box = $('[data-role="leadError"]');
    if (!box) return;
    if (statusTimer) {
      try { global.clearTimeout(statusTimer); } catch (_) {}
      statusTimer = 0;
    }
    box.textContent = safeText(message);
    box.style.display = message ? '' : 'none';
    box.style.color = ok ? STATUS_OK : STATUS_ERROR;
    if (message && ok) {
      statusTimer = global.setTimeout(function(){
        box.textContent = '';
        box.style.display = 'none';
      }, 5200);
    }
    scheduleHeight();
  }

  function patchPrivacyLink(){
    var link = $('.pcForm__consent a');
    if (!link) return;
    var href = safeText(CONFIG.privacyPolicyUrl || '').trim();
    if (href) link.href = href;
  }

  function patchSubmitButton(){
    var btn = doc.getElementById('pcSubmitLeadBtn') || doc.getElementById('pcSubmitStandaloneBtn') || doc.getElementById('pcSubmitToTildaBtn');
    if (!btn) return null;
    btn.textContent = safeText((resolveSubmitEndpoint() || CONFIG.telegramShareBaseUrl || CONFIG.telegramUsername) ? 'Отправить заявку' : 'Подготовить заявку');
    return btn;
  }

  function findField(name){
    return $('#paverLeadForm [name="' + name + '"]');
  }

  function collectHiddenValues(){
    var names = [
      'order_form','order_technology','order_color','order_thickness_mm','order_area_m2','order_m2_per_pallet','order_pallets',
      'order_ship_m2','order_over_m2','order_weight_kg','order_unit_price','order_total_price','order_positions_text','order_cart_grand_total'
    ];
    var payload = {};
    for (var i = 0; i < names.length; i += 1) {
      var el = findField(names[i]);
      payload[names[i]] = el ? safeText(el.value) : '';
    }
    return payload;
  }

  function appendLeadSubmitMode(url){
    var raw = trimTrailingSlashes(url || '');
    if (!raw) return '';
    return raw + (raw.indexOf('?') >= 0 ? '&mode=lead_submit' : '?mode=lead_submit');
  }

  function resolveSubmitEndpoint(){
    var endpoint = safeText(CONFIG.submitEndpoint || '').trim();
    if (endpoint) return endpoint;
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

  function collectLeadPayload(){
    try { if (typeof global.cartUpdateHiddenFields === 'function') global.cartUpdateHiddenFields(); } catch (_) {}
    var cartRef = global.__pcCart || null;
    var hidden = collectHiddenValues();
    return {
      submitted_at: nowIso(),
      source: 'visualizer_calc_cart_v1',
      form_type: 'calculator',
      transaction_id: buildTransactionId(),
      block_id: 'calculator_module',
      page_url: (function(){ try { return global.location.href; } catch (_) { return ''; } })(),
      contacts: {
        name: safeText(findField('name') && findField('name').value).trim(),
        phone: safeText(findField('phone') && findField('phone').value).trim(),
        email: safeText(findField('email') && findField('email').value).trim(),
        comment: safeText(findField('comment') && findField('comment').value).trim()
      },
      consent: !!(findField('personal_data_consent') && findField('personal_data_consent').checked),
      personal_data_consent: (findField('personal_data_consent') && findField('personal_data_consent').checked) ? 'yes' : 'no',
      summary: hidden,
      cart: cloneJson(cartRef && cartRef.positions ? cartRef.positions : []),
      order_positions_count: cartRef && cartRef.positions ? cartRef.positions.length : 0,
      order_cart_grand_total: safeText(hidden.order_cart_grand_total),
      order_source: 'visualizer_calc_cart_v1'
    };
  }

  function buildTelegramShareUrl(payload){
    var base = safeText(CONFIG.telegramShareBaseUrl || '').trim();
    if (!base) {
      var username = safeText(CONFIG.telegramUsername || '').trim().replace(/^@/, '');
      if (username) {
        base = 'https://t.me/' + encodeURIComponent(username) + '?text=';
      }
    }
    if (!base) return '';
    var text = '';
    text += 'Request details:%0A';
    text += 'name: ' + encodeURIComponent(payload.contacts.name || '—') + '%0A';
    text += 'email: ' + encodeURIComponent(payload.contacts.email || '—') + '%0A';
    text += 'phone: ' + encodeURIComponent(payload.contacts.phone || '—') + '%0A';
    text += 'comment: ' + encodeURIComponent(payload.contacts.comment || '—') + '%0A';
    if (payload.summary && payload.summary.order_positions_text) text += 'order_positions_text: ' + encodeURIComponent(payload.summary.order_positions_text) + '%0A';
    if (payload.order_cart_grand_total) text += 'order_cart_grand_total: ' + encodeURIComponent(payload.order_cart_grand_total) + '%0A';
    text += 'order_positions_count: ' + encodeURIComponent(String(payload.order_positions_count || 0)) + '%0A';
    text += 'order_source: ' + encodeURIComponent(payload.order_source || 'visualizer_calc_cart_v1') + '%0A';
    text += 'personal_data_consent: ' + encodeURIComponent(payload.personal_data_consent || 'no');
    return base + text;
  }

  function validateBeforeSubmit(){
    var name = safeText(findField('name') && findField('name').value).trim();
    var phone = safeText(findField('phone') && findField('phone').value).trim();
    var emailField = findField('email');
    var consent = findField('personal_data_consent');
    var cartRef = global.__pcCart || null;
    if (name.length < 2) {
      setStatus('Пожалуйста, укажите имя.', false);
      try { findField('name').focus(); } catch (_) {}
      return false;
    }
    if (!(digits(phone).length === 11 && digits(phone).charAt(0) === '7')) {
      setStatus('Пожалуйста, укажите корректный телефон в формате +7.', false);
      try { findField('phone').focus(); } catch (_) {}
      return false;
    }
    if (emailField && typeof emailField.checkValidity === 'function' && !emailField.checkValidity()) {
      setStatus('Пожалуйста, укажите корректный email.', false);
      try { emailField.focus(); } catch (_) {}
      return false;
    }
    if (!cartRef || !cartRef.positions || !cartRef.positions.length) {
      setStatus('Корзина пуста. Добавьте хотя бы одну позицию.', false);
      return false;
    }
    if (consent && !consent.checked) {
      setStatus('Подтвердите согласие на обработку персональных данных.', false);
      try { consent.focus(); } catch (_) {}
      return false;
    }
    setStatus('', false);
    return true;
  }

  function saveDraft(payload){
    try {
      global.localStorage.setItem(safeText(CONFIG.draftStorageKey || 'ag_calculator_last_draft_v1'), JSON.stringify(payload));
    } catch (_) {}
  }

  function submitToEndpoint(payload){
    var endpoint = resolveSubmitEndpoint();
    if (!endpoint) return Promise.resolve({ mode: 'draft' });
    return global.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function(response){
      if (!response.ok) throw new Error('submit-http-' + response.status);
      return response.json().catch(function(){ return { ok: true }; }).then(function(data){
        return { mode: 'endpoint', response: data || {} };
      });
    });
  }

  function handleStandaloneSubmit(ev){
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (!validateBeforeSubmit()) return;
    var payload = collectLeadPayload();
    saveDraft(payload);
    postMessageToParent(SUBMIT_MESSAGE, payload);

    submitToEndpoint(payload).then(function(result){
      if (result && result.mode === 'endpoint') {
        setStatus('Заявка отправлена. Мы свяжемся с вами в ближайшее время.', true);
        return;
      }
      var telegramUrl = buildTelegramShareUrl(payload);
      if (telegramUrl) {
        try { global.open(telegramUrl, '_blank', 'noopener'); } catch (_) {}
        setStatus('Черновик заявки подготовлен и открыт в Telegram.', true);
        return;
      }
      setStatus(safeText(CONFIG.successMessage || 'Заявка отправлена.'), true);
    }).catch(function(error){
      setStatus('Не удалось отправить заявку: ' + (error && error.message ? error.message : 'network error'), false);
    });
  }

  function initStandaloneSubmit(){
    var btn = patchSubmitButton();
    if (!btn) return false;
    if (!btn.__agStandaloneSubmitBound) {
      btn.__agStandaloneSubmitBound = true;
      btn.addEventListener('click', handleStandaloneSubmit);
    }
    return true;
  }

  function bootStandaloneSubmit(){
    patchPrivacyLink();
    if (initStandaloneSubmit()) return true;
    return false;
  }

  function waitForStandaloneForm(){
    if (bootStandaloneSubmit()) return;
    var attempts = 0;
    var maxAttempts = 80;
    var timer = global.setInterval(function(){
      attempts += 1;
      if (bootStandaloneSubmit() || attempts >= maxAttempts) {
        try { global.clearInterval(timer); } catch (_) {}
      }
    }, 250);
    try {
      if (global.MutationObserver) {
        var mo = new global.MutationObserver(function(){
          if (bootStandaloneSubmit()) {
            try { mo.disconnect(); } catch (_) {}
            try { global.clearInterval(timer); } catch (_) {}
          }
        });
        mo.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
      }
    } catch (_) {}
  }

  function initResizeReporting(){
    postMessageToParent(READY_MESSAGE, { version: safeText(CONFIG.version || '') });
    scheduleHeight();
    try {
      if (global.ResizeObserver) {
        var ro = new global.ResizeObserver(function(){ scheduleHeight(); });
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
      }
    } catch (_) {}
    global.addEventListener('load', scheduleHeight);
    global.addEventListener('resize', scheduleHeight);
    doc.addEventListener('input', scheduleHeight, true);
    doc.addEventListener('change', scheduleHeight, true);
    doc.addEventListener('click', function(){ global.setTimeout(scheduleHeight, 32); }, true);
    global.setInterval(postHeight, 1200);
  }

  global.initStandaloneLeadTransport = function(){
    return bootStandaloneSubmit();
  };

  waitForStandaloneForm();
  initResizeReporting();
})(window, document);
