export async function loadTiles() {
  const res = await fetch('tiles.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось загрузить tiles.json');
  return await res.json();
}

export async function loadShapes() {
  const res = await fetch('shapes.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось загрузить shapes.json');
  return await res.json();
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

// ------------------------
// Auto-content helpers (palettes + detail hero galleries)
//
// GitHub Pages / static hosting cannot list folders, so we discover assets by
// probing predictable filenames (01..999) and stop after a run of misses.
// ------------------------

function getAssetVersion() {
  // One version per page load to bust cache on replaced files.
  if (typeof window === 'undefined') return '';
  if (!window.__asset_v) window.__asset_v = Date.now().toString(36);
  return window.__asset_v;
}

export function withBust(url) {
  const v = getAssetVersion();
  if (!v) return url;
  return url.includes('?') ? `${url}&v=${v}` : `${url}?v=${v}`;
}

export async function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = withBust(url);
  });
}

export function padNum(n, pad = 2) {
  const s = String(n);
  return pad > 0 ? s.padStart(pad, '0') : s;
}

/**
 * Discover images by probing predictable filenames.
 *
 * @param {Object} opts
 * @param {function(number): string[]} opts.baseNamesFn - returns base names (without extension)
 * @param {string[]} [opts.exts] - allowed extensions
 * @param {number} [opts.start]
 * @param {number} [opts.max]
 * @param {number} [opts.maxMiss]
 * @returns {Promise<string[]>} list of found urls (with extension)
 */
export async function discoverImagesByProbe(opts) {
  const {
    baseNamesFn,
    exts = ['webp', 'png', 'jpg', 'jpeg'],
    start = 1,
    max = 999,
    maxMiss = 20,
  } = opts || {};

  const found = [];
  let miss = 0;

  for (let i = start; i <= max; i++) {
    let hit = false;
    const baseNames = baseNamesFn(i) || [];
    for (const base of baseNames) {
      for (const ext of exts) {
        const url = `${base}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        if (await probeImage(url)) {
          found.push(url);
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      miss = 0;
    } else {
      miss++;
      if (miss >= maxMiss) break;
    }
  }
  return found;
}

export async function fillPaletteScroll({
  scrollEl,
  itemClass,
  basePath,
  filePrefix,
  pad = 2,
}) {
  if (!scrollEl) return;
  const urls = await discoverImagesByProbe({
    baseNamesFn: (i) => [
      `${basePath}/${filePrefix}${padNum(i, pad)}`,
    ],
  });
  if (!urls.length) return;
  scrollEl.innerHTML = '';
  for (const u of urls) {
    const div = document.createElement('div');
    div.className = itemClass;
    div.setAttribute('role', 'img');
    div.style.backgroundImage = `url('${withBust(u)}')`;
    scrollEl.appendChild(div);
  }
}

export async function initAutoTechPalettes() {
  await fillPaletteScroll({
    scrollEl: document.querySelector('.stonemixPaletteScroll'),
    itemClass: 'stonemixPaletteItem',
    basePath: 'assets/stonemix_palette',
    filePrefix: 'stonemix_palette_',
    pad: 2,
  });
  await fillPaletteScroll({
    scrollEl: document.querySelector('.colormixPaletteScroll'),
    itemClass: 'colormixPaletteItem',
    basePath: 'assets/colormix_palette',
    filePrefix: 'colormix_palette_',
    pad: 2,
  });
  await fillPaletteScroll({
    scrollEl: document.querySelector('.monotonePaletteScroll'),
    itemClass: 'monotonePaletteItem',
    basePath: 'assets/monotone_palette',
    filePrefix: 'monotone_palette_',
    pad: 2,
  });
}

export async function discoverShapeHeroGallery(shapeId) {
  if (!shapeId) return [];
  const dir = `assets/gallery/${shapeId}`;
  // Support both 1.webp and 01.webp naming.
  return await discoverImagesByProbe({
    baseNamesFn: (i) => [
      `${dir}/${i}`,
      `${dir}/${padNum(i, 2)}`,
    ],
    start: 1,
    max: 999,
    maxMiss: 20,
  });
}
