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
import { createArZoneHelpers } from './app-ar-zone-helpers.js';
import { createArCurbHelpers } from './app-ar-curb-helpers.js';
import { validateZoneContourAgainstZones, validateZoneNextSegment } from './app-ar-zone-validation-helpers.js';
import { computeZoneSnapCandidates } from './app-ar-zone-snap-helpers.js';
import { createZoneHardeningConfig, canCreateZone, canAddContourPoint, canStartHole, canAddHolePoint, describeZoneLimits } from './app-ar-zone-hardening-helpers.js';

const runtimeConfig = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
const telemetry = (typeof window !== 'undefined' && window.__APP_TELEMETRY__) ? window.__APP_TELEMETRY__ : null;
function telemetryTrack(name, props = {}) {
  try { if (telemetry && typeof telemetry.track === 'function') telemetry.track(name, props); } catch (_) {}
}
function telemetryPage(name, props = {}) {
  try { if (telemetry && typeof telemetry.trackPageView === 'function') telemetry.trackPageView(name, props); } catch (_) {}
}
function telemetryError(name, err, props = {}) {
  try { if (telemetry && typeof telemetry.trackError === 'function') telemetry.trackError(name, err, props); } catch (_) {}
}
function telemetryTrackFormChange(shape, extra = {}) {
  try {
    const payload = {
      shapeId: shape && shape.id ? String(shape.id) : '',
      shapeName: shape && shape.name ? String(shape.name) : '',
      ...extra,
    };
    telemetryTrack('form_change', payload);
  } catch (_) {}
}

function telemetryCtx(extra = {}) {
  const shapeId = (typeof state !== 'undefined' && state && state.selectedShape && state.selectedShape.id) ? String(state.selectedShape.id) : '';
  const tileId = (typeof state !== 'undefined' && state && state.selectedTile && state.selectedTile.id) ? String(state.selectedTile.id) : '';
  const phase = (typeof state !== 'undefined' && state && state.phase) ? String(state.phase) : '';
  return { shapeId, tileId, phase, ...extra };
}

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
const ADMIN_API_BASE_URL = (runtimeConfig && typeof runtimeConfig.resolveAdminApiBaseUrl === 'function')
  ? String(runtimeConfig.resolveAdminApiBaseUrl() || '').replace(/\/+$/, '') + '/'
  : '';
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

const ADMIN_SESSION_TOKEN_KEY = 'admin_jwt';
function getAdminSessionToken() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY) || '';
  } catch (_) {
    return '';
  }
}
function getAdminArRequest() {
  try {
    const q = new URLSearchParams(window.location.search || '');
    return {
      enabled: readBoolQueryFlag('admin_ar', false),
      shapeId: (q.get('shape') || '').trim(),
      textureId: (q.get('texture') || '').trim(),
    };
  } catch (_) {
    return { enabled: false, shapeId: '', textureId: '' };
  }
}
const ADMIN_AR_REQUEST = getAdminArRequest();
const ADMIN_AR_ENABLED = !!(ADMIN_AR_REQUEST.enabled && getAdminSessionToken());

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
  btnQuickArLaunch: document.getElementById('btnQuickArLaunch'),

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
  btnManagerCall: document.getElementById('btnManagerCall'),
  btnProducerSite: document.getElementById('btnProducerSite'),

  // AR
  btnArBack: document.getElementById('btnArBack'),
  btnArReset: document.getElementById('btnArReset'),
  arTop: document.querySelector('.arTop'),
  arProductTitle: document.getElementById('arProductTitle'),
  arArea: document.getElementById('arArea'),
  scanHint: document.getElementById('scanHint'),
  contourHint: document.getElementById('contourHint'),
  contourHintText: document.querySelector('#contourHint .contourHintText'),
  arDebugOverlay: document.getElementById('arDebugOverlay'),
  measureLayer: document.getElementById('measureLayer'),
  arBottomCenter: document.getElementById('arBottomCenter'),
  arDraftAssist: document.getElementById('arDraftAssist'),
  arDraftAssistHint: document.getElementById('arDraftAssistHint'),
  btnArUndo: document.getElementById('btnArUndo'),
  btnArCancelZone: document.getElementById('btnArCancelZone'),
  btnArAdd: document.getElementById('btnArAdd'),
  btnArOk: document.getElementById('btnArOk'),
  postCloseBar: document.getElementById('postCloseBar'),
  btnEditShape: document.getElementById('btnEditShape'),
  btnCutout: document.getElementById('btnCutout'),
  btnDone: document.getElementById('btnDone'),
  finalBar: document.getElementById('finalBar'),
  finalPatterns: document.getElementById('finalPatterns'),
  arZoneCompact: document.getElementById('arZoneCompact'),
  arZoneCompactTitle: document.getElementById('arZoneCompactTitle'),
  arZoneCompactMeta: document.getElementById('arZoneCompactMeta'),
  arZoneBar: document.getElementById('arZoneBar'),
  arZoneSummaryTitle: document.getElementById('arZoneSummaryTitle'),
  arZoneSummaryMeta: document.getElementById('arZoneSummaryMeta'),
  arZoneChips: document.getElementById('arZoneChips'),
  arZoneActions: document.getElementById('arZoneActions'),
  btnArZoneBarClose: document.getElementById('btnArZoneBarClose'),
  btnArZoneAddAction: document.getElementById('btnArZoneAddAction'),
  btnArZoneEdit: document.getElementById('btnArZoneEdit'),
  btnArZoneCutout: document.getElementById('btnArZoneCutout'),
  btnArZoneCurb: document.getElementById('btnArZoneCurb'),
  btnArZoneDelete: document.getElementById('btnArZoneDelete'),
  arCurbSheet: document.getElementById('arCurbSheet'),
  arCurbMeta: document.getElementById('arCurbMeta'),
  arCurbPreviewTitle: document.getElementById('arCurbPreviewTitle'),
  arCurbPreviewMeta: document.getElementById('arCurbPreviewMeta'),
  arCurbStateHint: document.getElementById('arCurbStateHint'),
  arCurbModeChips: document.getElementById('arCurbModeChips'),
  arCurbBoundaryModeSelect: document.getElementById('arCurbBoundaryModeSelect'),
  arCurbSegmentsWrap: document.getElementById('arCurbSegmentsWrap'),
  arCurbSegmentsHint: document.getElementById('arCurbSegmentsHint'),
  arCurbSegments: document.getElementById('arCurbSegments'),
  arCurbPresetChips: document.getElementById('arCurbPresetChips'),
  arCurbPresetSelect: document.getElementById('arCurbPresetSelect'),
  arCurbMaterialChips: document.getElementById('arCurbMaterialChips'),
  arCurbMaterialSelect: document.getElementById('arCurbMaterialSelect'),
  btnArCurbApply: document.getElementById('btnArCurbApply'),
  btnArCurbRemove: document.getElementById('btnArCurbRemove'),
  btnArCurbClose: document.getElementById('btnArCurbClose'),
  arZoneDeleteConfirm: document.getElementById('arZoneDeleteConfirm'),
  arZoneDeleteConfirmMeta: document.getElementById('arZoneDeleteConfirmMeta'),
  btnArZoneDeleteCancel: document.getElementById('btnArZoneDeleteCancel'),
  btnArZoneDeleteConfirm: document.getElementById('btnArZoneDeleteConfirm'),
  btnArAddZone: document.getElementById('btnArAddZone'),
  btnTextureRotate: document.getElementById('btnTextureRotate'),
  rotationPanel: document.getElementById('rotationPanel'),
  rotationPanelMeta: document.getElementById('rotationPanelMeta'),
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
  btnArCalibrate: document.getElementById('btnArCalibrate'),
  calibrationPanel: document.getElementById('calibrationPanel'),
  btnCalibrationReset: document.getElementById('btnCalibrationReset'),
  btnCalibrationCollapse: document.getElementById('btnCalibrationCollapse'),
  btnCalibrationScaleMinus: document.getElementById('btnCalibrationScaleMinus'),
  btnCalibrationScalePlus: document.getElementById('btnCalibrationScalePlus'),
  calibrationScaleValue: document.getElementById('calibrationScaleValue'),
  calibrationScaleSlider: document.getElementById('calibrationScaleSlider'),
  btnCalibrationTabScale: document.getElementById('btnCalibrationTabScale'),
  btnCalibrationTabVisual: document.getElementById('btnCalibrationTabVisual'),
  calibrationScaleSection: document.getElementById('calibrationScaleSection'),
  calibrationVisualSection: document.getElementById('calibrationVisualSection'),
  calibrationStatus: document.getElementById('calibrationStatus'),
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
  arZones: [],
  activeZoneId: '',
  _arZoneSeq: 0,
  arCurbs: [],
  activeCurbId: '',
  _arCurbSeq: 0,
  _arZoneCompat: null,
  arZoneUiBusy: false,
  arZoneDeleteConfirmOpen: false,
  arZonePanelOpen: false,
  arZoneIntroHintSeen: false,
  arCurbSheetOpen: false,
  arCurbIntroHintSeen: false,
  arCurbDraftBoundaryMode: 'outer_perimeter',
  arCurbDraftEdgeKeys: [],
  arCurbDraftPresetId: 'standard',
  arCurbDraftMaterialId: 'gray',
  arCurbDraftZoneId: '',
  arDraftZoneId: '',
  arDraftZoneOrigin: '',
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
  adminArEnabled: ADMIN_AR_ENABLED,
  adminCalibrationOpen: false,
  adminCalibrationScale: 1.0,
  adminCalibrationSaveTimer: 0,
  adminCalibrationSavePromise: null,
  adminCalibrationStatusTimer: 0,
  adminCalibrationTargetKey: '',
  adminCalibrationTab: 'scale',

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
  snapKind: 'none',
  snapPreview: null,

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

const arZoneHelpers = createArZoneHelpers({ state });
const {
  ensureSingleActiveZone,
  getZones,
  createDraftZone,
  activateZone,
  updateZone,
  setActiveZoneStatus,
  getActiveZone,
  getZoneById,
  resetToSingleZone,
  syncSelectedTileToActiveZone,
  syncRotationToActiveZone,
  getActiveZoneFillMesh,
  setActiveZoneFillMesh,
  getActiveZoneTileMaterial,
  setActiveZoneTileMaterial,
  removeZone,
  clearAllZoneRuntime,
} = arZoneHelpers;
const arCurbHelpers = createArCurbHelpers({ state });
const {
  analyzeZoneEdges,
  getOuterBoundaryEdges,
  getCurbs,
  getCurbsByZoneId,
  upsertPerimeterCurb,
  buildPerimeterCurbMesh,
  attachCurbMesh,
  removeCurb,
  removeCurbsForZone,
  clearAllCurbRuntime,
  resetCurbStorage,
} = arCurbHelpers;
void analyzeZoneEdges;
void getOuterBoundaryEdges;
void getCurbs;
void getCurbsByZoneId;
void upsertPerimeterCurb;
void buildPerimeterCurbMesh;
void attachCurbMesh;
void removeCurb;
ensureSingleActiveZone();

const AR_FILL_SURFACE_Y_OFFSET = 0.003;
const AR_CURB_PRESETS = {
  standard: { id: 'standard', label: 'Стандартный', width: 0.022, exposedHeight: 0.0055, embeddedDepth: 0.0022 },
  garden: { id: 'garden', label: 'Садовый', width: 0.02, exposedHeight: 0.0048, embeddedDepth: 0.002 },
  tall: { id: 'tall', label: 'Высокий', width: 0.026, exposedHeight: 0.007, embeddedDepth: 0.0024 },
};
const AR_CURB_MATERIALS = {
  gray: { id: 'gray', label: 'Серый', color: 0xb3b8c2, roughness: 0.86, metalness: 0.04 },
  graphite: { id: 'graphite', label: 'Графит', color: 0x5b6169, roughness: 0.9, metalness: 0.03 },
  sand: { id: 'sand', label: 'Песочный', color: 0xb89d79, roughness: 0.88, metalness: 0.02 },
};

const SNAP_DIST_M = 0.10;
const ZONE_VERTEX_SNAP_DIST_M = 0.12;
const ZONE_EDGE_SNAP_DIST_M = 0.08;
const RETICLE_SNAP_COLOR_DEFAULT = 0x2f6cff;
const RETICLE_SNAP_COLOR_ARMED = 0x36d399;
const RETICLE_SNAP_COLOR_EDGE = 0x4fd1c5;
const AR_ZONE_HARD_LIMITS = createZoneHardeningConfig({
  maxZones: 5,
  maxZonePoints: 48,
  maxHolePoints: 24,
  maxHolesPerZone: 4,
});

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
const getCompatFillMesh = () => getActiveZoneFillMesh() || fillMesh;
const setCompatFillMesh = (mesh) => {
  fillMesh = mesh || null;
  setActiveZoneFillMesh(fillMesh);
  return fillMesh;
};
const getCompatTileMaterial = () => getActiveZoneTileMaterial() || tileMaterial;
const setCompatTileMaterial = (material) => {
  tileMaterial = material || null;
  setActiveZoneTileMaterial(tileMaterial);
  return tileMaterial;
};
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
  getTileMaterial: () => getCompatTileMaterial(),
  setTileMaterial: (mat) => { setCompatTileMaterial(mat); },
  getFillMesh: () => getCompatFillMesh(),
  getPreviewPlane: () => previewPlane,
  touchMaterialTextures,
  trimTextureCaches,
  onRotationUiSync: () => { syncArZoneControlsUi(); },
});
const { setLayout, setTextureRotationDeg, selectTile: baseSelectTile, disposeSelectionRuntime } = selectionHelpers;
async function selectTile(tileOrId) {
  const result = await baseSelectTile(tileOrId);
  syncAdminCalibrationUi();
  if (state && state.selectedTile) {
    syncSelectedTileToActiveZone(state.selectedTile);
    telemetryTrack('texture_select', telemetryCtx({ selectedTileId: String(state.selectedTile.id || ''), selectedTileName: String(state.selectedTile.name || '') }));
  }
  syncArZoneControlsUi();
  renderArZoneChips();
  return result;
}

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
  getTileMaterial: () => getCompatTileMaterial(),
  getPreviewPlane: () => previewPlane,
  getFillMesh: () => getCompatFillMesh(),
  resetToSingleZone: (opts = {}) => resetToSingleZone(opts),
  hardCleanupArScene: (opts = {}) => hardCleanupArScene(opts),
});
const { checkXrSupport, cleanupXR, stopAR, fullRestartAR } = arSessionHelpers;


// ------------------------
// Geometry state adapters
// ------------------------
const computeAreaM2 = () => computeAreaM2FromContours(state.points, state.holes);
syncSelectedTileToActiveZone(state.selectedTile);
syncRotationToActiveZone(state.textureRotationDeg);

function getTileById(tileId) {
  const safeId = tileId ? String(tileId) : '';
  if (!safeId || !Array.isArray(state.tiles)) return null;
  return state.tiles.find((tile) => tile && String(tile.id) === safeId) || null;
}

function formatArZoneRotationLabel(value) {
  let deg = Number(value);
  if (!Number.isFinite(deg)) deg = 0;
  deg = Math.round(deg);
  if (deg === -0) deg = 0;
  return `${deg}°`;
}

function getArZoneTileLabel(zone) {
  if (!zone || !zone.tileId) return 'Текстура не выбрана';
  const tile = getTileById(zone.tileId);
  if (tile && tile.name) return String(tile.name);
  return 'Текстура не выбрана';
}

function getArZonePluralLabel(totalZones) {
  const n = Math.max(0, Number(totalZones) || 0);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} зона`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${n} зоны`;
  return `${n} зон`;
}

function getArZoneCompactMeta(zone) {
  const tileLabel = getArZoneTileLabel(zone);
  const rotationLabel = formatArZoneRotationLabel(zone ? zone.textureRotationDeg : state.textureRotationDeg);
  const totalZones = getZones().length;
  const zoneLabel = getArZonePluralLabel(totalZones);
  return `${tileLabel} · ${rotationLabel} · ${zoneLabel}`;
}

function getArCurbPreset(presetId) {
  const safeId = presetId ? String(presetId) : 'standard';
  return AR_CURB_PRESETS[safeId] || AR_CURB_PRESETS.standard;
}

function getArCurbMaterialDef(materialId) {
  const safeId = materialId ? String(materialId) : 'gray';
  return AR_CURB_MATERIALS[safeId] || AR_CURB_MATERIALS.gray;
}

function createArCurbMaterial(materialId) {
  const material = getArCurbMaterialDef(materialId);
  return new THREE.MeshStandardMaterial({
    color: material.color,
    roughness: Number(material.roughness),
    metalness: Number(material.metalness),
  });
}

function getPrimaryCurbForZone(zoneId) {
  const curbs = getCurbsByZoneId(zoneId);
  return curbs.length ? curbs[0] : null;
}

function getActiveZonePrimaryCurb() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return null;
  return getPrimaryCurbForZone(activeZone.id);
}

function getArCurbSummaryLabel(curb) {
  if (!curb) return 'Без бордюра';
  const preset = getArCurbPreset(curb.presetId);
  const material = getArCurbMaterialDef(curb.materialId);
  const modeLabel = String(curb.boundaryMode || '') === 'outer_segments'
    ? `Сегменты: ${Array.isArray(curb.edgeKeys) ? curb.edgeKeys.length : 0}`
    : 'Весь периметр';
  return `${preset.label} · ${material.label} · ${modeLabel}`;
}

function getOuterEdgeLabel(edge, index) {
  const safeIndex = Number(index) + 1;
  const length = Number(edge && edge.length);
  const meters = Number.isFinite(length) ? `${length.toFixed(2)} м` : '';
  return meters ? `Сегмент ${safeIndex} · ${meters}` : `Сегмент ${safeIndex}`;
}

function normalizeCurbEdgeKeysForZone(zoneId, edgeKeys) {
  const allowed = new Set(getOuterBoundaryEdges(zoneId).map((edge) => String(edge.key || '')));
  return (Array.isArray(edgeKeys) ? edgeKeys : [])
    .map((item) => String(item || ''))
    .filter((item, idx, arr) => item && allowed.has(item) && arr.indexOf(item) === idx);
}

function primeArCurbDraftForZone(zoneId, opts = {}) {
  const safeZoneId = zoneId ? String(zoneId) : '';
  if (!safeZoneId) {
    state.arCurbDraftZoneId = '';
    state.arCurbDraftBoundaryMode = 'outer_perimeter';
    state.arCurbDraftEdgeKeys = [];
    state.arCurbDraftPresetId = 'standard';
    state.arCurbDraftMaterialId = 'gray';
    return null;
  }
  const activeZone = getZoneById(safeZoneId);
  if (!activeZone) return null;
  const curb = getPrimaryCurbForZone(activeZone.id);
  const outerEdges = getOuterBoundaryEdges(activeZone.id);
  const allKeys = outerEdges.map((edge) => String(edge.key || ''));
  const nextMode = curb && curb.boundaryMode === 'outer_segments' ? 'outer_segments' : 'outer_perimeter';
  const nextKeys = curb
    ? normalizeCurbEdgeKeysForZone(activeZone.id, curb.edgeKeys)
    : allKeys.slice();
  const nextPresetId = curb && curb.presetId ? String(curb.presetId) : 'standard';
  const nextMaterialId = curb && curb.materialId ? String(curb.materialId) : 'gray';
  if (opts.force || String(state.arCurbDraftZoneId || '') !== String(activeZone.id || '')) {
    state.arCurbDraftZoneId = String(activeZone.id || '');
    state.arCurbDraftBoundaryMode = nextMode;
    state.arCurbDraftEdgeKeys = nextMode === 'outer_segments' ? nextKeys.slice() : allKeys.slice();
    state.arCurbDraftPresetId = nextPresetId;
    state.arCurbDraftMaterialId = nextMaterialId;
    return { zone: activeZone, curb, outerEdges, allKeys };
  }
  state.arCurbDraftEdgeKeys = normalizeCurbEdgeKeysForZone(activeZone.id, state.arCurbDraftEdgeKeys);
  if (!state.arCurbDraftPresetId) state.arCurbDraftPresetId = nextPresetId;
  if (!state.arCurbDraftMaterialId) state.arCurbDraftMaterialId = nextMaterialId;
  return { zone: activeZone, curb, outerEdges, allKeys };
}

function renderArCurbSegmentChips(activeZone, outerEdges) {
  if (!UI.arCurbSegments) return;
  UI.arCurbSegments.innerHTML = '';
  const isSegmentsMode = String(state.arCurbDraftBoundaryMode || '') === 'outer_segments';
  if (UI.arCurbSegmentsWrap) show(UI.arCurbSegmentsWrap, !!activeZone && isSegmentsMode);
  if (!activeZone || !isSegmentsMode) return;
  const edges = Array.isArray(outerEdges) ? outerEdges : [];
  if (!edges.length) {
    if (UI.arCurbSegmentsHint) UI.arCurbSegmentsHint.textContent = 'У этой зоны нет доступных внешних сегментов для отдельного выбора.';
    return;
  }
  if (UI.arCurbSegmentsHint) {
    UI.arCurbSegmentsHint.textContent = 'Сегменты перечислены по порядку обхода внешнего контура зоны. Общие швы между зонами сюда не попадают.';
  }
  const selected = new Set(normalizeCurbEdgeKeysForZone(activeZone.id, state.arCurbDraftEdgeKeys));
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    const key = String(edge.key || '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `arCurbSegmentChip${selected.has(key) ? ' is-active' : ''}`;
    btn.dataset.edgeKey = key;
    btn.setAttribute('aria-pressed', selected.has(key) ? 'true' : 'false');
    btn.textContent = getOuterEdgeLabel(edge, i);
    btn.title = `${selected.has(key) ? 'Убрать' : 'Добавить'} ${getOuterEdgeLabel(edge, i)} в бордюр активной зоны`;
    UI.arCurbSegments.appendChild(btn);
  }
}

function syncChoiceChipGroup(container, datasetKey, activeValue) {
  if (!container) return;
  const safeValue = activeValue == null ? '' : String(activeValue);
  const safeKey = datasetKey == null ? '' : String(datasetKey);
  const attrName = safeKey
    ? safeKey.replace(/([A-Z])/g, '-$1').toLowerCase()
    : '';
  if (!attrName) return;
  container.querySelectorAll('[data-' + attrName + ']').forEach((node) => {
    const value = node && node.dataset ? String(node.dataset[safeKey] || '') : '';
    const isActive = value === safeValue;
    node.classList.toggle('is-active', isActive);
    node.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function getDraftCurbSheetState(activeZone, curb, outerEdges) {
  const safeZone = activeZone || null;
  const boundaryMode = String(state.arCurbDraftBoundaryMode || 'outer_perimeter');
  const presetId = state.arCurbDraftPresetId ? String(state.arCurbDraftPresetId) : (curb && curb.presetId ? String(curb.presetId) : 'standard');
  const materialId = state.arCurbDraftMaterialId ? String(state.arCurbDraftMaterialId) : (curb && curb.materialId ? String(curb.materialId) : 'gray');
  const preset = getArCurbPreset(presetId);
  const material = getArCurbMaterialDef(materialId);
  const selectedKeys = safeZone
    ? normalizeCurbEdgeKeysForZone(safeZone.id, boundaryMode === 'outer_segments' ? state.arCurbDraftEdgeKeys : (Array.isArray(outerEdges) ? outerEdges.map((edge) => String(edge.key || '')) : []))
    : [];
  return { boundaryMode, preset, material, selectedKeys };
}

function syncArCurbSheetUi() {
  const activeZone = getActiveZone({ createIfMissing: false });
  const draft = activeZone ? primeArCurbDraftForZone(activeZone.id) : null;
  const curb = draft ? draft.curb : (activeZone ? getPrimaryCurbForZone(activeZone.id) : null);
  const outerEdges = draft ? draft.outerEdges : [];
  const outerKeys = draft ? draft.allKeys : [];
  const { boundaryMode, preset, material, selectedKeys } = getDraftCurbSheetState(activeZone, curb, outerEdges);
  const modeLabel = boundaryMode === 'outer_segments'
    ? (selectedKeys.length ? `Выбрано сегментов: ${selectedKeys.length}` : 'Выберите внешние сегменты')
    : 'Весь внешний периметр';
  if (UI.arCurbMeta) {
    UI.arCurbMeta.textContent = activeZone ? `${getArZoneDisplayTitle(activeZone)} · ${getArZoneTileLabel(activeZone)}` : '';
  }
  if (UI.arCurbPreviewTitle) {
    UI.arCurbPreviewTitle.textContent = `${preset.label} · ${material.label}`;
  }
  if (UI.arCurbPreviewMeta) {
    UI.arCurbPreviewMeta.textContent = activeZone
      ? `${getArZoneDisplayTitle(activeZone)} · ${modeLabel}`
      : modeLabel;
  }
  if (UI.arCurbBoundaryModeSelect) UI.arCurbBoundaryModeSelect.value = boundaryMode;
  if (UI.arCurbPresetSelect) UI.arCurbPresetSelect.value = preset.id;
  if (UI.arCurbMaterialSelect) UI.arCurbMaterialSelect.value = material.id;
  syncChoiceChipGroup(UI.arCurbModeChips, 'curbMode', boundaryMode);
  syncChoiceChipGroup(UI.arCurbPresetChips, 'curbPreset', preset.id);
  syncChoiceChipGroup(UI.arCurbMaterialChips, 'curbMaterial', material.id);
  renderArCurbSegmentChips(activeZone, outerEdges);
  if (UI.arCurbStateHint) {
    if (!activeZone) {
      UI.arCurbStateHint.textContent = 'Выберите активную зону, чтобы настроить её бордюр.';
    } else if (curb) {
      UI.arCurbStateHint.textContent = `Сейчас у зоны: ${getArCurbSummaryLabel(curb)}. Доступных внешних сегментов: ${outerEdges.length}.`;
    } else if (boundaryMode === 'outer_segments') {
      UI.arCurbStateHint.textContent = `Будут выбраны только отмеченные сегменты: ${selectedKeys.length} из ${outerEdges.length}. На общих швах бордюр не строится.`;
    } else {
      UI.arCurbStateHint.textContent = 'Сейчас у активной зоны бордюр не установлен. Применение построит бордюр по всему внешнему периметру зоны.';
    }
  }
  if (UI.btnArCurbApply) {
    const canApply = !!(activeZone && state.xrSession && state.phase === 'ar_final' && (boundaryMode !== 'outer_segments' || selectedKeys.length > 0));
    UI.btnArCurbApply.disabled = !canApply;
    UI.btnArCurbApply.textContent = boundaryMode === 'outer_segments'
      ? `Применить к зоне (${selectedKeys.length})`
      : 'Применить к зоне';
  }
  if (UI.btnArCurbRemove) {
    UI.btnArCurbRemove.disabled = !(activeZone && curb);
  }
}

function setArCurbSheetOpen(open) {
  const next = !!open && !!state.xrSession && state.phase === 'ar_final' && !!getActiveZone({ createIfMissing: false });
  state.arCurbSheetOpen = next;
  if (next) {
    setRotationPanelOpen(false);
    setCalibrationPanelOpen(false);
    if (state.arZonePanelOpen) setArZonePanelOpen(false);
    setArZoneDeleteConfirmOpen(false);
    state.arCurbIntroHintSeen = true;
    const activeZone = getActiveZone({ createIfMissing: false });
    if (activeZone) primeArCurbDraftForZone(activeZone.id, { force: true });
  } else {
    state.arCurbDraftZoneId = '';
  }
  if (UI.arCurbSheet) show(UI.arCurbSheet, next);
  syncArCurbSheetUi();
  syncArZoneControlsUi();
  try { updateArBottomStripVar(UI); } catch (_) {}
}

function maybeShowArCurbIntroHint() {
  if (state.arCurbIntroHintSeen) return;
  if (!state.xrSession || state.phase !== 'ar_final') return;
  if (!getActiveZone({ createIfMissing: false })) return;
  state.arCurbIntroHintSeen = true;
  showArRuntimeToast('Откройте «Бордюр» наверху панели зоны: можно покрыть весь внешний периметр или только выбранные внешние сегменты. На общих швах между зонами бордюр не ставится.', 3800);
}

function toggleArCurbDraftEdge(edgeKey) {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  const safeKey = edgeKey ? String(edgeKey) : '';
  if (!safeKey) return false;
  const allowed = new Set(getOuterBoundaryEdges(activeZone.id).map((edge) => String(edge.key || '')));
  if (!allowed.has(safeKey)) return false;
  state.arCurbDraftBoundaryMode = 'outer_segments';
  const current = new Set(normalizeCurbEdgeKeysForZone(activeZone.id, state.arCurbDraftEdgeKeys));
  if (current.has(safeKey)) current.delete(safeKey);
  else current.add(safeKey);
  state.arCurbDraftEdgeKeys = Array.from(current);
  syncArCurbSheetUi();
  telemetryTrack('ar_curb_segment_select', telemetryCtx({ zoneId: String(activeZone.id || ''), edgeKey: safeKey, selected: current.has(safeKey), selectedCount: state.arCurbDraftEdgeKeys.length }));
  return true;
}

function rebuildCurbsForZone(zoneId, opts = {}) {
  const activeZone = zoneId ? getZoneById(zoneId) : null;
  if (!activeZone) return false;
  const curbs = getCurbsByZoneId(activeZone.id);
  if (!curbs.length) return false;
  let rebuilt = false;
  for (const curb of curbs) {
    const preset = getArCurbPreset(curb.presetId || 'standard');
    const material = getArCurbMaterialDef(curb.materialId || 'gray');
    const boundaryMode = String(curb.boundaryMode || 'outer_perimeter');
    const edgeKeys = boundaryMode === 'outer_segments' ? normalizeCurbEdgeKeysForZone(activeZone.id, curb.edgeKeys) : null;
    const built = buildPerimeterCurbMesh(activeZone.id, {
      presetId: preset.id,
      materialId: material.id,
      boundaryMode,
      edgeKeys,
      width: preset.width,
      height: preset.exposedHeight + preset.embeddedDepth,
      yOffset: AR_FILL_SURFACE_Y_OFFSET - preset.embeddedDepth,
      surfaceY: Number(state.floorY || 0) + AR_FILL_SURFACE_Y_OFFSET,
      embeddedDepth: preset.embeddedDepth,
      exposedHeight: preset.exposedHeight,
      material: createArCurbMaterial(material.id),
    });
    if (!built || !built.curb || !built.mesh || !Array.isArray(built.edges) || !built.edges.length) {
      removeCurbsForZone(activeZone.id, { anchorGroup, disposeObject3D });
      continue;
    }
    attachCurbMesh(built.curb.id, built.mesh, { anchorGroup });
    rebuilt = true;
  }
  syncArCurbSheetUi();
  syncArZoneControlsUi();
  if (rebuilt && opts.track) telemetryTrack('ar_curb_rebuild', telemetryCtx({ zoneId: String(activeZone.id || ''), totalCurbs: getCurbs().length }));
  return rebuilt;
}

function applyPerimeterCurbToActiveZone() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone || !state.xrSession || state.phase !== 'ar_final') return false;
  const preset = getArCurbPreset(state.arCurbDraftPresetId || 'standard');
  const material = getArCurbMaterialDef(state.arCurbDraftMaterialId || 'gray');
  const boundaryMode = UI.arCurbBoundaryModeSelect && UI.arCurbBoundaryModeSelect.value === 'outer_segments' ? 'outer_segments' : 'outer_perimeter';
  const edgeKeys = boundaryMode === 'outer_segments' ? normalizeCurbEdgeKeysForZone(activeZone.id, state.arCurbDraftEdgeKeys) : null;
  if (boundaryMode === 'outer_segments' && !edgeKeys.length) {
    showArRuntimeToast('Выберите хотя бы один внешний сегмент для бордюра.', 2600);
    syncArCurbSheetUi();
    return false;
  }
  const built = buildPerimeterCurbMesh(activeZone.id, {
    presetId: preset.id,
    materialId: material.id,
    boundaryMode,
    edgeKeys,
    width: preset.width,
    height: preset.exposedHeight + preset.embeddedDepth,
    yOffset: AR_FILL_SURFACE_Y_OFFSET - preset.embeddedDepth,
    surfaceY: Number(state.floorY || 0) + AR_FILL_SURFACE_Y_OFFSET,
    embeddedDepth: preset.embeddedDepth,
    exposedHeight: preset.exposedHeight,
    material: createArCurbMaterial(material.id),
  });
  if (!built || !built.curb || !built.mesh || !Array.isArray(built.edges) || !built.edges.length) {
    showArRuntimeToast('Для этой зоны сейчас нет доступного внешнего периметра под бордюр. Общие швы между зонами не бордюрятся.', 3400);
    syncArCurbSheetUi();
    return false;
  }
  attachCurbMesh(built.curb.id, built.mesh, { anchorGroup });
  state.activeCurbId = String(built.curb.id || '');
  state.arCurbDraftZoneId = String(activeZone.id || '');
  state.arCurbDraftBoundaryMode = boundaryMode;
  state.arCurbDraftEdgeKeys = Array.isArray(built.curb.edgeKeys) ? built.curb.edgeKeys.slice() : [];
  state.arCurbDraftPresetId = preset.id;
  state.arCurbDraftMaterialId = material.id;
  syncArCurbSheetUi();
  syncArZoneControlsUi();
  telemetryTrack('ar_curb_apply', telemetryCtx({ zoneId: String(activeZone.id || ''), curbId: String(built.curb.id || ''), presetId: preset.id, materialId: material.id, edgeCount: built.edges.length, boundaryMode }));
  showArRuntimeToast(boundaryMode === 'outer_segments'
    ? `Бордюр применён на ${built.edges.length} сегм. · ${preset.label.toLowerCase()} · ${material.label.toLowerCase()}.`
    : `Бордюр применён: ${preset.label.toLowerCase()} · ${material.label.toLowerCase()}.`, 2200);
  return true;
}

function removeActiveZoneCurb() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  const removed = removeCurbsForZone(activeZone.id, { anchorGroup, disposeObject3D });
  const allKeys = getOuterBoundaryEdges(activeZone.id).map((edge) => String(edge.key || ''));
  state.arCurbDraftZoneId = String(activeZone.id || '');
  state.arCurbDraftBoundaryMode = 'outer_perimeter';
  state.arCurbDraftEdgeKeys = allKeys;
  state.arCurbDraftPresetId = 'standard';
  state.arCurbDraftMaterialId = 'gray';
  syncArCurbSheetUi();
  syncArZoneControlsUi();
  if (!removed.length) return false;
  telemetryTrack('ar_curb_remove', telemetryCtx({ zoneId: String(activeZone.id || ''), removed: removed.length }));
  showArRuntimeToast('Бордюр удалён только у активной зоны.', 2200);
  return true;
}

function maybeShowArZoneIntroHint() {
  if (state.arZoneIntroHintSeen) return;
  if (!state.xrSession || state.phase !== 'ar_final') return;
  if (!getZones().length) return;
  state.arZoneIntroHintSeen = true;
  showArRuntimeToast('Нажмите «Зоны+», чтобы добавить новую зону, переключаться между зонами и менять текстуру активной зоны в нижней ленте.', 3600);
}

function setArDraftZoneContext(origin, zoneId) {
  state.arDraftZoneOrigin = origin ? String(origin) : '';
  state.arDraftZoneId = zoneId ? String(zoneId) : '';
}

function clearArDraftZoneContext(zoneId) {
  const safeId = zoneId ? String(zoneId) : '';
  if (!safeId || String(state.arDraftZoneId || '') === safeId) {
    state.arDraftZoneOrigin = '';
    state.arDraftZoneId = '';
  }
}

function isCancelableCurrentDraftZone() {
  if (!state.xrSession) return false;
  if (!(state.phase === 'ar_draw' || state.phase === 'ar_cut')) return false;
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  if (String(state.arDraftZoneOrigin || '') !== 'add_zone') return false;
  if (!state.arDraftZoneId || String(activeZone.id || '') !== String(state.arDraftZoneId || '')) return false;
  return getZones().length > 1;
}

function syncArDraftAssistUi() {
  const canUndoContour = !!(state.xrSession && state.phase === 'ar_draw' && Array.isArray(state.points) && state.points.length > 0);
  const canUndoHole = !!(state.xrSession && state.phase === 'ar_cut' && Array.isArray(state.holePoints) && state.holePoints.length > 0);
  const canUndo = canUndoContour || canUndoHole;
  const canCancelZone = isCancelableCurrentDraftZone();
  const canShowAssist = !!(state.xrSession && (state.phase === 'ar_draw' || state.phase === 'ar_cut'));
  if (UI.arDraftAssist) show(UI.arDraftAssist, canShowAssist);
  if (UI.btnArUndo) {
    UI.btnArUndo.disabled = !canUndo;
    UI.btnArUndo.hidden = !canUndo;
    UI.btnArUndo.textContent = state.phase === 'ar_cut' ? 'Назад · вырез' : 'Назад';
    UI.btnArUndo.title = state.phase === 'ar_cut' ? 'Убрать последнюю точку текущего выреза' : 'Убрать последнюю точку контура';
  }
  if (UI.btnArCancelZone) {
    UI.btnArCancelZone.disabled = !canCancelZone;
    UI.btnArCancelZone.hidden = !canCancelZone;
    UI.btnArCancelZone.textContent = state.phase === 'ar_cut' ? 'Отменить вырез' : 'Отменить зону';
    UI.btnArCancelZone.title = canCancelZone ? 'Отменить только текущую новую зону и оставить уже готовые зоны' : 'Отменить текущую новую зону';
  }
  syncArDraftGuidanceUi();
}

function undoActiveDraftStep() {
  if (!state.xrSession) return false;
  if (state.phase === 'ar_cut') {
    if (!Array.isArray(state.holePoints) || !state.holePoints.length) return false;
    state.holePoints.pop();
    state.snapArmed = false;
    state.snapKind = 'none';
    state.snapPreview = null;
    line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: state.closed });
    rebuildFill();
    updateAreaUI();
    show(UI.btnArOk, state.holePoints.length >= 3);
    syncArDraftAssistUi();
    telemetryTrack('ar_zone_undo_point', telemetryCtx({ zoneId: String((getActiveZone({ createIfMissing: false }) || {}).id || ''), mode: 'hole', remaining: state.holePoints.length }));
    return true;
  }
  if (state.phase === 'ar_draw') {
    if (!Array.isArray(state.points) || !state.points.length) return false;
    state.points.pop();
    state.closed = false;
    state.snapArmed = false;
    state.snapKind = 'none';
    state.snapPreview = null;
    line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: false });
    pointsGroup.visible = true;
    if (line) line.visible = true;
    if (UI.measureLayer) UI.measureLayer.style.display = 'block';
    rebuildFill();
    updateAreaUI();
    show(UI.btnArOk, state.points.length >= 3);
    syncArDraftAssistUi();
    telemetryTrack('ar_zone_undo_point', telemetryCtx({ zoneId: String((getActiveZone({ createIfMissing: false }) || {}).id || ''), mode: 'contour', remaining: state.points.length }));
    return true;
  }
  return false;
}

async function cancelCurrentDraftZone() {
  if (!isCancelableCurrentDraftZone()) return false;
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  const zoneId = String(activeZone.id || '');
  telemetryTrack('ar_zone_draft_cancel', telemetryCtx({ zoneId, totalZonesBefore: getZones().length, points: state.points.length, holes: state.holes.length }));
  state.snapArmed = false;
  state.snapKind = 'none';
  state.snapPreview = null;
  if (line) {
    anchorGroup.remove(line);
    disposeObject3D(line);
    line = null;
  }
  pointsGroup.clear();
  clearMeasureLabels();
  removeCurbsForZone(activeZone.id, { anchorGroup, disposeObject3D });
  const removed = removeZone(activeZone.id, { anchorGroup, disposeObject3D, preserveMaterial: tileMaterial });
  clearArDraftZoneContext(zoneId);
  if (!removed) return false;
  const fallbackZone = getActiveZone({ createIfMissing: false }) || getZones()[0] || null;
  if (fallbackZone) {
    await activateArZoneById(fallbackZone.id, { track: false });
    setActiveZoneStatus('final');
  }
  state.phase = 'ar_final';
  state.closed = true;
  state.holePoints = [];
  show(UI.contourHint, false);
  show(UI.scanHint, false);
  show(UI.postCloseBar, false);
  show(UI.arBottomCenter, false);
  show(UI.btnArAdd, false);
  show(UI.btnArOk, false);
  show(UI.finalBar, true);
  show(UI.finalColors, true);
  pointsGroup.visible = false;
  if (UI.measureLayer) UI.measureLayer.style.display = 'none';
  syncArDraftAssistUi();
  updateArBottomStripVar(UI);
  updateAreaUI();
  renderArZoneChips();
  syncArZoneControlsUi();
  showArRuntimeToast('Текущая новая зона отменена. Уже готовые зоны сохранены.', 2400);
  telemetryTrack('ar_zone_draft_cancel_done', telemetryCtx({ zoneId, totalZonesAfter: getZones().length, activeZoneId: String((fallbackZone || {}).id || '') }));
  return true;
}

function setArZonePanelOpen(open) {
  const canOpen = !!state.xrSession && state.phase === 'ar_final' && getZones().length > 0;
  const next = !!open && canOpen;
  state.arZonePanelOpen = next;
  if (next) {
    setRotationPanelOpen(false);
    setCalibrationPanelOpen(false);
    if (state.arCurbSheetOpen) setArCurbSheetOpen(false);
    setArZoneDeleteConfirmOpen(false);
    try { setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar }); } catch (_) {}
    state.arZoneIntroHintSeen = true;
  }
  updateArZoneBarVisibility();
  syncArZoneControlsUi();
  syncArDraftAssistUi();
  updateArBottomStripVar(UI);
}

function syncArZoneControlsUi() {
  const zone = getActiveZone({ createIfMissing: false });
  const zoneTitle = getArZoneDisplayTitle(zone);
  const zoneStatus = zone && zone.status ? String(zone.status) : '';
  const tileLabel = getArZoneTileLabel(zone);
  const rotationLabel = formatArZoneRotationLabel(zone ? zone.textureRotationDeg : state.textureRotationDeg);
  const statusLabel = zoneStatus === 'draft' ? 'В работе' : (zoneStatus === 'final' ? 'Готова' : (zoneStatus === 'mask' ? 'Вырез' : ''));
  if (UI.arZoneCompactTitle) {
    UI.arZoneCompactTitle.textContent = statusLabel ? `${zoneTitle} · ${statusLabel}` : zoneTitle;
  }
  if (UI.arZoneCompactMeta) {
    UI.arZoneCompactMeta.textContent = getArZoneCompactMeta(zone);
  }
  if (UI.arZoneSummaryTitle) {
    UI.arZoneSummaryTitle.textContent = statusLabel ? `${zoneTitle} · ${statusLabel}` : zoneTitle;
  }
  if (UI.arZoneSummaryMeta) {
    const totalZones = getZones().length;
    const curbLabel = zone ? getArCurbSummaryLabel(getPrimaryCurbForZone(zone.id)) : 'Без бордюра';
    const extra = totalZones > 1 ? ` · Всего зон: ${totalZones}` : '';
    UI.arZoneSummaryMeta.textContent = `${tileLabel} · Вращение ${rotationLabel} · Бордюр: ${curbLabel}${extra}`;
  }
  if (UI.rotationPanelMeta) {
    UI.rotationPanelMeta.textContent = `${zoneTitle} · ${tileLabel}`;
  }
  if (UI.rotationHint) {
    UI.rotationHint.textContent = `Поворот применяется только к активной зоне. ${zoneTitle} сейчас использует угол ${rotationLabel}; остальные зоны сохраняют свои настройки.`;
  }
  if (UI.arZoneChips) {
    const activeChip = UI.arZoneChips.querySelector('.arZoneChip.is-active');
    if (activeChip) {
      const chipLabel = activeChip.querySelector('.arZoneChip__label');
      const chipMeta = activeChip.querySelector('.arZoneChip__meta');
      if (chipLabel) chipLabel.textContent = zoneTitle;
      if (chipMeta) chipMeta.textContent = `${tileLabel} · ${rotationLabel}`;
    }
  }
  if (UI.btnTextureRotate) {
    UI.btnTextureRotate.setAttribute('aria-label', `Вращение текстуры для ${zoneTitle}, текущий угол ${rotationLabel}`);
    UI.btnTextureRotate.title = `${zoneTitle} · ${rotationLabel}`;
  }
  if (UI.btnArAddZone || UI.btnArZoneAddAction) {
    const allowance = getZoneCreationAllowance();
    const canManageZones = !!(state.xrSession && state.phase === 'ar_final' && getZones().length > 0);
    if (UI.btnArAddZone) {
      UI.btnArAddZone.disabled = !canManageZones || !!state.arZoneUiBusy;
      UI.btnArAddZone.classList.toggle('active', !!state.arZonePanelOpen && canManageZones);
      UI.btnArAddZone.setAttribute('aria-expanded', state.arZonePanelOpen ? 'true' : 'false');
      const zoneCount = getZones().length;
      UI.btnArAddZone.title = canManageZones ? (state.arZonePanelOpen ? `Скрыть управление зонами (${getArZonePluralLabel(zoneCount)})` : `Открыть управление зонами (${getArZonePluralLabel(zoneCount)})`) : 'Управление зонами недоступно';
    }
    if (UI.btnArZoneAddAction) {
      const canAddZone = !!(state.xrSession && state.phase === 'ar_final' && allowance.ok && !state.arZoneUiBusy);
      UI.btnArZoneAddAction.disabled = !canAddZone;
      UI.btnArZoneAddAction.textContent = allowance.ok ? 'Добавить зону' : `Лимит зон: ${allowance.maxZones}`;
      if (allowance.ok) {
        UI.btnArZoneAddAction.title = `Добавить новую независимую зону мощения (${allowance.total}/${allowance.maxZones})`;
      } else {
        UI.btnArZoneAddAction.title = `Достигнут лимит зон: ${allowance.maxZones}. Для стабильной работы оставляем ${getArZoneHardLimitSummary()}.`;
      }
    }
  }
  const zoneActionsEnabled = !!(zone && state.xrSession && state.phase === 'ar_final');
  if (UI.arZoneActions) show(UI.arZoneActions, zoneActionsEnabled);
  if (UI.btnArZoneEdit) {
    UI.btnArZoneEdit.disabled = !zoneActionsEnabled;
    UI.btnArZoneEdit.textContent = zone ? `Изменить · ${zoneTitle}` : 'Изменить зону';
    UI.btnArZoneEdit.title = zone ? `Редактировать контур зоны «${zoneTitle}»` : 'Редактировать активную зону';
  }
  if (UI.btnArZoneCutout) {
    UI.btnArZoneCutout.disabled = !zoneActionsEnabled;
    UI.btnArZoneCutout.textContent = zone ? `Вырез · ${zoneTitle}` : 'Вырез в зоне';
    UI.btnArZoneCutout.title = zone ? `Добавить вырез в зоне «${zoneTitle}»` : 'Добавить вырез в активной зоне';
  }
  if (UI.btnArZoneCurb) {
    UI.btnArZoneCurb.disabled = !zoneActionsEnabled;
    UI.btnArZoneCurb.textContent = 'Бордюр';
    const curb = zone ? getPrimaryCurbForZone(zone.id) : null;
    const curbSummary = zone ? getArCurbSummaryLabel(curb) : 'Без бордюра';
    UI.btnArZoneCurb.title = zone ? `Настроить бордюр для зоны «${zoneTitle}». Сейчас: ${curbSummary}.` : 'Настроить бордюр активной зоны';
    UI.btnArZoneCurb.classList.toggle('is-active', !!(state.arCurbSheetOpen || curb));
  }
  if (UI.btnArZoneDelete) {
    UI.btnArZoneDelete.disabled = !zoneActionsEnabled || !!state.arZoneDeleteConfirmOpen;
    UI.btnArZoneDelete.title = zone ? `Удалить зону «${zoneTitle}»` : 'Удалить активную зону';
  }
  syncArCurbSheetUi();
}

function updateArZoneBarVisibility() {
  const hasZones = !!state.xrSession && state.phase === 'ar_final' && getZones().length > 0;
  if (!hasZones) {
    state.arZonePanelOpen = false;
    state.arCurbSheetOpen = false;
  }
  if (UI.arZoneCompact) show(UI.arZoneCompact, hasZones);
  if (UI.arZoneBar) show(UI.arZoneBar, hasZones && !!state.arZonePanelOpen);
  if (hasZones) syncArZoneControlsUi();
  syncArDraftAssistUi();
}


function getOrderedArZones() {
  return getZones().filter(Boolean);
}

function getArZoneDisplayIndex(zoneOrId) {
  const zoneId = zoneOrId && typeof zoneOrId === 'object' ? String(zoneOrId.id || '') : String(zoneOrId || '');
  if (!zoneId) return -1;
  const zones = getOrderedArZones();
  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    if (zone && String(zone.id || '') === zoneId) return index;
  }
  return -1;
}

function getArZoneDisplayLabel(zoneOrId) {
  const index = getArZoneDisplayIndex(zoneOrId);
  return index >= 0 ? `Зона ${index + 1}` : 'Зона';
}

function getArZoneDisplayTitle(zone) {
  if (!zone) return 'Зона';
  return getArZoneDisplayLabel(zone);
}

function getArDraftAssistHintText() {
  if (!state.xrSession) return '';
  if (state.phase === 'ar_cut') {
    const count = Array.isArray(state.holePoints) ? state.holePoints.length : 0;
    return count > 0
      ? 'Продолжайте контур выреза или замкните его у первой точки.'
      : 'Поставьте первую точку выреза кнопкой «+».';
  }
  if (state.phase !== 'ar_draw') return '';
  const activeZone = getActiveZone({ createIfMissing: false });
  const zoneTitle = activeZone ? getArZoneDisplayTitle(activeZone) : 'Новая зона';
  const count = Array.isArray(state.points) ? state.points.length : 0;
  if (isCancelableCurrentDraftZone()) {
    return count > 0
      ? `${zoneTitle}: продолжайте контур или замкните зону у первой точки.`
      : `${zoneTitle}: поставьте первую точку новой зоны кнопкой «+».`;
  }
  return count > 0
    ? 'Продолжайте контур или замкните фигуру у первой точки.'
    : 'Поставьте следующую точку контура кнопкой «+».';
}

function syncArDraftGuidanceUi() {
  const assistVisible = !!(UI.arDraftAssist && !UI.arDraftAssist.hidden);
  const drawLikePhase = !!(state.xrSession && (state.phase === 'ar_draw' || state.phase === 'ar_cut'));
  const hintText = getArDraftAssistHintText();
  if (UI.arDraftAssistHint) {
    UI.arDraftAssistHint.textContent = hintText;
    UI.arDraftAssistHint.hidden = !assistVisible || !hintText;
  }
  if (UI.contourHintText && drawLikePhase && !assistVisible && hintText) {
    UI.contourHintText.textContent = hintText;
  }
  if (UI.contourHint && assistVisible) show(UI.contourHint, false);
}

function renderArZoneChips() {
  if (!UI.arZoneChips) return;
  const zones = getZones();
  UI.arZoneChips.innerHTML = '';
  if (!zones.length) {
    updateArZoneBarVisibility();
    return;
  }
  let activeBtn = null;
  zones.forEach((zone, index) => {
    if (!zone) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arZoneChip';
    const isActive = String(zone.id) === String(state.activeZoneId || '');
    if (isActive) {
      btn.classList.add('is-active');
      activeBtn = btn;
    }
    const status = zone.status ? String(zone.status) : 'draft';
    btn.dataset.zoneId = String(zone.id);
    btn.dataset.status = status;
    const label = document.createElement('span');
    label.className = 'arZoneChip__label';
    label.textContent = getArZoneDisplayTitle(zone);
    const meta = document.createElement('span');
    meta.className = 'arZoneChip__meta';
    meta.textContent = `${getArZoneTileLabel(zone)} · ${formatArZoneRotationLabel(zone.textureRotationDeg || 0)}`;
    btn.appendChild(label);
    btn.appendChild(meta);
    if (status !== 'final') btn.title = `${label.textContent} · зона в работе`;
    if (state.arZoneUiBusy || state.phase !== 'ar_final') btn.disabled = true;
    btn.addEventListener('click', async () => {
      if (state.arZoneUiBusy) return;
      if (String(zone.id) === String(state.activeZoneId || '')) return;
      await activateArZoneById(zone.id, { track: true });
    });
    UI.arZoneChips.appendChild(btn);
  });
  updateArZoneBarVisibility();
  if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
    try {
      requestAnimationFrame(() => {
        try { activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (_) {}
      });
    } catch (_) {}
  }
}

function syncSelectedTileUiOnly(tile) {
  state.selectedTile = tile || null;
  if (UI.arProductTitle && state.selectedTile) UI.arProductTitle.textContent = state.selectedTile.name;
  renderArTextureRail();
  syncAdminCalibrationUi();
  syncArZoneControlsUi();
}

async function activateArZoneById(zoneId, opts = {}) {
  const zone = activateZone(zoneId);
  if (!zone) return null;
  state.arZoneUiBusy = true;
  renderArZoneChips();
  try {
    setCompatFillMesh(zone.fillMesh || null);
    setCompatTileMaterial(zone.tileMaterial || null);
    const tile = getTileById(zone.tileId);
    if (zone.tileMaterial && tile) {
      syncSelectedTileUiOnly(tile);
    } else if (tile) {
      await selectTile(tile.id);
    } else if (state.selectedTile) {
      syncSelectedTileToActiveZone(state.selectedTile);
    }
    applyTextureRotationDeg(zone.textureRotationDeg || 0, { preserveFullCircle: Number(zone.textureRotationDeg) === 360 });
    if (state.phase === 'ar_final') {
      show(UI.finalColors, true);
      show(UI.finalBar, true);
      updateArBottomStripVar(UI);
    }
    syncArZoneControlsUi();
    if (state.arCurbSheetOpen) syncArCurbSheetUi();
    if (opts.track) telemetryTrack('ar_zone_select', telemetryCtx({ zoneId: String(zone.id), totalZones: getZones().length }));
    return zone;
  } finally {
    state.arZoneUiBusy = false;
    renderArZoneChips();
    syncArZoneControlsUi();
  }
}

function showArRuntimeToast(message, durationMs = 2200) {
  const text = String(message || '').trim();
  if (!text) return;
  try {
    showSnapshotToast(text, durationMs);
  } catch (_) {
    try { window.alert(text); } catch (_) {}
  }
}

function getArZoneHardLimitSummary() {
  return describeZoneLimits(AR_ZONE_HARD_LIMITS);
}

function getZoneCreationAllowance() {
  return canCreateZone(getZones(), AR_ZONE_HARD_LIMITS);
}

function getContourPointAllowance() {
  return canAddContourPoint(state.points, AR_ZONE_HARD_LIMITS);
}

function getHoleStartAllowance() {
  return canStartHole(state.holes, AR_ZONE_HARD_LIMITS);
}

function getHolePointAllowance() {
  return canAddHolePoint(state.holePoints, AR_ZONE_HARD_LIMITS);
}

function pruneArRuntimeCaches() {
  try {
    const protectedMaterials = [tileMaterial, previewPlane?.material, fillMesh?.material].filter(Boolean);
    trimTextureCaches({
      maxEntries: 28,
      maxAgeMs: 180000,
      protected: protectedMaterials,
    });
  } catch (_) {}
}

function trackArZoneRuntimeCleanup(reason, extra = {}) {
  try {
    telemetryTrack('ar_zone_runtime_cleanup', telemetryCtx({
      reason: String(reason || 'unknown'),
      totalZones: getZones().length,
      ...extra,
    }));
  } catch (_) {}
}

function buildZoneSnapPreview(localPoint) {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone || !localPoint || state.phase !== 'ar_draw' || state.closed) {
    return { armed: false, kind: 'none', point: localPoint || null };
  }
  const candidateZones = getZones().filter((zone) => {
    if (!zone) return false;
    if (String(zone.id || '') === String(activeZone.id || '')) return false;
    return Array.isArray(zone.points) && zone.points.length >= 2;
  });
  const snapCandidates = computeZoneSnapCandidates({
    point: localPoint,
    zones: candidateZones,
    excludeZoneId: activeZone.id,
    vertexThreshold: ZONE_VERTEX_SNAP_DIST_M,
    edgeThreshold: ZONE_EDGE_SNAP_DIST_M,
  });
  if (!Array.isArray(snapCandidates) || !snapCandidates.length || !Array.isArray(state.points) || state.points.length < 1) {
    return snapCandidates && snapCandidates.length ? snapCandidates[0] : { armed: false, kind: 'none', point: localPoint || null };
  }
  for (const preview of snapCandidates) {
    if (!preview || !preview.armed || !preview.point) continue;
    const segmentValidation = validateZoneNextSegment({
      currentPoints: state.points,
      nextPoint: preview.point,
      zones: candidateZones,
      excludeZoneId: activeZone.id,
    });
    if (!segmentValidation || segmentValidation.ok) return preview;
  }
  return { armed: false, kind: 'none', point: localPoint || null };
}

function setZoneSnapPreview(preview) {
  if (preview && preview.armed && preview.point) {
    state.snapPreview = {
      armed: true,
      kind: preview.kind || 'vertex',
      point: preview.point.clone ? preview.point.clone() : preview.point,
      zoneId: preview.zoneId ? String(preview.zoneId) : '',
      zoneTitle: preview.zoneTitle ? String(preview.zoneTitle) : '',
      edgeIndex: Number.isFinite(Number(preview.edgeIndex)) ? Number(preview.edgeIndex) : -1,
      vertexIndex: Number.isFinite(Number(preview.vertexIndex)) ? Number(preview.vertexIndex) : -1,
      distanceM: Number.isFinite(Number(preview.distanceM)) ? Number(preview.distanceM) : NaN,
    };
    state.snapKind = state.snapPreview.kind;
    state.snapArmed = true;
    return state.snapPreview;
  }
  state.snapPreview = null;
  state.snapKind = 'none';
  state.snapArmed = false;
  return null;
}

function getReticleSnapColor() {
  if (state.snapKind === 'edge') return RETICLE_SNAP_COLOR_EDGE;
  if (state.snapKind === 'vertex' || state.snapKind === 'close') return RETICLE_SNAP_COLOR_ARMED;
  return RETICLE_SNAP_COLOR_DEFAULT;
}

function validateActiveZoneContour() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone || !Array.isArray(state.points) || state.points.length < 3) return { ok: true, reason: '' };
  const candidateZones = getZones().filter((zone) => {
    if (!zone) return false;
    if (String(zone.id || '') === String(activeZone.id || '')) return false;
    return Array.isArray(zone.points) && zone.points.length >= 3;
  });
  return validateZoneContourAgainstZones({
    candidatePoints: state.points,
    zones: candidateZones,
    excludeZoneId: activeZone.id,
  });
}

function handleActiveZoneContourValidationFailure(result) {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!result || result.ok) return false;
  const zoneId = activeZone && activeZone.id ? String(activeZone.id) : '';
  if (result.reason === 'self_intersection') {
    telemetryTrack('ar_zone_self_intersection_blocked', telemetryCtx({ zoneId, points: state.points.length }));
    showArRuntimeToast('Контур самопересекается. Измените точки и замкните зону снова.', 2600);
    return true;
  }
  if (result.reason === 'zone_overlap') {
    telemetryTrack('ar_zone_overlap_blocked', telemetryCtx({
      zoneId,
      otherZoneId: result.otherZoneId || '',
      otherZoneTitle: result.otherZoneTitle || '',
      detail: result.detail || '',
      points: state.points.length,
    }));
    const otherTitle = result.otherZoneTitle ? ` «${result.otherZoneTitle}»` : '';
    showArRuntimeToast(`Контур зоны пересекает существующую${otherTitle}. Зоны могут примыкать, но не перекрывать друг друга.`, 3200);
    return true;
  }
  telemetryTrack('ar_zone_validation_blocked', telemetryCtx({ zoneId, reason: result.reason || 'unknown', points: state.points.length }));
  showArRuntimeToast('Не удалось замкнуть зону. Проверьте контур и попробуйте снова.', 2600);
  return true;
}

function validateActiveZoneNextPoint(candidatePoint) {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone || !Array.isArray(state.points) || state.points.length < 1) {
    return { ok: true, reason: '' };
  }
  const candidateZones = getZones().filter((zone) => {
    if (!zone) return false;
    if (String(zone.id || '') === String(activeZone.id || '')) return false;
    return Array.isArray(zone.points) && zone.points.length >= 2;
  });
  return validateZoneNextSegment({
    currentPoints: state.points,
    nextPoint: candidatePoint,
    zones: candidateZones,
    excludeZoneId: activeZone.id,
  });
}

function handleActiveZoneNextPointValidationFailure(result) {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!result || result.ok) return false;
  const zoneId = activeZone && activeZone.id ? String(activeZone.id) : '';
  if (result.reason === 'self_segment_cross') {
    telemetryTrack('ar_zone_segment_blocked', telemetryCtx({ zoneId, reason: result.reason, detail: result.detail || '', points: state.points.length }));
    showArRuntimeToast('Новая линия пересекает уже выставленный контур. Нажмите «Назад», чтобы убрать последнюю точку, и продолжайте по свободной кромке.', 3200);
    return true;
  }
  if (result.reason === 'zone_segment_cross' || result.reason === 'inside_other_zone') {
    telemetryTrack('ar_zone_segment_blocked', telemetryCtx({
      zoneId,
      reason: result.reason,
      detail: result.detail || '',
      otherZoneId: result.otherZoneId || '',
      otherZoneTitle: result.otherZoneTitle || '',
      points: state.points.length,
    }));
    const otherTitle = result.otherZoneTitle ? ` «${result.otherZoneTitle}»` : '';
    showArRuntimeToast(`Нельзя провести линию через границу зоны${otherTitle}. Нажмите «Назад» и стыкуйте контур по внешней стороне или по общей кромке.`, 3400);
    return true;
  }
  telemetryTrack('ar_zone_segment_blocked', telemetryCtx({ zoneId, reason: result.reason || 'unknown', points: state.points.length }));
  showArRuntimeToast('Точку нельзя поставить в этом месте. Продолжайте контур по свободной стороне.', 2600);
  return true;
}

function beginAddArZone() {
  if (!state.xrSession || !state.floorLocked) return null;
  const allowance = getZoneCreationAllowance();
  if (!allowance.ok) {
    telemetryTrack('ar_zone_limit_reached', telemetryCtx({ totalZones: allowance.total, maxZones: allowance.maxZones }));
    showArRuntimeToast(`Достигнут лимит зон: ${allowance.maxZones}. Для стабильной работы поддерживается ${getArZoneHardLimitSummary()}.`, 3200);
    syncArZoneControlsUi();
    return null;
  }
  const zone = createDraftZone({
    tileId: state.selectedTile && state.selectedTile.id ? String(state.selectedTile.id) : '',
    textureRotationDeg: state.textureRotationDeg || 0,
    status: 'draft',
  });
  setCompatFillMesh(null);
  setCompatTileMaterial(null);
  if (line) {
    anchorGroup.remove(line);
    disposeObject3D(line);
    line = null;
  }
  pointsGroup.clear();
  clearMeasureLabels();
  state.phase = 'ar_draw';
  setArZonePanelOpen(false);
  setArCurbSheetOpen(false);
  setRotationPanelOpen(false);
  setCalibrationPanelOpen(false);
  try { setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar }); } catch (_) {}
  show(UI.postCloseBar, false);
  show(UI.finalColors, false);
  show(UI.finalBar, false);
  show(UI.contourHint, true);
  show(UI.scanHint, false);
  show(UI.btnArAdd, true);
  show(UI.btnArOk, false);
  show(UI.arBottomCenter, true);
  pointsGroup.visible = true;
  state.snapArmed = false;
  state.snapKind = 'none';
  state.snapPreview = null;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';
  updateArBottomStripVar(UI);
  updateAreaUI();
  renderArZoneChips();
  syncArZoneControlsUi();
  setArDraftZoneContext('add_zone', zone.id);
  syncArDraftAssistUi();
  telemetryTrack('ar_zone_add_start', telemetryCtx({ zoneId: String(zone.id), totalZones: getZones().length }));
  showArRuntimeToast('Стройте новую зону как отдельный контур. Кнопка «Назад» убирает последнюю точку, а «Отменить зону» сохраняет уже готовые зоны.', 3400);
  return zone;
}

// ------------------------
// Catalog + Detail rendering (Формы -> деталка формы -> выбор цветов/текстур)
// ------------------------

function comparableTextureKey(shapeId, value) {
  if (contentIdentity && typeof contentIdentity.comparableTextureKey === 'function') {
    return contentIdentity.comparableTextureKey(shapeId, value);
  }
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function formatCalibrationScale(value) {
  const n = Number(value);
  return `${Number.isFinite(n) ? n.toFixed(2) : '1.00'}x`;
}

const ADMIN_VISUAL_CALIBRATION_SCHEMA = [
  { key: 'exposureMult', inputId: 'calibrationExposureSlider', valueId: 'calibrationExposureValue', min: 0.60, max: 1.60, step: 0.01, defaultValue: 1.0 },
  { key: 'contrast', inputId: 'calibrationContrastSlider', valueId: 'calibrationContrastValue', min: 0.70, max: 1.30, step: 0.01, defaultValue: 1.0 },
  { key: 'saturation', inputId: 'calibrationSaturationSlider', valueId: 'calibrationSaturationValue', min: 0.00, max: 1.50, step: 0.01, defaultValue: 1.0 },
  { key: 'roughnessMult', inputId: 'calibrationRoughnessSlider', valueId: 'calibrationRoughnessValue', min: 0.50, max: 1.60, step: 0.01, defaultValue: 1.0 },
  { key: 'specStrength', inputId: 'calibrationSpecSlider', valueId: 'calibrationSpecValue', min: 0.00, max: 1.20, step: 0.01, defaultValue: 1.0 },
  { key: 'normalScale', inputId: 'calibrationNormalSlider', valueId: 'calibrationNormalValue', min: 0.00, max: 2.00, step: 0.01, defaultValue: 1.0 },
  { key: 'bumpScale', inputId: 'calibrationBumpSlider', valueId: 'calibrationBumpValue', min: 0.00, max: 2.00, step: 0.01, defaultValue: 1.0 },
];
const ADMIN_VISUAL_CALIBRATION_SCHEMA_BY_KEY = new Map(ADMIN_VISUAL_CALIBRATION_SCHEMA.map((item) => [item.key, item]));

async function fetchAdminPalettePayload(shapeId, token) {
  const apiBase = String(ADMIN_API_BASE_URL || API_BASE_URL || '').trim();
  if (!apiBase) throw new Error('admin_api_missing');
  const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` });
  const url = `${apiBase.replace(/\/+$/, '')}/api/palettes/${encodeURIComponent(shapeId)}`;
  const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((json && (json.message || json.error)) || `${res.status} ${res.statusText}`);
  const { payload } = sanitizePalettePayload(json || {}, { context: url, shapeId });
  return payload;
}

function clearAdminCalibrationStatusTimer() {
  if (state.adminCalibrationStatusTimer) {
    clearTimeout(state.adminCalibrationStatusTimer);
    state.adminCalibrationStatusTimer = 0;
  }
}

function setAdminCalibrationStatus(message, kind = '', hold = false) {
  if (!UI.calibrationStatus) return;
  clearAdminCalibrationStatusTimer();
  UI.calibrationStatus.textContent = String(message || '').trim();
  UI.calibrationStatus.dataset.kind = kind || '';
  if (!hold && UI.calibrationStatus.textContent) {
    state.adminCalibrationStatusTimer = setTimeout(() => {
      try {
        UI.calibrationStatus.textContent = '';
        UI.calibrationStatus.dataset.kind = '';
      } catch (_) {}
    }, 1800);
  }
}

function getSelectedTileUvScaleValue() {
  const params = (state.selectedTile && state.selectedTile.params && typeof state.selectedTile.params === 'object') ? state.selectedTile.params : null;
  const raw = params && (params.uvScale ?? params.repeatScale);
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (raw && typeof raw === 'object') {
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0) return (x + y) / 2;
    if (Number.isFinite(x) && x > 0) return x;
    if (Number.isFinite(y) && y > 0) return y;
  }
  return 1.0;
}

function getSelectedTileVisualParamValue(key) {
  const schema = ADMIN_VISUAL_CALIBRATION_SCHEMA_BY_KEY.get(String(key || ''));
  if (!schema) return 1.0;
  const params = (state.selectedTile && state.selectedTile.params && typeof state.selectedTile.params === 'object') ? state.selectedTile.params : null;
  const raw = params ? Number(params[key]) : NaN;
  if (Number.isFinite(raw)) return clamp(raw, schema.min, schema.max);
  return schema.defaultValue;
}

function getAdminCalibrationSnapshot() {
  const out = { uvScale: clamp(getSelectedTileUvScaleValue(), 0.70, 1.50) };
  for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
    out[schema.key] = getSelectedTileVisualParamValue(schema.key);
  }
  return out;
}

function getCalibrationVisualControl(schemaOrKey) {
  const schema = (schemaOrKey && typeof schemaOrKey === 'object') ? schemaOrKey : ADMIN_VISUAL_CALIBRATION_SCHEMA_BY_KEY.get(String(schemaOrKey || ''));
  if (!schema) return { input: null, value: null };
  return {
    input: document.getElementById(schema.inputId),
    value: document.getElementById(schema.valueId),
  };
}

function updateCalibrationUiValue(value) {
  const safe = clamp(Number(value) || 1, 0.70, 1.50);
  state.adminCalibrationScale = safe;
  if (UI.calibrationScaleValue) UI.calibrationScaleValue.textContent = formatCalibrationScale(safe);
  if (UI.calibrationScaleSlider) UI.calibrationScaleSlider.value = safe.toFixed(2);
}

function updateCalibrationVisualUi(values = null) {
  const snapshot = (values && typeof values === 'object') ? values : getAdminCalibrationSnapshot();
  for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
    const safe = clamp(Number(snapshot[schema.key]) || schema.defaultValue, schema.min, schema.max);
    const control = getCalibrationVisualControl(schema);
    if (control.input) control.input.value = safe.toFixed(2);
    if (control.value) control.value.textContent = safe.toFixed(2);
  }
}

function setAdminCalibrationTab(tab) {
  const next = tab === 'visual' ? 'visual' : 'scale';
  state.adminCalibrationTab = next;
  if (UI.btnCalibrationTabScale) {
    const active = next === 'scale';
    UI.btnCalibrationTabScale.classList.toggle('is-active', active);
    UI.btnCalibrationTabScale.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  if (UI.btnCalibrationTabVisual) {
    const active = next === 'visual';
    UI.btnCalibrationTabVisual.classList.toggle('is-active', active);
    UI.btnCalibrationTabVisual.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  if (UI.calibrationScaleSection) UI.calibrationScaleSection.hidden = next !== 'scale';
  if (UI.calibrationVisualSection) UI.calibrationVisualSection.hidden = next !== 'visual';
}

function patchSelectedTileAdminCalibrationParams(patch = {}) {
  const snapshot = getAdminCalibrationSnapshot();
  const next = { ...snapshot };
  if (Object.prototype.hasOwnProperty.call(patch, 'uvScale')) next.uvScale = clamp(Number(patch.uvScale) || 1, 0.70, 1.50);
  for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(patch, schema.key)) continue;
    next[schema.key] = clamp(Number(patch[schema.key]) || schema.defaultValue, schema.min, schema.max);
  }
  if (!state.selectedTile) return next;
  const params = (state.selectedTile.params && typeof state.selectedTile.params === 'object') ? { ...state.selectedTile.params } : {};
  params.uvScale = Number(next.uvScale.toFixed(4));
  for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
    params[schema.key] = Number(next[schema.key].toFixed(4));
  }
  state.selectedTile.params = params;
  return next;
}

function applySelectedTileAdminCalibrationLive(snapshot = null) {
  const next = (snapshot && typeof snapshot === 'object') ? snapshot : getAdminCalibrationSnapshot();
  const mat = tileMaterial;
  const fill = fillMesh;
  const preview = previewPlane;
  const size = (state.selectedTile && state.selectedTile.tileSizeM) ? state.selectedTile.tileSizeM : { w: 0.2, h: 0.2 };
  const uvScale = clamp(Number(next.uvScale) || 1, 0.70, 1.50);
  const repeatX = (3 / Math.max(0.001, Number(size.w) || 0.2)) * uvScale;
  const repeatY = (3 / Math.max(0.001, Number(size.h) || 0.2)) * uvScale;
  const exposureMult = clamp(Number(next.exposureMult) || 1, 0.60, 1.60);
  const contrast = clamp(Number(next.contrast) || 1, 0.70, 1.30);
  const saturation = clamp(Number(next.saturation) || 1, 0.00, 1.50);
  const roughnessMult = clamp(Number(next.roughnessMult) || 1, 0.50, 1.60);
  const specStrength = clamp(Number(next.specStrength) || 1, 0.00, 1.20);
  const normalScale = clamp(Number(next.normalScale) || 1, 0.00, 2.00);
  const bumpScale = clamp(Number(next.bumpScale) || 1, 0.00, 2.00);

  try {
    if (mat && mat.uniforms) {
      if (mat.uniforms.uUvScale) mat.uniforms.uUvScale.value.set(uvScale, uvScale);
      if (mat.uniforms.uExposureMult) mat.uniforms.uExposureMult.value = exposureMult;
      if (mat.uniforms.uContrast) mat.uniforms.uContrast.value = contrast;
      if (mat.uniforms.uSaturation) mat.uniforms.uSaturation.value = saturation;
      if (mat.uniforms.uRoughnessMult) mat.uniforms.uRoughnessMult.value = roughnessMult;
      if (mat.uniforms.uSpecStrength) mat.uniforms.uSpecStrength.value = specStrength;
      if (mat.uniforms.uNormalScale) mat.uniforms.uNormalScale.value = normalScale;
      if (mat.uniforms.uBumpScale) mat.uniforms.uBumpScale.value = bumpScale;
      mat.needsUpdate = true;
    }
    if (fill && fill.material) fill.material.needsUpdate = true;
    if (preview && preview.material) {
      const pm = preview.material;
      if (pm.map && pm.map.repeat) pm.map.repeat.set(repeatX, repeatY);
      if (typeof pm.roughness === 'number') pm.roughness = clamp(roughnessMult, 0.04, 1.0);
      if (pm.normalScale && typeof pm.normalScale.set === 'function') pm.normalScale.set(normalScale, normalScale);
      if (typeof pm.bumpScale === 'number') pm.bumpScale = bumpScale;
      pm.needsUpdate = true;
    }
  } catch (_) {}
  return {
    uvScale,
    exposureMult,
    contrast,
    saturation,
    roughnessMult,
    specStrength,
    normalScale,
    bumpScale,
  };
}

function applySelectedTileUvScaleLive(value) {
  const snapshot = patchSelectedTileAdminCalibrationParams({ uvScale: value });
  return applySelectedTileAdminCalibrationLive(snapshot).uvScale;
}

function applySelectedTileVisualParamLive(key, value) {
  const schema = ADMIN_VISUAL_CALIBRATION_SCHEMA_BY_KEY.get(String(key || ''));
  if (!schema) return Number(value) || 1;
  const patch = {};
  patch[schema.key] = value;
  const snapshot = patchSelectedTileAdminCalibrationParams(patch);
  return applySelectedTileAdminCalibrationLive(snapshot)[schema.key];
}

async function saveAdminCalibrationNow() {
  if (!state.adminArEnabled) return false;
  const token = getAdminSessionToken();
  if (!token) throw new Error('admin_token_missing');
  const shapeId = state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : '';
  const tileId = state.selectedTile && state.selectedTile.id ? String(state.selectedTile.id) : '';
  if (!shapeId || !tileId) return false;

  const liveSnapshot = applySelectedTileAdminCalibrationLive(getAdminCalibrationSnapshot());
  updateCalibrationUiValue(liveSnapshot.uvScale);
  updateCalibrationVisualUi(liveSnapshot);
  setAdminCalibrationStatus('Сохраняем…', 'progress', true);
  const palette = await fetchAdminPalettePayload(shapeId, token);
  const items = Array.isArray(palette && palette.items) ? palette.items.slice() : [];
  const targetKey = comparableTextureKey(shapeId, tileId);
  const idx = items.findIndex((it) => comparableTextureKey(shapeId, it && (it.id || it.textureId || '')) === targetKey);
  if (idx < 0) throw new Error(`texture_not_found_in_palette:${tileId}`);

  const nextItem = { ...items[idx] };
  const nextParams = (nextItem.params && typeof nextItem.params === 'object') ? { ...nextItem.params } : {};
  nextParams.uvScale = Number(liveSnapshot.uvScale.toFixed(4));
  for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
    nextParams[schema.key] = Number(liveSnapshot[schema.key].toFixed(4));
  }
  nextItem.params = nextParams;
  items[idx] = nextItem;

  const apiBase = String(ADMIN_API_BASE_URL || API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!apiBase) throw new Error('admin_api_missing');
  const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const apiUrl = `${apiBase}/api/palettes/${encodeURIComponent(shapeId)}`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers,
    cache: 'no-store',
    body: JSON.stringify({ shapeId, items }),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((json && (json.message || json.error)) || `${res.status} ${res.statusText}`);

  state._allowedTilesByShape.delete(`${shapeId}|fallback:1`);
  state._allowedTilesByShape.delete(`${shapeId}|fallback:0`);
  for (const key of Array.from(state._paletteCache.keys())) {
    if (String(key).includes(shapeId)) state._paletteCache.delete(key);
  }
  if (Array.isArray(state.currentAllowedTiles)) {
    state.currentAllowedTiles = state.currentAllowedTiles.map((tile) => {
      if (!tile || comparableTextureKey(shapeId, tile.id) !== targetKey) return tile;
      const p = (tile.params && typeof tile.params === 'object') ? { ...tile.params } : {};
      p.uvScale = Number(liveSnapshot.uvScale.toFixed(4));
      for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
        p[schema.key] = Number(liveSnapshot[schema.key].toFixed(4));
      }
      return { ...tile, params: p };
    });
  }
  if (Array.isArray(state.arTextureGroups)) {
    state.arTextureGroups = state.arTextureGroups.map((group) => {
      if (!group || String(group.shapeId || '') !== shapeId) return group;
      const tiles = Array.isArray(group.tiles) ? group.tiles.map((tile) => {
        if (!tile || comparableTextureKey(shapeId, tile.id) !== targetKey) return tile;
        const p = (tile.params && typeof tile.params === 'object') ? { ...tile.params } : {};
        p.uvScale = Number(liveSnapshot.uvScale.toFixed(4));
        for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) {
          p[schema.key] = Number(liveSnapshot[schema.key].toFixed(4));
        }
        return { ...tile, params: p };
      }) : group.tiles;
      return { ...group, tiles };
    });
  }
  setAdminCalibrationStatus('Сохранено', 'ok');
  telemetryTrack('admin_ar_calibration_saved', telemetryCtx({
    uvScale: Number(liveSnapshot.uvScale.toFixed(4)),
    exposureMult: Number(liveSnapshot.exposureMult.toFixed(4)),
    contrast: Number(liveSnapshot.contrast.toFixed(4)),
    saturation: Number(liveSnapshot.saturation.toFixed(4)),
    roughnessMult: Number(liveSnapshot.roughnessMult.toFixed(4)),
    specStrength: Number(liveSnapshot.specStrength.toFixed(4)),
    normalScale: Number(liveSnapshot.normalScale.toFixed(4)),
    bumpScale: Number(liveSnapshot.bumpScale.toFixed(4)),
  }));
  return true;
}

function scheduleAdminCalibrationSave() {
  if (!state.adminArEnabled) return;
  if (state.adminCalibrationSaveTimer) clearTimeout(state.adminCalibrationSaveTimer);
  state.adminCalibrationSaveTimer = setTimeout(() => {
    state.adminCalibrationSaveTimer = 0;
    state.adminCalibrationSavePromise = saveAdminCalibrationNow().catch((err) => {
      console.warn('admin calibration save failed', err);
      telemetryError('admin_ar_calibration_save_failed', err, telemetryCtx({ uvScale: Number(state.adminCalibrationScale.toFixed(4)) }));
      setAdminCalibrationStatus('Ошибка сохранения', 'err', true);
      return false;
    }).finally(() => {
      state.adminCalibrationSavePromise = null;
    });
  }, 700);
}

function resetAdminCalibrationCurrentTab() {
  if (state.adminCalibrationTab === 'visual') {
    const patch = {};
    for (const schema of ADMIN_VISUAL_CALIBRATION_SCHEMA) patch[schema.key] = schema.defaultValue;
    const snapshot = patchSelectedTileAdminCalibrationParams(patch);
    const applied = applySelectedTileAdminCalibrationLive(snapshot);
    updateCalibrationVisualUi(applied);
    scheduleAdminCalibrationSave();
    setAdminCalibrationStatus('Визуальные параметры сброшены', '', false);
    return;
  }
  updateCalibrationUiValue(applySelectedTileUvScaleLive(1.0));
  scheduleAdminCalibrationSave();
  setAdminCalibrationStatus('Масштаб сброшен', '', false);
}

function stepAdminCalibrationScale(delta) {
  const next = clamp((Number(state.adminCalibrationScale) || 1) + Number(delta || 0), 0.70, 1.50);
  updateCalibrationUiValue(applySelectedTileUvScaleLive(next));
  scheduleAdminCalibrationSave();
}

function syncAdminCalibrationUi() {
  const enabled = !!(state.adminArEnabled && state.selectedShape && state.selectedTile);
  if (UI.btnArCalibrate) {
    UI.btnArCalibrate.hidden = !enabled;
    UI.btnArCalibrate.classList.toggle('is-enabled', enabled);
  }
  if (!enabled) {
    state.adminCalibrationTargetKey = '';
    if (state.adminCalibrationOpen) setCalibrationPanelOpen(false);
    return;
  }
  const nextKey = `${state.selectedShape.id}::${state.selectedTile.id}`;
  const changed = state.adminCalibrationTargetKey !== nextKey;
  state.adminCalibrationTargetKey = nextKey;
  const snapshot = applySelectedTileAdminCalibrationLive(getAdminCalibrationSnapshot());
  updateCalibrationUiValue(snapshot.uvScale);
  updateCalibrationVisualUi(snapshot);
  setAdminCalibrationTab(state.adminCalibrationTab || 'scale');
  if (changed) setAdminCalibrationStatus('Автосохранение включено', '', false);
}

function setCalibrationPanelOpen(open) {
  const next = !!open && state.phase === 'ar_final' && state.adminArEnabled && !!state.selectedTile;
  state.adminCalibrationOpen = next;
  if (next && state.arCurbSheetOpen) setArCurbSheetOpen(false);
  if (UI.calibrationPanel) {
    show(UI.calibrationPanel, next);
    UI.calibrationPanel.classList.toggle('is-open', next);
    UI.calibrationPanel.setAttribute('aria-hidden', next ? 'false' : 'true');
  }
  if (next) {
    setAdminCalibrationTab(state.adminCalibrationTab || 'scale');
    updateCalibrationVisualUi(getAdminCalibrationSnapshot());
  }
  if (UI.btnArCalibrate) {
    UI.btnArCalibrate.classList.toggle('active', next);
    UI.btnArCalibrate.setAttribute('aria-expanded', next ? 'true' : 'false');
  }
  updateArBottomStripVar(UI);
}

function applyAdminArEntryContext() {
  if (!state.adminArEnabled) return false;
  const shapeId = ADMIN_AR_REQUEST.shapeId ? String(ADMIN_AR_REQUEST.shapeId) : '';
  if (!shapeId) return false;
  const shape = state.shapes.find((item) => item && String(item.id) === shapeId);
  if (!shape) return false;
  return openDetail(shapeId, { preferredTileId: ADMIN_AR_REQUEST.textureId || '' }).then(() => {
    syncAdminCalibrationUi();
    return true;
  }).catch((err) => {
    console.warn('admin AR entry failed', err);
    return false;
  });
}

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
      await openDetail(tileShapeId, { preserveScreen: true, preferredTileId: tile.id, changeSource: 'texture_rail', source: 'texture_rail' });
      renderArTextureRail();
    } catch (e) {
      console.error('in-rail shape switch failed', e);
      telemetryError('ar_texture_rail_shape_switch_failed', e, telemetryCtx({ targetShapeId: tileShapeId }));
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
        telemetryError('ar_texture_group_skipped', err, { shapeId: shape && shape.id ? String(shape.id) : 'unknown-shape' });
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
  const prevShapeId = state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : '';
  const prevShapeName = state.selectedShape && state.selectedShape.name ? String(state.selectedShape.name) : '';
  telemetryPage('detail', { shapeId: String(s.id || ''), shapeName: String(s.name || ''), preserveScreen: !!opts.preserveScreen, preferredTileId: opts.preferredTileId ? String(opts.preferredTileId) : '' });
  telemetryTrackFormChange(s, { prevShapeId, prevShapeName, source: opts.changeSource || opts.source || (state.xrSession ? 'ar_context' : 'detail_open'), inAr: !!state.xrSession, via: opts.preferredTileId ? 'preferred_tile' : '' });
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
  syncQuickArLaunchButton();
}

function getPrimaryQuickLaunchItem() {
  const list = Array.isArray(state.quickLaunchItems) ? state.quickLaunchItems : [];
  return list.length ? list[0] : null;
}

function syncQuickArLaunchButton() {
  if (!UI.btnQuickArLaunch) return;
  const primaryItem = getPrimaryQuickLaunchItem();
  const isAvailable = !!primaryItem;
  UI.btnQuickArLaunch.hidden = !isAvailable;
  UI.btnQuickArLaunch.disabled = !isAvailable || !!state._launchingQuickAr;
  UI.btnQuickArLaunch.setAttribute('aria-disabled', (!isAvailable || !!state._launchingQuickAr) ? 'true' : 'false');
  if (isAvailable) {
    UI.btnQuickArLaunch.setAttribute('aria-label', `Режим визуализации: ${primaryItem.shapeName} — ${primaryItem.tileName}`);
  } else {
    UI.btnQuickArLaunch.removeAttribute('aria-label');
  }
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
  syncQuickArLaunchButton();
  const restoreStatus = UI.quickArStatus ? UI.quickArStatus.textContent : '';
  try {
    telemetryTrack('quick_ar_launch', { shapeId: String(item.shapeId || ''), tileId: String(item.tileId || ''), shapeName: String(item.shapeName || ''), tileName: String(item.tileName || '') });
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
    telemetryError('quick_ar_launch_failed', e, { shapeId: String(item.shapeId || ''), tileId: String(item.tileId || '') });
    setQuickArStatus('Не удалось запустить AR. Попробуйте ещё раз.');
  } finally {
    state._launchingQuickAr = false;
    syncQuickArLaunchButton();
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
  telemetryTrack('ar_session_start_requested', telemetryCtx());
  try {

  const env = getArEnv();
  if (env.isAndroid && !env.isChrome) {
    telemetryTrack('ar_session_blocked', telemetryCtx({ reason: 'need_chrome' }));
    showArHelp('NEED_CHROME');
    return;
  }

  if (!navigator.xr) {
    telemetryTrack('ar_session_blocked', telemetryCtx({ reason: 'no_webxr' }));
    showArHelp('NO_WEBXR');
    return;
  }
  const supported = await checkXrSupport();
  if (!supported) {
    telemetryTrack('ar_session_blocked', telemetryCtx({ reason: 'not_supported' }));
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
    telemetryError('ar_session_start_failed', e, telemetryCtx({ stage: 'request_session' }));
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
  telemetryTrack('ar_session_started', telemetryCtx({ cameraAccess: !!state.cameraAccessEnabled, depthSupported: !!state.depthSupported, anchorsSupported: !!state.anchorsSupported }));

  session.addEventListener('end', () => {
    telemetryTrack('ar_session_end', telemetryCtx());
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

  const snapPreview = buildZoneSnapPreview(local);
  const snappedLocal = snapPreview && snapPreview.armed && snapPreview.point ? snapPreview.point.clone() : local;
  setZoneSnapPreview(snapPreview);

  const pointAllowance = getContourPointAllowance();
  if (!pointAllowance.ok) {
    telemetryTrack('ar_zone_point_limit_reached', telemetryCtx({
      zoneId: String((getActiveZone({ createIfMissing: false }) || {}).id || ''),
      totalPoints: pointAllowance.total,
      maxPoints: pointAllowance.maxZonePoints,
    }));
    showArRuntimeToast(`Достигнут лимит точек зоны: ${pointAllowance.maxZonePoints}. Для стабильной работы оставляем ${getArZoneHardLimitSummary()}.`, 3000);
    return;
  }

  // protect duplicates
  if (state.points.length) {
    const d = distXZ(state.points[state.points.length - 1], snappedLocal);
    if (d < 0.04) return;
  }

  // magnet close
  if (!state.closed && state.points.length >= 3) {
    const d0 = distXZ(state.points[0], snappedLocal);
    if (d0 < SNAP_DIST_M) {
      state.snapKind = 'close';
      state.snapArmed = true;
      closeContour();
      return;
    }
  }

  const nextPointValidation = validateActiveZoneNextPoint(snappedLocal);
  if (handleActiveZoneNextPointValidationFailure(nextPointValidation)) {
    setZoneSnapPreview(null);
    return;
  }

  if (snapPreview && snapPreview.armed) {
    if (snapPreview.kind === 'vertex') {
      telemetryTrack('ar_zone_snap_vertex', telemetryCtx({ zoneId: snapPreview.zoneId || '', points: state.points.length, targetVertexIndex: Number.isFinite(Number(snapPreview.vertexIndex)) ? Number(snapPreview.vertexIndex) : -1 }));
    } else if (snapPreview.kind === 'edge') {
      telemetryTrack('ar_zone_snap_edge', telemetryCtx({ zoneId: snapPreview.zoneId || '', points: state.points.length, targetEdgeIndex: Number.isFinite(Number(snapPreview.edgeIndex)) ? Number(snapPreview.edgeIndex) : -1 }));
    }
  }

  state.points.push(snappedLocal);
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
  syncArDraftAssistUi();
}

function addPointFromReticle() {
  if (!state.xrSession) return;
  if (!state.floorLocked || state.phase === 'ar_scan') return;
  if (!reticle.visible) return;
  const isFirstPoint = state.phase === 'ar_draw' && state.points.length === 0;
  const beforePoints = state.points.length;
  const beforeHolePoints = state.holePoints.length;
  const beforePhase = state.phase;
  addPointAtWorld(reticle.position);
  const didChange = (state.points.length !== beforePoints)
    || (state.holePoints.length !== beforeHolePoints)
    || (beforePhase === 'ar_draw' && state.phase === 'ar_mask' && state.closed)
    || (beforePhase === 'ar_cut' && state.phase === 'ar_mask');
  if (!didChange) return;
  if (isFirstPoint) telemetryTrack('ar_first_point', telemetryCtx({ points: state.points.length }));
  else telemetryTrack('ar_point_add', telemetryCtx({ points: state.points.length, mode: state.phase }));
}

function addHolePointLocal(local) {
  const holePointAllowance = getHolePointAllowance();
  if (!holePointAllowance.ok) {
    telemetryTrack('ar_zone_hole_point_limit_reached', telemetryCtx({
      zoneId: String((getActiveZone({ createIfMissing: false }) || {}).id || ''),
      totalHolePoints: holePointAllowance.total,
      maxHolePoints: holePointAllowance.maxHolePoints,
      holes: state.holes.length,
    }));
    showArRuntimeToast(`Достигнут лимит точек выреза: ${holePointAllowance.maxHolePoints}. Для стабильной работы оставляем ${getArZoneHardLimitSummary()}.`, 3000);
    return;
  }
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
  syncArDraftAssistUi();
}

function closeHole() {
  if (state.holePoints.length < 3) return;
  telemetryTrack('ar_cutout_closed', telemetryCtx({ cutoutPoints: state.holePoints.length, totalHolesNext: state.holes.length + 1 }));
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
  setActiveZoneStatus('mask');
  renderArZoneChips();
  syncArDraftAssistUi();
}

function closeContour() {
  if (state.points.length < 3) return;
  const zoneValidation = validateActiveZoneContour();
  if (handleActiveZoneContourValidationFailure(zoneValidation)) return;
  telemetryTrack('ar_contour_closed', telemetryCtx({ points: state.points.length, areaM2: Number(computeAreaM2().toFixed ? computeAreaM2().toFixed(3) : computeAreaM2()) }));
  state.closed = true;
  state.phase = 'ar_mask';
  state.hasEverClosedContour = true;
  state.snapArmed = false;
  state.snapKind = 'none';
  state.snapPreview = null;

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
  setActiveZoneStatus('mask');
  renderArZoneChips();
  syncArDraftAssistUi();
} 


function hardCleanupArScene(opts = {}) {
  if (state._hardCleanupArSceneActive) return;
  state._hardCleanupArSceneActive = true;
  const reason = opts.reason ? String(opts.reason) : 'hard_cleanup';
  const preserveSelection = opts.preserveSelection !== false;
  const preserveRotation = !!opts.preserveRotation;
  try {
    clearArDraftZoneContext();
    try { setCalibrationPanelOpen(false); } catch (_) {}
    try { setArZoneDeleteConfirmOpen(false); } catch (_) {}
    try { setArCurbSheetOpen(false); } catch (_) {}
    try { setArZonePanelOpen(false); } catch (_) {}
    try { setRotationPanelOpen(false); } catch (_) {}

    state.points = [];
    state.holes = [];
    state.holePoints = [];
    state.closed = false;
    state.hasEverClosedContour = false;

    try { pointsGroup.clear(); } catch (_) {}

    if (line) {
      try { anchorGroup.remove(line); } catch (_) {}
      try { disposeObject3D(line); } catch (_) {}
      line = null;
    }

    trackArZoneRuntimeCleanup(reason, { hard: true });
    clearAllCurbRuntime({ anchorGroup, disposeObject3D });
    clearAllZoneRuntime({ anchorGroup, disposeObject3D, preserveMaterial: null });

    try {
      const children = Array.isArray(anchorGroup.children) ? anchorGroup.children.slice() : [];
      for (const child of children) {
        if (!child || child === pointsGroup) continue;
        try { anchorGroup.remove(child); } catch (_) {}
        try { disposeObject3D(child); } catch (_) {}
      }
    } catch (_) {}

    fillMesh = null;
    tileMaterial = null;
    setCompatFillMesh(null);
    setCompatTileMaterial(null);

    resetCurbStorage();
    resetToSingleZone({ preserveSelection, preserveRotation });

    clearMeasureLabels();
    if (UI.measureLayer) UI.measureLayer.style.display = 'block';
    pointsGroup.visible = true;
    show(UI.postCloseBar, false);
    show(UI.finalBar, false);
    show(UI.finalColors, false);
    show(UI.contourHint, false);
    show(UI.btnArOk, false);
    syncArDraftAssistUi();
    renderArZoneChips();
    syncArZoneControlsUi();
    updateAreaUI();
    pruneArRuntimeCaches();
    try { updateArBottomStripVar(UI); } catch (_) {}
  } finally {
    state._hardCleanupArSceneActive = false;
  }
}

function resetAll(keepFloor = false) {
  clearArDraftZoneContext();
  setArCurbSheetOpen(false);
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

  trackArZoneRuntimeCleanup('reset_all', { keepFloor: !!keepFloor });
  clearAllCurbRuntime({ anchorGroup, disposeObject3D });
  clearAllZoneRuntime({ anchorGroup, disposeObject3D, preserveMaterial: tileMaterial });
  if (fillMesh) {
    anchorGroup.remove(fillMesh);
    fillMesh.geometry.dispose();
    // material is shared shader; don't dispose here
    fillMesh = null;
    setCompatFillMesh(null);
  }

  resetCurbStorage();
  resetToSingleZone({ preserveSelection: true, preserveRotation: true });
  setCompatTileMaterial(tileMaterial);

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

  syncArDraftAssistUi();

  // restore guides visibility (they may be hidden in final mode)
  pointsGroup.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';

  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);
  updateAreaUI();
  renderArZoneChips();
  pruneArRuntimeCaches();
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
    telemetryTrack('ar_snapshot_exported', telemetryCtx({ mode: 'built_in' }));
    return true;
  } finally {
    state.snapshotInProgress = false;
    restoreArFinalBottomUi();
  }
}

function openSystemScreenshotFallback() {
  telemetryTrack('ar_snapshot_fallback_open', telemetryCtx({ mode: 'system_screenshot' }));
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
      telemetryError('ar_snapshot_builtin_failed', err, telemetryCtx({ mode: 'built_in' }));
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
  fillMesh = rebuildFillMesh({ anchorGroup, fillMesh: getCompatFillMesh(), state, tileMaterial: getCompatTileMaterial(), maskMaterial });
  setCompatFillMesh(fillMesh);
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

  // magnet highlight + zone snap preview
  if (state.floorLocked && !state.closed && state.phase === 'ar_draw' && reticle.visible) {
    const rawWorld = reticle.position.clone();
    rawWorld.y = state.floorY;
    const rawLocal = anchorGroup.worldToLocal(rawWorld.clone());
    const zoneSnapPreview = buildZoneSnapPreview(rawLocal);
    if (zoneSnapPreview && zoneSnapPreview.armed && zoneSnapPreview.point) {
      const snappedWorld = anchorGroup.localToWorld(zoneSnapPreview.point.clone());
      snappedWorld.y = state.floorY;
      reticle.position.copy(snappedWorld);
      setZoneSnapPreview(zoneSnapPreview);
    } else {
      setZoneSnapPreview(null);
    }

    if (state.points.length >= 3) {
      const snapLocal = (state.snapPreview && state.snapPreview.point) ? state.snapPreview.point.clone() : rawLocal;
      const d0 = distXZ(state.points[0], snapLocal);
      if (d0 < SNAP_DIST_M) {
        state.snapKind = 'close';
        state.snapArmed = true;
      }
    }
  } else {
    setZoneSnapPreview(null);
  }
  if (reticle.material?.color) {
    reticle.material.color.setHex(getReticleSnapColor());
  }
  // "firstRing" теперь находится внутри флажка (вложенный объект)
  let firstRing = null;
  pointsGroup.traverse((o) => {
    if (!firstRing && o.name === 'firstRing') firstRing = o;
  });
  if (firstRing?.material?.color) {
    firstRing.material.color.setHex(getReticleSnapColor());
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

if (!document.__adminCalibrationDismissBound) {
  document.addEventListener('pointerdown', (event) => {
    if (!state.xrSession || !state.adminCalibrationOpen) return;
    const path = (event && typeof event.composedPath === 'function') ? event.composedPath() : [];
    if ((UI.calibrationPanel && path.includes(UI.calibrationPanel)) || (UI.btnArCalibrate && path.includes(UI.btnArCalibrate))) return;
    setCalibrationPanelOpen(false);
  }, true);
  document.__adminCalibrationDismissBound = true;
}

ensureArFinalControlsBound();

UI.btnQuickArToggle?.addEventListener('click', () => {
  telemetryTrack('quick_ar_toggle', telemetryCtx({ expandedNext: !state.quickLaunchExpanded }));
  toggleQuickLaunchExpanded();
});

UI.btnQuickArLaunch?.addEventListener('click', async () => {
  const primaryItem = getPrimaryQuickLaunchItem();
  if (!primaryItem) return;
  telemetryTrack('quick_ar_cta_launch', telemetryCtx({
    shapeId: String(primaryItem.shapeId || ''),
    tileId: String(primaryItem.tileId || ''),
    shapeName: String(primaryItem.shapeName || ''),
    tileName: String(primaryItem.tileName || ''),
  }));
  await launchQuickArPreset(primaryItem);
});

UI.catalogSearch?.addEventListener('input', () => {
  const q = UI.catalogSearch.value.trim().toLowerCase();
  if (!q) renderCatalog(state.shapes, { UI, onShapeSelect: (shapeId) => openDetail(shapeId) });
  else renderCatalog(state.shapes.filter(s => (s.name || '').toLowerCase().includes(q)), { UI, onShapeSelect: (shapeId) => openDetail(shapeId) });
});

UI.btnDetailBack?.addEventListener('click', () => {
  telemetryPage('catalog', telemetryCtx({ source: 'detail_back' }));
  setActiveScreen('catalog', UI);
  state.phase = 'catalog';
});

UI.btnManagerCall?.addEventListener('click', () => {
  telemetryTrack('cta_manager_call', telemetryCtx({ phone: '+79780224411' }));
});

UI.btnProducerSite?.addEventListener('click', () => {
  telemetryTrack('cta_site_click', telemetryCtx({ destination: 'https://ag-ru.com/' }));
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
  telemetryTrack('ar_launch_click', telemetryCtx({ isAndroid: !!env.isAndroid, isChrome: !!env.isChrome }));
  if (env.isAndroid && !env.isChrome) {
    telemetryTrack('ar_launch_blocked', telemetryCtx({ reason: 'need_chrome' }));
    showArHelp('NEED_CHROME');
    return;
  }
  await startAR();
});

UI.btnArBack?.addEventListener('click', async () => {
  telemetryTrack('ar_back_click', telemetryCtx());
  setCalibrationPanelOpen(false);
  setArZoneDeleteConfirmOpen(false);
  setArCurbSheetOpen(false);
  setArZonePanelOpen(false);
  await stopAR();
});

UI.btnArReset?.addEventListener('click', async () => {
  telemetryTrack('ar_reset_click', telemetryCtx());
  setCalibrationPanelOpen(false);
  setArZoneDeleteConfirmOpen(false);
  setArCurbSheetOpen(false);
  setArZonePanelOpen(false);
  await fullRestartAR();
});

UI.btnArAdd?.addEventListener('click', () => {
  addPointFromReticle();
});

UI.btnArUndo?.addEventListener('click', () => {
  if (!undoActiveDraftStep()) {
    showArRuntimeToast('Сейчас нечего отменять.', 1800);
  }
});

UI.btnArCancelZone?.addEventListener('click', () => {
  cancelCurrentDraftZone().catch((err) => {
    console.warn('AR draft zone cancel failed', err);
    telemetryError('ar_zone_draft_cancel_failed', err, telemetryCtx({ zoneId: String((getActiveZone({ createIfMissing: false }) || {}).id || '') }));
    showArRuntimeToast('Не удалось отменить текущую новую зону. Попробуйте ещё раз.', 2400);
  });
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
  if (next) {
    setCalibrationPanelOpen(false);
    if (state.arZonePanelOpen) setArZonePanelOpen(false);
    if (state.arCurbSheetOpen) setArCurbSheetOpen(false);
  }
  if (UI.rotationPanel) show(UI.rotationPanel, next);
  if (UI.btnTextureRotate) {
    UI.btnTextureRotate.classList.toggle('active', next);
    UI.btnTextureRotate.setAttribute('aria-expanded', next ? 'true' : 'false');
  }
  syncArZoneControlsUi();
  updateArBottomStripVar(UI);
}

function applyTextureRotationDeg(value, opts = {}) {
  return setTextureRotationDeg(normalizeTextureRotationDeg(value, !!opts.preserveFullCircle), { preserveFullCircle: !!opts.preserveFullCircle });
}

function stepTextureRotation(deltaDeg) {
  const base = normalizeTextureRotationDeg(state.textureRotationDeg);
  return applyTextureRotationDeg(base + deltaDeg);
}

function enterActiveZoneEditMode() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  telemetryTrack('ar_zone_edit_start', telemetryCtx({ zoneId: String(activeZone.id || ''), points: state.points.length, holes: state.holes.length }));
  show(UI.finalColors, false);
  show(UI.contourHint, false);
  setArZonePanelOpen(false);
  setArCurbSheetOpen(false);
  setRotationPanelOpen(false);
  show(UI.finalBar, false);
  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);

  state.closed = false;
  state.phase = 'ar_draw';
  setActiveZoneStatus('draft');
  state.holes = [];
  state.holePoints = [];

  show(UI.postCloseBar, false);
  show(UI.btnArAdd, true);
  show(UI.btnArOk, state.points.length >= 3);
  show(UI.arBottomCenter, true);

  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: false });
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';

  if (fillMesh) {
    anchorGroup.remove(fillMesh);
    fillMesh.geometry.dispose();
    fillMesh = null;
    setCompatFillMesh(null);
  }
  clearMeasureLabels();
  updateAreaUI();
  renderArZoneChips();
  syncArZoneControlsUi();
  syncArDraftAssistUi();
  return true;
}

function enterActiveZoneCutoutMode() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  const holeAllowance = getHoleStartAllowance();
  if (!holeAllowance.ok) {
    telemetryTrack('ar_zone_hole_limit_reached', telemetryCtx({
      zoneId: String(activeZone.id || ''),
      totalHoles: holeAllowance.total,
      maxHoles: holeAllowance.maxHolesPerZone,
    }));
    showArRuntimeToast(`Достигнут лимит вырезов в зоне: ${holeAllowance.maxHolesPerZone}. Для стабильной работы оставляем ${getArZoneHardLimitSummary()}.`, 3000);
    return false;
  }
  telemetryTrack('ar_zone_cutout_start', telemetryCtx({ zoneId: String(activeZone.id || ''), holes: state.holes.length }));
  show(UI.finalColors, false);
  show(UI.contourHint, false);
  setArZonePanelOpen(false);
  setRotationPanelOpen(false);
  show(UI.finalBar, false);
  if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);

  state.phase = 'ar_cut';
  state.holePoints = [];
  setActiveZoneStatus('draft');

  show(UI.postCloseBar, false);
  show(UI.btnArAdd, true);
  show(UI.btnArOk, false);
  show(UI.arBottomCenter, true);

  UI.scanHint.querySelector('.scanTitle').textContent = 'СДЕЛАЙТЕ ВЫРЕЗ';
  UI.scanHint.querySelector('.scanText').textContent = `Поставьте точки внутри ${getArZoneDisplayTitle(activeZone)}. Замкните контур рядом с первой точкой.`;
  show(UI.scanHint, true);

  line = rebuildMarkersAndLine({ pointsGroup, points: state.points, holePoints: state.holePoints, phase: state.phase, anchorGroup, line, floorY: state.floorY, disposeObject3D, closed: true });
  pointsGroup.visible = true;
  if (line) line.visible = true;
  if (UI.measureLayer) UI.measureLayer.style.display = 'block';
  renderArZoneChips();
  syncArZoneControlsUi();
  syncArDraftAssistUi();
  return true;
}

function setArZoneDeleteConfirmOpen(open) {
  const shouldOpen = !!open;
  state.arZoneDeleteConfirmOpen = shouldOpen;
  const activeZone = getActiveZone({ createIfMissing: false });
  if (UI.arZoneDeleteConfirmMeta) {
    if (activeZone && shouldOpen) {
      const zoneTitle = getArZoneDisplayTitle(activeZone);
      const tileLabel = getArZoneTileLabel(activeZone);
      UI.arZoneDeleteConfirmMeta.textContent = `${zoneTitle} · ${tileLabel}`;
    } else {
      UI.arZoneDeleteConfirmMeta.textContent = '';
    }
  }
  if (shouldOpen) {
    if (state.arCurbSheetOpen) setArCurbSheetOpen(false);
    setRotationPanelOpen(false);
  }
  if (UI.arZoneDeleteConfirm) {
    show(UI.arZoneDeleteConfirm, shouldOpen);
  }
  syncArZoneControlsUi();
  if (shouldOpen) {
    try {
      UI.btnArZoneDeleteConfirm?.focus({ preventScroll: true });
    } catch (_) {
      try { UI.btnArZoneDeleteConfirm?.focus(); } catch (_) {}
    }
  } else {
    try {
      UI.btnArZoneDelete?.focus({ preventScroll: true });
    } catch (_) {
      try { UI.btnArZoneDelete?.focus(); } catch (_) {}
    }
  }
}

function requestDeleteActiveArZone() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone || !state.xrSession || state.phase !== 'ar_final') return false;
  setArZoneDeleteConfirmOpen(true);
  return true;
}

async function deleteActiveArZone() {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return false;
  setArZoneDeleteConfirmOpen(false);
  telemetryTrack('ar_zone_delete', telemetryCtx({ zoneId: String(activeZone.id || ''), totalZonesBefore: getZones().length }));
  removeCurbsForZone(activeZone.id, { anchorGroup, disposeObject3D });
  const removed = removeZone(activeZone.id, { anchorGroup, disposeObject3D, preserveMaterial: tileMaterial });
  clearArDraftZoneContext(String(activeZone.id || ''));
  if (!removed) return false;
  if (line) {
    anchorGroup.remove(line);
    disposeObject3D(line);
    line = null;
  }
  pointsGroup.clear();
  clearMeasureLabels();
  if (!getZones().length) {
    setArZonePanelOpen(false);
    setArCurbSheetOpen(false);
    resetCurbStorage();
    resetToSingleZone({ preserveSelection: true, preserveRotation: true });
    setCompatFillMesh(null);
    setCompatTileMaterial(tileMaterial);
    state.phase = 'ar_draw';
    state.closed = false;
    setActiveZoneStatus('draft');
    show(UI.finalBar, false);
    show(UI.finalColors, false);
    show(UI.postCloseBar, false);
    show(UI.contourHint, true);
    show(UI.btnArAdd, true);
    show(UI.btnArOk, false);
    show(UI.arBottomCenter, true);
    pointsGroup.visible = true;
    if (UI.measureLayer) UI.measureLayer.style.display = 'block';
    updateArBottomStripVar(UI);
    updateAreaUI();
    renderArZoneChips();
    syncArZoneControlsUi();
    syncArDraftAssistUi();
    telemetryTrack('ar_zone_delete_done', telemetryCtx({ zoneId: String(removed.id || ''), totalZonesAfter: 0, sceneResetToDraw: true }));
    showArRuntimeToast('Последняя зона удалена. Можно построить новую область.', 2400);
    pruneArRuntimeCaches();
    return true;
  }
  const fallbackZone = getActiveZone({ createIfMissing: false }) || getZones()[0] || null;
  if (fallbackZone) await activateArZoneById(fallbackZone.id, { track: false });
  if (state.arCurbSheetOpen) syncArCurbSheetUi();
  updateAreaUI();
  renderArZoneChips();
  syncArZoneControlsUi();
  syncArDraftAssistUi();
  telemetryTrack('ar_zone_delete_done', telemetryCtx({ zoneId: String(removed.id || ''), totalZonesAfter: getZones().length, activeZoneId: String((fallbackZone || {}).id || '') }));
  showArRuntimeToast(`Зона удалена. Осталось зон: ${getZones().length}.`, 2200);
  pruneArRuntimeCaches();
  return true;
}

UI.btnEditShape?.addEventListener('click', () => {
  telemetryTrack('ar_edit_shape', telemetryCtx({ points: state.points.length, holes: state.holes.length }));
  enterActiveZoneEditMode();
});

UI.btnCutout?.addEventListener('click', () => {
  if (enterActiveZoneCutoutMode()) {
    telemetryTrack('ar_cutout_start', telemetryCtx({ holes: state.holes.length }));
  }
});

function ensureArFinalControlsBound() {
  if (UI.btnTextureRotate && !UI.btnTextureRotate.__arBound) {
    UI.btnTextureRotate.addEventListener('click', () => {
      const shouldOpen = UI.rotationPanel ? UI.rotationPanel.hidden : !state.rotationPanelOpen;
      telemetryTrack('ar_rotation_panel_toggle', telemetryCtx({ open: !!shouldOpen }));
      setRotationPanelOpen(shouldOpen);
    });
    UI.btnTextureRotate.__arBound = true;
  }

  if (UI.btnRotateMinus && !UI.btnRotateMinus.__arBound) {
    UI.btnRotateMinus.addEventListener('click', () => {
      telemetryTrack('ar_rotation_step', telemetryCtx({ deltaDeg: -15 }));
      stepTextureRotation(-15);
    });
    UI.btnRotateMinus.__arBound = true;
  }

  if (UI.btnRotatePlus && !UI.btnRotatePlus.__arBound) {
    UI.btnRotatePlus.addEventListener('click', () => {
      telemetryTrack('ar_rotation_step', telemetryCtx({ deltaDeg: 15 }));
      stepTextureRotation(15);
    });
    UI.btnRotatePlus.__arBound = true;
  }

  if (UI.btnRotationReset && !UI.btnRotationReset.__arBound) {
    UI.btnRotationReset.addEventListener('click', () => {
      telemetryTrack('ar_rotation_reset', telemetryCtx({}));
      applyTextureRotationDeg(0);
    });
    UI.btnRotationReset.__arBound = true;
  }

  if (UI.btnArAddZone && !UI.btnArAddZone.__arBound) {
    UI.btnArAddZone.addEventListener('click', () => {
      const canManageZones = !!(state.xrSession && state.phase === 'ar_final' && getZones().length > 0);
      if (!canManageZones) return;
      setArZonePanelOpen(!state.arZonePanelOpen);
    });
    UI.btnArAddZone.__arBound = true;
  }

  if (UI.btnArZoneBarClose && !UI.btnArZoneBarClose.__arBound) {
    UI.btnArZoneBarClose.addEventListener('click', () => {
      setArZonePanelOpen(false);
    });
    UI.btnArZoneBarClose.__arBound = true;
  }

  if (UI.btnArZoneAddAction && !UI.btnArZoneAddAction.__arBound) {
    UI.btnArZoneAddAction.addEventListener('click', () => {
      beginAddArZone();
    });
    UI.btnArZoneAddAction.__arBound = true;
  }

  if (UI.rotationSlider && !UI.rotationSlider.__arBound) {
    UI.rotationSlider.addEventListener('input', (ev) => {
      const rawValue = ev && ev.target ? ev.target.value : UI.rotationSlider.value;
      applyTextureRotationDeg(rawValue, { preserveFullCircle: Number(rawValue) === 360 });
    });
    UI.rotationSlider.__arBound = true;
  }

  if (UI.btnArCalibrate && !UI.btnArCalibrate.__arBound) {
    UI.btnArCalibrate.addEventListener('click', () => {
      const shouldOpen = UI.calibrationPanel ? UI.calibrationPanel.hidden : !state.adminCalibrationOpen;
      telemetryTrack('admin_ar_calibration_toggle', telemetryCtx({ open: !!shouldOpen }));
      if (shouldOpen) { setArZonePanelOpen(false); setRotationPanelOpen(false); }
      syncAdminCalibrationUi();
      setCalibrationPanelOpen(shouldOpen);
    });
    UI.btnArCalibrate.__arBound = true;
  }

  if (UI.btnCalibrationScaleMinus && !UI.btnCalibrationScaleMinus.__arBound) {
    UI.btnCalibrationScaleMinus.addEventListener('click', () => { telemetryTrack('admin_ar_calibration_scale_step', telemetryCtx({ delta: -0.05 })); stepAdminCalibrationScale(-0.05); });
    UI.btnCalibrationScaleMinus.__arBound = true;
  }

  if (UI.btnCalibrationScalePlus && !UI.btnCalibrationScalePlus.__arBound) {
    UI.btnCalibrationScalePlus.addEventListener('click', () => { telemetryTrack('admin_ar_calibration_scale_step', telemetryCtx({ delta: 0.05 })); stepAdminCalibrationScale(0.05); });
    UI.btnCalibrationScalePlus.__arBound = true;
  }

  if (UI.btnCalibrationTabScale && !UI.btnCalibrationTabScale.__arBound) {
    UI.btnCalibrationTabScale.addEventListener('click', () => {
      setAdminCalibrationTab('scale');
    });
    UI.btnCalibrationTabScale.__arBound = true;
  }

  if (UI.btnCalibrationTabVisual && !UI.btnCalibrationTabVisual.__arBound) {
    UI.btnCalibrationTabVisual.addEventListener('click', () => {
      setAdminCalibrationTab('visual');
    });
    UI.btnCalibrationTabVisual.__arBound = true;
  }

  if (UI.btnCalibrationReset && !UI.btnCalibrationReset.__arBound) {
    UI.btnCalibrationReset.addEventListener('click', () => {
      telemetryTrack('admin_ar_calibration_reset', telemetryCtx({ tab: String(state.adminCalibrationTab || 'scale') }));
      resetAdminCalibrationCurrentTab();
    });
    UI.btnCalibrationReset.__arBound = true;
  }

  if (UI.btnCalibrationCollapse && !UI.btnCalibrationCollapse.__arBound) {
    UI.btnCalibrationCollapse.addEventListener('click', () => {
      telemetryTrack('admin_ar_calibration_toggle', telemetryCtx({ open: false, source: 'collapse_button' }));
      setCalibrationPanelOpen(false);
    });
    UI.btnCalibrationCollapse.__arBound = true;
  }

  if (UI.calibrationScaleSlider && !UI.calibrationScaleSlider.__arBound) {
    UI.calibrationScaleSlider.addEventListener('input', (ev) => {
      const rawValue = ev && ev.target ? ev.target.value : UI.calibrationScaleSlider.value;
      const applied = applySelectedTileUvScaleLive(rawValue);
      updateCalibrationUiValue(applied);
      telemetryTrack('admin_ar_calibration_scale_slider_change', telemetryCtx({ value: Number(Number(applied || rawValue).toFixed ? Number(applied || rawValue).toFixed(4) : rawValue) }));
      scheduleAdminCalibrationSave();
    });
    UI.calibrationScaleSlider.__arBound = true;
  }

  ADMIN_VISUAL_CALIBRATION_SCHEMA.forEach((schema) => {
    const control = getCalibrationVisualControl(schema);
    if (!control.input || control.input.__arBound) return;
    control.input.addEventListener('input', (ev) => {
      const rawValue = ev && ev.target ? ev.target.value : control.input.value;
      const applied = applySelectedTileVisualParamLive(schema.key, rawValue);
      control.input.value = Number(applied).toFixed(2);
      if (control.value) control.value.textContent = Number(applied).toFixed(2);
      telemetryTrack('admin_visual_param_change', telemetryCtx({ param: String(schema.key || ''), value: Number(Number(applied).toFixed(4)), source: 'ar_calibration' }));
      scheduleAdminCalibrationSave();
    });
    control.input.__arBound = true;
  });

  if (UI.btnShapePicker && !UI.btnShapePicker.__arBound) {
    UI.btnShapePicker.addEventListener('click', () => {
      if (!UI.shapePickerPanel || !UI.shapePickerList) return;
      telemetryTrack('ar_shape_picker_toggle', telemetryCtx());
      setArZonePanelOpen(false);
      setArCurbSheetOpen(false);
      setRotationPanelOpen(false);
      setCalibrationPanelOpen(false);
      try {
        buildShapePickerList({
          UI,
          state,
          setShapePickerOpen: (open) => setShapePickerOpen(open, { UI, updateArTopStripVar, updateArBottomStripVar }),
          onShapeSelect: handleShapePickerSelection,
        });
      } catch (e) {
        console.warn('shape picker build failed', e);
        telemetryError('ar_shape_picker_build_failed', e, telemetryCtx());
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
      setArZonePanelOpen(false);
      setArCurbSheetOpen(false);
      setCalibrationPanelOpen(false);
      telemetryTrack('ar_snapshot_click', telemetryCtx({ cameraAccess: !!state.cameraAccessEnabled }));
      handleArSnapshotRequest().catch((err) => {
        console.warn('AR snapshot request failed', err);
        telemetryError('ar_snapshot_request_failed', err, telemetryCtx());
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

UI.btnArZoneEdit?.addEventListener('click', () => {
  setArZonePanelOpen(false);
  enterActiveZoneEditMode();
});

UI.btnArZoneCutout?.addEventListener('click', () => {
  setArZonePanelOpen(false);
  enterActiveZoneCutoutMode();
});

UI.btnArZoneCurb?.addEventListener('click', () => {
  maybeShowArCurbIntroHint();
  setArCurbSheetOpen(true);
});

UI.btnArZoneDelete?.addEventListener('click', () => {
  requestDeleteActiveArZone();
});

UI.btnArZoneDeleteCancel?.addEventListener('click', () => {
  setArZoneDeleteConfirmOpen(false);
});

UI.btnArZoneDeleteConfirm?.addEventListener('click', () => {
  deleteActiveArZone().catch((err) => {
    console.warn('AR zone delete failed', err);
    telemetryError('ar_zone_delete_failed', err, telemetryCtx({ zoneId: String((getActiveZone({ createIfMissing: false }) || {}).id || '') }));
    showArRuntimeToast('Не удалось удалить активную зону. Попробуйте ещё раз.', 2400);
  });
});

UI.arZoneDeleteConfirm?.addEventListener('click', (event) => {
  if (event && event.target === UI.arZoneDeleteConfirm) {
    setArZoneDeleteConfirmOpen(false);
  }
});

UI.btnArCurbApply?.addEventListener('click', () => {
  if (applyPerimeterCurbToActiveZone()) {
    setArCurbSheetOpen(false);
  }
});

UI.btnArCurbRemove?.addEventListener('click', () => {
  if (!removeActiveZoneCurb()) {
    showArRuntimeToast('У активной зоны пока нет бордюра.', 1800);
    return;
  }
  setArCurbSheetOpen(false);
});

UI.btnArCurbClose?.addEventListener('click', () => {
  setArCurbSheetOpen(false);
});

UI.arCurbSheet?.addEventListener('click', (event) => {
  if (event && event.target === UI.arCurbSheet) {
    setArCurbSheetOpen(false);
  }
});

UI.arCurbModeChips?.addEventListener('click', (event) => {
  const button = event && event.target ? event.target.closest('[data-curb-mode]') : null;
  if (!button) return;
  const value = button.dataset ? String(button.dataset.curbMode || 'outer_perimeter') : 'outer_perimeter';
  if (UI.arCurbBoundaryModeSelect) UI.arCurbBoundaryModeSelect.value = value;
  UI.arCurbBoundaryModeSelect?.dispatchEvent(new Event('change', { bubbles: true }));
});

UI.arCurbPresetChips?.addEventListener('click', (event) => {
  const button = event && event.target ? event.target.closest('[data-curb-preset]') : null;
  if (!button) return;
  const value = button.dataset ? String(button.dataset.curbPreset || 'standard') : 'standard';
  if (UI.arCurbPresetSelect) UI.arCurbPresetSelect.value = value;
  state.arCurbDraftPresetId = value;
  syncArCurbSheetUi();
});

UI.arCurbMaterialChips?.addEventListener('click', (event) => {
  const button = event && event.target ? event.target.closest('[data-curb-material]') : null;
  if (!button) return;
  const value = button.dataset ? String(button.dataset.curbMaterial || 'gray') : 'gray';
  if (UI.arCurbMaterialSelect) UI.arCurbMaterialSelect.value = value;
  state.arCurbDraftMaterialId = value;
  syncArCurbSheetUi();
});

UI.arCurbBoundaryModeSelect?.addEventListener('change', () => {
  const activeZone = getActiveZone({ createIfMissing: false });
  if (!activeZone) return;
  const mode = UI.arCurbBoundaryModeSelect && UI.arCurbBoundaryModeSelect.value === 'outer_segments' ? 'outer_segments' : 'outer_perimeter';
  state.arCurbDraftBoundaryMode = mode;
  const allKeys = getOuterBoundaryEdges(activeZone.id).map((edge) => String(edge.key || ''));
  if (mode === 'outer_segments') {
    const normalized = normalizeCurbEdgeKeysForZone(activeZone.id, state.arCurbDraftEdgeKeys);
    state.arCurbDraftEdgeKeys = normalized.length ? normalized : allKeys.slice();
  } else {
    state.arCurbDraftEdgeKeys = allKeys.slice();
  }
  syncArCurbSheetUi();
});

UI.arCurbSegments?.addEventListener('click', (event) => {
  const button = event && event.target ? event.target.closest('.arCurbSegmentChip') : null;
  if (!button) return;
  const edgeKey = button.dataset ? button.dataset.edgeKey : '';
  toggleArCurbDraftEdge(edgeKey);
});

UI.arCurbPresetSelect?.addEventListener('change', () => {
  state.arCurbDraftPresetId = UI.arCurbPresetSelect && UI.arCurbPresetSelect.value ? String(UI.arCurbPresetSelect.value) : 'standard';
  syncArCurbSheetUi();
});

UI.arCurbMaterialSelect?.addEventListener('change', () => {
  state.arCurbDraftMaterialId = UI.arCurbMaterialSelect && UI.arCurbMaterialSelect.value ? String(UI.arCurbMaterialSelect.value) : 'gray';
  syncArCurbSheetUi();
});

UI.btnDone?.addEventListener('click', async () => {
  const activeZoneForDone = getActiveZone({ createIfMissing: false });
  telemetryTrack('ar_visualization_ready', telemetryCtx({ points: state.points.length, holes: state.holes.length, areaM2: Number(computeAreaM2().toFixed ? computeAreaM2().toFixed(3) : computeAreaM2()) }));
  telemetryTrack('ar_zone_add_done', telemetryCtx({
    zoneId: String((activeZoneForDone || {}).id || ''),
    totalZones: getZones().length,
    points: state.points.length,
    holes: state.holes.length,
    areaM2: Number(computeAreaM2().toFixed ? computeAreaM2().toFixed(3) : computeAreaM2()),
  }));
  setActiveZoneStatus('final');
  clearArDraftZoneContext(String((activeZoneForDone || {}).id || ''));
  state.phase = 'ar_final';
  state.snapArmed = false;
  state.snapKind = 'none';
  state.snapPreview = null;
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

  const activeZone = getActiveZone();
  if (activeZone && !activeZone.tileMaterial && activeZone.tileId) {
    try {
      await selectTile(activeZone.tileId);
    } catch (zoneMaterialError) {
      console.warn('zone material ensure failed', zoneMaterialError);
      telemetryError('ar_zone_material_ensure_failed', zoneMaterialError, telemetryCtx({ zoneId: String(activeZone.id || '') }));
    }
  }

  // Atomic Texture Apply (optional): hide fill until core maps are ready (fixes "pale first fill").
  if (state.atomicTexEnabled && typeof atomicEnsureFinalMaterialReady === 'function') {
    await atomicEnsureFinalMaterialReady();
  }

  if (activeZone) {
    rebuildCurbsForZone(activeZone.id, { track: false });
  }

  ensureArFinalControlsBound();
  syncAdminCalibrationUi();
  setCalibrationPanelOpen(false);
  setLayout(state.layout);
  applyTextureRotationDeg(state.textureRotationDeg, { preserveFullCircle: state.textureRotationDeg === 360 });

  if (!state.arTextureRailStartShapeId) {
    state.arTextureRailStartShapeId = state.selectedShape && state.selectedShape.id ? String(state.selectedShape.id) : '';
  }
  renderArTextureRail();
  renderArZoneChips();
  syncArZoneControlsUi();
  syncArDraftAssistUi();
  maybeShowArZoneIntroHint();
  ensureArTextureGroupsBuilt().catch((e) => {
    console.warn('AR texture rail build failed', e);
    telemetryError('ar_texture_rail_build_failed', e, telemetryCtx());
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
  telemetryPage('catalog', { source: 'init' });
  updateArTopInsetVar();
  let data = null;
  try {
    data = await loadTiles();
  } catch (e) {
    console.error('tiles.json недоступен, приложение переведено в безопасный режим каталога:', e);
    telemetryError('tiles_load_failed', e, { resource: 'tiles.json' });
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
    telemetryError('shapes_load_failed', e, { resource: 'shapes.json', fallback: 'tiles_as_catalog' });
    // fallback: каждая плитка как отдельная "форма"
    state.shapes = buildFallbackShapesFromTiles(state.tiles);
    try { buildShapePickerList({ UI, state, setShapePickerOpen: (open) => setShapePickerOpen(open, { UI, updateArTopStripVar, updateArBottomStripVar }), onShapeSelect: handleShapePickerSelection }); } catch (e) {}
  }

  // initial
  renderCatalog(state.shapes, { UI, onShapeSelect: (shapeId) => openDetail(shapeId) });
  renderQuickLaunchSection();
  setActiveScreen('catalog', UI);
  state.phase = 'catalog';

  if (state.adminArEnabled) {
    try { await applyAdminArEntryContext(); } catch (_) {}
  }

  // choose default tile
  const defaultId = state.tiles[0]?.id;
  if (!state.selectedTile && defaultId) await selectTile(defaultId);

  // AR title
  if (UI.arProductTitle && state.selectedTile) UI.arProductTitle.textContent = state.selectedTile.name;

  // set initial layout and neutral texture rotation
  setLayout('straight');
  applyTextureRotationDeg(0);

  // Apply AR entry gating UI (safe on all devices)
  updateArEntryUI(UI);

  buildQuickLaunchItems().catch((e) => {
    console.warn('quick AR rail build failed', e);
    telemetryError('quick_ar_rail_build_failed', e, {});
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
  telemetryError('app_init_failed', err, {});
  alert('Ошибка инициализации: ' + (err?.message || err));
});


// ------------------------
// Shape picker (AR UI)
// ------------------------
async function handleShapePickerSelection(shapeId) {
  setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar });

  const targetShapeId = shapeId != null ? String(shapeId) : '';
  if (!targetShapeId) return;
  telemetryTrack('ar_shape_picker_select', telemetryCtx({ targetShapeId }));

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
      const result = await openDetail(targetShapeId, { preserveScreen: true, keepCurrentTile: true, changeSource: 'shape_picker', source: 'shape_picker' });
      if (state.phase === 'ar_final') {
        show(UI.finalBar, true);
        show(UI.finalColors, true);
        renderArTextureRail();
        ensureArTextureGroupsBuilt().then(() => {
          requestArTextureRailScroll(targetShapeId, { behavior: 'smooth' });
        }).catch((e) => {
          console.warn('AR texture rail refresh failed', e);
      telemetryError('ar_texture_rail_refresh_failed', e, telemetryCtx({ targetShapeId }));
          renderArTextureRail();
        });
      }
      if (result && result.defaultTile && prevTileId && result.defaultTile.id !== prevTileId) {
        // openDetail already applied the fallback/default tile; this branch only documents intent.
      }
    } catch (e) {
      console.error('in-AR shape switch failed', e);
      telemetryError('ar_shape_switch_failed', e, telemetryCtx({ targetShapeId }));
    } finally {
      state._switchingShapeInAr = false;
    }
    return;
  }

  try {
    await openDetail(shapeId, { changeSource: 'shape_picker', source: 'shape_picker' });
  } catch (e) {
    console.error('openDetail failed', e);
    telemetryError('detail_open_failed', e, { targetShapeId });
  }
}
