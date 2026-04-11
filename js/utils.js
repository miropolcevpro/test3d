const DEFAULT_TILE_SIZE_M = Object.freeze({ w: 0.2, h: 0.2 });
const NUMERIC_PARAM_KEYS = new Set([
  'albedoGain',
  'roughnessMult',
  'specStrength',
  'normalScale',
  'bumpScale',
  'exposureMult',
  'contrast',
  'saturation',
]);
const LAYOUT_CODE_ALIASES = new Map([
  ['straight', 'straight'],
  ['прямая', 'straight'],
  ['diagonal', 'diagonal'],
  ['диагональ', 'diagonal'],
  ['диагональ 45', 'diagonal'],
  ['диагональ 45°', 'diagonal'],
  ['stagger', 'stagger'],
  ['вразбежку', 'stagger'],
]);
const DEFAULT_SHAPE_SUBTITLE = 'Тротуарная плитка';

const contentIdentity = (typeof window !== 'undefined' && window.__CONTENT_IDENTITY__) ? window.__CONTENT_IDENTITY__ : null;

function canonicalEntityId(value, fallback = '') {
  if (contentIdentity && typeof contentIdentity.canonicalEntityId === 'function') return contentIdentity.canonicalEntityId(value, fallback);
  return asNonEmptyString(value, fallback);
}

function canonicalShapeId(value, fallback = '') {
  if (contentIdentity && typeof contentIdentity.canonicalShapeId === 'function') return contentIdentity.canonicalShapeId(value, fallback);
  return canonicalEntityId(value, fallback).toLowerCase();
}

function canonicalTextureId(shapeId, value, fallback = '') {
  if (contentIdentity && typeof contentIdentity.canonicalTextureId === 'function') return contentIdentity.canonicalTextureId(shapeId, value, fallback);
  const sid = canonicalShapeId(shapeId);
  const raw = canonicalEntityId(value, fallback);
  return sid && raw ? `${sid}:${raw}` : raw;
}

function normalizeContentPath(value, fallback = '') {
  if (contentIdentity && typeof contentIdentity.normalizeContentPath === 'function') return contentIdentity.normalizeContentPath(value, fallback);
  return asNonEmptyString(value, fallback);
}


function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value, fallback = '') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function sanitizeId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function asNonEmptyPath(value, fallback = '') {
  const normalized = normalizeContentPath(value);
  if (!normalized) return normalizeContentPath(fallback);
  return normalized;
}

function resolveKnownTileId(tileId, knownTileIds) {
  if (!(knownTileIds instanceof Set) || !knownTileIds.size) return tileId;
  if (knownTileIds.has(tileId)) return tileId;
  if (typeof tileId === 'string' && /^\d+$/.test(tileId)) {
    const asNum = Number(tileId);
    if (knownTileIds.has(asNum)) return asNum;
  }
  if (typeof tileId === 'number' && Number.isFinite(tileId)) {
    const asStr = String(tileId);
    if (knownTileIds.has(asStr)) return asStr;
  }
  return null;
}

function toFinitePositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function sanitizeTileSizeM(value, warnings, context) {
  if (!isPlainObject(value)) {
    if (value != null) warnings.push(`${context}: tileSizeM должен быть объектом { w, h }; применён безопасный размер 0.2×0.2 м`);
    return { ...DEFAULT_TILE_SIZE_M };
  }

  const w = toFinitePositiveNumber(value.w, DEFAULT_TILE_SIZE_M.w);
  const h = toFinitePositiveNumber(value.h, DEFAULT_TILE_SIZE_M.h);
  if (w !== Number(value.w) || h !== Number(value.h)) {
    warnings.push(`${context}: tileSizeM содержит некорректные значения; применён безопасный размер ${w}×${h} м`);
  }
  return { w, h };
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asNonEmptyPath(item)).filter(Boolean);
}

function sanitizeGallery(value, warnings, context) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${context}: gallery должен быть массивом строк; значение проигнорировано`);
    return [];
  }
  const out = value.map((item) => asNonEmptyPath(item)).filter(Boolean);
  if (out.length !== value.length) {
    warnings.push(`${context}: часть записей gallery отброшена как некорректная`);
  }
  return out;
}

function sanitizeTech(value, warnings, context) {
  if (value == null) return {};
  if (!isPlainObject(value)) {
    warnings.push(`${context}: tech должен быть объектом пар ключ/значение; значение проигнорировано`);
    return {};
  }

  const out = {};
  Object.entries(value).forEach(([rawKey, rawVal]) => {
    const key = asNonEmptyString(rawKey);
    if (!key) return;
    if (rawVal == null) {
      out[key] = '—';
      return;
    }
    if (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean') {
      out[key] = String(rawVal);
      return;
    }
    warnings.push(`${context}: tech[${key}] не является скалярным значением; заменено на "—"`);
    out[key] = '—';
  });
  return out;
}

function sanitizeMaps(value, warnings, context) {
  if (value == null) return null;
  if (!isPlainObject(value)) {
    warnings.push(`${context}: maps должен быть объектом; значение проигнорировано`);
    return null;
  }

  const out = {};
  Object.entries(value).forEach(([key, rawVal]) => {
    const val = asNonEmptyPath(rawVal);
    if (!val) {
      if (rawVal != null) warnings.push(`${context}: maps.${key} должен быть непустой строкой; значение проигнорировано`);
      return;
    }
    out[key] = val;
  });
  return Object.keys(out).length ? out : null;
}

function sanitizeScaleLike(value, warnings, context, fieldName) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (isPlainObject(value)) {
    const out = {};
    if (Number.isFinite(Number(value.x)) && Number(value.x) > 0) out.x = Number(value.x);
    if (Number.isFinite(Number(value.y)) && Number(value.y) > 0) out.y = Number(value.y);
    if (Object.keys(out).length) return out;
  }
  warnings.push(`${context}: params.${fieldName} имеет некорректный формат; значение проигнорировано`);
  return null;
}

function sanitizeParams(value, warnings, context) {
  if (value == null) return null;
  if (!isPlainObject(value)) {
    warnings.push(`${context}: params должен быть объектом; значение проигнорировано`);
    return null;
  }

  const out = {};
  Object.entries(value).forEach(([key, rawVal]) => {
    if (NUMERIC_PARAM_KEYS.has(key)) {
      const num = Number(rawVal);
      if (Number.isFinite(num)) out[key] = num;
      else warnings.push(`${context}: params.${key} должен быть числом; значение проигнорировано`);
      return;
    }

    if (key === 'uvScale' || key === 'repeatScale') {
      const scale = sanitizeScaleLike(rawVal, warnings, context, key);
      if (scale != null) out[key] = scale;
      return;
    }

    if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      out[key] = rawVal;
      return;
    }

    if (typeof rawVal === 'string' && rawVal.trim()) {
      out[key] = rawVal.trim();
      return;
    }

    if (typeof rawVal === 'boolean') {
      out[key] = rawVal;
      return;
    }

    warnings.push(`${context}: params.${key} имеет неподдерживаемый тип; значение проигнорировано`);
  });

  return Object.keys(out).length ? out : null;
}


function normalizeLayoutCode(value) {
  const normalized = asNonEmptyString(value).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (LAYOUT_CODE_ALIASES.has(normalized)) return LAYOUT_CODE_ALIASES.get(normalized) || '';
  if (normalized.startsWith('диагональ')) return 'diagonal';
  return '';
}

function sanitizeLayoutCodes(value, warnings, context, fallbackRecommendedLayouts = []) {
  const out = [];
  const addCode = (rawVal, warnOnFailure = false) => {
    const code = normalizeLayoutCode(rawVal);
    if (!code) {
      if (warnOnFailure && rawVal != null) warnings.push(`${context}: layoutCodes содержит неподдерживаемое значение "${String(rawVal)}"; оно отброшено`);
      return;
    }
    if (!out.includes(code)) out.push(code);
  };

  if (Array.isArray(value)) {
    value.forEach((rawVal) => addCode(rawVal, true));
  } else if (value != null) {
    warnings.push(`${context}: layoutCodes должен быть массивом строк; значение проигнорировано`);
  }

  if (!out.length && Array.isArray(fallbackRecommendedLayouts)) {
    fallbackRecommendedLayouts.forEach((rawVal) => addCode(rawVal, false));
  }

  return out;
}

function sanitizeRecommendedLayouts(value, warnings, context) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${context}: recommendedLayouts должен быть массивом строк; значение проигнорировано`);
    return [];
  }
  const out = sanitizeStringArray(value);
  if (out.length !== value.length) {
    warnings.push(`${context}: часть записей recommendedLayouts отброшена как некорректная`);
  }
  return out;
}

function cloneKnownObject(raw) {
  return isPlainObject(raw) ? { ...raw } : {};
}

function createResourceError(message, details = {}) {
  const err = new Error(message);
  Object.assign(err, details);
  return err;
}

export function isMissingResourceError(err) {
  if (!err || typeof err !== 'object') return false;
  const status = Number(err.status);
  return err.resourceKind === 'http' && (status === 404 || status === 410);
}

export function isRetryableResourceError(err) {
  if (!err || typeof err !== 'object') return false;
  if (typeof err.retryable === 'boolean') return err.retryable;
  if (err.resourceKind === 'network' || err.resourceKind === 'json') return true;
  if (err.resourceKind === 'http') {
    const status = Number(err.status);
    return !status || status >= 500 || status === 408 || status === 425 || status === 429;
  }
  return false;
}

export function formatResourceError(err, fallbackMessage = '') {
  const base = (err && err.message) ? String(err.message) : 'Ошибка загрузки ресурса';
  return fallbackMessage ? `${base}. ${fallbackMessage}` : base;
}

export async function fetchJsonResource(url, options = {}) {
  const label = asNonEmptyString(options.label, asNonEmptyString(url, 'JSON resource'));
  const fetchOptions = {
    cache: options.cache || 'no-store',
    method: options.method || 'GET',
  };

  if (options.headers && typeof options.headers === 'object') {
    fetchOptions.headers = options.headers;
  }

  let response = null;
  try {
    response = await fetch(url, fetchOptions);
  } catch (cause) {
    throw createResourceError(`${label}: ошибка сети или CORS`, {
      resourceKind: 'network',
      retryable: true,
      url,
      cause,
    });
  }

  if (!response.ok) {
    const status = Number(response.status) || 0;
    const statusText = asNonEmptyString(response.statusText);
    const suffix = statusText ? ` ${statusText}` : '';
    throw createResourceError(`${label}: HTTP ${status}${suffix}`, {
      resourceKind: 'http',
      retryable: status >= 500 || status === 408 || status === 425 || status === 429,
      status,
      statusText,
      url,
    });
  }

  let rawText = '';
  try {
    rawText = await response.text();
  } catch (cause) {
    throw createResourceError(`${label}: не удалось прочитать ответ`, {
      resourceKind: 'network',
      retryable: true,
      url,
      cause,
    });
  }

  const body = String(rawText || '').trim();
  if (!body) {
    throw createResourceError(`${label}: пустой JSON-ответ`, {
      resourceKind: 'json',
      retryable: true,
      url,
    });
  }

  try {
    return JSON.parse(body);
  } catch (cause) {
    throw createResourceError(`${label}: некорректный JSON`, {
      resourceKind: 'json',
      retryable: true,
      url,
      cause,
    });
  }
}

function sanitizeTileEntry(rawTile, index, warnings) {
  const context = `tiles[${index}]`;
  if (!isPlainObject(rawTile)) {
    warnings.push(`${context}: элемент должен быть объектом; запись отброшена`);
    return null;
  }

  const id = sanitizeId(rawTile.id);
  if (id == null) {
    warnings.push(`${context}: отсутствует обязательное поле id; запись отброшена`);
    return null;
  }

  const maps = sanitizeMaps(rawTile.maps, warnings, context);
  const texture = asNonEmptyPath(rawTile.texture);
  const albedo = maps && typeof maps.albedo === 'string' ? maps.albedo : '';
  const preview = asNonEmptyPath(rawTile.preview, texture || albedo || '');

  if (!texture && !albedo) {
    warnings.push(`${context}: отсутствует texture/maps.albedo; запись отброшена`);
    return null;
  }

  const recommendedLayouts = sanitizeRecommendedLayouts(rawTile.recommendedLayouts, warnings, context);
  const layoutCodes = sanitizeLayoutCodes(rawTile.layoutCodes, warnings, context, recommendedLayouts);

  const safeTile = {
    ...cloneKnownObject(rawTile),
    id,
    canonicalId: canonicalEntityId(rawTile.canonicalId, `tile-${String(id)}`),
    name: asNonEmptyString(rawTile.name, String(id)),
    texture: texture || albedo,
    preview: preview || texture || albedo,
    tileSizeM: sanitizeTileSizeM(rawTile.tileSizeM, warnings, context),
    recommendedLayouts,
    layoutCodes,
  };

  safeTile.maps = maps;
  if ('params' in rawTile || safeTile.params != null) {
    safeTile.params = sanitizeParams(rawTile.params, warnings, context);
  }

  return safeTile;
}

export function sanitizeTilesPayload(rawData) {
  const warnings = [];
  const source = Array.isArray(rawData)
    ? rawData
    : (isPlainObject(rawData) && Array.isArray(rawData.tiles) ? rawData.tiles : []);

  if (!Array.isArray(rawData) && !(isPlainObject(rawData) && Array.isArray(rawData.tiles))) {
    warnings.push('tiles.json: ожидалось поле tiles: []');
  }

  const seenIds = new Set();
  const tiles = [];
  (Array.isArray(source) ? source : []).forEach((rawTile, index) => {
    const tile = sanitizeTileEntry(rawTile, index, warnings);
    if (!tile) return;
    if (seenIds.has(tile.id)) {
      warnings.push(`tiles[${index}]: дублирующийся id "${tile.id}"; запись отброшена`);
      return;
    }
    seenIds.add(tile.id);
    tiles.push(tile);
  });

  const payload = isPlainObject(rawData) ? { ...rawData, version: Number.isFinite(Number(rawData.version)) ? Number(rawData.version) : 1, tiles } : { version: 1, tiles };
  return { payload, warnings };
}

function sanitizeShapeEntry(rawShape, index, warnings, knownTileIds) {
  const context = `shapes[${index}]`;
  if (!isPlainObject(rawShape)) {
    warnings.push(`${context}: элемент должен быть объектом; запись отброшена`);
    return null;
  }

  const id = asNonEmptyString(sanitizeId(rawShape.id));
  if (!id) {
    warnings.push(`${context}: отсутствует обязательное поле id; запись отброшена`);
    return null;
  }

  let tileIds = [];
  if (rawShape.tileIds == null) {
    tileIds = [];
  } else if (!Array.isArray(rawShape.tileIds)) {
    warnings.push(`${context}: tileIds должен быть массивом; значение сброшено`);
    tileIds = [];
  } else {
    tileIds = rawShape.tileIds.filter((tileId) => {
      const ok = sanitizeId(tileId) != null;
      if (!ok) warnings.push(`${context}: пустой tileId отброшен`);
      return ok;
    }).map((tileId) => sanitizeId(tileId));
    if (knownTileIds instanceof Set && knownTileIds.size) {
      const normalizedTileIds = [];
      let droppedRefs = 0;
      tileIds.forEach((tileId) => {
        const resolved = resolveKnownTileId(tileId, knownTileIds);
        if (resolved == null) {
          droppedRefs += 1;
          return;
        }
        normalizedTileIds.push(resolved);
      });
      tileIds = normalizedTileIds;
      if (droppedRefs > 0) {
        warnings.push(`${context}: часть tileIds ссылается на отсутствующие tiles; они отброшены`);
      }
    }
  }

  const gallery = sanitizeGallery(rawShape.gallery, warnings, context);
  const icon = asNonEmptyPath(rawShape.icon, asNonEmptyPath(rawShape.hero));
  const hero = asNonEmptyPath(rawShape.hero, asNonEmptyPath(rawShape.icon));
  const surfacePalette = asNonEmptyPath(rawShape.surfacePalette);

  const safeShape = {
    ...cloneKnownObject(rawShape),
    id,
    canonicalId: canonicalShapeId(rawShape.canonicalId, id),
    name: asNonEmptyString(rawShape.name, id),
    subtitle: asNonEmptyString(rawShape.subtitle, DEFAULT_SHAPE_SUBTITLE),
    description: asNonEmptyString(rawShape.description, ''),
    icon,
    hero,
    surfacePalette,
    paletteRef: asNonEmptyString(rawShape.paletteRef, surfacePalette || id),
    tileIds,
    tech: sanitizeTech(rawShape.tech, warnings, context),
    gallery,
    media: { icon, hero, gallery },
  };

  return safeShape;
}

export function sanitizeShapesPayload(rawData, options = {}) {
  const warnings = [];
  const knownTileIds = new Set(Array.isArray(options.knownTileIds) ? options.knownTileIds : []);
  const source = Array.isArray(rawData)
    ? rawData
    : (isPlainObject(rawData) && Array.isArray(rawData.shapes) ? rawData.shapes : []);

  if (!Array.isArray(rawData) && !(isPlainObject(rawData) && Array.isArray(rawData.shapes))) {
    warnings.push('shapes.json: ожидалось поле shapes: []');
  }

  const seenIds = new Set();
  const shapes = [];
  (Array.isArray(source) ? source : []).forEach((rawShape, index) => {
    const shape = sanitizeShapeEntry(rawShape, index, warnings, knownTileIds);
    if (!shape) return;
    if (seenIds.has(shape.id)) {
      warnings.push(`shapes[${index}]: дублирующийся id "${shape.id}"; запись отброшена`);
      return;
    }
    seenIds.add(shape.id);
    shapes.push(shape);
  });

  const payload = isPlainObject(rawData) ? { ...rawData, version: Number.isFinite(Number(rawData.version)) ? Number(rawData.version) : 1, shapes } : { version: 1, shapes };
  return { payload, warnings };
}

function inferPaletteItemId(rawItem, index) {
  const direct = [rawItem?.id, rawItem?.textureId, rawItem?.canonicalId, rawItem?.name]
    .map((value) => asNonEmptyString(value))
    .find(Boolean);
  if (direct) return direct;

  const maps = isPlainObject(rawItem?.maps) ? rawItem.maps : null;
  const albedo = asNonEmptyPath(maps?.albedo);
  const texture = asNonEmptyPath(rawItem?.texture, albedo);
  const preview = asNonEmptyPath(rawItem?.preview, texture);

  return texture || preview || `palette_item_${index + 1}`;
}

function sanitizePaletteItem(rawItem, index, warnings, shapeId) {
  const context = `items[${index}]`;
  if (!isPlainObject(rawItem)) {
    warnings.push(`${context}: элемент палитры должен быть объектом; запись отброшена`);
    return null;
  }

  const maps = sanitizeMaps(rawItem.maps, warnings, context);
  const texture = asNonEmptyPath(rawItem.texture);
  const albedo = maps && typeof maps.albedo === 'string' ? maps.albedo : '';
  if (!texture && !albedo) {
    warnings.push(`${context}: отсутствует texture/maps.albedo; запись отброшена`);
    return null;
  }

  const id = canonicalEntityId(rawItem.id, inferPaletteItemId(rawItem, index));
  const preview = asNonEmptyPath(rawItem.preview, texture || albedo);
  const material = sanitizeParams(rawItem.params, warnings, context);
  const rawTextureId = canonicalEntityId(rawItem.textureId, id);
  const safeItem = {
    ...cloneKnownObject(rawItem),
    id,
    name: asNonEmptyString(rawItem.name, id),
    textureId: rawTextureId,
    canonicalId: canonicalEntityId(rawItem.canonicalId, canonicalTextureId(shapeId, rawTextureId || rawItem.id || id, id)),
    texture: texture || albedo,
    preview,
    tileSizeM: sanitizeTileSizeM(rawItem.tileSizeM, warnings, context),
    maps,
    params: material,
    material,
    assetUrls: {
      preview,
      texture: texture || albedo,
      maps: maps || null,
    },
  };

  return safeItem;
}

export function sanitizePalettePayload(rawData, options = {}) {
  const warnings = [];
  const contextLabel = asNonEmptyString(options.context, 'palette');

  if (!isPlainObject(rawData)) {
    warnings.push(`${contextLabel}: JSON палитры должен быть объектом`);
    return { payload: { items: [] }, warnings };
  }

  const rawItems = Array.isArray(rawData.items) ? rawData.items : [];
  if (!Array.isArray(rawData.items)) {
    warnings.push(`${contextLabel}: ожидалось поле items: []`);
  }

  const items = rawItems
    .map((rawItem, index) => sanitizePaletteItem(rawItem, index, warnings, asNonEmptyString(rawData.shapeId, asNonEmptyString(options.shapeId))))
    .filter(Boolean);

  const payload = {
    ...rawData,
    schemaVersion: Number.isFinite(Number(rawData.schemaVersion)) ? Number(rawData.schemaVersion) : 1,
    shapeId: asNonEmptyString(rawData.shapeId, asNonEmptyString(options.shapeId)),
    baseUrl: asNonEmptyPath(rawData.baseUrl),
    items,
  };

  return { payload, warnings };
}

export function reportValidationWarnings(context, warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return;
  const prefix = `[data] ${context}`;
  if (warnings.length === 1) {
    console.warn(`${prefix}: ${warnings[0]}`);
    return;
  }

  console.groupCollapsed(`${prefix}: обнаружены предупреждения (${warnings.length})`);
  warnings.forEach((warning) => console.warn(warning));
  console.groupEnd();
}

export async function loadTiles() {
  const data = await fetchJsonResource('tiles.json', { label: 'tiles.json', cache: 'no-store' });
  const { payload, warnings } = sanitizeTilesPayload(data);
  reportValidationWarnings('tiles.json', warnings);
  return payload;
}

export async function loadShapes(options = {}) {
  const data = await fetchJsonResource('shapes.json', { label: 'shapes.json', cache: 'no-store' });
  const { payload, warnings } = sanitizeShapesPayload(data, options);
  reportValidationWarnings('shapes.json', warnings);
  return payload;
}

export function clamp(v, lo, hi) {
  if (!isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function downloadJsonFile(filename, obj) {
  const str = JSON.stringify(obj, null, 2);
  const blob = new Blob([str], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function nowIso() {
  return new Date().toISOString();
}

export function uid() {
  return Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);
}
