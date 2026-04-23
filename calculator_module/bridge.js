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

  function fmtNum(value, digits){
    var num = Number(value || 0);
    var places = Number.isFinite(digits) ? digits : 0;
    return num.toLocaleString('ru-RU', {
      minimumFractionDigits: places,
      maximumFractionDigits: places
    });
  }

  function fmtRub(value){
    var num = Number(value || 0);
    return fmtNum(num, 0) + ' ₽';
  }

  function fmtRub2(value){
    var num = Number(value || 0);
    return fmtNum(num, 2) + ' ₽';
  }

  function safeNumber(value){
    return (typeof value === 'number' && isFinite(value)) ? value : NaN;
  }

  function calcCartTotals(positions){
    var sum = 0;
    var hasRequest = false;
    for (var i = 0; i < positions.length; i += 1) {
      var pos = positions[i] || {};
      if (pos.grand_total === 'по запросу') {
        hasRequest = true;
        continue;
      }
      if (typeof pos.grand_total === 'number' && isFinite(pos.grand_total)) {
        sum += pos.grand_total;
      }
    }
    return { sum: sum, hasRequest: hasRequest };
  }

  function formatCartQty(value, unitLabel){
    if (value === 'по запросу') return 'по запросу';
    if (!(typeof value === 'number' && isFinite(value))) return '— ' + unitLabel;
    return fmtNum(value, 2) + ' ' + unitLabel;
  }

  function formatCartKg(value){
    if (value === 'по запросу') return 'по запросу';
    if (!(typeof value === 'number' && isFinite(value))) return '— кг';
    return fmtNum(value, 0) + ' кг';
  }

  function formatCartMoney(value, keepDecimals){
    if (value === 'по запросу') return 'по запросу';
    if (!(typeof value === 'number' && isFinite(value))) return '—';
    return keepDecimals ? fmtRub2(value) : fmtRub(value);
  }

  function buildManagerTextFromCart(positions){
    if (!positions || !positions.length) return '';
    var blocks = [];
    for (var i = 0; i < positions.length; i += 1) {
      var pos = positions[i] || {};
      var unitLabel = pos.qty_unit === 'lm' ? 'пог. м' : 'м²';
      var sizeLabel = pos.type === 'curb'
        ? (safeText(pos.curb_label || pos.curb_size || '').trim())
        : (safeText(pos.thickness_label || (pos.thickness_value ? String(pos.thickness_value) + ' мм' : '')).trim());
      var lines = [];
      var title = 'Позиция ' + (i + 1) + ': ' + (safeText(pos.form_name || '—'));
      if (sizeLabel) title += ' · ' + sizeLabel;
      lines.push(title);
      lines.push((safeText(pos.tech_name || '—')) + ' · ' + (safeText(pos.color_name || '—')));
      lines.push('Количество (ввод): ' + formatCartQty(safeNumber(pos.qty_value), unitLabel));
      lines.push('Цена за 1 ' + unitLabel + ': ' + formatCartMoney(pos.unit_price, true));
      lines.push('В 1 поддоне: ' + formatCartQty(safeNumber(pos.per_pallet_qty), unitLabel));
      lines.push('Поддонов: ' + (pos.pallets === 'по запросу' ? 'по запросу' : (typeof pos.pallets === 'number' && isFinite(pos.pallets) ? String(pos.pallets) : '—')));
      lines.push('Отгрузка (кратно поддону): ' + formatCartQty(safeNumber(pos.ship_qty), unitLabel));
      lines.push('Запас: ' + formatCartQty(safeNumber(pos.over_qty), unitLabel));
      lines.push('Вес 1 поддона: ' + formatCartKg(safeNumber(pos.pallet_weight_kg)));
      lines.push('Вес общий: ' + formatCartKg(safeNumber(pos.weight_kg || pos.ship_weight_kg)));
      lines.push('Стоимость 1 поддона: ' + formatCartMoney(pos.pallet_empty_price, true));
      lines.push('Стоимость поддонов: ' + formatCartMoney(pos.pallet_empty_total, true));
      lines.push('Стоимость материала: ' + formatCartMoney(pos.goods_total, true));
      lines.push('Итого по позиции: ' + formatCartMoney(pos.grand_total, true));
      blocks.push(lines.join('\n'));
    }
    var totals = calcCartTotals(positions);
    var grandText = '';
    if (positions.length) {
      grandText = totals.hasRequest ? ('ИТОГО ПО КОРЗИНЕ: ' + fmtRub(totals.sum) + ' + позиции по запросу') : ('ИТОГО ПО КОРЗИНЕ: ' + fmtRub(totals.sum));
      grandText += '\nПозиции: ' + String(positions.length);
    }
    return blocks.join('\n\n────────\n\n') + (grandText ? ('\n\n' + grandText) : '');
  }

  function deriveSummaryFromCart(cartPositions, hidden){
    var positions = Array.isArray(cartPositions) ? cartPositions : [];
    var derivedText = buildManagerTextFromCart(positions);
    var totals = calcCartTotals(positions);
    return {
      order_positions_text: derivedText || safeText(hidden.order_positions_text),
      order_cart_grand_total: positions.length ? (totals.hasRequest ? (fmtRub(totals.sum) + ' + запрос') : fmtRub(totals.sum)) : safeText(hidden.order_cart_grand_total),
      order_positions_count: positions.length,
      order_source: 'tilda_calc_cart_v1'
    };
  }

  function collectLeadPayload(){
    try { if (typeof global.cartUpdateHiddenFields === 'function') global.cartUpdateHiddenFields(); } catch (_) {}
    var cartRef = global.__pcCart || null;
    var cartPositions = cloneJson(cartRef && cartRef.positions ? cartRef.positions : []) || [];
    var hidden = collectHiddenValues();
    var derived = deriveSummaryFromCart(cartPositions, hidden);
    hidden.order_positions_text = derived.order_positions_text;
    hidden.order_cart_grand_total = derived.order_cart_grand_total;
    return {
      submitted_at: nowIso(),
      source: 'tilda_calc_cart_v1',
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
      cart: cartPositions,
      order_positions_text: derived.order_positions_text,
      order_positions_count: derived.order_positions_count,
      order_cart_grand_total: derived.order_cart_grand_total,
      order_source: 'tilda_calc_cart_v1'
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
    text += 'order_source: ' + encodeURIComponent(payload.order_source || 'tilda_calc_cart_v1') + '%0A';
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
