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

function pickFirstExisting(candidatesRel) {
  for (const rel of candidatesRel) {
    const abs = relToAbs(rel);
    if (isFile(abs)) return rel;
  }
  return null;
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

  // Regenerate if missing OR hero is newer.
  const need = !isFile(outAbs) || (mtimeMs(heroAbs) > mtimeMs(outAbs));
  if (!need) return outRel;

  try {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    await sharp(heroAbs)
      .rotate() // respect EXIF orientation if any
      .resize(320, 320, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(outAbs);
    return outRel;
  } catch (e) {
    console.warn(`WARN: thumb gen failed for ${shapeId}: ${e?.message || e}`);
    return null;
  }
}

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

async function main() {
  if (!isFile(SHAPES_PATH)) {
    console.error('ERROR: shapes.json not found');
    process.exit(1);
  }
  if (!isFile(TILES_PATH)) {
    console.error('ERROR: tiles.json not found');
    process.exit(1);
  }

  const shapesData = loadJson(SHAPES_PATH);
  if (!shapesData || !Array.isArray(shapesData.shapes)) {
    console.error('ERROR: shapes.json must be { "shapes": [...] }');
    process.exit(1);
  }

  const tilesData = loadJson(TILES_PATH);
  const allTileIds = Array.isArray(tilesData.tiles) ? tilesData.tiles.map((t) => t.id) : [];

  const shapeIds = discoverShapeIds();

  // Map by id for quick access
  const byId = new Map(shapesData.shapes.map((s) => [s.id, s]));

  // Create missing shapes based on discovered folders/files
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

  // Update each shape media fields (preserve all other data)
  for (const s of shapesData.shapes) {
    if (!s?.id) continue;
    const id = s.id;

    // HERO: prefer assets/forms/<id>.webp/png/jpg, then <id>_hero.*
    const heroCandidates = [];
    for (const ext of exts) heroCandidates.push(`assets/forms/${id}${ext}`);
    for (const ext of exts) heroCandidates.push(`assets/forms/${id}_hero${ext}`);

    let heroRel = pickFirstExisting(heroCandidates);

    // If no hero file, fall back to first gallery image
    const galleryRel = listGalleryFiles(id);
    if (!heroRel && galleryRel.length) heroRel = galleryRel[0];

    if (heroRel) s.hero = withBust(heroRel);

    // GALLERY: read folder; if empty -> remove gallery
    if (galleryRel.length) {
      s.gallery = galleryRel.map(withBust);
    } else {
      delete s.gallery;
    }

    // ICON: prefer existing thumb/icon files, otherwise generate thumb from hero
    const iconCandidates = [];
    for (const ext of exts) iconCandidates.push(`assets/forms/${id}_thumb${ext}`);
    for (const ext of exts) iconCandidates.push(`assets/forms/${id}_icon${ext}`);

    let iconRel = pickFirstExisting(iconCandidates);

    if (!iconRel && heroRel) {
      const genRel = await ensureThumbFromHero(id, heroRel);
      if (genRel) iconRel = genRel;
    }

    if (iconRel) s.icon = withBust(iconRel);

    // Normalize description if missing
    if (!s.description) {
      s.description = `Форма «${s.name || id}». Выберите цвет/поверхность и перейдите в AR-визуализацию.`;
    }

    // Ensure tileIds exists for new shapes (do not override existing non-empty)
    if (!Array.isArray(s.tileIds) || s.tileIds.length === 0) {
      s.tileIds = allTileIds;
    }

    // Ensure tech exists
    if (!s.tech || typeof s.tech !== 'object') {
      s.tech = { 'Толщина': '60мм' };
    } else if (!('Толщина' in s.tech)) {
      // Do not overwrite if user has it differently; just add if absent
      s.tech['Толщина'] = '60мм';
    }
  }

  fs.writeFileSync(SHAPES_PATH, JSON.stringify(shapesData, null, 2) + '\n', 'utf8');

  console.log(`OK: shapes.json synced. sharp=${sharp ? 'yes' : 'no (thumb gen skipped)'}`);
}

await main();
