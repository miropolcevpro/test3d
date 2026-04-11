function getArEnv() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const hasChrome = /Chrome\/\d+/i.test(ua);
  const isWebView = /\bwv\b/i.test(ua) || (/Version\/\d+/i.test(ua) && hasChrome);
  const isAlt = /(EdgA|OPR|YaBrowser|SamsungBrowser|MiuiBrowser|UCBrowser|DuckDuckGo|Brave|Vivaldi|Firefox|FxiOS)/i.test(ua);
  const isChrome = isAndroid && hasChrome && !isWebView && !isAlt;
  return { ua, isAndroid, isChrome, isWebView };
}

const ARCORE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.google.ar.core';
const ARCORE_ALT_URL = 'https://apkpure.com/ru/google-play-services-for-ar-2025/com.google.ar.core';

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
  overlay.innerHTML = `
    <div id="arHelpModal" role="dialog" aria-modal="true" aria-labelledby="arHelpTitle">
      <div id="arHelpTitle">Не удалось запустить AR</div>
      <div id="arHelpText"></div>
      <div id="arHelpBtns">
        <button id="arHelpBtnChrome" class="arHelpBtn arHelpBtnPrimary" style="display:none;">Открыть в Chrome</button>
        <button id="arHelpBtnArcorePlay" class="arHelpBtn arHelpBtnSecondary" style="display:none;">Скачать из Play Market</button>
        <div id="arHelpArcoreNote" style="display:none; margin-top:6px; font-size:12px; opacity:0.85;">Если Play Market недоступен, скачайте напрямую по ссылке ниже.</div>
        <button id="arHelpBtnArcoreAlt" class="arHelpBtn arHelpBtnSecondary" style="display:none;">Скачать APK (альтернативный источник)</button>
        <div id="arHelpArcoreWarn" style="display:none; margin-top:6px; font-size:11px; opacity:0.75;">Скчать в обход Play Market. Устанавливайте только если доверяете источнику.</div>
        <button id="arHelpBtnOk" class="arHelpBtn arHelpBtnSecondary">ОК</button>
      </div>
    </div>
  `;
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

  btnChrome.style.display = 'none';
  btnArcorePlay.style.display = 'none';
  btnArcoreAlt.style.display = 'none';
  arcoreNote.style.display = 'none';
  arcoreWarn.style.display = 'none';

  let title = 'Не удалось запустить AR';
  let msg = 'Попробуйте ещё раз.';

  if (kind === 'NEED_CHROME') {
    title = 'AR работает только в Google Chrome';
    msg = 'Откройте этот сайт в Google Chrome на Android.\nВо встроенных браузерах (Telegram/WhatsApp/и т.п.) AR обычно не запускается.';
    btnChrome.style.display = env.isAndroid ? 'inline-block' : 'none';
  } else if (kind === 'NO_WEBXR') {
    title = 'WebXR недоступен';
    msg = 'Ваш браузер не поддерживает WebXR AR.\nОткройте сайт в Google Chrome на Android.';
    btnChrome.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcorePlay.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcoreAlt.style.display = env.isAndroid ? 'inline-block' : 'none';
    arcoreNote.style.display = env.isAndroid ? 'block' : 'none';
    arcoreWarn.style.display = env.isAndroid ? 'block' : 'none';
  } else if (kind === 'AR_NOT_SUPPORTED') {
    title = 'AR недоступен на этом устройстве';
    msg = 'Не удалось включить immersive-ar.\nУстановите/обновите Google Play Services for AR (ARCore) и попробуйте снова.\nЕсли устройство не поддерживает ARCore — AR может не запуститься.';
    btnArcorePlay.style.display = env.isAndroid ? 'inline-block' : 'none';
    btnArcoreAlt.style.display = env.isAndroid ? 'inline-block' : 'none';
    arcoreNote.style.display = env.isAndroid ? 'block' : 'none';
    arcoreWarn.style.display = env.isAndroid ? 'block' : 'none';
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
    btnArcoreAlt.style.display = env.isAndroid ? 'inline-block' : 'none';
    arcoreNote.style.display = env.isAndroid ? 'block' : 'none';
    arcoreWarn.style.display = env.isAndroid ? 'block' : 'none';
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
      hint.innerHTML = `
        <div><b>AR работает только в Google Chrome на Android.</b><br/>Откройте страницу в Chrome, чтобы запустить AR.</div>
        <button type="button" id="btnOpenInChrome">Открыть в Chrome</button>
      `;
      btn.parentElement?.appendChild(hint);
      hint.querySelector('#btnOpenInChrome')?.addEventListener('click', () => openInChrome(resolvedCurrentUrl()));
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
