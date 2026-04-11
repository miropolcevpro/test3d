export function getDirectPaletteUrlForShape(shape, surfacePaletteBaseUrl = '') {
  if (!shape || !shape.id) return '';
  if (shape.surfacePalette) return shape.surfacePalette;
  if (!surfacePaletteBaseUrl) return '';
  return `${surfacePaletteBaseUrl}${encodeURIComponent(shape.id)}.json`;
}

export function getPaletteCandidateUrlsForShape(shape, opts = {}) {
  const candidates = [];
  const apiBaseUrl = String(opts.apiBaseUrl || '').trim();
  const surfacePaletteBaseUrl = String(opts.surfacePaletteBaseUrl || '').trim();
  const shapeId = String(shape && shape.id ? shape.id : '').trim();
  const pushUnique = (url, cacheKey = '') => {
    const value = String(url || '').trim();
    if (!value) return;
    if (candidates.some((it) => it && it.url === value)) return;
    candidates.push({ url: value, cacheKey: String(cacheKey || value).trim() || value });
  };

  if (shapeId && apiBaseUrl) {
    pushUnique(
      `${apiBaseUrl}api/palettes/${encodeURIComponent(shapeId)}?reconcile=1`,
      `palette:reconcile:${shapeId}`,
    );
  }

  const directUrl = getDirectPaletteUrlForShape(shape, surfacePaletteBaseUrl);
  if (directUrl) {
    const directKey = shapeId ? `palette:direct:${shapeId}` : `palette:direct:${directUrl}`;
    pushUnique(directUrl, directKey);
  }
  return candidates;
}

export function paletteItemsToTiles(items, defaults = null) {
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
      texture: (it.maps && it.maps.albedo) ? it.maps.albedo : it.texture,
    };
  });
}

export function getTilePreviewUrl(tile) {
  return (tile && (tile.preview || (tile.maps && tile.maps.albedo) || tile.texture)) ? (tile.preview || (tile.maps && tile.maps.albedo) || tile.texture) : '';
}

export function getTileMapUrls(tile) {
  if (!tile) return [];
  const maps = (tile.maps && typeof tile.maps === 'object') ? tile.maps : {};
  const albedo = maps.albedo || tile.texture || '';
  const normal = maps.normal || '';
  const rough = maps.roughness || '';
  const ao = maps.ao || '';
  const height = maps.height || '';
  return [albedo, normal, rough, ao, height].filter(Boolean);
}

export function getTileAlbedoCandidates(tile) {
  if (!tile) return [];
  const maps = (tile.maps && typeof tile.maps === 'object') ? tile.maps : {};
  return Array.from(new Set([maps.albedo, tile.texture, tile.preview].filter(Boolean)));
}

export function prefetchImageUrls(urls, concurrency = 3) {
  try {
    const unique = Array.from(new Set((urls || []).filter(Boolean)));
    if (!unique.length) return Promise.resolve([]);
    let i = 0;

    const loadOne = (url) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve({ url, ok: true });
      img.onerror = () => resolve({ url, ok: false });
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

let lazySwatchObserver = null;

export function ensureLazySwatchObserver() {
  if (lazySwatchObserver) return lazySwatchObserver;

  lazySwatchObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const bg = el?.dataset?.bg;
      if (bg && !el.dataset.bgLoaded) {
        el.style.backgroundImage = `url(${bg})`;
        el.dataset.bgLoaded = '1';
      }
      lazySwatchObserver.unobserve(el);
    });
  }, {
    root: null,
    rootMargin: '250px',
    threshold: 0.01,
  });

  return lazySwatchObserver;
}

export function setupLazySwatches(container) {
  if (!container) return;
  const io = ensureLazySwatchObserver();
  container.querySelectorAll('.swatch[data-bg]').forEach((el) => {
    if (el.dataset.bgLoaded) return;
    io.observe(el);
  });
}

export function renderColorRow(container, tiles, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const eagerCount = (typeof opts.eagerCount === 'number') ? opts.eagerCount : 10;
  const onTileClick = (typeof opts.onTileClick === 'function') ? opts.onTileClick : null;

  (tiles || []).forEach((tile, idx) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.dataset.tileId = String(tile.id);
    const bgUrl = getTilePreviewUrl(tile);
    sw.dataset.bg = bgUrl;
    if (idx < eagerCount && bgUrl) {
      sw.style.backgroundImage = `url(${bgUrl})`;
      sw.dataset.bgLoaded = '1';
    }
    sw.title = tile.name || 'Текстура';
    sw.addEventListener('click', async () => {
      if (onTileClick) await onTileClick(tile);
    });
    container.appendChild(sw);
  });

  setupLazySwatches(container);
}
