(function(global, doc){
  'use strict';

  var CONFIG = global.__AG_CALCULATOR_CONFIG__ || {};
  var ORIGIN = (function(){ try { return global.location.origin; } catch (_) { return '*'; } })();
  var SEARCH = safeText(global.location && global.location.search);
  var EMBEDDED_MODE = /(?:^|[?&])embedded=1(?:&|$)/.test(SEARCH);
  var HEIGHT_MESSAGE = 'ag-calc-height';
  var READY_MESSAGE = 'ag-calc-ready';
  var SUBMIT_MESSAGE = 'ag-calc-submit-ready';
  var MOBILE_STATE_MESSAGE = 'ag-calc-mobile-state';
  var HOST_ACTION_MESSAGE = 'ag-calc-host-action';
  var STATUS_ERROR = '#b91c1c';
  var STATUS_OK = '#166534';
  var statusTimer = 0;
  var mobileStateTimer = 0;
  var lastMobileStateJson = '';

  function $(selector, root){ return (root || doc).querySelector(selector); }
  function safeText(value){ return value == null ? '' : String(value); }
  function nowIso(){ try { return new Date().toISOString(); } catch (_) { return ''; } }
  function digits(value){ return safeText(value).replace(/\D/g, ''); }
  function cloneJson(value){ try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; } }
  function num(value, fallback){
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback || 0);
  }

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
    scheduleMobileState();
  }

  function patchPrivacyLink(){
    var link = $('.pcForm__consent a');
    if (!link) return;
    var href = safeText(CONFIG.privacyPolicyUrl || '').trim();
    if (href) link.href = href;
  }

  function patchSubmitButton(){
    var btn = doc.getElementById('pcSubmitToTildaBtn');
    if (!btn) return null;
    btn.id = 'pcSubmitStandaloneBtn';
    btn.textContent = safeText((CONFIG.submitEndpoint || CONFIG.telegramShareBaseUrl || CONFIG.telegramUsername) ? 'Отправить заявку' : 'Подготовить заявку');
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

  function collectLeadPayload(){
    try { if (typeof global.cartUpdateHiddenFields === 'function') global.cartUpdateHiddenFields(); } catch (_) {}
    var cartRef = global.__pcCart || null;
    return {
      submitted_at: nowIso(),
      source: 'visualizer_calculator_module',
      contacts: {
        name: safeText(findField('name') && findField('name').value).trim(),
        phone: safeText(findField('phone') && findField('phone').value).trim(),
        email: safeText(findField('email') && findField('email').value).trim(),
        comment: safeText(findField('comment') && findField('comment').value).trim()
      },
      consent: !!(findField('personal_data_consent') && findField('personal_data_consent').checked),
      summary: collectHiddenValues(),
      cart: cloneJson(cartRef && cartRef.positions ? cartRef.positions : []),
      cart_positions_count: cartRef && cartRef.positions ? cartRef.positions.length : 0,
      cart_grand_total: safeText(collectHiddenValues().order_cart_grand_total)
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
    text += 'Новая заявка из калькулятора%0A';
    text += 'Имя: ' + encodeURIComponent(payload.contacts.name || '—') + '%0A';
    text += 'Телефон: ' + encodeURIComponent(payload.contacts.phone || '—') + '%0A';
    text += 'Email: ' + encodeURIComponent(payload.contacts.email || '—') + '%0A';
    if (payload.contacts.comment) text += 'Комментарий: ' + encodeURIComponent(payload.contacts.comment) + '%0A';
    if (payload.summary && payload.summary.order_positions_text) text += '%0A' + encodeURIComponent(payload.summary.order_positions_text);
    if (payload.summary && payload.summary.order_cart_grand_total) text += '%0AИтог: ' + encodeURIComponent(payload.summary.order_cart_grand_total);
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
      global.localStorage.setItem('ag_calculator_last_draft_v1', JSON.stringify(payload));
    } catch (_) {}
  }

  function submitToEndpoint(payload){
    var endpoint = safeText(CONFIG.submitEndpoint || '').trim();
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
        setStatus('Заявка отправлена.', true);
        return;
      }
      var telegramUrl = buildTelegramShareUrl(payload);
      if (telegramUrl) {
        try { global.open(telegramUrl, '_blank', 'noopener'); } catch (_) {}
        setStatus('Черновик заявки подготовлен и открыт в Telegram.', true);
        return;
      }
      setStatus(safeText(CONFIG.successMessage || 'Заявка подготовлена.'), true);
    }).catch(function(error){
      setStatus('Не удалось отправить заявку: ' + (error && error.message ? error.message : 'network error'), false);
    });
  }

  function initStandaloneSubmit(){
    var btn = patchSubmitButton();
    if (!btn) return;
    btn.onclick = handleStandaloneSubmit;
  }

  function isElementVisible(el){
    if (!el) return false;
    if (el.hidden) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    var style = null;
    try { style = global.getComputedStyle(el); } catch (_) {}
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden' && num(style.opacity, 1) > 0.01;
  }

  function docOffsetTop(el){
    if (!el || !el.getBoundingClientRect) return 0;
    var rect = el.getBoundingClientRect();
    return Math.max(0, Math.round(rect.top + (global.pageYOffset || 0)));
  }

  function getPreviewState(prefix){
    var btn = $('[data-role="' + prefix + 'PreviewBtn"]');
    var img = $('[data-role="' + prefix + 'PreviewImg"]');
    var empty = !!(btn && btn.classList && btn.classList.contains('is-empty'));
    return {
      src: img && img.getAttribute('src') ? safeText(img.src || img.getAttribute('src')) : '',
      alt: safeText(img && (img.getAttribute('alt') || img.alt)),
      empty: empty
    };
  }

  function detectStageKey(hintText, buttonText){
    var text = (safeText(hintText) + ' ' + safeText(buttonText)).toLowerCase();
    if (text.indexOf('заяв') !== -1) return 'lead';
    if (text.indexOf('корзин') !== -1) return 'cart';
    if (text.indexOf('м²') !== -1 || text.indexOf('м2') !== -1 || text.indexOf('площад') !== -1) return 'quantity';
    if (text.indexOf('цвет') !== -1) return 'color';
    if (text.indexOf('технолог') !== -1) return 'technology';
    return 'form';
  }

  function getStageTarget(stageKey){
    if (stageKey === 'technology') return $('[data-role="techTabs"]');
    if (stageKey === 'color') return $('[data-role="colors"]');
    if (stageKey === 'quantity') return $('[data-role="qty"]');
    if (stageKey === 'cart') return $('[data-role="cartAddBtn"]') || $('[data-role="cartBlock"]');
    if (stageKey === 'lead') return doc.getElementById('paverLeadForm');
    return $('[data-role="forms"]');
  }

  function collectMobileState(){
    var mbar = $('[data-role="mbar"]');
    var hint = safeText($('[data-role="mbarHint"]') && $('[data-role="mbarHint"]').textContent).trim();
    var buttonText = safeText($('[data-role="mbarMainBtn"]') && $('[data-role="mbarMainBtn"]').textContent).trim();
    var stageKey = detectStageKey(hint, buttonText);
    var countEl = $('[data-role="mbarCount"]');
    var cartSumEl = $('[data-role="mbarCartSum"]');
    return {
      visible: isElementVisible(mbar),
      hint: hint,
      name: safeText($('[data-role="mbarName"]') && $('[data-role="mbarName"]').textContent).trim(),
      count: safeText(countEl && countEl.textContent).trim(),
      countVisible: isElementVisible(countEl),
      sub: safeText($('[data-role="mbarSub"]') && $('[data-role="mbarSub"]').textContent).trim(),
      cartSum: safeText(cartSumEl && cartSumEl.textContent).trim(),
      cartSumVisible: isElementVisible(cartSumEl),
      buttonText: buttonText,
      stageKey: stageKey,
      targetOffset: docOffsetTop(getStageTarget(stageKey)),
      previews: {
        form: getPreviewState('mbarForm'),
        color: getPreviewState('mbarColor')
      }
    };
  }

  function postMobileState(force){
    if (!EMBEDDED_MODE) return;
    var payload = collectMobileState();
    var json = '';
    try { json = JSON.stringify(payload); } catch (_) { json = ''; }
    if (!force && json && json === lastMobileStateJson) return;
    lastMobileStateJson = json;
    postMessageToParent(MOBILE_STATE_MESSAGE, payload);
  }

  function scheduleMobileState(){
    if (!EMBEDDED_MODE) return;
    if (mobileStateTimer) return;
    mobileStateTimer = global.setTimeout(function(){
      mobileStateTimer = 0;
      postMobileState(false);
    }, 40);
  }

  function ensureEmbeddedModeStyles(){
    if (!EMBEDDED_MODE) return;
    if (doc.getElementById('agCalcEmbeddedMobileBridgeStyles')) return;
    var style = doc.createElement('style');
    style.id = 'agCalcEmbeddedMobileBridgeStyles';
    style.textContent = [
      '@media (max-width: 820px){',
      '  .pcMobileBar{display:none !important;}',
      '  #paverConf2026.has-mbar{padding-bottom:0 !important;}',
      '}',
      '.pcHostFocusPulse{',
      '  outline:3px solid rgba(37,99,235,.78) !important;',
      '  outline-offset:4px !important;',
      '  border-radius:16px !important;',
      '  animation:pcHostFocusPulse .8s ease 0s 2;',
      '  box-shadow:0 0 0 4px rgba(59,130,246,.16) !important;',
      '}',
      '@keyframes pcHostFocusPulse{',
      '  0%{transform:translateY(0);}',
      '  50%{transform:translateY(-2px);}',
      '  100%{transform:translateY(0);}',
      '}'
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function pulseTarget(stageKey){
    var target = getStageTarget(stageKey || detectStageKey('', ''));
    if (!target || !target.classList) return;
    target.classList.add('pcHostFocusPulse');
    if (stageKey === 'quantity') {
      try { target.focus(); } catch (_) {}
    }
    global.setTimeout(function(){
      try { target.classList.remove('pcHostFocusPulse'); } catch (_) {}
    }, 1800);
  }

  function handleHostMessage(event){
    if (!EMBEDDED_MODE) return;
    if (!event || event.origin !== ORIGIN) return;
    var data = event.data || {};
    if (data.type !== HOST_ACTION_MESSAGE) return;
    var payload = data.payload || {};
    if (payload.action === 'focus-current-stage') {
      pulseTarget(safeText(payload.stageKey) || collectMobileState().stageKey);
      scheduleMobileState();
      return;
    }
    if (payload.action === 'mobile-state-request') {
      postMobileState(true);
    }
  }

  function initResizeReporting(){
    postMessageToParent(READY_MESSAGE, { version: safeText(CONFIG.version || '') });
    scheduleHeight();
    postMobileState(true);
    try {
      if (global.ResizeObserver) {
        var ro = new global.ResizeObserver(function(){ scheduleHeight(); scheduleMobileState(); });
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
      }
    } catch (_) {}
    try {
      if (global.MutationObserver) {
        var mo = new global.MutationObserver(function(){ scheduleHeight(); scheduleMobileState(); });
        mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      }
    } catch (_) {}
    global.addEventListener('load', function(){ scheduleHeight(); postMobileState(true); });
    global.addEventListener('resize', function(){ scheduleHeight(); scheduleMobileState(); });
    global.addEventListener('message', handleHostMessage);
    doc.addEventListener('input', function(){ scheduleHeight(); scheduleMobileState(); }, true);
    doc.addEventListener('change', function(){ scheduleHeight(); scheduleMobileState(); }, true);
    doc.addEventListener('click', function(){ global.setTimeout(function(){ scheduleHeight(); scheduleMobileState(); }, 32); }, true);
    global.setInterval(function(){ postHeight(); postMobileState(false); }, 1200);
  }

  ensureEmbeddedModeStyles();
  patchPrivacyLink();
  initStandaloneSubmit();
  initResizeReporting();
})(window, document);
