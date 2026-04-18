import { sanitizePalettePayload, reportValidationWarnings, fetchJsonResource, formatResourceError, isMissingResourceError, isRetryableResourceError } from './utils.js';

const runtimeConfig = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) ? window.__RUNTIME_CONFIG__ : null;
const contentIdentity = (typeof window !== 'undefined' && window.__CONTENT_IDENTITY__) ? window.__CONTENT_IDENTITY__ : null;

function defaultWarnOnce(key, ...args) {
  console.warn(...args);
}


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

function getSiteEnv() {
  return (typeof window !== 'undefined' && window.__SITE_ENV__) ? window.__SITE_ENV__ : null;
}

function normalizeTextureKey(shapeId, textureId) {
  if (contentIdentity && typeof contentIdentity.comparableTextureKey === 'function') {
    return contentIdentity.comparableTextureKey(shapeId, textureId);
  }
  const s = String(textureId || '').trim();
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9_\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function buildPalettePathResolver(url, data) {
  const paletteURL = new URL(url, window.location.href);
  const paletteDir = new URL('.', paletteURL).toString();
  const siteEnv = getSiteEnv();
  const siteRoot = (siteEnv && siteEnv.siteBaseUrl) ? siteEnv.siteBaseUrl : new URL('./', window.location.href).toString();

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

  return function resolvePath(p) {
    if (!p) return p;
    const s = String(p);

    if (isAbs(s) || isSpecial(s)) return s;
    if (baseAbs) return new URL(s.replace(/^\/+/, ''), baseAbs).toString();
    if (s.startsWith('./') || s.startsWith('../')) return new URL(s, paletteDir).toString();
    if (s.startsWith('assets/') || s.startsWith('css/') || s.startsWith('js/')) {
      return (siteEnv && typeof siteEnv.resolveSiteUrl === 'function')
        ? siteEnv.resolveSiteUrl(s)
        : new URL(s, siteRoot).toString();
    }
    if (paletteURL.hostname.endsWith('storage.yandexcloud.net')) {
      return new URL(s.replace(/^\/+/, ''), bucketRoot).toString();
    }
    return (siteEnv && typeof siteEnv.resolveSiteUrl === 'function')
      ? siteEnv.resolveSiteUrl(s)
      : new URL(s.replace(/^\/+/, ''), siteRoot).toString();
  };
}

export async function loadSurfacePalette(url, opts = {}) {
  if (!url) return null;
  const cache = (opts.cache && typeof opts.cache.get === 'function' && typeof opts.cache.set === 'function') ? opts.cache : null;
  const warnOnce = (typeof opts.warnOnce === 'function') ? opts.warnOnce : defaultWarnOnce;
  const cacheKey = String(opts.cacheKey || url).trim() || String(url);
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const rawData = await fetchJsonResource(url, {
      label: `palette ${url}`,
      cache: 'no-store',
    });
    const { payload: data, warnings } = sanitizePalettePayload(rawData, { context: url });
    reportValidationWarnings(`palette ${url}`, warnings);
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      warnOnce(`palette-empty:${url}`,
        '[surfaces] Палитра не содержит пригодных элементов. Используем встроенные плитки формы.');
      if (cache) cache.set(cacheKey, null);
      return null;
    }

    const resolvePath = buildPalettePathResolver(url, data);
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

    if (cache) cache.set(cacheKey, items);
    return items;
  } catch (err) {
    const suffix = isRetryableResourceError(err)
      ? 'Используем встроенные плитки формы; при повторном открытии попробуем загрузить палитру снова.'
      : 'Используем встроенные плитки формы.';
    warnOnce(`palette:${url}:${err?.resourceKind || 'unknown'}:${err?.status || 0}`,
      '[surfaces] ' + formatResourceError(err, suffix));
    telemetryTrackError(err && err.resourceKind === 'json' ? 'palette_parse_failed' : 'palette_load_failed', err, {
      resource: String(url || ''),
      scope: 'surface_palette',
      status: Number(err && err.status || 0) || 0,
      resourceKind: err && err.resourceKind ? String(err.resourceKind) : 'unknown',
    });
    if (cache && isMissingResourceError(err)) {
      cache.set(cacheKey, null);
    }
    return null;
  }
}

export async function loadPaletteDefaultsForShape(shapeId, opts = {}) {
  const enabled = opts.enabled === true;
  const paletteSettingsBaseUrl = String(opts.paletteSettingsBaseUrl || '').trim();
  const cache = (opts.cache && typeof opts.cache.get === 'function' && typeof opts.cache.set === 'function') ? opts.cache : null;
  const warnOnce = (typeof opts.warnOnce === 'function') ? opts.warnOnce : defaultWarnOnce;
  if (!enabled || !shapeId || !paletteSettingsBaseUrl) return null;
  const url = `${paletteSettingsBaseUrl}${encodeURIComponent(shapeId)}.json`;
  const cacheKey = `palette-defaults:${String(shapeId).trim()}`;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
  try {
    const data = await fetchJsonResource(url, {
      label: `palette_settings ${shapeId}`,
      cache: 'no-store',
    });
    const d = (data && typeof data === 'object') ? data.defaults : null;
    if (!d || typeof d !== 'object') {
      if (cache) cache.set(cacheKey, null);
      return null;
    }
    if (d.tileSizeM && (typeof d.tileSizeM.w !== 'number' || typeof d.tileSizeM.h !== 'number')) {
      delete d.tileSizeM;
    }
    if (cache) cache.set(cacheKey, d);
    return d;
  } catch (err) {
    if (!isMissingResourceError(err)) {
      const suffix = isRetryableResourceError(err)
        ? 'Продолжаем без defaults; при следующем открытии попробуем ещё раз.'
        : 'Продолжаем без defaults.';
      warnOnce(`palette-defaults:${shapeId}:${err?.resourceKind || 'unknown'}:${err?.status || 0}`,
        '[surfaces] ' + formatResourceError(err, suffix));
    }
    telemetryTrackError(err && err.resourceKind === 'json' ? 'palette_parse_failed' : 'palette_load_failed', err, {
      resource: String(url || ''),
      scope: 'palette_defaults',
      shapeId: String(shapeId || ''),
      status: Number(err && err.status || 0) || 0,
      resourceKind: err && err.resourceKind ? String(err.resourceKind) : 'unknown',
    });
    if (cache && isMissingResourceError(err)) {
      cache.set(cacheKey, null);
    }
    return null;
  }
}

export async function filterPaletteItemsBySurfaces(shapeId, items, opts = {}) {
  const apiBaseUrl = String(opts.apiBaseUrl || '').trim();
  const warnOnce = (typeof opts.warnOnce === 'function') ? opts.warnOnce : defaultWarnOnce;
  if (!apiBaseUrl) return items;
  try {
    const url = `${apiBaseUrl}api/surfaces/${encodeURIComponent(shapeId)}`;
    const data = await fetchJsonResource(url, {
      label: `surfaces ${shapeId}`,
      cache: 'no-store',
    });
    const textures = data && data.textures;
    let folderNames = [];
    if (Array.isArray(textures)) {
      folderNames = textures.map(t => t && (t.id || t.textureId || t.folder || t.name)).filter(Boolean);
    } else if (textures && typeof textures === 'object') {
      folderNames = Object.keys(textures);
    }
    if (!folderNames.length) return items;

    const normSet = new Set(folderNames.map(fn => normalizeTextureKey(shapeId, fn)).filter(Boolean));
    const out = (Array.isArray(items) ? items : []).filter((it) => {
      if (!it || typeof it !== 'object') return false;
      const candidates = [it.id, it.textureId, it.canonicalId, it.name].filter(Boolean);
      for (const c of candidates) {
        const n = normalizeTextureKey(shapeId, c);
        if (n && normSet.has(n)) return true;
      }
      return false;
    });
    if (!out.length && Array.isArray(items) && items.length) {
      warnOnce(`surfaces-empty:${shapeId}`,
        '[surfaces] Reconcile-фильтр вернул пустое пересечение. Сохраняем исходную палитру для стабильности.');
      return items;
    }
    return out;
  } catch (err) {
    if (!isMissingResourceError(err)) {
      const suffix = isRetryableResourceError(err)
        ? 'Оставляем палитру без reconcile-фильтра и сможем повторить запрос позже.'
        : 'Оставляем палитру без reconcile-фильтра.';
      warnOnce(`surfaces:${shapeId}:${err?.resourceKind || 'unknown'}:${err?.status || 0}`,
        '[surfaces] ' + formatResourceError(err, suffix));
    }
    return items;
  }
}
