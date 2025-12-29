import fs from 'node:fs';
import path from 'node:path';

// Optional dependency (installed in CI via npm). If not available, thumbnail generation is skipped.
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  sharp = null;
}

const ROOT = process.cwd();
const SHAPES_PATH = path.join(ROOT, 'shapes.json');
const TILES_PATH = path.join(ROOT, 'tiles.json');
const TILES_META_PATH = path.join(ROOT, 'assets', 'tiles_meta.json');

// Palettes (color tech galleries)
const PALETTES_PATH = path.join(ROOT, 'assets', 'palettes.json');
const PALETTES_META_PATH = path.join(ROOT, 'assets', 'palettes_meta.json');

const exts = ['.webp', '.png', '.jpg', '.jpeg'];

function isFile(abs) {
  try { return fs.statSync(abs).isFile(); } catch { return false; }
}
function isDir(abs) {
  try { return fs.statSync(abs).isDirectory(); } catch { return false; }
}
function relToAbs(rel) {
  return path.join(ROOT, rel);
}
function stripQuery(p) {
  return String(p || '').split('?')[0];
}
function mtimeMs(abs) {
  return fs.statSync(abs).mtimeMs;
}
function withBust(rel) {
  const abs = relToAbs(rel);
  const v = Math.floor(mtimeMs(abs));
  return `${rel}?v=${v}`;
}
function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}
function saveJson(absPath, obj) {
  fs.writeFileSync(absPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function listFilesRel(dirRel) {
  const dirAbs = relToAbs(dirRel);
  if (!isDir(dirAbs)) return [];
  return fs.readdirSync(dirAbs)
    .filter((f) => exts.includes(path.extname(f).toLowerCase()))
    .map((f) => `${dirRel}/${f}`);
}

function pickExistingRel(dirRel, baseName) {
  for (const ext of exts) {
    const rel = `${dirRel}/${baseName}${ext}`;
    if (isFile(relToAbs(rel))) return rel;
  }
  return null;
}

function prettyNameFromKey(key) {
  // simple, predictable; user can override via assets/tiles_meta.json or admin
  return key
    .replace(/[-]+/g, '_')
    .replace(/_+/g, ' ')
    .trim();
}

function loadTilesMeta() {
  if (!isFile(TILES_META_PATH)) return null;
  try {
    const meta = loadJson(TILES_META_PATH);
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

function syncTiles() {
  if (!isFile(TILES_PATH)) {
    console.error('ERROR: tiles.json not found');
    process.exit(1);
  }

  const tilesData = loadJson(TILES_PATH);
  if (!tilesData || !Array.isArray(tilesData.tiles)) {
    console.error('ERROR: tiles.json must be { "tiles": [...] }');
    process.exit(1);
  }
  if (!('version' in tilesData)) tilesData.version = 1;

  const meta = loadTilesMeta();

  // Discover tile keys from assets/textures
  const textures = listFilesRel('assets/textures');
  const keys = textures
    .map((rel) => path.basename(rel, path.extname(rel)))
    .sort((a, b) => a.localeCompare(b));

  // Map existing tiles by key (prefer texture basename)
  const byKey = new Map();
  for (const t of tilesData.tiles) {
    const tex = stripQuery(t?.texture);
    const prev = stripQuery(t?.preview);
    const key = tex ? path.basename(tex, path.extname(tex))
      : (prev ? path.basename(prev, path.extname(prev)) : null);
    if (key) byKey.set(key, t);
  }

  let maxId = tilesData.tiles.reduce((m, t) => Math.max(m, Number(t?.id) || 0), 0);
  const defaultLayouts = ['Прямая', 'Диагональ 45°', 'Вразбежку'];

  // Add or update
  const keep = new Set();
  for (const key of keys) {
    const textureRel = pickExistingRel('assets/textures', key);
    if (!textureRel) continue;
    const previewRel = pickExistingRel('assets/previews', key) || textureRel;

    let tile = byKey.get(key);
    if (!tile) {
      maxId += 1;
      const metaEntry = meta?.[key];
      tile = {
        id: metaEntry?.id ?? maxId,
        name: metaEntry?.name ?? prettyNameFromKey(key),
        texture: textureRel,
        preview: previewRel,
        tileSizeM: metaEntry?.tileSizeM ?? { w: 0.2, h: 0.2 },
        recommendedLayouts: metaEntry?.recommendedLayouts ?? defaultLayouts
      };
      tilesData.tiles.push(tile);
      byKey.set(key, tile);
      console.log(`ADD: new tile created: ${key}`);
    }

    // Update only paths (do not overwrite user fields)
    tile.texture = withBust(textureRel);
    tile.preview = withBust(previewRel);

    // If meta exists, optionally enrich missing fields only
    const metaEntry = meta?.[key];
    if (metaEntry) {
      if (!tile.name && metaEntry.name) tile.name = metaEntry.name;
      if (!tile.tileSizeM && metaEntry.tileSizeM) tile.tileSizeM = metaEntry.tileSizeM;
      if (!Array.isArray(tile.recommendedLayouts) && metaEntry.recommendedLayouts) {
        tile.recommendedLayouts = metaEntry.recommendedLayouts;
      }
    }

    keep.add(tile);
  }

  // Remove tiles that no longer have texture in assets/textures
  tilesData.tiles = tilesData.tiles.filter((t) => {
    const tex = stripQuery(t?.texture);
    if (!tex) return false;
    const abs = relToAbs(tex);
    return isFile(abs);
  });

  saveJson(TILES_PATH, tilesData);
  const tileIds = tilesData.tiles.map((t) => t.id);
  console.log(`OK: tiles.json synced. tiles=${tilesData.tiles.length}`);
  return { tilesData, tileIds };
}

function listGalleryFiles(shapeId) {
  const dirRel = `assets/gallery/${shapeId}`;
  const dirAbs = relToAbs(dirRel);
  if (!isDir(dirAbs)) return [];

  const files = fs.readdirSync(dirAbs)
    .filter((f) => exts.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      const aIsNum = Number.isFinite(na);
      const bIsNum = Number.isFinite(nb);
      if (aIsNum && bIsNum && na !== nb) return na - nb;
      if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
      return a.localeCompare(b, 'ru');
    });

  return files.map((f) => `${dirRel}/${f}`);
}

function discoverShapeIds() {
  const ids = new Set();

  // From gallery folders
  const galRoot = relToAbs('assets/gallery');
  if (isDir(galRoot)) {
    for (const name of fs.readdirSync(galRoot)) {
      const abs = path.join(galRoot, name);
      if (isDir(abs)) ids.add(name);
    }
  }

  // From forms assets filenames
  const formsRoot = relToAbs('assets/forms');
  if (isDir(formsRoot)) {
    for (const f of fs.readdirSync(formsRoot)) {
      const ext = path.extname(f).toLowerCase();
      if (!exts.includes(ext)) continue;
      const base = path.basename(f, ext);
      const m = base.match(/^(.+?)(?:_(?:thumb|icon|hero))?$/);
      if (m && m[1]) ids.add(m[1]);
    }
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}

async function ensureThumbFromHero(shapeId, heroRel) {
  if (!sharp || !heroRel) return null;

  const outRel = `assets/forms/${shapeId}_thumb.webp`;
  const outAbs = relToAbs(outRel);
  const heroAbs = relToAbs(heroRel);

  const need = !isFile(outAbs) || (mtimeMs(heroAbs) > mtimeMs(outAbs));
  if (!need) return outRel;

  try {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    await sharp(heroAbs)
      .rotate()
      .resize(320, 320, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(outAbs);
    return outRel;
  } catch (e) {
    console.warn(`WARN: thumb gen failed for ${shapeId}: ${e?.message || e}`);
    return null;
  }
}

async function syncShapes(allTileIds) {
  if (!isFile(SHAPES_PATH)) {
    console.error('ERROR: shapes.json not found');
    process.exit(1);
  }

  const shapesData = loadJson(SHAPES_PATH);
  if (!shapesData || !Array.isArray(shapesData.shapes)) {
    console.error('ERROR: shapes.json must be { "shapes": [...] }');
    process.exit(1);
  }

  const shapeIds = discoverShapeIds();
  const byId = new Map(shapesData.shapes.map((s) => [s.id, s]));

  for (const id of shapeIds) {
    if (byId.has(id)) continue;
    const newShape = {
      id,
      name: id,
      icon: '',
      hero: '',
      description: `Форма «${id}». Выберите цвет/поверхность и перейдите в AR-визуализацию.`,
      tileIds: allTileIds,
      tech: { 'Толщина': '60мм' }
    };
    shapesData.shapes.push(newShape);
    byId.set(id, newShape);
    console.log(`ADD: new shape created: ${id}`);
  }

  for (const s of shapesData.shapes) {
    if (!s?.id) continue;
    const id = s.id;

    // HERO
    const heroCandidates = [];
    for (const ext of exts) heroCandidates.push(`assets/forms/${id}${ext}`);
    for (const ext of exts) heroCandidates.push(`assets/forms/${id}_hero${ext}`);

    let heroRel = null;
    for (const rel of heroCandidates) {
      if (isFile(relToAbs(rel))) { heroRel = rel; break; }
    }

    const galleryRel = listGalleryFiles(id);
    if (!heroRel && galleryRel.length) heroRel = galleryRel[0];
    if (heroRel) s.hero = withBust(heroRel);

    if (galleryRel.length) {
      s.gallery = galleryRel.map(withBust);
    } else {
      delete s.gallery;
    }

    // ICON
    const iconCandidates = [];
    for (const ext of exts) iconCandidates.push(`assets/forms/${id}_thumb${ext}`);
    for (const ext of exts) iconCandidates.push(`assets/forms/${id}_icon${ext}`);

    let iconRel = null;
    for (const rel of iconCandidates) {
      if (isFile(relToAbs(rel))) { iconRel = rel; break; }
    }
    if (!iconRel && heroRel) {
      const genRel = await ensureThumbFromHero(id, heroRel);
      if (genRel) iconRel = genRel;
    }
    if (iconRel) s.icon = withBust(iconRel);

    if (!s.description) {
      s.description = `Форма «${s.name || id}». Выберите цвет/поверхность и перейдите в AR-визуализацию.`;
    }

    // If tileIds missing/empty -> make it all tiles (do not override existing)
    if (!Array.isArray(s.tileIds) || s.tileIds.length === 0) {
      s.tileIds = allTileIds;
    }

    if (!s.tech || typeof s.tech !== 'object') {
      s.tech = { 'Толщина': '60мм' };
    } else if (!('Толщина' in s.tech)) {
      s.tech['Толщина'] = '60мм';
    }
  }

  saveJson(SHAPES_PATH, shapesData);
  console.log(`OK: shapes.json synced. sharp=${sharp ? 'yes' : 'no (thumb gen skipped)'}`);
}

function loadPalettesMeta() {
  if (!isFile(PALETTES_META_PATH)) return null;
  try {
    const meta = loadJson(PALETTES_META_PATH);
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

function sortPaletteFiles(files) {
  return files.sort((a, b) => {
    const an = path.basename(a).match(/(\d+)/)?.[1];
    const bn = path.basename(b).match(/(\d+)/)?.[1];
    const ai = an ? parseInt(an, 10) : NaN;
    const bi = bn ? parseInt(bn, 10) : NaN;
    const aIs = Number.isFinite(ai);
    const bIs = Number.isFinite(bi);
    if (aIs && bIs && ai !== bi) return ai - bi;
    if (aIs !== bIs) return aIs ? -1 : 1;
    return a.localeCompare(b, 'ru');
  });
}

function niceLabelFromBase(base) {
  return base
    .replace(/_+/g, ' ')
    .replace(/-+/g, ' ')
    .trim();
}

async function ensurePaletteCard(srcRel, outRel) {
  if (!sharp) return null;
  const srcAbs = relToAbs(srcRel);
  const outAbs = relToAbs(outRel);
  const need = !isFile(outAbs) || (mtimeMs(srcAbs) > mtimeMs(outAbs));
  if (!need) return outRel;
  try {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    // Cards are displayed with aspect-ratio: 3/4 in CSS
    await sharp(srcAbs)
      .rotate()
      .resize(600, 800, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(outAbs);
    return outRel;
  } catch (e) {
    console.warn(`WARN: palette card gen failed for ${srcRel}: ${e?.message || e}`);
    return null;
  }
}

async function syncPalettes() {
  const meta = loadPalettesMeta();

  const configs = [
    { key: 'stonemix', title: 'Цветовая гамма Стоунмикс', dirRel: 'assets/stonemix_palette' },
    { key: 'colormix', title: 'Цветовая гамма Колормикс', dirRel: 'assets/colormix_palette' },
    { key: 'monotone', title: 'Цветовая гамма Однотонная', dirRel: 'assets/monotone_palette' },
  ];

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
  };

  for (const cfg of configs) {
    const all = listFilesRel(cfg.dirRel);
    // ignore already generated cards to avoid duplicates
    const sources = sortPaletteFiles(all.filter((rel) => !path.basename(rel, path.extname(rel)).endsWith('_card')));

    const items = [];
    for (const srcRel of sources) {
      const base = path.basename(srcRel, path.extname(srcRel));
      const baseNoCard = base.replace(/_card$/, '');
      const outRel = `${cfg.dirRel}/${baseNoCard}_card.webp`;
      const cardRel = await ensurePaletteCard(srcRel, outRel);
      const useRel = (cardRel && isFile(relToAbs(cardRel))) ? cardRel : srcRel;

      const labels = meta?.[cfg.key]?.labels || meta?.[cfg.key]?.items || null;
      const label = labels?.[baseNoCard] || labels?.[path.basename(srcRel)] || niceLabelFromBase(baseNoCard);

      items.push({
        src: withBust(useRel),
        label,
      });
    }

    out[cfg.key] = { title: meta?.[cfg.key]?.title || cfg.title, items };
  }

  saveJson(PALETTES_PATH, out);
  console.log(`OK: palettes synced -> assets/palettes.json`);
}

async function main() {
  const { tileIds } = syncTiles();
  await syncShapes(tileIds);
  await syncPalettes();
}

await main();
