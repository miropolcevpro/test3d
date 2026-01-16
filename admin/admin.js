// BUILD: v28 2026-01-16
const __BUILD_ID__ = "v28-20260116";
console.log("[Admin] build", __BUILD_ID__);
/* Admin (Step 3 start) — shapes list + shape details (read-only palette), router scaffold */
(() => {
  const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'admin_jwt';

  // In GitHub Pages the admin lives under /<repo>/admin/, while site assets are under /<repo>/assets/.
  // Resolve any relative asset paths (e.g. "assets/forms/klassika.png") against the site root ("/<repo>/").
  const SITE_BASE_URL = (() => {
    const basePath = window.location.pathname.replace(/\/admin\/.*$/, '/');
    return window.location.origin + basePath;
  })();

  function resolveSiteUrl(u) {
    if (!u) return '';
    try {
      return new URL(u, SITE_BASE_URL).toString();
    } catch {
      return u;
    }
  }

  // Bucket base for palette assets (maps, previews). Can be overridden in admin/config.js:
  //   window.BUCKET_BASE_URL = "https://storage.yandexcloud.net/webar3dtexture/";
  const BUCKET_BASE_URL = (window.BUCKET_BASE_URL || 'https://storage.yandexcloud.net/webar3dtexture/').replace(/\/+$/, '/') ;

  // Canonical textureId handling
  // Bucket folder naming convention: surfaces/<shapeId>/<textureId>/...
  // IMPORTANT: <textureId> MUST NOT contain the <shapeId> prefix.
  // We normalize legacy IDs:
  //   - "klassika:paver_..." -> "paver_..."
  //   - "klassika_paver_..." -> "paver_..."
  // and sanitize any remaining ":" to "_".
  function canonicalTextureId(shapeId, anyId) {
    if (!anyId) return '';
    let s = String(anyId).trim();
    if (!s) return '';
    try { s = decodeURIComponent(s); } catch {}

    const sid = String(shapeId || '').trim();
    if (sid) {
      const pColon = sid + ':';
      const pUnd = sid + '_';
      // Some legacy data ended up with repeated prefixes, e.g. "klassika:klassika_kara_dag".
      // Strip prefixes repeatedly until stable.
      // Also trim in-between to be robust against accidental spaces.
      for (let i = 0; i < 3; i++) {
        if (s.startsWith(pColon)) { s = s.slice(pColon.length).trim(); continue; }
        if (s.startsWith(pUnd)) { s = s.slice(pUnd.length).trim(); continue; }
        break;
      }
    }

    if (s.includes(':')) s = s.replace(/:/g, '_');
    return s;
  }

  function normalizePathLike(shapeId, v) {
    if (!v) return v;
    let s = String(v).trim();
    if (!s) return s;
    try { s = decodeURIComponent(s); } catch {}
    const sid = String(shapeId || '').trim();

    // If someone stored preview as "klassika:..._albedo.png" (no slashes) — treat as invalid to avoid ORB/CORB.
    if (!s.includes('/') && s.includes(':')) return '';
    if (!sid) return s;

    // Fix common legacy prefixing mistakes inside bucket-relative paths:
    //   surfaces/<sid>/<sid>_foo/...  -> surfaces/<sid>/foo/...
    //   surfaces/<sid>/<sid>:foo/...  -> surfaces/<sid>/foo/...
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

  // If a shape is selected, strip accidental shape prefixes:
  // - "klassika:paver_..." -> "paver_..."
  // - "klassika_paver_..." -> "paver_..."
  let raw = raw0;
  if (shapeId) {
    const s1 = `${shapeId}:`;
    const s2 = `${shapeId}_`;
    if (raw.startsWith(s1)) raw = raw.slice(s1.length);
    else if (raw.startsWith(s2)) raw = raw.slice(s2.length);
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

  // We recommend lowercase for consistency across tools/OS.
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

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(t) {
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

    const res = await fetch(url,{cache:"no-store", ...opts, headers, cache: 'no-store' });
    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) json = await res.json().catch(() => null);
    else {
      const text = await res.text().catch(() => '');
      json = text ? { message: text } : null;
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

  async function apiDeletePaletteItem(shapeId, textureId) {
    return apiFetch(`/api/palettes/${encodeURIComponent(shapeId)}/items/${encodeURIComponent(textureId)}`, {
      method: 'DELETE',
    });
  }

  async function apiDeleteSurfacePrefix(shapeId, textureId) {
    return apiFetch(`/api/surfaces/${encodeURIComponent(shapeId)}/${encodeURIComponent(textureId)}`, {
      method: 'DELETE',
    });
  }


async function apiDeleteTexture(shapeId, textureId, opts = {}) {
  const palette = opts.palette !== false;
  const files = opts.files !== false;
  const qs = `?palette=${palette ? 1 : 0}&files=${files ? 1 : 0}`;
  return apiFetch(`/api/textures/${encodeURIComponent(shapeId)}/${encodeURIComponent(textureId)}${qs}`, {
    method: 'DELETE',
  });
}


async function apiGetConfig() {
  return apiFetch('/api/config', { method: 'GET' });
}

async function apiSyncTexture(shapeId, textureId) {
    return apiFetch(`/api/textures/${encodeURIComponent(shapeId)}/${encodeURIComponent(textureId)}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  function showLoggedInUI(isLoggedIn) {
    elLoginCard.hidden = !!isLoggedIn;
    elMainCard.hidden = !isLoggedIn;
  }

  async function login(username, password) {
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

  async function ensurePaletteLoaded(shapeId) {
    if (!shapeId) return null;
    if (state.paletteByShapeId.has(shapeId)) return state.paletteByShapeId.get(shapeId);
    setStatus(elStatus, '', `Загружаем палитру формы: ${shapeId} …`);
    const rawPalette = await apiFetch('/api/palettes/' + encodeURIComponent(shapeId));
    const palette = normalizePaletteForUi(shapeId, rawPalette || { shapeId, items: [] });
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

  function scheduleTexturePreviewRedraw(shapeId) {
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
      elTexPreviewHint.textContent = 'Превью недоступно (в palletes/*.json нет preview/albedo)';
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
      showView('forms');
      renderShapesList(elShapeSearch.value);
      return;
    }

    if (r.name === 'shape') {
      const shapeId = decodeURIComponent(r.id || '');
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
      return;
    }
  }

  async function initAfterLogin() {
    await ensureShapesLoaded();
    state.paletteByShapeId.clear();
    state.paletteSettingsByShapeId.clear();
    renderShapesList(elShapeSearch.value);

    // Default route
    if (!location.hash) location.hash = '#/forms';
    await renderRoute();
  }

  function bindUI() {
    elBtnLogin.addEventListener('click', async () => {
      const u = (elLoginUser.value || '').trim();
      const p = (elLoginPass.value || '').trim();
      if (!API_BASE_URL) {
        setStatus(elLoginStatus, 'err', 'API_BASE_URL не задан. Проверьте admin/config.js');
        return;
      }
      if (!u || !p) {
        setStatus(elLoginStatus, 'warn', 'Введите логин и пароль');
        return;
      }
      elBtnLogin.disabled = true;
      try {
        await login(u, p);
        setStatus(elLoginStatus, 'ok', 'Успешно. Загружаем данные…');
        showLoggedInUI(true);
        await initAfterLogin();
        setStatus(elLoginStatus, '', '');
      } catch (e) {
        console.warn(e);
        setToken('');
        setStatus(elLoginStatus, 'err', `Ошибка входа: ${e.message}`);
        showLoggedInUI(false);
      } finally {
        elBtnLogin.disabled = false;
      }
    });

    elBtnLogout.addEventListener('click', () => {
      setToken('');
      showLoggedInUI(false);
      setStatus(elStatus, '', '');
      setStatus(elLoginStatus, '', '');
      state.shapes = [];
      state.paletteByShapeId.clear();
      state.paletteSettingsByShapeId.clear();
    });

    elReload.addEventListener('click', async () => {
      try {
        await ensureShapesLoaded();
        state.paletteByShapeId.clear();
        await renderRoute();
      } catch (e) {
        console.warn(e);
        setStatus(elStatus, 'err', `Ошибка обновления: ${e.message}`);
      }
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
      if (!shapeId) return;
      renderBucketTextures(shapeId);
    });

    // Bulk selection / mass edit (textures tab)
    elBulkSelectAll?.addEventListener('change', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
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

              // Sync palette item maps from bucket (guards against mixed formats / custom file names).
              // In "update" mode it is mandatory; in "new" mode it is also useful after structured ZIP.
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
              setStatus(elUploadStatus, '', 'Обновляем палитру…');

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

              const item = buildPaletteItemFromUpload(shapeId, textureId, displayName, quality, tasks, tileSizeM);
              await upsertItemAndSavePalette(shapeId, item);

              // Sync from bucket to ensure correct extensions/paths (png/webp mix, non-standard names).
              try {
                await apiSyncTexture(shapeId, textureId);
              } catch (e) {
                console.warn(e);
                setStatus(elUploadStatus, 'warn', 'Палитра обновлена, но синхронизация по бакету не удалась. Проверьте backend / доступы S3.');
              }
              setStatus(elUploadStatus, 'ok', 'Готово: файлы загружены, палитра обновлена и сохранена.');
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
