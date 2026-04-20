// BUILD: v28 2026-01-16f (runtime-config)
const __BUILD_ID__ = "20260419-f24br";
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

  function setStatus(el, type, msg) {
    if (!el) return;
    el.className = 'status ' + (type || '');
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
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
      img.src = url;
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
      elMapTbody.innerHTML = '';

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

      const selects = new Map();

      for (const row of rows) {
        const tr = document.createElement('tr');

        const tdType = document.createElement('td');
        tdType.innerHTML = row.required
          ? `<b>${escapeHtml(row.type)}</b> <span class="uploadPill">обяз.</span>`
          : `<b>${escapeHtml(row.type)}</b> <span class="uploadPill">опц.</span>`;
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
      };

      const onCancel = () => {
        cleanup();
        close();
        reject(new Error('upload_cancelled'));
      };

      const onApply = () => {
        // Validate required
        const required = ['albedo', 'normal', 'roughness', 'height'];
        for (const t of required) {
          const v = selects.get(t)?.value || '';
          if (!v) {
            setStatus(elMapModalStatus, 'err', `Выберите файл для обязательной карты: ${t}`);
            return;
          }
        }
        // Validate uniqueness (avoid selecting the same file for different required maps)
        const used = new Set();
        for (const t of required) {
          const v = selects.get(t).value;
          if (used.has(v)) {
            setStatus(elMapModalStatus, 'err', 'Один и тот же файл выбран для нескольких обязательных карт. Проверьте сопоставление.');
            return;
          }
          used.add(v);
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
    const localLast = formatTelemetryDateTime(local.latestLocalEventAt || '');
    const localPendingLast = formatTelemetryDateTime(local.latestPendingEventAt || '');
    const localFlushOk = formatTelemetryDateTime(local.lastFlushSuccessAt || '');
    const localFlushFail = formatTelemetryDateTime(local.lastFlushFailedAt || '');
    const localResult = local.lastFlushResult ? String(local.lastFlushResult) : '—';
    const pending = Number(local.pending || 0) || 0;
    const syncBadge = pending > 0
      ? '<span class="telemetryKpi__badge telemetryKpi__badge--warn">Есть данные этого устройства, которые ещё не попали в общую сводку</span>'
      : '<span class="telemetryKpi__badge telemetryKpi__badge--good">Данные этого устройства уже переданы в общую сводку</span>';
    const remoteBadge = remoteReady
      ? '<span class="telemetryKpi__badge telemetryKpi__badge--good">Сводная аналитика со всех устройств доступна</span>'
      : '<span class="telemetryKpi__badge telemetryKpi__badge--warn">Сводная аналитика со всех устройств временно недоступна</span>';
    return `
      <div class="telemetryPanel">
        <div class="telemetryKpi__head">
          <div class="telemetryPanel__label">Данные этого устройства</div>
          ${syncBadge}
        </div>
        <div class="telemetryPanel__sub">Источник: текущий браузер и устройство. Кнопка «Синхронизировать это устройство» передаёт на сервер только данные этого браузера.</div>
        <div class="telemetryPanel__list">
          <div class="telemetryPanel__item"><span>Событий на этом устройстве</span><b>${escapeHtml(String(local.totalLocal || 0))}</b></div>
          <div class="telemetryPanel__item"><span>Ещё не передано на сервер</span><b>${escapeHtml(String(pending))}</b></div>
          <div class="telemetryPanel__item"><span>Последнее действие на этом устройстве</span><b>${escapeHtml(localLast)}</b></div>
          <div class="telemetryPanel__item"><span>Последнее ожидающее действие</span><b>${escapeHtml(localPendingLast)}</b></div>
          <div class="telemetryPanel__item"><span>Последняя передача данных на сервер</span><b>${escapeHtml(localFlushOk)}</b></div>
          <div class="telemetryPanel__item"><span>Последняя ошибка передачи</span><b>${escapeHtml(localFlushFail)}</b></div>
          <div class="telemetryPanel__item"><span>Состояние синхронизации</span><b>${escapeHtml(localResult)}</b></div>
        </div>
      </div>
      <div class="telemetryPanel">
        <div class="telemetryKpi__head">
          <div class="telemetryPanel__label">Сводная аналитика со всех устройств</div>
          ${remoteBadge}
        </div>
        <div class="telemetryPanel__sub">${escapeHtml(sourceLabel)}. Эти данные собираются со всех устройств. Они появляются после автоматической синхронизации с сайта или ручной синхронизации данных этого браузера.</div>
        <div class="telemetryPanel__list">
          <div class="telemetryPanel__item"><span>Событий в общей сводке</span><b>${escapeHtml(String(remote && remote.totals ? (remote.totals.events || 0) : 0))}</b></div>
          <div class="telemetryPanel__item"><span>Сессий в общей сводке</span><b>${escapeHtml(String(remote && remote.totals ? (remote.totals.sessions || 0) : 0))}</b></div>
          <div class="telemetryPanel__item"><span>Пакетов данных в хранилище</span><b>${escapeHtml(String(remote && remote.totals ? (remote.totals.batches || 0) : 0))}</b></div>
          <div class="telemetryPanel__item"><span>Последнее полученное действие</span><b>${escapeHtml(remoteLatestEventAt)}</b></div>
          <div class="telemetryPanel__item"><span>Последнее обновление общей сводки</span><b>${escapeHtml(remoteGeneratedAt)}</b></div>
          <div class="telemetryPanel__item"><span>Статус серверной аналитики</span><b>${escapeHtml(remoteReady ? 'Подключён' : 'Нет ответа')}</b></div>
        </div>
      </div>
    `;
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
  const TELEMETRY_REMOTE_BATCH_LIMIT = 250;
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
    const scopeHint = escapeHtml(scopeBits.filter(Boolean).join(' · '));
    const shownHint = overall && totalCount > visibleItems.length
      ? `В списке показано ${escapeHtml(String(visibleItems.length))} из ${escapeHtml(String(totalCount))} последних записей.`
      : `В списке показано ${escapeHtml(String(visibleItems.length))} записей.`;
    const cards = [
      ['Всего ошибок', totalCount, shownHint + ' ' + scopeHint],
      [telemetryErrorSeverityLabel('critical'), severityCounts.critical || 0, TELEMETRY_ERROR_SEVERITY_META.critical.hint],
      [telemetryErrorSeverityLabel('medium'), severityCounts.medium || 0, TELEMETRY_ERROR_SEVERITY_META.medium.hint],
      [telemetryErrorSeverityLabel('low'), severityCounts.low || 0, TELEMETRY_ERROR_SEVERITY_META.low.hint],
      [telemetryErrorSeverityLabel('diagnostic'), severityCounts.diagnostic || 0, TELEMETRY_ERROR_SEVERITY_META.diagnostic.hint]
    ];
    return cards.map(([label, value, hint]) => `
      <div class="telemetryStat">
        <div class="telemetryStat__label">${escapeHtml(String(label))}</div>
        <div class="telemetryStat__value">${escapeHtml(String(value))}</div>
        <div class="telemetryStat__sub">${escapeHtml(String(hint || ''))}</div>
      </div>
    `).join('');
  }

  function renderTelemetryErrorReportGroups(items) {
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      return '<div class="muted">По выбранным фильтрам ошибок не найдено.</div>';
    }
    return TELEMETRY_ERROR_CATEGORY_ORDER.map((categoryKey) => {
      const groupItems = arr.filter((item) => item.category === categoryKey);
      if (!groupItems.length) return '';
      const meta = TELEMETRY_ERROR_CATEGORY_META[categoryKey] || { label: categoryKey, hint: '' };
      return `
        <details class="errorReportGroup" open>
          <summary class="errorReportGroup__summary">
            <span>${escapeHtml(meta.label)}</span>
            <span class="errorReportGroup__count">${escapeHtml(String(groupItems.length))}</span>
          </summary>
          <div class="errorReportGroup__hint">${escapeHtml(String(meta.hint || ''))}</div>
          <div class="errorReportGroup__body">${groupItems.map((item) => {
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
            return `
              <article class="errorReportEntry errorReportEntry--${escapeHtml(item.severity)}">
                <div class="errorReportEntry__head">
                  <div class="errorReportEntry__titleWrap">
                    <div class="errorReportEntry__title">${escapeHtml(item.title)}</div>
                    <div class="errorReportEntry__meta">${escapeHtml(metaParts.join(' · '))}</div>
                  </div>
                  <div class="errorReportEntry__badges">
                    <span class="telemetryKpi__badge errorBadge errorBadge--${escapeHtml(item.severity)}">${escapeHtml(item.severityLabel)}</span>
                    <span class="telemetryKpi__badge errorBadge errorBadge--category">${escapeHtml(item.categoryLabel)}</span>
                  </div>
                </div>
                <div class="errorReportEntry__summary">${escapeHtml(item.summary)}</div>
                <div class="errorReportEntry__tech">technical key: <code>${escapeHtml(item.technicalKey)}</code></div>
                <details class="errorReportEntry__details">
                  <summary>Технические детали</summary>
                  <div class="telemetryItem__body">${escapeHtml(JSON.stringify(detailsPayload, null, 2))}</div>
                </details>
              </article>
            `;
          }).join('')}</div>
        </details>
      `;
    }).join('');
  }

  function renderTelemetryErrorReport() {
    if (!elTelemetryErrorReportCard) return;
    const state = telemetryErrorReportState || { sourceLabel: '', sourceMode: 'local', baseFilters: getTelemetryFilters(), items: [], visibleItems: [], truncated: false, generatedAt: '' };
    if (elTelemetryErrorReportSummary) {
      elTelemetryErrorReportSummary.innerHTML = buildTelemetryErrorSummaryCards(state);
    }
    updateTelemetryErrorReportActionState(state);
    if (elTelemetryErrorReportList) {
      const header = [];
      if (state.truncated) header.push('<div class="hint mtSm">Показана ограниченная выборка последних ошибок. Для стабильности интерфейс показывает последние записи, а итоговые счётчики строятся по полному серверному скану выбранного периода.</div>');
      if (state.generatedAt) header.push(`<div class="hint mtSm">Последняя серверная генерация отчёта: ${escapeHtml(formatTelemetryDateTime(state.generatedAt))}</div>`);
      if (state.remoteFailureMessage) header.push(`<div class="status err mtSm">${escapeHtml(state.remoteFailureMessage)}</div>`);
      elTelemetryErrorReportList.innerHTML = header.join('') + renderTelemetryErrorReportGroups(state.visibleItems);
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
    const batchLimit = TELEMETRY_REMOTE_BATCH_LIMIT;
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
      telemetry && telemetry.getRemoteSummaryDetailed
        ? telemetry.getRemoteSummaryDetailed({ days: baseFilters.days, deviceType: (baseFilters.deviceType === 'all' ? '' : baseFilters.deviceType), limit: batchLimit })
        : Promise.resolve({ ok: false, data: null, message: 'Telemetry summary is not available', code: 'no_summary' })
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
    const confirmed = window.confirm(`Очистить текущие ошибки из ${scopeLabel}? Будет скрыто ${visibleItems.length} записей по текущим фильтрам.`);
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

  function syncTelemetryModalBodyState() {
    const isOpen = !!((elTelemetryModal && !elTelemetryModal.hidden) || (elTelemetryErrorReportModal && !elTelemetryErrorReportModal.hidden));
    document.body.classList.toggle('modal-open', isOpen);
  }

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
    return `
      <div class="telemetryKpi telemetryKpi--${escapeHtml(verdict.status)}">
        <div class="telemetryKpi__head">
          <div class="telemetryKpi__label">${escapeHtml(label)}</div>
          <span class="telemetryKpi__badge telemetryKpi__badge--${escapeHtml(verdict.status)}">${escapeHtml(verdict.label)}</span>
        </div>
        <div class="telemetryKpi__value">${escapeHtml(String(valueText || '—'))}</div>
        <div class="telemetryKpi__sub">${escapeHtml(subText || '')}</div>
        <div class="telemetryKpi__target">${escapeHtml(verdict.target || '')}</div>
      </div>
    `;
  }

  function formatTelemetryTopList(items, emptyLabel, opts) {
    const arr = Array.isArray(items) ? items : [];
    const mode = opts && opts.mode ? String(opts.mode) : 'default';
    if (!arr.length) return `<div class="muted">${escapeHtml(emptyLabel || '—')}</div>`;
    return arr.map((item) => {
      const label = mode === 'events' ? telemetryEventLabel(String(item.name || item.id || '')) : String(item.name || item.id || '—');
      return `
        <div class="telemetryPanel__item">
          <span>${escapeHtml(label)}</span>
          <b>${escapeHtml(String(item.sessions || item.count || 0))}</b>
        </div>
      `;
    }).join('');
  }

  function renderTelemetryFunnel(funnel, sourceLabel) {
    const data = funnel && Array.isArray(funnel.steps) ? funnel.steps : [];
    if (!data.length) {
      return `
        <div class="telemetryPanel">
          <div class="telemetryPanel__label">Воронка AR (${escapeHtml(sourceLabel)})</div>
          <div class="muted">Пока нет данных по воронке AR</div>
        </div>
      `;
    }
    const maxValue = Math.max(...data.map((step) => Number(step.sessions || 0)), 1);
    return `
      <div class="telemetryPanel">
        <div class="telemetryPanel__label">Воронка AR (${escapeHtml(sourceLabel)})</div>
        <div class="telemetryPanel__sub">Показывает путь от клика по запуску AR до готовой визуализации</div>
        <div class="telemetryPanel__list">${data.map((step) => {
          const width = Math.max(6, Math.round((Number(step.sessions || 0) / maxValue) * 100));
          const conv = formatTelemetryPercent(step.conversionFromLaunch);
          const stepConv = formatTelemetryPercent(step.conversionFromPrev);
          return `
            <div class="telemetryFunnelStep">
              <div class="telemetryFunnelStep__label">${escapeHtml(String(step.label || '—'))}</div>
              <div class="telemetryFunnelStep__bar"><div class="telemetryFunnelStep__fill" style="width:${width}%"></div></div>
              <div class="telemetryFunnelStep__meta"><b>${escapeHtml(String(step.sessions || 0))}</b><br /><span class="muted">от запуска ${conv} · шаг ${stepConv}</span></div>
            </div>
          `;
        }).join('')}</div>
      </div>
    `;
  }

  function renderTelemetryDevices(devices, sourceLabel) {
    const arr = Array.isArray(devices) ? devices : [];
    if (!arr.length) {
      return `
        <div class="telemetryPanel">
          <div class="telemetryPanel__label">Сегментация по устройствам (${escapeHtml(sourceLabel)})</div>
          <div class="muted">Пока нет данных по устройствам</div>
        </div>
      `;
    }
    return `
      <div class="telemetryPanel">
        <div class="telemetryPanel__label">Сегментация по устройствам (${escapeHtml(sourceLabel)})</div>
        <div class="telemetryPanel__sub">Сессии, запуск AR, завершение визуализации и ошибки по типу устройства</div>
        <div class="telemetryDeviceGrid">${arr.map((item) => `
          <div class="telemetryDeviceCard">
            <div class="telemetryDeviceCard__head"><span class="telemetryDeviceCard__name">${escapeHtml(telemetryDeviceLabel(item.deviceType))}</span><span class="muted">${escapeHtml(String(item.shareLabel || ''))}</span></div>
            <div class="telemetryDeviceCard__meta">
              <div>Сессий<b>${escapeHtml(String(item.sessions || 0))}</b></div>
              <div>Запустили AR<b>${escapeHtml(String(item.arLaunchSessions || 0))}</b></div>
              <div>Вошли в AR<b>${escapeHtml(String(item.arStartedSessions || 0))}</b></div>
              <div>Дошли до заливки<b>${escapeHtml(String(item.arCompletedSessions || 0))}</b></div>
              <div>Конверсия в заливку<b>${formatTelemetryPercent(item.arCompletionRate)}</b></div>
              <div>Ошибок на сессию<b>${formatTelemetryFloat(item.errorRatePerSession)}</b></div>
            </div>
          </div>
        `).join('')}</div>
      </div>
    `;
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
    return `
      <div class="telemetryPanel telemetryPanel--hero">
        <div class="telemetryPanel__label">Аудитория и посещаемость (${escapeHtml(sourceLabel)})</div>
        <div class="telemetryPanel__sub">В метрика-подобной сводке: уникальные устройства, сессии и повторные визиты</div>
        <div class="telemetryAudienceGrid">${cards.map(([label, value, hint]) => `
          <div class="telemetryHeroStat">
            <div class="telemetryHeroStat__label">${escapeHtml(String(label))}</div>
            <div class="telemetryHeroStat__value">${escapeHtml(String(value))}</div>
            <div class="telemetryHeroStat__hint">${escapeHtml(String(hint || ''))}</div>
          </div>
        `).join('')}</div>
      </div>
    `;
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
    if (!arr.length) {
      return `
        <div class="telemetryPanel">
          <div class="telemetryPanel__label">Динамика (${escapeHtml(sourceLabel)})</div>
          <div class="muted">Пока нет данных по выбранному периоду</div>
        </div>
      `;
    }
    const maxSessions = Math.max(...arr.map((item) => Number(item.sessions || 0)), 1);
    return `
      <div class="telemetryPanel">
        <div class="telemetryPanel__label">Динамика (${escapeHtml(sourceLabel)})</div>
        <div class="telemetryPanel__sub">Сессии, уникальные посетители и ошибки по шкале «${escapeHtml(picked.label)}»</div>
        <div class="telemetryTrendList">${arr.map((item) => {
          const width = Math.max(6, Math.round((Number(item.sessions || 0) / maxSessions) * 100));
          return `
            <div class="telemetryTrendRow">
              <div class="telemetryTrendRow__label">${escapeHtml(String(item.label || item.key || '—'))}</div>
              <div class="telemetryTrendRow__bar"><div class="telemetryTrendRow__fill" style="width:${width}%"></div></div>
              <div class="telemetryTrendRow__meta">
                <div>Сессии <b>${escapeHtml(String(item.sessions || 0))}</b></div>
                <div>Уникальные <b>${escapeHtml(String(item.uniqueVisitors || 0))}</b></div>
                <div>Ошибки <b>${escapeHtml(String(item.errors || 0))}</b></div>
              </div>
            </div>
          `;
        }).join('')}</div>
      </div>
    `;
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
    try {
      remote = telemetry.getRemoteSummary ? await telemetry.getRemoteSummary({ days: filters.days, deviceType: (filters.deviceType === 'all' ? '' : filters.deviceType), limit: 400 }) : null;
    } catch (_) {
      remote = null;
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
      elTelemetrySources.innerHTML = renderTelemetrySources(localSync, remote, sourceLabel);
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
      elTelemetryStats.innerHTML = stats.map((item) => `
        <div class="telemetryStat${item.interactive ? ' telemetryStat--interactive' : ''}"${item.interactive ? ' role="button" tabindex="0" data-error-report="1"' : ''}>
          <div class="telemetryStat__label">${escapeHtml(String(item.label))}</div>
          <div class="telemetryStat__value">${escapeHtml(String(item.value))}</div>
          ${item.interactive ? '<div class="telemetryStat__sub">' + escapeHtml(String(item.sub || '')) + '</div><button class="telemetryStat__cta" type="button" data-action="open-error-report">Подробнее</button>' : ''}
        </div>
      `).join('');
    }

    if (elTelemetryAudience) {
      elTelemetryAudience.innerHTML = renderTelemetryAudience(audience, sourceLabel);
    }

    if (elTelemetryKpis) {
      elTelemetryKpis.innerHTML = [
        renderTelemetryKpiCard('arStartRate', 'Конверсия запуска AR', formatTelemetryPercent(kpis.arStartRate), `${sessions.arStartedSessions || 0} из ${sessions.arLaunchSessions || 0} сессий с кликом по AR`, sessions.arLaunchSessions || 0, kpis.arStartRate),
        renderTelemetryKpiCard('arCompletionRate', 'Конверсия до заливки', formatTelemetryPercent(kpis.arCompletionRate), `${sessions.arCompletedSessions || 0} из ${sessions.arLaunchSessions || 0} сессий с запуском AR`, sessions.arLaunchSessions || 0, kpis.arCompletionRate),
        renderTelemetryKpiCard('textureInteractionRate', 'Интеракция с текстурами', formatTelemetryPercent(kpis.textureInteractionRate), `${sessions.textureInteractionSessions || 0} из ${sessions.arCompletedSessions || 0} сессий с готовой визуализацией`, sessions.arCompletedSessions || 0, kpis.textureInteractionRate),
        renderTelemetryKpiCard('ctaClickRate', 'CTR «Связь с менеджером»', formatTelemetryPercent(kpis.ctaClickRate), `${sessions.managerCtaSessions || 0} сессий с менеджерским CTA`, sessions.sessions || 0, kpis.ctaClickRate),
        renderTelemetryKpiCard('adminCalibrationUsage', 'Использование AR-калибровки', formatTelemetryPercent(kpis.adminCalibrationUsage), `${sessions.adminCalibrationSessions || 0} админ-сессий с калибровкой`, sessions.adminSessions || 0, kpis.adminCalibrationUsage),
        renderTelemetryKpiCard('errorRatePerSession', 'Ошибок на сессию', formatTelemetryFloat(kpis.errorRatePerSession), `${formatTelemetryPercent(kpis.errorSessionRate)} сессий содержали ошибки`, sessions.sessions || 0, kpis.errorRatePerSession),
      ].join('');
    }

    if (elTelemetryDynamics) {
      elTelemetryDynamics.innerHTML = renderTelemetryDynamics(dashboard && dashboard.timeSeries, filters.days, sourceLabel);
    }

    if (elTelemetryBreakdown) {
      elTelemetryBreakdown.innerHTML = `
        <div class="telemetryPanel">
          <div class="telemetryPanel__label">Топ форм по взаимодействиям (${escapeHtml(sourceLabel)})</div>
          <div class="telemetryPanel__list">${formatTelemetryTopList(dashboard && dashboard.topShapes, 'Пока нет данных по формам')}</div>
        </div>
        <div class="telemetryPanel">
          <div class="telemetryPanel__label">Топ текстур по взаимодействиям (${escapeHtml(sourceLabel)})</div>
          <div class="telemetryPanel__list">${formatTelemetryTopList(dashboard && dashboard.topTextures, 'Пока нет данных по текстурам')}</div>
        </div>
      `;
    }

    if (elTelemetryFunnel) {
      elTelemetryFunnel.innerHTML = renderTelemetryFunnel(dashboard && dashboard.funnel, sourceLabel);
    }

    if (elTelemetryDevices) {
      elTelemetryDevices.innerHTML = renderTelemetryDevices(dashboard && dashboard.deviceSegments, sourceLabel);
    }

    setTelemetryStatus(`Сейчас показаны данные: ${sourceLabel}. Не передано с этого устройства: ${summary.pending || 0}. Последнее обновление общей сводки: ${remote && remote.generatedAt ? formatTelemetryDateTime(remote.generatedAt) : 'нет данных'}.`, (summary.pending || 0) > 0 ? 'warn' : '');

    if (elTelemetryList) {
      const parts = [];
      if (remote) {
        const topErrors = Array.isArray(remote.topErrors) ? remote.topErrors.slice(0, 5) : [];
        parts.push(`
          <div class="hint mtSm">
            <b>Сводка с сервера</b><br />
            Пакеты данных: ${escapeHtml(String(remoteBatchCount || 0))}<br />
            Главные события: ${escapeHtml(remoteTop || '—')}<br />
            Частые ошибки: ${escapeHtml(topErrors.map((entry) => `${telemetryEventLabel(entry.name)} × ${entry.count}`).join(' · ') || '—')}<br />
            Главные события этого браузера: ${escapeHtml(topNames || '—')}
          </div>
        `);
      }
      if (!recent.length) {
        parts.push('<div class="muted">Событий на этом устройстве по выбранным фильтрам пока нет.</div>');
      } else {
        recent.slice().reverse().forEach((item) => {
          const kind = item.kind === 'error' ? 'telemetryItem telemetryItem--error' : 'telemetryItem';
          const meta = [];
          if (item.iso) meta.push(item.iso.replace('T', ' ').replace('Z', ''));
          if (item.sessionId) meta.push(item.sessionId);
          if (item.props && item.props.deviceType) meta.push(telemetryDeviceLabel(item.props.deviceType));
          parts.push(`
            <div class="${kind}">
              <div class="telemetryItem__head">
                <div class="telemetryItem__name">${escapeHtml(telemetryEventLabel(item.name))}</div>
                <div class="telemetryItem__meta">${escapeHtml(meta.join(' · '))}</div>
              </div>
              <div class="telemetryItem__body">${escapeHtml(JSON.stringify(item.props || {}, null, 2))}</div>
            </div>
          `);
        });
      }
      elTelemetryList.innerHTML = parts.join('');
    }
  }


  function showTelemetryModal(open) {
    if (!elTelemetryModal) return;
    elTelemetryModal.hidden = !open;
    syncTelemetryModalBodyState();
  }

  function showTelemetryErrorReportModal(open) {
    if (!elTelemetryErrorReportModal) return;
    elTelemetryErrorReportModal.hidden = !open;
    syncTelemetryModalBodyState();
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

    elShapesGrid.innerHTML = '';
    elShapesEmpty.style.display = filtered.length ? 'none' : 'block';

    const frag = document.createDocumentFragment();
    for (const sh of filtered) {
      const id = sh?.id || '';
      const name = sh?.name || id;
      const desc = sh?.description || '';
      const icon = resolveSiteUrl(sh?.icon || sh?.hero || '');

      const card = document.createElement('div');
      card.className = 'shapeCard';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="shapeThumb">
          ${icon ? `<img alt="" loading="lazy" src="${escapeHtml(icon)}" />` : ''}
        </div>
        <div class="shapeBody">
          <div class="shapeName">${escapeHtml(name)}</div>
          <div class="shapeId">${escapeHtml(id)}</div>
          <div class="shapeDesc">${escapeHtml(desc)}</div>
        </div>
      `;
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
    const hero = resolveSiteUrl(shape?.hero || shape?.icon || '');
    const desc = shape?.description || '';

    elShapeTitle.textContent = id ? `shapeId: ${id}` : '';
    elShapeHeader.innerHTML = `
      ${hero ? `<img class="shapeHero" alt="" loading="lazy" src="${escapeHtml(hero)}" />` : ''}
      <div class="shapeInfo">
        <div class="hName">${escapeHtml(name)}</div>
        <div class="hMeta">${escapeHtml(id)}</div>
        ${desc ? `<div class="hDesc">${escapeHtml(desc)}</div>` : ''}
      </div>
    `;
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
    elTexturesGrid.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    elEmptyTextures.style.display = list.length ? 'none' : 'block';
    updateBulkBar(shapeId, list.length);
    if (!list.length) return;

    const frag = document.createDocumentFragment();
    for (const it of list) {
      const id = it?.id || it?.textureId || '';
      const name = it?.name || id || '(без названия)';
      // Prefer material map URLs over "preview" fields.
      // Preview fields historically contained broken values (e.g. "shapeId:textureId_albedo.png"),
      // which triggers Chrome ORB and produces noisy errors in DevTools.
      const previewUrl = pickMediaUrl([
        it?.maps?.albedoUrl,
        it?.maps?.albedo,
        it?.previewUrl,
        it?.preview,
      ], { shapeId, textureId: id, quality: '1k' });

      const hasTileOverride = !!it?.tileSizeM;
      const hasParams = it?.params && typeof it.params === 'object' && Object.keys(it.params).length > 0;
      const pills = [
        hasTileOverride ? '<span class="pill pill--set">tileSize</span>' : '<span class="pill">tileSize: default</span>',
        hasParams ? '<span class="pill pill--set">params</span>' : '<span class="pill">params: default</span>',
      ].join(' ');

      const selected = getSelectedSet(shapeId).has(id);
      const card = document.createElement('div');
      card.className = 'tile';
      card.innerHTML = `
        <label class="tileSelect" title="Выбрать текстуру для массового редактирования">
          <input type="checkbox" data-action="select" data-id="${escapeHtml(id)}" ${selected ? 'checked' : ''} />
          <span></span>
        </label>
        <img class="thumb" alt="" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(previewUrl)}">
        <div class="meta">
          <div class="name">${escapeHtml(name)}</div>
          <div class="id">${escapeHtml(id)}</div>
          <div class="muted mtSm">${pills}</div>
          <div class="row tileActions">
            <button class="btn btn--ghost btn--sm" data-action="edit" data-id="${escapeHtml(id)}">Настроить</button>
            <button class="btn btn--ghost btn--sm" data-action="update" data-id="${escapeHtml(id)}" title="Перезагрузить файлы карты (обновить текущую текстуру)">Обновить файлы</button>
            <button class="btn btn--danger btn--sm" data-action="delete" data-id="${escapeHtml(id)}" title="Удалить текстуру">Удалить</button>
          </div>
        </div>
      `;

      // Avoid inline event handlers (CSP-friendly).
      const img = card.querySelector('img.thumb');
      if (img) img.addEventListener('error', () => {
        try { img.style.display = 'none'; } catch {}
      });

      const selCb = card.querySelector('input[data-action="select"]');
      selCb.addEventListener('change', () => {
        const set = getSelectedSet(shapeId);
        if (selCb.checked) set.add(id);
        else set.delete(id);
        updateBulkBar(shapeId, list.length);
      });
      card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
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

      card.querySelector('[data-action="update"]').addEventListener('click', (e) => {
        e.stopPropagation();
        goToUpdateUpload(shapeId, id);
      });

      card.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
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
    const okPalette = confirm(`Удалить текстуру "${textureId}" из палитры формы "${shapeId}" и удалить файлы из бакета?`);
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

    setStatus(elPaletteStatus, '', 'Удаляем...');
    // На backend реализован резолв папок в бакете по textureId (с учётом префиксов),
    // поэтому передаём ровно то значение, которое отображается в админке.
    const res = await apiDeleteTexture(shapeId, textureId, { palette: true, files: alsoBucket });
    if (!res?.ok) {
      const msg = res?.message || 'Delete failed';
      setStatus(elPaletteStatus, 'error', msg);
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
      const hint = 'Текстура не была удалена из палитры (возможен несоответствующий textureId в данных).';
      setStatus(elPaletteStatus, 'error', hint);
      return;
    }

    const delMsg = alsoBucket
      ? `Удалено из палитры и из бакета (объекты: ${delObjects}, префиксы: ${delPrefixes}).`
      : 'Удалено из палитры.';

    const warn = deleteErrors.length
      ? ` Ошибки при удалении файлов: ${deleteErrors.map(e => e.key || e.prefix || 'unknown').join(', ')}`
      : '';
    setStatus(elPaletteStatus, deleteErrors.length ? 'warn' : 'ok', delMsg + warn);
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
    elBucketGrid.innerHTML = '';
    const idx = state.bucketIndexByShapeId.get(shapeId) || { textures: [] };
    const textures = Array.isArray(idx.textures) ? idx.textures : [];
    const palette = state.paletteByShapeId.get(shapeId);
    // Compare in canonical space to avoid legacy prefixes ("klassika:paver...") and casing drift.
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
      const previewUrl = pickMediaUrl([
        t?.qualities?.['1k']?.maps?.albedo?.key,
        t?.previewKey,
        t?.preview,
      ], { shapeId: (state.activeShapeId || shapeId || ''), textureId, quality: '1k' });

      const pills = [
        inPalette ? '<span class="pill pill--set">в палитре</span>' : '<span class="pill">не в палитре</span>',
        '<span class="pill">1k</span>',
        has2k ? '<span class="pill">2k</span>' : '<span class="pill">2k: нет</span>',
        broken ? '<span class="pill pill--warn">неполная 1k</span>' : '<span class="pill">ok</span>',
      ].join(' ');

      const card = document.createElement('div');
      card.className = 'tile';
      card.innerHTML = `
        <img class="thumb" alt="" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(previewUrl)}">
        <div class="meta">
          <div class="name">${escapeHtml(textureId)}</div>
          <div class="muted mtSm">${pills}</div>
          <div class="row tileActions">
            ${inPalette
              ? `<button class="btn btn--ghost btn--sm" data-action="edit" data-id="${escapeHtml(textureId)}">Настроить</button>`
              : `<button class="btn btn--sm" data-action="add" data-id="${escapeHtml(textureId)}" ${broken ? 'disabled' : ''}>Добавить в палитру</button>`
            }
            <button class="btn btn--ghost btn--sm" data-action="update" data-id="${escapeHtml(textureId)}" title="Перезагрузить файлы карты (обновить текущую текстуру)">Обновить файлы</button>
            <button class="btn btn--danger btn--sm" data-action="delete" data-id="${escapeHtml(textureId)}" title="Удалить текстуру">Удалить</button>
          </div>
        </div>
      `;

      // Avoid inline event handlers (CSP-friendly).
      const img = card.querySelector('img.thumb');
      if (img) img.addEventListener('error', () => {
        try { img.style.display = 'none'; } catch {}
      });

      const btnAdd = card.querySelector('[data-action="add"]');
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
            // refresh bucket view pills
            renderBucketTextures(shapeId);
          } catch (err) {
            console.warn(err);
            setStatus(elBucketStatus, 'err', `Не удалось добавить в палитру: ${String(err.message || err)}`);
          }
        });
      }

      const btnEdit = card.querySelector('[data-action="edit"]');
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

      const btnUpdate = card.querySelector('[data-action="update"]');
      if (btnUpdate) {
        btnUpdate.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          goToUpdateUpload(shapeId, textureId);
        });
      }

      const btnDel = card.querySelector('[data-action="delete"]');
      if (btnDel) {
        btnDel.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            if (inPalette) {
              await deleteTextureFlow(shapeId, textureId);
              return;
            }
            const ok = confirm(`Удалить текстуру "${textureId}" полностью (baket + previews + палитра)?`);
            if (!ok) return;
            setStatus(elBucketStatus, '', 'Удаляем…');
            // Backend now resolves real bucket folder names (shapeId_/pack_ prefixes),
            // so we always send the logical textureId from UI.
            await apiDeleteTexture(shapeId, textureId, { palette: true, files: true });
            state.bucketIndexByShapeId.delete(shapeId);
            await ensureBucketIndexLoaded(shapeId, { forceReload: true });
            renderBucketTextures(shapeId);
            setStatus(elBucketStatus, 'ok', 'Удаление выполнено.');
          } catch (err) {
            console.warn(err);
            setStatus(elBucketStatus, 'err', `Не удалось удалить: ${String(err.message || err)}`);
          }
        });
      }

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
    elUploadTbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const t of tasks) {
      const tr = document.createElement('tr');
      const pct = (t.totalBytes > 0) ? Math.round((t.sentBytes / t.totalBytes) * 100) : (t.status === 'done' ? 100 : 0);
      const st = t.status || 'pending';
      const stClass = st === 'done' ? 'uploadOk' : (st === 'error' ? 'uploadErr' : (st === 'uploading' ? 'uploadWarn' : ''));
      tr.innerHTML = `
        <td><span class="uploadPill">${escapeHtml((t.textureId ? (t.textureId + ' / ') : '') + (t.mapType || '?'))}</span></td>
        <td>${escapeHtml(t.fileName || '')}<div class="muted mono">${escapeHtml((t.sizeMB || 0).toFixed ? t.sizeMB.toFixed(2) : '')} MB</div></td>
        <td class="mono">${escapeHtml(t.key || '')}</td>
        <td>${escapeHtml(String(pct))}%</td>
        <td><span class="${stClass}">${escapeHtml(st)}</span>${t.error ? `<div class="muted">${escapeHtml(t.error)}</div>` : ''}</td>
      `;
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
  }

  function closeTexModal() {
    currentTexShapeId = '';
    currentTexItemId = '';
    currentTexSnapshot = null;
    if (elTexParams) elTexParams.innerHTML = '';
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
    row.innerHTML = `
      <div class="paramTop">
        <div class="paramLabel">${escapeHtml(label)} <span class="paramHelp" title="${escapeHtml(help)}">i</span></div>
        <div class="paramMeta">${escapeHtml(meta)}</div>
      </div>
      <div class="paramControls">
        <input type="range" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(value)}" />
        <input type="number" step="${escapeHtml(step)}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" value="${escapeHtml(value)}" />
      </div>
      <div class="paramNote">Подсказка: наведите на <b>i</b>, чтобы увидеть описание влияния параметра.</div>
    `;
    const range = row.querySelector('input[type="range"]');
    const numInput = row.querySelector('input[type="number"]');
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

    const previewUrl = pickMediaUrl([
      item?.maps?.albedoUrl,
      item?.maps?.albedo,
      item?.previewUrl,
      item?.preview,
    ], { shapeId: (state.activeShapeId || ''), textureId: (item?.id || item?.textureId || ''), quality: '1k' });
    if (elTexPreview && previewUrl) {
      elTexPreview.onerror = () => { try { elTexPreview.style.display = 'none'; } catch {} };
    elTexPreview.src = previewUrl;
      elTexPreviewHint.textContent = 'Превью: albedo (из палитры)';
    } else {
      elTexPreviewHint.textContent = 'Превью недоступно (в palettes/*.json нет preview/albedo)';
    }

    const defaults = getDefaultsForShape(shapeId);

    // Build UI
    elTexParams.innerHTML = '';

    // Tile size (mm)
    const tileOverride = item.tileSizeM && typeof item.tileSizeM === 'object'
      ? { w: Math.round(item.tileSizeM.w * 1000), h: Math.round(item.tileSizeM.h * 1000) }
      : null;
    const tileEffective = tileOverride || defaults.tileSizeMm;
    const tileBlock = document.createElement('div');
    tileBlock.className = 'paramRow';
    tileBlock.innerHTML = `
      <div class="paramTop">
        <div class="paramLabel">Размер модуля (мм) <span class="paramHelp" title="Физический размер плитки. Влияет на повтор текстуры (repeat) и на реалистичность масштаба в AR.">i</span></div>
        <div class="paramMeta">${tileOverride ? 'Переопределено' : 'По умолчанию'} • default: ${defaults.tileSizeMm.w}×${defaults.tileSizeMm.h}</div>
      </div>
      <div class="paramControls">
        <div style="display:flex; gap:10px; align-items:center;">
          <label class="field" style="margin:0;">
            <span class="muted">Ширина</span>
            <input id="texTileW" type="number" min="10" max="1000" step="1" value="${escapeHtml(tileEffective.w)}" />
          </label>
          <label class="field" style="margin:0;">
            <span class="muted">Высота</span>
            <input id="texTileH" type="number" min="10" max="1000" step="1" value="${escapeHtml(tileEffective.h)}" />
          </label>
        </div>
        <div></div>
      </div>
      <div class="paramNote">Рекомендация: используйте реальные размеры плитки из ТЗ/каталога. Для квадрата 115×115 мм — это базовый дефолт.</div>
    `;
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
          elTexPreviewHint.textContent = 'Превью недоступно (не удалось загрузить albedo).';
        }
      })();
    }
  }

  function showBulkModal(open) {
    if (!elBulkModal) return;
    elBulkModal.hidden = !open;
  }

  function closeBulkModal() {
    bulkSnapshot = null;
    if (elBulkParams) elBulkParams.innerHTML = '';
    setStatus(elBulkModalStatus, '', '');
    showBulkModal(false);
  }

  function buildBulkParamRow(schema, value, defaultValue) {
    const row = document.createElement('div');
    row.className = 'bulkParam';
    row.dataset.key = schema.key;
    row.dataset.value = String(value);
    row.dataset.apply = '0';

    row.innerHTML = `
      <div class="paramTop">
        <div class="paramLabel">
          <label class="checkbox" title="Применить этот параметр к целевым текстурам">
            <input type="checkbox" data-action="apply" />
            <span>Применять</span>
          </label>
          <span style="margin-left:10px;">${escapeHtml(schema.label)} <span class="paramHelp" title="${escapeHtml(schema.help)}">i</span></span>
        </div>
        <div class="paramMeta">default: ${escapeHtml(defaultValue)}</div>
      </div>
      <div class="paramControls">
        <input type="range" min="${escapeHtml(schema.min)}" max="${escapeHtml(schema.max)}" step="${escapeHtml(schema.step)}" value="${escapeHtml(value)}" />
        <input type="number" step="${escapeHtml(schema.step)}" min="${escapeHtml(schema.min)}" max="${escapeHtml(schema.max)}" value="${escapeHtml(value)}" />
      </div>
      <div class="paramNote">Подсказка: наведите на <b>i</b>. Отметьте «Применять», чтобы параметр применился массово.</div>
    `;

    const cb = row.querySelector('input[data-action="apply"]');
    const range = row.querySelector('input[type="range"]');
    const numInput = row.querySelector('input[type="number"]');

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
      elBulkSourceTexture.innerHTML = '';
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
    elBulkParams.innerHTML = '';
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
        elShapeHeader.innerHTML = '';
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
              setStatus(elUploadStatus, '', `Загрузка началась… (текстур: ${parsed.textures.size}, файлов: ${parsed.tasks.length})`);
              const res = await runUploadQueue(conc);
              if (!res.ok) {
                setStatus(elUploadStatus, 'err', `Загрузка завершена с ошибками: ${res.failed}. Проверьте CORS бакета и имена файлов.`);
                return;
              }
              setStatus(elUploadStatus, 'ok', 'Файлы загружены.');

              if (elUploadAutoAdd?.checked) {
                setStatus(elUploadStatus, '', 'Обновляем палитру…');

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

                setStatus(elUploadStatus, 'ok', 'Готово: файлы загружены, палитра обновлена и сохранена.');
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
                  for (const tid of toSync) {
                    if (!tid) continue;
                    await apiSyncTexture(shapeId, tid);
                  }
                  state.paletteByShapeId.delete(shapeId);
                  const fresh2 = await ensurePaletteLoaded(shapeId, { forceReload: true });
                  if (parseRoute().name === 'shape') renderTextures(shapeId, Array.isArray(fresh2?.items) ? fresh2.items : []);
                } catch (e) {
                  console.warn(e);
                  setStatus(elUploadStatus, 'warn', 'Файлы загружены, но синхронизация палитры по бакету не удалась. Проверьте backend / доступы S3.');
                }
              } else {
                try {
                  await ensureBucketIndexLoaded(shapeId, { forceReload: true });
                } catch {}
                setStatus(elUploadStatus, 'ok', 'Готово: файлы загружены. Палитра не изменялась, так как auto-add выключен.');
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
            setStatus(elUploadStatus, '', 'Загрузка началась…');
            const res = await runUploadQueue(conc);
            if (!res.ok) {
              setStatus(elUploadStatus, 'err', `Загрузка завершена с ошибками: ${res.failed}. Проверьте CORS бакета и имена файлов.`);
              return;
            }
            setStatus(elUploadStatus, 'ok', 'Файлы загружены.');

            if (elUploadAutoAdd?.checked) {
              setStatus(elUploadStatus, '', quality === '2k' ? 'Синхронизируем палитру после загрузки 2k…' : 'Обновляем палитру…');

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

              // Sync from bucket to ensure correct extensions/paths (png/webp mix, non-standard names)
              // and to keep palette items anchored to the canonical 1k representation.
              try {
                await apiSyncTexture(shapeId, textureId);
              } catch (e) {
                console.warn(e);
                setStatus(elUploadStatus, 'warn', 'Палитра обновлена, но синхронизация по бакету не удалась. Проверьте backend / доступы S3.');
              }
              setStatus(elUploadStatus, 'ok', quality === '2k'
                ? 'Готово: 2k-файлы загружены, палитра синхронизирована с существующей 1k-текстурой.'
                : 'Готово: файлы загружены, палитра обновлена и сохранена.');
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
})();
