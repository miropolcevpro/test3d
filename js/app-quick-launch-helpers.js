const QUICK_LAUNCH_SHAPE_PRIORITY = new Map([
  ['bruschatka', 0],
  ['new_gorod', 1],
  ['old_gorod', 2],
  ['antika', 3],
]);

function getQuickLaunchShapePriority(item) {
  const shapeId = String(item?.shapeId || '').trim().toLowerCase();
  if (QUICK_LAUNCH_SHAPE_PRIORITY.has(shapeId)) return QUICK_LAUNCH_SHAPE_PRIORITY.get(shapeId);
  return Number.POSITIVE_INFINITY;
}

export function sortQuickLaunchItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const priorityCmp = getQuickLaunchShapePriority(a) - getQuickLaunchShapePriority(b);
    if (priorityCmp !== 0) return priorityCmp;
    const shapeCmp = String(a?.shapeName || '').localeCompare(String(b?.shapeName || ''), 'ru', { sensitivity: 'base' });
    if (shapeCmp !== 0) return shapeCmp;
    return String(a?.tileName || '').localeCompare(String(b?.tileName || ''), 'ru', { sensitivity: 'base' });
  });
}

export function isQuickLaunchEligiblePaletteItem(item) {
  if (!item || typeof item !== 'object') return false;
  const flags = [item.placeholder, item.draft, item.hidden, item.demoOnly, item.hiddenFromQuickLaunch];
  if (flags.some(Boolean)) return false;
  const maps = (item.maps && typeof item.maps === 'object') ? item.maps : {};
  const preview = item.preview || maps.albedo || item.texture || '';
  const texture = item.texture || maps.albedo || '';
  if (!preview || !texture) return false;
  const id = String(item.textureId || item.id || item.canonicalId || '').trim();
  return !!id;
}

export async function buildPublishedQuickLaunchItems(shapes = [], opts = {}) {
  const {
    getPaletteCandidateUrlsForShape,
    loadPaletteDefaultsForShape,
    loadSurfacePalette,
    filterPaletteItemsBySurfaces,
    paletteItemsToTiles,
    getTilePreviewUrl,
    apiBaseUrl = '',
    surfacePaletteBaseUrl = '',
    paletteSettingsBaseUrl = '',
    enablePaletteSettings = false,
    paletteCache = null,
    paletteDefaultsCache = null,
    warnOnce = null,
    concurrency = 3,
  } = opts;
  if (typeof getPaletteCandidateUrlsForShape !== 'function' || typeof loadSurfacePalette !== 'function' || typeof paletteItemsToTiles !== 'function') {
    return [];
  }

  const shapeList = Array.isArray(shapes) ? shapes.slice() : [];
  const results = [];
  const seen = new Set();
  let index = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 3, shapeList.length || 1));

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < shapeList.length) {
      const shape = shapeList[index++];
      if (!shape || !shape.id) continue;
      try {
        const paletteCandidates = getPaletteCandidateUrlsForShape(shape, { apiBaseUrl, surfacePaletteBaseUrl });
        if (!Array.isArray(paletteCandidates) || !paletteCandidates.length) continue;

        const paletteDefaults = (typeof loadPaletteDefaultsForShape === 'function')
          ? await loadPaletteDefaultsForShape(shape.id, {
              paletteSettingsBaseUrl,
              enabled: !!enablePaletteSettings,
              cache: paletteDefaultsCache,
              warnOnce,
            })
          : null;

        let items = null;
        for (const candidate of paletteCandidates) {
          if (!candidate || !candidate.url) continue;
          items = await loadSurfacePalette(candidate.url, {
            cache: paletteCache,
            cacheKey: candidate.cacheKey,
            warnOnce,
          });
          if (Array.isArray(items) && items.length) break;
        }

        if (apiBaseUrl && typeof filterPaletteItemsBySurfaces === 'function' && Array.isArray(items) && items.length) {
          items = await filterPaletteItemsBySurfaces(shape.id, items, { apiBaseUrl, warnOnce });
        }
        if (!Array.isArray(items) || !items.length) continue;

        const publishedItems = items.filter(isQuickLaunchEligiblePaletteItem);
        if (!publishedItems.length) continue;

        const tiles = paletteItemsToTiles(publishedItems, paletteDefaults);
        for (const tile of Array.isArray(tiles) ? tiles : []) {
          if (!tile || !tile.id) continue;
          const key = `${shape.id}::${tile.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            shapeId: shape.id,
            shapeName: shape.name || shape.id,
            tileId: tile.id,
            tileName: tile.name || tile.id,
            previewUrl: getTilePreviewUrl(tile) || shape.icon || shape.hero || '',
          });
        }
      } catch (_) {}
    }
  });

  await Promise.all(workers);
  return sortQuickLaunchItems(results);
}

function renderQuickLaunchCards(container, items = [], onLaunch) {
  if (!container) return;
  container.innerHTML = '';
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  for (const item of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quickArCard';
    btn.setAttribute('aria-label', `Быстрый AR: ${item.shapeName} — ${item.tileName}`);

    const preview = document.createElement('div');
    preview.className = 'quickArCardPreview';
    if (item.previewUrl) preview.style.backgroundImage = `url(${item.previewUrl})`;
    btn.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'quickArCardMeta';
    meta.innerHTML = `
      <div class="quickArCardShape">${item.shapeName || 'Форма'}</div>
      <div class="quickArCardTile">${item.tileName || 'Текстура'}</div>
    `;
    btn.appendChild(meta);

    btn.addEventListener('click', async () => {
      if (typeof onLaunch === 'function') await onLaunch(item);
    });

    container.appendChild(btn);
  }
}

export function renderQuickLaunchRail(railEl, items = [], opts = {}) {
  const {
    onLaunch,
    expandedEl = null,
    toggleEl = null,
    expanded = false,
  } = opts;

  if (railEl) railEl.innerHTML = '';
  if (expandedEl) expandedEl.innerHTML = '';

  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    if (toggleEl) toggleEl.hidden = true;
    if (expandedEl) expandedEl.hidden = true;
    return;
  }

  renderQuickLaunchCards(railEl, list, onLaunch);

  if (toggleEl) {
    toggleEl.hidden = false;
    toggleEl.textContent = expanded ? 'Свернуть' : `Показать все (${list.length})`;
    toggleEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  if (expandedEl) {
    expandedEl.hidden = !expanded;
    if (expanded) renderQuickLaunchCards(expandedEl, list, onLaunch);
  }
}
