function getViewportMetrics() {
  const vv = (typeof window !== 'undefined' && window.visualViewport) ? window.visualViewport : null;
  const docEl = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
  const width = Math.max(
    0,
    Math.round(Number((vv && vv.width) || 0) || 0),
    Math.round(Number((typeof window !== 'undefined' && window.innerWidth) || 0) || 0),
    Math.round(Number((docEl && docEl.clientWidth) || 0) || 0),
    Math.round(Number((typeof screen !== 'undefined' && screen.width) || 0) || 0),
  );
  const height = Math.max(
    0,
    Math.round(Number((vv && vv.height) || 0) || 0),
    Math.round(Number((typeof window !== 'undefined' && window.innerHeight) || 0) || 0),
    Math.round(Number((docEl && docEl.clientHeight) || 0) || 0),
    Math.round(Number((typeof screen !== 'undefined' && screen.height) || 0) || 0),
  );
  return {
    width,
    height,
    shortSide: Math.max(0, Math.min(width || 0, height || 0)),
    longSide: Math.max(width || 0, height || 0),
  };
}

function getArEnv() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const hasChrome = /Chrome\/\d+/i.test(ua);
  const isWebView = /wv/i.test(ua) || (/Version\/\d+/i.test(ua) && hasChrome);
  const isAlt = /(EdgA|OPR|YaBrowser|SamsungBrowser|MiuiBrowser|UCBrowser|DuckDuckGo|Brave|Vivaldi|Firefox|FxiOS)/i.test(ua);
  const isChrome = isAndroid && hasChrome && !isWebView && !isAlt;
  const coarsePointer = (() => {
    try { return !!(window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches)); } catch (_) { return false; }
  })();
  const finePointer = (() => {
    try { return !!(window.matchMedia && (window.matchMedia('(pointer: fine)').matches || window.matchMedia('(any-pointer: fine)').matches)); } catch (_) { return false; }
  })();
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0) || 0;
  const metrics = getViewportMetrics();
  const hasTouch = maxTouchPoints > 0 || coarsePointer || /Mobile|Tablet|iPad|Android/i.test(ua);
  const isTabletLike = !!hasTouch && metrics.shortSide >= 700;
  const isPhoneLike = !!hasTouch && metrics.shortSide > 0 && metrics.shortSide < 700;
  const isDesktopLike = !isPhoneLike && !isTabletLike && !hasTouch && (metrics.longSide >= 900 || finePointer);
  return {
    ua,
    isAndroid,
    isChrome,
    isWebView,
    coarsePointer,
    finePointer,
    maxTouchPoints,
    hasTouch,
    viewportWidth: metrics.width,
    viewportHeight: metrics.height,
    shortSide: metrics.shortSide,
    longSide: metrics.longSide,
    isTabletLike,
    isPhoneLike,
    isDesktopLike,
  };
}

const ARCORE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.google.ar.core';
const ARCORE_ALT_URL = 'https://apkpure.com/ru/google-play-services-for-ar-2025/com.google.ar.core';

function getLocationHostname() {
  try {
    return String(window.location && window.location.hostname || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function isPrivateIpv4Hostname(hostname) {
  if (!hostname || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split('.').map((part) => parseInt(part, 10) || 0);
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

function isDevArHelpContext() {
  try {
    if (window.location && window.location.protocol === 'file:') return true;
  } catch (_) {}
  const hostname = getLocationHostname();
  if (!hostname) return false;
  return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' ||
    hostname.endsWith('.local') || hostname.endsWith('.test') || hostname.endsWith('.localhost') ||
    isPrivateIpv4Hostname(hostname);
}

function isAltArcoreSourceAllowed() {
  try {
    if (window.__ALLOW_ALT_ARCORE_SOURCE__ === true) return true;
  } catch (_) {}
  try {
    const whitelist = Array.isArray(window.__ALT_ARCORE_SOURCE_HOST_WHITELIST__)
      ? window.__ALT_ARCORE_SOURCE_HOST_WHITELIST__
      : [];
    const hostname = getLocationHostname();
    if (hostname) {
      const normalized = whitelist
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean);
      if (normalized.includes(hostname)) return true;
    }
  } catch (_) {}
  return isDevArHelpContext();
}

function makeChromeIntent(url) {
  const clean = String(url || '').replace(/^https?:\/\//i, '');
  return `intent://${clean}#Intent;scheme=https;package=com.android.chrome;end`;
}

function openInChrome(url) {
  const target = url || window.location.href;
  try {
    window.location.href = makeChromeIntent(target);
  } catch (_) {
    window.location.href = target;
  }
}

function openArcoreInstall() {
  try {
    window.location.href = 'market://details?id=com.google.ar.core';
    setTimeout(() => {
      window.open(ARCORE_PLAY_URL, '_blank');
    }, 700);
  } catch (_) {
    window.open(ARCORE_PLAY_URL, '_blank');
  }
}

function openArcoreAlt() {
  if (!isAltArcoreSourceAllowed()) {
    openArcoreInstall();
    return;
  }
  try {
    window.open(ARCORE_ALT_URL, '_blank');
  } catch (_) {
    window.location.href = ARCORE_ALT_URL;
  }
}

function ensureArHelpUI({ currentUrl } = {}) {
  if (document.getElementById('arHelpModalOverlay')) return;

  const resolvedCurrentUrl = typeof currentUrl === 'function' ? currentUrl : (() => window.location.href);

  const style = document.createElement('style');
  style.id = 'arHelpStyles';
  style.textContent = `
    .arBlocked { opacity: 0.6; filter: grayscale(0.1); }
    #arHelpModalOverlay{ position:fixed; inset:0; background:rgba(0,0,0,0.55); display:none; align-items:center; justify-content:center; z-index:99999; padding:16px; }
    #arHelpModal{ width:min(520px, 100%); background:rgba(18,18,18,0.95); color:#fff; border-radius:16px; padding:16px; box-shadow:0 10px 40px rgba(0,0,0,0.5); font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
    #arHelpTitle{ font-size:18px; font-weight:700; margin:0 0 8px 0; }
    #arHelpText{ font-size:14px; line-height:1.35; opacity:0.95; margin:0 0 12px 0; white-space:pre-line; }
    #arHelpBtns{ display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
    .arHelpBtn{ border:0; border-radius:12px; padding:10px 12px; font-weight:600; cursor:pointer; }
    .arHelpBtnPrimary{ background:#ffffff; color:#111; }
    .arHelpBtnSecondary{ background:rgba(255,255,255,0.12); color:#fff; }
    #arChromeHint{ margin-top:10px; padding:10px 12px; border-radius:12px; background:rgba(0,0,0,0.06); color:#222; font-size:13px; line-height:1.25; }
    #arChromeHint button{ margin-top:8px; width:100%; border:0; border-radius:12px; padding:10px 12px; font-weight:700; cursor:pointer; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'arHelpModalOverlay';

  const modal = document.createElement('div');
  modal.id = 'arHelpModal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'arHelpTitle');

  const title = document.createElement('div');
  title.id = 'arHelpTitle';
  title.textContent = 'Не удалось запустить AR';
  modal.appendChild(title);

  const text = document.createElement('div');
  text.id = 'arHelpText';
  modal.appendChild(text);

  const btns = document.createElement('div');
  btns.id = 'arHelpBtns';

  const btnChrome = document.createElement('button');
  btnChrome.id = 'arHelpBtnChrome';
  btnChrome.className = 'arHelpBtn arHelpBtnPrimary';
  btnChrome.type = 'button';
  btnChrome.style.display = 'none';
  btnChrome.textContent = 'Открыть в Chrome';
  btns.appendChild(btnChrome);

  const btnArcorePlay = document.createElement('button');
  btnArcorePlay.id = 'arHelpBtnArcorePlay';
  btnArcorePlay.className = 'arHelpBtn arHelpBtnSecondary';
  btnArcorePlay.type = 'button';
  btnArcorePlay.style.display = 'none';
  btnArcorePlay.textContent = 'Скачать из Play Market';
  btns.appendChild(btnArcorePlay);

  const arcoreNote = document.createElement('div');
  arcoreNote.id = 'arHelpArcoreNote';
  arcoreNote.style.display = 'none';
  arcoreNote.style.marginTop = '6px';
  arcoreNote.style.fontSize = '12px';
  arcoreNote.style.opacity = '0.85';
  arcoreNote.textContent = 'Если Play Market недоступен, скачайте напрямую по ссылке ниже.';
  btns.appendChild(arcoreNote);

  const btnArcoreAlt = document.createElement('button');
  btnArcoreAlt.id = 'arHelpBtnArcoreAlt';
  btnArcoreAlt.className = 'arHelpBtn arHelpBtnSecondary';
  btnArcoreAlt.type = 'button';
  btnArcoreAlt.style.display = 'none';
  btnArcoreAlt.textContent = 'Скачать APK (альтернативный источник)';
  btns.appendChild(btnArcoreAlt);

  const arcoreWarn = document.createElement('div');
  arcoreWarn.id = 'arHelpArcoreWarn';
  arcoreWarn.style.display = 'none';
  arcoreWarn.style.marginTop = '6px';
  arcoreWarn.style.fontSize = '11px';
  arcoreWarn.style.opacity = '0.75';
  arcoreWarn.textContent = 'Скчать в обход Play Market. Устанавливайте только если доверяете источнику.';
  btns.appendChild(arcoreWarn);

  const btnOk = document.createElement('button');
  btnOk.id = 'arHelpBtnOk';
  btnOk.className = 'arHelpBtn arHelpBtnSecondary';
  btnOk.type = 'button';
  btnOk.textContent = 'ОК';
  btns.appendChild(btnOk);

  modal.appendChild(btns);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => { overlay.style.display = 'none'; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#arHelpBtnOk').addEventListener('click', close);
  overlay.querySelector('#arHelpBtnChrome').addEventListener('click', () => openInChrome(resolvedCurrentUrl()));
  overlay.querySelector('#arHelpBtnArcorePlay').addEventListener('click', openArcoreInstall);
  overlay.querySelector('#arHelpBtnArcoreAlt').addEventListener('click', openArcoreAlt);
}

function showArHelp(kind, err, opts = {}) {
  ensureArHelpUI(opts);

  const env = getArEnv();
  const overlay = document.getElementById('arHelpModalOverlay');
  const titleEl = overlay.querySelector('#arHelpTitle');
  const textEl = overlay.querySelector('#arHelpText');
  const btnChrome = overlay.querySelector('#arHelpBtnChrome');
  const btnArcorePlay = overlay.querySelector('#arHelpBtnArcorePlay');
  const btnArcoreAlt = overlay.querySelector('#arHelpBtnArcoreAlt');
  const arcoreNote = overlay.querySelector('#arHelpArcoreNote');
  const arcoreWarn = overlay.querySelector('#arHelpArcoreWarn');
  const allowAltArcoreSource = isAltArcoreSourceAllowed();

  btnChrome.style.display = 'none';
  btnArcorePlay.style.display = 'none';
  btnArcoreAlt.style.display = 'none';
  arcoreNote.style.display = 'none';
  arcoreWarn.style.display = 'none';

  let title = 'Не удалось запустить AR';
  let msg = 'Попробуйте ещё раз.';

  if (kind === 'DESKTOP_DEVICE') {
    title = 'AR-визуализация доступна на телефоне';
    msg = 'Режим дополненной реальности и визуализации доступен на телефоне, который поддерживает ARCore.\nТехнология работает через браузер Google Chrome.\nОткройте эту ссылку через телефон.\n\nНа совместимых планшетах AR тоже может работать, если устройство поддерживает ARCore и WebXR.';
  } else if (kind === 'NEED_CHROME') {
    title = 'AR работает только в Google Chrome';
    msg = 'Откройте этот сайт в Google Chrome на Android.\nВо встроенных браузерах (Telegram/WhatsApp/и т.п.) AR обычно не запускается.';
    btnChrome.style.display = env.isAndroid ? 'inline-block' : 'none';
  } else if (kind === 'NO_WEBXR') {
    title = 'WebXR недоступен';
    msg = 'Ваш браузер не поддерживает WebXR AR.\nОткройте сайт в Google Chrome на Android.';
    btnChrome.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcorePlay.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcoreAlt.style.display = env.isAndroid && allowAltArcoreSource ? 'inline-block' : 'none';
    arcoreNote.style.display = env.isAndroid && allowAltArcoreSource ? 'block' : 'none';
    arcoreWarn.style.display = env.isAndroid && allowAltArcoreSource ? 'block' : 'none';
  } else if (kind === 'AR_NOT_SUPPORTED') {
    title = 'AR недоступен на этом устройстве';
    msg = 'Не удалось включить immersive-ar.\nУстановите/обновите Google Play Services for AR (ARCore) и попробуйте снова.\nЕсли устройство не поддерживает ARCore — AR может не запуститься.';
    btnArcorePlay.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcoreAlt.style.display = env.isAndroid && allowAltArcoreSource ? 'inline-block' : 'none';
    arcoreNote.style.display = env.isAndroid && allowAltArcoreSource ? 'block' : 'none';
    arcoreWarn.style.display = env.isAndroid && allowAltArcoreSource ? 'block' : 'none';
  } else if (kind === 'CAMERA_DENIED') {
    title = 'Нет доступа к камере';
    msg = 'Разрешите доступ к камере для браузера и для сайта, затем попробуйте снова.\n(Настройки → Приложения → Chrome → Разрешения → Камера)';
    btnChrome.style.display = env.isAndroid ? 'inline-block' : 'none';
  } else if (kind === 'AR_START_FAILED') {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return showArHelp('CAMERA_DENIED', err, opts);
    }
    if (name === 'NotSupportedError') {
      return showArHelp('AR_NOT_SUPPORTED', err, opts);
    }
    title = 'Не удалось запустить AR';
    msg = 'Попробуйте открыть сайт в Google Chrome.\nЕсли не помогает — установите/обновите ARCore.';
    btnChrome.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcorePlay.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcoreAlt.style.display = env.isAndroid && allowAltArcoreSource ? 'inline-block' : 'none';
    arcoreNote.style.display = env.isAndroid && allowAltArcoreSource ? 'block' : 'none';
    arcoreWarn.style.display = env.isAndroid && allowAltArcoreSource ? 'block' : 'none';
  }

  titleEl.textContent = title;
  textEl.textContent = msg;
  overlay.style.display = 'flex';
}

function updateArEntryUI(UI, { currentUrl } = {}) {
  const env = getArEnv();
  const btn = UI?.btnViewAR;
  if (!btn) return;
  const resolvedCurrentUrl = typeof currentUrl === 'function' ? currentUrl : (() => window.location.href);

  let hint = document.getElementById('arChromeHint');

  if (env.isAndroid && !env.isChrome) {
    btn.classList.add('arBlocked');
    btn.setAttribute('aria-disabled', 'true');

    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'arChromeHint';

      const hintText = document.createElement('div');
      const hintStrong = document.createElement('b');
      hintStrong.textContent = 'AR работает только в Google Chrome на Android.';
      hintText.appendChild(hintStrong);
      hintText.appendChild(document.createElement('br'));
      hintText.appendChild(document.createTextNode('Откройте страницу в Chrome, чтобы запустить AR.'));
      hint.appendChild(hintText);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.id = 'btnOpenInChrome';
      openBtn.textContent = 'Открыть в Chrome';
      hint.appendChild(openBtn);

      btn.parentElement?.appendChild(hint);
      openBtn.addEventListener('click', () => openInChrome(resolvedCurrentUrl()));
    } else {
      hint.style.display = '';
    }
  } else {
    btn.classList.remove('arBlocked');
    btn.removeAttribute('aria-disabled');
    if (hint) hint.style.display = 'none';
  }
}

export {
  getArEnv,
  makeChromeIntent,
  openInChrome,
  openArcoreInstall,
  openArcoreAlt,
  ensureArHelpUI,
  showArHelp,
  updateArEntryUI,
};
