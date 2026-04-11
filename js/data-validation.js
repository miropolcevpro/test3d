const DEFAULT_TILE_SIZE = Object.freeze({ w: 0.2, h: 0.2 });
const PALETTE_DEFAULT_NUMERIC_KEYS = Object.freeze([
  'uvScale',
  'exposureMult',
  'contrast',
  'saturation',
  'roughnessMult',
  'specStrength',
  'normalScale',
  'bumpScale',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  return s || '';
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sanitizePrimitiveId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    return s ? s : null;
  }
  return null;
}

function sanitizeTileSize(value) {
  if (!isPlainObject(value)) return null;
  const w = toFiniteNumber(value.w);
  const h = toFiniteNumber(value.h);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

function sanitizeTextureMaps(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const key of Object.keys(value)) {
    const next = toNonEmptyString(value[key]);
    if (next) out[key] = next;
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toNonEmptyString(item))
    .filter(Boolean);
}

function sanitizePrimitiveIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizePrimitiveId(item))
    .filter((item) => item !== null);
}

function sanitizeTechObject(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = toNonEmptyString(rawKey);
    if (!key) continue;
    if (rawVal == null) continue;
    if (typeof rawVal === 'string') {
      out[key] = rawVal;
      continue;
    }
    if (typeof rawVal === 'number' || typeof rawVal === 'boolean') {
      out[key] = String(rawVal);
    }
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeParams(value) {
  if (!isPlainObject(value)) return null;
  return { ...value };
}

function createWarnLogger(scope, customLogger = null) {
  const log = typeof customLogger === 'function' ? customLogger : console.warn.bind(console);
  return (message, extra = undefined) => {
    try {
      if (extra === undefined) log(`[data] ${scope}: ${message}`);
      else log(`[data] ${scope}: ${message}`, extra);
    } catch (_) {
      // ignore logging failures
    }
  };
}

function sanitizeTile(input, index, warn) {
  if (!isPlainObject(input)) {
    warn(`tiles[${index}] пропущен: запись должна быть объектом.`);
    return null;
  }

  const id = sanitizePrimitiveId(input.id);
  if (id === null) {
    warn(`tiles[${index}] пропущен: отсутствует корректный id.`, input);
    return null;
  }

  const maps = sanitizeTextureMaps(input.maps);
  const texture = toNonEmptyString(input.texture) || (maps && maps.albedo) || '';
  if (!texture) {
    warn(`tiles[${index}] (id=${String(id)}) пропущен: отсутствует albedo/texture.`);
    return null;
  }

  const tileSizeM = sanitizeTileSize(input.tileSizeM) || { ...DEFAULT_TILE_SIZE };
  if (!sanitizeTileSize(input.tileSizeM)) {
    warn(`tiles[${index}] (id=${String(id)}): tileSizeM повреждён, применён safe fallback ${DEFAULT_TILE_SIZE.w}x${DEFAULT_TILE_SIZE.h} м.`);
  }

  const out = { ...input };
  out.id = id;
  out.name = toNonEmptyString(input.name) || `Текстура ${String(id)}`;
  out.texture = texture;
  out.preview = toNonEmptyString(input.preview) || (maps && maps.albedo) || texture;
  out.tileSizeM = tileSizeM;
  out.recommendedLayouts = sanitizeStringArray(input.recommendedLayouts);

  const params = sanitizeParams(input.params);
  if (params) out.params = params;
  else delete out.params;

  if (maps) out.maps = maps;
  else delete out.maps;

  return out;
}

function sanitizeShape(input, index, warn) {
  if (!isPlainObject(input)) {
    warn(`shapes[${index}] пропущен: запись должна быть объектом.`);
    return null;
  }

  const id = toNonEmptyString(input.id);
  if (!id) {
    warn(`shapes[${index}] пропущен: отсутствует корректный string id.`, input);
    return null;
  }

  const out = { ...input };
  out.id = id;
  out.name = toNonEmptyString(input.name) || id;
  out.icon = toNonEmptyString(input.icon);
  out.hero = toNonEmptyString(input.hero) || out.icon;
  out.description = toNonEmptyString(input.description);
  out.subtitle = toNonEmptyString(input.subtitle);
  out.surfacePalette = toNonEmptyString(input.surfacePalette);
  out.tileIds = sanitizePrimitiveIdArray(input.tileIds);
  out.gallery = sanitizeStringArray(input.gallery);

  const tech = sanitizeTechObject(input.tech);
  if (tech) out.tech = tech;
  else delete out.tech;

  return out;
}

function makePaletteFallbackId(input, index) {
  const candidates = [
    sanitizePrimitiveId(input.id),
    toNonEmptyString(input.textureId),
    toNonEmptyString(input.canonicalId),
    toNonEmptyString(input.name),
    toNonEmptyString(input.folder),
    toNonEmptyString(input.texture).split('/').pop() || '',
    toNonEmptyString(input.preview).split('/').pop() || '',
  ].filter(Boolean);
  return candidates[0] || `palette-item-${index + 1}`;
}

function sanitizePaletteItem(input, index, warn) {
  if (!isPlainObject(input)) {
    warn(`palette.items[${index}] пропущен: запись должна быть объектом.`);
    return null;
  }

  const maps = sanitizeTextureMaps(input.maps);
  const texture = toNonEmptyString(input.texture) || (maps && maps.albedo) || '';
  if (!texture) {
    warn(`palette.items[${index}] пропущен: отсутствует albedo/texture.`);
    return null;
  }

  const out = { ...input };
  out.id = makePaletteFallbackId(input, index);
  out.name = toNonEmptyString(input.name) || String(out.id);
  out.texture = texture;
  out.preview = toNonEmptyString(input.preview) || (maps && maps.albedo) || texture;

  const tileSizeM = sanitizeTileSize(input.tileSizeM);
  if (tileSizeM) out.tileSizeM = tileSizeM;
  else delete out.tileSizeM;

  const params = sanitizeParams(input.params);
  if (params) out.params = params;
  else delete out.params;

  if (maps) out.maps = maps;
  else delete out.maps;

  const textureId = toNonEmptyString(input.textureId);
  if (textureId) out.textureId = textureId;
  else delete out.textureId;

  const canonicalId = toNonEmptyString(input.canonicalId);
  if (canonicalId) out.canonicalId = canonicalId;
  else delete out.canonicalId;

  const folder = toNonEmptyString(input.folder);
  if (folder) out.folder = folder;
  else delete out.folder;

  return out;
}

export function sanitizeTilesPayload(data, options = {}) {
  const warn = createWarnLogger(options.scope || 'tiles.json', options.logger);
  const list = Array.isArray(data) ? data : (Array.isArray(data && data.tiles) ? data.tiles : null);
  if (!Array.isArray(list)) {
    throw new Error('tiles.json: ожидается массив tiles.');
  }

  const tiles = list
    .map((item, index) => sanitizeTile(item, index, warn))
    .filter(Boolean);

  if (!tiles.length) {
    throw new Error('tiles.json: не найдено ни одной пригодной плитки.');
  }

  const out = isPlainObject(data) ? { ...data } : {};
  out.tiles = tiles;
  return out;
}

export function sanitizeShapesPayload(data, options = {}) {
  const warn = createWarnLogger(options.scope || 'shapes.json', options.logger);
  const list = Array.isArray(data) ? data : (Array.isArray(data && data.shapes) ? data.shapes : null);
  if (!Array.isArray(list)) {
    throw new Error('shapes.json: ожидается массив shapes.');
  }

  const shapes = list
    .map((item, index) => sanitizeShape(item, index, warn))
    .filter(Boolean);

  if (!shapes.length) {
    throw new Error('shapes.json: не найдено ни одной пригодной формы.');
  }

  const out = isPlainObject(data) ? { ...data } : {};
  out.shapes = shapes;
  return out;
}

export function sanitizePalettePayload(data, options = {}) {
  const warn = createWarnLogger(options.scope || 'palette', options.logger);
  const list = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
  if (!Array.isArray(list)) {
    warn('палитра не содержит массива items — используем safe fallback.');
    return { items: [], baseUrl: '' };
  }

  const items = list
    .map((item, index) => sanitizePaletteItem(item, index, warn))
    .filter(Boolean);

  const out = isPlainObject(data) ? { ...data } : {};
  out.items = items;
  out.baseUrl = toNonEmptyString(out.baseUrl);
  return out;
}

export function sanitizePaletteDefaults(value, options = {}) {
  const warn = createWarnLogger(options.scope || 'palette.defaults', options.logger);
  if (!isPlainObject(value)) return null;

  const out = {};
  const tileSizeM = sanitizeTileSize(value.tileSizeM);
  if (tileSizeM) out.tileSizeM = tileSizeM;
  else if (value.tileSizeM != null) warn('tileSizeM повреждён и был отброшен.', value.tileSizeM);

  for (const key of PALETTE_DEFAULT_NUMERIC_KEYS) {
    if (value[key] == null) continue;
    const n = toFiniteNumber(value[key]);
    if (n === null) {
      warn(`defaults.${key} имеет некорректное значение и был отброшен.`, value[key]);
      continue;
    }
    out[key] = n;
  }

  if (value.forceQuality != null) {
    const fq = toNonEmptyString(value.forceQuality).toLowerCase();
    if (fq === '1k' || fq === '2k') out.forceQuality = fq;
    else warn('defaults.forceQuality имеет некорректное значение и был отброшен.', value.forceQuality);
  }

  return Object.keys(out).length ? out : null;
}
