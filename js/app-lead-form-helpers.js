function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

function safeText(value) {
  return value == null ? '' : String(value);
}

function nowIso() {
  try { return new Date().toISOString(); } catch (_) { return ''; }
}

function buildTransactionId() {
  const ts = Date.now();
  const rnd = Math.floor(Math.random() * 1e10).toString().padStart(10, '0');
  return `${ts}:${rnd}`;
}

function appendLeadSubmitMode(url) {
  const raw = trimTrailingSlashes(url || '');
  if (!raw) return '';
  return raw + (raw.includes('?') ? '&mode=lead_submit' : '?mode=lead_submit');
}

function resolveLeadSubmitEndpoint() {
  try {
    const runtime = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
    if (runtime && typeof runtime.resolveTelemetryEndpoint === 'function') {
      const endpoint = trimTrailingSlashes(runtime.resolveTelemetryEndpoint() || '');
      if (endpoint) return appendLeadSubmitMode(endpoint);
    }
  } catch (_) {}
  try {
    const runtime = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
    if (runtime && typeof runtime.resolvePublicApiBaseUrl === 'function') {
      const base = trimTrailingSlashes(runtime.resolvePublicApiBaseUrl() || '');
      if (base) return `${base}/api/telemetry?mode=lead_submit`;
    }
  } catch (_) {}
  try {
    const runtime = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
    if (runtime && typeof runtime.resolveAdminApiBaseUrl === 'function') {
      const base = trimTrailingSlashes(runtime.resolveAdminApiBaseUrl() || '');
      if (base) return `${base}/api/telemetry?mode=lead_submit`;
    }
  } catch (_) {}
  try {
    const base = trimTrailingSlashes(window.__API_BASE_URL__ || window.API_BASE_URL || '');
    if (base) return `${base}/api/telemetry?mode=lead_submit`;
  } catch (_) {}
  return '';
}

function ensureLeadFormStyles(doc) {
  if (doc.getElementById('leadFormModalStyles')) return;
  const style = doc.createElement('style');
  style.id = 'leadFormModalStyles';
  style.textContent = [
    'body.modal-open{overflow:hidden;}',
    '.leadFormModal{position:fixed;inset:0;z-index:2300;display:flex;align-items:center;justify-content:center;padding:18px 14px calc(18px + var(--safe-bottom));background:rgba(7,10,16,0.72);backdrop-filter:blur(12px);}',
    '.leadFormModal[hidden]{display:none !important;}',
    '.leadFormModal__card{width:min(100%,520px);display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:24px;background:rgba(255,255,255,0.98);border:1px solid rgba(8,16,29,0.08);box-shadow:0 24px 54px rgba(0,0,0,0.24);}',
    '.leadFormModal__eyebrow{font-size:11px;font-weight:900;letter-spacing:.24px;text-transform:uppercase;color:rgba(8,16,29,0.56);}',
    '.leadFormModal__title{font-size:24px;line-height:1.1;font-weight:1000;color:#08101d;}',
    '.leadFormModal__text{font-size:14px;line-height:1.45;color:rgba(8,16,29,0.72);}',
    '.leadFormModal__context{padding:12px 14px;border-radius:16px;background:#f8fafc;border:1px solid rgba(8,16,29,0.08);display:grid;gap:6px;}',
    '.leadFormModal__contextLine{font-size:13px;line-height:1.35;color:#0f172a;}',
    '.leadFormModal__contextLine b{font-weight:900;color:#08101d;}',
    '.leadFormModal__grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}',
    '.leadFormModal__field,.leadFormModal__area{width:100%;border:1px solid rgba(8,16,29,0.12);border-radius:16px;background:#fff;color:#08101d;font:inherit;padding:13px 14px;outline:none;box-sizing:border-box;}',
    '.leadFormModal__field::placeholder,.leadFormModal__area::placeholder{color:rgba(8,16,29,0.42);}',
    '.leadFormModal__field:focus,.leadFormModal__area:focus{border-color:rgba(90,167,255,0.9);box-shadow:0 0 0 4px rgba(90,167,255,0.14);}',
    '.leadFormModal__area{min-height:108px;resize:vertical;}',
    '.leadFormModal__full{grid-column:1/-1;}',
    '.leadFormModal__consent{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:#0f172a;}',
    '.leadFormModal__consent input{margin-top:2px;}',
    '.leadFormModal__consent a{color:#1b74ff;text-decoration:none;}',
    '.leadFormModal__status{display:none;font-size:13px;line-height:1.35;border-radius:14px;padding:11px 12px;background:#f8fafc;border:1px solid rgba(8,16,29,0.08);}',
    '.leadFormModal__status.is-visible{display:block;}',
    '.leadFormModal__status.is-ok{color:#166534;border-color:rgba(22,101,52,0.18);background:rgba(22,101,52,0.08);}',
    '.leadFormModal__status.is-error{color:#b91c1c;border-color:rgba(185,28,28,0.18);background:rgba(185,28,28,0.08);}',
    '.leadFormModal__actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}',
    '.leadFormModal__actions .btnGhost,.leadFormModal__actions .btnPrimary{width:100%;min-height:48px;}',
    '.leadFormModal__actions .btnGhost{display:flex;align-items:center;justify-content:center;text-decoration:none;}',
    '.leadFormModal__close{position:absolute;top:14px;right:14px;width:38px;height:38px;border-radius:999px;border:1px solid rgba(8,16,29,0.08);background:#fff;color:#08101d;font-size:18px;font-weight:900;cursor:pointer;box-shadow:0 8px 18px rgba(0,0,0,0.12);}',
    '.leadFormModal__cardWrap{position:relative;width:min(100%,520px);}',
    '@media (max-width: 640px){.leadFormModal{padding:12px 10px calc(12px + var(--safe-bottom));}.leadFormModal__card{padding:16px;border-radius:22px;gap:10px;}.leadFormModal__title{font-size:20px;}.leadFormModal__grid{grid-template-columns:minmax(0,1fr);}.leadFormModal__actions{grid-template-columns:minmax(0,1fr);}}'
  ].join('\n');
  (doc.head || doc.documentElement).appendChild(style);
}

function applyRuPhoneMask(input) {
  if (!input || input.__leadMaskBound) return;
  input.__leadMaskBound = true;
  const format = (raw) => {
    let d = digits(raw);
    if (!d) return '';
    if (d[0] === '8') d = '7' + d.slice(1);
    if (d[0] !== '7') d = '7' + d;
    d = d.slice(0, 11);
    const p = d.slice(1);
    const a = p.slice(0, 3);
    const b = p.slice(3, 6);
    const c = p.slice(6, 8);
    const e = p.slice(8, 10);
    let out = '+7';
    if (a) out += ' (' + a + (a.length === 3 ? ')' : '');
    if (b) out += ' ' + b;
    if (c) out += '-' + c;
    if (e) out += '-' + e;
    return out;
  };
  const onInput = () => {
    const val = format(input.value || '');
    input.value = val;
  };
  input.addEventListener('input', onInput);
  input.addEventListener('blur', onInput);
  input.addEventListener('focus', () => {
    if (!input.value) input.value = '+7 (';
  });
}

export function createLeadFormHelpers(opts = {}) {
  const doc = opts.doc || document;
  const UI = opts.UI || {};
  const telemetryTrack = typeof opts.telemetryTrack === 'function' ? opts.telemetryTrack : (() => {});
  const telemetryCtx = typeof opts.telemetryCtx === 'function' ? opts.telemetryCtx : ((extra = {}) => extra || {});
  const getState = typeof opts.getState === 'function' ? opts.getState : (() => ({}));
  const managerPhone = safeText(opts.managerPhone || '+79780224411').trim();
  const privacyUrl = safeText(opts.privacyPolicyUrl || 'https://ag-ru.com/').trim();
  let modal = null;
  let form = null;
  let statusBox = null;
  let contextBox = null;
  let submitBtn = null;
  let cleanupEsc = null;

  function setStatus(message, ok) {
    if (!statusBox) return;
    statusBox.textContent = safeText(message);
    statusBox.classList.toggle('is-visible', !!message);
    statusBox.classList.toggle('is-ok', !!message && !!ok);
    statusBox.classList.toggle('is-error', !!message && !ok);
  }

  function buildContext() {
    const state = getState() || {};
    const shape = state.selectedShape || null;
    const tile = state.selectedTile || null;
    return {
      page_url: (() => { try { return window.location.href; } catch (_) { return ''; } })(),
      form_type: 'manager_form',
      source: 'manager_form_v1',
      transaction_id: buildTransactionId(),
      block_id: 'detail_manager_form',
      shape_id: shape && shape.id ? String(shape.id) : '',
      shape_name: shape && shape.name ? String(shape.name) : '',
      tile_id: tile && tile.id ? String(tile.id) : '',
      tile_name: tile && tile.name ? String(tile.name) : '',
      submitted_at: nowIso(),
    };
  }

  function renderContext(ctx) {
    if (!contextBox) return;
    const lines = [];
    if (ctx.shape_name) lines.push(`<div class="leadFormModal__contextLine"><b>Форма:</b> ${ctx.shape_name}</div>`);
    if (ctx.tile_name) lines.push(`<div class="leadFormModal__contextLine"><b>Цвет / текстура:</b> ${ctx.tile_name}</div>`);
    if (ctx.page_url) lines.push(`<div class="leadFormModal__contextLine"><b>Страница:</b> ${ctx.page_url}</div>`);
    contextBox.innerHTML = lines.join('');
    contextBox.hidden = !lines.length;
  }

  function ensureModal() {
    if (modal) return modal;
    ensureLeadFormStyles(doc);
    modal = doc.createElement('div');
    modal.id = 'leadFormModal';
    modal.className = 'leadFormModal';
    modal.hidden = true;
    modal.innerHTML = [
      '<div class="leadFormModal__cardWrap">',
      '  <button type="button" class="leadFormModal__close" data-action="close" aria-label="Закрыть">×</button>',
      '  <div class="leadFormModal__card" role="dialog" aria-modal="true" aria-labelledby="leadFormTitle" aria-describedby="leadFormText">',
      '    <div class="leadFormModal__eyebrow">Заявка менеджеру</div>',
      '    <div id="leadFormTitle" class="leadFormModal__title">Оставьте заявку</div>',
      '    <div id="leadFormText" class="leadFormModal__text">Мы получим заявку в Telegram и свяжемся с вами для уточнения заказа.</div>',
      '    <div class="leadFormModal__context" data-role="context" hidden></div>',
      '    <form id="leadContactForm" novalidate>',
      '      <div class="leadFormModal__grid">',
      '        <input class="leadFormModal__field" name="name" placeholder="Ваше имя" autocomplete="name" required>',
      '        <input class="leadFormModal__field" name="phone" placeholder="+7 (___) ___-__-__" inputmode="tel" autocomplete="tel" required>',
      '        <input class="leadFormModal__field leadFormModal__full" name="email" placeholder="Email" type="email" inputmode="email" autocomplete="email">',
      '        <textarea class="leadFormModal__area leadFormModal__full" name="comment" placeholder="Комментарий"></textarea>',
      '      </div>',
      '      <label class="leadFormModal__consent">',
      '        <input type="checkbox" name="personal_data_consent" required>',
      '        <span>Согласен на обработку персональных данных. <a href="' + privacyUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">Политика конфиденциальности</a></span>',
      '      </label>',
      '      <input type="text" name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;opacity:0;pointer-events:none;">',
      '      <div class="leadFormModal__status" data-role="status"></div>',
      '      <div class="leadFormModal__actions">',
      '        <a class="btnGhost" data-role="callNow" href="tel:' + managerPhone.replace(/"/g, '&quot;') + '">Позвонить</a>',
      '        <button type="submit" class="btnPrimary" data-role="submit">Отправить заявку</button>',
      '      </div>',
      '    </form>',
      '  </div>',
      '</div>'
    ].join('');
    doc.body.appendChild(modal);
    form = modal.querySelector('#leadContactForm');
    statusBox = modal.querySelector('[data-role="status"]');
    contextBox = modal.querySelector('[data-role="context"]');
    submitBtn = modal.querySelector('[data-role="submit"]');
    const phoneInput = form.querySelector('[name="phone"]');
    applyRuPhoneMask(phoneInput);
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal || (ev.target && ev.target.getAttribute('data-action') === 'close')) {
        close();
      }
    });
    modal.querySelector('[data-role="callNow"]').addEventListener('click', () => {
      telemetryTrack('cta_manager_call', telemetryCtx({ phone: managerPhone, source: 'lead_modal' }));
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      setStatus('', false);
      const payload = collectPayload();
      const validationError = validate(payload);
      if (validationError) {
        setStatus(validationError, false);
        return;
      }
      const endpoint = resolveLeadSubmitEndpoint();
      if (!endpoint) {
        setStatus('Не настроен API endpoint для отправки заявки.', false);
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправляем...';
      telemetryTrack('manager_form_submit', telemetryCtx({ shapeId: payload.shape_id || '', tileId: payload.tile_id || '' }));
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit',
          cache: 'no-store'
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.ok !== true) throw new Error((data && data.message) || ('submit-http-' + response.status));
        setStatus('Заявка отправлена. Мы свяжемся с вами в ближайшее время.', true);
        telemetryTrack('manager_form_submit_success', telemetryCtx({ shapeId: payload.shape_id || '', tileId: payload.tile_id || '' }));
        form.reset();
        applyRuPhoneMask(phoneInput);
        window.setTimeout(() => close(), 800);
      } catch (error) {
        telemetryTrack('manager_form_submit_failed', telemetryCtx({ reason: error && error.message ? String(error.message) : 'network_error' }));
        setStatus('Не удалось отправить заявку. Попробуйте ещё раз.', false);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить заявку';
      }
    });
    return modal;
  }

  function collectPayload() {
    const ctx = buildContext();
    return Object.assign({}, ctx, {
      source: 'manager_form_v1',
      contacts: {
        name: safeText(form.querySelector('[name="name"]').value).trim(),
        phone: safeText(form.querySelector('[name="phone"]').value).trim(),
        email: safeText(form.querySelector('[name="email"]').value).trim(),
        comment: safeText(form.querySelector('[name="comment"]').value).trim()
      },
      consent: !!form.querySelector('[name="personal_data_consent"]').checked,
      personal_data_consent: form.querySelector('[name="personal_data_consent"]').checked ? 'yes' : 'no',
      honeypot: safeText(form.querySelector('[name="company"]').value).trim()
    });
  }

  function validate(payload) {
    if (!payload.contacts || payload.contacts.name.length < 2) return 'Пожалуйста, укажите имя.';
    const phoneDigits = digits(payload.contacts && payload.contacts.phone);
    if (!(phoneDigits.length === 11 && phoneDigits.charAt(0) === '7')) return 'Пожалуйста, укажите корректный телефон в формате +7.';
    if (payload.contacts && payload.contacts.email) {
      const email = payload.contacts.email;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Пожалуйста, укажите корректный email.';
    }
    if (!payload.consent) return 'Подтвердите согласие на обработку персональных данных.';
    return '';
  }

  function open() {
    ensureModal();
    const ctx = buildContext();
    renderContext(ctx);
    setStatus('', false);
    modal.hidden = false;
    doc.body.classList.add('modal-open');
    form.querySelector('[name="name"]').focus();
    telemetryTrack('manager_form_open', telemetryCtx({ shapeId: ctx.shape_id || '', tileId: ctx.tile_id || '' }));
    if (!cleanupEsc) {
      cleanupEsc = (ev) => { if (ev.key === 'Escape') close(); };
      doc.addEventListener('keydown', cleanupEsc);
    }
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    doc.body.classList.remove('modal-open');
  }

  function bindManagerButton() {
    const btn = UI.btnManagerCall;
    if (!btn) return;
    btn.setAttribute('href', '#manager-form');
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      open();
    });
  }

  return {
    init() {
      ensureModal();
      bindManagerButton();
    },
    open,
    close,
    resolveLeadSubmitEndpoint,
  };
}
