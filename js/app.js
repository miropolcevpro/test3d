import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadTiles, loadShapes, clamp, sanitizePalettePayload, reportValidationWarnings, fetchJsonResource, formatResourceError, isMissingResourceError, isRetryableResourceError } from './utils.js';
import { show, setActiveScreen, fmtMeters, fmtArea, updateArBottomStripVar, updateArTopStripVar } from './app-ui-helpers.js';
import { getDirectPaletteUrlForShape, getPaletteCandidateUrlsForShape, paletteItemsToTiles, getTilePreviewUrl, getTileMapUrls, getTileAlbedoCandidates, prefetchImageUrls, renderColorRow, renderGroupedColorRow } from './app-palette-helpers.js';
import { loadSurfacePalette, loadPaletteDefaultsForShape, filterPaletteItemsBySurfaces } from './app-palette-data-helpers.js';
import { renderCatalog, renderDetailHero, renderDetailTech, setShapePickerOpen, buildShapePickerList, buildFallbackShapesFromTiles } from './app-catalog-detail-helpers.js';
import { buildPublishedQuickLaunchItems, renderQuickLaunchRail } from './app-quick-launch-helpers.js';
import { getConnInfo, updateTexLoadMaxParallel, loadTexSmartCached, applyMapToTileMaterial, warmupTextureOnGPU, crossfadeAlbedoOnMaterial, prepMapTex, getFallbackWhiteTex, computeAutoExposureMultFromTexture, withTimeout, loadTileAlbedoWithFallback, getPreferredSurfaceQuality, getSurfaceRuntimeTuning, make2kCandidateUrl, make1kCandidateUrl, makeAltExtCandidates, touchMaterialTextures, trimTextureCaches, disposeWarmupResources } from './app-texture-material-helpers.js';
import { makeTileMaterial } from './app-shader-material-helpers.js';
import { distXZ, computeAreaM2FromContours, rebuildMarkersAndLine, rebuildFillMesh, clearMeasureLabels as clearMeasureLabelsHelper, updateMeasureLabels as updateMeasureLabelsHelper, updateAreaUI as updateAreaUIHelper } from './app-geometry-helpers.js';
import { getArEnv, showArHelp, updateArEntryUI } from './app-ar-entry-helpers.js';
import { createArSessionHelpers } from './app-ar-session-helpers.js';
import { createSelectionHelpers } from './app-selection-helpers.js';

const runtimeConfig = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;

// Remote surface palettes (Object Storage).
// Override by setting window.__SURFACE_PALETTE_BASE_URL__ before loading app.js
const SURFACE_PALETTE_BASE_URL = (runtimeConfig && typeof runtimeConfig.resolveSurfacePaletteBaseUrl === 'function')
  ? runtimeConfig.resolveSurfacePaletteBaseUrl()
  : ((typeof window !== 'undefined' && window.__SURFACE_PALETTE_BASE_URL__)
    ? String(window.__SURFACE_PALETTE_BASE_URL__).replace(/\/+$/, '') + '/'
    : 'https://storage.yandexcloud.net/webar3dtexture/palettes/');

// Remote per-shape palette defaults (safe-fallback).
// Override by setting window.__PALETTE_SETTINGS_BASE_URL__ before loading app.js
const PALETTE_SETTINGS_BASE_URL = (runtimeConfig && typeof runtimeConfig.resolvePaletteSettingsBaseUrl === 'function')
  ? runtimeConfig.resolvePaletteSettingsBaseUrl()
  : ((typeof window !== 'undefined' && window.__PALETTE_SETTINGS_BASE_URL__)
    ? String(window.__PALETTE_SETTINGS_BASE_URL__).replace(/\/+$/, '') + '/'
    : 'https://storage.yandexcloud.net/webar3dtexture/palette_settings/');

// Palette settings are OPTIONAL and are NOT used in the current product flow.
// We keep support for future needs, but disable it by default to avoid
// unnecessary network calls (and noisy 404 logs) when the file is absent.
// To enable, set window.__ENABLE_PALETTE_SETTINGS__ = true before loading app.js.
const ENABLE_PALETTE_SETTINGS = (typeof window !== 'undefined' && window.__ENABLE_PALETTE_SETTINGS__ === true);


// Optional API Gateway base (Admin API) used for reconcile/filtering.
// Set window.__API_BASE_URL__ in index.html before loading app.js, for example:
//   window.__API_BASE_URL__ = 'https://<your_api_gw_id>.apigw.yandexcloud.net';
const API_BASE_URL = (runtimeConfig && typeof runtimeConfig.resolvePublicApiBaseUrl === 'function')
  ? runtimeConfig.resolvePublicApiBaseUrl()
  : ((typeof window !== 'undefined' && window.__API_BASE_URL__)
    ? String(window.__API_BASE_URL__).replace(/\/+$/, '') + '/'
    : '');
const contentIdentity = (typeof window !== 'undefined' && window.__CONTENT_IDENTITY__) ? window.__CONTENT_IDENTITY__ : null;
const _networkFallbackWarned = new Set();
function warnNetworkFallbackOnce(key, ...args) {
  const k = String(key || 'network-fallback');
  if (_networkFallbackWarned.has(k)) return;
  _networkFallbackWarned.add(k);
  console.warn(...args);
}
// Debug overlay flag: enable with ?debugAR=1 (or any truthy value)
const DEBUG_AR_ENABLED = (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    if (!q.has('debugAR')) return false;
    const v = q.get('debugAR');
    return v == null || v === '' || v === '1' || v.toLowerCase() === 'true';
  } catch (_) {
    return false;
  }
})();

// Query flag helper (truthy/falsey). We keep feature flags ONLY for debug sessions.
function readBoolQueryFlag(name, defaultValue = false) {
  try {
    const q = new URLSearchParams(window.location.search);
    if (!q.has(name)) return defaultValue;
    const v = (q.get(name) || '').trim().toLowerCase();
    if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
    return defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

// Plane refinement flag: enable with ?planeRefine=1, disable with ?planeRefine=0. Default: enabled.
const PLANE_REFINE_ENABLED = (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    if (!q.has('planeRefine')) return true;
    const v = (q.get('planeRefine') || '').trim().toLowerCase();
    if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
    return true;
  } catch (_) {
    return true;
  }
})();

// Floor Lock 2.0: internal debug-only toggle. Never affects the main product URL.
const FLOOR_LOCK2_ENABLED = DEBUG_AR_ENABLED && readBoolQueryFlag('lock2', false);

// World Lock via WebXR Anchors API: internal debug-only toggle. Never affects the main product URL.
const WORLD_ANCHORS_ENABLED = DEBUG_AR_ENABLED && readBoolQueryFlag('anchors', false);

// Atomic Texture Apply: now DEFAULT in the product.
// For debug sessions it can be disabled with ?debugAR=1&atomicTex=0.
const ATOMIC_TEX_ENABLED = DEBUG_AR_ENABLED
  ? readBoolQueryFlag('atomicTex', true)
  : true;

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
  quickArRail: document.getElementById('quickArRail'),
  quickArExpanded: document.getElementById('quickArExpanded'),
  quickArStatus: document.getElementById('quickArStatus'),
  btnQuickArToggle: document.getElementById('btnQuickArToggle'),

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
  contourHint: document.getElementById('contourHint'),
  arDebugOverlay: document.getElementById('arDebugOverlay'),
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
  btnTextureRotate: document.getElementById('btnTextureRotate'),
  rotationPanel: document.getElementById('rotationPanel'),
  rotationHint: document.getElementById('rotationHint'),
  btnRotationReset: document.getElementById('btnRotationReset'),
  btnRotateMinus: document.getElementById('btnRotateMinus'),
  btnRotatePlus: document.getElementById('btnRotatePlus'),
  rotationValue: document.getElementById('rotationValue'),
  rotationSlider: document.getElementById('rotationSlider'),
  btnShapePicker: document.getElementById('btnShapePicker'),
  shapePickerBackdrop: document.getElementById('shapePickerBackdrop'),
  shapePickerPanel: document.getElementById('shapePickerPanel'),
  shapePickerList: document.getElementById('shapePickerList'),
  finalColors: document.getElementById('finalColors'),
  btnArSnapshot: document.getElementById('btnArSnapshot'),
  snapshotToast: document.getElementById('snapshotToast'),
  snapshotLogoOverlay: document.getElementById('snapshotLogoOverlay'),
  snapshotDismissLayer: document.getElementById('snapshotDismissLayer'),

  // AR texture load progress
  texLoadStatus: document.getElementById('texLoadStatus'),
  texLoadBarWrap: document.getElementById('texLoadBarWrap'),
  texLoadBar: document.getElementById('texLoadBar'),

  // Hidden tech
  layoutSelect: document.getElementById('layoutSelect'),
  toggleOcclusion: document.getElementById('toggleOcclusion'),
};

// ------------------------

function updateArTopInsetVar() {
  try {
    const root = document.documentElement;
    if (!root) return;
    const vv = window.visualViewport || null;
    const ua = String((navigator && navigator.userAgent) || '');
    const isAndroid = /Android/i.test(ua);
    const isTablet = Math.max(window.innerWidth || 0, window.innerHeight || 0) >= 900;
    const visualOffset = vv ? Math.max(0, Math.round(vv.offsetTop || 0)) : 0;
    let fallback = isAndroid ? 34 : 16;
    if (isTablet) fallback += 4;
    root.style.setProperty('--ar-ui-top-extra', `${Math.max(visualOffset, fallback)}px`);
  } catch (_) {}
}

// ------------------------
// AR: texture load progress indicator (thin bar under pattern buttons)
// ------------------------
const _arTexProgress = { seq: 0, total: 0, done: 0, hideTimer: 0, showTimer: 0, shown: false, shownAt: 0, label: 'Загрузка текстуры…', maps: [] };

function _arTexProgressMapLabel(key, fallback = '') {
  const k = String(key || '').toLowerCase();
  if (k === 'albedo' || k === 'albedo2k') return 'Цвет';
  if (k === 'roughness') return 'Шерох.';
  if (k === 'normal') return 'Рельеф';
  if (k === 'ao') return 'AO';
  if (k === 'height') return 'Height';
  return fallback || key || 'Карта';
}

function _arTexProgressStatusIcon(status) {
  const s = String(status || 'loading');
  if (s === 'loaded' || s === 'ready') return '✓';
  if (s === 'failed') return '✕';
  if (s === 'skipped') return '–';
  return '…';
}

function _arTexProgressIsTerminal(status) {
  const s = String(status || 'loading');
  return s === 'loaded' || s === 'ready' || s === 'failed' || s === 'skipped';
}

function _arTexProgressRecompute(seq) {
  try {
    if (seq !== _arTexProgress.seq) return;
    const maps = Array.isArray(_arTexProgress.maps) ? _arTexProgress.maps : [];
    _arTexProgress.total = Math.max(1, maps.length || Number(_arTexProgress.total) || 1);
    _arTexProgress.done = maps.filter(m => _arTexProgressIsTerminal(m?.status)).length;
    const suffix = maps.length
      ? maps.map(m => `${m.label || _arTexProgressMapLabel(m.key)} ${_arTexProgressStatusIcon(m.status)}`).join(' · ')
      : '';
    const text = suffix ? `${_arTexProgress.label} ${suffix}` : _arTexProgress.label;
    if (UI.texLoadStatus) UI.texLoadStatus.textContent = text;
    if (_arTexProgress.shown && UI.texLoadBar) {
      const pct = Math.max(0, Math.min(100, (_arTexProgress.done / _arTexProgress.total) * 100));
      UI.texLoadBar.style.width = `${pct.toFixed(0)}%`;
    }
    if (_arTexProgress.done >= _arTexProgress.total) _arTexProgressHide(seq);
  } catch (_) {}
}

function _arTexProgressSetLabel(seq, label) {
  try {
    if (seq !== _arTexProgress.seq) return;
    _arTexProgress.label = String(label || 'Загрузка текстуры…');
    _arTexProgressRecompute(seq);
  } catch (_) {}
}

function _arTexProgressStart(seq, mapsOrTotal, opts = {}) {
  try {
    const maps = Array.isArray(mapsOrTotal)
      ? mapsOrTotal.filter(Boolean).map((m, idx) => ({
          key: String(m.key || m.id || `map_${idx}`),
          label: String(m.label || _arTexProgressMapLabel(m.key || m.id || `map_${idx}`)),
          status: String(m.status || 'loading'),
        }))
      : Array.from({ length: Math.max(1, Number(mapsOrTotal) || 1) }, (_, idx) => ({
          key: `step_${idx + 1}`,
          label: `Шаг ${idx + 1}`,
          status: 'loading',
        }));

    _arTexProgress.seq = seq;
    _arTexProgress.maps = maps;
    _arTexProgress.total = Math.max(1, maps.length || 1);
    _arTexProgress.done = maps.filter(m => _arTexProgressIsTerminal(m.status)).length;
    _arTexProgress.shown = false;
    _arTexProgress.shownAt = 0;
    _arTexProgress.label = String(opts.label || 'Загрузка текстуры…');

    if (_arTexProgress.hideTimer) { clearTimeout(_arTexProgress.hideTimer); _arTexProgress.hideTimer = 0; }
    if (_arTexProgress.showTimer) { clearTimeout(_arTexProgress.showTimer); _arTexProgress.showTimer = 0; }

    const showDelayMs = Math.max(0, Number(opts.delayMs ?? 450) || 450);
    _arTexProgress.showTimer = setTimeout(() => {
      try {
        if (seq !== _arTexProgress.seq) return;
        if (_arTexProgress.done >= _arTexProgress.total) return;
        _arTexProgress.showTimer = 0;
        UI.texLoadBar.style.width = '0%';
        show(UI.texLoadBarWrap, true);
        UI.texLoadBarWrap.classList.add('is-visible');
        if (UI.texLoadStatus) show(UI.texLoadStatus, true);
        _arTexProgress.shown = true;
        _arTexProgress.shownAt = Date.now();
        _arTexProgressRecompute(seq);
        updateArBottomStripVar(UI);
      } catch (_) {}
    }, showDelayMs);
  } catch (_) {}
}

function _arTexProgressShow(seq, totalOrMaps, opts = {}) {
  _arTexProgressStart(seq, totalOrMaps, opts);
}

function _arTexProgressShowImmediate(seq, totalOrMaps, opts = {}) {
  try {
    _arTexProgressStart(seq, totalOrMaps, { ...opts, delayMs: 0 });
    if (!UI.texLoadBarWrap || !UI.texLoadBar) return;
    if (_arTexProgress.showTimer) { clearTimeout(_arTexProgress.showTimer); _arTexProgress.showTimer = 0; }
    UI.texLoadBar.style.width = '0%';
    show(UI.texLoadBarWrap, true);
    UI.texLoadBarWrap.classList.add('is-visible');
    if (UI.texLoadStatus) show(UI.texLoadStatus, true);
    _arTexProgress.shown = true;
    _arTexProgress.shownAt = Date.now();
    _arTexProgressRecompute(seq);
    updateArBottomStripVar(UI);
  } catch (_) {}
}

function _arTexProgressMapUpdate(seq, key, status, opts = {}) {
  try {
    if (seq !== _arTexProgress.seq) return;
    const maps = Array.isArray(_arTexProgress.maps) ? _arTexProgress.maps : [];
    const mapKey = String(key || '');
    let entry = maps.find(m => String(m.key) === mapKey);
    if (!entry) {
      entry = { key: mapKey || `map_${maps.length + 1}`, label: String(opts.label || _arTexProgressMapLabel(mapKey)), status: 'loading' };
      maps.push(entry);
      _arTexProgress.maps = maps;
    }
    if (opts.label) entry.label = String(opts.label);
    entry.status = String(status || 'loading');
    _arTexProgressRecompute(seq);
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
    if (_arTexProgress.showTimer) { clearTimeout(_arTexProgress.showTimer); _arTexProgress.showTimer = 0; }
    if (!_arTexProgress.shown) return;
    if (!UI.texLoadBarWrap) return;
    const MIN_VISIBLE_MS = 450;
    const visibleFor = Date.now() - (_arTexProgress.shownAt || Date.now());
    const wait = Math.max(0, MIN_VISIBLE_MS - visibleFor);
    if (_arTexProgress.hideTimer) { clearTimeout(_arTexProgress.hideTimer); _arTexProgress.hideTimer = 0; }
    _arTexProgress.hideTimer = setTimeout(() => {
      try {
        if (seq !== _arTexProgress.seq) return;
        if (UI.texLoadBar) UI.texLoadBar.style.width = '100%';
        UI.texLoadBarWrap.classList.remove('is-visible');
        setTimeout(() => {
          try {
            if (seq !== _arTexProgress.seq) return;
            if (UI.texLoadStatus) show(UI.texLoadStatus, false);
            show(UI.texLoadBarWrap, false);
            updateArBottomStripVar(UI);
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
  currentAllowedTiles: [],
  currentAllowedTilesPaletteActive: false,
  layout: 'straight', // compatibility mode: layout switching is disabled in favor of texture rotation
  textureRotationDeg: 0,
  rotationPanelOpen: false,
  _paletteCache: new Map(),
  _paletteDefaultsCache: new Map(),
  _allowedTilesByShape: new Map(),
  arTextureRailStartShapeId: '',
  arTextureGroups: [],
  _arTextureGroupsPromise: null,
  _arTextureGroupsSeq: 0,
  cameraAccessEnabled: false,
  snapshotInProgress: false,
  snapshotFallbackActive: false,
  snapshotRestoreTimer: 0,
  snapshotToastTimer: 0,
  _snapshotLogoImagePromise: null,

  // internal guards
  _restartingAR: false,
  _startingAR: false,
  _switchingShapeInAr: false,
  quickLaunchExpanded: false,

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

  // Patch: Floor Lock 2.0 + World Lock (anchors)
  floorLock2Enabled: FLOOR_LOCK2_ENABLED,
  worldAnchorsEnabled: WORLD_ANCHORS_ENABLED,
  atomicTexEnabled: ATOMIC_TEX_ENABLED,
  _atomicFinalEnsuring: false,
  _atomicFinalEnsuredOnce: false,
  // Rolling reticle samples for gating (only used when floorLock2Enabled)
  _lock2ReticleSamples: [],
  _lock2LastGateMsgT: 0,
  // WebXR Anchors API state (only used when worldAnchorsEnabled)
  xrAnchorSpace: null,
  anchorPending: false,
  anchorFailed: false,
  anchorStartT: 0,
  _lastHitTestResult: null,
  _lastHitPose: null,
  _anchorInvMatrix: null,

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

  // UI gating: show bottom pattern/menu only after the user closes the contour at least once.
  hasEverClosedContour: false,

  // Debug overlay (Patch 1): metrics for hit-test stability/distance
  debugAR: {
    enabled: DEBUG_AR_ENABLED,
    fps: 0,
    _fpsFrames: 0,
    _fpsT0: 0,
    // recent samples: {t, gotHit, reticleOk, mode, x,y,z, dist, normalAngle}
    samples: [],
    maxSamples: 120,
  },

  // Plane refinement (Patch 2): reference plane tracking + freeze heuristics
  // Enabled by default; disable with ?planeRefine=0
  planeRefine: {
    enabled: PLANE_REFINE_ENABLED,

    // Reference plane height used for filtering (does NOT move geometry in Patch 2).
    planeYRef: null,
    lastPlaneUpdateT: 0,

    // Refinement cadence
    refineIntervalMs: 80, // ~12.5 Hz
    lastRefineT: 0,

    // Filters
    heightTolM: 0.05,
    heightTolMaxM: 0.08,
    minAngleDeg: 12,

    // Freeze logic
    freezeAngleDeg: 12,
    minValidRatio: 0.20,
    freezeHoldMs: 450,
    freezeUntil: 0,

    // Rolling window for valid ratio (timestamps in ms)
    framesT: [],
    validT: [],

    // Status (useful for debug overlay)
    viewAngleDeg: NaN,
    validHit: false,
    frozen: false,
  },

};


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
// Visual-only baseline scale for distance-aware visibility.
reticle.userData.baseScale = 1.0;
reticle.scale.setScalar(1.0);
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

const selectionHelpers = createSelectionHelpers({
  state,
  UI,
  scene,
  renderer,
  clamp,
  getConnInfo,
  withTimeout,
  getPreferredSurfaceQuality,
  getSurfaceRuntimeTuning,
  loadTexSmartCached,
  warmupTextureOnGPU,
  loadTileAlbedoWithFallback,
  getTileAlbedoCandidates,
  applyMapToTileMaterial,
  crossfadeAlbedoOnMaterial,
  computeAutoExposureMultFromTexture,
  makeTileMaterial,
  arTexProgress: _arTexProgress,
  arTexProgressShow: _arTexProgressShow,
  arTexProgressShowImmediate: _arTexProgressShowImmediate,
  arTexProgressSetLabel: _arTexProgressSetLabel,
  arTexProgressMapUpdate: _arTexProgressMapUpdate,
  arTexProgressTick: _arTexProgressTick,
  getTileMaterial: () => tileMaterial,
  setTileMaterial: (mat) => { tileMaterial = mat; },
  getFillMesh: () => fillMesh,
  getPreviewPlane: () => previewPlane,
  touchMaterialTextures,
  trimTextureCaches,
});
const { setLayout, setTextureRotationDeg, selectTile, disposeSelectionRuntime } = selectionHelpers;

const arSessionHelpers = createArSessionHelpers({
  state,
  UI,
  renderer,
  updateTexLoadMaxParallel,
  setActiveScreen,
  setShapePickerOpen,
  updateArTopStripVar,
  updateArBottomStripVar,
  worldAnchorClear: () => _worldAnchorClear(),
  startAR: () => startAR(),
  reticle,
  scanGrid,
  previewPlane,
  previewGrid,
  disposeSelectionRuntime,
  disposeWarmupResources,
  trimTextureCaches,
  touchMaterialTextures,
  getTileMaterial: () => tileMaterial,
  getPreviewPlane: () => previewPlane,
  getFillMesh: () => fillMesh,
});
const { checkXrSupport, cleanupXR, stopAR, fullRestartAR } = arSessionHelpers;


// ------------------------
// Geometry state adapters
// ------------------------
const computeAreaM2 = () => computeAreaM2FromContours(state.points, state.holes);

// ------------------------
// Catalog + Detail rendering (Формы -> деталка формы -> выбор цветов/текстур)
// ------------------------

function fillShapeDetailUI(shape) {
  if (!shape) return;
  UI.detailTitle.textContent = shape.name;
  UI.detailName.textContent = shape.name;
  UI.detailSub.textContent = shape.subtitle || 'Тротуарная плитка';
  renderDetailHero(UI.detailHero, shape);
  renderDetailTech(UI.detailTech, UI.techBody, UI.btnTechToggle, shape);

  if (UI.layoutRow) {
    UI.layoutRow.querySelectorAll('.layoutCard').forEach(btn => {
      btn.onclick = () => setLayout(btn.dataset.layout);
    });
  }
  setLayout(state.layout);
}

function attachShapeMetaToTiles(shape, tiles = []) {
  const shapeId = shape && shape.id ? String(shape.id) : '';
  const shapeName = shape && shape.name ? String(shape.name) : shapeId;
  return (tiles || []).map((tile) => ({
    ...tile,
    shapeId: tile && tile.shapeId ? String(tile.shapeId) : shapeId,
    shapeName: tile && tile.shapeName ? String(tile.shapeName) : shapeName,
  }));
}

async function resolveAllowedTilesForShape(shape, opts = {}) {
  const allowFallback = opts.allowFallback !== false;
  if (!shape) return { allowed: allowFallback ? state.tiles.slice(0, 8) : [], paletteActive: false };

  const cacheShapeId = shape && shape.id ? String(shape.id) : '';
  const cacheKey = cacheShapeId ? `${cacheShapeId}|fallback:${allowFallback ? '1' : '0'}` : '';
  const force = !!opts.force;
  if (!force && cacheKey && state._allowedTilesByShape.has(cacheKey)) {
    return state._allowedTilesByShape.get(cacheKey);
  }

  let allowed = null;
  let paletteActive = false;
  const paletteCandidates = getPaletteCandidateUrlsForShape(shape, { apiBaseUrl: API_BASE_URL, surfacePaletteBaseUrl: SURFACE_PALETTE_BASE_URL });

  if (paletteCandidates.length) {
    const paletteDefaults = await loadPaletteDefaultsForShape(shape.id, {
      paletteSettingsBaseUrl: PALETTE_SETTINGS_BASE_URL,
      enabled: ENABLE_PALETTE_SETTINGS,
      cache: state._paletteDefaultsCache,
      warnOnce: warnNetworkFallbackOnce,
    });
    let items = null;

    for (const candidate of paletteCandidates) {
      if (!candidate || !candidate.url) continue;
      items = await loadSurfacePalette(candidate.url, {
        cache: state._paletteCache,
        cacheKey: candidate.cacheKey,
        warnOnce: warnNetworkFallbackOnce,
      });
      if (Array.isArray(items) && items.length) break;
    }

    if (API_BASE_URL && Array.isArray(items) && items.length) {
      items = await filterPaletteItemsBySurfaces(shape.id, items, { apiBaseUrl: API_BASE_URL, warnOnce: warnNetworkFallbackOnce });
    }
    if (Array.isArray(items) && items.length) {
      allowed = paletteItemsToTiles(items, paletteDefaults);
      paletteActive = true;
    }
  }

  if ((!Array.isArray(allowed) || !allowed.length) && allowFallback) {
    allowed = (Array.isArray(shape.tileIds) && shape.tileIds.length
      ? shape.tileIds.map(id => state.tiles.find(t => t.id === id)).filter(Boolean)
      : state.tiles.slice(0, 8));
  }

  const result = { allowed: attachShapeMetaToTiles(shape, Array.isArray(allowed) ? allowed : []), paletteActive };
  if (cacheKey && (allowFallback || result.paletteActive || result.allowed.length)) {
    state._allowedTilesByShape.set(cacheKey, result);
  }
  return result;
}

function getOrderedShapesForArRail() {
  const shapes = Array.isArray(state.shapes) ? state.shapes.slice() : [];
  if (!shapes.length) return [];
  const startShapeId = state.arTextureRailStartShapeId || (state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : '');
  if (!startShapeId) return shapes;
  const startIndex = shapes.findIndex((shape) => shape && String(shape.id) === startShapeId);
  if (startIndex <= 0) return shapes;
  return shapes.slice(startIndex).concat(shapes.slice(0, startIndex));
}

function getFallbackArTextureGroups() {
  const hasRealCurrentShapeTextures = !!state.currentAllowedTilesPaletteActive;
  const tiles = hasRealCurrentShapeTextures && Array.isArray(state.currentAllowedTiles) && state.currentAllowedTiles.length
    ? state.currentAllowedTiles
    : [];
  if (!tiles.length) return [];
  return [{
    shapeId: state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : 'current-shape',
    shapeName: state.selectedShape && state.selectedShape.name ? String(state.selectedShape.name) : 'Текущая форма',
    tiles,
  }];
}

async function handleArTextureRailTileClick(tile) {
  if (!tile) return;
  const tileShapeId = tile && tile.shapeId ? String(tile.shapeId) : '';
  const selectedShapeId = state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : '';

  if (tileShapeId && selectedShapeId && tileShapeId !== selectedShapeId) {
    if (state._switchingShapeInAr) return;
    state._switchingShapeInAr = true;
    try {
      await openDetail(tileShapeId, { preserveScreen: true, preferredTileId: tile.id });
      renderArTextureRail();
    } catch (e) {
      console.error('in-rail shape switch failed', e);
    } finally {
      state._switchingShapeInAr = false;
    }
    return;
  }

  await selectTile(tile);
}

function scrollArTextureRailToShape(shapeId, opts = {}) {
  if (!UI.finalColors || !shapeId) return false;
  const shapeIdStr = String(shapeId);
  const sections = Array.from(UI.finalColors.querySelectorAll('.finalColorSection[data-shape-id]'));
  const target = sections.find((section) => section && section.dataset && String(section.dataset.shapeId) === shapeIdStr);
  if (!target) return false;

  const railRect = UI.finalColors.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = targetRect.left - railRect.left;
  const padding = (typeof opts.padding === 'number') ? opts.padding : 8;
  const nextLeft = Math.max(0, UI.finalColors.scrollLeft + offset - padding);
  const behavior = opts.behavior || 'smooth';

  try {
    UI.finalColors.scrollTo({ left: nextLeft, behavior });
  } catch (_) {
    UI.finalColors.scrollLeft = nextLeft;
  }
  return true;
}

function requestArTextureRailScroll(shapeId, opts = {}) {
  const shapeIdStr = shapeId ? String(shapeId) : '';
  state.pendingArTextureRailScrollShapeId = shapeIdStr;
  if (!shapeIdStr) return;
  const behavior = opts.behavior || 'smooth';
  const padding = (typeof opts.padding === 'number') ? opts.padding : 8;

  const attempt = () => {
    if (state.pendingArTextureRailScrollShapeId !== shapeIdStr) return;
    const ok = scrollArTextureRailToShape(shapeIdStr, { behavior, padding });
    if (ok) state.pendingArTextureRailScrollShapeId = '';
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(attempt));
  } else {
    setTimeout(attempt, 0);
  }
}

function renderArTextureRail() {
  if (!UI.finalColors) return;
  const groups = (Array.isArray(state.arTextureGroups) && state.arTextureGroups.length)
    ? state.arTextureGroups
    : getFallbackArTextureGroups();
  const trailingHint = state._arTextureGroupsPromise
    ? (state.arTextureGroups.length ? 'Подгружаем остальные формы…' : 'Загружаем все формы и текстуры…')
    : '';

  renderGroupedColorRow(UI.finalColors, groups, {
    selectedTileId: state.selectedTile ? state.selectedTile.id : '',
    selectedShapeId: state.selectedShape && state.selectedShape.id ? state.selectedShape.id : '',
    onTileClick: handleArTextureRailTileClick,
    trailingHint,
  });
  updateArBottomStripVar(UI);

  if (state.pendingArTextureRailScrollShapeId) {
    requestArTextureRailScroll(state.pendingArTextureRailScrollShapeId, { behavior: 'smooth' });
  }
}

async function ensureArTextureGroupsBuilt(opts = {}) {
  const force = !!opts.force;
  if (!force && Array.isArray(state.arTextureGroups) && state.arTextureGroups.length) return state.arTextureGroups;
  if (!force && state._arTextureGroupsPromise) return state._arTextureGroupsPromise;

  const seq = ++state._arTextureGroupsSeq;
  const promise = (async () => {
    const groups = [];
    const orderedShapes = getOrderedShapesForArRail();
    for (const shape of orderedShapes) {
      if (!shape || !shape.id) continue;
      try {
        const resolved = await resolveAllowedTilesForShape(shape, { allowFallback: false, force: !!opts.force });
        const tiles = Array.isArray(resolved && resolved.allowed) ? resolved.allowed : [];
        if (!resolved || !resolved.paletteActive || !tiles.length) continue;
        groups.push({
          shapeId: String(shape.id),
          shapeName: shape.name ? String(shape.name) : String(shape.id),
          tiles,
        });
      } catch (err) {
        console.warn('AR texture rail group skipped:', shape && shape.id ? shape.id : 'unknown-shape', err);
      }
    }
    if (seq !== state._arTextureGroupsSeq) return state.arTextureGroups;
    state.arTextureGroups = groups;
    if (state.phase === 'ar_final') renderArTextureRail();
    return groups;
  })();

  state._arTextureGroupsPromise = promise;
  try {
    return await promise;
  } finally {
    if (state._arTextureGroupsPromise === promise) state._arTextureGroupsPromise = null;
  }
}

async function openDetail(shapeId, opts = {}) {
  const s = state.shapes.find(x => x.id === shapeId);
  if (!s) return null;
  state.selectedShape = s;
  fillShapeDetailUI(s);

  const preserveScreen = !!opts.preserveScreen;
  const keepCurrentTile = !!opts.keepCurrentTile;
  const preferredTileId = opts.preferredTileId ? String(opts.preferredTileId) : '';

  const { allowed, paletteActive } = await resolveAllowedTilesForShape(s);
  state.currentAllowedTiles = allowed;
  state.currentAllowedTilesPaletteActive = !!paletteActive;

  renderColorRow(UI.colorRow, allowed, {
    onTileClick: async (tile) => {
      await selectTile(tile);
      if (paletteActive && !state.xrSession) await startAR();
    }
  });

  try {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 0 }), 220));
    idle(() => {
      try {
        const previewUrls = (allowed || []).slice(0, 8).map(getTilePreviewUrl).filter(Boolean);
        prefetchImageUrls(previewUrls, 3);
      } catch (_) {}
    });
  } catch (_) {}

  if (!preserveScreen) {
    setActiveScreen('detail', UI);
    state.phase = 'detail';
  }

  const retainedTile = keepCurrentTile && state.selectedTile
    ? allowed.find((tile) => tile && state.selectedTile && tile.id === state.selectedTile.id)
    : null;
  const preferredTile = preferredTileId
    ? allowed.find((tile) => tile && String(tile.id) === preferredTileId)
    : null;
  const defaultTile = retainedTile || preferredTile || allowed[0] || state.tiles[0] || null;
  if (defaultTile) await selectTile(defaultTile);

  if (!preserveScreen) updateArEntryUI(UI);
  return { shape: s, allowed, paletteActive, defaultTile };
}



// ------------------------
// Preview lazy-load + prefetch (performance/stability)
// ------------------------
// ------------------------
// XR setup
// ------------------------

function setQuickArStatus(message) {
  if (!UI.quickArStatus) return;
  UI.quickArStatus.textContent = String(message || '').trim();
}

function renderQuickLaunchSection() {
  renderQuickLaunchRail(UI.quickArRail, state.quickLaunchItems, {
    onLaunch: launchQuickArPreset,
    expandedEl: UI.quickArExpanded,
    toggleEl: UI.btnQuickArToggle,
    expanded: !!state.quickLaunchExpanded,
  });
}

function toggleQuickLaunchExpanded() {
  state.quickLaunchExpanded = !state.quickLaunchExpanded;
  renderQuickLaunchSection();
}

async function buildQuickLaunchItems() {
  const seq = (state._quickLaunchSeq = (state._quickLaunchSeq || 0) + 1);
  setQuickArStatus('Подбираем опубликованные варианты…');
  const shapes = Array.isArray(state.shapes) ? state.shapes.slice() : [];
  const results = await buildPublishedQuickLaunchItems(shapes, {
    getPaletteCandidateUrlsForShape,
    loadPaletteDefaultsForShape,
    loadSurfacePalette,
    filterPaletteItemsBySurfaces,
    paletteItemsToTiles,
    getTilePreviewUrl,
    apiBaseUrl: API_BASE_URL,
    surfacePaletteBaseUrl: SURFACE_PALETTE_BASE_URL,
    paletteSettingsBaseUrl: PALETTE_SETTINGS_BASE_URL,
    enablePaletteSettings: ENABLE_PALETTE_SETTINGS,
    paletteCache: state._paletteCache,
    paletteDefaultsCache: state._paletteDefaultsCache,
    warnOnce: warnNetworkFallbackOnce,
    concurrency: 3,
  });
  if (state._quickLaunchSeq !== seq) return;
  state.quickLaunchItems = results;
  if (!state.quickLaunchItems.length) state.quickLaunchExpanded = false;
  renderQuickLaunchSection();
  setQuickArStatus(state.quickLaunchItems.length
    ? 'Выбирайте варианты для быстрого запуска'
    : 'Быстрые AR-варианты появятся после публикации реальных текстур в палитрах.');
}

async function launchQuickArPreset(item) {
  if (!item || !item.shapeId || !item.tileId) return;
  if (state._launchingQuickAr) return;
  state._launchingQuickAr = true;
  const restoreStatus = UI.quickArStatus ? UI.quickArStatus.textContent : '';
  try {
    setQuickArStatus(`Подготавливаем AR: ${item.shapeName} — ${item.tileName}`);
    await openDetail(item.shapeId, {
      preserveScreen: true,
      keepCurrentTile: false,
      preferredTileId: item.tileId,
    });
    await startAR();
    setQuickArStatus(`AR готов: ${item.shapeName} — ${item.tileName}`);
  } catch (e) {
    console.error('quick AR launch failed', e);
    setQuickArStatus('Не удалось запустить AR. Попробуйте ещё раз.');
  } finally {
    state._launchingQuickAr = false;
    setTimeout(() => {
      if (!state._launchingQuickAr && UI.quickArStatus && /^(AR готов|Не удалось)/.test(UI.quickArStatus.textContent || '')) {
        UI.quickArStatus.textContent = restoreStatus || UI.quickArStatus.textContent;
      }
    }, 2200);
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
    // Keep the main product XR session minimal and stable.
    // Anchors are requested ONLY in debug sessions when explicitly enabled.
    optionalFeatures: [
      'camera-access',
      ...(WORLD_ANCHORS_ENABLED ? ['anchors'] : []),
      ...(canRequestDepth ? ['depth-sensing'] : []),
    ],
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
  try { updateTexLoadMaxParallel({ xrActive: !!(state && state.xrSession) }); } catch (_) {}
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
    state.cameraAccessEnabled = enabled.includes('camera-access');
  } catch (_) {
    state.cameraAccessEnabled = false;
  }

  session.addEventListener('end', () => {
    cleanupXR();
  });

  // enter AR UI
  setActiveScreen('ar', UI);
  state.phase = 'ar_scan';
  state.hasEverClosedContour = false;
  resetAll(false); // всегда начинаем с нового сканирования
  UI.scanHint.classList.remove('hidden');
  show(UI.scanHint, true);

  // Hide contour guidance at start (will appear after floor is locked)
  show(UI.contourHint, false);

  // grid visible while scanning
  scanGrid.visible = true;

  // Hide desktop preview objects in AR (they otherwise appear floating)
  previewPlane.visible = false;
  previewGrid.visible = false;

  // Do NOT show bottom menu until the contour is closed (per product UX)
  show(UI.finalBar, false);
  show(UI.finalColors, false);
  updateArBottomStripVar(UI);
  // main add button area visible at start
  show(UI.arBottomCenter, false);
  show(UI.btnArAdd, false);
  show(UI.btnArOk, false);

  // Patch: optional experimental UI for FloorLock2
  _ensureRecenterButton();
  } finally {
    state._startingAR = false;
  }
}

// ------------------------
// Floor lock + points
// ------------------------

function _lock2TrimSamples(arr, maxN) {
  try {
    while (arr.length > maxN) arr.shift();
  } catch (_) {}
}

function _lock2RecordReticleSample() {
  if (!state.floorLock2Enabled) return;
  if (!reticle.visible) return;
  const a = state._lock2ReticleSamples;
  a.push({ t: performance.now(), x: reticle.position.x, z: reticle.position.z });
  // ~0.7-1.0 sec window depending on fps
  _lock2TrimSamples(a, 30);
}

function _lock2JitterCm() {
  const a = state._lock2ReticleSamples;
  if (!state.floorLock2Enabled || !a || a.length < 8) return null;
  let mx = 0, mz = 0;
  for (const s of a) { mx += s.x; mz += s.z; }
  mx /= a.length; mz /= a.length;
  let v = 0;
  for (const s of a) {
    const dx = s.x - mx;
    const dz = s.z - mz;
    v += dx*dx + dz*dz;
  }
  v /= Math.max(1, a.length - 1);
  return Math.sqrt(v) * 100;
}

function _lock2GateOk() {
  if (!state.floorLock2Enabled) return true;
  // Basic prerequisites
  if (!state.floorLocked) return false;
  if (!reticle.visible) return false;

  // Require the camera to be sufficiently pitched to the floor
  const pr = state.planeRefine;
  const ang = (pr && isFinite(pr.viewAngleDeg)) ? pr.viewAngleDeg : 0;
  if (ang < 18) return false;

  // Prefer a stable period (low jitter) once we have enough samples
  const jitter = _lock2JitterCm();
  if (jitter != null && jitter > 3.5) return false;

  // If plane refinement is enabled, do not place points while it is frozen
  if (pr && pr.enabled && pr.frozen) return false;

  return true;
}

function _lock2GateNotifyOnce(msg) {
  if (!state.floorLock2Enabled) return;
  const now = performance.now();
  if (now - (state._lock2LastGateMsgT || 0) < 650) return;
  state._lock2LastGateMsgT = now;
  try {
    if (UI.scanHint) {
      const t = UI.scanHint.querySelector('.scanTitle');
      const s = UI.scanHint.querySelector('.scanText');
      if (t) t.textContent = 'СТАБИЛИЗАЦИЯ AR';
      if (s) s.textContent = msg || 'Подвигайте телефон и наведите камеру на пол.';
      show(UI.scanHint, true);
    }
  } catch (_) {}
}

function _worldAnchorClear() {
  try {
    state.xrAnchorSpace = null;
    state.anchorPending = false;
    state.anchorFailed = false;
    state.anchorStartT = 0;
    state._anchorInvMatrix = null;
  } catch (_) {}
  try {
    anchorGroup.matrixAutoUpdate = true;
    anchorGroup.position.set(0, 0, 0);
    anchorGroup.quaternion.set(0, 0, 0, 1);
    anchorGroup.scale.set(1, 1, 1);
    anchorGroup.updateMatrixWorld(true);
  } catch (_) {}
}

function _worldAnchorStartFromLastHit() {
  if (!state.worldAnchorsEnabled) return;
  if (!state.xrSession) return;
  if (state.xrAnchorSpace || state.anchorPending) return;
  const hr = state._lastHitTestResult;
  const can = !!(hr && typeof hr.createAnchor === 'function');
  if (!can) {
    state.anchorFailed = true;
    return;
  }

  state.anchorPending = true;
  state.anchorFailed = false;
  state.anchorStartT = performance.now();

  // Fire-and-forget: resolve anchor when available
  try {
    Promise.resolve(hr.createAnchor())
      .then((a) => {
        if (!a || !a.anchorSpace) throw new Error('anchorSpace missing');
        state.xrAnchorSpace = a.anchorSpace;
        state.anchorPending = false;
        state.anchorFailed = false;
      })
      .catch((e) => {
        console.warn('[AR] Anchors API createAnchor failed, fallback to non-anchor mode', e);
        state.anchorPending = false;
        state.anchorFailed = true;
      });
  } catch (e) {
    state.anchorPending = false;
    state.anchorFailed = true;
  }
}

function _worldAnchorUpdateFromFrame(frame) {
  if (!state.worldAnchorsEnabled) return;
  if (!state.xrAnchorSpace || !state.referenceSpace) return;
  try {
    const pose = frame.getPose(state.xrAnchorSpace, state.referenceSpace);
    if (!pose) return;

    // Apply anchor pose directly to the group that contains contour/fill.
    // This reduces drift when the user looks away and AR tracking refines its map.
    anchorGroup.matrixAutoUpdate = false;
    anchorGroup.matrix.fromArray(pose.transform.matrix);
    anchorGroup.matrixWorldNeedsUpdate = true;
    anchorGroup.updateMatrixWorld(true);

    // Cache inverse for conversions if needed.
    if (!state._anchorInvMatrix) state._anchorInvMatrix = new THREE.Matrix4();
    state._anchorInvMatrix.copy(anchorGroup.matrix).invert();
  } catch (e) {
    // If pose lookup fails, do not break rendering.
  }
}

function _ensureRecenterButton() {
  // Only show in experimental Floor Lock 2.0 mode (lock2=1)
  if (!state.floorLock2Enabled) {
    try {
      const old = document.getElementById('btnArRecenter');
      old?.remove();
    } catch (_) {}
    return;
  }

  try {
    if (document.getElementById('btnArRecenter')) return;
    if (!UI.overlay) return;

    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnArRecenter';
    b.textContent = 'Recenter';
    b.title = 'Пересканировать плоскость и заново зафиксировать контур';
    // Inline style to avoid touching CSS bundle
    b.style.position = 'absolute';
    b.style.right = '12px';
    b.style.top = '68px';
    b.style.zIndex = '9999';
    b.style.padding = '10px 12px';
    b.style.borderRadius = '12px';
    b.style.border = '1px solid rgba(255,255,255,0.25)';
    b.style.background = 'rgba(20, 24, 34, 0.55)';
    b.style.color = '#fff';
    b.style.backdropFilter = 'blur(10px)';
    b.style.webkitBackdropFilter = 'blur(10px)';
    b.style.fontSize = '13px';

    b.addEventListener('click', () => {
      // Soft reset: drop floor lock, clear anchor (if any), return to scanning.
      try {
        resetAll(false);
        state.phase = 'ar_scan';
        show(UI.scanHint, true);
        show(UI.contourHint, false);
        show(UI.finalBar, false);
        show(UI.finalColors, false);
        show(UI.postCloseBar, false);
        show(UI.arBottomCenter, false);
        show(UI.btnArAdd, false);
        show(UI.btnArOk, false);
        if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);

        // Restore default scan hint text
        const t = UI.scanHint?.querySelector('.scanTitle');
        const s = UI.scanHint?.querySelector('.scanText');
        if (t) t.textContent = 'СКАНИРУЙТЕ ПОВЕРХНОСТЬ';
        if (s) {
          s.textContent = 'Плавно двигайте телефон влево-вправо и направляйте камеру на пол. Разметка работает после фиксации плоскости.';
        }
      } catch (_) {}
    });

    UI.overlay.appendChild(b);
  } catch (_) {}
}
function ensureFloorLocked() {
  if (state.floorLocked) return;
  if (!reticle.visible) return;
  state.floorLocked = true;
  state.floorY = reticle.position.y;

  // Patch: Floor Lock 2.0 small downward bias (up to 1.5 cm) if we have scan samples
  // (reduces perceived "hover" when hit-test plane is estimated slightly above the real floor)
  if (state.floorLock2Enabled && Array.isArray(state.floorSamples) && state.floorSamples.length >= 8) {
    try {
      const sorted = state.floorSamples.slice().sort((a, b) => a - b);
      const q = (p) => {
        const pos = (sorted.length - 1) * p;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        const t = pos - lo;
        return sorted[lo] * (1 - t) + sorted[hi] * t;
      };
      const p20 = q(0.20);
      const p10 = q(0.10);
      if (isFinite(p20) && isFinite(p10)) {
        const d = Math.max(0, p20 - p10);
        state.floorY = p20 - Math.min(d, 0.015);
      }
    } catch (_) {}
  }

  // Reset lock2 gating window once floor is locked.
  if (state.floorLock2Enabled) {
    state._lock2ReticleSamples = [];
    state._lock2LastGateMsgT = 0;
  }

  // Patch: attempt to start WebXR world anchor once the floor is locked (anchors=1)
  _worldAnchorStartFromLastHit();

  // lock scanning grid to the floor (and then hide it — it is only for scanning)
  scanGrid.position.set(reticle.position.x, state.floorY + 0.001, reticle.position.z);
  scanGrid.visible = false;

  // hide scan hint
  show(UI.scanHint, false);
  // While the user is placing contour points, the main bottom menu must be hidden
  // so it doesn't overlap the "+" control.
  show(UI.finalBar, false);
  // Show contour placement guidance (only before the first successful close)
  if (!state.hasEverClosedContour) {
    show(UI.contourHint, true);
  }
  state.phase = 'ar_draw';
}

function addPointAtWorld(worldPos) {
  if (!state.xrSession) return;

  // auto-lock floor on first action
  ensureFloorLocked();
  if (!state.floorLocked) return;

  // Patch: World Lock gating — avoid placing points before the anchor is ready (anchors=1)
  if (state.worldAnchorsEnabled && !state.xrAnchorSpace && !state.anchorFailed) {
    if (!state.anchorPending) _worldAnchorStartFromLastHit();
    const dt = performance.now() - (state.anchorStartT || 0);
    if (state.anchorPending && dt < 1200) {
      // Inform the user without changing the default UI when the feature is disabled.
      if (state.floorLock2Enabled) {
        _lock2GateNotifyOnce('Фиксируем объект в пространстве… Подождите секунду и держите камеру на полу.');
      } else {
        try {
          if (UI.scanHint) {
            const t = UI.scanHint.querySelector('.scanTitle');
            const s = UI.scanHint.querySelector('.scanText');
            if (t) t.textContent = 'СТАБИЛИЗАЦИЯ AR';
            if (s) s.textContent = 'Фиксируем объект в пространстве… Подождите секунду и держите камеру на полу.';
            show(UI.scanHint, true);
          }
        } catch (_) {}
      }
      return;
    }
    // If anchors take too long or fail, fall back to normal (non-anchor) behavior.
    if (state.anchorPending && dt >= 1500) {
      state.anchorPending = false;
      state.anchorFailed = true;
    }
  }

  // Patch: Floor Lock 2.0 gating — require a stable reticle before placing points (lock2=1)
  if (state.floorLock2Enabled && !_lock2GateOk()) {
    _lock2GateNotifyOnce('Подвигайте телефон плавно и наведите камеру на пол. Дождитесь, когда прицел перестанет дрожать.');
    return;
  }

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
  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: false });
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';
  show(UI.finalColors, false);
  updateArBottomStripVar(UI);
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
  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: state.closed });
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
  updateArBottomStripVar(UI);
  rebuildFill();
  updateAreaUI();
}

function closeContour() {
  if (state.points.length < 3) return;
  state.closed = true;
  state.phase = 'ar_mask';
  state.hasEverClosedContour = true;

  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: true });
  rebuildFill();
  updateAreaUI();

  // UI
  // Once the contour is closed and the fill is built, enable the bottom menu.
  show(UI.contourHint, false);
  show(UI.finalBar, true);
  show(UI.btnArAdd, false);
  show(UI.btnArOk, false);
  show(UI.arBottomCenter, false);
  show(UI.postCloseBar, true);
  show(UI.finalColors, false);
  updateArBottomStripVar(UI);
} 


function resetAll(keepFloor = false) {
  state.points = [];
  state.holes = [];
  state.holePoints = [];
  state.closed = false;

  if (!keepFloor) {
    state.hasEverClosedContour = false;
  }

  if (!keepFloor) {
    state.floorLocked = false;
    state.floorY = 0;
    // floor stabilization state (may exist depending on build)
    if ('floorSamples' in state) state.floorSamples = [];
    if ('floorYEstimate' in state) state.floorYEstimate = null;
    if ('floorStable' in state) state.floorStable = false;

    // Patch: reset world anchor + lock2 gating when restarting scan
    _worldAnchorClear();
    state._lock2ReticleSamples = [];
    state._lock2LastGateMsgT = 0;
    state._lastHitTestResult = null;
    state._lastHitPose = null;

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
    // Hide the main bottom menu while scanning / placing points so it doesn't overlap the "+" button.
    // Show it again after the contour is closed and the fill is visible.
    const hideMainMenu = (state.phase === 'ar_scan') || (state.phase === 'ar_draw') || (state.phase === 'ar_cut');
    if (hideMainMenu) setRotationPanelOpen(false);
    show(UI.finalBar, !hideMainMenu);
    show(UI.finalColors, false);
  } else {
    show(UI.finalBar, false);
  }

  // Contour hint is shown only in early drawing mode before the first close.
  show(UI.contourHint, false);

  const inScan = (state.phase === 'ar_scan' && !state.floorLocked);
  show(UI.arBottomCenter, !inScan);
  show(UI.btnArAdd, !inScan);
  show(UI.btnArOk, false);

  // restore guides visibility (they may be hidden in final mode)
  pointsGroup.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';

  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);
  updateAreaUI();
}

function clearSnapshotRestoreTimer() {
  if (state.snapshotRestoreTimer) {
    clearTimeout(state.snapshotRestoreTimer);
    state.snapshotRestoreTimer = 0;
  }
}

function clearSnapshotToastTimer() {
  if (state.snapshotToastTimer) {
    clearTimeout(state.snapshotToastTimer);
    state.snapshotToastTimer = 0;
  }
}

function showSnapshotToast(message, durationMs = 1600) {
  if (!UI.snapshotToast) return;
  clearSnapshotToastTimer();
  const text = String(message || '').trim();
  if (!text) {
    show(UI.snapshotToast, false);
    UI.snapshotToast.textContent = '';
    return;
  }
  UI.snapshotToast.textContent = text;
  show(UI.snapshotToast, true);
  state.snapshotToastTimer = window.setTimeout(() => {
    show(UI.snapshotToast, false);
    UI.snapshotToast.textContent = '';
    state.snapshotToastTimer = 0;
  }, Math.max(600, durationMs | 0));
}

function restoreArFinalBottomUi() {
  if (!state.xrSession || state.phase !== 'ar_final' || state.snapshotFallbackActive) {
    updateArBottomStripVar(UI);
    return;
  }
  show(UI.finalBar, true);
  show(UI.finalColors, true);
  updateArBottomStripVar(UI);
}

function setSnapshotFallbackActive(active) {
  const next = !!active;
  state.snapshotFallbackActive = next;
  if (UI.snapshotLogoOverlay) show(UI.snapshotLogoOverlay, next);
  if (UI.snapshotDismissLayer) show(UI.snapshotDismissLayer, next);
  if (!next) {
    clearSnapshotRestoreTimer();
    restoreArFinalBottomUi();
  }
}

function hideArBottomMenusForSnapshot() {
  setRotationPanelOpen(false);
  try { setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar }); } catch (_) {}
  show(UI.finalBar, false);
  show(UI.finalColors, false);
  updateArBottomStripVar(UI);
}

function restoreSnapshotUi() {
  setSnapshotFallbackActive(false);
  showSnapshotToast('');
  restoreArFinalBottomUi();
}

function scheduleSnapshotFallbackRestore() {
  clearSnapshotRestoreTimer();
  state.snapshotRestoreTimer = window.setTimeout(() => {
    restoreSnapshotUi();
  }, 10000);
}

function waitForAnimationFrames(count = 2) {
  const steps = Math.max(1, Number(count) || 1);
  return new Promise((resolve) => {
    const tick = (left) => {
      if (left <= 0) {
        resolve();
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => tick(left - 1));
      } else {
        setTimeout(() => tick(left - 1), 16);
      }
    };
    tick(steps);
  });
}

function loadSnapshotLogoImage() {
  if (state._snapshotLogoImagePromise) return state._snapshotLogoImagePromise;
  state._snapshotLogoImagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('snapshot-logo-load-failed'));
    img.src = 'assets/ui/active_group_logo.png';
  }).catch((err) => {
    state._snapshotLogoImagePromise = null;
    throw err;
  });
  return state._snapshotLogoImagePromise;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasLikelyContainsCompositeCamera(sourceCanvas) {
  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 64;
    sampleCanvas.height = 64;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(sourceCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const data = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 180) opaque += 1;
    }
    const total = data.length / 4;
    return total > 0 ? (opaque / total) > 0.55 : false;
  } catch (_) {
    return false;
  }
}

async function buildBrandedSnapshotBlob() {
  const sourceCanvas = renderer && renderer.domElement ? renderer.domElement : UI.canvas;
  if (!sourceCanvas) throw new Error('snapshot-source-missing');
  if (!canvasLikelyContainsCompositeCamera(sourceCanvas)) throw new Error('snapshot-no-composited-camera');

  const outCanvas = document.createElement('canvas');
  outCanvas.width = sourceCanvas.width;
  outCanvas.height = sourceCanvas.height;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) throw new Error('snapshot-context-missing');

  ctx.drawImage(sourceCanvas, 0, 0, outCanvas.width, outCanvas.height);

  const logo = await loadSnapshotLogoImage();
  const shortSide = Math.max(1, Math.min(outCanvas.width, outCanvas.height));
  const maxLogoWidth = Math.round(shortSide * 0.18);
  const margin = Math.max(16, Math.round(shortSide * 0.024));
  const logoScale = Math.min(1, maxLogoWidth / Math.max(1, logo.naturalWidth || logo.width || maxLogoWidth));
  const drawWidth = Math.max(64, Math.round((logo.naturalWidth || logo.width || maxLogoWidth) * logoScale));
  const drawHeight = Math.max(22, Math.round((logo.naturalHeight || logo.height || Math.max(32, drawWidth * 0.24)) * (drawWidth / Math.max(1, (logo.naturalWidth || logo.width || drawWidth)))));
  const padX = Math.max(6, Math.round(drawWidth * 0.08));
  const padY = Math.max(5, Math.round(drawHeight * 0.12));
  const boxX = outCanvas.width - drawWidth - padX * 2 - margin;
  const boxY = outCanvas.height - drawHeight - padY * 2 - margin;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.shadowColor = 'rgba(0,0,0,0.14)';
  ctx.shadowBlur = Math.max(10, Math.round(shortSide * 0.012));
  drawRoundedRect(ctx, boxX, boxY, drawWidth + padX * 2, drawHeight + padY * 2, Math.max(12, Math.round(shortSide * 0.012)));
  ctx.fill();
  ctx.restore();

  ctx.drawImage(logo, boxX + padX, boxY + padY, drawWidth, drawHeight);

  const blob = await new Promise((resolve, reject) => {
    outCanvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('snapshot-blob-failed'));
    }, 'image/png');
  });
  if (!blob || !blob.size) throw new Error('snapshot-empty-blob');
  return blob;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function getSnapshotFilename() {
  const now = new Date();
  const part = (v) => String(v).padStart(2, '0');
  return `aktiv-grupp-ar-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}.png`;
}

async function exportSnapshotBlob(blob) {
  const filename = getSnapshotFilename();
  try {
    if (navigator.share && typeof navigator.canShare === 'function') {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'AR-снимок Актив Групп' });
        showSnapshotToast('Снимок подготовлен для отправки.', 1800);
        return;
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      showSnapshotToast('Снимок не отправлен.', 1400);
      return;
    }
    console.warn('snapshot share failed, fallback to download', err);
  }
  triggerBlobDownload(blob, filename);
  showSnapshotToast('Снимок сохранён.', 1800);
}

async function captureBrandedSnapshot() {
  if (state.snapshotInProgress || !state.xrSession || state.phase !== 'ar_final') return false;
  state.snapshotInProgress = true;
  try {
    hideArBottomMenusForSnapshot();
    await waitForAnimationFrames(3);
    const blob = await buildBrandedSnapshotBlob();
    await exportSnapshotBlob(blob);
    return true;
  } finally {
    state.snapshotInProgress = false;
    restoreArFinalBottomUi();
  }
}

function openSystemScreenshotFallback() {
  hideArBottomMenusForSnapshot();
  setSnapshotFallbackActive(true);
  showSnapshotToast('Сделайте системный скриншот. Нижнее меню скрыто, логотип уже добавлен. После снимка коснитесь экрана для возврата меню.', 2600);
  scheduleSnapshotFallbackRestore();
}

async function handleArSnapshotRequest() {
  if (state.snapshotInProgress || !state.xrSession || state.phase !== 'ar_final') return;
  setRotationPanelOpen(false);
  try { setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar }); } catch (_) {}

  if (state.cameraAccessEnabled) {
    try {
      const ok = await captureBrandedSnapshot();
      if (ok) return;
    } catch (err) {
      console.warn('built-in AR snapshot failed, switching to fallback', err);
    }
  }

  openSystemScreenshotFallback();
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

const rebuildFill = () => {
  fillMesh = rebuildFillMesh({ anchorGroup, fillMesh, state, tileMaterial, maskMaterial });
};


// ------------------------
// Measurements overlay
// ------------------------
const measureEls = [];

const clearMeasureLabels = () => clearMeasureLabelsHelper(measureEls, UI.measureLayer);
const updateMeasureLabels = (xrCam) => updateMeasureLabelsHelper({
  state,
  measureEls,
  measureLayer: UI.measureLayer,
  floorY: state.floorY,
  anchorGroup,
  xrCam,
  fmtMeters,
});
const updateAreaUI = () => updateAreaUIHelper({ UI, state, computeAreaM2, fmtArea });

// ------------------------
// AR debug overlay (Patch 1)
// ------------------------
function _fmt(n, digits = 2) {
  try {
    if (!isFinite(n)) return '—';
    return Number(n).toFixed(digits);
  } catch (_) {
    return '—';
  }
}

function _arDebugStateLabel() {
  // Keep it simple and robust: map internal phases
  const ph = state.phase || '';
  if (ph === 'ar_scan') return 'scanning';
  if (ph === 'ar_draw' || ph === 'ar_cut' || ph === 'ar_mask') return 'placingPoints';
  if (ph === 'ar_final') return 'filled';
  return ph || '—';
}

function _arDebugRecordSample(sample) {
  try {
    const dbg = state.debugAR;
    if (!dbg || !dbg.enabled) return;
    const arr = dbg.samples;
    arr.push(sample);
    const maxN = dbg.maxSamples || 120;
    if (arr.length > maxN) arr.splice(0, arr.length - maxN);
  } catch (_) {}
}

function _arDebugComputeWindow(ms) {
  const dbg = state.debugAR;
  if (!dbg || !dbg.enabled) return { total: 0, hits: 0, validHits: 0, samples: [] };
  const now = performance.now();
  const out = [];
  let hits = 0;
  let validHits = 0;
  for (let i = dbg.samples.length - 1; i >= 0; i--) {
    const s = dbg.samples[i];
    if (!s) continue;
    if ((now - s.t) > ms) break;
    out.push(s);
    if (s.gotHit) hits++;
    if (s.validHit) validHits++;
  }
  return { total: out.length, hits, validHits, samples: out };
}

function _arDebugJitter2D(samples) {
  // Jitter in horizontal plane (XZ), in cm.
  const pts = samples.filter(s => s && s.reticleOk && isFinite(s.x) && isFinite(s.z));
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, mz = 0;
  for (const p of pts) { mx += p.x; mz += p.z; }
  mx /= n; mz /= n;
  let vx = 0, vz = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dz = p.z - mz;
    vx += dx * dx;
    vz += dz * dz;
  }
  vx /= (n - 1);
  vz /= (n - 1);
  const std = Math.sqrt(vx + vz);
  return std * 100;
}

function _arDebugUpdateOverlay() {
  try {
    const dbg = state.debugAR;
    if (!dbg || !dbg.enabled || !UI.arDebugOverlay) return;

    // FPS
    const now = performance.now();
    if (!dbg._fpsT0) dbg._fpsT0 = now;
    dbg._fpsFrames++;
    const dt = now - dbg._fpsT0;
    if (dt >= 500) {
      dbg.fps = (dbg._fpsFrames / dt) * 1000;
      dbg._fpsFrames = 0;
      dbg._fpsT0 = now;
    }

    const w1 = _arDebugComputeWindow(1000);
    const w2 = _arDebugComputeWindow(2000);

    const hitsPerSec = w1.hits;
    const hitPct2s = w2.total ? (w2.hits / w2.total) * 100 : 0;
    const validPct2s = w2.total ? (w2.validHits / w2.total) * 100 : 0;

    // Use last sample for distance / normal / mode
    const last = dbg.samples.length ? dbg.samples[dbg.samples.length - 1] : null;
    const dist = last && isFinite(last.dist) ? last.dist : null;
    const ang = last && isFinite(last.normalAngle) ? last.normalAngle : null;
    const viewAng = last && isFinite(last.viewAngleDeg) ? last.viewAngleDeg : null;
    const frozen = !!(last && last.frozen);
    const mode = last ? last.mode : '—';

    const jitterWin = dbg.samples.slice(-20);
    const jitter = _arDebugJitter2D(jitterWin);

    const lines = [
      `AR debug (Patch 2)`,
      `state: ${_arDebugStateLabel()}`,
      `fps: ${_fmt(dbg.fps, 0)}`,
      `hit-test: ${hitsPerSec} hits/s`,
      `hit success (2s): ${_fmt(hitPct2s, 0)}%`,
      `valid floor (2s): ${_fmt(validPct2s, 0)}%`,
      `distance: ${dist == null ? '—' : _fmt(dist, 2)} m`,
      `jitter (XZ, ~20f): ${jitter == null ? '—' : _fmt(jitter, 1)} cm`,
      `viewAngle: ${viewAng == null ? '—' : _fmt(viewAng, 1)}°`,
      `normalAngle: ${ang == null ? '—' : _fmt(ang, 1)}°`,
      `freeze: ${frozen ? 'on' : 'off'}`,
      `mode: ${mode}`,
    ];

    UI.arDebugOverlay.textContent = lines.join('\n');
    show(UI.arDebugOverlay, true);
  } catch (_) {}
}

// ------------------------
// XR frame update
// ------------------------
const __tmpUp = new THREE.Vector3();
const __tmpCamPos = new THREE.Vector3();
const __tmpFwd = new THREE.Vector3();
const __tmpHitPos = new THREE.Vector3();
const __tmpHitQuat = new THREE.Quaternion();
const __tmpMarkerWorldPos = new THREE.Vector3();
const __tmpReticleWorldPos = new THREE.Vector3();

// AR contour marker visibility (visual-only): keep markers readable at long distances.
// We scale markers by distance to maintain a roughly constant angular size.
// IMPORTANT: this must not change the AR pipeline logic (only visuals).
const FLAG_MARKER_RAW_DIAMETER_M = 0.0285 * 2; // outer ring diameter before baseScale
const FLAG_MARKER_TARGET_ANGULAR_DEG = 1.6;    // ~constant apparent size (tuned for outdoor use)
const FLAG_MARKER_MAX_SCALE_MULT = 8.0;        // cap to avoid absurdly large markers

// Floor scanning reticle visibility (visual-only): keep the center reticle readable when projecting far away.
// IMPORTANT: this must not change hit-test / floor-lock logic (only visuals).
const RETICLE_RAW_DIAMETER_M = 0.085 * 2;       // outer ring diameter in meters (RingGeometry outer radius = 0.085)
const RETICLE_TARGET_ANGULAR_DEG = 2.4;         // tuned so the reticle stays visible at ~8–12 m
const RETICLE_MAX_SCALE_MULT = 4.0;             // cap to avoid covering too much floor

function updateReticleVisibilityScale() {
  try {
    if (!state.xrSession) return;
    if (!reticle || !reticle.visible) return;

    const theta = THREE.MathUtils.degToRad(RETICLE_TARGET_ANGULAR_DEG);
    const tanHalf = Math.tan(theta * 0.5);

    // Reticle is directly under `world`, so matrixWorld is stable once updated.
    reticle.updateMatrixWorld(true);
    __tmpReticleWorldPos.setFromMatrixPosition(reticle.matrixWorld);
    const dist = __tmpCamPos.distanceTo(__tmpReticleWorldPos);
    if (!isFinite(dist) || dist <= 0) return;

    // Desired diameter grows linearly with distance to keep constant angular size.
    const desiredDiameter = 2 * dist * tanHalf;
    const needScale = desiredDiameter / RETICLE_RAW_DIAMETER_M;
    const baseScale = (reticle.userData && isFinite(reticle.userData.baseScale)) ? reticle.userData.baseScale : 1.0;
    const maxScale = baseScale * RETICLE_MAX_SCALE_MULT;
    const finalScale = Math.max(baseScale, Math.min(maxScale, needScale));

    // Best-effort smoothing to reduce visible popping on unstable hit-test.
    const cur = (reticle.scale && isFinite(reticle.scale.x)) ? reticle.scale.x : baseScale;
    const smoothed = cur + (finalScale - cur) * 0.25;
    reticle.scale.setScalar(smoothed);
  } catch (_) {
    // best-effort only
  }
}

function updateFlagMarkerVisibilityScale() {
  try {
    if (!state.xrSession) return;
    if (!pointsGroup || !pointsGroup.visible) return;

    // Ensure matrices are up-to-date for distance estimation.
    pointsGroup.updateMatrixWorld(true);

    const theta = THREE.MathUtils.degToRad(FLAG_MARKER_TARGET_ANGULAR_DEG);
    const tanHalf = Math.tan(theta * 0.5);

    pointsGroup.traverse((o) => {
      if (o?.name !== 'flagMarker' && o?.name !== 'holeFlagMarker') return;
      __tmpMarkerWorldPos.setFromMatrixPosition(o.matrixWorld);
      const dist = __tmpCamPos.distanceTo(__tmpMarkerWorldPos);
      if (!isFinite(dist) || dist <= 0) return;

      // Desired diameter grows linearly with distance to keep constant angular size.
      const desiredDiameter = 2 * dist * tanHalf;
      const needScale = desiredDiameter / FLAG_MARKER_RAW_DIAMETER_M;
      const baseScale = (o.userData && isFinite(o.userData.baseScale)) ? o.userData.baseScale : 1.3;
      const maxScale = baseScale * FLAG_MARKER_MAX_SCALE_MULT;
      const finalScale = Math.max(baseScale, Math.min(maxScale, needScale));
      o.scale.setScalar(finalScale);

      // Visual-only: help the bottom ring remain readable at long distances.
      // The group scale already affects the ring, but we gently boost ring size as distance grows.
      // This does NOT affect AR logic or point positions.
      const ratio = finalScale / Math.max(1e-6, baseScale);
      const ringExtra = Math.min(1.6, Math.max(1.0, 1.0 + (ratio - 1.0) * 0.35)); // +0..~60%
      const ring = o.getObjectByName && o.getObjectByName('firstRing');
      if (ring && ring.scale) ring.scale.setScalar(ringExtra);
});
  } catch (_) {
    // best-effort only
  }
}

function updateXR(frame) {
  // Center hit test (used to estimate floor height and validate floor hits)
  let gotHit = false;      // floor-like (for scanning)
  let gotHitRaw = false;   // any hit (for diagnostics)
  let hitY = null;
  let hitNormalAngle = NaN;
  let hitX = null;
  let hitZ = null;

  // XR camera vectors (for view angle / fallback projection)
  const xrCam = renderer.xr.getCamera(camera);
  const cam = xrCam.cameras && xrCam.cameras.length ? xrCam.cameras[0] : xrCam;
  __tmpCamPos.setFromMatrixPosition(cam.matrixWorld);
  __tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);

  // Angle between view ray and plane (0° = parallel to floor, 90° = straight down)
  let viewAngleToPlane = 0;
  try {
    const s = Math.max(0, Math.min(1, Math.abs(__tmpFwd.y)));
    viewAngleToPlane = Math.asin(s) * 180 / Math.PI;
  } catch (_) { viewAngleToPlane = 0; }

  if (state.hitTestSource && state.referenceSpace) {
    const hits = frame.getHitTestResults(state.hitTestSource);
    if (hits.length) {
      const pose = hits[0].getPose(state.referenceSpace);
      if (pose) {
        // Keep last hit-test result for potential WebXR Anchors creation (Patch: World Lock)
        state._lastHitTestResult = hits[0];
        gotHitRaw = true;
        __tmpHitPos.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        __tmpHitQuat.set(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w);
        hitX = __tmpHitPos.x;
        hitY = __tmpHitPos.y;
        hitZ = __tmpHitPos.z;

        // Last pose snapshot for diagnostics / future extensions
        state._lastHitPose = {
          t: performance.now(),
          x: hitX,
          y: hitY,
          z: hitZ,
          qx: __tmpHitQuat.x,
          qy: __tmpHitQuat.y,
          qz: __tmpHitQuat.z,
          qw: __tmpHitQuat.w,
        };

        // Diagnostic normal angle (do NOT rely on this as the only floor gate)
        __tmpUp.set(0, 1, 0).applyQuaternion(__tmpHitQuat);
        try {
          const dot = Math.max(-1, Math.min(1, __tmpUp.y));
          hitNormalAngle = Math.acos(dot) * 180 / Math.PI;
        } catch (_) { hitNormalAngle = NaN; }

        // For the scanning phase, keep a conservative horizontal preference to avoid locking to walls.
        if (__tmpUp.y >= 0.75) {
          gotHit = true;
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
      const p10 = p(0.10);
      const p80 = p(0.80);
      state.floorYEstimate = p20;

      // Consider floor stable when spread is small and enough samples collected
      const spread = (p80 != null && p20 != null) ? (p80 - p20) : 999;
      if ((sorted.length >= 12 && spread < 0.04) || sorted.length >= 25) {
        state.floorLocked = true;
        state.floorStable = true;
        // Patch: Floor Lock 2.0 may slightly bias the locked Y downward (up to 1.5 cm)
        // to reduce the perceived "hover" without breaking the default pipeline.
        let yLock = p20;
        if (state.floorLock2Enabled && p10 != null && isFinite(p10)) {
          const d = Math.max(0, yLock - p10);
          yLock = yLock - Math.min(d, 0.015);
        }
        state.floorY = yLock;

        // Reset lock2 gating samples once we have a locked floor.
        if (state.floorLock2Enabled) {
          state._lock2ReticleSamples = [];
          state._lock2LastGateMsgT = 0;
        }

        // Patch 2: initialize plane refinement reference height
        try {
          const pr = state.planeRefine;
          if (pr && pr.enabled) {
            pr.planeYRef = state.floorY;
            pr.lastPlaneUpdateT = performance.now();
            pr.lastRefineT = 0;
            pr.freezeUntil = 0;
            pr.framesT.length = 0;
            pr.validT.length = 0;
            pr.validHit = false;
            pr.frozen = false;
          }
        } catch (_) {}

        // Switch to drawing phase (match app: + appears after scanning/floor lock)
        state.phase = 'ar_draw';
        show(UI.scanHint, false);
        // Keep bottom menu hidden until contour is closed; show a clear hint for contour placement.
        if (!state.hasEverClosedContour) {
          show(UI.contourHint, true);
        }
        show(UI.arBottomCenter, true);
        show(UI.btnArAdd, true);
        show(UI.btnArOk, false);

        // Patch: attempt to start WebXR world anchor once the floor is locked (anchors=1)
        _worldAnchorStartFromLastHit();
      }
    }
  }

  
  // Patch 2: continuous refinement (reference plane tracking + freeze heuristics)
  let validFloorHit = false;
  let refineFrozen = false;
  try {
    const pr = state.planeRefine;
    if (state.floorLocked && pr && pr.enabled) {
      const now = performance.now();
      if (pr.planeYRef == null || !isFinite(pr.planeYRef)) pr.planeYRef = state.floorY;

      // Maintain rolling window of frame timestamps (for valid ratio)
      pr.framesT.push(now);
      while (pr.framesT.length && pr.framesT[0] < (now - 1000)) pr.framesT.shift();

      const dy = (gotHitRaw && hitY != null) ? Math.abs(hitY - pr.planeYRef) : 999;
      const heightTol = pr.heightTolM;
      const angleOk = viewAngleToPlane >= pr.minAngleDeg;
      validFloorHit = !!(gotHitRaw && hitY != null && dy <= heightTol && angleOk);
      if (validFloorHit) pr.validT.push(now);
      while (pr.validT.length && pr.validT[0] < (now - 1000)) pr.validT.shift();

      const framesN = pr.framesT.length;
      const ratio = (framesN >= 10) ? (pr.validT.length / Math.max(1, framesN)) : 1;
      const needFreeze = (viewAngleToPlane < pr.freezeAngleDeg) || ((framesN >= 10) && (ratio < pr.minValidRatio));
      if (needFreeze) pr.freezeUntil = Math.max(pr.freezeUntil || 0, now + pr.freezeHoldMs);
      refineFrozen = now < (pr.freezeUntil || 0);

      // Update reference height slowly (does not move geometry in Patch 2)
      if (!refineFrozen && validFloorHit && (now - (pr.lastRefineT || 0)) >= pr.refineIntervalMs) {
        pr.lastRefineT = now;
        const dt = Math.max(0.016, Math.min(0.2, (now - (pr.lastPlaneUpdateT || now)) / 1000));
        pr.lastPlaneUpdateT = now;

        // Simple EMA with a speed limit (~5 cm/s)
        const alpha = 0.25;
        const target = hitY;
        const proposed = pr.planeYRef + (target - pr.planeYRef) * alpha;
        const maxMove = 0.05 * dt;
        let move = proposed - pr.planeYRef;
        if (move > maxMove) move = maxMove;
        if (move < -maxMove) move = -maxMove;
        pr.planeYRef = pr.planeYRef + move;
      }

      pr.viewAngleDeg = viewAngleToPlane;
      pr.validHit = validFloorHit;
      pr.frozen = refineFrozen;
    }
  } catch (_) {}

// Reticle placement: project to the active floor plane (prevents sticking to walls)
  const activeY = state.floorLocked ? state.floorY : (state.floorYEstimate != null ? state.floorYEstimate : hitY);

  let reticleOk = false;
  if (activeY != null && __tmpFwd.y < -0.02) {
    // Prefer using the hit position (XZ) when it matches the floor height reference;
    // otherwise fall back to ray ∩ plane (Y=activeY).
    let useHit = false;
    if (state.floorLocked) {
      // Use refined reference height for matching, but keep geometry anchored to state.floorY.
      const pr = state.planeRefine;
      const yRef = (pr && pr.enabled && isFinite(pr.planeYRef)) ? pr.planeYRef : state.floorY;
      const tol = (pr && pr.enabled) ? pr.heightTolMaxM : 0.08;
      if (gotHitRaw && hitY != null && Math.abs(hitY - yRef) <= tol) {
        useHit = true;
      }
    }

    if (useHit && hitX != null && hitZ != null) {
      reticle.position.set(hitX, activeY, hitZ);
      reticle.quaternion.set(0, 0, 0, 1);
      reticle.visible = true;
      reticleOk = true;
    } else {
      const t = (activeY - __tmpCamPos.y) / __tmpFwd.y;
      if (t > 0.05 && t < 12.0) {
        reticle.position.copy(__tmpCamPos).addScaledVector(__tmpFwd, t);
        reticle.position.y = activeY;
        reticle.quaternion.set(0, 0, 0, 1);
        reticle.visible = true;
        reticleOk = true;
      }
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

  // Visual-only: keep the scanning reticle readable when projecting far away.
  // This does not affect hit-test, floor lock, or point placement.
  updateReticleVisibilityScale();

  // Patch: record reticle stability samples for Floor Lock 2.0 gating
  _lock2RecordReticleSample();

  // Patch: record reticle samples for Floor Lock 2.0 gating (does not affect default flow)
  _lock2RecordReticleSample();


  // AR debug sample (Patch 2): record hit-test stability without changing behavior
  if (state.debugAR && state.debugAR.enabled) {
    try {
      const dx = reticle.visible ? (reticle.position.x - __tmpCamPos.x) : 0;
      const dy = reticle.visible ? (reticle.position.y - __tmpCamPos.y) : 0;
      const dz = reticle.visible ? (reticle.position.z - __tmpCamPos.z) : 0;
      const dist = reticle.visible ? Math.sqrt(dx*dx + dy*dy + dz*dz) : NaN;

      const mode = (reticle.visible ? ( (gotHitRaw && hitY != null) ? 'hit' : 'fallback_y_plane') : 'none');

      _arDebugRecordSample({
        t: performance.now(),
        gotHit: !!gotHitRaw,
        validHit: !!validFloorHit,
        frozen: !!refineFrozen,
        viewAngleDeg: viewAngleToPlane,
        reticleOk: !!reticle.visible,
        mode,
        x: reticle.visible ? reticle.position.x : NaN,
        y: reticle.visible ? reticle.position.y : NaN,
        z: reticle.visible ? reticle.position.z : NaN,
        dist,
        normalAngle: (isFinite(hitNormalAngle) ? hitNormalAngle : NaN),
      });

      _arDebugUpdateOverlay();
    } catch (_) {}
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

  // Visual-only: keep contour markers readable at long distances (especially outdoors).
  updateFlagMarkerVisibilityScale();

  // Patch 2: keep reticle visibility based on projected placement (hit or fallback), not raw hit-test.
  state.reticleVisible = !!reticle.visible;

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
  // Reuse XR camera computed at the beginning of updateXR(); do not redeclare.
  _worldAnchorUpdateFromFrame(frame);
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

ensureArFinalControlsBound();

UI.btnQuickArToggle?.addEventListener('click', () => {
  toggleQuickLaunchExpanded();
});

UI.catalogSearch?.addEventListener('input', () => {
  const q = UI.catalogSearch.value.trim().toLowerCase();
  if (!q) renderCatalog(state.shapes, { UI, onShapeSelect: (shapeId) => openDetail(shapeId) });
  else renderCatalog(state.shapes.filter(s => (s.name || '').toLowerCase().includes(q)), { UI, onShapeSelect: (shapeId) => openDetail(shapeId) });
});

UI.btnDetailBack?.addEventListener('click', () => {
  setActiveScreen('catalog', UI);
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

function normalizeTextureRotationDeg(value, preserveFullCircle = false) {
  let deg = Number(value);
  if (!Number.isFinite(deg)) deg = 0;
  if (preserveFullCircle && Math.abs(deg - 360) < 0.0001) return 360;
  deg = deg % 360;
  if (deg < 0) deg += 360;
  if (Math.abs(deg) < 0.0001) deg = 0;
  return deg;
}

function setRotationPanelOpen(open) {
  const next = !!open && state.phase === 'ar_final';
  state.rotationPanelOpen = next;
  if (UI.rotationPanel) show(UI.rotationPanel, next);
  if (UI.btnTextureRotate) {
    UI.btnTextureRotate.classList.toggle('active', next);
    UI.btnTextureRotate.setAttribute('aria-expanded', next ? 'true' : 'false');
  }
  updateArBottomStripVar(UI);
}

function applyTextureRotationDeg(value, opts = {}) {
  return setTextureRotationDeg(normalizeTextureRotationDeg(value, !!opts.preserveFullCircle), { preserveFullCircle: !!opts.preserveFullCircle });
}

function stepTextureRotation(deltaDeg) {
  const base = normalizeTextureRotationDeg(state.textureRotationDeg);
  return applyTextureRotationDeg(base + deltaDeg);
}

UI.btnEditShape?.addEventListener('click', () => {
  // return to drawing mode, keep points
  show(UI.finalColors, false);
  // Do not re-show the initial contour hint: the user is already in the flow.
  show(UI.contourHint, false);
  setRotationPanelOpen(false);
  // While placing points, hide the main bottom menu so it doesn't overlap the "+" button.
  show(UI.finalBar, false);
  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);

  state.closed = false;
  state.phase = 'ar_draw';
  // In the reference app, changing the outer shape resets any existing cutouts.
  state.holes = [];
  state.holePoints = [];

  show(UI.postCloseBar, false);
  show(UI.btnArAdd, true);
  show(UI.btnArOk, state.points.length >= 3);
  show(UI.arBottomCenter, true);

  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: false });
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
  show(UI.contourHint, false);
  setRotationPanelOpen(false);
  // While placing points, hide the main bottom menu so it doesn't overlap the "+" button.
  show(UI.finalBar, false);
  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);

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

  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: true });
  // restore guides
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';
});

function ensureArFinalControlsBound() {
  if (UI.btnTextureRotate && !UI.btnTextureRotate.__arBound) {
    UI.btnTextureRotate.addEventListener('click', () => {
      const shouldOpen = UI.rotationPanel ? UI.rotationPanel.hidden : !state.rotationPanelOpen;
      setRotationPanelOpen(shouldOpen);
    });
    UI.btnTextureRotate.__arBound = true;
  }

  if (UI.btnRotateMinus && !UI.btnRotateMinus.__arBound) {
    UI.btnRotateMinus.addEventListener('click', () => {
      stepTextureRotation(-15);
    });
    UI.btnRotateMinus.__arBound = true;
  }

  if (UI.btnRotatePlus && !UI.btnRotatePlus.__arBound) {
    UI.btnRotatePlus.addEventListener('click', () => {
      stepTextureRotation(15);
    });
    UI.btnRotatePlus.__arBound = true;
  }

  if (UI.btnRotationReset && !UI.btnRotationReset.__arBound) {
    UI.btnRotationReset.addEventListener('click', () => {
      applyTextureRotationDeg(0);
    });
    UI.btnRotationReset.__arBound = true;
  }

  if (UI.rotationSlider && !UI.rotationSlider.__arBound) {
    UI.rotationSlider.addEventListener('input', (ev) => {
      const rawValue = ev && ev.target ? ev.target.value : UI.rotationSlider.value;
      applyTextureRotationDeg(rawValue, { preserveFullCircle: Number(rawValue) === 360 });
    });
    UI.rotationSlider.__arBound = true;
  }

  if (UI.btnShapePicker && !UI.btnShapePicker.__arBound) {
    UI.btnShapePicker.addEventListener('click', () => {
      if (!UI.shapePickerPanel || !UI.shapePickerList) return;
      setRotationPanelOpen(false);
      try {
        buildShapePickerList({
          UI,
          state,
          setShapePickerOpen: (open) => setShapePickerOpen(open, { UI, updateArTopStripVar, updateArBottomStripVar }),
          onShapeSelect: handleShapePickerSelection,
        });
      } catch (e) {
        console.warn('shape picker build failed', e);
        return;
      }
      const isOpen = !UI.shapePickerPanel.hidden && UI.shapePickerPanel.classList.contains('open');
      setShapePickerOpen(!isOpen, { UI, updateArTopStripVar, updateArBottomStripVar });
    });
    UI.btnShapePicker.__arBound = true;
  }

  if (UI.shapePickerBackdrop && !UI.shapePickerBackdrop.__arBound) {
    UI.shapePickerBackdrop.addEventListener('click', () => setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar }));
    UI.shapePickerBackdrop.__arBound = true;
  }

  if (UI.btnArSnapshot && !UI.btnArSnapshot.__arBound) {
    UI.btnArSnapshot.addEventListener('click', () => {
      handleArSnapshotRequest().catch((err) => {
        console.warn('AR snapshot request failed', err);
        openSystemScreenshotFallback();
      });
    });
    UI.btnArSnapshot.__arBound = true;
  }

  if (UI.snapshotDismissLayer && !UI.snapshotDismissLayer.__arBound) {
    UI.snapshotDismissLayer.addEventListener('click', () => {
      restoreSnapshotUi();
    });
    UI.snapshotDismissLayer.__arBound = true;
  }
}

UI.btnDone?.addEventListener('click', async () => {
  state.phase = 'ar_final';
  setRotationPanelOpen(false);
  show(UI.contourHint, false);
  show(UI.postCloseBar, false);
  show(UI.arBottomCenter, false);
  show(UI.finalBar, true);
  show(UI.finalColors, true);

  // Hide guides (points/lines/distances) in final visualization
  pointsGroup.visible = false;
  if (line) line.visible = false;
  if (UI.measureLayer) UI.measureLayer.style.display = 'none';
  clearMeasureLabels();
  updateArBottomStripVar(UI);

  rebuildFill();
  updateAreaUI();

  // Atomic Texture Apply (optional): hide fill until core maps are ready (fixes "pale first fill").
  if (state.atomicTexEnabled && typeof atomicEnsureFinalMaterialReady === 'function') {
    await atomicEnsureFinalMaterialReady();
  }

  ensureArFinalControlsBound();
  setLayout(state.layout);
  applyTextureRotationDeg(state.textureRotationDeg, { preserveFullCircle: state.textureRotationDeg === 360 });

  if (!state.arTextureRailStartShapeId) {
    state.arTextureRailStartShapeId = state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : '';
  }
  renderArTextureRail();
  ensureArTextureGroupsBuilt().catch((e) => {
    console.warn('AR texture rail build failed', e);
    renderArTextureRail();
  });

  // hide hint
  show(UI.scanHint, false);
});

window.addEventListener('resize', () => {
  updateArTopInsetVar();
  if (state.xrSession) {
    updateArTopStripVar(UI);
    updateArBottomStripVar(UI);
  } else {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    updateArTopInsetVar();
    if (state.xrSession) updateArTopStripVar(UI);
  });
  window.visualViewport.addEventListener('scroll', () => {
    updateArTopInsetVar();
    if (state.xrSession) updateArTopStripVar(UI);
  });
}

// ------------------------
// Main
// ------------------------
async function init() {
  updateArTopInsetVar();
  let data = null;
  try {
    data = await loadTiles();
  } catch (e) {
    console.error('tiles.json недоступен, приложение переведено в безопасный режим каталога:', e);
    state.tiles = [];
    state.shapes = [];
    renderCatalog([], { UI, emptyMessage: 'Каталог временно недоступен. Проверьте tiles.json и сетевые пути.' });
    setActiveScreen('catalog', UI);
    state.phase = 'catalog';
    updateArEntryUI(UI);
    return;
  }
  state.tiles = data.tiles || [];

  // load формы
  try {
    const shapesData = await loadShapes({ knownTileIds: state.tiles.map(t => t.id) });
    state.shapes = shapesData.shapes || [];
    try { buildShapePickerList({ UI, state, setShapePickerOpen: (open) => setShapePickerOpen(open, { UI, updateArTopStripVar, updateArBottomStripVar }), onShapeSelect: handleShapePickerSelection }); } catch (e) {}
  } catch (e) {
    console.warn('shapes.json не найден или повреждён — используем плитки как каталог', e);
    // fallback: каждая плитка как отдельная "форма"
    state.shapes = buildFallbackShapesFromTiles(state.tiles);
    try { buildShapePickerList({ UI, state, setShapePickerOpen: (open) => setShapePickerOpen(open, { UI, updateArTopStripVar, updateArBottomStripVar }), onShapeSelect: handleShapePickerSelection }); } catch (e) {}
  }

  // initial
  renderCatalog(state.shapes, { UI, onShapeSelect: (shapeId) => openDetail(shapeId) });
  renderQuickLaunchSection();
  setActiveScreen('catalog', UI);
  state.phase = 'catalog';

  // choose default tile
  const defaultId = state.tiles[0]?.id;
  if (defaultId) await selectTile(defaultId);

  // AR title
  if (UI.arProductTitle && state.selectedTile) UI.arProductTitle.textContent = state.selectedTile.name;

  // set initial layout and neutral texture rotation
  setLayout('straight');
  applyTextureRotationDeg(0);

  // Apply AR entry gating UI (safe on all devices)
  updateArEntryUI(UI);

  buildQuickLaunchItems().catch((e) => {
    console.warn('quick AR rail build failed', e);
    setQuickArStatus('Быстрый запуск временно недоступен.');
  });
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
async function handleShapePickerSelection(shapeId) {
  setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar });

  const targetShapeId = shapeId != null ? String(shapeId) : '';
  if (!targetShapeId) return;

  if (state.xrSession && state.phase === 'ar_final') {
    requestArTextureRailScroll(targetShapeId, { behavior: 'smooth' });
  }

  if (state.selectedShape && String(state.selectedShape.id) === targetShapeId) {
    if (state.phase === 'ar_final') renderArTextureRail();
    return;
  }

  if (state.xrSession) {
    if (state._switchingShapeInAr) return;
    state._switchingShapeInAr = true;
    const prevTileId = state.selectedTile ? state.selectedTile.id : null;
    try {
      const result = await openDetail(targetShapeId, { preserveScreen: true, keepCurrentTile: true });
      if (state.phase === 'ar_final') {
        show(UI.finalBar, true);
        show(UI.finalColors, true);
        renderArTextureRail();
        ensureArTextureGroupsBuilt().then(() => {
          requestArTextureRailScroll(targetShapeId, { behavior: 'smooth' });
        }).catch((e) => {
          console.warn('AR texture rail refresh failed', e);
          renderArTextureRail();
        });
      }
      if (result && result.defaultTile && prevTileId && result.defaultTile.id !== prevTileId) {
        // openDetail already applied the fallback/default tile; this branch only documents intent.
      }
    } catch (e) {
      console.error('in-AR shape switch failed', e);
    } finally {
      state._switchingShapeInAr = false;
    }
    return;
  }

  try {
    await openDetail(shapeId);
  } catch (e) {
    console.error('openDetail failed', e);
  }
}
