function clonePointArray(points = []) {
  return Array.isArray(points) ? points.slice() : [];
}

function normalizeDeg(value) {
  let deg = Number(value);
  if (!Number.isFinite(deg)) deg = 0;
  deg = deg % 360;
  if (deg < 0) deg += 360;
  if (Math.abs(deg) < 0.0001) deg = 0;
  return deg;
}

export function createArZoneHelpers(ctx = {}) {
  const state = ctx.state;
  if (!state || typeof state !== 'object') throw new Error('state is required');

  function ensureStorage() {
    if (!Array.isArray(state.arZones)) state.arZones = [];
    if (!Number.isFinite(state._arZoneSeq)) state._arZoneSeq = 0;
    if (!state._arZoneCompat || typeof state._arZoneCompat !== 'object') {
      state._arZoneCompat = {
        points: [],
        holes: [],
        holePoints: [],
        closed: false,
        textureRotationDeg: 0,
      };
    }
  }

  function nextZoneId() {
    ensureStorage();
    state._arZoneSeq += 1;
    return `zone_${state._arZoneSeq}`;
  }

  function buildZone(seed = {}) {
    ensureStorage();
    const id = seed.id ? String(seed.id) : nextZoneId();
    const title = seed.title ? String(seed.title) : `Зона ${state._arZoneSeq}`;
    return {
      id,
      title,
      points: clonePointArray(seed.points),
      holes: Array.isArray(seed.holes) ? seed.holes.map(clonePointArray) : [],
      holePoints: clonePointArray(seed.holePoints),
      closed: !!seed.closed,
      tileId: seed.tileId ? String(seed.tileId) : '',
      textureRotationDeg: normalizeDeg(seed.textureRotationDeg),
      fillMesh: seed.fillMesh || null,
      tileMaterial: seed.tileMaterial || null,
      status: seed.status ? String(seed.status) : 'active',
      createdAt: Number(seed.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
  }

  function getZoneById(zoneId) {
    ensureStorage();
    const safeId = zoneId ? String(zoneId) : '';
    if (!safeId) return null;
    return state.arZones.find((zone) => zone && String(zone.id) === safeId) || null;
  }

  function createAndActivateZone(seed = {}) {
    ensureStorage();
    const zone = buildZone(seed);
    state.arZones.push(zone);
    state.activeZoneId = zone.id;
    return zone;
  }

  function getZones() {
    ensureStorage();
    return state.arZones.slice();
  }

  function activateZone(zoneId, opts = {}) {
    ensureStorage();
    const zone = getZoneById(zoneId);
    if (!zone) return null;
    state.activeZoneId = zone.id;
    if (opts.touch !== false) zone.updatedAt = Date.now();
    return zone;
  }

  function createDraftZone(seed = {}) {
    ensureStorage();
    return createAndActivateZone({
      tileId: seed.tileId ?? (state.selectedTile && state.selectedTile.id ? String(state.selectedTile.id) : ''),
      textureRotationDeg: seed.textureRotationDeg ?? state._arZoneCompat.textureRotationDeg ?? 0,
      points: seed.points ?? [],
      holes: seed.holes ?? [],
      holePoints: seed.holePoints ?? [],
      closed: seed.closed ?? false,
      status: seed.status || 'draft',
      title: seed.title,
    });
  }

  function getActiveZone(opts = {}) {
    ensureStorage();
    let zone = getZoneById(state.activeZoneId);
    if (!zone && opts.createIfMissing !== false) {
      zone = createAndActivateZone({
        tileId: state.selectedTile && state.selectedTile.id ? String(state.selectedTile.id) : '',
        textureRotationDeg: state._arZoneCompat.textureRotationDeg || 0,
      });
    }
    return zone || null;
  }

  function withActiveZoneFallback(key, nextValue) {
    const zone = getActiveZone({ createIfMissing: false });
    if (!zone) {
      state._arZoneCompat[key] = nextValue;
      return nextValue;
    }
    zone[key] = nextValue;
    zone.updatedAt = Date.now();
    return zone[key];
  }

  function defineCompatAlias(key) {
    Object.defineProperty(state, key, {
      configurable: true,
      enumerable: true,
      get() {
        const zone = getActiveZone({ createIfMissing: false });
        if (!zone) return state._arZoneCompat[key];
        return zone[key];
      },
      set(value) {
        withActiveZoneFallback(key, value);
      },
    });
  }

  function initCompatAliases() {
    ensureStorage();
    defineCompatAlias('points');
    defineCompatAlias('holes');
    defineCompatAlias('holePoints');
    defineCompatAlias('closed');
    defineCompatAlias('textureRotationDeg');
  }

  function ensureSingleActiveZone(seed = {}) {
    ensureStorage();
    if (!state.arZones.length) {
      return createAndActivateZone({
        tileId: seed.tileId ?? (state.selectedTile && state.selectedTile.id ? String(state.selectedTile.id) : ''),
        textureRotationDeg: seed.textureRotationDeg ?? state._arZoneCompat.textureRotationDeg ?? 0,
        points: seed.points ?? state._arZoneCompat.points,
        holes: seed.holes ?? state._arZoneCompat.holes,
        holePoints: seed.holePoints ?? state._arZoneCompat.holePoints,
        closed: seed.closed ?? state._arZoneCompat.closed,
      });
    }
    const zone = getActiveZone({ createIfMissing: true });
    if (seed && typeof seed === 'object') {
      if (Object.prototype.hasOwnProperty.call(seed, 'tileId')) zone.tileId = seed.tileId ? String(seed.tileId) : '';
      if (Object.prototype.hasOwnProperty.call(seed, 'textureRotationDeg')) zone.textureRotationDeg = normalizeDeg(seed.textureRotationDeg);
    }
    return zone;
  }

  function updateZone(zoneId, patch = {}) {
    const zone = getZoneById(zoneId);
    if (!zone || !patch || typeof patch !== 'object') return zone || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) zone.title = patch.title ? String(patch.title) : zone.title;
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) zone.status = patch.status ? String(patch.status) : zone.status;
    if (Object.prototype.hasOwnProperty.call(patch, 'tileId')) zone.tileId = patch.tileId ? String(patch.tileId) : '';
    if (Object.prototype.hasOwnProperty.call(patch, 'textureRotationDeg')) zone.textureRotationDeg = normalizeDeg(patch.textureRotationDeg);
    if (Object.prototype.hasOwnProperty.call(patch, 'fillMesh')) zone.fillMesh = patch.fillMesh || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'tileMaterial')) zone.tileMaterial = patch.tileMaterial || null;
    zone.updatedAt = Date.now();
    return zone;
  }

  function setActiveZoneStatus(status) {
    const zone = getActiveZone({ createIfMissing: true });
    zone.status = status ? String(status) : zone.status;
    zone.updatedAt = Date.now();
    return zone;
  }

  function resetToSingleZone(opts = {}) {
    ensureStorage();
    const preserveSelection = opts.preserveSelection !== false;
    const preserveRotation = opts.preserveRotation !== false;
    const current = getActiveZone({ createIfMissing: false });
    const tileId = preserveSelection
      ? (current && current.tileId ? String(current.tileId) : (state.selectedTile && state.selectedTile.id ? String(state.selectedTile.id) : ''))
      : '';
    const textureRotationDeg = preserveRotation
      ? (current ? normalizeDeg(current.textureRotationDeg) : normalizeDeg(state._arZoneCompat.textureRotationDeg || 0))
      : 0;
    state.arZones = [];
    state.activeZoneId = '';
    state._arZoneCompat.points = [];
    state._arZoneCompat.holes = [];
    state._arZoneCompat.holePoints = [];
    state._arZoneCompat.closed = false;
    state._arZoneCompat.textureRotationDeg = textureRotationDeg;
    return createAndActivateZone({ tileId, textureRotationDeg });
  }

  function syncSelectedTileToActiveZone(tile) {
    const zone = getActiveZone({ createIfMissing: true });
    zone.tileId = tile && tile.id ? String(tile.id) : '';
    zone.updatedAt = Date.now();
    return zone;
  }

  function syncRotationToActiveZone(rotationDeg) {
    const nextDeg = normalizeDeg(rotationDeg);
    withActiveZoneFallback('textureRotationDeg', nextDeg);
    state._arZoneCompat.textureRotationDeg = nextDeg;
    return nextDeg;
  }

  function getActiveZoneFillMesh() {
    const zone = getActiveZone({ createIfMissing: false });
    return zone ? (zone.fillMesh || null) : null;
  }

  function setActiveZoneFillMesh(mesh) {
    const zone = getActiveZone({ createIfMissing: true });
    zone.fillMesh = mesh || null;
    zone.updatedAt = Date.now();
    return zone.fillMesh;
  }

  function getActiveZoneTileMaterial() {
    const zone = getActiveZone({ createIfMissing: false });
    return zone ? (zone.tileMaterial || null) : null;
  }

  function setActiveZoneTileMaterial(material) {
    const zone = getActiveZone({ createIfMissing: true });
    zone.tileMaterial = material || null;
    zone.updatedAt = Date.now();
    return zone.tileMaterial;
  }

  function disposeZoneMaterial(zone, opts = {}) {
    if (!zone || !zone.tileMaterial) return;
    const preserveMaterial = opts.preserveMaterial || null;
    if (preserveMaterial && zone.tileMaterial === preserveMaterial) return;
    try { zone.tileMaterial.dispose?.(); } catch (_) {}
  }

  function disposeZoneFillMesh(zone, opts = {}) {
    if (!zone || !zone.fillMesh) return;
    const anchorGroup = opts.anchorGroup || null;
    const disposeObject3D = typeof opts.disposeObject3D === 'function' ? opts.disposeObject3D : null;
    const preserveMaterial = opts.preserveMaterial || null;
    if (anchorGroup) {
      try { anchorGroup.remove(zone.fillMesh); } catch (_) {}
    }
    if (disposeObject3D) {
      let originalMaterial = null;
      const shouldPreserveMaterial = !!(preserveMaterial && zone.fillMesh.material === preserveMaterial);
      if (shouldPreserveMaterial) {
        originalMaterial = zone.fillMesh.material;
        try { zone.fillMesh.material = null; } catch (_) {}
      }
      try { disposeObject3D(zone.fillMesh); } catch (_) {}
      if (shouldPreserveMaterial) {
        try { zone.fillMesh.material = originalMaterial; } catch (_) {}
      }
    }
  }

  function removeZone(zoneId, opts = {}) {
    ensureStorage();
    const safeId = zoneId ? String(zoneId) : '';
    const index = state.arZones.findIndex((zone) => zone && String(zone.id || '') === safeId);
    if (index < 0) return null;
    const zone = state.arZones[index];
    const anchorGroup = opts.anchorGroup || null;
    const disposeObject3D = typeof opts.disposeObject3D === 'function' ? opts.disposeObject3D : null;
    const preserveMaterial = opts.preserveMaterial || null;
    if (zone && zone.fillMesh) {
      disposeZoneFillMesh(zone, { anchorGroup, disposeObject3D, preserveMaterial });
    }
    if (zone) {
      disposeZoneMaterial(zone, { preserveMaterial });
      zone.fillMesh = null;
      zone.tileMaterial = null;
      zone.updatedAt = Date.now();
    }
    state.arZones.splice(index, 1);
    if (String(state.activeZoneId || '') === safeId) {
      const fallback = state.arZones[Math.max(0, Math.min(index, state.arZones.length - 1))] || null;
      state.activeZoneId = fallback && fallback.id ? String(fallback.id) : '';
    }
    return zone || null;
  }

  function clearAllZoneRuntime(opts = {}) {
    ensureStorage();
    const anchorGroup = opts.anchorGroup || null;
    const disposeObject3D = typeof opts.disposeObject3D === 'function' ? opts.disposeObject3D : null;
    const preserveMaterial = opts.preserveMaterial || null;
    for (const zone of state.arZones) {
      if (!zone) continue;
      if (zone.fillMesh) {
        disposeZoneFillMesh(zone, { anchorGroup, disposeObject3D, preserveMaterial });
      }
      disposeZoneMaterial(zone, { preserveMaterial });
      zone.fillMesh = null;
      zone.tileMaterial = null;
      zone.updatedAt = Date.now();
    }
  }

  ensureStorage();
  initCompatAliases();
  ensureSingleActiveZone();

  return {
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
  };
}
