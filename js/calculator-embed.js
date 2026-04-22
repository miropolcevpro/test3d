(function(global, doc){
  'use strict';

  var EVENT_NAME = 'ag:screen-change';
  var FRAME_MESSAGE_HEIGHT = 'ag-calc-height';
  var FRAME_MESSAGE_READY = 'ag-calc-ready';
  var FRAME_MESSAGE_SUBMIT = 'ag-calc-submit-ready';
  var FRAME_MESSAGE_MOBILE_STATE = 'ag-calc-mobile-state';
  var FRAME_MESSAGE_HOST_ACTION = 'ag-calc-host-action';
  var HIDDEN_CTA_CLASS = 'detailCta--calculatorHidden';
  var HOST_BAR_ACTIVE_CLASS = 'calculatorMobileGuideActive';
  var frame = null;
  var shell = null;
  var detailCta = null;
  var detailObserver = null;
  var hostBar = null;
  var booted = false;
  var lastScreen = 'catalog';
  var shellInViewport = false;
  var mobileState = null;

  function clamp(value, min, max) {
    var num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  function siteUrl(path) {
    try {
      var env = global.__SITE_ENV__ || null;
      if (env && typeof env.resolveSiteUrl === 'function') return env.resolveSiteUrl(path);
    } catch (_) {}
    try { return new URL(String(path || '').replace(/^\/+/, ''), global.location.href).toString(); } catch (_) { return path; }
  }

  function isMobileViewport() {
    try { return !!(global.matchMedia && global.matchMedia('(max-width: 820px)').matches); } catch (_) {}
    return (global.innerWidth || 0) <= 820;
  }

  function getMount(screen) {
    if (screen === 'detail') return doc.getElementById('calculatorModuleDetailMount');
    return doc.getElementById('calculatorModuleCatalogMount');
  }

  function getDetailCta() {
    if (detailCta && detailCta.isConnected) return detailCta;
    detailCta = doc.getElementById('detailCta') || doc.querySelector('#screenDetail .detailCta');
    return detailCta;
  }

  function setDetailCtaHidden(hidden) {
    var cta = getDetailCta();
    if (!cta) return;
    cta.classList.toggle(HIDDEN_CTA_CLASS, !!hidden);
  }

  function ensureStyles() {
    if (doc.getElementById('calculatorMobileGuideStyles')) return;
    var style = doc.createElement('style');
    style.id = 'calculatorMobileGuideStyles';
    style.textContent = [
      '.calculatorMobileGuide{position:fixed;left:10px;right:10px;bottom:10px;z-index:95;display:none;pointer-events:none;}',
      '.calculatorMobileGuide.is-visible{display:block;}',
      '.calculatorMobileGuide__card{pointer-events:auto;border:1px solid rgba(148,163,184,.24);border-radius:18px;background:rgba(255,255,255,.98);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 18px 42px rgba(15,23,42,.18);padding:10px 11px calc(10px + env(safe-area-inset-bottom));}',
      '.calculatorMobileGuide__row{display:flex;align-items:flex-end;gap:10px;}',
      '.calculatorMobileGuide__main{min-width:0;flex:1 1 auto;}',
      '.calculatorMobileGuide__hint{font-size:12px;line-height:1.08;font-weight:800;color:#2563eb;}',
      '.calculatorMobileGuide__nameRow{display:flex;align-items:center;gap:8px;margin-top:2px;}',
      '.calculatorMobileGuide__name{min-width:0;font-size:12px;line-height:1.08;font-weight:900;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.calculatorMobileGuide__count{display:none;align-items:center;justify-content:center;height:16px;min-width:22px;padding:0 5px;border-radius:999px;background:#2563eb;color:#fff;font-size:10px;font-weight:900;line-height:1;}',
      '.calculatorMobileGuide__count.is-visible{display:inline-flex;}',
      '.calculatorMobileGuide__sub,.calculatorMobileGuide__sum{font-size:11px;line-height:1.08;color:#334155;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.calculatorMobileGuide__sum{display:none;font-weight:800;color:#166534;}',
      '.calculatorMobileGuide__sum.is-visible{display:block;}',
      '.calculatorMobileGuide__previews{display:flex;gap:6px;margin-top:7px;}',
      '.calculatorMobileGuide__preview{display:flex;flex-direction:column;gap:3px;flex:0 0 64px;width:64px;}',
      '.calculatorMobileGuide__previewLabel{font-size:9px;line-height:1;color:#64748b;font-weight:700;}',
      '.calculatorMobileGuide__previewFrame{display:flex;align-items:center;justify-content:center;aspect-ratio:1.7/1;border-radius:10px;border:1px solid rgba(148,163,184,.22);background:linear-gradient(180deg,#fff,#f8fafc);overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,.06);}',
      '.calculatorMobileGuide__previewFrame img{display:block;width:100%;height:100%;object-fit:contain;}',
      '.calculatorMobileGuide__preview.is-empty .calculatorMobileGuide__previewFrame{opacity:.42;}',
      '.calculatorMobileGuide__preview.is-empty .calculatorMobileGuide__previewFrame img{visibility:hidden;}',
      '.calculatorMobileGuide__action{flex:0 0 auto;height:34px;padding:0 11px;border-radius:11px;border:0;background:#111827;color:#fff;font-size:12px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 10px 22px rgba(15,23,42,.18);}',
      'html.' + HOST_BAR_ACTIVE_CLASS + '{scroll-padding-bottom:196px;}',
      '@media (min-width: 821px){.calculatorMobileGuide{display:none !important;}}',
      '@media (max-width: 480px){',
      '  .calculatorMobileGuide{left:8px;right:8px;bottom:8px;}',
      '  .calculatorMobileGuide__card{padding:8px 9px calc(8px + env(safe-area-inset-bottom));border-radius:16px;}',
      '  .calculatorMobileGuide__row{gap:8px;}',
      '  .calculatorMobileGuide__hint{font-size:11px;}',
      '  .calculatorMobileGuide__name{font-size:11px;}',
      '  .calculatorMobileGuide__sub,.calculatorMobileGuide__sum{font-size:10px;}',
      '  .calculatorMobileGuide__preview{flex-basis:58px;width:58px;}',
      '  .calculatorMobileGuide__action{height:30px;padding:0 10px;font-size:11px;}',
      '}',
      '@media (max-width: 820px) and (orientation: landscape), (max-width: 820px) and (max-height: 560px){',
      '  .calculatorMobileGuide{left:8px;right:8px;bottom:8px;}',
      '  .calculatorMobileGuide__card{padding:7px 8px calc(7px + env(safe-area-inset-bottom));}',
      '  .calculatorMobileGuide__hint{font-size:11px;}',
      '  .calculatorMobileGuide__name{font-size:11px;}',
      '  .calculatorMobileGuide__sub,.calculatorMobileGuide__sum{font-size:10px;}',
      '  .calculatorMobileGuide__preview{flex-basis:58px;width:58px;}',
      '  .calculatorMobileGuide__action{height:30px;padding:0 10px;font-size:11px;}',
      '}'
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function createHostBar() {
    if (hostBar) return hostBar;
    ensureStyles();
    hostBar = doc.createElement('div');
    hostBar.className = 'calculatorMobileGuide';
    hostBar.innerHTML = '' +
      '<div class="calculatorMobileGuide__card">' +
        '<div class="calculatorMobileGuide__row">' +
          '<div class="calculatorMobileGuide__main">' +
            '<div class="calculatorMobileGuide__hint" data-role="calcGuideHint">Выберите технологию</div>' +
            '<div class="calculatorMobileGuide__nameRow">' +
              '<div class="calculatorMobileGuide__name" data-role="calcGuideName">—</div>' +
              '<div class="calculatorMobileGuide__count" data-role="calcGuideCount">0</div>' +
            '</div>' +
            '<div class="calculatorMobileGuide__sub" data-role="calcGuideSub">Цена за 1 м²: —</div>' +
            '<div class="calculatorMobileGuide__sum" data-role="calcGuideSum">Итог корзины: —</div>' +
            '<div class="calculatorMobileGuide__previews">' +
              '<div class="calculatorMobileGuide__preview is-empty" data-role="calcGuidePreviewForm">' +
                '<div class="calculatorMobileGuide__previewLabel">Форма</div>' +
                '<div class="calculatorMobileGuide__previewFrame"><img data-role="calcGuidePreviewFormImg" alt=""></div>' +
              '</div>' +
              '<div class="calculatorMobileGuide__preview is-empty" data-role="calcGuidePreviewColor">' +
                '<div class="calculatorMobileGuide__previewLabel">Цвет</div>' +
                '<div class="calculatorMobileGuide__previewFrame"><img data-role="calcGuidePreviewColorImg" alt=""></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="calculatorMobileGuide__action" data-role="calcGuideBtn">Далее</button>' +
        '</div>' +
      '</div>';
    hostBar.querySelector('[data-role="calcGuideBtn"]').addEventListener('click', handleHostActionClick);
    doc.body.appendChild(hostBar);
    return hostBar;
  }

  function setPreviewState(slot, previewState) {
    var box = hostBar.querySelector('[data-role="calcGuidePreview' + slot + '"]');
    var img = hostBar.querySelector('[data-role="calcGuidePreview' + slot + 'Img"]');
    if (!box || !img) return;
    var hasImage = !!(previewState && previewState.src && !previewState.empty);
    box.classList.toggle('is-empty', !hasImage);
    img.src = hasImage ? previewState.src : '';
    img.alt = hasImage ? (previewState.alt || '') : '';
  }

  function updateHostBarContent() {
    if (!hostBar || !mobileState) return;
    hostBar.querySelector('[data-role="calcGuideHint"]').textContent = mobileState.hint || 'Выберите технологию';
    hostBar.querySelector('[data-role="calcGuideName"]').textContent = mobileState.name || '—';
    hostBar.querySelector('[data-role="calcGuideSub"]').textContent = mobileState.sub || 'Цена за 1 м²: —';
    hostBar.querySelector('[data-role="calcGuideBtn"]').textContent = mobileState.buttonText || 'Далее';

    var countEl = hostBar.querySelector('[data-role="calcGuideCount"]');
    countEl.textContent = mobileState.count || '0';
    countEl.classList.toggle('is-visible', !!(mobileState.countVisible && mobileState.count));

    var sumEl = hostBar.querySelector('[data-role="calcGuideSum"]');
    sumEl.textContent = mobileState.cartSum || 'Итог корзины: —';
    sumEl.classList.toggle('is-visible', !!(mobileState.cartSumVisible && mobileState.cartSum));

    setPreviewState('Form', mobileState.previews && mobileState.previews.form);
    setPreviewState('Color', mobileState.previews && mobileState.previews.color);
  }

  function setHostBarVisible(visible) {
    createHostBar();
    hostBar.classList.toggle('is-visible', !!visible);
    doc.documentElement.classList.toggle(HOST_BAR_ACTIVE_CLASS, !!visible);
  }

  function refreshHostBar() {
    var visible = !!(mobileState && mobileState.visible && shellInViewport && isMobileViewport());
    if (visible) updateHostBarContent();
    setHostBarVisible(visible);
  }

  function framePageTop() {
    if (!frame || !frame.getBoundingClientRect) return 0;
    return frame.getBoundingClientRect().top + (global.pageYOffset || 0);
  }

  function postActionToFrame(action) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: FRAME_MESSAGE_HOST_ACTION, payload: { action: action, stageKey: mobileState && mobileState.stageKey || '' } }, global.location.origin);
    } catch (_) {}
  }

  function scrollToCurrentStage() {
    if (!mobileState) return;
    var targetOffset = clamp(mobileState.targetOffset, 0, 5200);
    var top = Math.max(0, framePageTop() + targetOffset - 18);
    try {
      global.scrollTo({ top: top, behavior: 'smooth' });
    } catch (_) {
      global.scrollTo(0, top);
    }
  }

  function handleHostActionClick() {
    if (!mobileState) return;
    scrollToCurrentStage();
    postActionToFrame('focus-current-stage');
    global.setTimeout(function(){ postActionToFrame('mobile-state-request'); }, 340);
  }

  function ensureDetailObserver() {
    if (detailObserver || !global.IntersectionObserver) return;
    detailObserver = new global.IntersectionObserver(function(entries){
      var shouldHideDetailCta = false;
      var shellVisibleNow = false;
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (entry.target !== shell) continue;
        shellVisibleNow = !!(entry.isIntersecting && entry.intersectionRatio >= 0.05);
        shouldHideDetailCta = !!(entry.isIntersecting && entry.intersectionRatio >= 0.18);
      }
      shellInViewport = shellVisibleNow;
      if (lastScreen === 'detail') setDetailCtaHidden(shouldHideDetailCta);
      else setDetailCtaHidden(false);
      refreshHostBar();
    }, { threshold: [0, 0.05, 0.18, 0.35, 0.55] });
    if (shell) detailObserver.observe(shell);
  }

  function createShell() {
    if (shell) return shell;
    shell = doc.createElement('section');
    shell.className = 'calculatorEmbed';
    shell.innerHTML = '' +
      '<div class="calculatorEmbed__head">' +
        '<div class="calculatorEmbed__title">Калькулятор стоимости</div>' +
      '</div>' +
      '<div class="calculatorEmbed__frameWrap">' +
        '<iframe class="calculatorEmbed__frame" title="Калькулятор стоимости" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
      '</div>';
    frame = shell.querySelector('iframe');
    frame.src = siteUrl('calculator_module/index.html?v=20260422-f24dl&embedded=1');
    frame.style.height = '960px';
    ensureDetailObserver();
    createHostBar();
    return shell;
  }

  function moveTo(screen) {
    var mount = getMount(screen);
    if (!mount) return;
    createShell();
    if (shell.parentNode !== mount) mount.appendChild(shell);
    lastScreen = screen;
    if (screen !== 'detail') setDetailCtaHidden(false);
    refreshHostBar();
  }

  function detectActiveScreen() {
    var detail = doc.getElementById('screenDetail');
    if (detail && detail.classList.contains('screen--active') && !detail.hasAttribute('hidden')) return 'detail';
    return 'catalog';
  }

  function handleMessage(event) {
    if (!event || event.origin !== global.location.origin) return;
    var data = event.data || {};
    if (data.type === FRAME_MESSAGE_HEIGHT) {
      createShell();
      frame.style.height = clamp(data.payload && data.payload.height, 960, 5200) + 'px';
      return;
    }
    if (data.type === FRAME_MESSAGE_READY) {
      createShell();
      refreshHostBar();
      return;
    }
    if (data.type === FRAME_MESSAGE_MOBILE_STATE) {
      mobileState = data.payload || null;
      refreshHostBar();
      return;
    }
    if (data.type === FRAME_MESSAGE_SUBMIT) {
      try { global.__LAST_CALCULATOR_DRAFT__ = data.payload || null; } catch (_) {}
    }
  }

  function init() {
    if (booted) return;
    if (!doc.getElementById('calculatorModuleCatalogMount') || !doc.getElementById('calculatorModuleDetailMount')) return;
    booted = true;
    moveTo(detectActiveScreen());
    global.addEventListener(EVENT_NAME, function(ev){
      var screen = ev && ev.detail && ev.detail.screen ? ev.detail.screen : detectActiveScreen();
      if (screen === 'catalog' || screen === 'detail') moveTo(screen);
      else {
        setDetailCtaHidden(false);
        shellInViewport = false;
        refreshHostBar();
      }
    });
    global.addEventListener('message', handleMessage);
    global.addEventListener('resize', refreshHostBar);
    global.addEventListener('orientationchange', refreshHostBar);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window, document);
