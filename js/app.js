import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadTiles, loadShapes, clamp } from './utils.js';

// Remote surface palettes (Object Storage).
// Override by setting window.__SURFACE_PALETTE_BASE_URL__ before loading app.js
const SURFACE_PALETTE_BASE_URL = (typeof window !== 'undefined' && window.__SURFACE_PALETTE_BASE_URL__)
  ? String(window.__SURFACE_PALETTE_BASE_URL__).replace(/\/+$/, '') + '/'
  : 'https://storage.yandexcloud.net/webar3dtexture/palettes/';

// Remote per-shape palette defaults (safe-fallback).
// Override by setting window.__PALETTE_SETTINGS_BASE_URL__ before loading app.js
const PALETTE_SETTINGS_BASE_URL = (typeof window !== 'undefined' && window.__PALETTE_SETTINGS_BASE_URL__)
  ? String(window.__PALETTE_SETTINGS_BASE_URL__).replace(/\/+$/, '') + '/'
  : 'https://storage.yandexcloud.net/webar3dtexture/palette_settings/';

// Palette settings are OPTIONAL and are NOT used in the current product flow.
// We keep support for future needs, but disable it by default to avoid
// unnecessary network calls (and noisy 404 logs) when the file is absent.
// To enable, set window.__ENABLE_PALETTE_SETTINGS__ = true before loading app.js.
const ENABLE_PALETTE_SETTINGS = (typeof window !== 'undefined' && window.__ENABLE_PALETTE_SETTINGS__ === true);


// Optional API Gateway base (Admin API) used for reconcile/filtering.
// Set window.__API_BASE_URL__ in index.html before loading app.js, for example:
//   window.__API_BASE_URL__ = 'https://<your_api_gw_id>.apigw.yandexcloud.net';
const API_BASE_URL = (typeof window !== 'undefined' && window.__API_BASE_URL__)
  ? String(window.__API_BASE_URL__).replace(/\/+$/, '') + '/'
  : '';
// ------------------------
// UI
// ------------------------
const UI = {
  overlay: document.getElementById('overlay'),
  canvas: document.getElementById('xrCanvas'),

  // Screens
  screenCatalog: document.getElementById('screenCatalog'),
  screenDetail: document.getElementById('screenDetail'),
  screenAR: document.getElementById('screenAR'),

  // Catalog
  catalogSearch: document.getElementById('catalogSearch'),
  catalogCards: document.getElementById('catalogCards'),

  // Detail
  btnDetailBack: document.getElementById('btnDetailBack'),
  detailTitle: document.getElementById('detailTitle'),
  detailHero: document.getElementById('detailHero'),
  detailName: document.getElementById('detailName'),
  detailSub: document.getElementById('detailSub'),
  detailTech: document.getElementById('detailTech'),
  // Antika tech parameters panel
  techBody: document.getElementById('techBody'),
  btnTechToggle: document.getElementById('btnTechToggle'),
  btnTechClose: document.getElementById('btnTechClose'),
  layoutRow: document.getElementById('layoutRow'),
  colorRow: document.getElementById('colorRow'),
  btnViewAR: document.getElementById('btnViewAR'),

  // AR
  btnArBack: document.getElementById('btnArBack'),
  btnArReset: document.getElementById('btnArReset'),
  arTop: document.querySelector('.arTop'),
  arProductTitle: document.getElementById('arProductTitle'),
  arArea: document.getElementById('arArea'),
  scanHint: document.getElementById('scanHint'),
  measureLayer: document.getElementById('measureLayer'),
  arBottomCenter: document.getElementById('arBottomCenter'),
  btnArAdd: document.getElementById('btnArAdd'),
  btnArOk: document.getElementById('btnArOk'),
  postCloseBar: document.getElementById('postCloseBar'),
  btnEditShape: document.getElementById('btnEditShape'),
  btnCutout: document.getElementById('btnCutout'),
  btnDone: document.getElementById('btnDone'),
  finalBar: document.getElementById('finalBar'),
  finalPatterns: document.getElementById('finalPatterns'),
  btnLayoutCycle: document.getElementById('btnLayoutCycle'),
  btnShapePicker: document.getElementById('btnShapePicker'),
  shapePickerBackdrop: document.getElementById('shapePickerBackdrop'),
  shapePickerPanel: document.getElementById('shapePickerPanel'),
  shapePickerList: document.getElementById('shapePickerList'),
  finalColors: document.getElementById('finalColors'),

  // AR texture load progress
  texLoadBarWrap: document.getElementById('texLoadBarWrap'),
  texLoadBar: document.getElementById('texLoadBar'),

  // Hidden tech
  layoutSelect: document.getElementById('layoutSelect'),
  toggleOcclusion: document.getElementById('toggleOcclusion'),
};

function show(el, on = true) {
  if (!el) return;
  if (on) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

function setActiveScreen(name) {
  const map = {
    catalog: UI.screenCatalog,
    detail: UI.screenDetail,
    ar: UI.screenAR,
  };
  for (const k of Object.keys(map)) {
    const el = map[k];
    if (!el) continue;
    const isActive = k === name;
    el.classList.toggle('screen--active', isActive);
    show(el, isActive);
  }
}

function fmtMeters(m) {
  return `${m.toFixed(2).replace('.', ',')} м`;
}
function fmtArea(m2) {
  return `${m2.toFixed(2).replace('.', ',')} м²`;
}


function updateArBottomStripVar() {
  try {
    const bar = UI.finalBar;
    const h = (bar && !bar.hasAttribute('hidden')) ? bar.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--ar-bottom-strip', `${Math.ceil(h)}px`);
  } catch (_) {}
}

function updateArTopStripVar() {
  try {
    const top = UI.arTop;
    const h = top ? top.getBoundingClientRect().height : 0;
    // Fallback to a sane default so the drawer never overlaps the top controls.
    document.documentElement.style.setProperty('--ar-top-strip', `${Math.max(56, Math.ceil(h))}px`);
  } catch (_) {}
}


// ------------------------

// ------------------------
// AR: texture load progress indicator (thin bar under pattern buttons)
// ------------------------
const _arTexProgress = { seq: 0, total: 0, done: 0, hideTimer: 0, showTimer: 0, shown: false, shownAt: 0 };

function _arTexProgressShow(seq, total) {
  try {
    if (!UI.texLoadBarWrap || !UI.texLoadBar) return;

    _arTexProgress.seq = seq;
    _arTexProgress.total = Math.max(1, Number(total) || 1);
    _arTexProgress.done = 0;
    _arTexProgress.shown = false;
    _arTexProgress.shownAt = 0;

    if (_arTexProgress.hideTimer) {
      clearTimeout(_arTexProgress.hideTimer);
      _arTexProgress.hideTimer = 0;
    }
    if (_arTexProgress.showTimer) {
      clearTimeout(_arTexProgress.showTimer);
      _arTexProgress.showTimer = 0;
    }

    // Delay UI to avoid flicker on fast texture switches.
    // If loading still in progress after 2s, show progress bar with current progress.
    _arTexProgress.showTimer = setTimeout(() => {
      try {
        if (seq !== _arTexProgress.seq) return;
        if (_arTexProgress.done >= _arTexProgress.total) return;
        _arTexProgress.showTimer = 0;

        // Show now
        UI.texLoadBar.style.width = '0%';
        UI.texLoadBarWrap.classList.add('is-visible');
        show(UI.texLoadBarWrap, true);
        _arTexProgress.shown = true;
        _arTexProgress.shownAt = Date.now();

        const pct = Math.max(0, Math.min(100, (_arTexProgress.done / _arTexProgress.total) * 100));
        UI.texLoadBar.style.width = `${pct.toFixed(0)}%`;

        updateArBottomStripVar();
      } catch (_) {}
    }, 2000);
  } catch (_) {}
}

function _arTexProgressTick(seq) {
  try {
    if (seq !== _arTexProgress.seq) return;
    _arTexProgress.done++;

    if (_arTexProgress.shown && UI.texLoadBar) {
      const pct = Math.max(0, Math.min(100, (_arTexProgress.done / _arTexProgress.total) * 100));
      UI.texLoadBar.style.width = `${pct.toFixed(0)}%`;
    }

    if (_arTexProgress.done >= _arTexProgress.total) _arTexProgressHide(seq);
  } catch (_) {}
}

function _arTexProgressHide(seq) {
  try {
    if (seq !== _arTexProgress.seq) return;

    // If bar hasn't been shown yet (fast load), just cancel the delayed show.
    if (_arTexProgress.showTimer) {
      clearTimeout(_arTexProgress.showTimer);
      _arTexProgress.showTimer = 0;
    }
    if (!_arTexProgress.shown) return;

    if (!UI.texLoadBarWrap) return;

    // Prevent flicker: once shown, keep it visible for a minimal time.
    const MIN_VISIBLE_MS = 450;
    const visibleFor = Date.now() - (_arTexProgress.shownAt || Date.now());
    const wait = Math.max(0, MIN_VISIBLE_MS - visibleFor);

    if (_arTexProgress.hideTimer) {
      clearTimeout(_arTexProgress.hideTimer);
      _arTexProgress.hideTimer = 0;
    }

    _arTexProgress.hideTimer = setTimeout(() => {
      try {
        if (seq !== _arTexProgress.seq) return;

        // Finish smoothly then fade out.
        if (UI.texLoadBar) UI.texLoadBar.style.width = '100%';
        UI.texLoadBarWrap.classList.remove('is-visible');

        // allow CSS transition to complete
        setTimeout(() => {
          try {
            if (seq !== _arTexProgress.seq) return;
            show(UI.texLoadBarWrap, false);
            updateArBottomStripVar();
          } catch (_) {}
        }, 220);
      } catch (_) {}
    }, wait);
  } catch (_) {}
}
// App state
// ------------------------
const state = {
  tiles: [],
  selectedTile: null,
  shapes: [],
  selectedShape: null,
  layout: 'straight', // straight | diagonal

  // AR UI: layout cycle button ("Смена укладки")
  layoutCycleInitial: 'straight',
  layoutCycleStep: 0, // 0 -> next straight, 1 -> next diagonal, 2 -> back to initial

  // internal guards
  _restartingAR: false,
  _startingAR: false,

  // WebXR
  xrSession: null,
  referenceSpace: null,
  viewerSpace: null,
  hitTestSource: null,
  transientHitTestSource: null,
  transientHitPoses: new Map(),
  lastUiTapTs: 0,
  anchorsSupported: false,
  anchor: null,

  // depth
  depthSupported: false,
  depthInfoSize: null,
  depthTexture: null,
  depthData: null,
  occlusionEnabled: false,

  // tracking / drawing
  phase: 'catalog', // catalog|detail|ar_scan|ar_draw|ar_mask|ar_cut|ar_final
  floorLocked: false,
  floorY: 0,
  // floor scan stabilization
  floorSamples: [],
  floorYEstimate: null,
  floorStable: false,

  reticleVisible: false,
  snapArmed: false,

  points: /** @type {THREE.Vector3[]} */ ([]),
  holes: /** @type {THREE.Vector3[][]} */ ([]),
  holePoints: /** @type {THREE.Vector3[]} */ ([]),
  closed: false,
};


// ------------------------
// Texture loading limiter (prevents spikes when user rapidly switches textures)
// Now adaptive: accounts for memory/cores, current network and XR state.
// ------------------------
function _getConnInfo() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const eff = (conn && conn.effectiveType) ? String(conn.effectiveType) : '';
  const downlink = (conn && typeof conn.downlink === 'number') ? conn.downlink : 0;
  const rtt = (conn && typeof conn.rtt === 'number') ? conn.rtt : 0;
  const saveData = !!(conn && conn.saveData);
  return { conn, eff, downlink, rtt, saveData };
}

function computeTexLoadMaxParallel() {
  try {
    const dm = (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : 0;
    const hc = (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') ? navigator.hardwareConcurrency : 0;
    const { eff, downlink, rtt, saveData } = _getConnInfo();

    // Baseline from device capacity.
    let max = 4;
    if (dm && dm <= 2) max = 2;
    else if (dm && dm <= 4) max = 3;
    if (hc && hc <= 4) max = Math.min(max, 3);

    // Network-aware throttling.
    if (saveData) max = 2;
    if (/slow-2g|2g/i.test(eff)) max = 1;
    if (/3g/i.test(eff)) max = Math.min(max, 2);
    if (downlink && downlink < 2) max = Math.min(max, 2);
    if (rtt && rtt > 250) max = Math.min(max, 2);

    // XR: keep pressure low for stability.
    if (state && state.xrSession) max = Math.min(max, 2);

    return clamp(max, 1, 4);
  } catch {
    return 3;
  }
}

let _texLoadMaxParallel = computeTexLoadMaxParallel();
let _texLoadActive = 0;
const _texLoadQueue = [];
function _pumpTexLoadQueue() {
  while (_texLoadActive < _texLoadMaxParallel && _texLoadQueue.length) {
    const job = _texLoadQueue.shift();
    _texLoadActive++;
    Promise.resolve()
      .then(job.fn)
      .then(
        (res) => { _texLoadActive--; job.resolve(res); _pumpTexLoadQueue(); },
        (err) => { _texLoadActive--; job.reject(err); _pumpTexLoadQueue(); }
      );
  }
}

function updateTexLoadMaxParallel() {
  try {
    _texLoadMaxParallel = computeTexLoadMaxParallel();
    _pumpTexLoadQueue();
  } catch (_) {}
}

// React to network changes when supported.
try {
  const { conn } = _getConnInfo();
  if (conn && typeof conn.addEventListener === 'function') {
    conn.addEventListener('change', () => updateTexLoadMaxParallel());
  }
} catch (_) {}
function runWithTexLoadLimit(fn, opts = {}) {
  const pr = (opts && opts.priority) ? String(opts.priority) : 'normal';
  return new Promise((resolve, reject) => {
    const job = { fn, resolve, reject };
    // High-priority jobs (e.g., albedo) go to the front of the queue.
    if (pr === 'high') _texLoadQueue.unshift(job);
    else _texLoadQueue.push(job);
    _pumpTexLoadQueue();
  });
}

// Selection guard: only the latest selected texture is allowed to apply
let _selectTileSeq = 0;

// Enable Three.js internal cache for image requests (helps across texture switches).
try { THREE.Cache.enabled = true; } catch (_) {}

// Global texture loader + caches to speed up switching (avoid re-downloading/re-decoding).
const _globalTexLoader = new THREE.TextureLoader();
try { _globalTexLoader.setCrossOrigin?.('anonymous'); } catch (_) {}

// url -> Promise<THREE.Texture|null>
const _texPromiseCache = new Map();
// (quality|url) -> resolved url (2k / alt-ext) that actually exists
const _texResolvedUrlCache = new Map();
// Remembers per-map availability of 2k for a given canonical URL.
// Key: "<kind>|<canon>"  Value: "2k" or "1k"
const _texBestQualityCache = new Map();

function _canonTexKey(url) {
  try {
    if (!url) return '';
    const s0 = String(url);
    const s = s0.split('?')[0];
    // Replace quality segment with placeholder to share cache between 1k/2k attempts.
    const q = s.replace(/\/(1k|2k)\//, '/{q}/');
    // Strip extension so webp/png/jpg all share the same key.
    const m = q.match(/^(.*)\.[a-zA-Z0-9]+$/);
    return m ? m[1] : q;
  } catch {
    return String(url || '');
  }
}


// Lightweight performance telemetry for adaptive quality decisions.
// We track an EMA of load+decode time per map kind.
const _texPerf = {
  any: { ema: 0, n: 0 },
  albedo: { ema: 0, n: 0 },
  roughness: { ema: 0, n: 0 },
  normal: { ema: 0, n: 0 },
  ao: { ema: 0, n: 0 },
  height: { ema: 0, n: 0 },
};
function _perfAdd(kind, ms) {
  try {
    const k = _texPerf[kind] ? kind : 'any';
    const a = _texPerf[k];
    const b = _texPerf.any;
    const alpha = 0.22;
    a.ema = a.n ? (a.ema * (1 - alpha) + ms * alpha) : ms;
    a.n++;
    b.ema = b.n ? (b.ema * (1 - alpha) + ms * alpha) : ms;
    b.n++;
  } catch (_) {}
}

function _cacheGet(map, key) { return map.has(key) ? map.get(key) : undefined; }

function loadTextureCached(url, opts = {}) {
  if (!url) return Promise.resolve(null);
  const key = String(url);
  const cached = _cacheGet(_texPromiseCache, key);
  if (cached) return cached;

  const priority = (opts && opts.priority) ? String(opts.priority) : 'normal';
  const silent = Boolean(opts && opts.silent);

  const kind = (opts && opts.kind) ? String(opts.kind) : '';
  const p = runWithTexLoadLimit(async () => {
    const t0 = performance.now();
    const tex = await _globalTexLoader.loadAsync(key);
    const dt = performance.now() - t0;
    if (dt && dt < 60000) _perfAdd(kind || 'any', dt);
    return tex;
  }, { priority })
    .then((tex) => tex || null)
    .catch((err) => {
      if (!silent) console.warn('[surfaces] failed to load texture:', key, err);
      return null;
    });

  _texPromiseCache.set(key, p);
  return p;
}

async function loadTexSmartCached(url, label, preferredQuality, isStaleFn, opts = {}) {
  if (!url) return null;

  const priority = (opts && opts.priority) ? String(opts.priority) : 'normal';
  const kind = label ? String(label) : 'any';

  let desiredQuality = (preferredQuality === '2k') ? '2k' : '1k';

  // If we already learned that 2k is not available for this map, skip 2k attempts for speed/stability.
  const canon = _canonTexKey(url);
  const qKey = `${kind}|${canon}`;
  const learnedBest = _cacheGet(_texBestQualityCache, qKey);
  if (desiredQuality === '2k' && learnedBest === '1k') desiredQuality = '1k';

  const baseKey = `${desiredQuality}|${String(url)}`;
  const cachedResolved = _cacheGet(_texResolvedUrlCache, baseKey);

  // If we already know a working URL for this base, try it first.
  if (cachedResolved) {
    const t0 = await loadTextureCached(cachedResolved, { priority, silent: true, kind });
    if (isStaleFn && isStaleFn()) return null;
    if (t0) return t0;
    _texResolvedUrlCache.delete(baseKey);
  }

  const candidates = [];
  const pushUnique = (u) => { if (u && !candidates.includes(u)) candidates.push(u); };
  const pushWithAlts = (u) => { pushUnique(u); for (const a of makeAltExtCandidates(u)) pushUnique(a); };

  // We always build both quality candidates:
  //  - preferred quality first (2k or 1k)
  //  - then fallback quality (usually 1k)
  const u1k = make1kCandidateUrl(url);
  const u2k = make2kCandidateUrl(url);

  if (desiredQuality === '2k') {
    // Try 2k first (even if url already points to 2k).
    pushWithAlts(u2k);
    // Fallback: 1k (even if url already points to 2k).
    pushWithAlts(u1k);
  } else {
    // 1k preferred
    pushWithAlts(u1k);
    // If incoming url is 2k, try it only after 1k (rare, but keeps behavior predictable).
    if (u2k && u2k !== u1k) pushWithAlts(u2k);
  }

  for (const u of candidates) {
    if (isStaleFn && isStaleFn()) return null;

    const tex = await loadTextureCached(u, { priority, silent: true, kind });
    if (isStaleFn && isStaleFn()) return null;

    if (tex) {
      _texResolvedUrlCache.set(baseKey, u);

      // Learn which quality actually worked for this map, so next time we avoid wasting 2k attempts.
      const usedQ = (String(u).includes('/2k/')) ? '2k' : '1k';
      _texBestQualityCache.set(qKey, usedQ);

      // Only warn when we had to deviate from the original URL (helps debugging naming/ext issues).
      if (label && u !== url) {
        console.warn(`[surfaces] used alternate URL for ${kind}: ${u}`);
      }
      return tex;
    }
  }

  // If we wanted 2k but failed to load anything, remember that 2k is likely unavailable for this map.
  if ((preferredQuality === '2k') && !_cacheGet(_texBestQualityCache, qKey)) {
    _texBestQualityCache.set(qKey, '1k');
  }

  return null;
}

function applyMapToTileMaterial(mat, kind, tex) {
  if (!mat || !mat.uniforms) return;
  if (tex) prepMapTex(tex, kind === 'albedo');
  if (kind === 'albedo') {
    mat.uniforms.uTex.value = tex;
    if (mat.uniforms.uTex2) {
      mat.uniforms.uTex2.value = null;
      mat.uniforms.uHasTex2.value = 0;
      mat.uniforms.uTexMix.value = 0.0;
    }
  } else if (kind === 'normal') {
    mat.uniforms.uNormalTex.value = tex;
    mat.uniforms.uHasNormal.value = tex ? 1 : 0;
  } else if (kind === 'roughness') {
    mat.uniforms.uRoughTex.value = tex;
    mat.uniforms.uHasRough.value = tex ? 1 : 0;
  } else if (kind === 'ao') {
    mat.uniforms.uAoTex.value = tex;
    mat.uniforms.uHasAo.value = tex ? 1 : 0;
  } else if (kind === 'height') {
    mat.uniforms.uHeightTex.value = tex;
    mat.uniforms.uHasHeight.value = tex ? 1 : 0;
  }
}

// ------------------------
// Prefetch (predictive) + GPU warmup (reduces first-apply stutter)
// ------------------------
let _prefetchTimer = null;
let _prefetchSeq = 0;

// Warmup helpers (render a 1x1 offscreen pass so the texture gets uploaded to GPU).
const _warmedTexUuids = new Set();
let _warmupRT = null;
let _warmupScene = null;
let _warmupCam = null;
let _warmupMesh = null;

function warmupTextureOnGPU(tex, isColor = false) {
  try {
    if (!tex || !renderer || (renderer.xr && renderer.xr.isPresenting)) return;
    if (_warmedTexUuids.has(tex.uuid)) return;

    prepMapTex(tex, isColor);

    if (!_warmupRT) _warmupRT = new THREE.WebGLRenderTarget(1, 1);
    if (!_warmupScene) {
      _warmupScene = new THREE.Scene();
      _warmupCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      _warmupMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ transparent: false })
      );
      _warmupScene.add(_warmupMesh);
    }

    _warmupMesh.material.map = tex;
    _warmupMesh.material.needsUpdate = true;

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(_warmupRT);
    renderer.render(_warmupScene, _warmupCam);
    renderer.setRenderTarget(prevRT);

    _warmedTexUuids.add(tex.uuid);
  } catch (_) {}
}

function schedulePrefetchAdjacentTiles(currentTile, list = null) {
  try {
    if (!currentTile) return;
    // Connectivity-aware: avoid background prefetch on slow networks or when user enabled Save-Data.
    const { eff, downlink, saveData } = _getConnInfo();
    if (saveData) return;
    if (/slow-2g|2g|3g/i.test(eff)) return;
    if (downlink && downlink < 2) return;
    const tiles = Array.isArray(list) ? list : (Array.isArray(state.currentAllowedTiles) ? state.currentAllowedTiles : state.tiles);
    if (!Array.isArray(tiles) || tiles.length < 2) return;

    const idx = tiles.findIndex(x => String(x.id) === String(currentTile.id));
    if (idx < 0) return;

    // Only prefetch 1 neighbor each side (max 2 textures) for safety.
    const neighbors = [];
    if (idx + 1 < tiles.length) neighbors.push(tiles[idx + 1]);
    if (idx - 1 >= 0) neighbors.push(tiles[idx - 1]);

    const mySeq = ++_prefetchSeq;

    if (_prefetchTimer) clearTimeout(_prefetchTimer);
    _prefetchTimer = setTimeout(async () => {
      if (mySeq !== _prefetchSeq) return;

      let preferredQuality = getPreferredSurfaceQuality({ inAR: state.phase === 'ar_final' });
      // Optional per-texture override (admin can set this when 2k pack is not available yet).
      const params = (currentTile && currentTile.params && typeof currentTile.params === 'object') ? currentTile.params : null;
      const _fq = (params && typeof params.forceQuality === 'string') ? params.forceQuality.trim().toLowerCase() : '';
  if (_fq === '1k' || _fq === '2k') preferredQuality = _fq;

      for (const nt of neighbors) {
        if (mySeq !== _prefetchSeq) return;

        const aUrl = (nt.maps && nt.maps.albedo) ? nt.maps.albedo : nt.texture;
        const rUrl = (nt.maps && nt.maps.roughness) ? nt.maps.roughness : null;
        const nUrl = (nt.maps && nt.maps.normal) ? nt.maps.normal : null;

        // Dedup is handled by caches; priorities stay 'normal' so it won't block active switching.
        const aTexP = loadTexSmartCached(aUrl, 'albedo', '1k', null, { priority: 'normal' });
        const rTexP = loadTexSmartCached(rUrl, 'roughness', preferredQuality, null, { priority: 'normal' });
        const nTexP = loadTexSmartCached(nUrl, 'normal', preferredQuality, null, { priority: 'normal' });

        const aTex = await aTexP;
        if (aTex) warmupTextureOnGPU(aTex, true);

        const rTex = await rTexP;
        if (rTex) warmupTextureOnGPU(rTex, false);

        // Normal is best-effort (often heavier); warm up only if it arrives quickly.
        const nRes = await _withTimeout(nTexP, 220);
        if (nRes.ok && nRes.v) warmupTextureOnGPU(nRes.v, false);
      }
    }, 180);
  } catch (_) {}
}

// ------------------------
// Premium albedo-only crossfade (in-shader) without touching transparency/depth
// ------------------------
function crossfadeAlbedoOnMaterial(mat, newAlbedoTex, durationMs = 140) {
  try {
    prepMapTex(newAlbedoTex, true);
    if (!mat || !mat.uniforms || !mat.uniforms.uTex || !mat.uniforms.uTex2 || !newAlbedoTex) {
      if (mat) applyMapToTileMaterial(mat, 'albedo', newAlbedoTex);
      return;
    }

    const oldTex = mat.uniforms.uTex.value;
    // If there is no old texture yet, just set.
    if (!oldTex) {
      applyMapToTileMaterial(mat, 'albedo', newAlbedoTex);
      mat.uniforms.uHasTex2.value = 0;
      mat.uniforms.uTex2.value = null;
      mat.uniforms.uTexMix.value = 0.0;
      return;
    }

    // Set second map + animate mix.
    mat.uniforms.uTex2.value = newAlbedoTex;
    mat.uniforms.uHasTex2.value = 1;
    mat.uniforms.uTexMix.value = 0.0;

    const t0 = performance.now();
    const ease = (k) => k * k * (3.0 - 2.0 * k); // smoothstep

    const step = (now) => {
      const k = clamp((now - t0) / Math.max(1, durationMs), 0, 1);
      mat.uniforms.uTexMix.value = ease(k);
      if (k < 1) { requestAnimationFrame(step); return; }

      // Finalize: commit new as primary, drop secondary.
      mat.uniforms.uTex.value = newAlbedoTex;
      mat.uniforms.uTex2.value = null;
      mat.uniforms.uHasTex2.value = 0;
      mat.uniforms.uTexMix.value = 0.0;
      mat.needsUpdate = true;
    };

    requestAnimationFrame(step);
  } catch (_) {
    try { applyMapToTileMaterial(mat, 'albedo', newAlbedoTex); } catch (_) {}
  }
}


const SNAP_DIST_M = 0.10;

// ------------------------
// Three.js scene
// ------------------------
const renderer = new THREE.WebGLRenderer({
  canvas: UI.canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Rendering / color pipeline
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Keep exposure conservative to avoid "washed" look on mobile camera backgrounds.
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.2, 2.2);

scene.add(new THREE.HemisphereLight(0xffffff, 0x202030, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(1, 3, 2);
scene.add(dirLight);

const world = new THREE.Group();
scene.add(world);

const anchorGroup = new THREE.Group();
world.add(anchorGroup);

// Reticle
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.085, 40, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x2f6cff, transparent: true, opacity: 0.9 })
);
reticle.visible = false;
world.add(reticle);

// Scanning grid (visual hint) — line grid like in the reference app
const scanGrid = new THREE.GridHelper(2.4, 24, 0x2f6cff, 0x2f6cff);
scanGrid.visible = false;
scanGrid.position.y = 0.001;
// soften the grid
try {
  const mats = Array.isArray(scanGrid.material) ? scanGrid.material : [scanGrid.material];
  for (const m of mats) {
    m.transparent = true;
    m.opacity = 0.35;
    m.depthWrite = false;
  }
} catch (_) {}
world.add(scanGrid);

// Desktop fallback preview
const previewPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 3, 1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x2b2f38 })
);
previewPlane.position.set(0, 0, 0);
world.add(previewPlane);
const previewGrid = new THREE.GridHelper(3, 12, 0x3a6cff, 0x3a3a3a);
previewGrid.position.y = 0.0005;
world.add(previewGrid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 0.6;
controls.maxDistance = 6;

// Drawing objects
const pointsGroup = new THREE.Group();
anchorGroup.add(pointsGroup);
let line = null;
let fillMesh = null;

// Materials
let tileMaterial = null;
const maskMaterial = new THREE.MeshBasicMaterial({
  color: 0x5aa7ff,
  transparent: true,
  opacity: 0.30,
  depthWrite: false,
});

function prepMapTex(tex, isColor = false) {
  if (!tex) return null;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  else tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

let __fallbackWhiteTex = null;
function getFallbackWhiteTex() {
  if (__fallbackWhiteTex) return __fallbackWhiteTex;
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  __fallbackWhiteTex = tex;
  return tex;
}


function makeTileMaterial(arg = {}) {
  // Support both: makeTileMaterial({ ... }) and makeTileMaterial(texture)
  if (arg && arg.isTexture) arg = { albedoTex: arg };
  const {
    albedoTex,
    normalTex = null,
    roughnessTex = null,
    aoTex = null,
    heightTex = null,
    normalScale = 0.0,
    bumpScale = 0.0,
  } = arg || {};

  prepMapTex(albedoTex, true);

  prepMapTex(normalTex, false);
  prepMapTex(roughnessTex, false);
  prepMapTex(aoTex, false);
  prepMapTex(heightTex, false);

  const mat = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      // maps
      uTex: { value: albedoTex },
      uTex2: { value: null },
      uHasTex2: { value: 0 },
      uTexMix: { value: 0.0 },
      uNormalTex: { value: normalTex },
      uRoughTex: { value: roughnessTex },
      uAoTex: { value: aoTex },
      uHeightTex: { value: heightTex },
      uHasNormal: { value: normalTex ? 1 : 0 },
      uHasRough: { value: roughnessTex ? 1 : 0 },
      uHasAo: { value: aoTex ? 1 : 0 },
      uHasHeight: { value: heightTex ? 1 : 0 },
      uNormalScale: { value: normalScale || 0.0 },
      uBumpScale: { value: bumpScale || 0.0 },


      // per-texture material tuning
      uAlbedoGain: { value: 1.0 },
      uRoughnessMult: { value: 1.0 },
      uSpecStrength: { value: 1.0 },
      uColorBalance: { value: new THREE.Vector3(0.96, 1.0, 1.02) },
      uExposureMult: { value: 1.0 },
      uAlpha: { value: 1.0 },
      // tiling + layout
      uTileSize: { value: new THREE.Vector2(0.2, 0.2) },
      uUvScale: { value: new THREE.Vector2(1, 1) }, // per-texture scaling: 0.5 => texture looks 2x bigger
      uLayoutMode: { value: 0 }, // 0 straight, 1 diagonal

      // lighting
      uLightDir: { value: new THREE.Vector3(1, 2, 1).normalize() },
      // secondary fill light to brighten shadowed areas
      uFillLightDir: { value: new THREE.Vector3(-1, 1.2, 0.6).normalize() },
      // 0..1 (typical 0.3-0.6). Higher = brighter but flatter.
      // Slightly reduced to prevent over-brightening compared to product photos.
      uFillStrength: { value: 0.26 },
      uAmbient: { value: 0.25 },

      // environment (cheap IBL-style) for premium reflections
      uEnvSkyColor: { value: new THREE.Color(0x9ecbff) },
      uEnvGroundColor: { value: new THREE.Color(0x2f2f2f) },
      // Environment contribution: keep diffuse low to avoid "chalky" look,
      // keep spec moderate for premium feel without blowing highlights.
      uEnvDiffuseStrength: { value: 0.03 },
      uEnvSpecIntensity: { value: 0.20 },

      // occlusion via depth
      uUseOcclusion: { value: 0 },
      uDepthTex: { value: null },
      uDepthValid: { value: 0 },
      uOcclusionEps: { value: 0.02 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewPos;
      varying vec4 vClipPos;

      uniform vec2 uTileSize;
      uniform vec2 uUvScale;
      uniform int uLayoutMode;

      mat2 rot(float a){
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
      }

      void main(){
        vec3 pos = position;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vViewPos = mv.xyz;
        vClipPos = projectionMatrix * mv;

        vNormalW = normalize((modelMatrix * vec4(normal,0.0)).xyz);

        vec2 uv = vec2(pos.x / uTileSize.x, pos.z / uTileSize.y) * uUvScale;

        if (uLayoutMode == 1) {
          uv = rot(0.78539816339) * uv; // 45°
        } else if (uLayoutMode == 2) {
          float row = floor(uv.y);
          uv.x += 0.5 * mod(row, 2.0);
        }

        vUv = uv;
        gl_Position = vClipPos;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewPos;
      varying vec4 vClipPos;

      uniform sampler2D uTex;
      uniform sampler2D uTex2;
      uniform int uHasTex2;
      uniform float uTexMix;
      uniform sampler2D uNormalTex;
      uniform sampler2D uRoughTex;
      uniform sampler2D uAoTex;
      uniform sampler2D uHeightTex;

      uniform int uHasNormal;
      uniform int uHasRough;
      uniform int uHasAo;
      uniform int uHasHeight;
      uniform float uNormalScale;
      uniform float uBumpScale;

      uniform float uAlbedoGain;
      uniform float uRoughnessMult;
      uniform float uSpecStrength;
      uniform vec3 uColorBalance;
      uniform vec3 uLightDir;
      uniform vec3 uFillLightDir;
      uniform float uFillStrength;
      uniform float uAmbient;
      uniform float uExposureMult;
      uniform float uAlpha;

      // simple analytic environment lighting (sky/ground) for added realism
      uniform vec3 uEnvSkyColor;
      uniform vec3 uEnvGroundColor;
      uniform float uEnvDiffuseStrength;
      uniform float uEnvSpecIntensity;

      uniform int uUseOcclusion;
      uniform sampler2D uDepthTex;
      uniform int uDepthValid;
      uniform float uOcclusionEps;

      vec2 safeFract(vec2 v){ return v - floor(v); }

      // Tangent basis for a horizontal XZ plane:
      // T = +X, B = +Z, N = +Y in model space. In our app the fill mesh stays horizontal,
      // so this approximation is stable and fast.
      vec3 tangentSpaceToWorld(vec3 nTS, vec3 nW){
        vec3 T = normalize(vec3(1.0, 0.0, 0.0));
        vec3 B = normalize(vec3(0.0, 0.0, 1.0));
        vec3 N = normalize(nW);
        return normalize(T * nTS.x + B * nTS.y + N * nTS.z);
      }

      void main(){
        // occlusion (depth)
        if (uUseOcclusion == 1 && uDepthValid == 1) {
          vec3 ndc = (vClipPos.xyz / vClipPos.w);
          vec2 suv = ndc.xy * 0.5 + 0.5;
          if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
            float sceneDepth = texture2D(uDepthTex, suv).r;
            float fragDist = length(vViewPos);
            if (sceneDepth > 0.0 && sceneDepth < (fragDist - uOcclusionEps)) {
              discard;
            }
          }
        }

        vec2 uv = safeFract(vUv);

        // base color
        vec3 a0 = texture2D(uTex, uv).rgb;
        if (uHasTex2 == 1) {
          vec3 a1 = texture2D(uTex2, uv).rgb;
          a0 = mix(a0, a1, clamp(uTexMix, 0.0, 1.0));
        }
        vec3 albedo = a0;

        albedo *= uAlbedoGain;
        albedo *= uColorBalance;
        // AO (optional)
        float ao = 1.0;
        if (uHasAo == 1) {
          ao = texture2D(uAoTex, uv).r;
          ao = mix(1.0, ao, 0.8);
        }

        // normal + bump (optional)
        vec3 Nw = normalize(vNormalW);

        vec3 nTS = vec3(0.0, 0.0, 1.0);
        if (uHasNormal == 1) {
          vec3 nm = texture2D(uNormalTex, uv).xyz * 2.0 - 1.0;
          nm.xy *= max(0.0, uNormalScale);
          nTS = normalize(nm);
        }

        if (uHasHeight == 1 && uBumpScale > 0.0) {
          // cheap bump from height gradient (in UV space)
          float h0 = texture2D(uHeightTex, uv).r;
          float hx = texture2D(uHeightTex, uv + vec2(0.002, 0.0)).r;
          float hy = texture2D(uHeightTex, uv + vec2(0.0, 0.002)).r;
          vec2 grad = vec2(hx - h0, hy - h0);
          vec3 bumpTS = normalize(vec3(-grad.x * uBumpScale, -grad.y * uBumpScale, 1.0));
          nTS = normalize(vec3(nTS.xy + bumpTS.xy, nTS.z));
        }

        Nw = tangentSpaceToWorld(nTS, Nw);

        // roughness (optional, affects specular tightness)
        float rough = 0.85;
        if (uHasRough == 1) {
          rough = texture2D(uRoughTex, uv).r;
        }
        rough *= max(0.0, uRoughnessMult);
        rough = clamp(rough, 0.04, 1.0);

        vec3 L = normalize(uLightDir);
        vec3 V = normalize(-vViewPos);
        vec3 H = normalize(L + V);

        float diff = max(dot(Nw, L), 0.0);

        // Simple specular: roughness -> shininess
        float shininess = mix(120.0, 8.0, rough);
        float spec = pow(max(dot(Nw, H), 0.0), shininess) * (1.0 - rough);
        // Lower specular energy to avoid "washed" look on darker textures.
        spec *= 0.12;

        spec *= max(0.0, uSpecStrength);
        // Environment contribution (cheap IBL approximation)
        vec3 R = reflect(-V, Nw);
        float rt = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 envCol = mix(uEnvGroundColor, uEnvSkyColor, smoothstep(0.0, 1.0, rt));
        vec3 envDiff = envCol * uEnvDiffuseStrength;
        float fres = pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
        vec3 envSpec = envCol * (0.04 + 0.96 * fres) * (1.0 - rough) * uEnvSpecIntensity;
        envSpec *= max(0.0, uSpecStrength);
        envSpec *= ao;

        float fill = max(dot(Nw, normalize(uFillLightDir)), 0.0) * uFillStrength;
        float light = uAmbient + (1.0 - uAmbient) * (diff + fill);
        light = clamp(light, 0.0, 1.35);
        vec3 color = (albedo * light * ao) + vec3(spec) + (albedo * envDiff * ao) + envSpec;

        gl_FragColor = vec4(color * uExposureMult, 0.98 * uAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  mat.toneMapped = true;
  return mat;
}

// ------------------------
// Geometry helpers
// ------------------------
function distXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// ------------------------------------------------------------
// Auto exposure for surfaces
// ------------------------------------------------------------
// Darker albedo textures tend to look "washed" in AR when using a global
// lighting setup. To keep different surfaces closer to their reference photos,
// we derive a gentle per-texture exposure multiplier from the albedo image.
// Can be overridden per texture via params.exposureMult in palettes.
function computeAutoExposureMultFromTexture(tex) {
  try {
    const img = tex && tex.image;
    if (!img) return 1.0;

    const w = Math.max(1, Math.min(64, img.naturalWidth || img.width || 64));
    const h = Math.max(1, Math.min(64, img.naturalHeight || img.height || 64));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 1.0;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const srgbToLinear = (c) => {
      c = c / 255;
      return (c <= 0.04045) ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    let sum = 0;
    const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const r = srgbToLinear(data[i]);
      const g = srgbToLinear(data[i + 1]);
      const b = srgbToLinear(data[i + 2]);
      // linear luminance
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const meanLuma = sum / Math.max(1, n);

    // Map mean luminance -> exposure multiplier:
    //  - dark textures get a lower multiplier (reduce wash)
    //  - bright textures stay near 1.0
    const em = clamp(0.62 + 0.70 * meanLuma, 0.70, 1.00);
    return em;
  } catch (_) {
    // Cross-origin images without proper CORS headers will throw when reading pixels.
    return 1.0;
  }
}

function polyArea2(points) {
  // points: Vector3[] in local space, use x,z
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += (a.x * b.z - b.x * a.z);
  }
  return s * 0.5;
}

function computeAreaM2() {
  if (state.points.length < 3) return 0;
  let outer = Math.abs(polyArea2(state.points));
  let holes = 0;
  for (const h of state.holes) {
    if (h.length >= 3) holes += Math.abs(polyArea2(h));
  }
  return Math.max(0, outer - holes);
}

function setLayout(layout) {
  // Only two layouts are supported in this project build.
  // Any legacy value (e.g. "stagger") is normalized to the default.
  if (layout !== 'straight' && layout !== 'diagonal') layout = 'straight';

  state.layout = layout;
  if (UI.layoutSelect) UI.layoutSelect.value = layout;
  if (tileMaterial) {
    tileMaterial.uniforms.uLayoutMode.value = layout === 'diagonal' ? 1 : 0;
  }
  // UI: pattern tabs
  UI.finalPatterns?.querySelectorAll('.patternTab').forEach(btn => {
    btn.classList.toggle('patternTab--active', btn.dataset.layout === layout);
  });
  UI.layoutRow?.querySelectorAll('.layoutCard').forEach(btn => {
    btn.classList.toggle('layoutCard--active', btn.dataset.layout === layout);
  });
}

function _withTimeout(promise, ms) {
  let tId = null;
  const to = new Promise(resolve => {
    tId = setTimeout(() => resolve({ ok: false, timeout: true, v: null }), ms);
  });
  return Promise.race([
    Promise.resolve(promise)
      .then(v => ({ ok: true, v }))
      .catch(e => ({ ok: false, error: e, v: null })),
    to,
  ]).finally(() => {
    if (tId) clearTimeout(tId);
  });
}

function crossfadeFillMeshToMaterial(newMat, durationMs = 140) {
  try {
    if (!fillMesh) return;
    const oldMat = fillMesh.material;

    // If there is no previous material or no scene, fall back to direct swap.
    if (!oldMat || !scene) {
      fillMesh.material = newMat;
      fillMesh.material.needsUpdate = true;
      // Ensure final material stays opaque (premium look).
      try { newMat.transparent = false; newMat.depthWrite = true; newMat.depthTest = true; } catch (_) {}
      if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 1.0;
      return;
    }

    // Preserve original flags so we don't accidentally keep the floor semi-transparent.
    const oldFlags = { transparent: !!oldMat.transparent, depthWrite: oldMat.depthWrite !== false, depthTest: oldMat.depthTest !== false };
    const newFlags = { transparent: !!newMat.transparent, depthWrite: newMat.depthWrite !== false, depthTest: newMat.depthTest !== false };

    // Prepare alpha uniforms (supported by our tile shader material).
    if (oldMat.uniforms && oldMat.uniforms.uAlpha) oldMat.uniforms.uAlpha.value = 1.0;
    if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 0.0;

    // During the fade we need transparency, but we MUST restore opacity afterwards.
    try {
      oldMat.transparent = true;
      newMat.transparent = true;
      oldMat.depthWrite = false;
      newMat.depthWrite = false;
      oldMat.depthTest = true;
      newMat.depthTest = true;
    } catch (_) {}

    const overlay = new THREE.Mesh(fillMesh.geometry, newMat);
    overlay.position.copy(fillMesh.position);
    overlay.quaternion.copy(fillMesh.quaternion);
    overlay.scale.copy(fillMesh.scale);
    overlay.frustumCulled = false;
    overlay.renderOrder = (fillMesh.renderOrder || 0) + 1;
    overlay.updateMatrix();
    overlay.matrixAutoUpdate = false;
    scene.add(overlay);

    const t0 = performance.now();
    const ease = (k) => k * k * (3.0 - 2.0 * k); // smoothstep

    const step = (now) => {
      const k = clamp((now - t0) / Math.max(1, durationMs), 0, 1);
      const a = ease(k);
      if (oldMat.uniforms && oldMat.uniforms.uAlpha) oldMat.uniforms.uAlpha.value = 1.0 - a;
      if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = a;

      if (k < 1) {
        requestAnimationFrame(step);
        return;
      }

      // Finalize: swap real material, remove overlay.
      try { scene.remove(overlay); } catch (_) {}
      fillMesh.material = newMat;
      fillMesh.material.needsUpdate = true;

      // IMPORTANT: restore opaque floor rendering (no blending / no depth artifacts).
      try {
        newMat.transparent = false;
        newMat.depthWrite = true;
        newMat.depthTest = true;
      } catch (_) {}
      if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 1.0;

      // Restore old material flags (in case it's reused elsewhere) and then dispose safely.
      try {
        oldMat.transparent = oldFlags.transparent;
        oldMat.depthWrite = oldFlags.depthWrite;
        oldMat.depthTest = oldFlags.depthTest;
      } catch (_) {}

      try {
        if (oldMat && oldMat !== newMat && oldMat.dispose && oldMat.uniforms && oldMat.uniforms.uTex) {
          oldMat.dispose();
        }
      } catch (_) {}
    };

    requestAnimationFrame(step);
  } catch (_) {
    // Fallback to direct swap on any unexpected runtime issue.
    try {
      fillMesh.material = newMat;
      fillMesh.material.needsUpdate = true;
      try { newMat.transparent = false; newMat.depthWrite = true; newMat.depthTest = true; } catch (_) {}
      if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 1.0;
    } catch (_) {}
  }
}

// ------------------------
// Deferred heavy map streaming (AO/Height)
// ------------------------
let _heavyMapsTimer = null;
let _heavyMapsSeq = 0;
function scheduleDeferredHeavyMaps(mat, urls, preferredQuality, isStaleFn, opts = {}) {
  try {
    if (_heavyMapsTimer) clearTimeout(_heavyMapsTimer);
    const mySeq = ++_heavyMapsSeq;

    const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 1200;
    const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 350;
    const startedAt = performance.now();

    // Debounce: if the user keeps switching within debounce window, we'll re-schedule.
    _heavyMapsTimer = setTimeout(async () => {
      if (mySeq !== _heavyMapsSeq) return;
      if (isStaleFn && isStaleFn()) return;

      // Connectivity-aware: on slow networks keep XR light, but do not permanently skip AO (it affects perceived brightness).
      // We only deprioritize heavy work: delay longer and avoid height on very slow links.
      let slowNet = false;
      try {
        const { eff, downlink, rtt, saveData } = _getConnInfo();
        if (saveData) return;
        if (/slow-2g|2g|3g/i.test(eff)) slowNet = true;
        if (downlink && downlink < 2) slowNet = true;
        if (rtt && rtt > 800) slowNet = true;
      } catch (_) {}

      // Extra guard: do not start heavy loads immediately after a switch.
      const dt = performance.now() - startedAt;
      if (dt < debounceMs) return;

      const { aoUrl, heightUrl } = urls || {};
      const tasks = [];
      if (aoUrl) tasks.push(['ao', aoUrl]);
      if (!slowNet && heightUrl) tasks.push(['height', heightUrl]);
      if (!tasks.length) return;

      const ps = tasks.map(([kind, u]) => loadTexSmartCached(u, kind, preferredQuality, isStaleFn, { priority: 'normal' }));
      const rs = await Promise.all(ps);
      if (isStaleFn && isStaleFn()) return;

      for (let i = 0; i < tasks.length; i++) {
        applyMapToTileMaterial(mat, tasks[i][0], rs[i] || null);
      }
      if (fillMesh && state.phase === 'ar_final') {
        fillMesh.material = mat;
        fillMesh.material.needsUpdate = true;
      }
    }, delayMs);
  } catch (_) {}
}

async function selectTile(tileOrId) {
  // Accept either an ID (number/string) or an in-memory tile object (for per-shape palettes)
  let t = null;
  if (tileOrId && typeof tileOrId === 'object') {
    t = tileOrId;
  } else {
    const id = tileOrId;
    t = state.tiles.find(x => x.id === id)
      || (Array.isArray(state.currentAllowedTiles) ? state.currentAllowedTiles.find(x => x.id === id) : null)
      || null;
  }
  if (!t) return;

  // Guard against rapid re-selection: if user clicks another tile while we are still loading,
  // older loads won't overwrite the latest selection/material.
  const _mySeq = ++_selectTileSeq;
  const isStale = () => _mySeq !== _selectTileSeq;

  const _prevTile = state.selectedTile;
  state.selectedTile = t;

  const albedoUrl = (t.maps && t.maps.albedo) ? t.maps.albedo : t.texture;
  const normalUrl = (t.maps && t.maps.normal) ? t.maps.normal : null;
  const roughUrl  = (t.maps && t.maps.roughness) ? t.maps.roughness : null;
  const aoUrl     = (t.maps && t.maps.ao) ? t.maps.ao : null;
  const heightUrl = (t.maps && t.maps.height) ? t.maps.height : null;

  const params = t.params || {};
  const ns = typeof params.normalScale === 'number' ? params.normalScale : (typeof t.normalScale === 'number' ? t.normalScale : 0.0);
  const bs = typeof params.bumpScale === 'number' ? params.bumpScale : (typeof t.bumpScale === 'number' ? t.bumpScale : 0.0);

  const preferredQuality = getPreferredSurfaceQuality({ inAR: state.phase === 'ar_final' });

  const _showTexProgress = state.phase === 'ar_final';
  const _texProgSeq = _showTexProgress ? (_arTexProgress.seq + 1) : 0;
  if (_showTexProgress) {
    const _total = [albedoUrl, roughUrl, aoUrl].filter(Boolean).length;
    _arTexProgressShow(_texProgSeq, _total);
  }


  // Start core map loads immediately (in parallel).
  // Premium stability rule: keep map quality consistent across core maps.
  const albedoP = loadTexSmartCached(albedoUrl, 'albedo', preferredQuality, isStale, { priority: 'high' });
  const roughP  = loadTexSmartCached(roughUrl,  'roughness', preferredQuality, isStale, { priority: 'high' });
  const aoP     = aoUrl ? loadTexSmartCached(aoUrl, 'ao', preferredQuality, isStale, { priority: 'high' }) : Promise.resolve(null);
  const normalP = loadTexSmartCached(normalUrl, 'normal',    preferredQuality, isStale, { priority: 'normal' });

  if (_showTexProgress) {
    albedoP.finally(() => _arTexProgressTick(_texProgSeq));
    roughP.finally(() => _arTexProgressTick(_texProgSeq));
    aoP.finally(() => _arTexProgressTick(_texProgSeq));
  }


  let albedoTex = await albedoP;
  if (isStale()) return;

  // Critical map: without albedo we must NOT swap the material (would look white / broken).
  if (!albedoTex) {
    console.warn('[surfaces] albedo missing, keeping previous material for stability:', albedoUrl);
    state.selectedTile = _prevTile || state.selectedTile;
    return;
  }

  // Compute per-tile settings (cheap).
  const size = t.tileSizeM || { w: 0.2, h: 0.2 };

  let uvScaleX = 1.0, uvScaleY = 1.0;
  const uvp = (params && (params.uvScale ?? params.repeatScale)) ?? null;
  if (typeof uvp === 'number') { uvScaleX = uvScaleY = uvp; }
  else if (uvp && typeof uvp === 'object') {
    if (typeof uvp.x === 'number') uvScaleX = uvp.x;
    if (typeof uvp.y === 'number') uvScaleY = uvp.y;
  }

  const ag = (params && typeof params.albedoGain === 'number') ? params.albedoGain : 1.0;
  const rm = (params && typeof params.roughnessMult === 'number') ? params.roughnessMult : 1.0;
  const ss = (params && typeof params.specStrength === 'number') ? params.specStrength : 1.0;

  const em = (params && typeof params.exposureMult === 'number')
    ? params.exposureMult
    : computeAutoExposureMultFromTexture(albedoTex);

  // Desktop preview (non-XR): update albedo immediately for responsiveness.
  if (previewPlane && previewPlane.material) {
    const pm = previewPlane.material;
    try {
      const g = previewPlane.geometry;
      if (g && g.attributes && g.attributes.uv && !g.attributes.uv2) {
        g.setAttribute('uv2', new THREE.BufferAttribute(g.attributes.uv.array, 2));
      }
    } catch (_) {}

    pm.map = albedoTex;
    if (pm.map && pm.map.repeat) pm.map.repeat.set((3 / size.w) * uvScaleX, (3 / size.h) * uvScaleY);
    pm.needsUpdate = true;
  }

  // Core shading maps.
// Premium rule: in AR final mode we DO NOT swap the floor material until roughness (and AO when present) are resolved.
// This prevents over-bright / inconsistent shading on some textures.
let roughTex = null;
let aoTexCore = null;
let normalTex = null;

if (state && state.phase === 'ar_final') {
  // Wait for roughness fully (no short timeout). If the file truly doesn't exist, the loader resolves null quickly.
  roughTex = await roughP;
  if (isStale()) return;

  // AO strongly affects perceived brightness. If AO is present in the palette, wait for it too.
  aoTexCore = await aoP;
  if (isStale()) return;

  // Normal can lag behind; we keep it opportunistic to preserve snappy switching.
  const normalR = await _withTimeout(normalP, 350);
  if (isStale()) return;
  normalTex = normalR.ok ? normalR.v : null;
} else {
  // Non-AR (detail / desktop) stays responsive: short waits.
  const _coreWaitMs = 260;
  const roughR  = await _withTimeout(roughP, _coreWaitMs);
  const aoR     = await _withTimeout(aoP, _coreWaitMs);
  const normalR = await _withTimeout(normalP, _coreWaitMs);
  if (isStale()) return;

  roughTex  = roughR.ok ? roughR.v : null;
  aoTexCore = aoR.ok ? aoR.v : null;
  normalTex = normalR.ok ? normalR.v : null;
}
  // Update / create tile material in-place (premium switching without using maps from other textures).
  if (!tileMaterial) {
    tileMaterial = makeTileMaterial({
      albedoTex,
      normalTex,
      roughnessTex: roughTex,
      aoTex: aoTexCore,
      heightTex: null,
      normalScale: ns || 0.0,
      bumpScale: bs || 0.0,
    });
  }

  const mat = tileMaterial;

  // Apply per-tile uniforms.
  if (mat.uniforms.uNormalScale) mat.uniforms.uNormalScale.value = ns || 0.0;
  if (mat.uniforms.uBumpScale) mat.uniforms.uBumpScale.value = bs || 0.0;
  if (mat.uniforms.uTileSize) mat.uniforms.uTileSize.value.set(size.w, size.h);
  if (mat.uniforms.uUvScale) mat.uniforms.uUvScale.value.set(uvScaleX, uvScaleY);
  if (mat.uniforms.uAlbedoGain) mat.uniforms.uAlbedoGain.value = ag;
  if (mat.uniforms.uRoughnessMult) mat.uniforms.uRoughnessMult.value = rm;
  if (mat.uniforms.uSpecStrength) mat.uniforms.uSpecStrength.value = ss;
  if (mat.uniforms.uExposureMult) mat.uniforms.uExposureMult.value = em;

  // Update core maps immediately (no cross-texture borrowing).
  applyMapToTileMaterial(mat, 'roughness', roughTex);
  applyMapToTileMaterial(mat, 'ao', aoTexCore);
  applyMapToTileMaterial(mat, 'normal', normalTex);
  applyMapToTileMaterial(mat, 'height', null);

  // Ensure current layout mode is reflected.
  setLayout(state.layout);

  // Apply albedo:
  // - In AR final: premium in-shader crossfade (no transparency/depth side effects).
  // - Elsewhere: apply immediately.
  if (state.phase === 'ar_final') {
    crossfadeAlbedoOnMaterial(mat, albedoTex, 140);
  } else {
    applyMapToTileMaterial(mat, 'albedo', albedoTex);
  }

  // Ensure the floor uses the current tile material (if already created).
  if (fillMesh) {
    fillMesh.material = mat;
    fillMesh.material.needsUpdate = true;
  }

  // Update UI hero/title selections.

  if (UI.detailHero) {
    if (!(state.selectedShape && Array.isArray(state.selectedShape.gallery) && state.selectedShape.gallery.length)) {
      const hero = t.preview || (t.maps && t.maps.albedo) || t.texture || '';
      UI.detailHero.style.backgroundImage = hero ? `url(${hero})` : 'none';
    }
  }

  const tileKey = String(t.id);
  const updateSwatches = (wrap) => {
    wrap?.querySelectorAll('[data-tile-id]').forEach(el => {
      el.classList.toggle('swatch--active', tileKey === el.dataset.tileId);
    });
  };
  updateSwatches(UI.colorRow);
  updateSwatches(UI.finalColors);

  if (UI.arProductTitle) UI.arProductTitle.textContent = t.name || '—';

  // Background upgrades: 2k albedo + remaining maps.
  const matRef = mat;
  const deferMs = 80;
  setTimeout(async () => {
    if (isStale()) return;

    // Optional 2k albedo upgrade.
    if (preferredQuality === '2k') {
      const albedo2k = await loadTexSmartCached(albedoUrl, 'albedo', preferredQuality, isStale, { priority: 'normal' });
      if (!isStale() && albedo2k && albedo2k !== albedoTex) {
        applyMapToTileMaterial(matRef, 'albedo', albedo2k);
        if (previewPlane && previewPlane.material) {
          previewPlane.material.map = albedo2k;
          previewPlane.material.needsUpdate = true;
        }
      }
    }

    // Streaming strategy:
    // - Always keep core shading maps (roughness/normal) reasonably fresh.
    // - Defer heavy maps (AO/Height) in AR to reduce stutter and WebXR instability.
    const jobs = [
      ['normal', normalUrl],
      ['roughness', roughUrl],
    ];

    const promises = jobs.map(([kind, u]) => loadTexSmartCached(u, kind, preferredQuality, isStale, { priority: 'normal' }));
    const results = await Promise.all(promises);
    if (isStale()) return;

    for (let i = 0; i < jobs.length; i++) {
      const kind = jobs[i][0];
      const tex = results[i] || null;
      applyMapToTileMaterial(matRef, kind, tex);

      if (previewPlane && previewPlane.material && previewPlane.material.isMeshStandardMaterial) {
        const pm = previewPlane.material;
        if (kind === 'normal') {
          pm.normalMap = tex;
          pm.normalScale?.set?.(ns || 0.0, ns || 0.0);
        } else if (kind === 'roughness') {
          pm.roughnessMap = tex;
        }
        pm.needsUpdate = true;
      }
    }

    if (fillMesh && state.phase === 'ar_final') {
      // Ensure the active material stays applied.
      fillMesh.material = matRef;
      fillMesh.material.needsUpdate = true;
    }

    // Heavy maps: load only when AR is stable (or when user has stopped switching).
    if (state.phase === 'ar_final') {
      // In XR we intentionally keep heavy maps at 1k to reduce memory spikes and decoder pressure.
      scheduleDeferredHeavyMaps(matRef, { aoUrl: (aoTexCore ? null : aoUrl), heightUrl }, '1k', isStale, { delayMs: 1200, debounceMs: 350 });
    } else {
      // Non-AR: safe to load AO/Height in the background.
      const heavyJobs = [
        ['ao', (aoTexCore ? null : aoUrl)],
        ['height', heightUrl],
      ].filter(([_, u]) => !!u);
      if (heavyJobs.length) {
        const heavyPs = heavyJobs.map(([kind, u]) => loadTexSmartCached(u, kind, preferredQuality, isStale, { priority: 'normal' }));
        const heavyRs = await Promise.all(heavyPs);
        if (isStale()) return;
        for (let i = 0; i < heavyJobs.length; i++) {
          const kind = heavyJobs[i][0];
          const tex = heavyRs[i] || null;
          applyMapToTileMaterial(matRef, kind, tex);
          if (previewPlane && previewPlane.material && previewPlane.material.isMeshStandardMaterial) {
            const pm = previewPlane.material;
            if (kind === 'ao') pm.aoMap = tex;
            else if (kind === 'height') { pm.bumpMap = tex; pm.bumpScale = bs || 0.0; }
            pm.needsUpdate = true;
          }
        }
      }
    }
  }, deferMs);

  // Predictive prefetch for snappy native-like switching.
  schedulePrefetchAdjacentTiles(t);
}

// ------------------------
// Catalog + Detail rendering (Формы -> деталка формы -> выбор цветов/текстур)
// ------------------------
function renderCatalog(list) {
  if (!UI.catalogCards) return;
  UI.catalogCards.innerHTML = '';
  list.forEach(shape => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'catalogCard catalogCard--square';
    card.style.backgroundImage = `url(${shape.icon || shape.hero || ''})`;
    card.setAttribute('aria-label', shape.name || shape.id || 'Форма');
    card.addEventListener('click', () => openDetail(shape.id));
    UI.catalogCards.appendChild(card);
  });
}

async function loadSurfacePalette(url) {
  if (!url) return null;
  state._paletteCache = state._paletteCache || new Map();
  if (state._paletteCache.has(url)) return state._paletteCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('Не удалось загрузить палитру поверхностей:', url, res.status);
      state._paletteCache.set(url, null);
      return null;
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    // Resolve relative URLs inside palette items.
    // Supports:
    //  - absolute URLs (kept as-is)
    //  - palettes providing `baseUrl` (absolute or relative)
    //  - bucket-style URLs (Object Storage)
    //  - site-relative asset paths like `assets/...`
    const paletteURL = new URL(url, window.location.href);
    const paletteDir = new URL('.', paletteURL).toString();
    const siteRoot = `${window.location.origin}/`;

    // Detect bucket root for Object Storage.
    //  - path-style: https://storage.yandexcloud.net/<bucket>/...
    //  - host-style: https://<bucket>.storage.yandexcloud.net/...
    let bucketRoot = `${paletteURL.origin}/`;
    if (paletteURL.hostname === 'storage.yandexcloud.net') {
      const segs = paletteURL.pathname.split('/').filter(Boolean);
      if (segs.length > 0) bucketRoot = `${paletteURL.origin}/${segs[0]}/`;
    }

    const rawBaseUrl = (typeof data.baseUrl === 'string' && data.baseUrl.trim()) ? data.baseUrl.trim() : '';
    const baseAbs = rawBaseUrl
      ? (/^https?:\/\//i.test(rawBaseUrl)
          ? rawBaseUrl.replace(/\/+$/, '') + '/'
          : new URL(rawBaseUrl, paletteDir).toString())
      : '';

    const isAbs = (p) => /^https?:\/\//i.test(String(p || ''));
    const isSpecial = (p) => /^(data:|blob:)/i.test(String(p || ''));

    const resolvePath = (p) => {
      if (!p) return p;
      const s = String(p);

      if (isAbs(s) || isSpecial(s)) return s;

      // If palette provides baseUrl, prefer it.
      if (baseAbs) return new URL(s.replace(/^\/+/, ''), baseAbs).toString();

      // Explicit relative paths resolve against the palette file location.
      if (s.startsWith('./') || s.startsWith('../')) return new URL(s, paletteDir).toString();

      // Site assets (local build): keep rooted at the site origin.
      if (s.startsWith('assets/') || s.startsWith('css/') || s.startsWith('js/')) {
        return new URL(s, siteRoot).toString();
      }

      // If palette is hosted on Object Storage, assume remaining paths are bucket-relative.
      if (paletteURL.hostname.endsWith('storage.yandexcloud.net')) {
        return new URL(s.replace(/^\/+/, ''), bucketRoot).toString();
      }

      // Fallback: treat as site-root relative.
      return new URL(s.replace(/^\/+/, ''), siteRoot).toString();
    };

    items.forEach((it) => {
      if (!it || typeof it !== 'object') return;
      if (it.preview) it.preview = resolvePath(it.preview);
      if (it.texture) it.texture = resolvePath(it.texture);
      if (it.maps && typeof it.maps === 'object') {
        Object.keys(it.maps).forEach((k) => {
          it.maps[k] = resolvePath(it.maps[k]);
        });
      }
    });

    state._paletteCache.set(url, items);
    return items;
  } catch (err) {
    // Most common reasons:
    //  - palette JSON is invalid (trailing comma, comments, wrong quotes)
    //  - CORS blocks the request
    // Don't break the app: fallback to local tiles for the shape.
    console.warn('Не удалось загрузить/разобрать палитру поверхностей:', url, err);
    state._paletteCache.set(url, null);
    return null;
  }
}

async function loadPaletteDefaultsForShape(shapeId) {
  // Disabled by default (see ENABLE_PALETTE_SETTINGS above). This prevents
  // noisy 404s for projects that keep all parameters inside palettes/<shapeId>.json.
  if (!ENABLE_PALETTE_SETTINGS) return null;
  if (!shapeId || !PALETTE_SETTINGS_BASE_URL) return null;
  state._paletteDefaultsCache = state._paletteDefaultsCache || new Map();
  const url = `${PALETTE_SETTINGS_BASE_URL}${encodeURIComponent(shapeId)}.json`;
  if (state._paletteDefaultsCache.has(url)) return state._paletteDefaultsCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 404 is normal — safe-fallback.
      state._paletteDefaultsCache.set(url, null);
      return null;
    }
    const data = await res.json();
    const d = (data && typeof data === 'object') ? data.defaults : null;
    if (!d || typeof d !== 'object') {
      state._paletteDefaultsCache.set(url, null);
      return null;
    }
    // Minimal sanitization
    if (d.tileSizeM && (typeof d.tileSizeM.w !== 'number' || typeof d.tileSizeM.h !== 'number')) {
      delete d.tileSizeM;
    }
    state._paletteDefaultsCache.set(url, d);
    return d;
  } catch (err) {
    console.warn('Не удалось загрузить palette_settings:', shapeId, err);
    state._paletteDefaultsCache.set(url, null);
    return null;
  }
}


function _normalizeTextureKey(shapeId, textureId) {
  const s = String(textureId || '').trim();
  if (!s) return '';
  let t = s;
  // Undo legacy separators
  t = t.replace(/%3A/ig, ':');
  // Remove shape prefixes (klassika_, klassika:, etc.)
  if (shapeId) {
    const sh = String(shapeId);
    t = t.replace(new RegExp('^' + sh + '[:_\-]+', 'i'), '');
  }
  // Remove pack_ prefix
  t = t.replace(/^pack[:_\-]+/i, '');
  // Collapse to a comparable token
  t = t.toLowerCase();
  t = t.replace(/[^a-z0-9_\-]+/g, '_');
  t = t.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return t;
}

async function _filterPaletteItemsBySurfaces(shapeId, items) {
  try {
    if (!API_BASE_URL) return items;
    const url = `${API_BASE_URL}api/surfaces/${encodeURIComponent(shapeId)}`;
    const res = await fetch(url);
    if (!res.ok) return items;
    const data = await res.json();
    const textures = data && data.textures;
    let folderNames = [];
    if (Array.isArray(textures)) {
      folderNames = textures.map(t => t && (t.id || t.textureId || t.folder || t.name)).filter(Boolean);
    } else if (textures && typeof textures === 'object') {
      folderNames = Object.keys(textures);
    }
    if (!folderNames.length) return items;

    const normSet = new Set(folderNames.map(fn => _normalizeTextureKey(shapeId, fn)).filter(Boolean));
    const out = (Array.isArray(items) ? items : []).filter((it) => {
      if (!it || typeof it !== 'object') return false;
      const candidates = [it.id, it.textureId, it.canonicalId, it.name].filter(Boolean);
      for (const c of candidates) {
        const n = _normalizeTextureKey(shapeId, c);
        if (n && normSet.has(n)) return true;
      }
      return false;
    });
    return out;
  } catch (_) {
    return items;
  }
}

function paletteItemsToTiles(items, defaults = null) {
  const d = (defaults && typeof defaults === 'object') ? defaults : null;
  const dTile = (d && d.tileSizeM && typeof d.tileSizeM.w === 'number' && typeof d.tileSizeM.h === 'number')
    ? d.tileSizeM
    : null;
  const defaultParamKeys = ['uvScale','exposureMult','contrast','saturation','roughnessMult','specStrength','normalScale','bumpScale'];

  return (items || []).map((it) => {
    const tileSizeM = it.tileSizeM || dTile || { w: 0.2, h: 0.2 };
    const paramsIn = (it.params && typeof it.params === 'object') ? it.params : null;
    const params = paramsIn ? { ...paramsIn } : {};
    if (d) {
      for (const k of defaultParamKeys) {
        if (params[k] != null) continue;
        if (typeof d[k] !== 'number') continue;
        // Keep renderer's auto-exposure behavior unless the user explicitly overrides it.
        // Many palettes were authored assuming auto exposure when per-texture value is missing.
        // If palette default is left at neutral 1.0, treat it as "auto" (do not force 1.0).
        if (k === 'exposureMult' && d[k] === 1.0) continue;
        params[k] = d[k];
      }
    }
    const paramsOut = Object.keys(params).length ? params : null;
    return {
      id: it.id,
      name: it.name || it.id,
      tileSizeM,
      maps: it.maps || null,
      params: paramsOut,
      preview: it.preview || (it.maps && it.maps.albedo) || null,
      // keep compatibility with existing UI expectations
      texture: (it.maps && it.maps.albedo) ? it.maps.albedo : it.texture,
    };
  });
}

async function openDetail(shapeId) {
  const s = state.shapes.find(x => x.id === shapeId);
  if (!s) return;
  state.selectedShape = s;

  // Fill UI
  UI.detailTitle.textContent = s.name;
  UI.detailName.textContent = s.name;
  UI.detailSub.textContent = s.subtitle || 'Тротуарная плитка';
  // Шапка: либо карусель из фото (если задано), либо одиночное изображение
  const gallery = Array.isArray(s.gallery) ? s.gallery.filter(Boolean) : [];
  if (gallery.length > 0) {
    UI.detailHero.style.backgroundImage = 'none';
    UI.detailHero.innerHTML = `
      <div class="heroCarousel">
        <div class="heroTrack" id="heroTrack">
          ${gallery.map((src, idx) => `
            <div class="heroSlide" data-idx="${idx}">
              <img src="${src}" alt="">
            </div>`).join('')}
        </div>
        <div class="heroDots" id="heroDots">
          ${gallery.map((_, idx) => `<div class="heroDot ${idx===0?'active':''}" data-idx="${idx}"></div>`).join('')}
        </div>
      </div>
    `;
    const track = UI.detailHero.querySelector('#heroTrack');
    const dots = [...UI.detailHero.querySelectorAll('.heroDot')];
    const activateDot = (i) => dots.forEach((d, di) => d.classList.toggle('active', di===i));
    track.addEventListener('scroll', () => {
      const w = track.clientWidth || 1;
      const idx = Math.round(track.scrollLeft / w);
      activateDot(Math.max(0, Math.min(dots.length-1, idx)));
    }, { passive: true });
  } else {
    UI.detailHero.innerHTML = '';
    UI.detailHero.style.backgroundImage = `url(${s.hero || s.icon || ''})`;
  }

  // tech
  UI.detailTech.innerHTML = '';
  const tech = s.tech || {
    'Толщина': '—',
    'Назначение': '—',
    'Класс': '—',
  };
  for (const [k, v] of Object.entries(tech)) {
    const key = String(k);
    const val = String(v);

    // Толщина выводим одной строкой слева: "Толщина - 60мм" (как в OZON)
    if (/^\s*Толщина/.test(key)) {
      const row = document.createElement('div');
      row.className = 'kvRow kvRowFull';
      row.innerHTML = `<div class="kvFull">${key.replace(/\s*,\s*мм\s*$/i,'')} - ${val.replace(/\s*мм\s*$/i,'')}мм</div>`;
      UI.detailTech.appendChild(row);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'kvRow';
    row.innerHTML = `<div class="kvK">${key}</div><div class="kvV">${val}</div>`;
    UI.detailTech.appendChild(row);
  }
  if (UI.techBody) UI.techBody.hidden = true;
  if (UI.btnTechToggle) UI.btnTechToggle.hidden = false;

  // Layout buttons
  UI.layoutRow.querySelectorAll('.layoutCard').forEach(btn => {
    btn.onclick = () => setLayout(btn.dataset.layout);
  });
  setLayout(state.layout);

  // --- Colors & Surfaces (per-shape palette support) ---
  let allowed = null;
  let paletteActive = false;

  // If a shape defines an explicit surfacePalette URL, use it.
  // Otherwise, try the default Object Storage convention:
  //   <SURFACE_PALETTE_BASE_URL>/<shapeId>.json
  let paletteUrl = s.surfacePalette || '';

  // Prefer Admin API reconcile endpoint when API_BASE_URL is provided.
  // This removes "ghost" textures that are no longer present in the bucket.
  if (API_BASE_URL) {
    const ts = Date.now();
    paletteUrl = `${API_BASE_URL}api/palettes/${encodeURIComponent(s.id)}?reconcile=1&_=${ts}`;
  } else if (!paletteUrl && SURFACE_PALETTE_BASE_URL) {
    paletteUrl = `${SURFACE_PALETTE_BASE_URL}${encodeURIComponent(s.id)}.json`;
  }

  if (paletteUrl) {
    // Optional defaults file: palette_settings/<shapeId>.json
    const paletteDefaults = await loadPaletteDefaultsForShape(s.id);
    let items = await loadSurfacePalette(paletteUrl);
    if (API_BASE_URL) {
      items = await filterPaletteItemsBySurfaces(s.id, items);
    }
    if (Array.isArray(items) && items.length) {
      allowed = paletteItemsToTiles(items, paletteDefaults);
      paletteActive = true;
    }
  }

  // fallback: old behavior
  if (!Array.isArray(allowed) || !allowed.length) {
    allowed = (Array.isArray(s.tileIds) && s.tileIds.length
      ? s.tileIds.map(id => state.tiles.find(t => t.id === id)).filter(Boolean)
      : state.tiles.slice(0, 8));
  }

  state.currentAllowedTiles = allowed;

  // Swatches. For per-shape palette: click -> apply + start AR.
  renderColorRow(UI.colorRow, allowed, { startArOnClick: paletteActive });

  // Prefetch (non-blocking): warm a small set of previews when the browser is idle.
  try {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 0 }), 220));
    idle(() => {
      try {
        const previewUrls = (allowed || []).slice(0, 8).map(getTilePreviewUrl).filter(Boolean);
        prefetchImageUrls(previewUrls, 3);
      } catch (_) {}
    });
  } catch (_) {}

  // Show the screen immediately; texture maps will refine progressively.
  setActiveScreen('detail');
  state.phase = 'detail';

  // Choose default surface/tile for this shape (apply albedo fast, secondary maps in background)
  const defaultTile = allowed[0] || state.tiles[0];
  if (defaultTile) { selectTile(defaultTile); }

  // Update AR entry UI (Chrome-only gating)
  updateArEntryUI();
}



// ------------------------
// Preview lazy-load + prefetch (performance/stability)
// ------------------------
function getTilePreviewUrl(t) {
  return (t && (t.preview || (t.maps && t.maps.albedo) || t.texture)) ? (t.preview || (t.maps && t.maps.albedo) || t.texture) : '';
}

function getTileMapUrls(t) {
  if (!t) return [];
  const m = (t.maps && typeof t.maps === 'object') ? t.maps : {};
  const albedo = m.albedo || t.texture || '';
  const normal = m.normal || '';
  const rough  = m.roughness || '';
  const ao     = m.ao || '';
  const height = m.height || '';
  return [albedo, normal, rough, ao, height].filter(Boolean);
}

// Prefetch a list of image URLs with small concurrency.
// Never throws — safe to fire-and-forget.
function prefetchImageUrls(urls, concurrency = 3) {
  try {
    const unique = Array.from(new Set((urls || []).filter(Boolean)));
    if (!unique.length) return Promise.resolve([]);
    let i = 0;

    const loadOne = (url) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve({ url, ok: true });
      img.onerror = () => resolve({ url, ok: false });
      // Some browsers benefit from setting referrerPolicy for cross-origin assets
      try { img.referrerPolicy = 'no-referrer'; } catch (_) {}
      img.src = url;
    });

    const workers = new Array(Math.max(1, Math.min(concurrency, 6))).fill(0).map(async () => {
      while (i < unique.length) {
        const url = unique[i++];
        await loadOne(url);
      }
    });

    return Promise.all(workers);
  } catch (_) {
    return Promise.resolve([]);
  }
}

let _lazySwatchObserver = null;

function ensureLazySwatchObserver() {
  if (_lazySwatchObserver) return _lazySwatchObserver;

  _lazySwatchObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const bg = el?.dataset?.bg;
      if (bg && !el.dataset.bgLoaded) {
        el.style.backgroundImage = `url(${bg})`;
        el.dataset.bgLoaded = '1';
      }
      _lazySwatchObserver.unobserve(el);
    });
  }, {
    root: null,
    rootMargin: '250px',
    threshold: 0.01
  });

  return _lazySwatchObserver;
}

function setupLazySwatches(container) {
  if (!container) return;
  const io = ensureLazySwatchObserver();
  container.querySelectorAll('.swatch[data-bg]').forEach((el) => {
    if (el.dataset.bgLoaded) return;
    io.observe(el);
  });
}

function renderColorRow(container, tiles, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const startArOnClick = Boolean(opts.startArOnClick);

  tiles.forEach((t, idx) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.dataset.tileId = String(t.id);
        const bgUrl = getTilePreviewUrl(t);
    sw.dataset.bg = bgUrl;
    // Eagerly paint the first few items for a snappy first render; lazy-load the rest.
    const eagerCount = (typeof opts.eagerCount === 'number') ? opts.eagerCount : 10;
    if (idx < eagerCount && bgUrl) {
      sw.style.backgroundImage = `url(${bgUrl})`;
      sw.dataset.bgLoaded = '1';
    }
    sw.title = t.name || 'Текстура';
    sw.addEventListener('click', async () => {
      await selectTile(t);

      // For per-shape palettes: one tap launches AR with the chosen texture.
      if (startArOnClick && !state.xrSession) {
        await startAR();
      }
    });
    container.appendChild(sw);
  });
  // Lazy-load the rest of swatch previews
  setupLazySwatches(container);
}

// ------------------------
// XR setup
// ------------------------
async function checkXrSupport() {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}


// --- AR launch gating: Chrome-only on Android + ARCore helper ---
// --- Surface quality (1k/2k) auto-select ---
// Heuristic: prefer 2k on capable Android devices (more RAM/cores, big screen, good network), otherwise 1k.
// You can override via URL param ?tex=1k or ?tex=2k
function getPreferredSurfaceQuality(ctx = {}) {
  try {
    const sp = new URLSearchParams(window.location.search || '');
    const forced = (sp.get('tex') || '').toLowerCase();
    if (forced === '1k' || forced === '2k') return forced;

    const dm = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 0;
    const hc = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
    const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
    const minPx = Math.min(window.screen?.width || 0, window.screen?.height || 0) * dpr;

    const { eff, downlink, rtt, saveData } = _getConnInfo();

    const inAR = !!(ctx && (ctx.inAR || (state && state.xrSession) || state.phase === 'ar_final'));

    // Runtime perf hint: if decode times are getting high, avoid 2k.
    const avgAny = _texPerf.any.n ? _texPerf.any.ema : 0;
    const avgAlb = _texPerf.albedo.n ? _texPerf.albedo.ema : 0;
    const avgRgh = _texPerf.roughness.n ? _texPerf.roughness.ema : 0;

    if (saveData) return '1k';
    if (/slow-2g|2g|3g/i.test(eff)) return '1k';
    if (downlink && downlink < 2) return '1k';
    if (rtt && rtt > 250) return '1k';

    // If we're already struggling to decode, keep it 1k for stability.
    if ((avgAny && avgAny > 520) || (avgAlb && avgAlb > 420) || (avgRgh && avgRgh > 520)) return '1k';

    // In AR we prefer stability: only allow 2k on very strong devices and when decode is fast.
    if (inAR) {
      if (dm >= 6 && hc >= 8 && minPx >= 1080 && (!avgAny || avgAny < 260)) return '2k';
      return '1k';
    }

    // Non-AR: we can be more aggressive.
    if (dm >= 4 && hc >= 6 && minPx >= 1080) return '2k';
    if (dm >= 3 && hc >= 4 && minPx >= 900 && (!avgAny || avgAny < 320)) return '2k';

    return '1k';
  } catch {
    return '1k';
  }
}

// Build a "2k" URL candidate from a given map URL.
// - If the path contains '/1k/' it will be replaced with '/2k/'.
// - Otherwise returns the original URL.
// Extension changes are handled separately by makeAltExtCandidates().
function make2kCandidateUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // Replace only the first occurrence to avoid unexpected rewrites.
  return url.replace(/\/1k\//, '/2k/');
}

// Build a "1k" URL candidate from a given map URL.
// - If the path contains '/2k/' it will be replaced with '/1k/'.
// - Otherwise returns the original URL.
// Extension changes are handled separately by makeAltExtCandidates().
function make1kCandidateUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\/2k\//, '/1k/');
}

function makeAltExtCandidates(url) {
  if (!url || typeof url !== 'string') return [];
  const m = url.match(/^(.*)\.([a-zA-Z0-9]+)(\?.*)?$/);
  if (!m) return [];
  const base = m[1];
  const ext = (m[2] || '').toLowerCase();
  const qs = m[3] || '';
  const alts = [];
  const push = (e) => alts.push(`${base}.${e}${qs}`);
  if (ext === 'webp') { push('png'); push('jpg'); push('jpeg'); }
  else if (ext === 'png') { push('webp'); push('jpg'); push('jpeg'); }
  else if (ext === 'jpg' || ext === 'jpeg') { push('webp'); push('png'); }
  else { push('webp'); push('png'); }
  return Array.from(new Set(alts)).filter(u => u !== url);
}


const ARCORE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.google.ar.core';
const ARCORE_ALT_URL = 'https://apkpure.com/ru/google-play-services-for-ar-2025/com.google.ar.core';

function getArEnv() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);

  // "Real" Chrome on Android (exclude common alternative browsers + WebViews)
  const hasChrome = /Chrome\/\d+/i.test(ua);
  const isWebView = /\bwv\b/i.test(ua) || (/Version\/\d+/i.test(ua) && hasChrome);
  const isAlt =
    /(EdgA|OPR|YaBrowser|SamsungBrowser|MiuiBrowser|UCBrowser|DuckDuckGo|Brave|Vivaldi|Firefox|FxiOS)/i.test(ua);

  const isChrome = isAndroid && hasChrome && !isWebView && !isAlt;

  return { ua, isAndroid, isChrome, isWebView };
}

function makeChromeIntent(url) {
  const clean = String(url || '').replace(/^https?:\/\//i, '');
  return `intent://${clean}#Intent;scheme=https;package=com.android.chrome;end`;
}

function openInChrome(url) {
  const target = url || window.location.href;
  try {
    window.location.href = makeChromeIntent(target);
  } catch (e) {
    // fallback: just open normally
    window.location.href = target;
  }
}

function openArcoreInstall() {

  // Try market:// first (opens Play Store app), fallback to https
  try {
    window.location.href = 'market://details?id=com.google.ar.core';
    setTimeout(() => {
      window.open(ARCORE_PLAY_URL, '_blank');
    }, 700);
  } catch (e) {
    window.open(ARCORE_PLAY_URL, '_blank');
  }
}


function openArcoreAlt() {
  try {
    window.open(ARCORE_ALT_URL, '_blank');
  } catch (e) {
    window.location.href = ARCORE_ALT_URL;
  }
}

function ensureArHelpUI() {
  if (document.getElementById('arHelpModalOverlay')) return;

  // styles
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

  // modal
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
  overlay.querySelector('#arHelpBtnChrome').addEventListener('click', () => openInChrome(window.location.href));
  overlay.querySelector('#arHelpBtnArcorePlay').addEventListener('click', openArcoreInstall);
  overlay.querySelector('#arHelpBtnArcoreAlt').addEventListener('click', openArcoreAlt);
}

function showArHelp(kind, err) {
  ensureArHelpUI();

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
      return showArHelp('CAMERA_DENIED', err);
    }
    if (name === 'NotSupportedError') {
      return showArHelp('AR_NOT_SUPPORTED', err);
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

function updateArEntryUI() {
  const env = getArEnv();
  const btn = UI?.btnViewAR;
  if (!btn) return;

  // Remove old hint if any
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
      // Insert right after the AR button
      btn.parentElement?.appendChild(hint);
      hint.querySelector('#btnOpenInChrome')?.addEventListener('click', () => openInChrome(window.location.href));
    } else {
      hint.style.display = '';
    }
  } else {
    btn.classList.remove('arBlocked');
    btn.removeAttribute('aria-disabled');
    if (hint) hint.style.display = 'none';
  }
}

async function startAR() {
  if (state._startingAR) return;
  state._startingAR = true;
  try {

  const env = getArEnv();
  if (env.isAndroid && !env.isChrome) {
    showArHelp('NEED_CHROME');
    return;
  }

  if (!navigator.xr) {
    showArHelp('NO_WEBXR');
    return;
  }
  const supported = await checkXrSupport();
  if (!supported) {
    showArHelp('AR_NOT_SUPPORTED');
    return;
  }

  const wantsDepth = !!UI.toggleOcclusion?.checked;
  const canRequestDepth = wantsDepth && (typeof XRWebGLBinding !== 'undefined');

  const sessionInit = {
    requiredFeatures: ['hit-test', 'dom-overlay'],
    optionalFeatures: ['anchors', ...(canRequestDepth ? ['depth-sensing'] : [])],
    domOverlay: { root: UI.overlay },
    ...(canRequestDepth ? {
      depthSensing: {
        usagePreference: ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
    } : {}),
  };

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', sessionInit);
  } catch (e) {
    console.error(e);
    showArHelp('AR_START_FAILED', e);
    return;
  }

  state.xrSession = session;
  // XR increases memory/decoder pressure; reduce parallelism while active.
  try { updateTexLoadMaxParallel(); } catch (_) {}
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  state.referenceSpace = await session.requestReferenceSpace('local');
  state.viewerSpace = await session.requestReferenceSpace('viewer');

  state.hitTestSource = await session.requestHitTestSource({ space: state.viewerSpace });

  // IMPORTANT:
  // In the reference app, points are placed ONLY by pressing the on-screen "+" button
  // (using the reticle / center hit-test). We intentionally do NOT place points on
  // general screen taps (XR "select"), to avoid accidental points.
  state.transientHitTestSource = null;
  state.transientHitPoses = new Map();

  // floor scan
  state.floorSamples = [];
  state.floorYEstimate = null;
  state.floorStable = false;
  state._onXRSelect = null;

  // anchors
  state.anchorsSupported = typeof session.requestAnchor === 'function';

  // depth
  state.depthSupported = false;
  state.occlusionEnabled = false;
  try {
    const enabled = session.enabledFeatures ? Array.from(session.enabledFeatures) : [];
    state.depthSupported = enabled.includes('depth-sensing');
  } catch (_) {}

  session.addEventListener('end', () => {
    cleanupXR();
  });

  // enter AR UI
  setActiveScreen('ar');
  state.phase = 'ar_scan';
  resetAll(false); // всегда начинаем с нового сканирования
  UI.scanHint.classList.remove('hidden');
  show(UI.scanHint, true);

  // grid visible while scanning
  scanGrid.visible = true;

  // Hide desktop preview objects in AR (they otherwise appear floating)
  previewPlane.visible = false;
  previewGrid.visible = false;

  // Show bottom pattern strip in AR (like in the native app)
  show(UI.finalBar, true);
  show(UI.finalColors, false);
  updateArBottomStripVar();
  // main add button area visible at start
  show(UI.arBottomCenter, false);
  show(UI.btnArAdd, false);
  show(UI.btnArOk, false);
  } finally {
    state._startingAR = false;
  }
}

function cleanupXR() {
  state.xrSession = null;
  // Restore adaptive parallelism for non-XR mode.
  try { updateTexLoadMaxParallel(); } catch (_) {}
  state.referenceSpace = null;
  state.viewerSpace = null;
  state.hitTestSource = null;
  state.transientHitTestSource = null;
  state.transientHitPoses = new Map();

  // depth
  state.depthSupported = false;
  state.depthInfoSize = null;
  state.depthTexture = null;
  state.depthData = null;

  // reset floor scan state when leaving AR so the next start begins from scanning
  state.floorLocked = false;
  state.floorStable = false;
  state.floorY = 0;
  state.floorSamples = [];
  state.floorYEstimate = null;


  reticle.visible = false;
  scanGrid.visible = false;

  // Restore desktop preview objects
  previewPlane.visible = true;
  previewGrid.visible = true;

  // UI
  // close shape picker if open
  try { setShapePickerOpen(false); } catch (_) {}
  // UI
  if (!state._restartingAR) {
    setActiveScreen('detail');
    state.phase = 'detail';
  }
}

async function stopAR() {
  const s = state.xrSession;
  if (!s) return;
  try {
    if (state._onXRSelect) s.removeEventListener('select', state._onXRSelect);
  } catch (_) {}
  try { await s.end(); } catch (_) {}
}


async function fullRestartAR() {
  // Full restart of the AR session to guarantee a clean scan/placement cycle
  if (state._startingAR || state._restartingAR) return;

  state._restartingAR = true;

  // Disable controls during restart (prevents double clicks)
  try {
    UI.btnArReset?.setAttribute('disabled', '');
    UI.btnArAdd?.setAttribute('disabled', '');
    UI.btnArOk?.setAttribute('disabled', '');
    UI.btnDone?.setAttribute('disabled', '');
  } catch (_) {}

  // End current session (if any) and wait until it is fully cleaned up
  const s = state.xrSession;
  if (s) {
    await new Promise((resolve) => {
      const onEnd = () => resolve();
      try { s.addEventListener('end', onEnd, { once: true }); } catch (_) {}
      try { s.end().catch(() => resolve()); } catch (_) { resolve(); }
      // Safety: never hang forever
      setTimeout(resolve, 1200);
    });
  }

  // Now start again (startAR always resets and begins from scanning)
  try {
    await startAR();
  } finally {
    state._restartingAR = false;
    try {
      UI.btnArReset?.removeAttribute('disabled');
      UI.btnArAdd?.removeAttribute('disabled');
      UI.btnArOk?.removeAttribute('disabled');
      UI.btnDone?.removeAttribute('disabled');
    } catch (_) {}
  }
}

// ------------------------
// Floor lock + points
// ------------------------
function ensureFloorLocked() {
  if (state.floorLocked) return;
  if (!reticle.visible) return;
  state.floorLocked = true;
  state.floorY = reticle.position.y;

  // lock scanning grid to the floor (and then hide it — it is only for scanning)
  scanGrid.position.set(reticle.position.x, state.floorY + 0.001, reticle.position.z);
  scanGrid.visible = false;

  // hide scan hint
  show(UI.scanHint, false);
  state.phase = 'ar_draw';
}

function addPointAtWorld(worldPos) {
  if (!state.xrSession) return;

  // auto-lock floor on first action
  ensureFloorLocked();
  if (!state.floorLocked) return;

  // Clamp on floor
  const hitWorld = worldPos.clone();
  hitWorld.y = state.floorY;

  // Convert to local space (anchorGroup)
  const local = anchorGroup.worldToLocal(hitWorld);

  // If cutting a hole
  if (state.phase === 'ar_cut') {
    addHolePointLocal(local);
    return;
  }

  // protect duplicates
  if (state.points.length) {
    const d = distXZ(state.points[state.points.length - 1], local);
    if (d < 0.04) return;
  }

  // magnet close
  if (!state.closed && state.points.length >= 3) {
    const d0 = distXZ(state.points[0], local);
    if (d0 < SNAP_DIST_M) {
      closeContour();
      return;
    }
  }

  state.points.push(local);
  state.closed = false;
  rebuildMarkersAndLine(false);
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';
  show(UI.finalColors, false);
  updateArBottomStripVar();
  rebuildFill();
  updateAreaUI();

  if (state.points.length >= 3) show(UI.btnArOk, true);
}

function addPointFromReticle() {
  if (!state.xrSession) return;
  if (!state.floorLocked || state.phase === 'ar_scan') return;
  if (!reticle.visible) return;
  addPointAtWorld(reticle.position);
}

function addHolePointLocal(local) {
  // local already clamped to floor
  if (state.holePoints.length) {
    const d = distXZ(state.holePoints[state.holePoints.length - 1], local);
    if (d < 0.04) return;
  }

  if (state.holePoints.length >= 3) {
    const d0 = distXZ(state.holePoints[0], local);
    if (d0 < SNAP_DIST_M) {
      closeHole();
      return;
    }
  }

  state.holePoints.push(local);
  rebuildMarkersAndLine(state.closed);
  rebuildFill();
  updateAreaUI();

  if (state.holePoints.length >= 3) show(UI.btnArOk, true);
}

function closeHole() {
  if (state.holePoints.length < 3) return;
  // store hole and exit cut mode
  state.holes.push(state.holePoints.map(p => p.clone()));
  state.holePoints = [];
  state.phase = 'ar_mask';
  // hide cutout hint and restore default scan hint text
  try {
    const t = UI.scanHint?.querySelector('.scanTitle');
    const s = UI.scanHint?.querySelector('.scanText');
    if (t) t.textContent = 'СКАНИРУЙТЕ ПОВЕРХНОСТЬ';
    if (s) {
      s.textContent = 'Плавно двигайте телефон влево-вправо и направляйте камеру на пол. Разметка работает после фиксации плоскости.';
    }
  } catch (_) {}
  show(UI.scanHint, false);
  show(UI.btnArOk, false);
  show(UI.btnArAdd, false);
  show(UI.arBottomCenter, false);
  show(UI.postCloseBar, true);
  show(UI.finalColors, false);
  updateArBottomStripVar();
  rebuildFill();
  updateAreaUI();
}

function closeContour() {
  if (state.points.length < 3) return;
  state.closed = true;
  state.phase = 'ar_mask';

  rebuildMarkersAndLine(true);
  rebuildFill();
  updateAreaUI();

  // UI
  show(UI.btnArAdd, false);
  show(UI.btnArOk, false);
  show(UI.arBottomCenter, false);
  show(UI.postCloseBar, true);
  show(UI.finalColors, false);
  updateArBottomStripVar();
} 


function resetAll(keepFloor = false) {
  state.points = [];
  state.holes = [];
  state.holePoints = [];
  state.closed = false;

  if (!keepFloor) {
    state.floorLocked = false;
    state.floorY = 0;
    // floor stabilization state (may exist depending on build)
    if ('floorSamples' in state) state.floorSamples = [];
    if ('floorYEstimate' in state) state.floorYEstimate = null;
    if ('floorStable' in state) state.floorStable = false;

    state.phase = 'ar_scan';
    show(UI.scanHint, true);
    if (typeof scanGrid !== 'undefined' && scanGrid) scanGrid.visible = true;
  } else {
    state.phase = state.xrSession ? (state.floorLocked ? 'ar_draw' : 'ar_scan') : state.phase;
  }

  // remove line/fill and markers
  pointsGroup.clear();

  if (line) {
    anchorGroup.remove(line);
    disposeObject3D(line);
    line = null;
  }

  if (fillMesh) {
    anchorGroup.remove(fillMesh);
    fillMesh.geometry.dispose();
    // material is shared shader; don't dispose here
    fillMesh = null;
  }

  clearMeasureLabels();

  // UI
  show(UI.postCloseBar, false);
  // Bottom strip: keep patterns available in AR; colors appear only after "Готово"
  if (state.xrSession) {
    show(UI.finalBar, true);
    show(UI.finalColors, false);
  } else {
    show(UI.finalBar, false);
  }

  const inScan = (state.phase === 'ar_scan' && !state.floorLocked);
  show(UI.arBottomCenter, !inScan);
  show(UI.btnArAdd, !inScan);
  show(UI.btnArOk, false);

  // restore guides visibility (they may be hidden in final mode)
  pointsGroup.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';

  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar();
  updateAreaUI();
}



// ------------------------
// Markers / line / fill
// ------------------------
function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse?.((n) => {
    if (n.geometry) n.geometry.dispose?.();
    if (n.material) {
      if (Array.isArray(n.material)) n.material.forEach(m => m.dispose?.());
      else n.material.dispose?.();
    }
  });
}

// "Флажок" как в OZON: заметный маркер на полу (с большой hit-зоной)
function createFlagMarker({
  baseColor = 0xffffff,
  ringColor = 0x2f6cff,
  poleColor = 0xffffff,
  withRing = false,
} = {}) {
  const g = new THREE.Group();
  g.name = 'flagMarker';

  // --- Визуал маркера ближе к OZON: ободок + белый центр + короткий шток ---
  // Лёгкая тень на полу (чтобы было читаемо на светлой поверхности)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.034, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shadow.position.y = 0.0005;
  g.add(shadow);

  // Белый центр
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(0.0165, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: baseColor })
  );
  disk.position.y = 0.001;
  g.add(disk);

  // Синий ободок (всегда присутствует)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.0188, 0.0285, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.95, depthWrite: false })
  );
  ring.name = 'baseRing';
  ring.position.y = 0.0011;
  g.add(ring);

  // Дополнительное подсвечивающее кольцо (для первой точки/«магнита»)
  if (withRing) {
    const firstRing = new THREE.Mesh(
      new THREE.RingGeometry(0.030, 0.052, 44).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.55, depthWrite: false })
    );
    firstRing.name = 'firstRing';
    firstRing.position.y = 0.0012;
    g.add(firstRing);
  }

  // Короткий "штырь" (шток) — чуть выше и тоньше, как в референсе
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0024, 0.0024, 0.16, 12),
    new THREE.MeshBasicMaterial({ color: poleColor, transparent: true, opacity: 0.95 })
  );
  pole.position.y = 0.08;
  g.add(pole);

  // Небольшая "головка" сверху
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.0065, 16, 12),
    new THREE.MeshBasicMaterial({ color: poleColor, transparent: true, opacity: 0.95 })
  );
  top.position.y = 0.16;
  g.add(top);

  // Большая невидимая hit-зона (на будущее для редактирования)
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false })
  );
  hit.name = 'hit';
  hit.position.y = 0.06;
  g.add(hit);

  // Visibility tweak: enlarge marker by 30% (no AR logic changes)
  g.scale.setScalar(1.3);

  return g;
}

function rebuildThickLine(closed = false) {
  // Remove previous
  if (line) {
    anchorGroup.remove(line);
    disposeObject3D(line);
    line = null;
  }

  const pts = state.points.slice();
  if (pts.length < 2) return;

  const drawPts = pts.slice();
  if (closed) drawPts.push(pts[0].clone());

  const group = new THREE.Group();
  group.name = 'polyLine';
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const radius = 0.0045; // толщина линий как в OZON (видно на улице)

  for (let i = 0; i < drawPts.length - 1; i++) {
    const a = drawPts[i];
    const b = drawPts[i + 1];
    const len = distXZ(a, b);
    if (len < 1e-6) continue;

    const mid = new THREE.Vector3((a.x + b.x) / 2, state.floorY + 0.008, (a.z + b.z) / 2);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), mat);
    cyl.position.copy(mid);

    // orient cylinder along segment on XZ
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cyl.quaternion.copy(quat);

    group.add(cyl);
  }

  line = group;
  anchorGroup.add(line);
}
function rebuildMarkersAndLine(closed = false) {
  pointsGroup.clear();

  // Флажки вместо "точек" — как в референсе OZON
  const allOuter = state.points;
  allOuter.forEach((p, i) => {
    const flag = createFlagMarker({ withRing: i === 0 });
    flag.position.copy(p);
    pointsGroup.add(flag);
  });

  // Hole markers (in cut mode)
  if (state.phase === 'ar_cut') {
    state.holePoints.forEach((p, i) => {
      const flag = createFlagMarker({
        baseColor: 0x5aa7ff,
        ringColor: 0x5aa7ff,
        poleColor: 0xffffff,
        withRing: i === 0,
      });
      flag.name = 'holeFlagMarker';
      flag.position.copy(p);
      pointsGroup.add(flag);
    });
  }

  // Толстые линии контура (хорошо видно в светлую погоду)
  rebuildThickLine(closed);
}

function rebuildFill() {
  if (fillMesh) {
    anchorGroup.remove(fillMesh);
    fillMesh.geometry.dispose();
    fillMesh = null;
  }

  const isClosed = state.closed && state.points.length >= 3;
  if (!isClosed) return;

  // IMPORTANT:
  // THREE.Shape/ShapeGeometry is generated in the XY plane.
  // We later rotate it onto XZ with rotateX(-PI/2). That rotation maps
  // original "Y" -> "-Z". If we used (x, z) directly, the resulting mesh
  // would be mirrored on Z and appear in the wrong place after pressing
  // "Готово".
  // So we pre-flip the second component: (x, -z), then after rotation we
  // get final Z == +z, matching the polyline markers exactly.
  const pts2 = state.points.map(p => new THREE.Vector2(p.x, -p.z));
  const shape = new THREE.Shape(pts2);

  // holes
  for (const hole of state.holes) {
    if (hole.length < 3) continue;
    const hp2 = hole.map(p => new THREE.Vector2(p.x, -p.z));
    const path = new THREE.Path(hp2);
    shape.holes.push(path);
  }

  const geom = new THREE.ShapeGeometry(shape, 1);
  geom.rotateX(-Math.PI / 2);

  // lift a bit to avoid z-fighting
  const baseY = state.floorY;
  geom.translate(0, baseY + 0.002, 0);

  const mat = (state.phase === 'ar_final') ? tileMaterial : maskMaterial;
  if (!mat) return;

  fillMesh = new THREE.Mesh(geom, mat);
  fillMesh.renderOrder = 2;
  anchorGroup.add(fillMesh);
}

// ------------------------
// Measurements overlay
// ------------------------
const measureEls = [];

function clearMeasureLabels() {
  measureEls.splice(0, measureEls.length);
  if (UI.measureLayer) UI.measureLayer.innerHTML = '';
}

function ensureMeasureEl(i) {
  if (!UI.measureLayer) return null;
  if (measureEls[i]) return measureEls[i];
  const el = document.createElement('div');
  el.className = 'measureLabel';
  UI.measureLayer.appendChild(el);
  measureEls[i] = el;
  return el;
}

function updateMeasureLabels(xrCam) {
  if (state.phase === 'ar_final') {
    clearMeasureLabels();
    return;
  }
  if (!state.floorLocked) {
    clearMeasureLabels();
    return;
  }

  const pts = state.points;
  if (pts.length < 2) {
    clearMeasureLabels();
    return;
  }

  const segCount = state.closed ? pts.length : (pts.length - 1);

  // remove extra
  for (let i = segCount; i < measureEls.length; i++) {
    measureEls[i]?.remove();
  }
  measureEls.length = segCount;

  const w = window.innerWidth;
  const h = window.innerHeight;

  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = distXZ(a, b);

    const mid = new THREE.Vector3((a.x + b.x) / 2, state.floorY + 0.02, (a.z + b.z) / 2);
    const midW = anchorGroup.localToWorld(mid.clone());

    const v = midW.clone().project(xrCam);
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;

    const el = ensureMeasureEl(i);
    if (!el) continue;

    const visible = v.z >= -1 && v.z <= 1;
    el.style.display = visible ? 'block' : 'none';
    el.textContent = fmtMeters(d);
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }
}

function updateAreaUI() {
  if (!UI.arArea) return;

  const areaText = (state.points.length >= 3) ? fmtArea(computeAreaM2()) : '—';

  // In final visualization, show only total area in the header (less distraction)
  if (state.phase === 'ar_final') {
    if (UI.arProductTitle) UI.arProductTitle.textContent = `Площадь: ${areaText}`;
    UI.arArea.textContent = '';
    return;
  }

  // Otherwise show product name + current area (as in the reference flow)
  if (UI.arProductTitle && state.selectedTile) UI.arProductTitle.textContent = state.selectedTile.name;
  UI.arArea.textContent = state.closed ? fmtArea(computeAreaM2()) : areaText;
}

// ------------------------
// XR frame update
// ------------------------
const __tmpUp = new THREE.Vector3();
const __tmpCamPos = new THREE.Vector3();
const __tmpFwd = new THREE.Vector3();

function updateXR(frame) {
  // Center hit test (used mainly to estimate floor height while scanning)
  let gotHit = false;
  let hitY = null;

  if (state.hitTestSource && state.referenceSpace) {
    const hits = frame.getHitTestResults(state.hitTestSource);
    if (hits.length) {
      const pose = hits[0].getPose(state.referenceSpace);
      if (pose) {
        reticle.matrix.fromArray(pose.transform.matrix);
        reticle.matrix.decompose(reticle.position, reticle.quaternion, reticle.scale);

        // Filter out obviously non-horizontal hits using the reported orientation
        __tmpUp.set(0, 1, 0).applyQuaternion(reticle.quaternion);
        if (__tmpUp.y >= 0.75) {
          gotHit = true;
          hitY = reticle.position.y;
        } else {
          gotHit = false;
        }
      }
    }
  }

  // During scanning: accumulate floor Y samples only when the camera is pitched down
  if (!state.floorLocked && state.phase === 'ar_scan' && gotHit && hitY != null) {
    const xrCam = renderer.xr.getCamera(camera);
    const cam = xrCam.cameras && xrCam.cameras.length ? xrCam.cameras[0] : xrCam;
    __tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);

    if (__tmpFwd.y < -0.15) {
      state.floorSamples.push(hitY);
      if (state.floorSamples.length > 40) state.floorSamples.shift();

      const sorted = state.floorSamples.slice().sort((a, b) => a - b);
      const p = (q) => {
        if (!sorted.length) return null;
        const pos = (sorted.length - 1) * q;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        const t = pos - lo;
        return sorted[lo] * (1 - t) + sorted[hi] * t;
      };

      const p20 = p(0.20);
      const p80 = p(0.80);
      state.floorYEstimate = p20;

      // Consider floor stable when spread is small and enough samples collected
      const spread = (p80 != null && p20 != null) ? (p80 - p20) : 999;
      if ((sorted.length >= 12 && spread < 0.04) || sorted.length >= 25) {
        state.floorLocked = true;
        state.floorStable = true;
        state.floorY = p20;

        // Switch to drawing phase (match app: + appears after scanning/floor lock)
        state.phase = 'ar_draw';
        show(UI.scanHint, false);
        show(UI.arBottomCenter, true);
        show(UI.btnArAdd, true);
        show(UI.btnArOk, false);
      }
    }
  }

  // Reticle placement: ALWAYS project to the active floor plane (prevents "sticking" to walls)
  const activeY = state.floorLocked ? state.floorY : (state.floorYEstimate != null ? state.floorYEstimate : hitY);
  const xrCam2 = renderer.xr.getCamera(camera);
  const cam2 = xrCam2.cameras && xrCam2.cameras.length ? xrCam2.cameras[0] : xrCam2;

  __tmpCamPos.setFromMatrixPosition(cam2.matrixWorld);
  __tmpFwd.set(0, 0, -1).applyQuaternion(cam2.quaternion);

  let reticleOk = false;
  if (activeY != null && __tmpFwd.y < -0.02) {
    const t = (activeY - __tmpCamPos.y) / __tmpFwd.y;
    if (t > 0.05 && t < 12.0) {
      reticle.position.copy(__tmpCamPos).addScaledVector(__tmpFwd, t);
      reticle.position.y = activeY;
      reticle.quaternion.set(0, 0, 0, 1); // keep flat
      reticle.visible = true;
      reticleOk = true;
    }
  }
  if (!reticleOk) reticle.visible = false;

  // Scan grid: show only while scanning AND only when we have a valid projected reticle
  if (!state.floorLocked && state.phase === 'ar_scan') {
    scanGrid.visible = reticle.visible;
    if (scanGrid.visible) {
      scanGrid.position.set(reticle.position.x, activeY + 0.001, reticle.position.z);
      scanGrid.rotation.set(0, 0, 0);
    }
  } else {
    scanGrid.visible = false;
  }

  // If floor is locked, clamp reticle exactly to floorY (extra safety)
  if (state.floorLocked && reticle.visible) {
    reticle.position.y = state.floorY;
  }


  // transient hit results
  if (state.transientHitTestSource && state.referenceSpace) {
    try {
      state.transientHitPoses.clear();
      const transientResults = frame.getHitTestResultsForTransientInput(state.transientHitTestSource);
      for (const tr of transientResults) {
        if (!tr.results || !tr.results.length) continue;
        const pose = tr.results[0].getPose(state.referenceSpace);
        if (!pose) continue;

        const q = new THREE.Quaternion(
          pose.transform.orientation.x,
          pose.transform.orientation.y,
          pose.transform.orientation.z,
          pose.transform.orientation.w
        );
        __tmpUp.set(0, 1, 0).applyQuaternion(q);
        if (__tmpUp.y < 0.75) continue;

        state.transientHitPoses.set(tr.inputSource, pose);
      }
    } catch (_) {}
  }

  // magnet highlight
  state.snapArmed = false;
  if (state.floorLocked && !state.closed && state.phase === 'ar_draw' && state.points.length >= 3 && reticle.visible) {
    const wpos = reticle.position.clone(); wpos.y = state.floorY;
    const loc = anchorGroup.worldToLocal(wpos);
    const d0 = distXZ(state.points[0], loc);
    state.snapArmed = d0 < SNAP_DIST_M;
  }
  if (reticle.material?.color) {
    reticle.material.color.setHex(state.snapArmed ? 0x36d399 : 0x2f6cff);
  }
  // "firstRing" теперь находится внутри флажка (вложенный объект)
  let firstRing = null;
  pointsGroup.traverse((o) => {
    if (!firstRing && o.name === 'firstRing') firstRing = o;
  });
  if (firstRing?.material?.color) {
    firstRing.material.color.setHex(state.snapArmed ? 0x36d399 : 0x2f6cff);
  }

  state.reticleVisible = gotHit;
  if (!gotHit) reticle.visible = false;

  // Keep scan grid only when we have a valid floor hit before the floor is locked
  if (!state.floorLocked) {
    scanGrid.visible = !!gotHit;
  } else {
    scanGrid.visible = false;
  }

  // depth (best-effort)
  if (state.xrSession && state.depthSupported) {
    const views = frame.getViewerPose(state.referenceSpace)?.views;
    if (views && views.length) {
      try {
        const depthInfo = frame.getDepthInformation?.(views[0]);
        if (depthInfo && depthInfo.width && depthInfo.height && depthInfo.data) {
          const w = depthInfo.width, h = depthInfo.height;
          const key = `${w}x${h}`;
          if (!state.depthInfoSize || state.depthInfoSize !== key) {
            state.depthInfoSize = key;
            state.depthData = new Float32Array(w * h);
            state.depthTexture = new THREE.DataTexture(state.depthData, w, h, THREE.RedFormat, THREE.FloatType);
            state.depthTexture.needsUpdate = true;
            state.depthTexture.magFilter = THREE.NearestFilter;
            state.depthTexture.minFilter = THREE.NearestFilter;
            if (tileMaterial) {
              tileMaterial.uniforms.uDepthTex.value = state.depthTexture;
              tileMaterial.uniforms.uDepthValid.value = 1;
            }
          }

          const raw = depthInfo.data;
          const scale = depthInfo.rawValueToMeters || 1.0;
          const u16 = new Uint16Array(raw);
          const n = Math.min(u16.length, state.depthData.length);
          for (let i = 0; i < n; i++) state.depthData[i] = u16[i] * scale;
          state.depthTexture.needsUpdate = true;

          // occlusion toggle
          state.occlusionEnabled = !!UI.toggleOcclusion?.checked;
          if (tileMaterial) tileMaterial.uniforms.uUseOcclusion.value = state.occlusionEnabled ? 1 : 0;
        } else {
          if (tileMaterial) tileMaterial.uniforms.uDepthValid.value = 0;
        }
      } catch (_) {
        if (tileMaterial) tileMaterial.uniforms.uDepthValid.value = 0;
      }
    }
  }

  // UI measure labels
  const xrCam = renderer.xr.getCamera(camera);
  updateMeasureLabels(xrCam);
}

// ------------------------
// Events
// ------------------------
// UI clicks should not place points
UI.overlay?.addEventListener('pointerdown', (e) => {
  if (!state.xrSession) return;
  state.lastUiTapTs = performance.now();
}, true);

UI.catalogSearch?.addEventListener('input', () => {
  const q = UI.catalogSearch.value.trim().toLowerCase();
  if (!q) renderCatalog(state.shapes);
  else renderCatalog(state.shapes.filter(s => (s.name || '').toLowerCase().includes(q)));
});

UI.btnDetailBack?.addEventListener('click', () => {
  setActiveScreen('catalog');
  state.phase = 'catalog';
});

// Аккордеон характеристик (по умолчанию скрыто)
UI.btnTechToggle?.addEventListener('click', (e) => {
  e.preventDefault();
  if (UI.detailTechCard?.hidden) return;
  UI.techBody.hidden = false;
  UI.btnTechToggle.hidden = true;
});

UI.btnTechClose?.addEventListener('click', (e) => {
  e.preventDefault();
  UI.techBody.hidden = true;
  UI.btnTechToggle.hidden = false;
});
UI.btnViewAR?.addEventListener('click', async (ev) => {
  const env = getArEnv();
  if (env.isAndroid && !env.isChrome) {
    // Do not start AR outside Chrome on Android
    showArHelp('NEED_CHROME');
    return;
  }
  await startAR();
});

UI.btnArBack?.addEventListener('click', async () => {
  await stopAR();
});

UI.btnArReset?.addEventListener('click', async () => {
  await fullRestartAR();
});

UI.btnArAdd?.addEventListener('click', () => {
  addPointFromReticle();
});

UI.btnArOk?.addEventListener('click', () => {
  if (state.phase === 'ar_cut') closeHole();
  else closeContour();
});

UI.btnEditShape?.addEventListener('click', () => {
  // return to drawing mode, keep points
  show(UI.finalColors, false);
  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar();

  state.closed = false;
  state.phase = 'ar_draw';
  // In the reference app, changing the outer shape resets any existing cutouts.
  state.holes = [];
  state.holePoints = [];

  show(UI.postCloseBar, false);
  show(UI.btnArAdd, true);
  show(UI.btnArOk, state.points.length >= 3);
  show(UI.arBottomCenter, true);

  rebuildMarkersAndLine(false);
  // restore guides (they may be hidden after "Готово")
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';

  if (fillMesh) { anchorGroup.remove(fillMesh); fillMesh.geometry.dispose(); fillMesh = null; }
  clearMeasureLabels();
  updateAreaUI();
});

UI.btnCutout?.addEventListener('click', () => {
  // cutout mode
  show(UI.finalColors, false);
  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar();

  state.phase = 'ar_cut';
  state.holePoints = [];

  show(UI.postCloseBar, false);
  show(UI.btnArAdd, true);
  show(UI.btnArOk, false);
  show(UI.arBottomCenter, true);

  // show hint
  UI.scanHint.querySelector('.scanTitle').textContent = 'СДЕЛАЙТЕ ВЫРЕЗ';
  UI.scanHint.querySelector('.scanText').textContent = 'Поставьте точки внутри области. Замкните контур рядом с первой точкой.';
  show(UI.scanHint, true);

  rebuildMarkersAndLine(true);
  // restore guides
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';
});

UI.btnDone?.addEventListener('click', () => {
  state.phase = 'ar_final';
  show(UI.postCloseBar, false);
  show(UI.arBottomCenter, false);
  show(UI.finalBar, true);
  show(UI.finalColors, true);

  // Hide guides (points/lines/distances) in final visualization
  pointsGroup.visible = false;
  if (line) line.visible = false;
  if (UI.measureLayer) UI.measureLayer.style.display = 'none';
  clearMeasureLabels();
  updateArBottomStripVar();

  rebuildFill();
  updateAreaUI();

  // Build bottom controls (layout): single cycle button
  state.layoutCycleInitial = state.layout;
  state.layoutCycleStep = 0;
  if (UI.btnLayoutCycle) {
    UI.btnLayoutCycle.onclick = () => {
      const step = state.layoutCycleStep % 3;
      if (step === 0) {
        setLayout('straight');
        state.layoutCycleStep = 1;
      } else if (step === 1) {
        setLayout('diagonal');
        state.layoutCycleStep = 2;
      } else {
        setLayout(state.layoutCycleInitial);
        state.layoutCycleStep = 0;
      }
    };
  }
  setLayout(state.layout);

  // Shape picker (open side menu to switch shape)
  if (UI.btnShapePicker) {
    UI.btnShapePicker.onclick = () => {
      if (!UI.shapePickerPanel || !UI.shapePickerList) return;
      if (!UI.shapePickerPanel.hasAttribute('data-built')) {
        try { buildShapePickerList(); } catch (e) { console.warn('shape picker build failed', e); }
        UI.shapePickerPanel.setAttribute('data-built', '1');
      }
      setShapePickerOpen(UI.shapePickerPanel.hidden);
    };
  }
  if (UI.shapePickerBackdrop) {
    UI.shapePickerBackdrop.onclick = () => setShapePickerOpen(false);
  }

  renderColorRow(UI.finalColors, (Array.isArray(state.currentAllowedTiles) && state.currentAllowedTiles.length ? state.currentAllowedTiles : state.tiles.slice(0, 8)));

  // hide hint
  show(UI.scanHint, false);
});

window.addEventListener('resize', () => {
  if (state.xrSession) {
    updateArTopStripVar();
    updateArBottomStripVar();
  } else {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------
// Main
// ------------------------
async function init() {
  const data = await loadTiles();
  state.tiles = data.tiles || [];

  // load формы
  try {
    const shapesData = await loadShapes();
    state.shapes = shapesData.shapes || [];
    try { buildShapePickerList(); } catch (e) {}
  } catch (e) {
    console.warn('shapes.json не найден или повреждён — используем плитки как каталог', e);
    // fallback: каждая плитка как отдельная "форма"
    state.shapes = state.tiles.map(t => ({
      id: String(t.id),
      name: t.name,
      icon: t.preview,
      hero: t.preview,
      tileIds: [t.id],
      tech: { 'Размер': `${t.tileSizeM.w.toFixed(2)}×${t.tileSizeM.h.toFixed(2)} м` },
    }));
    try { buildShapePickerList(); } catch (e) {}
  }

  // initial
  renderCatalog(state.shapes);
  setActiveScreen('catalog');
  state.phase = 'catalog';

  // choose default tile
  const defaultId = state.tiles[0]?.id;
  if (defaultId) await selectTile(defaultId);

  // AR title
  if (UI.arProductTitle && state.selectedTile) UI.arProductTitle.textContent = state.selectedTile.name;

  // set initial layout
  setLayout('straight');

  // Apply AR entry gating UI (safe on all devices)
  updateArEntryUI();
}

renderer.setAnimationLoop((t, frame) => {
  if (state.xrSession && frame) {
    updateXR(frame);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

init().catch(err => {
  console.error(err);
  alert('Ошибка инициализации: ' + (err?.message || err));
});


// ------------------------
// Shape picker (AR UI)
// ------------------------
function _readCssPxVar(name, fallback = 0) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch (_) {
    return fallback;
  }
}

function _clampShapePickerPanelBounds() {
  try {
    if (!UI.shapePickerPanel) return;
    // Keep the drawer between AR top controls and the bottom bar.
    const top = _readCssPxVar('--ar-top-strip', 56);
    const bottom = _readCssPxVar('--ar-bottom-strip', 0);
    UI.shapePickerPanel.style.top = `${Math.max(56, top)}px`;
    UI.shapePickerPanel.style.bottom = `${Math.max(0, bottom)}px`;
  } catch (_) {}
}

function setShapePickerOpen(open) {
  if (!UI.shapePickerPanel || !UI.shapePickerBackdrop) return;
  if (open) {
    // Ensure the drawer is always clamped between the AR top bar and the bottom controls.
    updateArTopStripVar();
    updateArBottomStripVar();
    _clampShapePickerPanelBounds();
    UI.shapePickerBackdrop.hidden = false;
    UI.shapePickerPanel.hidden = false;
    // allow CSS transition
    requestAnimationFrame(() => {
      // On some mobile browsers the bars resize a moment after UI changes; clamp again.
      updateArTopStripVar();
      updateArBottomStripVar();
      _clampShapePickerPanelBounds();
      UI.shapePickerPanel.classList.add('open');
    });
  } else {
    UI.shapePickerPanel.classList.remove('open');
    UI.shapePickerBackdrop.hidden = true;
    // hide panel after transition
    setTimeout(() => {
      if (!UI.shapePickerPanel.classList.contains('open')) {
        UI.shapePickerPanel.hidden = true;
      }
    }, 210);
  }
}

function buildShapePickerList() {
  if (!UI.shapePickerList) return;
  UI.shapePickerList.innerHTML = '';

  const shapes = Array.isArray(state.shapes) ? state.shapes : [];
  for (const s of shapes) {
    const wrap = document.createElement('div');
    wrap.className = 'shapePickerItem';
    if (state.selectedShape && state.selectedShape.id === s.id) {
      wrap.classList.add('active');
    }

    const btn = document.createElement('button');
    btn.type = 'button';

    // Prefer the same preview image as in the catalog (hero), fallback to icon.
    const icon = (s.hero ? s.hero : (s.icon ? s.icon : ''));
    const name = s.name ? s.name : s.id;

    btn.innerHTML = `
      <div class="shapePickerThumbWrap">
        <img class="shapePickerThumb" src="${icon}" alt="" loading="lazy">
      </div>
      <div class="shapePickerName">${name}</div>
    `;

    btn.addEventListener('click', async () => {
      setShapePickerOpen(false);

      // If already on the same shape — just close.
      if (state.selectedShape && state.selectedShape.id === s.id) return;

      // Safest behavior: stop AR session then open detail of the selected shape.
      try {
        if (state.xrSession) await stopAR();
      } catch (e) {
        console.warn('stopAR failed', e);
      }

      try {
        await openDetail(s.id);
      } catch (e) {
        console.error('openDetail failed', e);
      }
    });

    wrap.appendChild(btn);
    UI.shapePickerList.appendChild(wrap);
  }
}

