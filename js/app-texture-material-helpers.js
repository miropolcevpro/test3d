import * as THREE from 'three';
import { clamp } from './utils.js';

function getConnInfo() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const eff = (conn && conn.effectiveType) ? String(conn.effectiveType) : '';
  const downlink = (conn && typeof conn.downlink === 'number') ? conn.downlink : 0;
  const rtt = (conn && typeof conn.rtt === 'number') ? conn.rtt : 0;
  const saveData = !!(conn && conn.saveData);
  return { conn, eff, downlink, rtt, saveData };
}

function computeTexLoadMaxParallel(ctx = {}) {
  try {
    const dm = (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : 0;
    const hc = (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') ? navigator.hardwareConcurrency : 0;
    const { eff, downlink, rtt, saveData } = getConnInfo();
    let max = 4;
    if (dm && dm <= 2) max = 2;
    else if (dm && dm <= 4) max = 3;
    if (hc && hc <= 4) max = Math.min(max, 3);
    if (saveData) max = 2;
    if (/slow-2g|2g/i.test(eff)) max = 1;
    if (/3g/i.test(eff)) max = Math.min(max, 2);
    if (downlink && downlink < 2) max = Math.min(max, 2);
    if (rtt && rtt > 250) max = Math.min(max, 2);
    if (ctx && ctx.xrActive) max = Math.min(max, 2);
    return clamp(max, 1, 4);
  } catch {
    return 3;
  }
}

let _texLoadMaxParallel = computeTexLoadMaxParallel();
let _texLoadActive = 0;
const _texLoadQueue = [];
function pumpTexLoadQueue() {
  while (_texLoadActive < _texLoadMaxParallel && _texLoadQueue.length) {
    const job = _texLoadQueue.shift();
    _texLoadActive++;
    Promise.resolve().then(job.fn).then(
      (res) => { _texLoadActive--; job.resolve(res); pumpTexLoadQueue(); },
      (err) => { _texLoadActive--; job.reject(err); pumpTexLoadQueue(); }
    );
  }
}

function updateTexLoadMaxParallel(ctx = {}) {
  try {
    _texLoadMaxParallel = computeTexLoadMaxParallel(ctx);
    pumpTexLoadQueue();
  } catch (_) {}
}

function runWithTexLoadLimit(fn, opts = {}) {
  const pr = (opts && opts.priority) ? String(opts.priority) : 'normal';
  return new Promise((resolve, reject) => {
    const job = { fn, resolve, reject };
    if (pr === 'high') _texLoadQueue.unshift(job);
    else _texLoadQueue.push(job);
    pumpTexLoadQueue();
  });
}

try { THREE.Cache.enabled = true; } catch (_) {}
const globalTexLoader = new THREE.TextureLoader();
try { globalTexLoader.setCrossOrigin?.('anonymous'); } catch (_) {}
const texPromiseCache = new Map();
const texResolvedUrlCache = new Map();
const texBestQualityCache = new Map();
const texResolvedValueCache = new Map();
const texLastUsedAt = new Map();
const texUrlByUuid = new Map();


function getTelemetryApi() {
  try {
    return (typeof globalThis !== 'undefined' && globalThis.__APP_TELEMETRY__) ? globalThis.__APP_TELEMETRY__ : null;
  } catch (_) {
    return null;
  }
}

function telemetryTrackError(name, err, props = {}) {
  try {
    const api = getTelemetryApi();
    if (api && typeof api.trackError === 'function') api.trackError(name, err, props);
  } catch (_) {}
}


function canonTexKey(url) {
  try {
    if (!url) return '';
    const s0 = String(url);
    const s = s0.split('?')[0];
    const q = s.replace(/\/(1k|2k)\//, '/{q}/');
    const m = q.match(/^(.*)\.[a-zA-Z0-9]+$/);
    return m ? m[1] : q;
  } catch {
    return String(url || '');
  }
}

const texPerf = { any:{ema:0,n:0}, albedo:{ema:0,n:0}, roughness:{ema:0,n:0}, normal:{ema:0,n:0}, ao:{ema:0,n:0}, height:{ema:0,n:0} };
function perfAdd(kind, ms) {
  try {
    const k = texPerf[kind] ? kind : 'any';
    const a = texPerf[k];
    const b = texPerf.any;
    const alpha = 0.22;
    a.ema = a.n ? (a.ema * (1 - alpha) + ms * alpha) : ms;
    a.n++;
    b.ema = b.n ? (b.ema * (1 - alpha) + ms * alpha) : ms;
    b.n++;
  } catch (_) {}
}
function cacheGet(map, key) { return map.has(key) ? map.get(key) : undefined; }

function touchTexture(tex) {
  try {
    if (!tex || !tex.uuid) return;
    const url = texUrlByUuid.get(tex.uuid);
    if (url) texLastUsedAt.set(url, Date.now());
  } catch (_) {}
}

function collectTexturesFromMaterial(material, out = new Set()) {
  try {
    const mats = Array.isArray(material) ? material : [material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const k of ['map','normalMap','roughnessMap','aoMap','bumpMap','metalnessMap','alphaMap','emissiveMap']) {
        const tex = mat[k];
        if (tex && tex.uuid) out.add(tex);
      }
      if (mat.uniforms && typeof mat.uniforms === 'object') {
        for (const u of Object.values(mat.uniforms)) {
          const tex = u && u.value;
          if (tex && tex.uuid && tex.isTexture) out.add(tex);
        }
      }
    }
  } catch (_) {}
  return out;
}

function touchMaterialTextures(material) {
  try {
    const texs = collectTexturesFromMaterial(material);
    texs.forEach(touchTexture);
  } catch (_) {}
}

function loadTextureCached(url, opts = {}) {
  if (!url) return Promise.resolve(null);
  const key = String(url);
  const cached = cacheGet(texPromiseCache, key);
  if (cached) return cached;
  const priority = (opts && opts.priority) ? String(opts.priority) : 'normal';
  const silent = Boolean(opts && opts.silent);
  const kind = (opts && opts.kind) ? String(opts.kind) : '';
  const suppressTelemetry = Boolean(opts && opts.suppressTelemetry);
  const telemetryProps = (opts && opts.telemetryProps && typeof opts.telemetryProps === 'object') ? opts.telemetryProps : {};
  const p = runWithTexLoadLimit(async () => {
    const t0 = performance.now();
    const tex = await globalTexLoader.loadAsync(key);
    const dt = performance.now() - t0;
    if (dt && dt < 60000) perfAdd(kind || 'any', dt);
    return tex;
  }, { priority }).then((tex) => {
    if (tex) {
      texResolvedValueCache.set(key, tex);
      texLastUsedAt.set(key, Date.now());
      if (tex.uuid) texUrlByUuid.set(tex.uuid, key);
    }
    return tex || null;
  }).catch((err) => {
    texPromiseCache.delete(key);
    if (!silent) console.warn('[surfaces] failed to load texture:', key, err);
    return null;
  });
  texPromiseCache.set(key, p);
  return p;
}

function make2kCandidateUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\/1k\//, '/2k/');
}
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

async function loadTexSmartCached(url, label, preferredQuality, isStaleFn, opts = {}) {
  if (!url) return null;
  const priority = (opts && opts.priority) ? String(opts.priority) : 'normal';
  const kind = label ? String(label) : 'any';
  const fast2kFallbackMs = Math.max(0, Number(opts && opts.fast2kFallbackMs) || 0);
  let desiredQuality = (preferredQuality === '2k') ? '2k' : '1k';
  const canon = canonTexKey(url);
  const qKey = `${kind}|${canon}`;
  const learnedBest = cacheGet(texBestQualityCache, qKey);
  if (desiredQuality === '2k' && learnedBest === '1k') desiredQuality = '1k';
  const baseKey = `${desiredQuality}|${String(url)}`;
  const cachedResolved = cacheGet(texResolvedUrlCache, baseKey);
  if (cachedResolved) {
    const t0 = await loadTextureCached(cachedResolved, { priority, silent: true, kind });
    if (isStaleFn && isStaleFn()) return null;
    if (t0) return t0;
    texResolvedUrlCache.delete(baseKey);
  }
  const candidates = [];
  const pushUnique = (u) => { if (u && !candidates.includes(u)) candidates.push(u); };
  const pushWithAlts = (u) => { pushUnique(u); for (const a of makeAltExtCandidates(u)) pushUnique(a); };
  const u1k = make1kCandidateUrl(url);
  const u2k = make2kCandidateUrl(url);
  if (desiredQuality === '2k') { pushWithAlts(u2k); pushWithAlts(u1k); }
  else { pushWithAlts(u1k); if (u2k && u2k !== u1k) pushWithAlts(u2k); }
  for (const u of candidates) {
    if (isStaleFn && isStaleFn()) return null;
    const is2kAttempt = String(u).includes('/2k/');
    let tex = null;
    if (desiredQuality === '2k' && is2kAttempt && fast2kFallbackMs > 0) {
      const timed = await Promise.race([
        loadTextureCached(u, { priority, silent: true, kind }).then((v) => ({ ok: true, tex: v || null })).catch(() => ({ ok: false, tex: null })),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, tex: null, timeout: true }), fast2kFallbackMs)),
      ]);
      tex = timed && timed.ok ? timed.tex : null;
      if (!tex && timed && timed.timeout) {
        try { texBestQualityCache.set(qKey, '1k'); } catch (_) {}
      }
    } else {
      tex = await loadTextureCached(u, { priority, silent: true, kind });
    }
    if (isStaleFn && isStaleFn()) return null;
    if (tex) {
      texResolvedUrlCache.set(baseKey, u);
      const usedQ = (String(u).includes('/2k/')) ? '2k' : '1k';
      texBestQualityCache.set(qKey, usedQ);
      if (label && u !== url) console.warn(`[surfaces] used alternate URL for ${kind}: ${u}`);
      return tex;
    }
  }
  if ((preferredQuality === '2k') && !cacheGet(texBestQualityCache, qKey)) texBestQualityCache.set(qKey, '1k');
  if (!suppressTelemetry) {
    telemetryTrackError('texture_map_load_failed', new Error(`texture map load failed: ${kind || 'map'}`), {
      kind: kind || 'map',
      requestedUrl: String(url || ''),
      preferredQuality: desiredQuality,
      candidatesTried: candidates.length,
      telemetrySource: 'loadTexSmartCached',
      ...telemetryProps,
    });
  }
  return null;
}

function prepMapTex(tex, isColor = false) {
  if (!tex) return null;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  try { if ('colorSpace' in tex) tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace; } catch (_) {}
  try { if ('encoding' in tex) tex.encoding = isColor ? THREE.sRGBEncoding : THREE.LinearEncoding; } catch (_) {}
  return tex;
}

let fallbackWhiteTex = null;
function getFallbackWhiteTex() {
  if (fallbackWhiteTex) return fallbackWhiteTex;
  const data = new Uint8Array([255,255,255,255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  try { if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; } catch (_) {}
  try { if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding; } catch (_) {}
  fallbackWhiteTex = tex;
  return tex;
}

function applyMapToTileMaterial(mat, kind, tex) {
  if (!mat || !mat.uniforms) return;
  if (tex) prepMapTex(tex, kind === 'albedo');
  if (kind === 'albedo') {
    mat.uniforms.uTex.value = tex;
    if (mat.uniforms.uTex2) { mat.uniforms.uTex2.value = null; mat.uniforms.uHasTex2.value = 0; mat.uniforms.uTexMix.value = 0.0; }
  } else if (kind === 'normal') {
    mat.uniforms.uNormalTex.value = tex; mat.uniforms.uHasNormal.value = tex ? 1 : 0;
  } else if (kind === 'roughness') {
    mat.uniforms.uRoughTex.value = tex; mat.uniforms.uHasRough.value = tex ? 1 : 0;
  } else if (kind === 'ao') {
    mat.uniforms.uAoTex.value = tex; mat.uniforms.uHasAo.value = tex ? 1 : 0;
  } else if (kind === 'height') {
    mat.uniforms.uHeightTex.value = tex; mat.uniforms.uHasHeight.value = tex ? 1 : 0;
  }
}

const warmedTexUuids = new Set();
let warmupRT = null, warmupScene = null, warmupCam = null, warmupMesh = null;
function warmupTextureOnGPU(tex, isColor = false, renderer = null) {
  try {
    if (!tex || !renderer || (renderer.xr && renderer.xr.isPresenting)) return;
    if (warmedTexUuids.has(tex.uuid)) return;
    prepMapTex(tex, isColor);
    if (!warmupRT) warmupRT = new THREE.WebGLRenderTarget(1, 1);
    if (!warmupScene) {
      warmupScene = new THREE.Scene();
      warmupCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      warmupMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ transparent: false }));
      warmupScene.add(warmupMesh);
    }
    warmupMesh.material.map = tex;
    warmupMesh.material.needsUpdate = true;
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(warmupRT);
    renderer.render(warmupScene, warmupCam);
    renderer.setRenderTarget(prevRT);
    warmedTexUuids.add(tex.uuid);
  } catch (_) {}
}

function crossfadeAlbedoOnMaterial(mat, newAlbedoTex, durationMs = 140) {
  try {
    prepMapTex(newAlbedoTex, true);
    if (!mat || !mat.uniforms || !mat.uniforms.uTex || !mat.uniforms.uTex2 || !newAlbedoTex) {
      if (mat) applyMapToTileMaterial(mat, 'albedo', newAlbedoTex);
      return;
    }
    const oldTex = mat.uniforms.uTex.value;
    if (!oldTex) {
      applyMapToTileMaterial(mat, 'albedo', newAlbedoTex);
      mat.uniforms.uHasTex2.value = 0; mat.uniforms.uTex2.value = null; mat.uniforms.uTexMix.value = 0.0;
      return;
    }
    mat.uniforms.uTex2.value = newAlbedoTex;
    mat.uniforms.uHasTex2.value = 1;
    mat.uniforms.uTexMix.value = 0.0;
    const t0 = performance.now();
    const ease = (k) => k * k * (3.0 - 2.0 * k);
    const step = (now) => {
      const k = clamp((now - t0) / Math.max(1, durationMs), 0, 1);
      mat.uniforms.uTexMix.value = ease(k);
      if (k < 1) { requestAnimationFrame(step); return; }
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

function computeAutoExposureMultFromTexture(tex) {
  try {
    const img = tex && tex.image;
    if (!img) return 1.0;
    const w = Math.max(1, Math.min(64, img.naturalWidth || img.width || 64));
    const h = Math.max(1, Math.min(64, img.naturalHeight || img.height || 64));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 1.0;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const srgbToLinear = (c) => { c = c / 255; return (c <= 0.04045) ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4); };
    let sum = 0;
    const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const r = srgbToLinear(data[i]);
      const g = srgbToLinear(data[i + 1]);
      const b = srgbToLinear(data[i + 2]);
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const meanLuma = sum / Math.max(1, n);
    return clamp(0.62 + 0.70 * meanLuma, 0.70, 1.00);
  } catch (_) {
    return 1.0;
  }
}

function withTimeout(promise, ms) {
  let tId = null;
  const to = new Promise(resolve => { tId = setTimeout(() => resolve({ ok: false, timeout: true, v: null }), ms); });
  return Promise.race([
    Promise.resolve(promise).then(v => ({ ok: true, v })).catch(e => ({ ok: false, error: e, v: null })),
    to,
  ]).finally(() => { if (tId) clearTimeout(tId); });
}

async function loadTileAlbedoWithFallback(tile, preferredQuality, isStaleFn, opts = {}) {
  const getTileAlbedoCandidates = (opts && typeof opts.getTileAlbedoCandidates === 'function') ? opts.getTileAlbedoCandidates : null;
  const candidates = getTileAlbedoCandidates ? getTileAlbedoCandidates(tile) : [];
  const telemetryProps = (opts && opts.telemetryProps && typeof opts.telemetryProps === 'object') ? opts.telemetryProps : {};
  for (let i = 0; i < candidates.length; i += 1) {
    const candidateUrl = candidates[i];
    const tex = await loadTexSmartCached(candidateUrl, 'albedo', preferredQuality, isStaleFn, { ...opts, suppressTelemetry: true });
    if (isStaleFn && isStaleFn()) return { tex: null, sourceUrl: '', usedFallback: false };
    if (tex) return { tex, sourceUrl: candidateUrl, usedFallback: i > 0 };
  }
  telemetryTrackError('texture_map_load_failed', new Error('albedo candidates exhausted'), {
    kind: 'albedo',
    requestedUrl: String(candidates[0] || ''),
    preferredQuality: String(preferredQuality || ''),
    candidatesTried: candidates.length,
    tileId: tile && tile.id ? String(tile.id) : '',
    shapeId: tile && tile.shapeId ? String(tile.shapeId) : '',
    telemetrySource: 'loadTileAlbedoWithFallback',
    ...telemetryProps,
  });
  return { tex: null, sourceUrl: '', usedFallback: false };
}

function trimTextureCaches(opts = {}) {
  try {
    const maxEntries = Math.max(8, Number.isFinite(opts.maxEntries) ? Number(opts.maxEntries) : 40);
    const maxAgeMs = Math.max(30000, Number.isFinite(opts.maxAgeMs) ? Number(opts.maxAgeMs) : 10 * 60 * 1000);
    const protectedSet = new Set();
    const protectedItems = Array.isArray(opts.protected) ? opts.protected : [];
    for (const item of protectedItems) {
      if (!item) continue;
      if (item.isTexture && item.uuid) protectedSet.add(item.uuid);
      else collectTexturesFromMaterial(item).forEach((t) => { if (t && t.uuid) protectedSet.add(t.uuid); });
    }
    const now = Date.now();
    const entries = [];
    for (const [url, tex] of texResolvedValueCache.entries()) {
      if (!tex || !tex.uuid) continue;
      if (fallbackWhiteTex && tex === fallbackWhiteTex) continue;
      entries.push({ url, tex, lastUsed: texLastUsedAt.get(url) || 0, protected: protectedSet.has(tex.uuid) });
    }
    const removable = entries.filter((e) => !e.protected).sort((a, b) => a.lastUsed - b.lastUsed);
    let overflow = Math.max(0, entries.length - maxEntries);
    for (const entry of removable) {
      const stale = (now - entry.lastUsed) > maxAgeMs;
      if (!stale && overflow <= 0) continue;
      try { entry.tex.dispose?.(); } catch (_) {}
      texPromiseCache.delete(entry.url);
      texResolvedValueCache.delete(entry.url);
      texLastUsedAt.delete(entry.url);
      if (entry.tex.uuid) {
        texUrlByUuid.delete(entry.tex.uuid);
        warmedTexUuids.delete(entry.tex.uuid);
      }
      overflow = Math.max(0, overflow - 1);
    }
  } catch (_) {}
}

function disposeWarmupResources() {
  try {
    warmupRT?.dispose?.();
    warmupRT = null;
    if (warmupMesh) {
      try { warmupMesh.geometry?.dispose?.(); } catch (_) {}
      try { warmupMesh.material?.dispose?.(); } catch (_) {}
    }
    warmupMesh = null;
    warmupScene = null;
    warmupCam = null;
  } catch (_) {}
}


function getSurfaceRuntimeTuning(ctx = {}) {
  try {
    const sp = new URLSearchParams(window.location.search || '');
    const forcedPrefetch = sp.get('prefetch');
    const forcedWarm = (sp.get('warm') || '').toLowerCase();
    const forcedMaps = (sp.get('maps') || '').toLowerCase();
    const inAR = !!(ctx && (ctx.inAR || ctx.xrActive || ctx.phase === 'ar_final'));
    const dm = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 0;
    const hc = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
    const { eff, downlink, rtt, saveData } = getConnInfo();
    const avgAny = texPerf.any.n ? texPerf.any.ema : 0;
    const avgAlb = texPerf.albedo.n ? texPerf.albedo.ema : 0;
    let tier = 'balanced';
    if (saveData || /slow-2g|2g|3g/i.test(eff) || (downlink && downlink < 2) || (rtt && rtt > 300) || (dm && dm <= 2) || (hc && hc <= 4) || (avgAny && avgAny > 500) || (avgAlb && avgAlb > 420)) tier = 'low';
    else if ((dm >= 6 && hc >= 8 && (!avgAny || avgAny < 240) && (!downlink || downlink >= 8) && (!rtt || rtt <= 120))) tier = 'high';

    const preferredQuality = getPreferredSurfaceQuality({ ...ctx, inAR });
    const tuning = {
      tier,
      preferredQuality,
      prefetchNeighbors: tier === 'high' ? 2 : (tier === 'balanced' ? 1 : 0),
      prefetchDelayMs: tier === 'high' ? 140 : (tier === 'balanced' ? 220 : 320),
      prefetchMapKinds: tier === 'high' ? ['albedo','roughness','normal'] : (tier === 'balanced' ? ['albedo','roughness'] : ['albedo']),
      prefetchQuality: tier === 'high' && !inAR ? preferredQuality : '1k',
      warmupMapKinds: tier === 'high' ? ['albedo','roughness','normal'] : (tier === 'balanced' ? ['albedo','roughness'] : ['albedo']),
      coreWaitMs: inAR ? (tier === 'high' ? 420 : 320) : (tier === 'high' ? 320 : 240),
      postApplyDelayMs: inAR ? (tier === 'high' ? 60 : 90) : (tier === 'high' ? 50 : 80),
      heavyMapsDelayMs: inAR ? (tier === 'high' ? 900 : 1400) : (tier === 'high' ? 700 : 1100),
      heavyMapsDebounceMs: tier === 'high' ? 260 : 380,
      loadHeightInAR: tier === 'high',
      loadHeightOutsideAR: tier !== 'low',
      trimMaxEntries: inAR ? (tier === 'high' ? 32 : 24) : (tier === 'high' ? 44 : 36),
      trimMaxAgeMs: inAR ? (tier === 'high' ? 180000 : 120000) : (tier === 'high' ? 420000 : 240000),
    };
    if (forcedPrefetch != null && forcedPrefetch != '') {
      const n = Math.max(0, Math.min(2, Number(forcedPrefetch) || 0));
      tuning.prefetchNeighbors = n;
    }
    if (forcedWarm === 'all') tuning.warmupMapKinds = ['albedo','roughness','normal'];
    else if (forcedWarm === 'off' || forcedWarm === '0') tuning.warmupMapKinds = [];
    if (forcedMaps === 'lite') {
      tuning.loadHeightInAR = false;
      tuning.loadHeightOutsideAR = false;
    } else if (forcedMaps === 'full') {
      tuning.loadHeightInAR = true;
      tuning.loadHeightOutsideAR = true;
    }
    return tuning;
  } catch (_) {
    return {
      tier: 'balanced', preferredQuality: '1k', prefetchNeighbors: 1, prefetchDelayMs: 220,
      prefetchMapKinds: ['albedo','roughness'], prefetchQuality: '1k', warmupMapKinds: ['albedo','roughness'],
      coreWaitMs: 260, postApplyDelayMs: 80, heavyMapsDelayMs: 1200, heavyMapsDebounceMs: 350,
      loadHeightInAR: false, loadHeightOutsideAR: true, trimMaxEntries: 36, trimMaxAgeMs: 240000,
    };
  }
}

function getPreferredSurfaceQuality(ctx = {}) {
  try {
    const sp = new URLSearchParams(window.location.search || '');
    const forced = (sp.get('tex') || '').toLowerCase();
    if (forced === '1k' || forced === '2k') return forced;
    const dm = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 0;
    const hc = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
    const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
    const minPx = Math.min(window.screen?.width || 0, window.screen?.height || 0) * dpr;
    const { eff, downlink, rtt, saveData } = getConnInfo();
    const inAR = !!(ctx && (ctx.inAR || ctx.xrActive || ctx.phase === 'ar_final'));
    const avgAny = texPerf.any.n ? texPerf.any.ema : 0;
    const avgAlb = texPerf.albedo.n ? texPerf.albedo.ema : 0;
    const avgRgh = texPerf.roughness.n ? texPerf.roughness.ema : 0;
    if (saveData) return '1k';
    if (/slow-2g|2g|3g/i.test(eff)) return '1k';
    if (downlink && downlink < 2) return '1k';
    if (rtt && rtt > 250) return '1k';
    if ((avgAny && avgAny > 520) || (avgAlb && avgAlb > 420) || (avgRgh && avgRgh > 520)) return '1k';
    if (inAR) {
      if (dm >= 6 && hc >= 8 && minPx >= 1080 && (!avgAny || avgAny < 260)) return '2k';
      return '1k';
    }
    if (dm >= 4 && hc >= 6 && minPx >= 1080) return '2k';
    if (dm >= 3 && hc >= 4 && minPx >= 900 && (!avgAny || avgAny < 320)) return '2k';
    return '1k';
  } catch {
    return '1k';
  }
}

export { getConnInfo, updateTexLoadMaxParallel, loadTexSmartCached, applyMapToTileMaterial, warmupTextureOnGPU, crossfadeAlbedoOnMaterial, prepMapTex, getFallbackWhiteTex, computeAutoExposureMultFromTexture, withTimeout, loadTileAlbedoWithFallback, getPreferredSurfaceQuality, getSurfaceRuntimeTuning, make2kCandidateUrl, make1kCandidateUrl, makeAltExtCandidates, touchTexture, touchMaterialTextures, trimTextureCaches, disposeWarmupResources };
