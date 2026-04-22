(function(global, doc){
  'use strict';

  var EVENT_NAME = 'ag:screen-change';
  var FRAME_MESSAGE_HEIGHT = 'ag-calc-height';
  var FRAME_MESSAGE_READY = 'ag-calc-ready';
  var FRAME_MESSAGE_SUBMIT = 'ag-calc-submit-ready';
  var HIDDEN_CTA_CLASS = 'detailCta--calculatorHidden';
  var frame = null;
  var shell = null;
  var detailCta = null;
  var detailObserver = null;
  var booted = false;
  var lastScreen = 'catalog';

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

  function ensureDetailObserver() {
    if (detailObserver || !global.IntersectionObserver) return;
    detailObserver = new global.IntersectionObserver(function(entries){
      if (lastScreen !== 'detail') {
        setDetailCtaHidden(false);
        return;
      }
      var shouldHide = false;
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (entry.target !== shell) continue;
        shouldHide = !!(entry.isIntersecting && entry.intersectionRatio >= 0.18);
      }
      setDetailCtaHidden(shouldHide);
    }, { threshold: [0, 0.18, 0.35, 0.55] });
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
    frame.src = siteUrl('calculator_module/index.html?v=20260422-f24dk');
    frame.style.height = '960px';
    ensureDetailObserver();
    return shell;
  }

  function moveTo(screen) {
    var mount = getMount(screen);
    if (!mount) return;
    createShell();
    if (shell.parentNode !== mount) mount.appendChild(shell);
    lastScreen = screen;
    if (screen !== 'detail') setDetailCtaHidden(false);
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
      else setDetailCtaHidden(false);
    });
    global.addEventListener('message', handleMessage);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window, document);
