// BUILD: v28 2026-01-16f (runtime-config)
const __BUILD_ID__ = "20260422-f24dw";
console.log("[Admin] build", __BUILD_ID__);
/* Admin (Step 3 start) — shapes list + shape details (read-only palette), router scaffold */
(async () => {
  const runtimeConfig = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
  const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'admin_jwt';
  const contentIdentity = (typeof window !== 'undefined' && window.__CONTENT_IDENTITY__) ? window.__CONTENT_IDENTITY__ : null;
  const telemetry = (typeof window !== 'undefined' && window.__APP_TELEMETRY__) ? window.__APP_TELEMETRY__ : null;
  function telemetryTrack(name, props = {}) { try { telemetry && telemetry.track && telemetry.track(name, props); } catch (_) {} }
  function telemetryPage(name, props = {}) { try { telemetry && telemetry.trackPageView && telemetry.trackPageView(name, props); } catch (_) {} }
  function telemetryError(name, err, props = {}) { try { telemetry && telemetry.trackError && telemetry.trackError(name, err, props); } catch (_) {} }

  // Remote runtime config (safe, non-breaking):
  // - Tries to GET ${API_BASE_URL}/api/config
  // - On success sets window.BUCKET_BASE_URL (and a couple of optional overrides)
  // - On failure does NOTHING (falls back to current hardcoded defaults)
  async function tryLoadRemoteConfig() {
    if (!API_BASE_URL) return null;
    // Prefer public config (no JWT). If gateway does not expose it, we fall back to /api/config.
    const base = API_BASE_URL.replace(/\/+$/, '');
    const urls = [base + '/config', base + '/api/config'];
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = setTimeout(() => {
      try { controller && controller.abort(); } catch {}
    }, 1500);
    try {
      for (const url of urls) {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: controller ? controller.signal : undefined,
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data || data.ok !== true) continue;
        return data;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function applyRemoteConfig(cfg) {
    try {
      // Preferred new shape (stable)
      if (cfg && cfg.public) {
        if (cfg.public.bucketBaseUrl) {
          window.BUCKET_BASE_URL = String(cfg.public.bucketBaseUrl).replace(/\/+$/, '/') ;
        }
        // Optional: allow overriding these for future use without hardcoding.
        if (cfg.public.palettesBaseUrl) window.PALETTES_BASE_URL = String(cfg.public.palettesBaseUrl).replace(/\/+$/, '');
        if (cfg.public.surfacesPublicBaseUrl) window.SURFACES_PUBLIC_BASE_URL = String(cfg.public.surfacesPublicBaseUrl).replace(/\/+$/, '');
      }
      // Optional: expose build in console for debugging.
      if (cfg && cfg.build) {
        const b = (cfg.build.api || cfg.build).toString();
        if (b) console.log('[Admin] backend build', b);
      }
    } catch {}
  }

  // Do not block UI on config longer than the timeout.
  // If API Gateway does not expose /api/config yet, this will silently noop.
  const remoteCfg = await tryLoadRemoteConfig();
  if (remoteCfg) applyRemoteConfig(remoteCfg);

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  async function setToken(t) {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  async function apiFetch(path, opts = {}) {
    const url = API_BASE_URL + path;
    const headers = new Headers(opts.headers || {});
    headers.set('Accept', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');

    const res = await fetch(url, { cache: 'no-store', ...opts, headers, cache: 'no-store' });

    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) json = await res.json().catch(() => null);
    else {
      const bodyText = await res.text().catch(() => '');
      json = bodyText ? { message: bodyText } : null;
    }

    if (!res.ok) {
      const msg = json?.message || json?.error || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json;
  }

  function buildQueryString(obj = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(obj || {})) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  async function apiFetchFirstAvailable(candidates = []) {
    let lastErr = null;
    for (const entry of candidates) {
      if (!entry || !entry.path) continue;
      try {
        return await apiFetch(entry.path, entry.opts || {});
      } catch (err) {
        lastErr = err;
        const status = Number(err?.status || 0);
        if (status && ![404, 405, 501].includes(status)) break;
      }
    }
    throw lastErr || new Error('API endpoint not available');
  }

  async function apiGetConfig() {
    const cfg = await tryLoadRemoteConfig();
    if (cfg) return cfg;
    return apiFetch('/api/config');
  }

  async function fallbackSyncTexture(shapeId, textureId) {
    const canonicalId = canonicalTextureId(shapeId, textureId);
    await ensureBucketIndexLoaded(shapeId, { forceReload: true });
    const idx = state.bucketIndexByShapeId.get(shapeId) || { textures: [] };
    const textures = Array.isArray(idx?.textures) ? idx.textures : [];
    const bucketTex = textures.find((t) => canonicalTextureId(shapeId, t?.textureId || t?.id || '') === canonicalId);
    if (!bucketTex) {
      throw new Error(`Текстура "${canonicalId}" не найдена в бакете surfaces/${shapeId}/.`);
    }
    if (isBucketTextureBroken(bucketTex)) {
      throw new Error(`Текстура "${canonicalId}" неполная в бакете: нужны albedo + normal + roughness + height в 1k.`);
    }

    const palette = await ensurePaletteLoaded(shapeId, { forceReload: true });
    const items = Array.isArray(palette?.items) ? palette.items : [];
    const existing = items.find((item) => canonicalTextureId(shapeId, item?.id || item?.textureId || '') === canonicalId) || null;
    const synced = buildPaletteItemFromBucket(shapeId, canonicalId, bucketTex);
    const merged = {
      ...synced,
      ...(existing && typeof existing === 'object' ? { name: existing.name || synced.name } : {}),
      tileSizeM: existing?.tileSizeM || synced.tileSizeM,
      params: (existing && typeof existing.params === 'object' && existing.params) ? { ...existing.params } : {},
    };
    await upsertItemAndSavePalette(shapeId, merged);
    return { ok: true, fallback: true, paletteResult: { upserted: 1 } };
  }

  async function apiSyncTexture(shapeId, textureId) {
    const sid = encodeURIComponent(shapeId || '');
    const tid = encodeURIComponent(canonicalTextureId(shapeId, textureId));
    try {
      return await apiFetchFirstAvailable([
        { path: `/api/textures/${sid}/${tid}/sync`, opts: { method: 'POST' } },
        { path: `/api/surfaces/${sid}/${tid}/sync`, opts: { method: 'POST' } },
        { path: `/api/textures/${sid}/${tid}`, opts: { method: 'POST', body: JSON.stringify({ action: 'sync' }) } },
      ]);
    } catch (err) {
      const status = Number(err?.status || 0);
      if (status && ![404, 405, 501].includes(status)) throw err;
      return fallbackSyncTexture(shapeId, textureId);
    }
  }

  async function fallbackDeleteTexture(shapeId, textureId, { palette = true, files = false } = {}) {
    if (!palette) {
      throw new Error('Удаление файлов без backend DELETE API недоступно. Палитра не изменялась.');
    }
    const paletteDoc = await ensurePaletteLoaded(shapeId, { forceReload: true });
    const items = Array.isArray(paletteDoc?.items) ? [...paletteDoc.items] : [];
    const canonicalId = canonicalTextureId(shapeId, textureId);
    const nextItems = items.filter((item) => canonicalTextureId(shapeId, item?.id || item?.textureId || '') !== canonicalId);
    const removed = items.length - nextItems.length;
    if (removed <= 0) {
      throw new Error(`Текстура "${canonicalId}" не найдена в палитре формы "${shapeId}".`);
    }
    const nextPalette = { ...(paletteDoc && typeof paletteDoc === 'object' ? paletteDoc : {}), shapeId, items: nextItems };
    await savePalette(shapeId, nextPalette);
    return {
      ok: true,
      fallback: true,
      paletteResult: { removed },
      filesResult: {
        deletedObjects: 0,
        deletedPrefixes: [],
        deleteErrors: files ? [{ reason: 'delete_api_unavailable', textureId: canonicalId }] : [],
      },
      message: files
        ? 'Текстура удалена из палитры. Backend DELETE API для удаления файлов бакета недоступен, поэтому файлы surfaces/... не удалялись.'
        : 'Текстура удалена из палитры.',
    };
  }

  async function apiDeleteTexture(shapeId, textureId, { palette = true, files = true } = {}) {
    const sid = encodeURIComponent(shapeId || '');
    const tid = encodeURIComponent(canonicalTextureId(shapeId, textureId));
    const qs = buildQueryString({ palette: palette ? 1 : 0, files: files ? 1 : 0 });
    try {
      return await apiFetchFirstAvailable([
        { path: `/api/textures/${sid}/${tid}${qs}`, opts: { method: 'DELETE' } },
        { path: `/api/surfaces/${sid}/${tid}${qs}`, opts: { method: 'DELETE' } },
        { path: `/api/textures/${sid}/${tid}/delete`, opts: { method: 'POST', body: JSON.stringify({ palette, files }) } },
        { path: `/api/surfaces/${sid}/${tid}/delete`, opts: { method: 'POST', body: JSON.stringify({ palette, files }) } },
      ]);
    } catch (err) {
      const status = Number(err?.status || 0);
      if (status && ![404, 405, 501].includes(status)) throw err;
      return fallbackDeleteTexture(shapeId, textureId, { palette, files });
    }
  }

  // In GitHub Pages the admin lives under /<repo>/admin/, while site assets are under /<repo>/assets/.
  // Resolve any relative asset paths (e.g. "assets/forms/klassika.png") against the site root ("/<repo>/").
  const SITE_BASE_URL = (() => {
    const siteEnv = (typeof window !== 'undefined' && window.__SITE_ENV__) ? window.__SITE_ENV__ : null;
    if (siteEnv && siteEnv.siteBaseUrl) return siteEnv.siteBaseUrl;
    const basePath = window.location.pathname.replace(/\/admin\/.*$/, '/');
    return window.location.origin + basePath;
  })();

  function resolveSiteUrl(u) {
    if (!u) return '';
    const siteEnv = (typeof window !== 'undefined' && window.__SITE_ENV__) ? window.__SITE_ENV__ : null;
    if (siteEnv && typeof siteEnv.resolveSiteUrl === 'function') return siteEnv.resolveSiteUrl(u);
    try {
      return new URL(u, SITE_BASE_URL).toString();
    } catch {
      return u;
    }
  }

  function buildArCalibrationUrl(shapeId, itemId) {
    const url = new URL(resolveSiteUrl('index.html'));
    url.searchParams.set('admin_ar', '1');
    if (shapeId) url.searchParams.set('shape', String(shapeId));
    if (itemId) url.searchParams.set('texture', String(itemId));
    return url.toString();
  }

  // Bucket base for palette assets (maps, previews). Can be overridden in admin/config.js:
  //   window.BUCKET_BASE_URL = "https://storage.yandexcloud.net/webar3dtexture/";
  const BUCKET_BASE_URL = (window.BUCKET_BASE_URL || (runtimeConfig && runtimeConfig.defaults && runtimeConfig.defaults.bucketBaseUrl) || 'https://storage.yandexcloud.net/webar3dtexture/').replace(/\/+$/, '/') ;

  // Canonical textureId handling
  // Bucket folder naming convention: surfaces/<shapeId>/<textureId>/...
  // IMPORTANT: <textureId> MUST NOT contain the <shapeId> prefix.
  // We normalize legacy IDs:
  //   - "klassika:paver_..." -> "paver_..."
  //   - "klassika_paver_..." -> "paver_..."
  // and sanitize any remaining ":" to "_".
  function canonicalTextureId(shapeId, anyId) {
    if (contentIdentity && typeof contentIdentity.canonicalStorageTextureId === 'function') {
      return normalizeTextureId(contentIdentity.canonicalStorageTextureId(shapeId, anyId), shapeId);
    }
    return normalizeTextureId(anyId, shapeId);
  }

  function normalizePathLike(shapeId, v) {
    if (!v) return v;
    const sid = String(shapeId || '').trim();
    let s = contentIdentity && typeof contentIdentity.normalizeContentPath === 'function'
      ? contentIdentity.normalizeContentPath(v)
      : String(v).trim();
    if (!s) return s;
    if (!s.includes('/') && s.includes(':')) return '';
    if (!sid) return s;
    s = s.replace(new RegExp('surfaces/' + sid + '/' + sid + '[_:]', 'g'), 'surfaces/' + sid + '/');
    return s;
  }

  function normalizePaletteForUi(shapeId, palette) {
    if (!palette || typeof palette !== 'object') return palette;
    const items = Array.isArray(palette.items) ? palette.items : [];
    const byId = new Map();
    const score = (obj) => {
      let sc = 0;
      if (obj && typeof obj === 'object') {
        if (obj.name) sc += 1;
        if (obj.preview) sc += 1;
        if (obj.tileSizeM) sc += 1;
        if (obj.params && Object.keys(obj.params).length) sc += 2;
        if (obj.maps && Object.keys(obj.maps).length) sc += 3;
      }
      return sc;
    };

    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const id0 = it.id || it.textureId || '';
      const id = canonicalTextureId(shapeId, id0);
      if (!id) continue;

      const next = { ...it, id };
      if ('preview' in next) next.preview = normalizePathLike(shapeId, next.preview);
      if (next.maps && typeof next.maps === 'object') {
        const maps = { ...next.maps };
        for (const k of Object.keys(maps)) maps[k] = normalizePathLike(shapeId, maps[k]);
        next.maps = maps;
      }

      const prev = byId.get(id);
      if (!prev) byId.set(id, next);
      else byId.set(id, score(next) >= score(prev) ? next : prev);
    }

    palette.items = Array.from(byId.values());
    return palette;
  }


  

function resolveMediaUrl(u, opts = {}) {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';

  // Absolute URL
  if (/^https?:\/\//i.test(s)) return s;

  // Site assets
  if (s.startsWith('assets/')) return resolveSiteUrl(s);

  // Block legacy/garbage identifiers early ("klassika:paver...")
  // These are not valid bucket-relative paths and may trigger ORB/CORB in Chrome when used as <img src>.
  if (s.includes(':') && !s.startsWith('surfaces/') && !s.startsWith('palettes/') && !s.startsWith('shape_settings/') && !s.startsWith('palette_settings/')) {
    return '';
  }

  // Bare filename. Only reconstruct when we have strong context and the name looks safe.
  if (!s.includes('/')) {
    // Reject suspicious names (e.g. containing ':' or query/hash)
    if (s.includes(':')) return '';
    if (/[?#]/.test(s)) return '';

    const shapeId = opts.shapeId || '';
    const textureId = opts.textureId || '';
    const quality = opts.quality || '1k';
    if (shapeId && textureId) {
      const tid = canonicalTextureId(shapeId, textureId);
      return new URL(`surfaces/${shapeId}/${tid}/${quality}/${s}`, BUCKET_BASE_URL).toString();
    }
    // As a defensive fallback, treat it as a bucket-root object. This prevents
    // the browser from requesting it from the GitHub Pages origin (which often
    // returns HTML and triggers ORB in Chrome).
    return new URL(s, BUCKET_BASE_URL).toString();
  }

  // Bucket-relative paths (surfaces/..., palettes/..., shape_settings/...)
  return new URL(s.replace(/^\/+/, ''), BUCKET_BASE_URL).toString();
}


function normalizeAdminSafeUrl(value, options = {}) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/[\x00-\x1F\x7F]/.test(raw)) return '';

  const allowBlob = options.allowBlob === true;
  const allowDataImage = options.allowDataImage === true;

  if (/^blob:/i.test(raw)) return allowBlob ? raw : '';
  if (/^data:/i.test(raw)) {
    if (!allowDataImage) return '';
    return /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml);/i.test(raw) ? raw : '';
  }

  try {
    const baseUrl = options.baseUrl || SITE_BASE_URL;
    const parsed = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? new URL(raw) : new URL(raw, baseUrl);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') return parsed.toString();
    if (protocol === 'blob:' && allowBlob) return parsed.toString();
    return '';
  } catch {
    return '';
  }
}

function setAdminSafeImageSource(img, value, options = {}) {
  if (!img) return false;
  const safeUrl = normalizeAdminSafeUrl(value, options);
  if (!safeUrl) {
    try {
      img.removeAttribute('src');
      delete img.dataset.safeSrc;
      img.dataset.invalidSrc = '1';
    } catch {}
    return false;
  }
  try {
    delete img.dataset.invalidSrc;
    img.dataset.safeSrc = safeUrl;
    img.src = safeUrl;
  } catch {
    return false;
  }
  return true;
}

function formatAdminErrorMessage(err, fallback = 'Неизвестная ошибка') {
  const raw = String(err?.message || err || '').trim();
  if (!raw) return fallback;
  if (raw === 'preview_url_empty') return 'Для выбранной текстуры не найден preview/albedo.';
  if (raw === 'preview_url_unsafe') return 'URL превью не прошёл проверку безопасности.';
  if (raw === 'preview_image_load_failed') return 'Файл превью не удалось загрузить.';
  if (raw === 'upload_cancelled') return 'Операция отменена пользователем.';
  if (raw === 'item_not_found_in_palette') return 'Текстура не найдена в палитре. Обновите список и повторите попытку.';
  if (raw === 'map_modal_not_found') return 'Не удалось открыть окно сопоставления карт.';
  return raw;
}

function describeAdminPreviewProblem(sourceValue, safeUrl, err) {
  const rawSource = String(sourceValue || '').trim();
  const rawMessage = String(err?.message || err || '').trim();
  if (!rawSource) {
    return {
      title: 'Превью недоступно',
      message: 'Для этой текстуры в палитре не найден preview/albedo.',
      note: 'Параметры всё равно можно сохранить. Для визуального контроля добавьте preview или albedo в палитру/бакет.',
    };
  }
  if (!safeUrl || rawMessage === 'preview_url_unsafe') {
    return {
      title: 'Превью заблокировано',
      message: 'URL превью не прошёл безопасную проверку и не был открыт в админке.',
      note: 'Проверьте preview/albedo URL в палитре и убедитесь, что ссылка ведёт на допустимый ресурс.',
    };
  }
  if (rawMessage === 'preview_image_load_failed') {
    return {
      title: 'Превью не загрузилось',
      message: 'Файл превью найден, но браузер не смог его открыть.',
      note: 'Проверьте, что albedo действительно доступна по URL и возвращает изображение, а не HTML/ошибку доступа.',
    };
  }
  return {
    title: 'Превью недоступно',
    message: formatAdminErrorMessage(err, 'Не удалось подготовить превью.'),
    note: 'Параметры можно сохранить и без превью, но стоит проверить albedo/preview для этой текстуры.',
  };
}

async function syncTexturesBatch(shapeId, textureIds) {
  const ids = Array.from(new Set((Array.isArray(textureIds) ? textureIds : []).map((v) => String(v || '').trim()).filter(Boolean)));
  const summary = { requested: ids.length, synced: 0, fallback: 0, failed: 0, failures: [] };
  for (const tid of ids) {
    try {
      const res = await apiSyncTexture(shapeId, tid);
      summary.synced += 1;
      if (res?.fallback) summary.fallback += 1;
    } catch (e) {
      summary.failed += 1;
      summary.failures.push({ textureId: tid, message: formatAdminErrorMessage(e, 'Не удалось синхронизировать текстуру.') });
    }
  }
  return summary;
}


function createAdminNode(tag, options = {}) {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.text != null) el.textContent = String(options.text);
  if (options.title != null) el.title = String(options.title);
  if (options.hidden === true) el.hidden = true;
  if (options.attrs && typeof options.attrs === 'object') {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value == null) return;
      el.setAttribute(key, String(value));
    });
  }
  if (options.dataset && typeof options.dataset === 'object') {
    Object.entries(options.dataset).forEach(([key, value]) => {
      if (value == null) return;
      el.dataset[key] = String(value);
    });
  }
  return el;
}

function appendAdminChildren(target, ...children) {
  children.flat(Infinity).forEach((child) => {
    if (child == null) return;
    if (typeof child === 'string' || typeof child === 'number') target.append(document.createTextNode(String(child)));
    else target.appendChild(child);
  });
  return target;
}

function createAdminPanelItem(label, value) {
  const row = createAdminNode('div', { className: 'telemetryPanel__item' });
  const labelEl = createAdminNode('span', { text: label == null ? '—' : label });
  const valueEl = createAdminNode('b', { text: value == null ? '—' : value });
  appendAdminChildren(row, labelEl, valueEl);
  return row;
}

function createAdminHint(className, text) {
  return createAdminNode('div', { className, text });
}

function createTelemetryBadge(className, text) {
  return createAdminNode('span', { className, text });
}

function pickMediaUrl(candidates, opts) {
    const arr = Array.isArray(candidates) ? candidates : [candidates];
    for (const c of arr) {
      const url = resolveMediaUrl(c, opts);
      if (url) return url;
    }
    return '';
  }

  const $ = (id) => document.getElementById(id);

  // Auth / common
  const elLoginCard = $('loginCard');
  const elMainCard = $('mainCard');
  const elLoginUser = $('loginUser');
  const elLoginPass = $('loginPass');
  const elBtnLogin = $('btnLogin');
  const elBtnLogout = $('btnLogout');
  const elLoginStatus = $('loginStatus');
  const elLinkPaletteValidator = $('linkPaletteValidator');
  const elStatus = $('status');
  const elReload = $('reloadBtn');
  const elBtnOpenTelemetry = $('btnOpenTelemetry');
  const elBtnOpenTelemetryInline = $('btnOpenTelemetryInline');
  const elTelemetryModal = $('telemetryModal');
  const elTelemetryModalCloseBtn = $('telemetryModalCloseBtn');
  const elTelemetryCard = $('telemetryCard');
  const elTelemetryStatus = $('telemetryStatus');
  const elTelemetrySources = $('telemetrySources');
  const elTelemetryStats = $('telemetryStats');
  const elTelemetryAudience = $('telemetryAudience');
  const elTelemetryKpis = $('telemetryKpis');
  const elTelemetryDynamics = $('telemetryDynamics');
  const elTelemetryBreakdown = $('telemetryBreakdown');
  const elTelemetryFunnel = $('telemetryFunnel');
  const elTelemetryDevices = $('telemetryDevices');
  const elTelemetryList = $('telemetryList');
  const elTelemetryRefreshBtn = $('telemetryRefreshBtn');
  const elTelemetryFlushBtn = $('telemetryFlushBtn');
  const elTelemetryExportBtn = $('telemetryExportBtn');
  const elTelemetryClearBtn = $('telemetryClearBtn');
  const elTelemetryPeriodSelect = $('telemetryPeriodSelect');
  const elTelemetryDeviceSelect = $('telemetryDeviceSelect');
  const elTelemetryErrorReportModal = $('telemetryErrorReportModal');
  const elTelemetryErrorReportModalCloseBtn = $('telemetryErrorReportModalCloseBtn');
  const elTelemetryErrorReportCard = $('telemetryErrorReportCard');
  const elTelemetryErrorReportStatus = $('telemetryErrorReportStatus');
  const elTelemetryErrorReportRefreshBtn = $('telemetryErrorReportRefreshBtn');
  const elTelemetryErrorReportClearBtn = $('telemetryErrorReportClearBtn');
  const elTelemetryErrorReportCsvBtn = $('telemetryErrorReportCsvBtn');
  const elTelemetryErrorReportJsonBtn = $('telemetryErrorReportJsonBtn');
  const elTelemetryErrorSeveritySelect = $('telemetryErrorSeveritySelect');
  const elTelemetryErrorCategorySelect = $('telemetryErrorCategorySelect');
  const elTelemetryErrorSourceSelect = $('telemetryErrorSourceSelect');
  const elTelemetryErrorReportSummary = $('telemetryErrorReportSummary');
  const elTelemetryErrorReportList = $('telemetryErrorReportList');

  // Views
  const elViewShapes = $('viewShapes');
  const elShapesGrid = $('shapesGrid');
  const elShapesEmpty = $('shapesEmpty');
  const elShapeSearch = $('shapeSearch');

  const elViewShape = $('viewShape');
  const elBackBtn = $('backBtn');
  const elShapeHeader = $('shapeHeader');
  const elShapeTitle = $('shapeTitle');
  const elShapeTabs = $('shapeTabs');
  const elPaneTextures = $('paneTextures');
  const elPaneUpload = $('paneUpload');
  const elPaneSettings = $('paneSettings');
  const elBtnUploadGo = $('btnUploadGo');
  const elBtnPaletteSave = $('btnPaletteSave');
  const elPaletteStatus = $('paletteStatus');

  // Upload UI
  const elUploadTextureId = $('uploadTextureId');
  const elUploadTextureName = $('uploadTextureName');
  const elUploadQuality = $('uploadQuality');
  const elUploadConcurrency = $('uploadConcurrency');
  const elUploadTileW = $('uploadTileW');
  const elUploadTileH = $('uploadTileH');
  const elUploadAutoAdd = $('uploadAutoAdd');
  const elUploadFiles = $('uploadFiles');
  const elUploadZip = $('uploadZip');
  const elUploadStartBtn = $('uploadStartBtn');
  const elUploadClearBtn = $('uploadClearBtn');
  const elUploadStatus = $('uploadStatus');
  const elUploadTbody = $('uploadTbody');

  // Palette settings UI
  const elSettingsStatus = $('settingsStatus');
  const elBtnSettingsReload = $('btnSettingsReload');
  const elBtnSettingsReset = $('btnSettingsReset');
  const elBtnSettingsSave = $('btnSettingsSave');
  const elSettingsTileW = $('settingsTileW');
  const elSettingsTileH = $('settingsTileH');
  const elSettingsUvScale = $('settingsUvScale');
  const elSettingsExposure = $('settingsExposure');
  const elSettingsContrast = $('settingsContrast');
  const elSettingsSaturation = $('settingsSaturation');
  const elSettingsRoughness = $('settingsRoughness');
  const elSettingsSpec = $('settingsSpec');
  const elSettingsNormalScale = $('settingsNormalScale');
  const elSettingsBumpScale = $('settingsBumpScale');

  const elTexturesGrid = $('texturesGrid');
  const elEmptyTextures = $('emptyState');

  // Bucket textures library
  const elBucketFilter = $('bucketFilter');
  const elBucketReload = $('bucketReloadBtn');
  const elBucketStatus = $('bucketStatus');
  const elBucketGrid = $('bucketTexturesGrid');
  const elBucketEmpty = $('bucketEmpty');

  // Bulk edit UI (textures)
  const elBulkBar = $('bulkBar');
  const elBulkSelectAll = $('bulkSelectAll');
  const elBulkSelectedCount = $('bulkSelectedCount');
  const elBulkClearBtn = $('bulkClearBtn');
  const elBulkResetBtn = $('bulkResetBtn');
  const elBulkEditBtn = $('bulkEditBtn');

  // Bulk modal
  const elBulkModal = $('bulkModal');
  const elBulkModalTitle = $('bulkModalTitle');
  const elBulkModalSubtitle = $('bulkModalSubtitle');
  const elBulkModalStatus = $('bulkModalStatus');
  const elBulkModalCloseBtn = $('bulkModalCloseBtn');
  const elBulkApplyTarget = $('bulkApplyTarget');
  const elBulkSourceTexture = $('bulkSourceTexture');
  const elBulkFillDefaultsBtn = $('bulkFillDefaultsBtn');
  const elBulkCopyFromTextureBtn = $('bulkCopyFromTextureBtn');
  const elBulkApplyTileSize = $('bulkApplyTileSize');
  const elBulkTileW = $('bulkTileW');
  const elBulkTileH = $('bulkTileH');
  const elBulkParams = $('bulkParams');
  const elBulkResetOverridesBtn = $('bulkResetOverridesBtn');
  const elBulkApplyBtn = $('bulkApplyBtn');

  // Modal: ZIP mapping
  const elMapModal = $('mapModal');
  const elMapModalTitle = $('mapModalTitle');
  const elMapModalSubtitle = $('mapModalSubtitle');
  const elMapModalHint = $('mapModalHint');
  const elMapTbody = $('mapTbody');
  const elMapModalStatus = $('mapModalStatus');
  const elMapModalApplyBtn = $('mapModalApplyBtn');
  const elMapModalCancelBtn = $('mapModalCancelBtn');
  const elMapModalCloseBtn = $('mapModalCloseBtn');

  // Modal: texture params
  const elTexModal = $('texModal');
  const elTexModalTitle = $('texModalTitle');
  const elTexModalSubtitle = $('texModalSubtitle');
  const elTexModalStatus = $('texModalStatus');
  const elTexModalCloseBtn = $('texModalCloseBtn');
  const elTexParams = $('texParams');
  const elTexPreview = $('texPreview');
  const elTexPreviewHint = $('texPreviewHint');
  const elTexCanvasBefore = $('texCanvasBefore');
  const elTexCanvasAfter = $('texCanvasAfter');
  const elTexResetBtn = $('texResetBtn');
  const elTexRevertBtn = $('texRevertBtn');
  const elTexSaveBtn = $('texSaveBtn');
  const elTexOpenArCalibBtn = $('texOpenArCalibBtn');

  // Modal: confirm destructive action
  const elConfirmModal = $('confirmModal');
  const elConfirmModalTitle = $('confirmModalTitle');
  const elConfirmModalSubtitle = $('confirmModalSubtitle');
  const elConfirmModalMessage = $('confirmModalMessage');
  const elConfirmModalDetails = $('confirmModalDetails');
  const elConfirmModalStatus = $('confirmModalStatus');
  const elConfirmModalCloseBtn = $('confirmModalCloseBtn');
  const elConfirmModalCancelBtn = $('confirmModalCancelBtn');
  const elConfirmModalConfirmBtn = $('confirmModalConfirmBtn');

  const visualParamTelemetryTimers = new Map();
  let telemetryErrorReportState = null;
  let telemetryErrorReportFiltersState = { severity: 'all', category: 'all', source: 'all' };

  function scheduleVisualParamTelemetry(name, props = {}) {
    const key = `${String(name || 'event')}|${String(props.shapeId || '')}|${String(props.textureId || '')}|${String(props.param || '')}`;
    const prev = visualParamTelemetryTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      visualParamTelemetryTimers.delete(key);
      telemetryTrack(name, props);
    }, 250);
    visualParamTelemetryTimers.set(key, timer);
  }

  /** @type {{ shapes: any[], paletteByShapeId: Map<string, any> }} */
  const state = {
    shapes: [],
    paletteByShapeId: new Map(),
    paletteSettingsByShapeId: new Map(),
    bucketIndexByShapeId: new Map(),
    uploadTasks: [],
    uploadContext: {
      mode: 'new', // 'new' | 'update'
      shapeId: null,
      textureId: null,
    },
    selectedTextureIdsByShapeId: new Map(),
  };

  // Recommended defaults (used for Reset buttons in UI). These are safe neutral values.
  const RECOMMENDED_DEFAULTS = {
    tileSizeMm: { w: 115, h: 115 },
    uvScale: 1.0,
    exposureMult: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    roughnessMult: 1.0,
    specStrength: 1.0,
    normalScale: 1.0,
    bumpScale: 1.0,
  };

  const TEXTURE_PARAM_SCHEMA = [
    {
      key: 'uvScale',
      label: 'uvScale (масштаб узора)',
      min: 0.5,
      max: 2.0,
      step: 0.01,
      help: 'Размер узора на поверхности. < 1 делает узор крупнее, > 1 делает узор мельче. Используйте, если масштаб визуально не совпадает с реальным.',
    },
    {
      key: 'exposureMult',
      label: 'exposureMult (яркость)',
      min: 0.6,
      max: 1.6,
      step: 0.01,
      help: 'Локальная яркость/экспозиция. Уменьшайте при пересвете темных плиток; увеличивайте, если текстура выглядит слишком темной в AR.',
    },
    {
      key: 'contrast',
      label: 'contrast (контраст)',
      min: 0.7,
      max: 1.3,
      step: 0.01,
      help: 'Контраст. Повышение делает швы/зерно заметнее; слишком высокий контраст часто дает "грязный" вид. Обычно меняют небольшими шагами.',
    },
    {
      key: 'saturation',
      label: 'saturation (насыщенность)',
      min: 0.0,
      max: 1.5,
      step: 0.01,
      help: 'Насыщенность цвета. Если оттенок бледный - слегка увеличьте; если "кислотный" - уменьшите. Обычно диапазон 0.9-1.1.',
    },
    {
      key: 'roughnessMult',
      label: 'roughnessMult (матовость)',
      min: 0.5,
      max: 1.6,
      step: 0.01,
      help: 'Матовость. Больше - меньше бликов (более матовая поверхность). Меньше - больше бликов. Главный параметр, если плитка выглядит пластиковой.',
    },
    {
      key: 'specStrength',
      label: 'specStrength (сила блика)',
      min: 0.0,
      max: 1.2,
      step: 0.01,
      help: 'Сила бликов. Если поверхность кажется пластиковой или слишком "глянцевой" - уменьшайте. Часто используется вместе с roughnessMult.',
    },
    {
      key: 'normalScale',
      label: 'normalScale (рельеф normal)',
      min: 0.0,
      max: 2.0,
      step: 0.01,
      help: 'Сила normalMap (микрорельеф). Слишком большое значение дает шум/"пластик". Часто достаточно 0.6-1.2.',
    },
    {
      key: 'bumpScale',
      label: 'bumpScale (рельеф height)',
      min: 0.0,
      max: 2.0,
      step: 0.01,
      help: 'Сила heightMap как bump (псевдорельеф). Слишком большое значение дает неестественные тени. Обычно 0.2-0.8.',
    },
  ];

  // ZIP mapping modal runtime
  let mapModalResolve = null;

  // Texture preview runtime (canvas before/after)
  let texPreviewImageEl = null;
  let texPreviewLoaded = false;
  let texPreviewOriginal = null; // ImageData
  let texPreviewDrawTimer = null;

  // Bulk modal runtime
  let bulkSnapshot = null;
  let mapModalReject = null;
  let currentMapTask = null;

  // Texture params modal runtime
  let currentTexShapeId = '';
  let currentTexItemId = '';
  let currentTexSnapshot = null;
  let confirmModalResolve = null;

  function normalizeStatusType(type) {
    const t = String(type || '').trim().toLowerCase();
    if (!t) return '';
    if (t === 'error' || t === 'danger' || t === 'failed' || t === 'fail') return 'err';
    if (t === 'warning') return 'warn';
    if (t === 'success' || t === 'done') return 'ok';
    return t;
  }

  function clearNode(el) {
    if (!el) return;
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else el.textContent = '';
  }

  function setStatus(el, type, msg) {
    if (!el) return;
    const tone = normalizeStatusType(type);
    el.className = 'status ' + tone;
    clearNode(el);
    if (!msg) {
      el.style.display = 'none';
      return;
    }
    const line = document.createElement('div');
    line.className = 'status__text';
    line.textContent = msg;
    el.appendChild(line);
    el.style.display = 'block';
  }

  function setStatusRich(el, type, payload) {
    if (!el) return;
    if (!payload || typeof payload === 'string') {
      setStatus(el, type, payload || '');
      return;
    }
    const tone = normalizeStatusType(type || payload.type || '');
    el.className = 'status ' + tone;
    clearNode(el);

    const title = String(payload.title || '').trim();
    const message = String(payload.message || '').trim();
    const note = String(payload.note || '').trim();
    const bullets = Array.isArray(payload.bullets) ? payload.bullets.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : [];
    const meta = Array.isArray(payload.meta) ? payload.meta.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : [];

    if (!title && !message && !note && !bullets.length && !meta.length) {
      el.style.display = 'none';
      return;
    }

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'status__title';
      titleEl.textContent = title;
      el.appendChild(titleEl);
    }
    if (message) {
      const messageEl = document.createElement('div');
      messageEl.className = 'status__text';
      messageEl.textContent = message;
      el.appendChild(messageEl);
    }
    if (bullets.length) {
      const listEl = document.createElement('ul');
      listEl.className = 'status__list';
      bullets.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        listEl.appendChild(li);
      });
      el.appendChild(listEl);
    }
    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'status__note';
      noteEl.textContent = note;
      el.appendChild(noteEl);
    }
    if (meta.length) {
      const metaWrap = document.createElement('div');
      metaWrap.className = 'status__meta';
      meta.forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'status__chip';
        chip.textContent = item;
        metaWrap.appendChild(chip);
      });
      el.appendChild(metaWrap);
    }
    el.style.display = 'block';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function guessMimeByExt(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'webp') return 'image/webp';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'json') return 'application/json';
    return 'application/octet-stream';
  }

  function detectMapType(filename) {
    const n = String(filename || '').toLowerCase();
    const checks = [
      // We accept both strict suffixes (_albedo, _normal, ...) and common synonyms.
      // NOTE: we intentionally do NOT auto-map "gloss" to roughness because it's inverted.
      ['albedo', ['_albedo', 'albedo', 'basecolor', 'base_color', 'basecolour', 'diffuse', 'diff', 'color', 'colour', 'col', 'albd']],
      ['normal', ['_normal', 'normal', 'nrm', 'nor'] ],
      ['roughness', ['_roughness', 'roughness', 'rough', 'rgh'] ],
      ['height', ['_height', 'height', 'disp', 'displ', 'displacement', 'bump'] ],
      ['ao', ['_ao', 'ao', 'ambientocclusion', 'ambient_occlusion', 'occlusion', 'occ'] ],
    ];
    for (const [type, keys] of checks) {
      for (const k of keys) {
        if (n.includes(k)) return type;
      }
    }
    return '';
  }

  
function normalizeTextureId(v, shapeId) {
  const raw0 = String(v || '').trim();
  if (!raw0) return '';

  // If a shape is selected, strip accidental shape prefixes case-insensitively:
  // - "klassika:paver_..." -> "paver_..."
  // - "klassika_paver_..." -> "paver_..."
  // - "klassika-paver_..." -> "paver_..."
  let raw = raw0;
  if (shapeId) {
    const sid = String(shapeId).trim();
    const rawLower = raw.toLowerCase();
    const sidLower = sid.toLowerCase();
    const prefixes = [`${sidLower}:`, `${sidLower}_`, `${sidLower}-`];
    for (const prefix of prefixes) {
      if (rawLower.startsWith(prefix)) {
        raw = raw.slice(prefix.length);
        break;
      }
    }
  }

  // Bucket-safe textureId:
  // - disallow ':' and whitespace
  // - keep only [a-z0-9_-] (convert other chars to '_')
  // - collapse multiple '_' and trim
  let s = raw
    .replace(/[:\s]+/g, '_')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Always lowercase for stable object-storage keys and consistent admin behavior.
  return s.toLowerCase();
}

  function standardMapFilename(textureId, mapType, originalName) {
    const ext = String(originalName || '').split('.').pop() || 'bin';
    const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    return `${textureId}_${mapType}.${safeExt}`;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function fmtSize(bytes) {
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return '—';
    if (b < 1024) return b + ' B';
    const kb = b / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(2) + ' MB';
    const gb = mb / 1024;
    return gb.toFixed(2) + ' GB';
  }

  async function loadImageForCanvas(url) {
    if (!url) throw new Error('preview_url_empty');
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('preview_image_load_failed'));
      if (!setAdminSafeImageSource(img, url, { allowBlob: true, allowDataImage: true })) { reject(new Error('preview_url_unsafe')); return; }
    });
  }

  function drawCoverToCanvas(img, canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return ctx;
  }

  function clamp01(x) {
    return x < 0 ? 0 : (x > 1 ? 1 : x);
  }

  function applyBasicColorAdjustments(srcImageData, params) {
    const exposure = Number(params?.exposureMult ?? 1.0);
    const contrast = Number(params?.contrast ?? 1.0);
    const saturation = Number(params?.saturation ?? 1.0);

    const out = new ImageData(srcImageData.width, srcImageData.height);
    const d = srcImageData.data;
    const o = out.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] / 255;
      let g = d[i + 1] / 255;
      let b = d[i + 2] / 255;
      const a = d[i + 3];

      // Exposure
      r *= exposure; g *= exposure; b *= exposure;

      // Contrast around mid-gray
      r = (r - 0.5) * contrast + 0.5;
      g = (g - 0.5) * contrast + 0.5;
      b = (b - 0.5) * contrast + 0.5;

      // Saturation (luma blend)
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;

      r = clamp01(r); g = clamp01(g); b = clamp01(b);
      o[i] = Math.round(r * 255);
      o[i + 1] = Math.round(g * 255);
      o[i + 2] = Math.round(b * 255);
      o[i + 3] = a;
    }
    return out;
  }

  function openZipMappingModal(task) {
    if (!elMapModal) {
      return Promise.reject(new Error('map_modal_not_found'));
    }
    return new Promise((resolve, reject) => {
      // Reset
      setStatus(elMapModalStatus, '', '');
      elMapTbody.replaceChildren();

      const textureId = task.textureId;
      const quality = task.quality;
      const shapeId = task.shapeId;
      elMapModalTitle.textContent = 'Сопоставление карт';
      elMapModalSubtitle.textContent = `Форма: ${shapeId} • Текстура: ${textureId} • ${quality}`;
      elMapModalHint.textContent = 'ZIP содержит файлы без стандартных суффиксов. Выберите, какой файл соответствует каждой карте. Обязательные карты: albedo, normal, roughness, height.';

      const entries = task.entries || [];
      const byPath = new Map(entries.map(e => [e.originalPath, e]));
      const suggested = task.suggested || new Map();

      const rows = [
        { type: 'albedo', required: true },
        { type: 'normal', required: true },
        { type: 'roughness', required: true },
        { type: 'height', required: true },
        { type: 'ao', required: false },
      ];

      const autoSuggestedCount = rows.reduce((acc, row) => {
        const picked = suggested.get(row.type);
        return acc + ((picked && byPath.has(picked)) ? 1 : 0);
      }, 0);
      setStatusRich(elMapModalStatus, 'warn', {
        title: 'Требуется ручное сопоставление карт',
        message: 'Автоопределение не смогло надёжно разобрать все карты по именам файлов из structured ZIP.',
        bullets: [`Файлов в группе: ${entries.length}`, `Автоподсказок: ${autoSuggestedCount}/${rows.length}`],
        note: 'Обязательные карты: albedo, normal, roughness, height. AO можно оставить пустой.',
        meta: [`Форма: ${shapeId}`, `Текстура: ${textureId}`, `Качество: ${quality}`],
      });

      const selects = new Map();

      for (const row of rows) {
        const tr = document.createElement('tr');

        const tdType = document.createElement('td');
        const typeStrong = document.createElement('b');
        typeStrong.textContent = row.type;
        tdType.appendChild(typeStrong);
        tdType.appendChild(document.createTextNode(' '));
        const typePill = document.createElement('span');
        typePill.className = 'uploadPill';
        typePill.textContent = row.required ? 'обяз.' : 'опц.';
        tdType.appendChild(typePill);
        tr.appendChild(tdType);

        const tdSel = document.createElement('td');
        const sel = document.createElement('select');
        sel.className = 'mapSelect';
        const optEmpty = document.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = '— не выбрано —';
        sel.appendChild(optEmpty);

        for (const e of entries) {
          const o = document.createElement('option');
          o.value = e.originalPath;
          o.textContent = e.filename;
          o.title = e.originalPath;
          sel.appendChild(o);
        }

        const s = suggested.get(row.type);
        if (s && byPath.has(s)) sel.value = s;

        tdSel.appendChild(sel);
        tr.appendChild(tdSel);

        const tdSize = document.createElement('td');
        const picked = byPath.get(sel.value);
        tdSize.textContent = fmtSize(picked?.file?.size || 0);
        tr.appendChild(tdSize);

        sel.addEventListener('change', () => {
          const ee = byPath.get(sel.value);
          tdSize.textContent = fmtSize(ee?.file?.size || 0);
        });

        selects.set(row.type, sel);
        elMapTbody.appendChild(tr);
      }

      const close = () => {
        elMapModal.hidden = true;
        document.body.style.overflow = '';
        syncAdminModalBodyState();
      };

      const onCancel = () => {
        cleanup();
        close();
        reject(new Error('upload_cancelled'));
      };

      const onApply = () => {
        // Validate required
        const required = ['albedo', 'normal', 'roughness', 'height'];
        const missingRequired = required.filter((t) => !(selects.get(t)?.value || ''));
        if (missingRequired.length) {
          setStatusRich(elMapModalStatus, 'err', {
            title: 'Не выбраны обязательные карты',
            message: 'Для structured ZIP нужны albedo, normal, roughness и height.',
            bullets: missingRequired.map((t) => `Не выбрана карта: ${t}`),
            note: 'AO можно оставить пустой. Если имя файла неочевидно, выберите его вручную из списка.',
          });
          return;
        }
        // Validate uniqueness (avoid selecting the same file for different required maps)
        const used = new Map();
        const duplicateFiles = [];
        for (const t of required) {
          const v = selects.get(t).value;
          if (used.has(v)) {
            duplicateFiles.push(byPath.get(v)?.filename || v || 'unknown');
            continue;
          }
          used.set(v, t);
        }
        if (duplicateFiles.length) {
          setStatusRich(elMapModalStatus, 'err', {
            title: 'Один файл выбран для нескольких карт',
            message: 'Для разных обязательных карт нужны разные файлы. Проверьте сопоставление.',
            bullets: duplicateFiles.map((name) => `Повторяется файл: ${name}`),
            note: 'Обычно albedo, normal, roughness и height — это разные изображения.',
          });
          return;
        }

        const mapping = new Map();
        for (const [t, sel] of selects.entries()) {
          const v = sel.value;
          if (v) mapping.set(t, v);
        }
        cleanup();
        close();
        resolve(mapping);
      };

      const onBackdrop = (e) => {
        const act = e.target?.getAttribute?.('data-action');
        if (act === 'close') onCancel();
      };

      const cleanup = () => {
        elMapModalApplyBtn?.removeEventListener('click', onApply);
        elMapModalCancelBtn?.removeEventListener('click', onCancel);
        elMapModalCloseBtn?.removeEventListener('click', onCancel);
        elMapModal?.removeEventListener('click', onBackdrop);
      };

      elMapModalApplyBtn?.addEventListener('click', onApply);
      elMapModalCancelBtn?.addEventListener('click', onCancel);
      elMapModalCloseBtn?.addEventListener('click', onCancel);
      elMapModal?.addEventListener('click', onBackdrop);

      elMapModal.hidden = false;
      document.body.style.overflow = 'hidden';
      syncAdminModalBodyState();
    });
  }

  async function unzipToFiles(zipFile) {
    if (!zipFile) return { files: [], meta: { structured: false, shapeIds: [], textureIds: [], qualities: [] } };
    if (typeof DecompressionStream !== 'function') {
      throw new Error('ZIP распаковка не поддерживается: требуется современный Chrome (DecompressionStream)');
    }
    const buf = await zipFile.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Find EOCD (end of central directory)
    const sig = 0x06054b50;
    const maxBack = Math.min(bytes.length, 22 + 65535);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= bytes.length - maxBack; i--) {
      if (i < 0) break;
      if ((bytes[i] | (bytes[i+1]<<8) | (bytes[i+2]<<16) | (bytes[i+3]<<24)) >>> 0 === sig) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Не удалось прочитать ZIP (EOCD не найден)');

    const dv = new DataView(buf);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    let ptr = cdOffset;
    const files = [];

    // meta collector (for "умная сборка" из ZIP)
    const shapeIds = new Set();
    const textureIds = new Set();
    const qualities = new Set();
    let structured = false;

    const CDFH = 0x02014b50;
    const LFH = 0x04034b50;
    while (ptr < cdOffset + cdSize) {
      if ((dv.getUint32(ptr, true) >>> 0) !== CDFH) break;
      const compMethod = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const uncompSize = dv.getUint32(ptr + 24, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const nameBytes = bytes.slice(ptr + 46, ptr + 46 + nameLen);
      const name = new TextDecoder().decode(nameBytes);
      ptr = ptr + 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue;

      const normName = name.replace(/\\/g, '/');

      // Extract meta if ZIP has full paths
      const idx = normName.indexOf('surfaces/');
      const rel = idx >= 0 ? normName.slice(idx) : normName;
      const m = rel.match(/^surfaces\/([^/]+)\/([^/]+)\/(1k|2k)\//);
      if (m) {
        structured = true;
        shapeIds.add(m[1]);
        textureIds.add(normalizeTextureId(m[2], m[1]));
        qualities.add(m[3]);
      }

      // Local header
      if ((dv.getUint32(localOff, true) >>> 0) !== LFH) continue;
      const lfNameLen = dv.getUint16(localOff + 26, true);
      const lfExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lfNameLen + lfExtraLen;
      const compData = bytes.slice(dataStart, dataStart + compSize);

      let out;
      if (compMethod === 0) {
        out = compData;
      } else if (compMethod === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([compData]).stream().pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        out = new Uint8Array(ab);
      } else {
        // unsupported
        continue;
      }
      if (uncompSize && out.byteLength !== uncompSize) {
        // best-effort; continue
      }

      const base = normName.split('/').pop();
      const file = new File([out], base, { type: guessMimeByExt(base) });
      files.push({ file, originalPath: normName });
    }

    return {
      files,
      meta: {
        structured,
        shapeIds: Array.from(shapeIds),
        textureIds: Array.from(textureIds),
        qualities: Array.from(qualities),
      },
    };
  }

function setTelemetryStatus(message, kind) {
    if (!elTelemetryStatus) return;
    elTelemetryStatus.textContent = String(message || '').trim();
    elTelemetryStatus.className = 'status' + (kind ? (' ' + kind) : '');
  }

  function downloadJson(filename, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 300);
    } catch (e) {
      console.warn(e);
    }
  }

  function downloadTextFile(filename, text, mime) {
    try {
      const blob = new Blob([String(text || '')], { type: String(mime || 'text/plain;charset=utf-8') });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 300);
    } catch (e) {
      console.warn(e);
    }
  }


  function formatTelemetryPercent(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(0)}%`;
  }

  function formatTelemetryFloat(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2);
  }

  function formatTelemetryDateTime(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return String(value);
      return d.toLocaleString('ru-RU');
    } catch (_) {
      return String(value);
    }
  }

  function renderTelemetrySources(localSync, remote, sourceLabel) {
    const local = localSync || {};
    const remoteReady = !!(remote && remote.ok);
    const remoteGeneratedAt = remote && remote.generatedAt ? formatTelemetryDateTime(remote.generatedAt) : '—';
    const remoteLatestEventAt = remote && remote.latestEventAt ? formatTelemetryDateTime(remote.latestEventAt) : '—';
    const remotePartial = !!(remote && (remote.partial || (remote.scan && remote.scan.stopReason)));
    const remoteRetryInfo = remote && remote.requestedByAdmin && remote.requestedByAdmin.degradedRetry ? 'Да' : 'Нет';
    const localLast = formatTelemetryDateTime(local.latestLocalEventAt || '');
    const localPendingLast = formatTelemetryDateTime(local.latestPendingEventAt || '');
    const localFlushOk = formatTelemetryDateTime(local.lastFlushSuccessAt || '');
    const localFlushFail = formatTelemetryDateTime(local.lastFlushFailedAt || '');
    const localResult = local.lastFlushResult ? String(local.lastFlushResult) : '—';
    const pending = Number(local.pending || 0) || 0;
    const syncBadge = createTelemetryBadge(
      pending > 0 ? 'telemetryKpi__badge telemetryKpi__badge--warn' : 'telemetryKpi__badge telemetryKpi__badge--good',
      pending > 0 ? 'Есть данные этого устройства, которые ещё не попали в общую сводку' : 'Данные этого устройства уже переданы в общую сводку'
    );
    const remoteBadge = createTelemetryBadge(
      remoteReady ? 'telemetryKpi__badge telemetryKpi__badge--good' : 'telemetryKpi__badge telemetryKpi__badge--warn',
      remoteReady ? 'Сводная аналитика со всех устройств доступна' : 'Сводная аналитика со всех устройств временно недоступна'
    );

    const localPanel = createAdminNode('div', { className: 'telemetryPanel' });
    const localHead = createAdminNode('div', { className: 'telemetryKpi__head' });
    appendAdminChildren(localHead, createAdminNode('div', { className: 'telemetryPanel__label', text: 'Данные этого устройства' }), syncBadge);
    const localList = createAdminNode('div', { className: 'telemetryPanel__list' });
    [
      ['Событий на этом устройстве', local.totalLocal || 0],
      ['Ещё не передано на сервер', pending],
      ['Последнее действие на этом устройстве', localLast],
      ['Последнее ожидающее действие', localPendingLast],
      ['Последняя передача данных на сервер', localFlushOk],
      ['Последняя ошибка передачи', localFlushFail],
      ['Состояние синхронизации', localResult],
    ].forEach(([label, value]) => localList.appendChild(createAdminPanelItem(label, value)));
    appendAdminChildren(
      localPanel,
      localHead,
      createAdminNode('div', { className: 'telemetryPanel__sub', text: 'Источник: текущий браузер и устройство. Кнопка «Синхронизировать это устройство» передаёт на сервер только данные этого браузера.' }),
      localList
    );

    const remotePanel = createAdminNode('div', { className: 'telemetryPanel' });
    const remoteHead = createAdminNode('div', { className: 'telemetryKpi__head' });
    appendAdminChildren(remoteHead, createAdminNode('div', { className: 'telemetryPanel__label', text: 'Сводная аналитика со всех устройств' }), remoteBadge);
    const remoteList = createAdminNode('div', { className: 'telemetryPanel__list' });
    [
      ['Событий в общей сводке', remote && remote.totals ? (remote.totals.events || 0) : 0],
      ['Сессий в общей сводке', remote && remote.totals ? (remote.totals.sessions || 0) : 0],
      ['Пакетов данных в хранилище', remote && remote.totals ? (remote.totals.batches || 0) : 0],
      ['Последнее полученное действие', remoteLatestEventAt],
      ['Последнее обновление общей сводки', remoteGeneratedAt],
      ['Статус серверной аналитики', remoteReady ? (remotePartial ? 'Подключён (облегчённый режим)' : 'Подключён') : 'Нет ответа'],
      ['Режим серверной сводки', remoteReady ? (remotePartial ? 'Частичная выборка с ограничением нагрузки' : 'Полная выборка в рамках текущего лимита') : '—'],
      ['Повторный облегчённый запрос', remoteReady ? remoteRetryInfo : '—'],
    ].forEach(([label, value]) => remoteList.appendChild(createAdminPanelItem(label, value)));
    appendAdminChildren(
      remotePanel,
      remoteHead,
      createAdminNode('div', { className: 'telemetryPanel__sub', text: `${sourceLabel}. Эти данные собираются со всех устройств. Они появляются после автоматической синхронизации с сайта или ручной синхронизации данных этого браузера.` }),
      remoteList
    );

    return [localPanel, remotePanel];
  }


  function telemetryEventLabel(name) {
    const map = {
      page_view: 'Просмотр страницы',
      screen_view: 'Просмотр экрана',
      cta_manager_call: 'Клик «Связь с менеджером»',
      cta_site_click: 'Клик «Сайт»',
      ar_launch_click: 'Запуск AR — клик',
      ar_session_start_requested: 'Запрос запуска AR',
      ar_session_started: 'AR успешно запущен',
      ar_session_start_failed: 'AR не запустился',
      ar_first_point: 'Первая точка AR-контура',
      ar_point_added: 'Добавлена точка AR-контура',
      ar_contour_closed: 'Контур замкнут',
      ar_cut_contour_closed: 'Вырез замкнут',
      ar_visualization_ready: 'Визуализация готова',
      texture_select: 'Выбор текстуры',
      form_change: 'Смена формы',
      ar_shape_picker_toggle: 'Открытие выбора формы',
      ar_shape_picker_select: 'Выбор формы через picker',
      ar_rotation_step: 'Поворот текстуры',
      ar_rotation_reset: 'Сброс поворота',
      ar_snapshot_click: 'Нажатие «Снимок»',
      ar_snapshot_exported: 'Снимок экспортирован',
      ar_snapshot_fallback_open: 'Открыт fallback скриншота',
      ar_snapshot_request_failed: 'Ошибка запроса снимка',
      ar_snapshot_builtin_failed: 'Ошибка встроенного снимка',
      admin_ar_calibration_open: 'Открыта AR-калибровка',
      admin_ar_calibration_toggle: 'Панель AR-калибровки',
      admin_ar_calibration_scale_change: 'Шаг масштаба в AR-калибровке',
      admin_ar_calibration_scale_slider_change: 'Слайдер масштаба в AR-калибровке',
      admin_visual_param_change: 'Изменён визуальный параметр текстуры',
      admin_ar_calibration_saved: 'Параметры AR-калибровки сохранены',
      admin_ar_calibration_save_failed: 'Ошибка сохранения AR-калибровки',
      texture_map_load_failed: 'Не загрузилась карта текстуры',
      palette_load_failed: 'Не загрузилась палитра',
      palette_parse_failed: 'Ошибка разбора палитры',
      gallery_asset_missing: 'Не найден файл шапки/галереи',
      window_error: 'Глобальная ошибка окна',
      unhandled_rejection: 'Необработанный промис',
      admin_api_error: 'Ошибка admin API',
      tiles_load_failed: 'Не загрузился каталог текстур',
      shapes_load_failed: 'Не загрузился каталог форм',
      ar_texture_rail_build_failed: 'Ошибка сборки AR-ленты текстур',
      ar_texture_rail_refresh_failed: 'Ошибка обновления AR-ленты текстур',
      ar_texture_rail_shape_switch_failed: 'Ошибка смены формы в AR-ленте',
      ar_shape_switch_failed: 'Ошибка переключения формы',
      ar_shape_picker_build_failed: 'Ошибка сборки выбора формы',
      ar_texture_group_skipped: 'Группа текстур пропущена штатным safeguard',
      quick_ar_launch_failed: 'Быстрый запуск AR завершился ошибкой',
      quick_ar_rail_build_failed: 'Ошибка сборки быстрой AR-ленты',
      detail_open_failed: 'Не удалось открыть карточку формы',
      app_init_failed: 'Сайт не смог завершить инициализацию',
      admin_login_config_missing: 'В админке не настроен API base URL',
      admin_login_failed: 'Ошибка входа в админку',
      admin_telemetry_flush_failed: 'Ошибка синхронизации аналитики из админки'
    };
    return map[name] || name || '—';
  }

  function telemetryDeviceLabel(deviceType) {
    const map = { mobile: 'Телефоны', tablet: 'Планшеты', desktop: 'Компьютеры', unknown: 'Не определено' };
    return map[deviceType] || deviceType || 'Не определено';
  }


  function telemetryPeriodLabel(days) {
    const n = Math.max(1, Math.min(365, Number(days || 7) || 7));
    if (n === 1) return 'за 1 день';
    if (n === 7) return 'за 7 дней';
    if (n === 30) return 'за 30 дней';
    if (n === 90) return 'за квартал';
    if (n === 365) return 'за год';
    return `за ${n} дней`;
  }

  function normalizeTelemetryDays(value) {
    const n = Number(value || 7) || 7;
    if ([1, 7, 30, 90, 365].includes(n)) return String(n);
    return '7';
  }

  function normalizeTelemetryDevice(value) {
    const key = String(value || 'all').toLowerCase();
    return ['all', 'mobile', 'tablet', 'desktop', 'unknown'].includes(key) ? key : 'all';
  }

  function getTelemetryFilters() {
    return {
      days: Number(normalizeTelemetryDays(elTelemetryPeriodSelect && elTelemetryPeriodSelect.value)),
      deviceType: normalizeTelemetryDevice(elTelemetryDeviceSelect && elTelemetryDeviceSelect.value)
    };
  }

  function telemetrySourceLabel(baseLabel, filters) {
    const parts = [String(baseLabel || '').trim(), telemetryPeriodLabel(filters && filters.days)];
    if (filters && filters.deviceType && filters.deviceType !== 'all') parts.push(telemetryDeviceLabel(filters.deviceType));
    return parts.filter(Boolean).join(' · ');
  }

  const TELEMETRY_ERROR_SEVERITY_META = {
    critical: { label: 'Критические', hint: 'Ломают ключевой сценарий или запускают аварийную деградацию.' },
    medium: { label: 'Средний приоритет', hint: 'Ломают часть UX или отдельный сценарий, но не весь продукт.' },
    low: { label: 'Некритичные', hint: 'Мягкие деградации и recoverable кейсы.' },
    diagnostic: { label: 'Служебные', hint: 'Диагностические сигналы и защитные срабатывания.' }
  };

  const TELEMETRY_ERROR_CATEGORY_META = {
    ar_session: { label: 'AR / запуск и сессия', hint: 'Ошибки входа в AR, запуска и переключения сценария.' },
    textures_materials: { label: 'Текстуры и материалы', hint: 'Проблемы загрузки карт, материалов и текстурных рельс.' },
    palette_content: { label: 'Палитры и контент', hint: 'Ошибки чтения JSON, палитр, каталога форм и контентных файлов.' },
    snapshot_export: { label: 'Скриншот / snapshot', hint: 'Проблемы запроса и экспорта снимка.' },
    analytics_backend: { label: 'Аналитика / синхронизация', hint: 'Сбой серверной сводки, синхронизации или telemetry backend.' },
    admin_save: { label: 'Админка / сохранение', hint: 'Ошибки входа, API и сохранения параметров в админке.' },
    ui_flow: { label: 'Пользовательский поток / UI', hint: 'Проблемы открытия экранов, переключения формы и secondary flow.' },
    runtime_js: { label: 'JS runtime', hint: 'Глобальные ошибки окна и необработанные promise rejection.' }
  };

  const TELEMETRY_ERROR_CATEGORY_ORDER = ['ar_session', 'textures_materials', 'palette_content', 'snapshot_export', 'analytics_backend', 'admin_save', 'ui_flow', 'runtime_js'];
  const TELEMETRY_ERROR_SEVERITY_ORDER = ['critical', 'medium', 'low', 'diagnostic'];
  const TELEMETRY_REMOTE_SUMMARY_LIMITS = [80, 40, 20];
  const TELEMETRY_REMOTE_ERROR_LIMIT = 120;
  const TELEMETRY_ERROR_MODAL_ITEM_LIMIT = 300;
  const TELEMETRY_ERROR_EXPORT_ITEM_LIMIT = 1200;

  const TELEMETRY_ERROR_RULES = {
    app_init_failed: { severity: 'critical', category: 'ui_flow' },
    quick_ar_launch_failed: { severity: 'critical', category: 'ar_session' },
    ar_session_start_failed: { severity: 'critical', category: 'ar_session' },
    tiles_load_failed: { severity: 'critical', category: 'palette_content' },
    shapes_load_failed: { severity: 'critical', category: 'palette_content' },
    palette_load_failed: { severity: 'critical', category: 'palette_content' },
    palette_parse_failed: { severity: 'critical', category: 'palette_content' },
    texture_map_load_failed: { severity: 'critical', category: 'textures_materials' },
    admin_api_error: { severity: 'critical', category: 'admin_save' },
    admin_ar_calibration_save_failed: { severity: 'critical', category: 'admin_save' },
    window_error: { severity: 'critical', category: 'runtime_js' },
    unhandled_rejection: { severity: 'critical', category: 'runtime_js' },
    ar_texture_rail_build_failed: { severity: 'medium', category: 'textures_materials' },
    ar_texture_rail_refresh_failed: { severity: 'medium', category: 'textures_materials' },
    ar_texture_rail_shape_switch_failed: { severity: 'medium', category: 'textures_materials' },
    ar_shape_switch_failed: { severity: 'medium', category: 'ui_flow' },
    ar_shape_picker_build_failed: { severity: 'medium', category: 'ui_flow' },
    detail_open_failed: { severity: 'medium', category: 'ui_flow' },
    quick_ar_rail_build_failed: { severity: 'medium', category: 'ui_flow' },
    ar_snapshot_request_failed: { severity: 'medium', category: 'snapshot_export' },
    ar_snapshot_builtin_failed: { severity: 'medium', category: 'snapshot_export' },
    gallery_asset_missing: { severity: 'low', category: 'palette_content' },
    admin_login_failed: { severity: 'medium', category: 'admin_save' },
    admin_telemetry_flush_failed: { severity: 'medium', category: 'analytics_backend' },
    admin_login_config_missing: { severity: 'critical', category: 'admin_save' },
    ar_texture_group_skipped: { severity: 'diagnostic', category: 'textures_materials' }
  };

  function telemetryErrorSeverityLabel(key) {
    return (TELEMETRY_ERROR_SEVERITY_META[key] && TELEMETRY_ERROR_SEVERITY_META[key].label) || 'Не определено';
  }

  function telemetryErrorCategoryLabel(key) {
    return (TELEMETRY_ERROR_CATEGORY_META[key] && TELEMETRY_ERROR_CATEGORY_META[key].label) || 'Прочее';
  }

  function telemetryErrorSourceLabel(key) {
    const map = { site: 'Сайт', admin: 'Админка', all: 'Сайт и админка' };
    return map[key] || 'Не определено';
  }

  function normalizeTelemetryErrorSelect(value, allowed, fallback) {
    const key = String(value || fallback || '').toLowerCase();
    return allowed.includes(key) ? key : fallback;
  }

  function getTelemetryErrorReportFilters() {
    telemetryErrorReportFiltersState = {
      severity: normalizeTelemetryErrorSelect(elTelemetryErrorSeveritySelect && elTelemetryErrorSeveritySelect.value, ['all'].concat(TELEMETRY_ERROR_SEVERITY_ORDER), 'all'),
      category: normalizeTelemetryErrorSelect(elTelemetryErrorCategorySelect && elTelemetryErrorCategorySelect.value, ['all'].concat(TELEMETRY_ERROR_CATEGORY_ORDER), 'all'),
      source: normalizeTelemetryErrorSelect(elTelemetryErrorSourceSelect && elTelemetryErrorSourceSelect.value, ['all', 'site', 'admin'], 'all')
    };
    return Object.assign({}, telemetryErrorReportFiltersState);
  }

  function isTelemetrySummaryRetryable(result) {
    if (!result || result.ok) return false;
    const status = Number(result.status || 0) || 0;
    const code = String(result.code || '').toLowerCase();
    return status === 504 || status === 503 || status === 502 || code === 'network_error' || code === 'timeout';
  }

  function formatTelemetrySummaryFailureMessage(result) {
    const status = Number(result && result.status || 0) || 0;
    const message = String(result && result.message || '').trim();
    if (status === 504) return 'Серверная сводка превысила лимит времени. Показаны локальные данные этого браузера.';
    if (status === 503) return 'Серверная сводка временно недоступна. Проверьте настройки telemetry backend.';
    if (status === 401) return 'Серверная сводка требует повторного входа в админку.';
    if (status === 0 && message) return 'Серверная сводка недоступна по сети. Показаны локальные данные этого браузера.';
    if (message) return message;
    return 'Серверная сводка временно недоступна.';
  }

  async function loadRemoteTelemetrySummary(baseFilters) {
    const canLoadRemote = !!(telemetry && telemetry.getRemoteSummaryDetailed);
    if (!canLoadRemote) {
      return { ok: false, data: null, result: { ok: false, message: 'Telemetry summary is not available', code: 'no_summary', status: 0 }, attempts: [] };
    }
    const attempts = [];
    for (const limit of TELEMETRY_REMOTE_SUMMARY_LIMITS) {
      const result = await telemetry.getRemoteSummaryDetailed({
        days: baseFilters.days,
        deviceType: (baseFilters.deviceType === 'all' ? '' : baseFilters.deviceType),
        limit
      });
      attempts.push({ limit, result });
      if (result && result.ok) {
        if (result.data && typeof result.data === 'object') {
          result.data.requestedByAdmin = { limit, attempts: attempts.length, degradedRetry: attempts.length > 1 };
        }
        return { ok: true, data: result.data || null, result, attempts };
      }
      if (!isTelemetrySummaryRetryable(result)) break;
    }
    const last = attempts.length ? attempts[attempts.length - 1].result : { ok: false, message: 'Telemetry summary is not available', code: 'no_summary', status: 0 };
    return { ok: false, data: null, result: last, attempts };
  }

  function getProp(obj, keys) {
    const source = obj && typeof obj === 'object' ? obj : {};
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (!key) continue;
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return '';
  }

  function inferTelemetryErrorSource(item) {
    const preset = String(item && item.source || '').toLowerCase();
    if (preset === 'site' || preset === 'admin') return preset;
    const path = String(item && item.path || '');
    const name = String(item && item.name || '');
    if (name.startsWith('admin_') || /\/admin(?:\/|$)/i.test(path)) return 'admin';
    return 'site';
  }

  function classifyTelemetryError(item) {
    const name = String(item && item.name || '');
    const props = item && item.props && typeof item.props === 'object' ? item.props : {};
    const rule = TELEMETRY_ERROR_RULES[name] || {};
    let severity = String(item && item.severity || '').toLowerCase() || rule.severity || '';
    let category = String(item && item.category || '').toLowerCase() || rule.category || '';
    if (!severity) {
      if (name.includes('window') || name.includes('rejection')) severity = 'critical';
      else if (name.includes('snapshot')) severity = 'medium';
      else if (name.includes('palette') || name.includes('tiles') || name.includes('shapes')) severity = 'critical';
      else if (name.includes('texture') || name.includes('detail_') || name.includes('shape_')) severity = 'medium';
      else severity = 'diagnostic';
    }
    if (!category) {
      if (name.includes('snapshot')) category = 'snapshot_export';
      else if (name.includes('palette') || name.includes('tiles') || name.includes('shapes') || name.includes('gallery')) category = 'palette_content';
      else if (name.includes('texture')) category = 'textures_materials';
      else if (name.startsWith('admin_')) category = 'admin_save';
      else if (name.includes('window') || name.includes('rejection')) category = 'runtime_js';
      else if (name.includes('ar_')) category = 'ar_session';
      else category = 'ui_flow';
    }
    const shapeId = getProp(props, ['shapeId', 'selectedShapeId', 'targetShapeId']);
    const textureId = getProp(props, ['tileId', 'selectedTileId', 'textureId', 'itemId']);
    const deviceType = getProp(props, ['deviceType']) || 'unknown';
    const message = String(props.message || props.reason || props.error || '').trim();
    const stack = String(props.stack || '').trim();
    const source = inferTelemetryErrorSource(item);
    return {
      raw: item,
      id: String(item && item.id || ''),
      technicalKey: name || 'error',
      title: telemetryEventLabel(name || 'error'),
      severity,
      severityLabel: telemetryErrorSeverityLabel(severity),
      category,
      categoryLabel: telemetryErrorCategoryLabel(category),
      source,
      sourceLabel: telemetryErrorSourceLabel(source),
      iso: String(item && item.iso || ''),
      ts: Number(item && item.ts || 0) || 0,
      path: String(item && item.path || ''),
      version: String(item && item.version || ''),
      sessionId: String(item && item.sessionId || ''),
      visitorId: String(item && item.visitorId || props.visitorId || props.deviceId || ''),
      deviceType,
      deviceLabel: telemetryDeviceLabel(deviceType),
      shapeId,
      textureId,
      message,
      stack,
      summary: message || stack || 'Подробности доступны в техническом payload.',
      details: Object.assign({}, props)
    };
  }

  function buildTelemetryErrorReportItems(rawItems) {
    return (Array.isArray(rawItems) ? rawItems : [])
      .map((item) => classifyTelemetryError(item))
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0) || String(b.iso || '').localeCompare(String(a.iso || '')));
  }

  function filterTelemetryErrorReportItems(items, filters) {
    const cfg = filters || {};
    return (Array.isArray(items) ? items : []).filter((item) => {
      if (cfg.severity && cfg.severity !== 'all' && item.severity !== cfg.severity) return false;
      if (cfg.category && cfg.category !== 'all' && item.category !== cfg.category) return false;
      if (cfg.source && cfg.source !== 'all' && item.source !== cfg.source) return false;
      return true;
    });
  }

  function setTelemetryErrorReportStatus(message, kind) {
    if (!elTelemetryErrorReportStatus) return;
    elTelemetryErrorReportStatus.textContent = String(message || '').trim();
    elTelemetryErrorReportStatus.className = 'status' + (kind ? (' ' + kind) : '');
  }


  function updateTelemetryErrorReportActionState(state) {
    if (!elTelemetryErrorReportClearBtn) return;
    const reportState = state || telemetryErrorReportState || null;
    const visibleItems = reportState && Array.isArray(reportState.visibleItems) ? reportState.visibleItems : [];
    const hasItems = visibleItems.some((item) => item && item.id);
    const isRemoteFailed = reportState && reportState.sourceMode === 'remote_failed';
    const canClearLocal = !!(telemetry && telemetry.clearItemsByIds);
    const canClearRemote = !!(telemetry && telemetry.clearRemoteErrorsDetailed);
    const canClear = !isRemoteFailed && hasItems && ((reportState && reportState.sourceMode === 'remote' && canClearRemote) || (reportState && reportState.sourceMode === 'local' && canClearLocal));
    elTelemetryErrorReportClearBtn.disabled = !canClear;
    if (isRemoteFailed) elTelemetryErrorReportClearBtn.title = 'Очистка недоступна, пока детальный серверный отчёт не загружен.';
    else if (!hasItems) elTelemetryErrorReportClearBtn.title = 'В текущем отчёте нет ошибок для очистки.';
    else if (reportState && reportState.sourceMode === 'remote') elTelemetryErrorReportClearBtn.title = 'Очистить текущие ошибки из серверного отчёта.';
    else if (reportState && reportState.sourceMode === 'local') elTelemetryErrorReportClearBtn.title = 'Очистить текущие ошибки этого браузера.';
    else elTelemetryErrorReportClearBtn.title = 'Очистка недоступна.';
  }

  function normalizeTelemetryErrorCountMap(list, allowedKeys) {
    const out = {};
    (Array.isArray(allowedKeys) ? allowedKeys : []).forEach((key) => { out[key] = 0; });
    (Array.isArray(list) ? list : []).forEach((entry) => {
      const key = String(entry && (entry.key || entry.name) || '');
      if (!Object.prototype.hasOwnProperty.call(out, key)) return;
      out[key] = Number(entry && entry.count || 0) || 0;
    });
    return out;
  }

  function computeTelemetryErrorCountsFromItems(items) {
    const arr = Array.isArray(items) ? items : [];
    const counts = { total: arr.length };
    TELEMETRY_ERROR_SEVERITY_ORDER.forEach((key) => { counts[key] = 0; });
    TELEMETRY_ERROR_CATEGORY_ORDER.forEach((key) => { counts['category:' + key] = 0; });
    arr.forEach((item) => {
      if (counts[item.severity] != null) counts[item.severity] += 1;
      const categoryKey = 'category:' + item.category;
      if (counts[categoryKey] != null) counts[categoryKey] += 1;
    });
    return counts;
  }

  function buildTelemetryErrorSummaryCards(state) {
    const visibleItems = state && Array.isArray(state.visibleItems) ? state.visibleItems : [];
    const overall = state && state.remoteAggregates ? state.remoteAggregates : null;
    const fallbackCounts = computeTelemetryErrorCountsFromItems(visibleItems);
    const severityCounts = overall && overall.bySeverity
      ? normalizeTelemetryErrorCountMap(overall.bySeverity, TELEMETRY_ERROR_SEVERITY_ORDER)
      : normalizeTelemetryErrorCountMap(TELEMETRY_ERROR_SEVERITY_ORDER.map((key) => ({ key, count: fallbackCounts[key] || 0 })), TELEMETRY_ERROR_SEVERITY_ORDER);
    const totalCount = overall && overall.totalErrors != null ? Number(overall.totalErrors || 0) : Number(fallbackCounts.total || 0);
    const scopeBits = [state && state.sourceLabel ? state.sourceLabel : ''];
    if (state && state.sourceMode === 'remote') scopeBits.push('сводка со всех устройств');
    else if (state && state.sourceMode === 'local') scopeBits.push('только данные этого браузера');
    else if (state && state.sourceMode === 'remote_failed') scopeBits.push('детальный серверный отчёт временно недоступен');
    const scopeHint = scopeBits.filter(Boolean).join(' · ');
    const shownHint = overall && totalCount > visibleItems.length
      ? `В списке показано ${visibleItems.length} из ${totalCount} последних записей.`
      : `В списке показано ${visibleItems.length} записей.`;
    const cards = [
      ['Всего ошибок', totalCount, `${shownHint} ${scopeHint}`.trim()],
      [telemetryErrorSeverityLabel('critical'), severityCounts.critical || 0, TELEMETRY_ERROR_SEVERITY_META.critical.hint],
      [telemetryErrorSeverityLabel('medium'), severityCounts.medium || 0, TELEMETRY_ERROR_SEVERITY_META.medium.hint],
      [telemetryErrorSeverityLabel('low'), severityCounts.low || 0, TELEMETRY_ERROR_SEVERITY_META.low.hint],
      [telemetryErrorSeverityLabel('diagnostic'), severityCounts.diagnostic || 0, TELEMETRY_ERROR_SEVERITY_META.diagnostic.hint]
    ];
    return cards.map(([label, value, hint]) => {
      const card = createAdminNode('div', { className: 'telemetryStat' });
      appendAdminChildren(
        card,
        createAdminNode('div', { className: 'telemetryStat__label', text: label }),
        createAdminNode('div', { className: 'telemetryStat__value', text: value }),
        createAdminNode('div', { className: 'telemetryStat__sub', text: hint || '' })
      );
      return card;
    });
  }

  function renderTelemetryErrorReportGroups(items) {
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      return [createAdminNode('div', { className: 'muted', text: 'По выбранным фильтрам ошибок не найдено.' })];
    }
    return TELEMETRY_ERROR_CATEGORY_ORDER.flatMap((categoryKey) => {
      const groupItems = arr.filter((item) => item.category === categoryKey);
      if (!groupItems.length) return [];
      const meta = TELEMETRY_ERROR_CATEGORY_META[categoryKey] || { label: categoryKey, hint: '' };
      const details = createAdminNode('details', { className: 'errorReportGroup', attrs: { open: '' } });
      const summary = createAdminNode('summary', { className: 'errorReportGroup__summary' });
      appendAdminChildren(summary,
        createAdminNode('span', { text: meta.label }),
        createAdminNode('span', { className: 'errorReportGroup__count', text: groupItems.length })
      );
      details.appendChild(summary);
      details.appendChild(createAdminNode('div', { className: 'errorReportGroup__hint', text: String(meta.hint || '') }));
      const body = createAdminNode('div', { className: 'errorReportGroup__body' });
      groupItems.forEach((item) => {
        const metaParts = [];
        if (item.iso) metaParts.push(formatTelemetryDateTime(item.iso));
        if (item.deviceLabel) metaParts.push(item.deviceLabel);
        if (item.sourceLabel) metaParts.push(item.sourceLabel);
        if (item.shapeId) metaParts.push('Форма: ' + item.shapeId);
        if (item.textureId) metaParts.push('Текстура: ' + item.textureId);
        if (item.path) metaParts.push(item.path);
        const detailsPayload = {
          technicalKey: item.technicalKey,
          severity: item.severity,
          category: item.category,
          source: item.source,
          sessionId: item.sessionId,
          visitorId: item.visitorId,
          version: item.version,
          path: item.path,
          deviceType: item.deviceType,
          shapeId: item.shapeId,
          textureId: item.textureId,
          props: item.details || {}
        };

        const article = createAdminNode('article', { className: `errorReportEntry errorReportEntry--${item.severity || 'low'}` });
        const head = createAdminNode('div', { className: 'errorReportEntry__head' });
        const titleWrap = createAdminNode('div', { className: 'errorReportEntry__titleWrap' });
        appendAdminChildren(
          titleWrap,
          createAdminNode('div', { className: 'errorReportEntry__title', text: item.title }),
          createAdminNode('div', { className: 'errorReportEntry__meta', text: metaParts.join(' · ') })
        );
        const badges = createAdminNode('div', { className: 'errorReportEntry__badges' });
        appendAdminChildren(
          badges,
          createTelemetryBadge(`telemetryKpi__badge errorBadge errorBadge--${item.severity || 'low'}`, item.severityLabel),
          createTelemetryBadge('telemetryKpi__badge errorBadge errorBadge--category', item.categoryLabel)
        );
        appendAdminChildren(head, titleWrap, badges);

        const tech = createAdminNode('div', { className: 'errorReportEntry__tech' });
        tech.append('technical key: ');
        tech.appendChild(createAdminNode('code', { text: item.technicalKey || '' }));

        const techDetails = createAdminNode('details', { className: 'errorReportEntry__details' });
        techDetails.appendChild(createAdminNode('summary', { text: 'Технические детали' }));
        techDetails.appendChild(createAdminNode('div', {
          className: 'telemetryItem__body',
          text: JSON.stringify(detailsPayload, null, 2)
        }));

        appendAdminChildren(
          article,
          head,
          createAdminNode('div', { className: 'errorReportEntry__summary', text: item.summary }),
          tech,
          techDetails
        );
        body.appendChild(article);
      });
      details.appendChild(body);
      return [details];
    });
  }

  function renderTelemetryErrorReport() {
    if (!elTelemetryErrorReportCard) return;
    const state = telemetryErrorReportState || { sourceLabel: '', sourceMode: 'local', baseFilters: getTelemetryFilters(), items: [], visibleItems: [], truncated: false, generatedAt: '' };
    if (elTelemetryErrorReportSummary) {
      elTelemetryErrorReportSummary.replaceChildren(...buildTelemetryErrorSummaryCards(state));
    }
    updateTelemetryErrorReportActionState(state);
    if (elTelemetryErrorReportList) {
      const nodes = [];
      if (state.truncated) nodes.push(createAdminNode('div', { className: 'hint mtSm', text: 'Показана ограниченная выборка последних ошибок. Для стабильности интерфейс показывает последние записи, а итоговые счётчики строятся по полному серверному скану выбранного периода.' }));
      if (state.generatedAt) nodes.push(createAdminNode('div', { className: 'hint mtSm', text: `Последняя серверная генерация отчёта: ${formatTelemetryDateTime(state.generatedAt)}` }));
      if (state.remoteFailureMessage) nodes.push(createAdminNode('div', { className: 'status err mtSm', text: state.remoteFailureMessage }));
      nodes.push(...renderTelemetryErrorReportGroups(state.visibleItems));
      elTelemetryErrorReportList.replaceChildren(...nodes);
    }
    const filterBits = [];
    if (state.uiFilters && state.uiFilters.severity !== 'all') filterBits.push(telemetryErrorSeverityLabel(state.uiFilters.severity));
    if (state.uiFilters && state.uiFilters.category !== 'all') filterBits.push(telemetryErrorCategoryLabel(state.uiFilters.category));
    if (state.uiFilters && state.uiFilters.source !== 'all') filterBits.push(telemetryErrorSourceLabel(state.uiFilters.source));
    const suffix = filterBits.length ? (' Дополнительные фильтры: ' + filterBits.join(' · ') + '.') : '';
    if (state.sourceMode === 'remote_failed') {
      setTelemetryErrorReportStatus(`Сводная аналитика доступна, но детальный серверный отчёт по ошибкам не получен. ${state.remoteFailureMessage || 'Попробуйте обновить отчёт.'}${suffix}`, 'err');
      return;
    }
    const totalShown = state.remoteAggregates && state.remoteAggregates.totalErrors != null
      ? `${state.visibleItems.length} из ${state.remoteAggregates.totalErrors}`
      : String(state.visibleItems.length);
    setTelemetryErrorReportStatus(`Показаны ошибки: ${state.sourceLabel}. Источник: ${state.sourceMode === 'remote' ? 'сводная аналитика со всех устройств' : 'только данные этого браузера'}. В отчёте: ${totalShown}.${suffix}`, state.truncated ? 'warn' : '');
  }

  async function loadTelemetryErrorReportData(options) {
    const cfg = options || {};
    const baseFilters = getTelemetryFilters();
    const uiFilters = getTelemetryErrorReportFilters();
    const batchLimit = TELEMETRY_REMOTE_ERROR_LIMIT;
    const itemLimit = Math.max(1, Math.min(TELEMETRY_ERROR_EXPORT_ITEM_LIMIT, Number(cfg.itemLimit || TELEMETRY_ERROR_MODAL_ITEM_LIMIT) || TELEMETRY_ERROR_MODAL_ITEM_LIMIT));
    const remoteParams = {
      days: baseFilters.days,
      deviceType: (baseFilters.deviceType === 'all' ? '' : baseFilters.deviceType),
      limit: batchLimit,
      items: itemLimit,
      severity: (uiFilters.severity === 'all' ? '' : uiFilters.severity),
      category: (uiFilters.category === 'all' ? '' : uiFilters.category),
      source: (uiFilters.source === 'all' ? '' : uiFilters.source)
    };
    const canLoadRemote = !!(telemetry && telemetry.getRemoteErrorsDetailed);
    const [remoteErrorsResult, remoteSummaryResult] = await Promise.all([
      canLoadRemote ? telemetry.getRemoteErrorsDetailed(remoteParams) : Promise.resolve({ ok: false, data: null, message: 'Telemetry endpoint is not configured', code: 'no_endpoint' }),
      loadRemoteTelemetrySummary(baseFilters).then((payload) => payload && payload.ok
        ? { ok: true, data: payload.data, message: '', code: '', detail: payload }
        : { ok: false, data: null, message: formatTelemetrySummaryFailureMessage(payload && payload.result), code: (payload && payload.result && payload.result.code) || 'no_summary', detail: payload })
    ]);

    const remoteFeed = remoteErrorsResult && remoteErrorsResult.ok && remoteErrorsResult.data && Array.isArray(remoteErrorsResult.data.items)
      ? remoteErrorsResult.data
      : null;
    const remoteSummary = remoteSummaryResult && remoteSummaryResult.ok && remoteSummaryResult.data
      ? remoteSummaryResult.data
      : null;

    let sourceMode = 'local';
    let rawItems = [];
    let remoteFailureMessage = '';
    if (remoteFeed) {
      sourceMode = 'remote';
      rawItems = remoteFeed.items;
    } else if (remoteSummary) {
      sourceMode = 'remote_failed';
      rawItems = [];
      const details = remoteErrorsResult && remoteErrorsResult.message ? ` Причина: ${remoteErrorsResult.message}.` : '';
      remoteFailureMessage = `Детальный серверный отчёт по ошибкам не получен.${details}`;
    } else {
      sourceMode = 'local';
      rawItems = ((telemetry && telemetry.getRecent ? telemetry.getRecent(itemLimit, baseFilters) : []).filter((item) => item && item.kind === 'error'));
    }

    const items = buildTelemetryErrorReportItems(rawItems);
    const visibleItems = sourceMode === 'remote' ? items : filterTelemetryErrorReportItems(items, uiFilters);
    const sourceLabel = telemetrySourceLabel(sourceMode === 'remote' ? 'сводная аналитика' : (sourceMode === 'remote_failed' ? 'серверная сводка без деталей' : 'данные этого браузера'), baseFilters);
    telemetryErrorReportState = {
      remote: remoteFeed,
      remoteSummary,
      remoteRequest: remoteErrorsResult,
      sourceMode,
      sourceLabel,
      baseFilters,
      uiFilters,
      items,
      visibleItems,
      truncated: !!(remoteFeed && remoteFeed.truncated),
      generatedAt: remoteFeed && remoteFeed.generatedAt ? remoteFeed.generatedAt : '',
      remoteFailureMessage,
      remoteAggregates: remoteFeed ? {
        totalErrors: Number(remoteFeed && remoteFeed.totals ? remoteFeed.totals.errors || 0 : 0),
        bySeverity: Array.isArray(remoteFeed && remoteFeed.bySeverity) ? remoteFeed.bySeverity : [],
        byCategory: Array.isArray(remoteFeed && remoteFeed.byCategory) ? remoteFeed.byCategory : []
      } : null
    };
    renderTelemetryErrorReport();
    return telemetryErrorReportState;
  }

  function telemetryErrorExportRows(items) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      time: item.iso || '',
      severity: item.severityLabel,
      category: item.categoryLabel,
      source: item.sourceLabel,
      title: item.title,
      technicalKey: item.technicalKey,
      device: item.deviceLabel,
      shapeId: item.shapeId || '',
      textureId: item.textureId || '',
      message: item.message || '',
      path: item.path || '',
      sessionId: item.sessionId || '',
      visitorId: item.visitorId || ''
    }));
  }

  async function getTelemetryErrorExportState() {
    const state = telemetryErrorReportState;
    if (!state) return null;
    if (state.sourceMode !== 'remote') return state;
    const fresh = await loadTelemetryErrorReportData({ itemLimit: TELEMETRY_ERROR_EXPORT_ITEM_LIMIT });
    if (fresh && fresh.sourceMode === 'remote') return fresh;
    telemetryErrorReportState = state;
    renderTelemetryErrorReport();
    setTelemetryErrorReportStatus('Полный серверный экспорт не был загружен, поэтому выгружена текущая выборка отчёта.', 'warn');
    return state;
  }

  async function exportTelemetryErrorReportCsv() {
    const current = telemetryErrorReportState;
    if (!current) return;
    if (current.sourceMode === 'remote_failed') {
      setTelemetryErrorReportStatus('Экспорт остановлен: серверная детализация ошибок не загружена. Сначала добейтесь успешной загрузки отчёта.', 'err');
      return;
    }
    const state = await getTelemetryErrorExportState();
    if (!state) return;
    const rows = telemetryErrorExportRows(state.visibleItems);
    const columns = ['time', 'severity', 'category', 'source', 'title', 'technicalKey', 'device', 'shapeId', 'textureId', 'message', 'path', 'sessionId', 'visitorId'];
    const csv = [columns.join(',')].concat(rows.map((row) => columns.map((key) => {
      const value = row[key] == null ? '' : String(row[key]);
      return '"' + value.replace(/"/g, '""') + '"';
    }).join(','))).join('\n');
    downloadTextFile('webar_error_report.csv', csv, 'text/csv;charset=utf-8');
  }

  async function exportTelemetryErrorReportJson() {
    const current = telemetryErrorReportState;
    if (!current) return;
    if (current.sourceMode === 'remote_failed') {
      setTelemetryErrorReportStatus('Экспорт остановлен: серверная детализация ошибок не загружена. Сначала добейтесь успешной загрузки отчёта.', 'err');
      return;
    }
    const state = await getTelemetryErrorExportState();
    if (!state) return;
    downloadJson('webar_error_report.json', {
      exportedAt: new Date().toISOString(),
      scope: {
        sourceMode: state.sourceMode,
        sourceLabel: state.sourceLabel,
        baseFilters: state.baseFilters,
        reportFilters: state.uiFilters,
        truncated: state.truncated,
        generatedAt: state.generatedAt
      },
      items: state.visibleItems.map((item) => ({
        title: item.title,
        technicalKey: item.technicalKey,
        severity: item.severity,
        severityLabel: item.severityLabel,
        category: item.category,
        categoryLabel: item.categoryLabel,
        source: item.source,
        sourceLabel: item.sourceLabel,
        iso: item.iso,
        path: item.path,
        version: item.version,
        sessionId: item.sessionId,
        visitorId: item.visitorId,
        deviceType: item.deviceType,
        deviceLabel: item.deviceLabel,
        shapeId: item.shapeId,
        textureId: item.textureId,
        message: item.message,
        stack: item.stack,
        props: item.details
      }))
    });
  }

  async function clearTelemetryErrorReportCurrent() {
    const state = telemetryErrorReportState;
    if (!state) {
      setTelemetryErrorReportStatus('Сначала загрузите отчёт по ошибкам.', 'warn');
      return;
    }
    if (state.sourceMode === 'remote_failed') {
      setTelemetryErrorReportStatus('Очистка остановлена: детальный серверный отчёт сейчас недоступен.', 'err');
      return;
    }
    const visibleItems = (Array.isArray(state.visibleItems) ? state.visibleItems : []).filter((item) => item && item.id);
    if (!visibleItems.length) {
      setTelemetryErrorReportStatus('В текущем отчёте нет ошибок для очистки.', 'warn');
      return;
    }
    const scopeLabel = state.sourceMode === 'remote' ? 'серверного отчёта' : 'журнала этого браузера';
    const confirmed = await showConfirmModal({
      title: 'Очистить текущие ошибки?',
      subtitle: `Источник: ${scopeLabel}`,
      message: `Будет скрыто ${visibleItems.length} записей по текущим фильтрам.`,
      details: 'Действие применяется только к текущей выборке отчёта и не затрагивает другие записи вне активных фильтров.',
      confirmText: 'Очистить ошибки',
      cancelText: 'Отмена',
      tone: 'danger'
    });
    if (!confirmed) return;

    telemetryTrack('admin_error_report_clear_click', Object.assign({}, getTelemetryFilters(), getTelemetryErrorReportFilters(), {
      sourceMode: state.sourceMode,
      visibleCount: visibleItems.length
    }));

    setTelemetryErrorReportStatus('Очищаем текущие ошибки…', '');

    if (state.sourceMode === 'remote') {
      const payload = {
        scope: {
          sourceLabel: state.sourceLabel,
          baseFilters: state.baseFilters,
          reportFilters: state.uiFilters
        },
        items: visibleItems.map((item) => ({
          id: item.id,
          ts: item.ts,
          name: item.technicalKey || ''
        }))
      };
      const result = telemetry && telemetry.clearRemoteErrorsDetailed ? await telemetry.clearRemoteErrorsDetailed(payload) : { ok: false, message: 'Telemetry clear endpoint is not configured' };
      if (!result || !result.ok) {
        setTelemetryErrorReportStatus(`Не удалось очистить текущие ошибки: ${result && result.message ? result.message : 'неизвестная ошибка'}.`, 'err');
        return;
      }
      await renderTelemetryPanel();
      await loadTelemetryErrorReportData();
      const cleared = Number(result.data && result.data.cleared || 0) || visibleItems.length;
      setTelemetryErrorReportStatus(`Очищено ${cleared} ошибок из текущего серверного отчёта.`, 'ok');
      setTelemetryStatus('Серверный журнал ошибок обновлён: текущая выборка очищена.', 'ok');
      return;
    }

    if (state.sourceMode === 'local') {
      const result = telemetry && telemetry.clearItemsByIds ? telemetry.clearItemsByIds(visibleItems.map((item) => item.id)) : null;
      if (!result || !result.ok) {
        setTelemetryErrorReportStatus('Не удалось очистить текущие ошибки этого браузера.', 'err');
        return;
      }
      await renderTelemetryPanel();
      await loadTelemetryErrorReportData();
      setTelemetryErrorReportStatus(`Очищено ${Number(result.cleared || 0)} ошибок этого браузера.`, 'ok');
      setTelemetryStatus('Журнал ошибок этого браузера очищен по текущей выборке.', 'ok');
      return;
    }

    setTelemetryErrorReportStatus('Очистка для текущего источника данных не поддерживается.', 'warn');
  }

  function isAdminModalVisible(el) {
    return !!(el && !el.hidden);
  }

  function isAdminEditableElement(el) {
    if (!el || el.disabled) return false;
    if (el.readOnly) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(el.type || '').toLowerCase();
      return !/^(button|submit|reset|checkbox|radio|range|file|image|hidden)$/i.test(type);
    }
    return !!el.isContentEditable;
  }

  function syncAdminSwUpdateState() {
    const modalOpen = !!(
      isAdminModalVisible(elTelemetryModal) ||
      isAdminModalVisible(elTelemetryErrorReportModal) ||
      isAdminModalVisible(elConfirmModal) ||
      isAdminModalVisible(elTexModal) ||
      isAdminModalVisible(elBulkModal) ||
      isAdminModalVisible(elMapModal)
    );
    const active = document.activeElement;
    const editing = !!(active && active !== document.body && isAdminEditableElement(active));
    const blocked = modalOpen || editing;
    const reason = modalOpen ? 'admin-modal-open' : (editing ? 'admin-editing-focus' : '');
    window.__SW_UPDATE_STATE__ = {
      blocked,
      reason,
      source: 'admin',
      updatedAt: Date.now()
    };
    if (document && document.documentElement) {
      document.documentElement.setAttribute('data-sw-update-hold', blocked ? '1' : '0');
      if (reason) document.documentElement.setAttribute('data-sw-update-reason', reason);
      else document.documentElement.removeAttribute('data-sw-update-reason');
    }
    try {
      window.dispatchEvent(new CustomEvent('sw-update-statechange', {
        detail: { blocked, reason, source: 'admin' }
      }));
    } catch (_) {}
  }

  function syncAdminModalBodyState() {
    const isOpen = !!(
      isAdminModalVisible(elTelemetryModal) ||
      isAdminModalVisible(elTelemetryErrorReportModal) ||
      isAdminModalVisible(elConfirmModal) ||
      isAdminModalVisible(elTexModal) ||
      isAdminModalVisible(elBulkModal) ||
      isAdminModalVisible(elMapModal)
    );
    document.body.classList.toggle('modal-open', isOpen);
    syncAdminSwUpdateState();
  }

  function closeConfirmModal(result = false) {
    if (!elConfirmModal) return;
    elConfirmModal.hidden = true;
    setStatus(elConfirmModalStatus, '', '');
    if (elConfirmModalConfirmBtn) {
      elConfirmModalConfirmBtn.disabled = false;
      elConfirmModalConfirmBtn.classList.remove('btn--danger');
    }
    if (elConfirmModalConfirmBtn) elConfirmModalConfirmBtn.textContent = 'Подтвердить';
    if (elConfirmModalCancelBtn) elConfirmModalCancelBtn.textContent = 'Отмена';
    if (elConfirmModalTitle) elConfirmModalTitle.textContent = 'Подтвердите действие';
    if (elConfirmModalSubtitle) elConfirmModalSubtitle.textContent = 'Проверьте действие перед продолжением.';
    if (elConfirmModalMessage) elConfirmModalMessage.textContent = '';
    if (elConfirmModalDetails) {
      elConfirmModalDetails.textContent = '';
      elConfirmModalDetails.hidden = true;
    }
    syncAdminModalBodyState();
    const resolver = confirmModalResolve;
    confirmModalResolve = null;
    if (resolver) resolver(Boolean(result));
  }

  function showConfirmModal(options = {}) {
    if (!elConfirmModal) return Promise.resolve(false);
    const opts = options && typeof options === 'object' ? options : {};
    if (confirmModalResolve) {
      const prev = confirmModalResolve;
      confirmModalResolve = null;
      try { prev(false); } catch (_) {}
    }
    if (elConfirmModalTitle) elConfirmModalTitle.textContent = String(opts.title || 'Подтвердите действие');
    if (elConfirmModalSubtitle) elConfirmModalSubtitle.textContent = String(opts.subtitle || 'Проверьте действие перед продолжением.');
    if (elConfirmModalMessage) elConfirmModalMessage.textContent = String(opts.message || '');
    if (elConfirmModalDetails) {
      const details = String(opts.details || '').trim();
      elConfirmModalDetails.textContent = details;
      elConfirmModalDetails.hidden = !details;
    }
    setStatus(elConfirmModalStatus, '', '');
    if (elConfirmModalCancelBtn) elConfirmModalCancelBtn.textContent = String(opts.cancelText || 'Отмена');
    if (elConfirmModalConfirmBtn) {
      elConfirmModalConfirmBtn.textContent = String(opts.confirmText || 'Подтвердить');
      elConfirmModalConfirmBtn.classList.toggle('btn--danger', opts.tone === 'danger');
      elConfirmModalConfirmBtn.disabled = false;
    }
    elConfirmModal.hidden = false;
    syncAdminModalBodyState();
    try { (elConfirmModalConfirmBtn || elConfirmModalCancelBtn || elConfirmModalCloseBtn)?.focus(); } catch (_) {}
    return new Promise((resolve) => {
      confirmModalResolve = resolve;
    });
  }

  function bindConfirmModal() {
    if (!elConfirmModal) return;
    elConfirmModal.querySelectorAll('[data-action="close"]').forEach((el) => {
      el.addEventListener('click', () => closeConfirmModal(false));
    });
    elConfirmModalCloseBtn?.addEventListener('click', () => closeConfirmModal(false));
    elConfirmModalCancelBtn?.addEventListener('click', () => closeConfirmModal(false));
    elConfirmModalConfirmBtn?.addEventListener('click', () => closeConfirmModal(true));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!elConfirmModal.hidden) closeConfirmModal(false);
    });
  }

  document.addEventListener('focusin', () => {
    syncAdminSwUpdateState();
  }, true);
  document.addEventListener('focusout', () => {
    window.setTimeout(syncAdminSwUpdateState, 0);
  }, true);
  document.addEventListener('input', () => {
    syncAdminSwUpdateState();
  }, true);
  document.addEventListener('change', () => {
    syncAdminSwUpdateState();
  }, true);

  const TELEMETRY_KPI_STANDARDS = {
    arStartRate: { direction: 'higher', good: 0.70, warn: 0.50, target: 'Цель ≥ 70%, внимание < 50%' },
    arCompletionRate: { direction: 'higher', good: 0.35, warn: 0.20, target: 'Цель ≥ 35%, внимание < 20%' },
    textureInteractionRate: { direction: 'higher', good: 0.45, warn: 0.25, target: 'Цель ≥ 45%, внимание < 25%' },
    ctaClickRate: { direction: 'higher', good: 0.08, warn: 0.03, target: 'Цель ≥ 8%, внимание < 3%' },
    adminCalibrationUsage: { direction: 'higher', good: 0.40, warn: 0.15, target: 'Цель ≥ 40%, внимание < 15%' },
    errorRatePerSession: { direction: 'lower', good: 0.10, warn: 0.25, target: 'Цель ≤ 0.10, риск > 0.25' }
  };

  function evaluateTelemetryKpi(key, value, basisCount) {
    const cfg = TELEMETRY_KPI_STANDARDS[key] || null;
    if (!cfg) return { status: 'nodata', label: 'Нет стандарта', target: '' };
    if (!(Number(basisCount || 0) > 0)) return { status: 'nodata', label: 'Нет базы', target: cfg.target };
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return { status: 'nodata', label: 'Нет данных', target: cfg.target };
    if (cfg.direction === 'lower') {
      if (n <= cfg.good) return { status: 'good', label: 'Норма', target: cfg.target };
      if (n <= cfg.warn) return { status: 'warn', label: 'Внимание', target: cfg.target };
      return { status: 'risk', label: 'Риск', target: cfg.target };
    }
    if (n >= cfg.good) return { status: 'good', label: 'Норма', target: cfg.target };
    if (n >= cfg.warn) return { status: 'warn', label: 'Внимание', target: cfg.target };
    return { status: 'risk', label: 'Риск', target: cfg.target };
  }

  function renderTelemetryKpiCard(key, label, valueText, subText, basisCount, rawValue) {
    const verdict = evaluateTelemetryKpi(key, rawValue, basisCount);
    const card = createAdminNode('div', { className: `telemetryKpi telemetryKpi--${verdict.status}` });
    const head = createAdminNode('div', { className: 'telemetryKpi__head' });
    appendAdminChildren(
      head,
      createAdminNode('div', { className: 'telemetryKpi__label', text: label }),
      createTelemetryBadge(`telemetryKpi__badge telemetryKpi__badge--${verdict.status}`, verdict.label)
    );
    appendAdminChildren(
      card,
      head,
      createAdminNode('div', { className: 'telemetryKpi__value', text: String(valueText || '—') }),
      createAdminNode('div', { className: 'telemetryKpi__sub', text: subText || '' }),
      createAdminNode('div', { className: 'telemetryKpi__target', text: verdict.target || '' })
    );
    return card;
  }

  function formatTelemetryTopList(items, emptyLabel, opts) {
    const arr = Array.isArray(items) ? items : [];
    const mode = opts && opts.mode ? String(opts.mode) : 'default';
    if (!arr.length) return [createAdminNode('div', { className: 'muted', text: emptyLabel || '—' })];
    return arr.map((item) => {
      const label = mode === 'events' ? telemetryEventLabel(String(item.name || item.id || '')) : String(item.name || item.id || '—');
      return createAdminPanelItem(label, item.sessions || item.count || 0);
    });
  }

  function renderTelemetryFunnel(funnel, sourceLabel) {
    const data = funnel && Array.isArray(funnel.steps) ? funnel.steps : [];
    const panel = createAdminNode('div', { className: 'telemetryPanel' });
    appendAdminChildren(panel, createAdminNode('div', { className: 'telemetryPanel__label', text: `Воронка AR (${sourceLabel})` }));
    if (!data.length) {
      panel.appendChild(createAdminNode('div', { className: 'muted', text: 'Пока нет данных по воронке AR' }));
      return panel;
    }
    panel.appendChild(createAdminNode('div', { className: 'telemetryPanel__sub', text: 'Показывает путь от клика по запуску AR до готовой визуализации' }));
    const list = createAdminNode('div', { className: 'telemetryPanel__list' });
    const maxValue = Math.max(...data.map((step) => Number(step.sessions || 0)), 1);
    data.forEach((step) => {
      const width = Math.max(6, Math.round((Number(step.sessions || 0) / maxValue) * 100));
      const conv = formatTelemetryPercent(step.conversionFromLaunch);
      const stepConv = formatTelemetryPercent(step.conversionFromPrev);
      const row = createAdminNode('div', { className: 'telemetryFunnelStep' });
      const bar = createAdminNode('div', { className: 'telemetryFunnelStep__bar' });
      const fill = createAdminNode('div', { className: 'telemetryFunnelStep__fill' });
      fill.style.width = `${width}%`;
      bar.appendChild(fill);
      const meta = createAdminNode('div', { className: 'telemetryFunnelStep__meta' });
      meta.appendChild(createAdminNode('b', { text: step.sessions || 0 }));
      meta.appendChild(createAdminNode('br'));
      meta.appendChild(createAdminNode('span', { className: 'muted', text: `от запуска ${conv} · шаг ${stepConv}` }));
      appendAdminChildren(
        row,
        createAdminNode('div', { className: 'telemetryFunnelStep__label', text: step.label || '—' }),
        bar,
        meta
      );
      list.appendChild(row);
    });
    panel.appendChild(list);
    return panel;
  }

  function renderTelemetryDevices(devices, sourceLabel) {
    const arr = Array.isArray(devices) ? devices : [];
    const panel = createAdminNode('div', { className: 'telemetryPanel' });
    appendAdminChildren(panel, createAdminNode('div', { className: 'telemetryPanel__label', text: `Сегментация по устройствам (${sourceLabel})` }));
    if (!arr.length) {
      panel.appendChild(createAdminNode('div', { className: 'muted', text: 'Пока нет данных по устройствам' }));
      return panel;
    }
    panel.appendChild(createAdminNode('div', { className: 'telemetryPanel__sub', text: 'Сессии, запуск AR, завершение визуализации и ошибки по типу устройства' }));
    const grid = createAdminNode('div', { className: 'telemetryDeviceGrid' });
    arr.forEach((item) => {
      const card = createAdminNode('div', { className: 'telemetryDeviceCard' });
      const head = createAdminNode('div', { className: 'telemetryDeviceCard__head' });
      appendAdminChildren(
        head,
        createAdminNode('span', { className: 'telemetryDeviceCard__name', text: telemetryDeviceLabel(item.deviceType) }),
        createAdminNode('span', { className: 'muted', text: String(item.shareLabel || '') })
      );
      const meta = createAdminNode('div', { className: 'telemetryDeviceCard__meta' });
      [
        ['Сессий', item.sessions || 0],
        ['Запустили AR', item.arLaunchSessions || 0],
        ['Вошли в AR', item.arStartedSessions || 0],
        ['Дошли до заливки', item.arCompletedSessions || 0],
        ['Конверсия в заливку', formatTelemetryPercent(item.arCompletionRate)],
        ['Ошибок на сессию', formatTelemetryFloat(item.errorRatePerSession)],
      ].forEach(([label, value]) => {
        const line = createAdminNode('div');
        line.append(label);
        line.appendChild(createAdminNode('b', { text: value }));
        meta.appendChild(line);
      });
      appendAdminChildren(card, head, meta);
      grid.appendChild(card);
    });
    panel.appendChild(grid);
    return panel;
  }

  function renderTelemetryAudience(audience, sourceLabel) {
    const data = audience || {};
    const cards = [
      ['Уникальные посетители', data.uniqueVisitors || 0, 'Уникальные браузеры/устройства за выбранный период'],
      ['Сессии', data.sessions || 0, 'Все отдельные визиты пользователей'],
      ['Повторные заходы', data.repeatVisits || 0, 'Дополнительные сессии с тех же устройств'],
      ['Возвращающиеся устройства', data.returningVisitors || 0, `${formatTelemetryPercent(data.repeatVisitorRate)} от всех уникальных устройств`],
      ['Сессий на устройство', formatTelemetryFloat(data.avgSessionsPerVisitor), 'Среднее число сессий на 1 устройство']
    ];
    const panel = createAdminNode('div', { className: 'telemetryPanel telemetryPanel--hero' });
    appendAdminChildren(
      panel,
      createAdminNode('div', { className: 'telemetryPanel__label', text: `Аудитория и посещаемость (${sourceLabel})` }),
      createAdminNode('div', { className: 'telemetryPanel__sub', text: 'В метрика-подобной сводке: уникальные устройства, сессии и повторные визиты' })
    );
    const grid = createAdminNode('div', { className: 'telemetryAudienceGrid' });
    cards.forEach(([label, value, hint]) => {
      const card = createAdminNode('div', { className: 'telemetryHeroStat' });
      appendAdminChildren(
        card,
        createAdminNode('div', { className: 'telemetryHeroStat__label', text: String(label) }),
        createAdminNode('div', { className: 'telemetryHeroStat__value', text: String(value) }),
        createAdminNode('div', { className: 'telemetryHeroStat__hint', text: String(hint || '') })
      );
      grid.appendChild(card);
    });
    panel.appendChild(grid);
    return panel;
  }

  function pickTelemetrySeries(timeSeries, days) {
    const series = timeSeries || {};
    if (Number(days || 7) >= 365) return { mode: 'year', label: 'Годы', items: Array.isArray(series.byYear) ? series.byYear : [] };
    if (Number(days || 7) >= 90) return { mode: 'quarter', label: 'Кварталы', items: Array.isArray(series.byQuarter) ? series.byQuarter : [] };
    if (Number(days || 7) >= 30) return { mode: 'month', label: 'Месяцы', items: Array.isArray(series.byMonth) ? series.byMonth : [] };
    return { mode: 'day', label: 'Дни', items: Array.isArray(series.byDay) ? series.byDay : [] };
  }

  function renderTelemetryDynamics(timeSeries, days, sourceLabel) {
    const picked = pickTelemetrySeries(timeSeries, days);
    const arr = Array.isArray(picked.items) ? picked.items : [];
    const panel = createAdminNode('div', { className: 'telemetryPanel' });
    appendAdminChildren(panel, createAdminNode('div', { className: 'telemetryPanel__label', text: `Динамика (${sourceLabel})` }));
    if (!arr.length) {
      panel.appendChild(createAdminNode('div', { className: 'muted', text: 'Пока нет данных по выбранному периоду' }));
      return panel;
    }
    panel.appendChild(createAdminNode('div', { className: 'telemetryPanel__sub', text: `Сессии, уникальные посетители и ошибки по шкале «${picked.label}»` }));
    const list = createAdminNode('div', { className: 'telemetryTrendList' });
    const maxSessions = Math.max(...arr.map((item) => Number(item.sessions || 0)), 1);
    arr.forEach((item) => {
      const width = Math.max(6, Math.round((Number(item.sessions || 0) / maxSessions) * 100));
      const row = createAdminNode('div', { className: 'telemetryTrendRow' });
      const bar = createAdminNode('div', { className: 'telemetryTrendRow__bar' });
      const fill = createAdminNode('div', { className: 'telemetryTrendRow__fill' });
      fill.style.width = `${width}%`;
      bar.appendChild(fill);
      const meta = createAdminNode('div', { className: 'telemetryTrendRow__meta' });
      [
        ['Сессии', item.sessions || 0],
        ['Уникальные', item.uniqueVisitors || 0],
        ['Ошибки', item.errors || 0],
      ].forEach(([label, value]) => {
        const line = createAdminNode('div');
        line.append(label + ' ');
        line.appendChild(createAdminNode('b', { text: value }));
        meta.appendChild(line);
      });
      appendAdminChildren(
        row,
        createAdminNode('div', { className: 'telemetryTrendRow__label', text: String(item.label || item.key || '—') }),
        bar,
        meta
      );
      list.appendChild(row);
    });
    panel.appendChild(list);
    return panel;
  }


  async function renderTelemetryPanel() {
    if (!elTelemetryCard || !telemetry) return;
    if (elTelemetryPeriodSelect && !elTelemetryPeriodSelect.value) elTelemetryPeriodSelect.value = '7';
    if (elTelemetryDeviceSelect && !elTelemetryDeviceSelect.value) elTelemetryDeviceSelect.value = 'all';
    const filters = getTelemetryFilters();
    const summary = telemetry.getSummary ? telemetry.getSummary(filters) : { total: 0, events: 0, errors: 0, pending: 0, endpoint: '' };
    const localDashboard = telemetry.getDashboardSummary ? telemetry.getDashboardSummary(filters) : null;
    const recent = telemetry.getRecent ? telemetry.getRecent(18, filters) : [];
    const topNames = Object.entries(summary.byName || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${telemetryEventLabel(name)} × ${count}`).join(' · ');

    let remote = null;
    let remoteSummaryFailureMessage = '';
    try {
      const remotePayload = await loadRemoteTelemetrySummary(filters);
      if (remotePayload && remotePayload.ok) remote = remotePayload.data || null;
      else remoteSummaryFailureMessage = formatTelemetrySummaryFailureMessage(remotePayload && remotePayload.result);
    } catch (err) {
      remote = null;
      remoteSummaryFailureMessage = err && err.message ? String(err.message) : 'серверная сводка временно недоступна';
    }

    const remoteEventCount = remote && remote.totals ? Number(remote.totals.events || 0) : 0;
    const remoteErrorCount = remote && remote.totals ? Number(remote.totals.errors || 0) : 0;
    const remoteBatchCount = remote && remote.totals ? Number(remote.totals.batches || 0) : 0;
    const remoteSessions = remote && remote.totals ? Number(remote.totals.sessions || 0) : 0;
    const remoteTop = Array.isArray(remote && remote.byName)
      ? remote.byName.slice(0, 3).map((entry) => `${telemetryEventLabel(entry.name)} × ${entry.count}`).join(' · ')
      : '';

    const dashboard = (remote && remote.dashboard) ? remote.dashboard : (localDashboard || null);
    const metrics = dashboard && dashboard.metrics ? dashboard.metrics : {};
    const sessions = dashboard && dashboard.sessionMetrics ? dashboard.sessionMetrics : {};
    const audience = dashboard && dashboard.audience ? dashboard.audience : {};
    const kpis = dashboard && dashboard.kpis ? dashboard.kpis : {};
    const sourceLabel = telemetrySourceLabel((remote && remote.dashboard) ? 'сводная аналитика' : 'данные этого браузера', filters);
    const localSync = telemetry && telemetry.getSyncStatus ? telemetry.getSyncStatus() : { pending: summary.pending || 0, totalLocal: summary.total || 0 };

    if (elTelemetrySources) {
      elTelemetrySources.replaceChildren(...renderTelemetrySources(localSync, remote, sourceLabel));
    }

    if (elTelemetryStats) {
      const stats = [
        { label: 'AR запусков', value: metrics.arLaunches || 0 },
        { label: 'Успешный вход AR', value: metrics.arStarted || 0 },
        { label: 'Дошли до заливки', value: metrics.arCompleted || 0 },
        { label: 'Смен текстуры', value: metrics.textureChanges || 0 },
        { label: 'Связь с менеджером', value: metrics.managerCtaClicks || 0 },
        { label: 'Уникальных посетителей', value: audience.uniqueVisitors || sessions.uniqueVisitors || 0 },
        { label: 'Сессий', value: remote && remote.dashboard ? remoteSessions : (sessions.sessions || 0) },
        { label: 'Повторных заходов', value: audience.repeatVisits || sessions.repeatVisits || 0 },
        { label: 'Ошибок', value: remote ? remoteErrorCount : (metrics.errors || summary.errors || 0), interactive: true, sub: 'Нажмите, чтобы открыть подробный отчёт по ошибкам' },
        { label: 'Не передано с этого устройства', value: summary.pending || 0 },
      ];
      const statNodes = stats.map((item) => {
        const card = createAdminNode('div', {
          className: `telemetryStat${item.interactive ? ' telemetryStat--interactive' : ''}`,
          attrs: item.interactive ? { role: 'button', tabindex: '0', 'data-error-report': '1' } : {}
        });
        appendAdminChildren(
          card,
          createAdminNode('div', { className: 'telemetryStat__label', text: item.label }),
          createAdminNode('div', { className: 'telemetryStat__value', text: item.value })
        );
        if (item.interactive) {
          appendAdminChildren(
            card,
            createAdminNode('div', { className: 'telemetryStat__sub', text: item.sub || '' }),
            createAdminNode('button', { className: 'telemetryStat__cta', text: 'Подробнее', attrs: { type: 'button', 'data-action': 'open-error-report' } })
          );
        }
        return card;
      });
      elTelemetryStats.replaceChildren(...statNodes);
    }

    if (elTelemetryAudience) {
      elTelemetryAudience.replaceChildren(renderTelemetryAudience(audience, sourceLabel));
    }

    if (elTelemetryKpis) {
      elTelemetryKpis.replaceChildren(
        renderTelemetryKpiCard('arStartRate', 'Конверсия запуска AR', formatTelemetryPercent(kpis.arStartRate), `${sessions.arStartedSessions || 0} из ${sessions.arLaunchSessions || 0} сессий с кликом по AR`, sessions.arLaunchSessions || 0, kpis.arStartRate),
        renderTelemetryKpiCard('arCompletionRate', 'Конверсия до заливки', formatTelemetryPercent(kpis.arCompletionRate), `${sessions.arCompletedSessions || 0} из ${sessions.arLaunchSessions || 0} сессий с запуском AR`, sessions.arLaunchSessions || 0, kpis.arCompletionRate),
        renderTelemetryKpiCard('textureInteractionRate', 'Интеракция с текстурами', formatTelemetryPercent(kpis.textureInteractionRate), `${sessions.textureInteractionSessions || 0} из ${sessions.arCompletedSessions || 0} сессий с готовой визуализацией`, sessions.arCompletedSessions || 0, kpis.textureInteractionRate),
        renderTelemetryKpiCard('ctaClickRate', 'CTR «Связь с менеджером»', formatTelemetryPercent(kpis.ctaClickRate), `${sessions.managerCtaSessions || 0} сессий с менеджерским CTA`, sessions.sessions || 0, kpis.ctaClickRate),
        renderTelemetryKpiCard('adminCalibrationUsage', 'Использование AR-калибровки', formatTelemetryPercent(kpis.adminCalibrationUsage), `${sessions.adminCalibrationSessions || 0} админ-сессий с калибровкой`, sessions.adminSessions || 0, kpis.adminCalibrationUsage),
        renderTelemetryKpiCard('errorRatePerSession', 'Ошибок на сессию', formatTelemetryFloat(kpis.errorRatePerSession), `${formatTelemetryPercent(kpis.errorSessionRate)} сессий содержали ошибки`, sessions.sessions || 0, kpis.errorRatePerSession),
      );
    }

    if (elTelemetryDynamics) {
      elTelemetryDynamics.replaceChildren(renderTelemetryDynamics(dashboard && dashboard.timeSeries, filters.days, sourceLabel));
    }

    if (elTelemetryBreakdown) {
      const shapePanel = createAdminNode('div', { className: 'telemetryPanel' });
      appendAdminChildren(
        shapePanel,
        createAdminNode('div', { className: 'telemetryPanel__label', text: `Топ форм по взаимодействиям (${sourceLabel})` }),
        appendAdminChildren(createAdminNode('div', { className: 'telemetryPanel__list' }), ...formatTelemetryTopList(dashboard && dashboard.topShapes, 'Пока нет данных по формам'))
      );
      const texturePanel = createAdminNode('div', { className: 'telemetryPanel' });
      appendAdminChildren(
        texturePanel,
        createAdminNode('div', { className: 'telemetryPanel__label', text: `Топ текстур по взаимодействиям (${sourceLabel})` }),
        appendAdminChildren(createAdminNode('div', { className: 'telemetryPanel__list' }), ...formatTelemetryTopList(dashboard && dashboard.topTextures, 'Пока нет данных по текстурам'))
      );
      elTelemetryBreakdown.replaceChildren(shapePanel, texturePanel);
    }

    if (elTelemetryFunnel) {
      elTelemetryFunnel.replaceChildren(renderTelemetryFunnel(dashboard && dashboard.funnel, sourceLabel));
    }

    if (elTelemetryDevices) {
      elTelemetryDevices.replaceChildren(renderTelemetryDevices(dashboard && dashboard.deviceSegments, sourceLabel));
    }

    const telemetryStatusBits = [`Сейчас показаны данные: ${sourceLabel}.`, `Не передано с этого устройства: ${summary.pending || 0}.`, `Последнее обновление общей сводки: ${remote && remote.generatedAt ? formatTelemetryDateTime(remote.generatedAt) : 'нет данных'}.`];
    if (remote && (remote.partial || (remote.scan && remote.scan.stopReason))) telemetryStatusBits.push('Серверная сводка собрана в облегчённом режиме, чтобы не упираться в timeout.');
    if (!remote && remoteSummaryFailureMessage) telemetryStatusBits.push(`Причина недоступности серверной сводки: ${remoteSummaryFailureMessage}.`);
    setTelemetryStatus(telemetryStatusBits.join(' '), ((!remote && remoteSummaryFailureMessage) || (summary.pending || 0) > 0) ? 'warn' : '');

    if (elTelemetryList) {
      const parts = [];
      if (remote) {
        const topErrors = Array.isArray(remote.topErrors) ? remote.topErrors.slice(0, 5) : [];
        const hint = createAdminNode('div', { className: 'hint mtSm' });
        hint.appendChild(createAdminNode('b', { text: 'Сводка с сервера' }));
        hint.appendChild(createAdminNode('br'));
        hint.append(`Пакеты данных: ${remoteBatchCount || 0}`);
        if (remote && remote.scan && remote.scan.scannedBatches) {
          hint.appendChild(createAdminNode('br'));
          hint.append(`Скан по серверу: ${remote.scan.scannedBatches} пакетов, лимит на день ${remote.scan.appliedLimitPerDay || '—'}`);
        }
        hint.appendChild(createAdminNode('br'));
        hint.append(`Главные события: ${remoteTop || '—'}`);
        hint.appendChild(createAdminNode('br'));
        hint.append(`Частые ошибки: ${topErrors.map((entry) => `${telemetryEventLabel(entry.name)} × ${entry.count}`).join(' · ') || '—'}`);
        hint.appendChild(createAdminNode('br'));
        hint.append(`Главные события этого браузера: ${topNames || '—'}`);
        parts.push(hint);
      }
      if (!recent.length) {
        parts.push(createAdminNode('div', { className: 'muted', text: 'Событий на этом устройстве по выбранным фильтрам пока нет.' }));
      } else {
        recent.slice().reverse().forEach((item) => {
          const kind = item.kind === 'error' ? 'telemetryItem telemetryItem--error' : 'telemetryItem';
          const meta = [];
          if (item.iso) meta.push(item.iso.replace('T', ' ').replace('Z', ''));
          if (item.sessionId) meta.push(item.sessionId);
          if (item.props && item.props.deviceType) meta.push(telemetryDeviceLabel(item.props.deviceType));
          const wrapper = createAdminNode('div', { className: kind });
          const head = createAdminNode('div', { className: 'telemetryItem__head' });
          appendAdminChildren(
            head,
            createAdminNode('div', { className: 'telemetryItem__name', text: telemetryEventLabel(item.name) }),
            createAdminNode('div', { className: 'telemetryItem__meta', text: meta.join(' · ') })
          );
          appendAdminChildren(
            wrapper,
            head,
            createAdminNode('div', { className: 'telemetryItem__body', text: JSON.stringify(item.props || {}, null, 2) })
          );
          parts.push(wrapper);
        });
      }
      elTelemetryList.replaceChildren(...parts);
    }
  }


  function showTelemetryModal(open) {
    if (!elTelemetryModal) return;
    elTelemetryModal.hidden = !open;
    syncAdminModalBodyState();
  }

  function showTelemetryErrorReportModal(open) {
    if (!elTelemetryErrorReportModal) return;
    elTelemetryErrorReportModal.hidden = !open;
    syncAdminModalBodyState();
  }

  async function openTelemetryModal() {
    if (elMainCard && elMainCard.hidden) return;
    showTelemetryModal(true);
    telemetryTrack('admin_telemetry_open', getTelemetryFilters());
    try { await renderTelemetryPanel(); } catch (_) {}
  }

  async function openTelemetryErrorReportModal() {
    if (elMainCard && elMainCard.hidden) return;
    showTelemetryErrorReportModal(true);
    telemetryTrack('admin_error_report_open', Object.assign({}, getTelemetryFilters(), getTelemetryErrorReportFilters()));
    try { await loadTelemetryErrorReportData(); } catch (e) {
      telemetryError('admin_error_report_render_failed', e, getTelemetryFilters());
      setTelemetryErrorReportStatus('Не удалось построить отчёт по ошибкам.', 'err');
    }
  }

  function closeTelemetryErrorReportModal() {
    showTelemetryErrorReportModal(false);
  }

  function closeTelemetryModal() {
    closeTelemetryErrorReportModal();
    showTelemetryModal(false);
  }


  async function showLoggedInUI(isLoggedIn) {
    elLoginCard.hidden = !!isLoggedIn;
    elMainCard.hidden = !isLoggedIn;
    if (elTelemetryCard) elTelemetryCard.hidden = !isLoggedIn;
    if (elLinkPaletteValidator) elLinkPaletteValidator.hidden = !isLoggedIn;
    if (!isLoggedIn) closeTelemetryModal();
    if (isLoggedIn) renderTelemetryPanel();
  }

  async function login(username, password) {
    telemetryTrack('admin_login_attempt', { username: String(username || '') });
    setStatus(elLoginStatus, '', `Подключение к API: ${API_BASE_URL} ...`);
    const json = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!json?.token) throw new Error('Не получили token от backend');
    setToken(json.token);
  }

  function parseRoute() {
    const h = (location.hash || '').replace(/^#/, '');
    const parts = h.split('/').filter(Boolean);
    // Supported:
    //  - #/forms
    //  - #/shape/<id>/<tab>
    if (parts.length === 0) return { name: 'forms' };
    if (parts[0] === 'forms') return { name: 'forms' };
    if (parts[0] === 'shape') {
      return {
        name: 'shape',
        id: parts[1] || '',
        tab: parts[2] || 'textures',
      };
    }
    return { name: 'forms' };
  }

  function setActiveTab(tab) {
    const panes = {
      textures: elPaneTextures,
      upload: elPaneUpload,
      settings: elPaneSettings,
    };
    for (const [k, el] of Object.entries(panes)) {
      if (!el) continue;
      el.hidden = k !== tab;
    }
    if (elShapeTabs) {
      for (const btn of elShapeTabs.querySelectorAll('.tab')) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      }
    }
  }

  function showView(name) {
    elViewShapes.hidden = name !== 'forms';
    elViewShape.hidden = name !== 'shape';
  }

  function renderShapesList(filterText = '') {
    const q = (filterText || '').trim().toLowerCase();
    const shapes = state.shapes || [];
    const filtered = !q
      ? shapes
      : shapes.filter(s => {
          const id = String(s?.id || '').toLowerCase();
          const name = String(s?.name || '').toLowerCase();
          return id.includes(q) || name.includes(q);
        });

    elShapesGrid.replaceChildren();
    elShapesEmpty.style.display = filtered.length ? 'none' : 'block';

    const frag = document.createDocumentFragment();
    for (const sh of filtered) {
      const id = sh?.id || '';
      const name = sh?.name || id;
      const desc = sh?.description || '';
      const icon = normalizeAdminSafeUrl(resolveSiteUrl(sh?.icon || sh?.hero || ''));

      const card = document.createElement('div');
      card.className = 'shapeCard';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;

      const thumb = document.createElement('div');
      thumb.className = 'shapeThumb';
      if (icon) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        setAdminSafeImageSource(img, icon);
        img.addEventListener('error', () => {
          try { img.style.display = 'none'; } catch {}
        });
        thumb.appendChild(img);
      }

      const body = document.createElement('div');
      body.className = 'shapeBody';

      const nameEl = document.createElement('div');
      nameEl.className = 'shapeName';
      nameEl.textContent = name;

      const idEl = document.createElement('div');
      idEl.className = 'shapeId';
      idEl.textContent = id;

      const descEl = document.createElement('div');
      descEl.className = 'shapeDesc';
      descEl.textContent = desc;

      body.append(nameEl, idEl, descEl);
      card.append(thumb, body);

      const go = () => {
        location.hash = `#/shape/${encodeURIComponent(id)}/textures`;
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      frag.appendChild(card);
    }
    elShapesGrid.appendChild(frag);
  }

  function renderShapeHeader(shape) {
    const id = shape?.id || '';
    const name = shape?.name || id;
    const hero = normalizeAdminSafeUrl(resolveSiteUrl(shape?.hero || shape?.icon || ''));
    const desc = shape?.description || '';

    elShapeTitle.textContent = id ? `shapeId: ${id}` : '';
    elShapeHeader.replaceChildren();

    if (hero) {
      const img = document.createElement('img');
      img.className = 'shapeHero';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      setAdminSafeImageSource(img, hero);
      img.addEventListener('error', () => {
        try { img.style.display = 'none'; } catch {}
      });
      elShapeHeader.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'shapeInfo';

    const hName = document.createElement('div');
    hName.className = 'hName';
    hName.textContent = name;

    const hMeta = document.createElement('div');
    hMeta.className = 'hMeta';
    hMeta.textContent = id;

    info.append(hName, hMeta);
    if (desc) {
      const hDesc = document.createElement('div');
      hDesc.className = 'hDesc';
      hDesc.textContent = desc;
      info.appendChild(hDesc);
    }

    elShapeHeader.appendChild(info);
  }

  function getSelectedSet(shapeId) {
    if (!shapeId) return new Set();
    if (!state.selectedTextureIdsByShapeId.has(shapeId)) {
      state.selectedTextureIdsByShapeId.set(shapeId, new Set());
    }
    return state.selectedTextureIdsByShapeId.get(shapeId);
  }

  function updateBulkBar(shapeId, totalCount) {
    if (!elBulkBar) return;
    const sel = getSelectedSet(shapeId);
    const n = sel.size;
    if (elBulkSelectedCount) elBulkSelectedCount.textContent = `Выбрано: ${n}`;
    if (elBulkSelectAll) {
      elBulkSelectAll.checked = totalCount > 0 && n === totalCount;
      elBulkSelectAll.indeterminate = n > 0 && n < totalCount;
    }
    elBulkResetBtn && (elBulkResetBtn.disabled = n === 0);
    elBulkEditBtn && (elBulkEditBtn.disabled = (n === 0 && totalCount === 0));
  }

  function renderTextures(shapeId, items) {
    elTexturesGrid.replaceChildren();
    const list = Array.isArray(items) ? items : [];
    elEmptyTextures.style.display = list.length ? 'none' : 'block';
    updateBulkBar(shapeId, list.length);
    if (!list.length) return;

    const frag = document.createDocumentFragment();
    for (const it of list) {
      const id = it?.id || it?.textureId || '';
      const name = it?.name || id || '(без названия)';
      const previewSource = pickMediaUrl([
        it?.maps?.albedoUrl,
        it?.maps?.albedo,
        it?.previewUrl,
        it?.preview,
      ], { shapeId, textureId: id, quality: '1k' });
      const previewUrl = normalizeAdminSafeUrl(previewSource);

      const hasTileOverride = !!it?.tileSizeM;
      const hasParams = it?.params && typeof it.params === 'object' && Object.keys(it.params).length > 0;
      const selected = getSelectedSet(shapeId).has(id);

      const card = document.createElement('div');
      card.className = 'tile';

      const selectWrap = document.createElement('label');
      selectWrap.className = 'tileSelect';
      selectWrap.title = 'Выбрать текстуру для массового редактирования';
      const selCb = document.createElement('input');
      selCb.type = 'checkbox';
      selCb.dataset.action = 'select';
      selCb.dataset.id = id;
      selCb.checked = selected;
      const selDecor = document.createElement('span');
      selectWrap.append(selCb, selDecor);

      const img = document.createElement('img');
      img.className = 'thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      if (!setAdminSafeImageSource(img, previewUrl)) img.style.display = 'none';
      img.addEventListener('error', () => {
        try { img.style.display = 'none'; } catch {}
      });

      const meta = document.createElement('div');
      meta.className = 'meta';

      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = name;

      const idEl = document.createElement('div');
      idEl.className = 'id';
      idEl.textContent = id;

      const pillsEl = document.createElement('div');
      pillsEl.className = 'muted mtSm';
      const pillTile = document.createElement('span');
      pillTile.className = hasTileOverride ? 'pill pill--set' : 'pill';
      pillTile.textContent = hasTileOverride ? 'tileSize' : 'tileSize: default';
      const pillParams = document.createElement('span');
      pillParams.className = hasParams ? 'pill pill--set' : 'pill';
      pillParams.textContent = hasParams ? 'params' : 'params: default';
      const pillPreview = document.createElement('span');
      pillPreview.className = previewUrl ? 'pill' : 'pill pill--warn';
      pillPreview.textContent = previewUrl ? 'preview' : 'без preview';
      pillsEl.append(pillTile, document.createTextNode(' '), pillParams, document.createTextNode(' '), pillPreview);

      const actions = document.createElement('div');
      actions.className = 'row tileActions';
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn--ghost btn--sm';
      btnEdit.dataset.action = 'edit';
      btnEdit.dataset.id = id;
      btnEdit.type = 'button';
      btnEdit.textContent = 'Настроить';
      const btnUpdate = document.createElement('button');
      btnUpdate.className = 'btn btn--ghost btn--sm';
      btnUpdate.dataset.action = 'update';
      btnUpdate.dataset.id = id;
      btnUpdate.type = 'button';
      btnUpdate.title = 'Перезагрузить файлы карты (обновить текущую текстуру)';
      btnUpdate.textContent = 'Обновить файлы';
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn--danger btn--sm';
      btnDelete.dataset.action = 'delete';
      btnDelete.dataset.id = id;
      btnDelete.type = 'button';
      btnDelete.title = 'Удалить текстуру';
      btnDelete.textContent = 'Удалить';
      actions.append(btnEdit, btnUpdate, btnDelete);

      meta.append(nameEl, idEl, pillsEl, actions);
      card.append(selectWrap, img, meta);

      selCb.addEventListener('change', () => {
        const set = getSelectedSet(shapeId);
        if (selCb.checked) set.add(id);
        else set.delete(id);
        updateBulkBar(shapeId, list.length);
      });
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = parseRoute();
        if (r.name !== 'shape') return;
        const shapeId = decodeURIComponent(r.id || '');
        telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
        openTextureParamsModal(shapeId, id).catch(err => {
          console.warn(err);
          setStatus(elPaletteStatus, 'err', `Не удалось открыть редактор: ${err.message}`);
        });
      });

      btnUpdate.addEventListener('click', (e) => {
        e.stopPropagation();
        goToUpdateUpload(shapeId, id);
      });

      btnDelete.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteTextureFlow(shapeId, id).catch(err => {
          console.warn(err);
          setStatus(elPaletteStatus, 'err', `Не удалось удалить: ${err.message}`);
        });
      });
      frag.appendChild(card);
    }
    elTexturesGrid.appendChild(frag);
  }

  function goToUpdateUpload(shapeId, textureId) {
    clearUploadUI();
    setUploadModeUpdate(shapeId, textureId);
    // Switch to Upload tab.
    location.hash = `#/shape/${encodeURIComponent(shapeId)}/upload`;
    // renderRoute will run on hashchange, but also run immediately for better UX.
    renderRoute().catch(() => {});
  }
  async function deleteTextureFlow(shapeId, textureId) {
    const okPalette = await showConfirmModal({
      title: 'Удалить текстуру?',
      subtitle: `Форма: ${shapeId}`,
      message: `Текстура "${textureId}" будет удалена из палитры и из бакета.`,
      details: 'Используйте это действие только если текстура больше не нужна в рабочей библиотеке формы.',
      confirmText: 'Удалить текстуру',
      cancelText: 'Отмена',
      tone: 'danger'
    });
    if (!okPalette) return;
    // Пользовательский сценарий: удаляем "по всем фронтам" всегда.
    const alsoBucket = true;
  
// Config sanity check: the most common root cause of “DELETE 200 but not deleted”
// is that backend writes/deletes to another bucket than the UI reads from.
try {
  const cfg = await apiGetConfig();
  if (cfg?.public?.bucketMismatch) {
    setStatus(elPaletteStatus, 'error',
      `Конфиг неконсистентен: backend пишет/удаляет в бакет "${cfg.s3.bucket}", а UI читает из "${cfg.public.expectedBucketFromPublicUrl}". ` +
      `Исправьте env (S3_BUCKET / PALETTES_BASE_URL / SURFACES_PUBLIC_BASE_URL), затем повторите удаление.`);
    return;
  }
} catch (e) {
  // If config endpoint is not available, backend will still validate on the DELETE call.
  console.warn('apiGetConfig failed', e);
}

        setStatusRich(elPaletteStatus, '', {
      title: 'Удаляем текстуру…',
      message: `Форма: ${shapeId} • Текстура: ${textureId}`,
      note: 'Обновляем палитру и удаляем связанные файлы из бакета, если backend это поддерживает.',
    });
    // На backend реализован резолв папок в бакете по textureId (с учётом префиксов),
    // поэтому передаём ровно то значение, которое отображается в админке.
    const res = await apiDeleteTexture(shapeId, textureId, { palette: true, files: alsoBucket });
    if (!res?.ok) {
      const msg = res?.message || 'Delete failed';
      setStatusRich(elPaletteStatus, 'err', {
        title: 'Не удалось удалить текстуру',
        message: msg,
        meta: [`Форма: ${shapeId}`, `Текстура: ${textureId}`],
      });
      renderTelemetryPanel();
      return;
    }
  
    // Refresh caches/UI
    state.paletteByShapeId.delete(shapeId);
    try { state.bucketIndexByShapeId.delete(shapeId); } catch {}
    try { await ensureBucketIndexLoaded(shapeId); } catch {}
    const fresh = await ensurePaletteLoaded(shapeId);
    renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);
    renderBucketTextures(shapeId);
  
    const removed = Number(res?.paletteResult?.removed || 0);
    const delObjects = Number(res?.filesResult?.deletedObjects || 0);
    const delPrefixes = Array.isArray(res?.filesResult?.deletedPrefixes) ? res.filesResult.deletedPrefixes.length : 0;
    const deleteErrors = Array.isArray(res?.filesResult?.deleteErrors) ? res.filesResult.deleteErrors : [];

    // If palette was not actually changed, treat as a problem (UI would otherwise lie).
    if (removed === 0) {
      const hint = 'Текстура не была удалена из палитры. Возможна проблема с textureId или несогласованные данные палитры.';
      setStatusRich(elPaletteStatus, 'err', {
        title: 'Удаление не завершено',
        message: hint,
        meta: [`Форма: ${shapeId}`, `Текстура: ${textureId}`],
      });
      return;
    }

    const fallbackFileDelete = deleteErrors.some((e) => String(e?.reason || '') === 'delete_api_unavailable');
    const deleteLabels = deleteErrors.map((e) => e?.key || e?.prefix || e?.textureId || 'unknown').filter(Boolean);
    const tone = fallbackFileDelete || deleteErrors.length ? 'warn' : 'ok';
    const title = fallbackFileDelete
      ? 'Удалено только из палитры'
      : (deleteErrors.length ? 'Удаление выполнено частично' : 'Текстура удалена');
    const message = fallbackFileDelete
      ? 'Запись убрана из палитры, но backend DELETE API для удаления файлов бакета недоступен.'
      : (deleteErrors.length
        ? 'Палитра обновлена, но часть файлов в бакете удалить не удалось.'
        : 'Текстура удалена из палитры и связанных файлов бакета.');
    const bullets = [
      `Удалено из палитры: ${removed}`,
      alsoBucket ? `Удалено объектов в бакете: ${delObjects}` : null,
      alsoBucket ? `Затронуто префиксов: ${delPrefixes}` : null,
    ].filter(Boolean);
    if (deleteLabels.length) bullets.push(`Проблемные элементы: ${deleteLabels.join(', ')}`);
    setStatusRich(elPaletteStatus, tone, {
      title,
      message,
      bullets,
      note: fallbackFileDelete
        ? 'Если текстуру нужно удалить полностью, включите backend DELETE API и повторите операцию.'
        : (deleteErrors.length ? 'Проверьте backend / права S3 и повторите удаление при необходимости.' : ''),
      meta: [`Форма: ${shapeId}`, `Текстура: ${textureId}`],
    });
  }

  function isBucketTextureBroken(t) {
    const q1 = t?.qualities?.['1k'];
    if (!q1 || !q1.maps) return true;
    const need = ['albedo','normal','roughness','height'];
    return need.some(k => !q1.maps[k]?.key);
  }


  function hasCompleteBucketTexture1k(shapeId, textureId) {
    const idx = state.bucketIndexByShapeId.get(shapeId) || { textures: [] };
    const textures = Array.isArray(idx?.textures) ? idx.textures : [];
    const targetId = canonicalTextureId(shapeId, textureId);
    const hit = textures.find(t => canonicalTextureId(shapeId, t?.textureId || t?.id || '') === targetId);
    return !!(hit && !isBucketTextureBroken(hit));
  }

  function buildPaletteItemFromBucket(shapeId, textureId, bucketTex) {
    const q1 = bucketTex?.qualities?.['1k'];
    const maps = {};
    const mapTypes = ['albedo','normal','roughness','height','ao'];
    for (const mt of mapTypes) {
      const key = q1?.maps?.[mt]?.key;
      if (key) maps[mt] = key; // keep as bucket-relative path
    }
    return {
      id: textureId,
      name: textureId,
      preview: maps.albedo || '',
      maps,
      params: {},
    };
  }

  function renderBucketTextures(shapeId) {
    if (!elBucketGrid) return;
    elBucketGrid.replaceChildren();
    const idx = state.bucketIndexByShapeId.get(shapeId) || { textures: [] };
    const textures = Array.isArray(idx.textures) ? idx.textures : [];
    const palette = state.paletteByShapeId.get(shapeId);
    const paletteIds = new Set(
      (Array.isArray(palette?.items) ? palette.items : [])
        .map(x => canonicalTextureId(shapeId, x?.id || x?.textureId || ''))
        .filter(Boolean)
    );

    const filter = (elBucketFilter && elBucketFilter.value) || 'all';
    const list = textures.filter(t => {
      const texId = canonicalTextureId(shapeId, t?.textureId || '');
      const inPalette = !!texId && paletteIds.has(texId);
      const broken = isBucketTextureBroken(t);
      if (filter === 'missingInPalette') return !inPalette;
      if (filter === 'inPalette') return inPalette;
      if (filter === 'broken') return broken;
      return true;
    });

    elBucketEmpty.style.display = list.length ? 'none' : 'block';
    if (!list.length) return;

    const frag = document.createDocumentFragment();
    for (const t of list) {
      const textureId = t?.textureId || '';
      const texCanonical = canonicalTextureId(shapeId, textureId);
      const inPalette = !!texCanonical && paletteIds.has(texCanonical);
      const broken = isBucketTextureBroken(t);
      const has2k = !!t?.qualities?.['2k'];
      const previewSource = pickMediaUrl([
        t?.qualities?.['1k']?.maps?.albedo?.key,
        t?.previewKey,
        t?.preview,
      ], { shapeId: (state.activeShapeId || shapeId || ''), textureId, quality: '1k' });
      const previewUrl = normalizeAdminSafeUrl(previewSource);

      const card = document.createElement('div');
      card.className = 'tile';

      const img = document.createElement('img');
      img.className = 'thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      if (!setAdminSafeImageSource(img, previewUrl)) img.style.display = 'none';
      img.addEventListener('error', () => {
        try { img.style.display = 'none'; } catch {}
      });

      const meta = document.createElement('div');
      meta.className = 'meta';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = textureId;

      const pillsEl = document.createElement('div');
      pillsEl.className = 'muted mtSm';
      const pillSpecs = [
        { cls: inPalette ? 'pill pill--set' : 'pill', text: inPalette ? 'в палитре' : 'не в палитре' },
        { cls: 'pill', text: '1k' },
        { cls: 'pill', text: has2k ? '2k' : '2k: нет' },
        { cls: broken ? 'pill pill--warn' : 'pill', text: broken ? 'неполная 1k' : 'ok' },
        { cls: previewUrl ? 'pill' : 'pill pill--warn', text: previewUrl ? 'preview' : 'без preview' },
      ];
      pillSpecs.forEach((spec, index) => {
        const pill = document.createElement('span');
        pill.className = spec.cls;
        pill.textContent = spec.text;
        pillsEl.appendChild(pill);
        if (index !== pillSpecs.length - 1) pillsEl.appendChild(document.createTextNode(' '));
      });

      const actions = document.createElement('div');
      actions.className = 'row tileActions';
      let btnAdd = null;
      let btnEdit = null;
      if (inPalette) {
        btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn--ghost btn--sm';
        btnEdit.dataset.action = 'edit';
        btnEdit.dataset.id = textureId;
        btnEdit.type = 'button';
        btnEdit.textContent = 'Настроить';
        actions.appendChild(btnEdit);
      } else {
        btnAdd = document.createElement('button');
        btnAdd.className = 'btn btn--sm';
        btnAdd.dataset.action = 'add';
        btnAdd.dataset.id = textureId;
        btnAdd.type = 'button';
        btnAdd.disabled = broken;
        btnAdd.textContent = 'Добавить в палитру';
        actions.appendChild(btnAdd);
      }
      const btnUpdate = document.createElement('button');
      btnUpdate.className = 'btn btn--ghost btn--sm';
      btnUpdate.dataset.action = 'update';
      btnUpdate.dataset.id = textureId;
      btnUpdate.type = 'button';
      btnUpdate.title = 'Перезагрузить файлы карты (обновить текущую текстуру)';
      btnUpdate.textContent = 'Обновить файлы';
      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn--danger btn--sm';
      btnDel.dataset.action = 'delete';
      btnDel.dataset.id = textureId;
      btnDel.type = 'button';
      btnDel.title = 'Удалить текстуру';
      btnDel.textContent = 'Удалить';
      actions.append(btnUpdate, btnDel);

      meta.append(nameEl, pillsEl, actions);
      card.append(img, meta);

      if (btnAdd) {
        btnAdd.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (broken) {
            setStatus(elBucketStatus, 'warn', 'Эта текстура неполная в 1k: нужны albedo + normal + roughness + height. Дозагрузите карты и обновите список.');
            return;
          }
          try {
            setStatus(elBucketStatus, '', `Добавляем ${textureId} в палитру…`);
            const item = buildPaletteItemFromBucket(shapeId, textureId, t);
            await upsertItemAndSavePalette(shapeId, item);
            setStatus(elBucketStatus, 'ok', `Добавлено в палитру: ${textureId}`);
            renderBucketTextures(shapeId);
          } catch (err) {
            console.warn(err);
            setStatus(elBucketStatus, 'err', `Не удалось добавить в палитру: ${String(err.message || err)}`);
          }
        });
      }

      if (btnEdit) {
        btnEdit.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTextureParamsModal(shapeId, textureId).catch(err => {
            console.warn(err);
            setStatus(elBucketStatus, 'err', `Не удалось открыть редактор: ${String(err.message || err)}`);
          });
        });
      }

      btnUpdate.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToUpdateUpload(shapeId, textureId);
      });

      btnDel.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (inPalette) {
            await deleteTextureFlow(shapeId, textureId);
            return;
          }
          const ok = await showConfirmModal({
            title: 'Удалить texture asset?',
            subtitle: `Форма: ${shapeId}`,
            message: `Текстура "${textureId}" будет удалена из бакета, превью и палитры.`,
            details: 'После удаления потребуется повторная загрузка файлов, если текстуру нужно будет вернуть.',
            confirmText: 'Удалить полностью',
            cancelText: 'Отмена',
            tone: 'danger'
          });
          if (!ok) return;
          setStatusRich(elBucketStatus, '', {
            title: 'Удаляем texture asset…',
            message: `Форма: ${shapeId} • Текстура: ${textureId}`,
            note: 'Удаляем запись из палитры, превью и связанные файлы бакета.',
          });
          const res = await apiDeleteTexture(shapeId, textureId, { palette: true, files: true });
          state.bucketIndexByShapeId.delete(shapeId);
          await ensureBucketIndexLoaded(shapeId, { forceReload: true });
          renderBucketTextures(shapeId);
          const removed = Number(res?.paletteResult?.removed || 0);
          const delObjects = Number(res?.filesResult?.deletedObjects || 0);
          const delPrefixes = Array.isArray(res?.filesResult?.deletedPrefixes) ? res.filesResult.deletedPrefixes.length : 0;
          const deleteErrors = Array.isArray(res?.filesResult?.deleteErrors) ? res.filesResult.deleteErrors : [];
          const fallbackFileDelete = deleteErrors.some((e) => String(e?.reason || '') === 'delete_api_unavailable');
          const tone = fallbackFileDelete || deleteErrors.length ? 'warn' : 'ok';
          setStatusRich(elBucketStatus, tone, {
            title: fallbackFileDelete ? 'Удалено только из палитры' : (deleteErrors.length ? 'Удаление выполнено частично' : 'Удаление выполнено'),
            message: fallbackFileDelete
              ? 'Запись удалена, но backend DELETE API для очистки файлов бакета недоступен.'
              : (deleteErrors.length ? 'Часть файлов удалить не удалось. Проверьте backend и права доступа.' : 'Текстура и связанные файлы удалены.'),
            bullets: [
              `Удалено из палитры: ${removed}`,
              `Удалено объектов в бакете: ${delObjects}`,
              `Затронуто префиксов: ${delPrefixes}`,
            ],
            meta: [`Форма: ${shapeId}`, `Текстура: ${textureId}`],
          });
        } catch (err) {
          console.warn(err);
          setStatusRich(elBucketStatus, 'err', {
            title: 'Не удалось удалить texture asset',
            message: String(err.message || err),
            meta: [`Форма: ${shapeId}`, `Текстура: ${textureId}`],
          });
        }
      });

      frag.appendChild(card);
    }
    elBucketGrid.appendChild(frag);
  }

  async function ensureShapesLoaded() {
    if (!API_BASE_URL) throw new Error('API_BASE_URL не задан. Проверьте admin/config.js');
    setStatus(elStatus, '', 'Загружаем формы…');
    const payload = await apiFetch('/api/shapes');

    // Backwards/forwards compatible parsing:
    // - Newer backend may respond: { ok:true, shapes:[...] }
    // - Current deployed backend responds: { ok:true, data:{ shapes:[...] } }
    // - Older backend may respond: { ok:true, shapes:["klassika", ...] } or { shapeIds:[...] }
    const rawShapes =
      (Array.isArray(payload?.shapes) ? payload.shapes : null) ||
      (Array.isArray(payload?.data?.shapes) ? payload.data.shapes : null) ||
      (Array.isArray(payload?.data?.data?.shapes) ? payload.data.data.shapes : null) ||
      (Array.isArray(payload?.shapeIds) ? payload.shapeIds : null) ||
      (Array.isArray(payload?.data?.shapeIds) ? payload.data.shapeIds : null) ||
      [];

    // Normalize to objects with at least {id}
    const shapes = rawShapes
      .map((s) => {
        if (typeof s === 'string') return { id: s };
        if (s && typeof s === 'object') return s;
        return null;
      })
      .filter(Boolean);

    state.shapes = shapes;
    setStatus(elStatus, 'ok', `Загружено форм: ${shapes.length}`);
  }

  async function ensurePaletteLoaded(shapeId, { forceReload = false } = {}) {
    if (!shapeId) return null;
    if (!forceReload && state.paletteByShapeId.has(shapeId)) return state.paletteByShapeId.get(shapeId);
    setStatus(elStatus, '', `Загружаем палитру формы: ${shapeId} …`);
    const payload = await apiFetch('/api/palettes/' + encodeURIComponent(shapeId));

    // Backwards/forwards compatible parsing.
    // Depending on backend version, response can be:
    //  - direct palette JSON: { shapeId, items:[...] }
    //  - wrapped: { ok:true, palette:{...} }
    //  - wrapped: { ok:true, data:{...} }
    //  - nested:  { ok:true, data:{ palette:{...} } }
    //  - legacy:  { ok:true, data:{ data:{...} } }
    const rawPalette =
      (payload && Array.isArray(payload.items) ? payload : null) ||
      (payload?.palette && Array.isArray(payload.palette.items) ? payload.palette : null) ||
      (payload?.data && Array.isArray(payload.data.items) ? payload.data : null) ||
      (payload?.data?.palette && Array.isArray(payload.data.palette.items) ? payload.data.palette : null) ||
      (payload?.data?.data && Array.isArray(payload.data.data.items) ? payload.data.data : null) ||
      (payload?.data?.data?.palette && Array.isArray(payload.data.data.palette.items) ? payload.data.data.palette : null) ||
      null;

    const palette = normalizePaletteForUi(shapeId, rawPalette || { shapeId, items: [], _meta: payload?._meta });
    state.paletteByShapeId.set(shapeId, palette);
    const items = Array.isArray(palette?.items) ? palette.items : [];
    if (palette?._meta?.missing) {
      setStatus(elStatus, 'warn', `Палитра для формы "${shapeId}" не найдена в бакете — возвращён пустой шаблон.`);
    } else {
      setStatus(elStatus, 'ok', `Палитра загружена: ${items.length} текстур`);
    }
    return palette;
  }

  async function ensureBucketIndexLoaded(shapeId, { forceReload = false } = {}) {
    if (!shapeId) return null;
    if (!forceReload && state.bucketIndexByShapeId.has(shapeId)) return state.bucketIndexByShapeId.get(shapeId);
    setStatus(elBucketStatus, '', 'Сканируем бакет surfaces/<shapeId>/ …');
    try {
      const res = await apiFetch('/api/surfaces/' + encodeURIComponent(shapeId));
      const textures = Array.isArray(res?.textures) ? res.textures : (Array.isArray(res?.data?.textures) ? res.data.textures : (Array.isArray(res?.textures) ? res.textures : []));
      const normalized = (Array.isArray(textures) ? textures : []).map((t) => {
        if (typeof t === 'string') return { textureId: canonicalTextureId(shapeId, t) };
        const copy = { ...t };
        copy.textureId = canonicalTextureId(shapeId, t.textureId || t.id || t.name || t.key || '');
        return copy;
      }).filter((t) => t && t.textureId);
      const uniqMap = new Map();
      for (const t of normalized) { if (!uniqMap.has(t.textureId)) uniqMap.set(t.textureId, t); }
      const idx = { shapeId, textures: Array.from(uniqMap.values()) };
      state.bucketIndexByShapeId.set(shapeId, idx);
      setStatus(elBucketStatus, 'ok', `Найдено в бакете: ${idx.textures.length} textureId`);
      return idx;
    } catch (e) {
      setStatus(elBucketStatus, 'err', `Не удалось просканировать бакет. Проверьте S3_* в Cloud Function и путь /api/surfaces/{shapeId} в Gateway. Детали: ${String(e.message || e)}`);
      throw e;
    }
  }

  async function ensurePaletteSettingsLoaded(shapeId, { forceReload = false } = {}) {
    if (!shapeId) return null;
    if (!forceReload && state.paletteSettingsByShapeId.has(shapeId)) return state.paletteSettingsByShapeId.get(shapeId);
    setStatus(elSettingsStatus, '', `Загружаем настройки палитры: ${shapeId} …`);
    const settings = await apiFetch('/api/palette-settings/' + encodeURIComponent(shapeId));
    state.paletteSettingsByShapeId.set(shapeId, settings);
    if (settings?._meta?.missing) {
      setStatus(elSettingsStatus, 'warn', 'Файл настроек не найден — показаны значения по умолчанию. Нажмите «Сохранить», чтобы создать файл.');
    } else {
      setStatus(elSettingsStatus, 'ok', 'Настройки загружены.');
    }
    return settings;
  }

  function clearUploadUI() {
    state.uploadTasks = [];
    if (elUploadFiles) elUploadFiles.value = '';
    if (elUploadZip) elUploadZip.value = '';
    renderUploadQueue();
    setStatus(elUploadStatus, '', '');
  }

  function setUploadModeNew() {
    state.uploadContext = { mode: 'new', shapeId: null, textureId: null };
    if (elUploadTextureId) {
      elUploadTextureId.disabled = false;
      if (!elUploadTextureId.value) elUploadTextureId.value = '';
    }
    if (elUploadTextureName) elUploadTextureName.value = '';
  }

  function setUploadModeUpdate(shapeId, textureId) {
    state.uploadContext = { mode: 'update', shapeId, textureId };
    if (elUploadTextureId) {
      elUploadTextureId.value = textureId || '';
      elUploadTextureId.disabled = true;
    }
    if (elUploadTextureName) elUploadTextureName.value = '';
    if (elUploadAutoAdd) elUploadAutoAdd.checked = true;
    const tid = canonicalTextureId(shapeId, textureId);
    setStatus(elUploadStatus, 'warn', `Режим обновления: ${tid}. Загруженные файлы перезапишут surfaces/${shapeId}/${tid}/... После загрузки палитра будет синхронизирована автоматически.`);
  }

  function renderUploadQueue() {
    if (!elUploadTbody) return;
    const tasks = state.uploadTasks || [];
    elUploadTbody.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const t of tasks) {
      const tr = document.createElement('tr');
      const pct = (t.totalBytes > 0) ? Math.round((t.sentBytes / t.totalBytes) * 100) : (t.status === 'done' ? 100 : 0);
      const st = t.status || 'pending';
      const stClass = st === 'done' ? 'uploadOk' : (st === 'error' ? 'uploadErr' : (st === 'uploading' ? 'uploadWarn' : ''));

      const tdType = createAdminNode('td');
      const pill = createAdminNode('span', {
        className: 'uploadPill',
        text: (t.textureId ? (t.textureId + ' / ') : '') + (t.mapType || '?')
      });
      tdType.appendChild(pill);

      const tdFile = createAdminNode('td');
      appendAdminChildren(tdFile, createAdminNode('span', { text: t.fileName || '' }));
      const sizeLine = createAdminNode('div', { className: 'muted mono' });
      const sizeMb = (t.sizeMB || 0).toFixed ? t.sizeMB.toFixed(2) : '';
      sizeLine.textContent = `${sizeMb} MB`;
      tdFile.appendChild(sizeLine);

      const tdKey = createAdminNode('td', { className: 'mono', text: t.key || '' });
      const tdPct = createAdminNode('td', { text: `${pct}%` });
      const tdStatus = createAdminNode('td');
      const statusEl = createAdminNode('span', { className: stClass, text: st });
      tdStatus.appendChild(statusEl);
      if (t.error) tdStatus.appendChild(createAdminNode('div', { className: 'muted', text: t.error }));

      appendAdminChildren(tr, tdType, tdFile, tdKey, tdPct, tdStatus);
      frag.appendChild(tr);
    }
    elUploadTbody.appendChild(frag);
  }

  async function presignPut(key, contentType) {
    const res = await apiFetch('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({ key, contentType, expiresInSec: 900 }),
    });
    if (!res?.url) throw new Error('presign: не получили url');
    return res;
  }

  function xhrPutWithProgress(url, file, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        onProgress?.(evt.loaded, evt.total);
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`PUT failed: ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('PUT failed: network_error'));
      xhr.send(file);
    });
  }

  async function runUploadQueue(concurrency) {
    const limit = Math.max(1, Math.min(8, Number(concurrency) || 3));
    const tasks = state.uploadTasks || [];
    let idx = 0;
    let active = 0;
    let failed = 0;

    return new Promise((resolve) => {
      const next = async () => {
        while (active < limit && idx < tasks.length) {
          const t = tasks[idx++];
          active++;
          (async () => {
            try {
              t.status = 'presign';
              renderUploadQueue();
              const ct = t.contentType || guessMimeByExt(t.fileName);
              const ps = await presignPut(t.key, ct);
              t.status = 'uploading';
              renderUploadQueue();
              await xhrPutWithProgress(ps.url, t.file, ct, (sent, total) => {
                t.sentBytes = sent;
                t.totalBytes = total;
                renderUploadQueue();
              });
              t.status = 'done';
              t.sentBytes = t.totalBytes || t.file.size || 0;
            } catch (e) {
              t.status = 'error';
              t.error = e.message;
              failed++;
            } finally {
              active--;
              renderUploadQueue();
              if (idx >= tasks.length && active === 0) {
                resolve({ ok: failed === 0, failed });
              } else {
                next();
              }
            }
          })();
        }
      };
      next();
    });
  }

  function buildTasksFromFiles(shapeId, textureId, quality, files) {
    const out = [];
    const byType = new Map();
    for (const f of files) {
      const t = detectMapType(f.name);
      if (!t) continue;
      if (!byType.has(t)) byType.set(t, f);
    }
    const required = ['albedo', 'normal', 'roughness', 'height'];
    for (const t of required) {
      if (!byType.has(t)) {
        throw new Error(`Не найден обязательный файл: ${t}. Имя файла должно содержать _${t}`);
      }
    }

    for (const [mapType, file] of byType.entries()) {
      const fileName = standardMapFilename(textureId, mapType, file.name);
      const tid = canonicalTextureId(shapeId, textureId);
      const key = `surfaces/${shapeId}/${tid}/${quality}/${fileName}`;
      out.push({
        mapType,
        file,
        fileName,
        key,
        contentType: file.type || guessMimeByExt(fileName),
        status: 'pending',
        sentBytes: 0,
        totalBytes: file.size || 0,
        sizeMB: (file.size || 0) / (1024 * 1024),
      });
    }
    // prefer deterministic order
    out.sort((a, b) => String(a.mapType).localeCompare(String(b.mapType)));
    return out;
  }

  
  function buildTasksFromZipStructured(currentShapeId, zipEntries, mappingOverrides) {
    const tasks = [];
    const textures = new Map(); // textureId -> { textureId, qualities:Set, mapsByQuality: Map(quality -> Set(mapType)) }
    const foundShapeIds = new Set();
    const errors = [];
    const skipped = [];
    const mappingNeeded = [];

    const overrides = mappingOverrides instanceof Map ? mappingOverrides : new Map();

    // 1) Build groups: (textureId|quality) -> entries[]
    const groups = new Map();
    for (const e of (zipEntries || [])) {
      const origPath = String(e?.originalPath || '').replace(/\\/g, '/');
      const idx = origPath.indexOf('surfaces/');
      if (idx < 0) continue;
      const rel = origPath.slice(idx);
      const m = rel.match(/^surfaces\/([^/]+)\/([^/]+)\/(1k|2k)\/(.+)$/);
      if (!m) continue;

      const shapeIdInZip = m[1];
      const textureId = normalizeTextureId(m[2], currentShapeId);
      const quality = m[3];
      const filename = m[4].split('/').pop();

      foundShapeIds.add(shapeIdInZip);
      if (currentShapeId && shapeIdInZip !== currentShapeId) {
        // mismatch will be handled by the caller (we only build tasks for current shape)
        continue;
      }

      const groupKey = `${textureId}|${quality}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { groupKey, shapeId: currentShapeId, textureId, quality, entries: [] });
      }
      groups.get(groupKey).entries.push({
        originalPath: rel,
        filename,
        file: e.file,
      });
    }

    // 2) Validate that each texture has 1k folder (required)
    const texturesSeen = new Map(); // textureId -> Set(qualities)
    for (const g of groups.values()) {
      if (!texturesSeen.has(g.textureId)) texturesSeen.set(g.textureId, new Set());
      texturesSeen.get(g.textureId).add(g.quality);
    }
    for (const [texId, qs] of texturesSeen.entries()) {
      if (!qs.has('1k')) {
        errors.push(`Текстура "${texId}": отсутствует папка 1k (1k обязателен)`);
      }
    }

    const required = ['albedo', 'normal', 'roughness', 'height'];

    // 3) Build mapping for each group
    for (const g of groups.values()) {
      const byType = new Map(); // mapType -> entry

      // auto-detect
      for (const ent of g.entries) {
        const t = detectMapType(ent.filename);
        if (!t) continue;
        if (!byType.has(t)) byType.set(t, ent);
      }

      // apply manual overrides if any
      const ov = overrides.get(g.groupKey);
      if (ov && ov instanceof Map) {
        for (const [mapType, path] of ov.entries()) {
          const found = g.entries.find(x => x.originalPath === path);
          if (found) byType.set(mapType, found);
        }
      }

      // if it's 1k and required maps are missing, request mapping
      if (g.quality === '1k') {
        const missing = required.filter(t => !byType.has(t));
        if (missing.length) {
          // Prepare suggested mapping for modal (what we already auto-guessed)
          const suggested = new Map();
          for (const [k, v] of byType.entries()) suggested.set(k, v.originalPath);
          mappingNeeded.push({
            groupKey: g.groupKey,
            shapeId: g.shapeId,
            textureId: g.textureId,
            quality: g.quality,
            entries: g.entries.map(x => ({ originalPath: x.originalPath, filename: x.filename, file: x.file })),
            suggested,
            missing,
          });
          continue;
        }
      }

      // Build tasks from resolved mapping; include optional AO if present/mapped
      const allowed = ['albedo', 'normal', 'roughness', 'height', 'ao'];
      for (const mapType of allowed) {
        const ent = byType.get(mapType);
        if (!ent) {
          // ignore optional missing
          continue;
        }
        if (!ent.file) continue;
        const fileName = standardMapFilename(g.textureId, mapType, ent.filename);
        const key = `surfaces/${currentShapeId}/${g.textureId}/${g.quality}/${fileName}`;
        tasks.push({
          mapType,
          textureId: g.textureId,
          quality: g.quality,
          file: ent.file,
          fileName,
          key,
          contentType: (ent.file && ent.file.type) ? ent.file.type : guessMimeByExt(fileName),
          status: 'pending',
          sentBytes: 0,
          totalBytes: ent.file?.size || 0,
          sizeMB: (ent.file?.size || 0) / (1024 * 1024),
        });

        // meta
        let info = textures.get(g.textureId);
        if (!info) {
          info = { textureId: g.textureId, qualities: new Set(), mapsByQuality: new Map() };
          textures.set(g.textureId, info);
        }
        info.qualities.add(g.quality);
        if (!info.mapsByQuality.has(g.quality)) info.mapsByQuality.set(g.quality, new Set());
        info.mapsByQuality.get(g.quality).add(mapType);
      }

      // track extra files that we didn't map (for info only)
      const mappedPaths = new Set(Array.from(byType.values()).map(x => x.originalPath));
      for (const ent of g.entries) {
        if (!mappedPaths.has(ent.originalPath)) {
          skipped.push({ reason: 'unmapped_file', path: ent.originalPath });
        }
      }
    }

    // 4) If mappingNeeded is empty, validate required maps again (in case overrides were provided but still missing)
    if (!mappingNeeded.length) {
      for (const [textureId, info] of textures.entries()) {
        const maps1k = info.mapsByQuality.get('1k') || new Set();
        for (const t of required) {
          if (!maps1k.has(t)) {
            errors.push(`Текстура "${textureId}": отсутствует обязательная карта "${t}" в 1k`);
          }
        }
      }
    }

    tasks.sort((a, b) => {
      const k1 = `${a.textureId || ''}|${a.quality || ''}|${a.mapType || ''}`;
      const k2 = `${b.textureId || ''}|${b.quality || ''}|${b.mapType || ''}`;
      return k1.localeCompare(k2);
    });

    return {
      tasks,
      textures,
      foundShapeIds: Array.from(foundShapeIds),
      skipped,
      errors,
      mappingNeeded,
    };
  }

  function groupTasksByTexture(tasks, quality) {
    const out = new Map(); // textureId -> tasks[]
    for (const t of (tasks || [])) {
      if (quality && t.quality !== quality) continue;
      const id = t.textureId || '';
      if (!id) continue;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(t);
    }
    return out;
  }

function buildPaletteItemFromUpload(shapeId, textureId, name, quality, tasks, tileSizeMOrNull) {
    // Persist canonical IDs in palette to avoid duplicates and to keep delete/update stable.
    const canonicalId = canonicalTextureId(shapeId, textureId);
    const maps = {};
    for (const t of tasks) {
      const rel = `surfaces/${shapeId}/${canonicalId}/${quality}/${t.fileName}`;
      maps[t.mapType] = rel;
    }
    const item = {
      id: canonicalId,
      name: name || canonicalId,
      preview: maps.albedo || '',
      maps,
      params: {},
    };
    if (tileSizeMOrNull) item.tileSizeM = tileSizeMOrNull;
    return item;
  }

  async function savePalette(shapeId, palette) {
    const res = await apiFetch('/api/palettes/' + encodeURIComponent(shapeId), {
      method: 'POST',
      body: JSON.stringify(palette),
    });
    return res;
  }

  async function upsertItemAndSavePalette(shapeId, item) {
    const palette = await ensurePaletteLoaded(shapeId);
    const items = Array.isArray(palette?.items) ? [...palette.items] : [];
    // Compare by canonical ID to avoid duplicates caused by legacy prefixes.
    const itemCanonicalId = canonicalTextureId(shapeId, item?.id || '');
    const idx = items.findIndex(x => {
      const xid = canonicalTextureId(shapeId, x?.id || x?.textureId || '');
      return xid && xid === itemCanonicalId;
    });
    // Ensure the saved palette always keeps canonical IDs.
    const normalizedItem = { ...item, id: itemCanonicalId };
    if (idx >= 0) items[idx] = normalizedItem;
    else items.push(normalizedItem);
    const next = {
      shapeId,
      items,
    };
    await savePalette(shapeId, next);
    // refresh
    state.paletteByShapeId.delete(shapeId);
    const fresh = await ensurePaletteLoaded(shapeId);
    renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);

    // Also refresh the bucket scan view so the newly added texture is shown as "already in palette".
    // This avoids user confusion where the palette is saved but the "bucket" list still looks unchanged.
    try { renderBucketTextures(shapeId); } catch {}
  }

  function num(v, fallback = null) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function fillPaletteSettingsForm(settings, shapeId) {
    const d = (settings && settings.defaults && typeof settings.defaults === 'object') ? settings.defaults : {};

    const tile = d.tileSizeM || {};
    const wMm = (typeof tile.w === 'number') ? Math.round(tile.w * 1000) : 115;
    const hMm = (typeof tile.h === 'number') ? Math.round(tile.h * 1000) : 115;

    elSettingsTileW.value = String(wMm);
    elSettingsTileH.value = String(hMm);
    elSettingsUvScale.value = String(typeof d.uvScale === 'number' ? d.uvScale : 1.0);
    elSettingsExposure.value = String(typeof d.exposureMult === 'number' ? d.exposureMult : 1.0);
    elSettingsContrast.value = String(typeof d.contrast === 'number' ? d.contrast : 1.0);
    elSettingsSaturation.value = String(typeof d.saturation === 'number' ? d.saturation : 1.0);
    elSettingsRoughness.value = String(typeof d.roughnessMult === 'number' ? d.roughnessMult : 1.0);
    elSettingsSpec.value = String(typeof d.specStrength === 'number' ? d.specStrength : 1.0);
    elSettingsNormalScale.value = String(typeof d.normalScale === 'number' ? d.normalScale : 1.0);
    elSettingsBumpScale.value = String(typeof d.bumpScale === 'number' ? d.bumpScale : 1.0);

    // Helpful context in title area
    if (shapeId) {
      elSettingsTileW.placeholder = '115';
      elSettingsTileH.placeholder = '115';
      elSettingsUvScale.placeholder = '1.00';
    }
  }

  function collectPaletteSettingsFromForm(shapeId) {
    const wMm = num(elSettingsTileW.value, 115);
    const hMm = num(elSettingsTileH.value, 115);
    const w = Math.max(1, wMm) / 1000;
    const h = Math.max(1, hMm) / 1000;

    return {
      shapeId,
      defaults: {
        tileSizeM: { w, h },
        uvScale: num(elSettingsUvScale.value, 1.0),
        exposureMult: num(elSettingsExposure.value, 1.0),
        contrast: num(elSettingsContrast.value, 1.0),
        saturation: num(elSettingsSaturation.value, 1.0),
        roughnessMult: num(elSettingsRoughness.value, 1.0),
        specStrength: num(elSettingsSpec.value, 1.0),
        normalScale: num(elSettingsNormalScale.value, 1.0),
        bumpScale: num(elSettingsBumpScale.value, 1.0),
      },
    };
  }


  function bindPaletteSettingsTelemetry() {
    const fields = [
      ['uvScale', elSettingsUvScale],
      ['exposureMult', elSettingsExposure],
      ['contrast', elSettingsContrast],
      ['saturation', elSettingsSaturation],
      ['roughnessMult', elSettingsRoughness],
      ['specStrength', elSettingsSpec],
      ['normalScale', elSettingsNormalScale],
      ['bumpScale', elSettingsBumpScale],
    ];
    fields.forEach(([param, el]) => {
      if (!el || el.__telemetryBound) return;
      const handler = () => {
        const route = typeof parseRoute === 'function' ? parseRoute() : { id: '' };
        const shapeId = currentTexShapeId || decodeURIComponent(route && route.id ? route.id : '') || '';
        const n = Number(el.value);
        scheduleVisualParamTelemetry('admin_visual_param_change', {
          shapeId: String(shapeId || ''),
          textureId: '',
          param: String(param || ''),
          value: Number.isFinite(n) ? Number(n.toFixed(4)) : el.value,
          source: 'palette_defaults',
        });
      };
      el.addEventListener('change', handler);
      el.addEventListener('blur', handler);
      el.__telemetryBound = true;
    });
  }

  function getDefaultsForShape(shapeId) {
    const s = state.paletteSettingsByShapeId.get(shapeId);
    const d = (s && s.defaults && typeof s.defaults === 'object') ? s.defaults : {};
    const tileM = (d.tileSizeM && typeof d.tileSizeM === 'object') ? d.tileSizeM : {};
    const wMm = (typeof tileM.w === 'number') ? Math.round(tileM.w * 1000) : RECOMMENDED_DEFAULTS.tileSizeMm.w;
    const hMm = (typeof tileM.h === 'number') ? Math.round(tileM.h * 1000) : RECOMMENDED_DEFAULTS.tileSizeMm.h;
    return {
      tileSizeMm: { w: wMm, h: hMm },
      uvScale: (typeof d.uvScale === 'number') ? d.uvScale : RECOMMENDED_DEFAULTS.uvScale,
      exposureMult: (typeof d.exposureMult === 'number') ? d.exposureMult : RECOMMENDED_DEFAULTS.exposureMult,
      contrast: (typeof d.contrast === 'number') ? d.contrast : RECOMMENDED_DEFAULTS.contrast,
      saturation: (typeof d.saturation === 'number') ? d.saturation : RECOMMENDED_DEFAULTS.saturation,
      roughnessMult: (typeof d.roughnessMult === 'number') ? d.roughnessMult : RECOMMENDED_DEFAULTS.roughnessMult,
      specStrength: (typeof d.specStrength === 'number') ? d.specStrength : RECOMMENDED_DEFAULTS.specStrength,
      normalScale: (typeof d.normalScale === 'number') ? d.normalScale : RECOMMENDED_DEFAULTS.normalScale,
      bumpScale: (typeof d.bumpScale === 'number') ? d.bumpScale : RECOMMENDED_DEFAULTS.bumpScale,
    };
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj || null));
  }

  function findPaletteItem(palette, itemId) {
    const items = Array.isArray(palette?.items) ? palette.items : [];
    return items.find(x => x && (x.id === itemId || x.textureId === itemId)) || null;
  }

  function showTexModal(open) {
    if (!elTexModal) return;
    elTexModal.hidden = !open;
    syncAdminModalBodyState();
  }

  function closeTexModal() {
    currentTexShapeId = '';
    currentTexItemId = '';
    currentTexSnapshot = null;
    if (elTexParams) elTexParams.replaceChildren();
    if (elTexPreview) elTexPreview.removeAttribute('src');
    texPreviewLoaded = false;
    texPreviewOriginal = null;
    if (texPreviewDrawTimer) {
      clearTimeout(texPreviewDrawTimer);
      texPreviewDrawTimer = null;
    }
    if (elTexCanvasBefore) {
      const ctx = elTexCanvasBefore.getContext('2d');
      ctx && ctx.clearRect(0, 0, elTexCanvasBefore.width, elTexCanvasBefore.height);
    }
    if (elTexCanvasAfter) {
      const ctx = elTexCanvasAfter.getContext('2d');
      ctx && ctx.clearRect(0, 0, elTexCanvasAfter.width, elTexCanvasAfter.height);
    }
    setStatus(elTexModalStatus, '', '');
    showTexModal(false);
  }

  function buildParamRow({ key, label, min, max, step, help }, value, defaultValue, isOverride) {
    const row = document.createElement('div');
    row.className = 'paramRow';
    const meta = isOverride ? `Переопределено • default: ${defaultValue}` : `По умолчанию: ${defaultValue}`;

    const top = document.createElement('div');
    top.className = 'paramTop';
    const labelWrap = document.createElement('div');
    labelWrap.className = 'paramLabel';
    labelWrap.append(document.createTextNode(label + ' '));
    const helpEl = document.createElement('span');
    helpEl.className = 'paramHelp';
    helpEl.title = help;
    helpEl.textContent = 'i';
    labelWrap.appendChild(helpEl);
    const metaEl = document.createElement('div');
    metaEl.className = 'paramMeta';
    metaEl.textContent = meta;
    top.append(labelWrap, metaEl);

    const controls = document.createElement('div');
    controls.className = 'paramControls';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.step = String(step);
    numInput.min = String(min);
    numInput.max = String(max);
    numInput.value = String(value);
    controls.append(range, numInput);

    const note = document.createElement('div');
    note.className = 'paramNote';
    note.append('Подсказка: наведите на ');
    const noteBold = document.createElement('b');
    noteBold.textContent = 'i';
    note.append(noteBold, ', чтобы увидеть описание влияния параметра.');

    row.append(top, controls, note);
    const onSync = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      range.value = String(n);
      numInput.value = String(n);
      row.dispatchEvent(new CustomEvent('param-change', { detail: { key, value: n } }));
    };
    range.addEventListener('input', () => onSync(range.value));
    numInput.addEventListener('input', () => onSync(numInput.value));
    return row;
  }

  function collectTextureDraftParams(shapeId) {
    const defs = getDefaultsForShape(shapeId);
    const out = { ...defs };
    // Read live values from UI dataset (if present)
    for (const schema of TEXTURE_PARAM_SCHEMA) {
      const row = elTexParams?.querySelector(`.paramRow[data-key="${schema.key}"]`);
      if (!row) continue;
      const v = Number(row.dataset.value);
      if (Number.isFinite(v)) out[schema.key] = v;
    }
    return out;
  }

  function redrawTexturePreview(shapeId) {
    if (!texPreviewLoaded || !texPreviewOriginal || !elTexCanvasAfter || !elTexCanvasBefore) return;
    const ctxAfter = elTexCanvasAfter.getContext('2d', { willReadFrequently: true });
    if (!ctxAfter) return;
    const draft = collectTextureDraftParams(shapeId);
    const adjusted = applyBasicColorAdjustments(texPreviewOriginal, draft);
    ctxAfter.putImageData(adjusted, 0, 0);
  }

  async function scheduleTexturePreviewRedraw(shapeId) {
    if (!elTexCanvasAfter) return;
    if (texPreviewDrawTimer) clearTimeout(texPreviewDrawTimer);
    texPreviewDrawTimer = setTimeout(() => {
      texPreviewDrawTimer = null;
      redrawTexturePreview(shapeId);
    }, 60);
  }

  async function openTextureParamsModal(shapeId, itemId) {
    if (!shapeId || !itemId) return;
    await ensurePaletteLoaded(shapeId);
    await ensurePaletteSettingsLoaded(shapeId);
    const palette = state.paletteByShapeId.get(shapeId);
    const item = findPaletteItem(palette, itemId);
    if (!item) throw new Error(`item_not_found: ${itemId}`);

    currentTexShapeId = shapeId;
    currentTexItemId = itemId;
    currentTexSnapshot = deepClone({ tileSizeM: item.tileSizeM || null, params: item.params || {} });

    elTexModalTitle.textContent = 'Настройка текстуры';
    elTexModalSubtitle.textContent = `Форма: ${shapeId} • Текстура: ${itemId}`;

    if (elTexOpenArCalibBtn) {
      elTexOpenArCalibBtn.onclick = () => {
        try { sessionStorage.setItem('admin_ar_return_url', window.location.href); } catch (_) {}
        telemetryTrack('admin_ar_calibration_open', { shapeId: String(shapeId || ''), textureId: String(itemId || '') });
        window.location.assign(buildArCalibrationUrl(shapeId, itemId));
      };
    }

    const previewSource = pickMediaUrl([
      item?.maps?.albedoUrl,
      item?.maps?.albedo,
      item?.previewUrl,
      item?.preview,
    ], { shapeId: (state.activeShapeId || ''), textureId: (item?.id || item?.textureId || ''), quality: '1k' });
    const previewUrl = normalizeAdminSafeUrl(previewSource);
    const previewMissingInfo = !previewUrl
      ? describeAdminPreviewProblem(previewSource, previewUrl, previewSource ? new Error('preview_url_unsafe') : new Error('preview_url_empty'))
      : null;
    if (elTexPreview && previewUrl) {
      elTexPreview.onerror = () => {
        try { elTexPreview.style.display = 'none'; } catch {}
        const info = describeAdminPreviewProblem(previewSource, previewUrl, new Error('preview_image_load_failed'));
        elTexPreviewHint.textContent = info.message;
      };
      elTexPreview.style.display = '';
      setAdminSafeImageSource(elTexPreview, previewUrl);
      elTexPreviewHint.textContent = 'Превью: albedo (из палитры)';
    } else {
      if (elTexPreview) {
        elTexPreview.removeAttribute('src');
        elTexPreview.style.display = 'none';
      }
      elTexPreviewHint.textContent = previewMissingInfo ? previewMissingInfo.message : 'Превью недоступно';
    }

    const defaults = getDefaultsForShape(shapeId);

    // Build UI
    elTexParams.replaceChildren();

    // Tile size (mm)
    const tileOverride = item.tileSizeM && typeof item.tileSizeM === 'object'
      ? { w: Math.round(item.tileSizeM.w * 1000), h: Math.round(item.tileSizeM.h * 1000) }
      : null;
    const tileEffective = tileOverride || defaults.tileSizeMm;
    const tileBlock = document.createElement('div');
    tileBlock.className = 'paramRow';
    const tileTop = document.createElement('div');
    tileTop.className = 'paramTop';
    const tileLabel = document.createElement('div');
    tileLabel.className = 'paramLabel';
    tileLabel.append(document.createTextNode('Размер модуля (мм) '));
    const tileHelp = document.createElement('span');
    tileHelp.className = 'paramHelp';
    tileHelp.title = 'Физический размер плитки. Влияет на повтор текстуры (repeat) и на реалистичность масштаба в AR.';
    tileHelp.textContent = 'i';
    tileLabel.appendChild(tileHelp);
    const tileMeta = document.createElement('div');
    tileMeta.className = 'paramMeta';
    tileMeta.textContent = `${tileOverride ? 'Переопределено' : 'По умолчанию'} • default: ${defaults.tileSizeMm.w}×${defaults.tileSizeMm.h}`;
    tileTop.append(tileLabel, tileMeta);

    const tileControls = document.createElement('div');
    tileControls.className = 'paramControls';
    const tileControlWrap = document.createElement('div');
    tileControlWrap.style.display = 'flex';
    tileControlWrap.style.gap = '10px';
    tileControlWrap.style.alignItems = 'center';

    const fieldW = document.createElement('label');
    fieldW.className = 'field';
    fieldW.style.margin = '0';
    const fieldWLabel = document.createElement('span');
    fieldWLabel.className = 'muted';
    fieldWLabel.textContent = 'Ширина';
    const inputW = document.createElement('input');
    inputW.id = 'texTileW';
    inputW.type = 'number';
    inputW.min = '10';
    inputW.max = '1000';
    inputW.step = '1';
    inputW.value = String(tileEffective.w);
    fieldW.append(fieldWLabel, inputW);

    const fieldH = document.createElement('label');
    fieldH.className = 'field';
    fieldH.style.margin = '0';
    const fieldHLabel = document.createElement('span');
    fieldHLabel.className = 'muted';
    fieldHLabel.textContent = 'Высота';
    const inputH = document.createElement('input');
    inputH.id = 'texTileH';
    inputH.type = 'number';
    inputH.min = '10';
    inputH.max = '1000';
    inputH.step = '1';
    inputH.value = String(tileEffective.h);
    fieldH.append(fieldHLabel, inputH);

    tileControlWrap.append(fieldW, fieldH);
    tileControls.append(tileControlWrap, document.createElement('div'));

    const tileNote = document.createElement('div');
    tileNote.className = 'paramNote';
    tileNote.textContent = 'Рекомендация: используйте реальные размеры плитки из ТЗ/каталога. Для квадрата 115×115 мм — это базовый дефолт.';

    tileBlock.append(tileTop, tileControls, tileNote);
    elTexParams.appendChild(tileBlock);

    // Params
    const curParams = (item.params && typeof item.params === 'object') ? item.params : {};
    for (const schema of TEXTURE_PARAM_SCHEMA) {
      const defVal = defaults[schema.key];
      const raw = (typeof curParams[schema.key] === 'number') ? curParams[schema.key] : defVal;
      const isOverride = typeof curParams[schema.key] === 'number';
      const row = buildParamRow(schema, raw, defVal, isOverride);
      row.addEventListener('param-change', (e) => {
        // store temp on DOM dataset
        row.dataset.value = String(e.detail.value);
        const nextValue = Number(e && e.detail ? e.detail.value : row.dataset.value);
        scheduleVisualParamTelemetry('admin_visual_param_change', {
          shapeId: String(shapeId || ''),
          textureId: String(itemId || ''),
          param: String(schema.key || ''),
          value: Number.isFinite(nextValue) ? Number(nextValue.toFixed(4)) : nextValue,
          source: 'texture_modal',
        });
        scheduleTexturePreviewRedraw(shapeId);
      });
      row.dataset.key = schema.key;
      row.dataset.value = String(raw);
      elTexParams.appendChild(row);
    }

    // Bind modal buttons
    const applyDraftToUI = (snap) => {
      const d = getDefaultsForShape(shapeId);
      const tW = tileBlock.querySelector('#texTileW');
      const tH = tileBlock.querySelector('#texTileH');
      const tile = snap.tileSizeM && typeof snap.tileSizeM === 'object'
        ? { w: Math.round(snap.tileSizeM.w * 1000), h: Math.round(snap.tileSizeM.h * 1000) }
        : d.tileSizeMm;
      tW.value = String(tile.w);
      tH.value = String(tile.h);
      for (const row of elTexParams.querySelectorAll('.paramRow')) {
        const k = row.dataset.key;
        if (!k) continue;
        const inputRange = row.querySelector('input[type="range"]');
        const inputNum = row.querySelector('input[type="number"]');
        const v = (snap.params && typeof snap.params[k] === 'number') ? snap.params[k] : d[k];
        if (inputRange) inputRange.value = String(v);
        if (inputNum) inputNum.value = String(v);
        row.dataset.value = String(v);
      }
      scheduleTexturePreviewRedraw(shapeId);
    };

    elTexRevertBtn.onclick = () => {
      if (!currentTexSnapshot) return;
      applyDraftToUI(currentTexSnapshot);
      setStatus(elTexModalStatus, 'ok', 'Изменения в окне отменены.');
      scheduleTexturePreviewRedraw(shapeId);
    };

    elTexResetBtn.onclick = () => {
      const blank = { tileSizeM: null, params: {} };
      applyDraftToUI(blank);
      setStatus(elTexModalStatus, 'warn', 'Переопределения очищены. Нажмите «Сохранить», чтобы применить.');
      scheduleTexturePreviewRedraw(shapeId);
    };

    elTexSaveBtn.onclick = async () => {
      try {
        elTexSaveBtn.disabled = true;
        setStatus(elTexModalStatus, '', 'Сохраняем…');
        const paletteNow = state.paletteByShapeId.get(shapeId) || { shapeId, items: [] };
        const items = Array.isArray(paletteNow.items) ? [...paletteNow.items] : [];
        const idx = items.findIndex(x => x && (x.id === itemId || x.textureId === itemId));
        if (idx < 0) throw new Error('item_not_found_in_palette');
        const nextItem = deepClone(items[idx]);
        const defs = getDefaultsForShape(shapeId);

        // Tile override
        const tW = Number(tileBlock.querySelector('#texTileW').value);
        const tH = Number(tileBlock.querySelector('#texTileH').value);
        if (Number.isFinite(tW) && Number.isFinite(tH)) {
          if (Math.round(tW) === Math.round(defs.tileSizeMm.w) && Math.round(tH) === Math.round(defs.tileSizeMm.h)) {
            delete nextItem.tileSizeM;
          } else {
            nextItem.tileSizeM = { w: Math.max(1, tW) / 1000, h: Math.max(1, tH) / 1000 };
          }
        }

        // Params overrides
        const p = (nextItem.params && typeof nextItem.params === 'object') ? { ...nextItem.params } : {};
        for (const schema of TEXTURE_PARAM_SCHEMA) {
          const k = schema.key;
          const row = elTexParams.querySelector(`.paramRow[data-key="${k}"]`);
          if (!row) continue;
          const v = Number(row.dataset.value);
          if (!Number.isFinite(v)) continue;
          const defVal = defs[k];
          if (Number.isFinite(defVal) && Math.abs(v - defVal) < 1e-9) {
            delete p[k];
          } else {
            p[k] = v;
          }
        }
        // Clean empty params
        if (Object.keys(p).length) nextItem.params = p;
        else delete nextItem.params;

        items[idx] = nextItem;
        const nextPalette = { shapeId, items };
        await savePalette(shapeId, nextPalette);
        state.paletteByShapeId.delete(shapeId);
        const fresh = await ensurePaletteLoaded(shapeId);
        renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);
        setStatus(elPaletteStatus, 'ok', 'Палитра сохранена.');
        setStatus(elTexModalStatus, 'ok', 'Сохранено.');
        currentTexSnapshot = deepClone({ tileSizeM: nextItem.tileSizeM || null, params: nextItem.params || {} });
      } catch (e) {
        console.warn(e);
        setStatus(elTexModalStatus, 'err', `Ошибка сохранения: ${e.message}`);
      } finally {
        elTexSaveBtn.disabled = false;
      }
    };

    // Modal close interactions
    const bindClose = () => {
      if (!elTexModal) return;
      elTexModal.querySelectorAll('[data-action="close"]').forEach(el => {
        el.addEventListener('click', () => closeTexModal());
      });
      elTexModalCloseBtn?.addEventListener('click', () => closeTexModal());
    };
    bindClose();

    showTexModal(true);
    setStatus(elTexModalStatus, '', '');
    if (previewMissingInfo) {
      setStatusRich(elTexModalStatus, 'warn', {
        title: previewMissingInfo.title,
        message: previewMissingInfo.message,
        note: previewMissingInfo.note,
        meta: [`Форма: ${shapeId}`, `Текстура: ${itemId}`],
      });
    }

    // Load and draw preview (non-blocking)
    texPreviewLoaded = false;
    texPreviewOriginal = null;
    if (previewUrl && elTexCanvasBefore && elTexCanvasAfter) {
      (async () => {
        try {
          const img = await loadImageForCanvas(previewUrl);
          texPreviewImageEl = img;
          const ctxB = drawCoverToCanvas(img, elTexCanvasBefore);
          drawCoverToCanvas(img, elTexCanvasAfter);
          if (ctxB) {
            texPreviewOriginal = ctxB.getImageData(0, 0, elTexCanvasBefore.width, elTexCanvasBefore.height);
            texPreviewLoaded = true;
            redrawTexturePreview(shapeId);
          }
        } catch (e) {
          console.warn(e);
          const info = describeAdminPreviewProblem(previewSource, previewUrl, e);
          elTexPreviewHint.textContent = info.message;
          setStatusRich(elTexModalStatus, 'warn', {
            title: info.title,
            message: info.message,
            note: info.note,
            meta: [`Форма: ${shapeId}`, `Текстура: ${itemId}`],
          });
        }
      })();
    }
  }

  function showBulkModal(open) {
    if (!elBulkModal) return;
    elBulkModal.hidden = !open;
    syncAdminModalBodyState();
  }

  function closeBulkModal() {
    bulkSnapshot = null;
    if (elBulkParams) elBulkParams.replaceChildren();
    setStatus(elBulkModalStatus, '', '');
    showBulkModal(false);
  }

  function buildBulkParamRow(schema, value, defaultValue) {
    const row = document.createElement('div');
    row.className = 'bulkParam';
    row.dataset.key = schema.key;
    row.dataset.value = String(value);
    row.dataset.apply = '0';

    const top = createAdminNode('div', { className: 'paramTop' });
    const labelWrap = createAdminNode('div', { className: 'paramLabel' });
    const checkboxLabel = createAdminNode('label', {
      className: 'checkbox',
      title: 'Применить этот параметр к целевым текстурам'
    });
    const cb = createAdminNode('input', { attrs: { type: 'checkbox', 'data-action': 'apply' } });
    const cbText = createAdminNode('span', { text: 'Применять' });
    appendAdminChildren(checkboxLabel, cb, cbText);

    const nameWrap = createAdminNode('span');
    nameWrap.style.marginLeft = '10px';
    nameWrap.append(document.createTextNode(String(schema.label || '')));
    nameWrap.append(document.createTextNode(' '));
    nameWrap.appendChild(createAdminNode('span', {
      className: 'paramHelp',
      title: schema.help || '',
      text: 'i'
    }));
    appendAdminChildren(labelWrap, checkboxLabel, nameWrap);

    const meta = createAdminNode('div', { className: 'paramMeta', text: `default: ${defaultValue}` });
    appendAdminChildren(top, labelWrap, meta);

    const controls = createAdminNode('div', { className: 'paramControls' });
    const range = createAdminNode('input', {
      attrs: {
        type: 'range',
        min: String(schema.min),
        max: String(schema.max),
        step: String(schema.step),
        value: String(value)
      }
    });
    const numInput = createAdminNode('input', {
      attrs: {
        type: 'number',
        step: String(schema.step),
        min: String(schema.min),
        max: String(schema.max),
        value: String(value)
      }
    });
    appendAdminChildren(controls, range, numInput);

    const note = createAdminNode('div', { className: 'paramNote' });
    note.append('Подсказка: наведите на ');
    note.appendChild(createAdminNode('b', { text: 'i' }));
    note.append(' . Отметьте «Применять», чтобы параметр применился массово.');

    appendAdminChildren(row, top, controls, note);

    const onSync = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      range.value = String(n);
      numInput.value = String(n);
      row.dataset.value = String(n);
    };
    range.addEventListener('input', () => onSync(range.value));
    numInput.addEventListener('input', () => onSync(numInput.value));
    cb.addEventListener('change', () => {
      row.dataset.apply = cb.checked ? '1' : '0';
    });

    return row;
  }

  function bulkCollectDraft() {
    const out = {
      applyTileSize: Boolean(elBulkApplyTileSize?.checked),
      tileW: num(elBulkTileW?.value, null),
      tileH: num(elBulkTileH?.value, null),
      params: {},
      applyKeys: new Set(),
    };
    for (const row of elBulkParams?.querySelectorAll('.bulkParam') || []) {
      const k = row.dataset.key;
      if (!k) continue;
      const apply = row.dataset.apply === '1';
      if (!apply) continue;
      const v = Number(row.dataset.value);
      if (!Number.isFinite(v)) continue;
      out.applyKeys.add(k);
      out.params[k] = v;
    }
    return out;
  }

  async function bulkResetOverridesAndSave(shapeId, ids) {
    const palette = state.paletteByShapeId.get(shapeId) || (await ensurePaletteLoaded(shapeId));
    const items = Array.isArray(palette?.items) ? [...palette.items] : [];
    const idSet = new Set(ids || []);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = it?.id || it?.textureId;
      if (!idSet.has(id)) continue;
      const next = deepClone(it);
      delete next.tileSizeM;
      delete next.params;
      items[i] = next;
    }
    await savePalette(shapeId, { shapeId, items });
  }

  async function applyBulkAndSave(shapeId) {
    const palette = state.paletteByShapeId.get(shapeId) || (await ensurePaletteLoaded(shapeId));
    const items = Array.isArray(palette?.items) ? [...palette.items] : [];
    const defs = getDefaultsForShape(shapeId);

    // Determine target ids
    const target = String(elBulkApplyTarget?.value || 'selected');
    let ids = [];
    if (target === 'all') {
      ids = items.map(it => it?.id || it?.textureId).filter(Boolean);
    } else {
      ids = Array.from(getSelectedSet(shapeId));
    }
    if (!ids.length) throw new Error('no_target_textures');
    const idSet = new Set(ids);

    const draft = bulkCollectDraft();
    const applyTile = draft.applyTileSize && Number.isFinite(draft.tileW) && Number.isFinite(draft.tileH);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = it?.id || it?.textureId;
      if (!idSet.has(id)) continue;
      const next = deepClone(it);

      // Tile size override
      if (applyTile) {
        if (Math.round(draft.tileW) === Math.round(defs.tileSizeMm.w) && Math.round(draft.tileH) === Math.round(defs.tileSizeMm.h)) {
          delete next.tileSizeM;
        } else {
          next.tileSizeM = { w: Math.max(1, draft.tileW) / 1000, h: Math.max(1, draft.tileH) / 1000 };
        }
      }

      // Params override
      if (draft.applyKeys.size) {
        const p = (next.params && typeof next.params === 'object') ? { ...next.params } : {};
        for (const k of draft.applyKeys) {
          const v = draft.params[k];
          const defVal = defs[k];
          if (Number.isFinite(defVal) && Math.abs(v - defVal) < 1e-9) {
            delete p[k];
          } else {
            p[k] = v;
          }
        }
        if (Object.keys(p).length) next.params = p;
        else delete next.params;
      }

      items[i] = next;
    }

    await savePalette(shapeId, { shapeId, items });
  }

  async function openBulkParamsModal(shapeId) {
    if (!shapeId) return;
    await ensurePaletteLoaded(shapeId);
    await ensurePaletteSettingsLoaded(shapeId);
    const palette = state.paletteByShapeId.get(shapeId);
    const items = Array.isArray(palette?.items) ? palette.items : [];
    const defs = getDefaultsForShape(shapeId);

    bulkSnapshot = deepClone({ shapeId, items });
    elBulkModalTitle.textContent = 'Массовая настройка текстур';

    const selectedCount = getSelectedSet(shapeId).size;
    const totalCount = items.length;
    elBulkModalSubtitle.textContent = `Форма: ${shapeId} • Всего текстур: ${totalCount} • Выбрано: ${selectedCount}`;

    // Default target: selected if any, else all
    if (elBulkApplyTarget) elBulkApplyTarget.value = selectedCount ? 'selected' : 'all';

    // Source dropdown
    if (elBulkSourceTexture) {
      elBulkSourceTexture.replaceChildren();
      const frag = document.createDocumentFragment();
      for (const it of items) {
        const id = it?.id || it?.textureId;
        if (!id) continue;
        const name = it?.name || id;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${id} — ${name}`;
        frag.appendChild(opt);
      }
      elBulkSourceTexture.appendChild(frag);
    }

    // Tile defaults
    if (elBulkApplyTileSize) elBulkApplyTileSize.checked = false;
    if (elBulkTileW) elBulkTileW.value = String(defs.tileSizeMm.w);
    if (elBulkTileH) elBulkTileH.value = String(defs.tileSizeMm.h);

    // Param rows
    elBulkParams.replaceChildren();
    for (const schema of TEXTURE_PARAM_SCHEMA) {
      const defVal = defs[schema.key];
      const row = buildBulkParamRow(schema, defVal, defVal);
      elBulkParams.appendChild(row);
    }

    setStatus(elBulkModalStatus, '', '');

    // Close interactions
    // Close interactions (replace handlers to avoid stacking)
    if (elBulkModal) {
      elBulkModal.querySelectorAll('[data-action="close"]').forEach(el => {
        el.onclick = () => closeBulkModal();
      });
    }
    if (elBulkModalCloseBtn) elBulkModalCloseBtn.onclick = () => closeBulkModal();

    // Fill defaults
    if (elBulkFillDefaultsBtn) elBulkFillDefaultsBtn.onclick = () => {
      if (elBulkTileW) elBulkTileW.value = String(defs.tileSizeMm.w);
      if (elBulkTileH) elBulkTileH.value = String(defs.tileSizeMm.h);
      if (elBulkApplyTileSize) elBulkApplyTileSize.checked = true;
      for (const row of elBulkParams.querySelectorAll('.bulkParam')) {
        const k = row.dataset.key;
        const v = defs[k];
        row.dataset.value = String(v);
        row.querySelector('input[type="range"]').value = String(v);
        row.querySelector('input[type="number"]').value = String(v);
        const cb = row.querySelector('input[data-action="apply"]');
        cb.checked = true;
        row.dataset.apply = '1';
      }
      setStatus(elBulkModalStatus, 'ok', 'Заполнено дефолтами палитры. Проверьте и нажмите «Применить».' );
    };

    // Copy from texture
    if (elBulkCopyFromTextureBtn) elBulkCopyFromTextureBtn.onclick = () => {
      const srcId = String(elBulkSourceTexture?.value || '');
      const src = findPaletteItem(palette, srcId);
      if (!src) {
        setStatus(elBulkModalStatus, 'err', 'Не удалось найти текстуру-источник.');
        return;
      }
      // tile
      if (src.tileSizeM && typeof src.tileSizeM === 'object') {
        if (elBulkTileW) elBulkTileW.value = String(Math.round(src.tileSizeM.w * 1000));
        if (elBulkTileH) elBulkTileH.value = String(Math.round(src.tileSizeM.h * 1000));
        if (elBulkApplyTileSize) elBulkApplyTileSize.checked = true;
      } else {
        if (elBulkTileW) elBulkTileW.value = String(defs.tileSizeMm.w);
        if (elBulkTileH) elBulkTileH.value = String(defs.tileSizeMm.h);
        if (elBulkApplyTileSize) elBulkApplyTileSize.checked = false;
      }
      const p = (src.params && typeof src.params === 'object') ? src.params : {};
      for (const row of elBulkParams.querySelectorAll('.bulkParam')) {
        const k = row.dataset.key;
        const v = (typeof p[k] === 'number') ? p[k] : defs[k];
        row.dataset.value = String(v);
        row.querySelector('input[type="range"]').value = String(v);
        row.querySelector('input[type="number"]').value = String(v);
        const cb = row.querySelector('input[data-action="apply"]');
        cb.checked = typeof p[k] === 'number';
        row.dataset.apply = cb.checked ? '1' : '0';
      }
      setStatus(elBulkModalStatus, 'ok', 'Скопировано из текстуры. Отмечены только параметры, которые были переопределены.' );
    };

    // Reset overrides
    if (elBulkResetOverridesBtn) elBulkResetOverridesBtn.onclick = async () => {
      try {
        elBulkResetOverridesBtn.disabled = true;
        setStatus(elBulkModalStatus, '', 'Сбрасываем…');
        const target = String(elBulkApplyTarget?.value || 'selected');
        const ids = (target === 'all')
          ? items.map(it => it?.id || it?.textureId).filter(Boolean)
          : Array.from(getSelectedSet(shapeId));
        if (!ids.length) throw new Error('no_target_textures');
        await bulkResetOverridesAndSave(shapeId, ids);
        state.paletteByShapeId.delete(shapeId);
        const fresh = await ensurePaletteLoaded(shapeId);
        renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);
        setStatus(elBulkModalStatus, 'ok', 'Переопределения сброшены и сохранены.');
      } catch (e) {
        console.warn(e);
        setStatus(elBulkModalStatus, 'err', `Ошибка: ${e.message}`);
      } finally {
        elBulkResetOverridesBtn.disabled = false;
      }
    };

    // Apply
    if (elBulkApplyBtn) elBulkApplyBtn.onclick = async () => {
      try {
        elBulkApplyBtn.disabled = true;
        setStatus(elBulkModalStatus, '', 'Применяем и сохраняем…');
        await applyBulkAndSave(shapeId);
        state.paletteByShapeId.delete(shapeId);
        const fresh = await ensurePaletteLoaded(shapeId);
        renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);
        setStatus(elPaletteStatus, 'ok', 'Палитра сохранена (массовое изменение).');
        closeBulkModal();
      } catch (e) {
        console.warn(e);
        setStatus(elBulkModalStatus, 'err', `Ошибка: ${e.message}`);
      } finally {
        elBulkApplyBtn.disabled = false;
      }
    };

    showBulkModal(true);
  }

  function findShapeById(shapeId) {
    return (state.shapes || []).find(s => String(s?.id) === String(shapeId)) || null;
  }

  async function renderRoute() {
    const r = parseRoute();
    // Clear per-view statuses
    setStatus(elPaletteStatus, '', '');
    if (r.name === 'forms') {
      telemetryPage('admin_forms', { search: String(elShapeSearch && elShapeSearch.value || '') });
      showView('forms');
      renderShapesList(elShapeSearch.value);
      renderTelemetryPanel();
      return;
    }

    if (r.name === 'shape') {
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) {
        location.hash = '#/forms';
        return;
      }
      showView('shape');
      setActiveTab(r.tab);

      const shape = findShapeById(shapeId);
      if (!shape) {
        setStatus(elStatus, 'warn', `Форма "${shapeId}" не найдена в shapes.json. Обновите список.`);
        elShapeHeader.replaceChildren();
      } else {
        renderShapeHeader(shape);
      }

      if (r.tab === 'textures') {
        const palette = await ensurePaletteLoaded(shapeId);
        renderTextures(shapeId, Array.isArray(palette?.items) ? palette.items : []);

        // Bucket library (all uploaded textures)
        try {
          await ensureBucketIndexLoaded(shapeId);
          renderBucketTextures(shapeId);
        } catch {
          // errors are shown in bucket status; do not break the page
          elBucketEmpty && (elBucketEmpty.style.display = 'block');
        }
      }

      if (r.tab === 'upload') {
        // If user just opened Upload tab manually - default to "new" mode.
        const ctx = state.uploadContext || { mode: 'new' };
        if (ctx.mode !== 'update' || ctx.shapeId !== shapeId) {
          setUploadModeNew();
          setStatus(elUploadStatus, '', '');
        }
        renderUploadQueue();
      }
      if (r.tab === 'settings') {
        const settings = await ensurePaletteSettingsLoaded(shapeId);
        fillPaletteSettingsForm(settings, shapeId);
      }
      renderTelemetryPanel();
      return;
    }
  }

  async function initAfterLogin() {
    bindPaletteSettingsTelemetry();
    await ensureShapesLoaded();
    state.paletteByShapeId.clear();
    state.paletteSettingsByShapeId.clear();
    renderShapesList(elShapeSearch.value);

    // Default route
    if (!location.hash) location.hash = '#/forms';
    await renderRoute();
    renderTelemetryPanel();
  }

  function bindUI() {
    elBtnLogin.addEventListener('click', async () => {
      const u = (elLoginUser.value || '').trim();
      const p = (elLoginPass.value || '').trim();
      if (!API_BASE_URL) {
        telemetryError('admin_login_config_missing', new Error('API_BASE_URL missing'), {});
        setStatus(elLoginStatus, 'err', 'API_BASE_URL не задан. Проверьте admin/config.js');
        return;
      }
      if (!u || !p) {
        telemetryTrack('admin_login_validation', { reason: 'missing_credentials' });
        setStatus(elLoginStatus, 'warn', 'Введите логин и пароль');
        return;
      }
      elBtnLogin.disabled = true;
      try {
        await login(u, p);
        telemetryTrack('admin_login_success', { username: u });
        setStatus(elLoginStatus, 'ok', 'Успешно. Загружаем данные…');
        showLoggedInUI(true);
        await initAfterLogin();
        setStatus(elLoginStatus, '', '');
      } catch (e) {
        console.warn(e);
        telemetryError('admin_login_failed', e, { username: u });
        setToken('');
        setStatus(elLoginStatus, 'err', `Ошибка входа: ${e.message}`);
        showLoggedInUI(false);
      } finally {
        elBtnLogin.disabled = false;
      }
    });

    elBtnLogout.addEventListener('click', () => {
      telemetryTrack('admin_logout', {});
      setToken('');
      showLoggedInUI(false);
      setStatus(elStatus, '', '');
      setStatus(elLoginStatus, '', '');
      state.shapes = [];
      state.paletteByShapeId.clear();
      state.paletteSettingsByShapeId.clear();
    });

    elReload.addEventListener('click', async () => {
      telemetryTrack('admin_reload', {});
      try {
        await ensureShapesLoaded();
        state.paletteByShapeId.clear();
        await renderRoute();
      } catch (e) {
        console.warn(e);
        setStatus(elStatus, 'err', `Ошибка обновления: ${e.message}`);
      }
    });

    const bindTelemetryLauncher = (el) => {
      el && el.addEventListener('click', async () => {
        await openTelemetryModal();
      });
    };
    bindTelemetryLauncher(elBtnOpenTelemetry);
    bindTelemetryLauncher(elBtnOpenTelemetryInline);

    if (elTelemetryModal) {
      elTelemetryModal.querySelectorAll('[data-action="close"]').forEach((node) => {
        node.addEventListener('click', () => closeTelemetryModal());
      });
    }
    if (elTelemetryErrorReportModal) {
      elTelemetryErrorReportModal.querySelectorAll('[data-action="close"]').forEach((node) => {
        node.addEventListener('click', () => closeTelemetryErrorReportModal());
      });
    }
    elTelemetryModalCloseBtn && elTelemetryModalCloseBtn.addEventListener('click', () => closeTelemetryModal());
    elTelemetryErrorReportModalCloseBtn && elTelemetryErrorReportModalCloseBtn.addEventListener('click', () => closeTelemetryErrorReportModal());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (elTelemetryErrorReportModal && !elTelemetryErrorReportModal.hidden) { closeTelemetryErrorReportModal(); return; }
      if (elTelemetryModal && !elTelemetryModal.hidden) closeTelemetryModal();
    });

    [elTelemetryPeriodSelect, elTelemetryDeviceSelect].forEach((el) => {
      el && el.addEventListener('change', () => {
        telemetryTrack('admin_telemetry_filter_change', getTelemetryFilters());
        renderTelemetryPanel();
        if (elTelemetryErrorReportModal && !elTelemetryErrorReportModal.hidden) loadTelemetryErrorReportData();
      });
    });

    [elTelemetryErrorSeveritySelect, elTelemetryErrorCategorySelect, elTelemetryErrorSourceSelect].forEach((el) => {
      el && el.addEventListener('change', async () => {
        telemetryTrack('admin_error_report_filter_change', Object.assign({}, getTelemetryFilters(), getTelemetryErrorReportFilters()));
        if (telemetryErrorReportState) {
          await loadTelemetryErrorReportData();
        }
      });
    });

    elTelemetryStats && elTelemetryStats.addEventListener('click', async (e) => {
      const trigger = e.target.closest('[data-action="open-error-report"], [data-error-report="1"]');
      if (!trigger) return;
      e.preventDefault();
      await openTelemetryErrorReportModal();
    });
    elTelemetryStats && elTelemetryStats.addEventListener('keydown', async (e) => {
      const trigger = e.target.closest('[data-error-report="1"]');
      if (!trigger) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      await openTelemetryErrorReportModal();
    });

    elTelemetryRefreshBtn && elTelemetryRefreshBtn.addEventListener('click', () => {
      telemetryTrack('admin_telemetry_refresh', getTelemetryFilters());
      renderTelemetryPanel();
      if (elTelemetryErrorReportModal && !elTelemetryErrorReportModal.hidden) loadTelemetryErrorReportData();
    });

    elTelemetryErrorReportRefreshBtn && elTelemetryErrorReportRefreshBtn.addEventListener('click', async () => {
      telemetryTrack('admin_error_report_refresh', Object.assign({}, getTelemetryFilters(), getTelemetryErrorReportFilters()));
      await loadTelemetryErrorReportData();
    });

    elTelemetryFlushBtn && elTelemetryFlushBtn.addEventListener('click', async () => {
      telemetryTrack('admin_telemetry_flush_click', {});
      setTelemetryStatus('Пробуем передать на сервер данные этого браузера…', '');
      try {
        const ok = telemetry && telemetry.flush ? await telemetry.flush() : false;
        renderTelemetryPanel();
        if (elTelemetryErrorReportModal && !elTelemetryErrorReportModal.hidden) await loadTelemetryErrorReportData();
        setTelemetryStatus(ok ? 'Данные этого браузера переданы на сервер.' : 'Сервер не подтвердил приём данных этого браузера или сводка временно недоступна.', ok ? 'ok' : 'warn');
      } catch (e) {
        telemetryError('admin_telemetry_flush_failed', e, {});
        setTelemetryStatus('Ошибка передачи данных этого браузера.', 'err');
      }
    });

    bindConfirmModal();

    elTelemetryExportBtn && elTelemetryExportBtn.addEventListener('click', () => {
      telemetryTrack('admin_telemetry_export', {});
      const payload = telemetry && telemetry.exportJson ? telemetry.exportJson() : {};
      downloadJson('webar_telemetry_export.json', payload);
      renderTelemetryPanel();
    });

    elTelemetryErrorReportClearBtn && elTelemetryErrorReportClearBtn.addEventListener('click', async () => {
      await clearTelemetryErrorReportCurrent();
    });

    elTelemetryErrorReportCsvBtn && elTelemetryErrorReportCsvBtn.addEventListener('click', async () => {
      telemetryTrack('admin_error_report_export_csv', Object.assign({}, getTelemetryFilters(), getTelemetryErrorReportFilters()));
      await exportTelemetryErrorReportCsv();
    });

    elTelemetryErrorReportJsonBtn && elTelemetryErrorReportJsonBtn.addEventListener('click', async () => {
      telemetryTrack('admin_error_report_export_json', Object.assign({}, getTelemetryFilters(), getTelemetryErrorReportFilters()));
      await exportTelemetryErrorReportJson();
    });

    elTelemetryClearBtn && elTelemetryClearBtn.addEventListener('click', () => {
      telemetryTrack('admin_telemetry_clear', {});
      try { telemetry && telemetry.clearAll && telemetry.clearAll(); } catch (_) {}
      renderTelemetryPanel();
      if (elTelemetryErrorReportModal && !elTelemetryErrorReportModal.hidden) loadTelemetryErrorReportData();
      setTelemetryStatus('Журнал этого браузера очищен.', 'ok');
    });

    elShapeSearch.addEventListener('input', () => {
      if (parseRoute().name !== 'forms') return;
      renderShapesList(elShapeSearch.value);
    });

    elBackBtn.addEventListener('click', () => {
      location.hash = '#/forms';
    });

    // Tabs
    elShapeTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      const tab = btn.dataset.tab;
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const id = r.id || '';
      location.hash = `#/shape/${id}/${tab}`;
    });

    // Quick action to upload tab
    elBtnUploadGo.addEventListener('click', () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      location.hash = `#/shape/${r.id || ''}/upload`;
    });

    // Manual palette save (useful after multiple edits)
    elBtnPaletteSave?.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      try {
        const palette = state.paletteByShapeId.get(shapeId) || (await ensurePaletteLoaded(shapeId));
        const items = Array.isArray(palette?.items) ? palette.items : [];
        setStatus(elPaletteStatus, '', 'Сохраняем палитру…');
        await savePalette(shapeId, { shapeId, items });
        setStatus(elPaletteStatus, 'ok', 'Палитра сохранена.');
      } catch (e) {
        console.warn(e);
        setStatus(elPaletteStatus, 'err', `Ошибка сохранения палитры: ${e.message}`);
      }
    });

    // Bucket library controls (textures tab)
    elBucketReload?.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      try {
        await ensureBucketIndexLoaded(shapeId, { forceReload: true });
        renderBucketTextures(shapeId);
      } catch (e) {
        console.warn(e);
      }
    });
    elBucketFilter?.addEventListener('change', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      renderBucketTextures(shapeId);
    });

    // Bulk selection / mass edit (textures tab)
    elBulkSelectAll?.addEventListener('change', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      const palette = state.paletteByShapeId.get(shapeId) || (await ensurePaletteLoaded(shapeId));
      const items = Array.isArray(palette?.items) ? palette.items : [];
      const ids = items.map(it => it?.id || it?.textureId).filter(Boolean);
      const set = getSelectedSet(shapeId);
      set.clear();
      if (elBulkSelectAll.checked) {
        ids.forEach(id => set.add(id));
      }
      renderTextures(shapeId, items);
    });

    elBulkClearBtn?.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      const set = getSelectedSet(shapeId);
      set.clear();
      const palette = state.paletteByShapeId.get(shapeId) || (await ensurePaletteLoaded(shapeId));
      renderTextures(shapeId, Array.isArray(palette?.items) ? palette.items : []);
    });

    elBulkResetBtn?.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      const set = getSelectedSet(shapeId);
      const ids = Array.from(set);
      if (!ids.length) return;
      try {
        setStatus(elPaletteStatus, '', `Сброс переопределений: ${ids.length}...`);
        await bulkResetOverridesAndSave(shapeId, ids);
        // Keep selection
        state.paletteByShapeId.delete(shapeId);
        const fresh = await ensurePaletteLoaded(shapeId);
        renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);
        setStatus(elPaletteStatus, 'ok', 'Сброшено и сохранено.');
      } catch (e) {
        console.warn(e);
        setStatus(elPaletteStatus, 'err', `Ошибка: ${e.message}`);
      }
    });

    elBulkEditBtn?.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      if (!shapeId) return;
      try {
        await openBulkParamsModal(shapeId);
      } catch (e) {
        console.warn(e);
        setStatus(elPaletteStatus, 'err', `Не удалось открыть массовое редактирование: ${e.message}`);
      }
    });

    // Upload actions
    elUploadClearBtn?.addEventListener('click', () => {
      clearUploadUI();
    });

    elUploadStartBtn?.addEventListener('click', async () => {
          const r = parseRoute();
          if (r.name !== 'shape') return;
          const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
          const quality = String(elUploadQuality?.value || '1k');
          const manualTextureId = normalizeTextureId(elUploadTextureId?.value, shapeId);
          const displayName = String(elUploadTextureName?.value || '').trim();

          const ctx = state.uploadContext || { mode: 'new' };
          const isUpdateMode = ctx.mode === 'update' && ctx.shapeId === shapeId && Boolean(ctx.textureId);
          const targetTextureId = isUpdateMode ? String(ctx.textureId) : manualTextureId;

          if (!shapeId) {
            setStatus(elUploadStatus, 'err', 'Неизвестна форма (shapeId).');
            return;
          }

          try {
            setStatus(elUploadStatus, '', 'Подготавливаем файлы…');
            elUploadStartBtn.disabled = true;

            const zipFile = elUploadZip?.files?.[0] || null;
            const listFiles = Array.from(elUploadFiles?.files || []);

            let zip = null;
            if (zipFile) zip = await unzipToFiles(zipFile);

            const isStructuredZip = Boolean(zip?.meta?.structured) && (Array.isArray(zip?.meta?.textureIds) && zip.meta.textureIds.length > 0);

            // In "update" mode we only allow a single textureId.
            if (isUpdateMode && isStructuredZip) {
              const tids = Array.isArray(zip?.meta?.textureIds) ? zip.meta.textureIds.filter(Boolean) : [];
              if (tids.length !== 1 || tids[0] !== targetTextureId) {
                throw new Error(`Режим обновления поддерживает только одну текстуру. В ZIP найдены textureId: ${tids.join(', ') || '—'}. Ожидается: ${targetTextureId}.`);
              }
            }

            // --- MODE 1: "умная сборка" (ZIP уже содержит структуру surfaces/<shapeId>/<textureId>/<quality>/...)
            if (isStructuredZip) {
              if (listFiles.length) {
                // In structured ZIP mode we ignore additional loose files to avoid ambiguity.
                setStatus(elUploadStatus, 'warn', 'ZIP содержит структуру surfaces/... — выбранные отдельные файлы будут проигнорированы.');
                await sleep(250);
              }

              const foundShapeIds = zip?.meta?.shapeIds || [];
              if (foundShapeIds.length === 0) {
                throw new Error('ZIP отмечен как структурированный, но не удалось определить shapeId.');
              }
              if (foundShapeIds.length > 1) {
                throw new Error(`ZIP содержит несколько shapeId: ${foundShapeIds.join(', ')}. Используйте ZIP только для одной формы.`);
              }
              if (foundShapeIds[0] !== shapeId) {
                throw new Error(`ZIP содержит shapeId="${foundShapeIds[0]}", но вы открыли форму "${shapeId}". Выберите правильную форму или используйте другой ZIP.`);
              }

              if (manualTextureId && !isUpdateMode) {
                setStatus(elUploadStatus, 'warn', `В ZIP уже есть структура по textureId. Поле textureId ("${manualTextureId}") будет проигнорировано.`);
                await sleep(250);
              }

              // Build tasks from structured ZIP. If filenames are non-standard, we may request manual mapping.
              const overrides = new Map(); // groupKey -> Map(mapType -> originalPath)
              let parsed = buildTasksFromZipStructured(shapeId, zip.files || [], overrides);

              // If any 1k groups miss required maps, open a modal to map files.
              // We do this sequentially to keep UX simple.
              while (parsed.mappingNeeded && parsed.mappingNeeded.length) {
                const t = parsed.mappingNeeded[0];
                setStatus(elUploadStatus, 'warn', `Нужно сопоставить карты для текстуры "${t.textureId}" (1k). Откроется окно сопоставления.`);
                await sleep(200);
                const mapping = await openZipMappingModal(t);
                overrides.set(t.groupKey, mapping);
                parsed = buildTasksFromZipStructured(shapeId, zip.files || [], overrides);
              }

              if (parsed.errors && parsed.errors.length) {
                throw new Error('Ошибка структуры ZIP: ' + parsed.errors.join('; '));
              }
              if (!parsed.tasks.length) {
                throw new Error('Не найдено подходящих файлов в ZIP. Ожидается структура surfaces/<shapeId>/<textureId>/<quality>/... (или выберите сопоставление карт в окне).');
              }

              const texturesWith2k = [];
              if (parsed?.textures && typeof parsed.textures.entries === 'function') {
                for (const [texId, info] of parsed.textures.entries()) {
                  if (!texId || !info?.qualities?.has || !info.qualities.has('2k')) continue;
                  texturesWith2k.push(texId);
                }
              }
              if (texturesWith2k.length) {
                try {
                  await ensureBucketIndexLoaded(shapeId, { forceReload: true });
                } catch (e) {
                  console.warn(e);
                  throw new Error('Не удалось проверить базовую 1k-текстуру перед structured ZIP загрузкой 2k. Проверьте доступ к индексу бакета и повторите попытку.');
                }
                const missingBase1k = texturesWith2k.filter(texId => !hasCompleteBucketTexture1k(shapeId, texId));
                if (missingBase1k.length) {
                  throw new Error(`Structured ZIP содержит 2k для текстур без уже существующей полной 1k: ${missingBase1k.join(', ')}. Сначала загрузите и сохраните полный набор 1k (albedo, normal, roughness, height), затем повторите загрузку 2k.`);
                }
              }

              state.uploadTasks = parsed.tasks;
              renderUploadQueue();

              const conc = Number(elUploadConcurrency?.value || 3);
                            setStatusRich(elUploadStatus, '', {
                title: 'Загрузка началась…',
                message: 'Передаём файлы в бакет по structured ZIP.',
                bullets: [`Текстур: ${parsed.textures.size}`, `Файлов: ${parsed.tasks.length}`],
                meta: [`Форма: ${shapeId}`],
              });
              const res = await runUploadQueue(conc);
              if (!res.ok) {
                              setStatusRich(elUploadStatus, 'err', {
                title: 'Загрузка завершена с ошибками',
                message: 'Не все файлы удалось передать в бакет.',
                bullets: [`Ошибок: ${res.failed}`],
                note: 'Проверьте CORS бакета, имена файлов и повторите попытку.',
                meta: [`Форма: ${shapeId}`],
              });
                return;
              }
                            setStatusRich(elUploadStatus, 'ok', {
                title: 'Файлы загружены',
                message: 'Structured ZIP успешно выгружен в бакет.',
                bullets: [`Текстур: ${parsed.textures.size}`, `Файлов: ${parsed.tasks.length}`],
                meta: [`Форма: ${shapeId}`],
              });

              if (elUploadAutoAdd?.checked) {
                                setStatusRich(elUploadStatus, '', {
                  title: 'Обновляем палитру…',
                  message: 'Добавляем или обновляем записи текстур после загрузки structured ZIP.',
                  meta: [`Форма: ${shapeId}`],
                });

                // tileSizeM: explicit (uploadTileW/H) wins, else from palette-settings defaults if exists, else omit.
                let tileSizeM = null;
                const wMm = num(elUploadTileW?.value, null);
                const hMm = num(elUploadTileH?.value, null);
                if (wMm && hMm) {
                  tileSizeM = { w: Math.max(1, wMm) / 1000, h: Math.max(1, hMm) / 1000 };
                } else {
                  try {
                    const ps = await ensurePaletteSettingsLoaded(shapeId);
                    const d = ps?.defaults;
                    if (d?.tileSizeM && typeof d.tileSizeM.w === 'number' && typeof d.tileSizeM.h === 'number') {
                      tileSizeM = { w: d.tileSizeM.w, h: d.tileSizeM.h };
                    }
                  } catch {
                    // ignore
                  }
                }

                const palette = await ensurePaletteLoaded(shapeId);
                const items = Array.isArray(palette?.items) ? [...palette.items] : [];

                const tasksByTexture1k = groupTasksByTexture(parsed.tasks, '1k');
                for (const [texId, texTasks] of tasksByTexture1k.entries()) {
                  const item = buildPaletteItemFromUpload(shapeId, texId, texId, '1k', texTasks, tileSizeM);
                  const idx = items.findIndex(x => x && x.id === item.id);
                  if (idx >= 0) items[idx] = item;
                  else items.push(item);
                }

                const next = { shapeId, items };
                await savePalette(shapeId, next);

                // refresh local cache + UI
                state.paletteByShapeId.delete(shapeId);
                const fresh = await ensurePaletteLoaded(shapeId);
                renderTextures(shapeId, Array.isArray(fresh?.items) ? fresh.items : []);

                                setStatusRich(elUploadStatus, 'ok', {
                  title: 'Палитра обновлена',
                  message: 'Файлы загружены, палитра сохранена.',
                  bullets: [`Текстур обновлено: ${tasksByTexture1k.size}`],
                  meta: [`Форма: ${shapeId}`],
                });
                try {
                  await ensureBucketIndexLoaded(shapeId, { forceReload: true });
                } catch {}
              }

              if (elUploadAutoAdd?.checked) {
                // Sync palette item maps from bucket (guards against mixed formats / custom file names)
                // only when palette mutation is explicitly enabled via auto-add.
                try {
                  const toSync = (parsed?.textures && typeof parsed.textures.keys === 'function')
                    ? Array.from(parsed.textures.keys())
                    : [];
                  const syncSummary = await syncTexturesBatch(shapeId, toSync);
                  state.paletteByShapeId.delete(shapeId);
                  const fresh2 = await ensurePaletteLoaded(shapeId, { forceReload: true });
                  if (parseRoute().name === 'shape') renderTextures(shapeId, Array.isArray(fresh2?.items) ? fresh2.items : []);
                  const failedLabels = syncSummary.failures.map((item) => item.textureId).filter(Boolean);
                  const tone = syncSummary.failed > 0 || syncSummary.fallback > 0 ? 'warn' : 'ok';
                  const title = syncSummary.failed > 0
                    ? 'Загрузка завершена, синхронизация выполнена частично'
                    : (syncSummary.fallback > 0 ? 'Готово: синхронизация выполнена через fallback' : 'Готово: загрузка и синхронизация завершены');
                  const message = syncSummary.failed > 0
                    ? 'Файлы уже загружены и палитра обновлена, но часть текстур не удалось синхронизировать с бакетом.'
                    : (syncSummary.fallback > 0
                      ? 'Файлы загружены и палитра обновлена, но часть синхронизации выполнена без штатного backend sync endpoint.'
                      : 'Файлы загружены, палитра обновлена и синхронизирована с бакетом.');
                  setStatusRich(elUploadStatus, tone, {
                    title,
                    message,
                    bullets: [
                      `Текстур синхронизировано: ${syncSummary.synced}/${syncSummary.requested}`,
                      syncSummary.fallback > 0 ? `Fallback sync: ${syncSummary.fallback}` : null,
                      syncSummary.failed > 0 ? `Не удалось синхронизировать: ${syncSummary.failed}` : null,
                      failedLabels.length ? `Проблемные текстуры: ${failedLabels.join(', ')}` : null,
                    ].filter(Boolean),
                    note: syncSummary.failed > 0
                      ? 'Откройте проблемные текстуры и повторите sync после проверки bucket index / backend endpoint.'
                      : (syncSummary.fallback > 0 ? 'Проверьте backend sync endpoint, если хотите полностью штатный сценарий.' : ''),
                    meta: [`Форма: ${shapeId}`],
                  });
                } catch (e) {
                  console.warn(e);
                  setStatusRich(elUploadStatus, 'warn', {
                    title: 'Загрузка завершена, но итог синхронизации не получен',
                    message: formatAdminErrorMessage(e, 'Файлы уже загружены, но обновить палитру по данным бакета не получилось.'),
                    note: 'Проверьте backend / доступы S3 и повторите sync при необходимости.',
                    meta: [`Форма: ${shapeId}`],
                  });
                }
              } else {
                try {
                  await ensureBucketIndexLoaded(shapeId, { forceReload: true });
                } catch {}
                                setStatusRich(elUploadStatus, 'ok', {
                  title: 'Файлы загружены',
                  message: 'Палитра не изменялась, потому что auto-add выключен.',
                  bullets: [`Текстур: ${parsed.textures.size}`, `Файлов: ${parsed.tasks.length}`],
                  meta: [`Форма: ${shapeId}`],
                });
              }

              return;
            }

            // --- MODE 2: "ручной" (файлы/ZIP без структуры) — как раньше: один textureId
            const textureId = targetTextureId;
            if (!textureId) {
              setStatus(elUploadStatus, 'err', 'Укажите textureId (или используйте ZIP со структурой surfaces/... для умной сборки).');
              return;
            }

            let files = [];
            let meta = {};
            if (zipFile) {
              const z = zip || await unzipToFiles(zipFile);
              files = z.files.map(x => x.file);
              meta = z.meta || {};
            }
            if (listFiles.length) {
              files.push(...listFiles);
            }
            if (!files.length) {
              setStatus(elUploadStatus, 'warn', 'Выберите файлы или ZIP для загрузки.');
              return;
            }

            if (quality === '2k') {
              try {
                await ensureBucketIndexLoaded(shapeId, { forceReload: true });
              } catch (e) {
                console.warn(e);
                setStatus(elUploadStatus, 'err', 'Не удалось проверить базовую 1k-текстуру перед загрузкой 2k. Проверьте доступ к индексу бакета и повторите попытку.');
                return;
              }
              if (!hasCompleteBucketTexture1k(shapeId, textureId)) {
                setStatus(elUploadStatus, 'err', 'Загрузка 2k разрешена только после полной 1k-текстуры (albedo, normal, roughness, height). Сначала загрузите полный набор 1k.');
                return;
              }
            }

            // If ZIP contains a different textureId, warn but continue with user-provided textureId.
            if (meta?.textureIds?.length === 1 && meta.textureIds[0] && meta.textureIds[0] !== textureId) {
              setStatus(elUploadStatus, 'warn', `ZIP содержит textureId="${meta.textureIds[0]}", но будет использовано значение из формы: "${textureId}".`);
              await sleep(300);
            }

            const tasks = buildTasksFromFiles(shapeId, textureId, quality, files);
            state.uploadTasks = tasks;
            renderUploadQueue();

            const conc = Number(elUploadConcurrency?.value || 3);
            setStatusRich(elUploadStatus, '', {
              title: 'Загрузка началась…',
              message: 'Передаём выбранные файлы в бакет.',
              bullets: [`Texture ID: ${textureId}`, `Качество: ${quality}`, `Файлов: ${tasks.length}`],
              meta: [`Форма: ${shapeId}`],
            });
            const res = await runUploadQueue(conc);
            if (!res.ok) {
              setStatusRich(elUploadStatus, 'err', {
                title: 'Загрузка завершена с ошибками',
                message: 'Не все файлы удалось передать в бакет.',
                bullets: [`Ошибок: ${res.failed}`],
                note: 'Проверьте CORS бакета, имена файлов и повторите попытку.',
                meta: [`Форма: ${shapeId}`],
              });
              return;
            }
            setStatusRich(elUploadStatus, 'ok', {
              title: 'Файлы загружены',
              message: 'Выбранные файлы успешно выгружены в бакет.',
              bullets: [`Texture ID: ${textureId}`, `Качество: ${quality}`, `Файлов: ${tasks.length}`],
              meta: [`Форма: ${shapeId}`],
            });

            if (elUploadAutoAdd?.checked) {
              setStatusRich(elUploadStatus, '', {
                title: quality === '2k' ? 'Синхронизируем палитру…' : 'Обновляем палитру…',
                message: quality === '2k'
                  ? 'Подтягиваем canonical карты из бакета после загрузки 2k.'
                  : 'Добавляем или обновляем запись текстуры в палитре.',
                bullets: [`Texture ID: ${textureId}`, `Качество: ${quality}`],
                meta: [`Форма: ${shapeId}`],
              });

              let tileSizeM = null;
              if (quality === '1k') {
                const wMm = num(elUploadTileW?.value, null);
                const hMm = num(elUploadTileH?.value, null);
                if (wMm && hMm) {
                  tileSizeM = { w: Math.max(1, wMm) / 1000, h: Math.max(1, hMm) / 1000 };
                } else {
                  try {
                    const ps = await ensurePaletteSettingsLoaded(shapeId);
                    const d = ps?.defaults;
                    if (d?.tileSizeM && typeof d.tileSizeM.w === 'number' && typeof d.tileSizeM.h === 'number') {
                      tileSizeM = { w: d.tileSizeM.w, h: d.tileSizeM.h };
                    }
                  } catch {
                    // ignore
                  }
                }
              }

              if (quality === '1k') {
                const item = buildPaletteItemFromUpload(shapeId, textureId, displayName, quality, tasks, tileSizeM);
                await upsertItemAndSavePalette(shapeId, item);
              }

              const syncSummary = await syncTexturesBatch(shapeId, [textureId]);
              if (syncSummary.failed > 0) {
                const firstFailure = syncSummary.failures[0];
                setStatusRich(elUploadStatus, 'warn', {
                  title: 'Палитра обновлена, но синхронизация не удалась',
                  message: 'Файлы загружены и запись в палитре сохранена, но sync по бакету завершился ошибкой.',
                  bullets: [
                    `Texture ID: ${textureId}`,
                    `Качество: ${quality}`,
                    firstFailure ? `Причина: ${firstFailure.message}` : null,
                  ].filter(Boolean),
                  note: 'Проверьте backend / доступы S3 и повторите sync при необходимости.',
                  meta: [`Форма: ${shapeId}`],
                });
              } else {
                const syncUsedFallback = syncSummary.fallback > 0;
                setStatusRich(elUploadStatus, syncUsedFallback ? 'warn' : 'ok', {
                  title: syncUsedFallback ? 'Готово: синхронизация выполнена через fallback' : 'Готово: загрузка завершена',
                  message: quality === '2k'
                    ? '2k-файлы загружены и синхронизированы с существующей 1k-текстурой.'
                    : 'Файлы загружены, палитра обновлена и сохранена.',
                  bullets: [
                    `Texture ID: ${textureId}`,
                    `Качество: ${quality}`,
                    syncUsedFallback ? 'Sync: fallback' : 'Sync: backend',
                  ],
                  note: syncUsedFallback ? 'Штатный backend sync endpoint недоступен — использован безопасный fallback.' : '',
                  meta: [`Форма: ${shapeId}`],
                });
              }
              try {
                await ensureBucketIndexLoaded(shapeId, { forceReload: true });
              } catch {}
            }

            // Exit update mode after successful overwrite (prevents accidental overwrites).
            if (isUpdateMode) {
              setUploadModeNew();
            }
          } catch (e) {
            console.warn(e);
            const hint = e?.data?.hint ? `\n${e.data.hint}` : '';
            setStatus(elUploadStatus, 'err', `Ошибка: ${e.message}${hint}`);
          } finally {
            elUploadStartBtn.disabled = false;
          }
        });

    // Palette settings actions
    elBtnSettingsReload.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      try {
        state.paletteSettingsByShapeId.delete(shapeId);
        const settings = await ensurePaletteSettingsLoaded(shapeId, { forceReload: true });
        fillPaletteSettingsForm(settings, shapeId);
      } catch (e) {
        console.warn(e);
        setStatus(elSettingsStatus, 'err', `Ошибка загрузки настроек: ${e.message}`);
      }
    });

    elBtnSettingsReset?.addEventListener('click', () => {
      // Reset form fields to recommended neutral defaults (does not save).
      elSettingsTileW.value = String(RECOMMENDED_DEFAULTS.tileSizeMm.w);
      elSettingsTileH.value = String(RECOMMENDED_DEFAULTS.tileSizeMm.h);
      elSettingsUvScale.value = String(RECOMMENDED_DEFAULTS.uvScale);
      elSettingsExposure.value = String(RECOMMENDED_DEFAULTS.exposureMult);
      elSettingsContrast.value = String(RECOMMENDED_DEFAULTS.contrast);
      elSettingsSaturation.value = String(RECOMMENDED_DEFAULTS.saturation);
      elSettingsRoughness.value = String(RECOMMENDED_DEFAULTS.roughnessMult);
      elSettingsSpec.value = String(RECOMMENDED_DEFAULTS.specStrength);
      elSettingsNormalScale.value = String(RECOMMENDED_DEFAULTS.normalScale);
      elSettingsBumpScale.value = String(RECOMMENDED_DEFAULTS.bumpScale);
      setStatus(elSettingsStatus, 'warn', 'Поля сброшены к рекомендуемым значениям. Нажмите «Сохранить», чтобы применить.');
    });

    elBtnSettingsSave.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      telemetryPage('admin_shape', { shapeId, tab: String(r.tab || 'textures') });
      const payload = collectPaletteSettingsFromForm(shapeId);
      elBtnSettingsSave.disabled = true;
      try {
        setStatus(elSettingsStatus, '', 'Сохраняем…');
        const res = await apiFetch('/api/palette-settings/' + encodeURIComponent(shapeId), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        // invalidate cache and re-load
        state.paletteSettingsByShapeId.delete(shapeId);
        const settings = await ensurePaletteSettingsLoaded(shapeId, { forceReload: true });
        fillPaletteSettingsForm(settings, shapeId);
        setStatus(elSettingsStatus, 'ok', `Сохранено: ${res?.key || `palette_settings/${shapeId}.json`}`);
      } catch (e) {
        console.warn(e);
        const hint = e?.data?.hint ? `\n${e.data.hint}` : '';
        setStatus(elSettingsStatus, 'err', `Ошибка сохранения: ${e.message}${hint}`);
      } finally {
        elBtnSettingsSave.disabled = false;
      }
    });

    window.addEventListener('hashchange', () => {
      // no await
      renderRoute().catch((e) => {
        console.warn(e);
        setStatus(elStatus, 'err', `Ошибка: ${e.message}`);
      });
    });
  }

  async function init() {
    bindUI();

    if (!API_BASE_URL) {
      setStatus(elLoginStatus, 'warn', 'API_BASE_URL не задан. Укажите его в admin/config.js');
    }

    // try restore
    if (getToken()) {
      showLoggedInUI(true);
      try {
        await initAfterLogin();
      } catch (e) {
        console.warn(e);
        setToken('');
        showLoggedInUI(false);
        setStatus(elLoginStatus, 'warn', 'Сессия истекла или backend недоступен. Войдите снова.');
      }
    } else {
      showLoggedInUI(false);
      if (!location.hash) location.hash = '#/forms';
    }
  }

  init();
  syncAdminSwUpdateState();
})();
