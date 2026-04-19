import * as THREE from 'three';

const EPS = 1e-4;
const DEFAULT_CURB_WIDTH = 0.045;
const DEFAULT_CURB_HEIGHT = 0.028;
const DEFAULT_CURB_Y_OFFSET = 0.003;
const DEFAULT_CURB_OUTER_GAP = 0.002;

function ensureFinite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clonePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null;
  return new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z));
}

function normalizeId(value) {
  return value ? String(value) : '';
}

function normalizeEdgeKey(zoneId, startIndex, endIndex) {
  return `${normalizeId(zoneId)}:${Number(startIndex)}-${Number(endIndex)}`;
}

function toPlanar(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  return { x: Number(point.x), y: Number(point.z) };
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function eq(a, b, eps = EPS) {
  return Math.abs(a - b) <= eps;
}

function samePoint(a, b, eps = EPS) {
  return !!a && !!b && eq(a.x, b.x, eps) && eq(a.y, b.y, eps);
}

function pointOnSegment(point, a, b, eps = EPS) {
  if (!point || !a || !b) return false;
  if (Math.abs(orient(a, b, point)) > eps) return false;
  return point.x >= Math.min(a.x, b.x) - eps
    && point.x <= Math.max(a.x, b.x) + eps
    && point.y >= Math.min(a.y, b.y) - eps
    && point.y <= Math.max(a.y, b.y) + eps;
}

function segmentsCollinear(a, b, c, d, eps = EPS) {
  if (!a || !b || !c || !d) return false;
  return Math.abs(orient(a, b, c)) <= eps && Math.abs(orient(a, b, d)) <= eps;
}

function segmentOverlapLength(a, b, c, d, eps = EPS) {
  if (!segmentsCollinear(a, b, c, d, eps)) return 0;
  const dirX = Math.abs(b.x - a.x);
  const dirY = Math.abs(b.y - a.y);
  if (dirX >= dirY) {
    const minA = Math.min(a.x, b.x);
    const maxA = Math.max(a.x, b.x);
    const minB = Math.min(c.x, d.x);
    const maxB = Math.max(c.x, d.x);
    return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
  }
  const minA = Math.min(a.y, b.y);
  const maxA = Math.max(a.y, b.y);
  const minB = Math.min(c.y, d.y);
  const maxB = Math.max(c.y, d.y);
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function computeEdgeLength(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function computeMidpoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function computePolygonSignedArea(points) {
  const pts = Array.isArray(points) ? points.filter(Boolean) : [];
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    area += (a.x * b.y) - (b.x * a.y);
  }
  return area / 2;
}

function getZonePoints(zone) {
  const source = zone && Array.isArray(zone.points) ? zone.points : [];
  return source.map(clonePoint).filter(Boolean);
}

function getZoneEdges(zone) {
  const zoneId = normalizeId(zone && zone.id);
  const points = getZonePoints(zone);
  const edges = [];
  if (!zoneId || points.length < 2) return edges;
  const isClosed = !!(zone && zone.closed !== false && points.length >= 3);
  const edgeCount = isClosed ? points.length : Math.max(0, points.length - 1);
  const planarPoints = points.map(toPlanar).filter(Boolean);
  const signedArea = isClosed ? computePolygonSignedArea(planarPoints) : 0;
  const isCounterClockwise = signedArea > 0;
  for (let i = 0; i < edgeCount; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const a = toPlanar(start);
    const b = toPlanar(end);
    if (!a || !b || samePoint(a, b)) continue;
    const length = computeEdgeLength(a, b);
    if (length <= EPS) continue;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const outwardNormal = isCounterClockwise
      ? { x: dir.y, y: -dir.x }
      : { x: -dir.y, y: dir.x };
    edges.push({
      key: normalizeEdgeKey(zoneId, i, (i + 1) % points.length),
      zoneId,
      startIndex: i,
      endIndex: (i + 1) % points.length,
      start,
      end,
      a,
      b,
      midpoint: computeMidpoint(a, b),
      length,
      direction: dir,
      outwardNormal,
      signedArea,
      isCounterClockwise,
      boundaryType: 'outer_boundary',
      sharedZoneIds: [],
      sharedEdgeKeys: [],
    });
  }
  return edges;
}

function classifyEdges(edgeList, allZones = [], eps = EPS) {
  const otherEdges = [];
  for (const zone of Array.isArray(allZones) ? allZones : []) {
    if (!zone) continue;
    const zoneEdges = getZoneEdges(zone);
    for (const edge of zoneEdges) otherEdges.push(edge);
  }
  return edgeList.map((edge) => {
    const next = { ...edge, sharedZoneIds: [], sharedEdgeKeys: [] };
    for (const foreign of otherEdges) {
      if (!foreign) continue;
      if (String(foreign.zoneId) === String(edge.zoneId)) continue;
      const overlap = segmentOverlapLength(edge.a, edge.b, foreign.a, foreign.b, eps);
      if (overlap <= eps) continue;
      const midpointOnForeign = edge.midpoint && pointOnSegment(edge.midpoint, foreign.a, foreign.b, eps);
      if (!midpointOnForeign) continue;
      next.boundaryType = 'shared_boundary';
      if (!next.sharedZoneIds.includes(String(foreign.zoneId))) next.sharedZoneIds.push(String(foreign.zoneId));
      if (!next.sharedEdgeKeys.includes(String(foreign.key))) next.sharedEdgeKeys.push(String(foreign.key));
    }
    return next;
  });
}

function makeCurbMaterial(opts = {}) {
  if (opts.material && typeof opts.material === 'object') return opts.material;
  return new THREE.MeshStandardMaterial({
    color: opts.color != null ? opts.color : 0xb3b8c2,
    roughness: ensureFinite(opts.roughness, 0.86),
    metalness: ensureFinite(opts.metalness, 0.04),
  });
}

function buildCurbStripMesh({ edges = [], width = DEFAULT_CURB_WIDTH, height = DEFAULT_CURB_HEIGHT, yOffset = DEFAULT_CURB_Y_OFFSET, material = null } = {}) {
  const validEdges = Array.isArray(edges) ? edges.filter((edge) => edge && edge.start && edge.end) : [];
  if (!validEdges.length) return null;
  const curbGroup = new THREE.Group();
  curbGroup.name = 'ar-curb-group';
  const sharedMaterial = makeCurbMaterial({ material });
  curbGroup.userData.curb = { width, height, yOffset };
  for (const edge of validEdges) {
    const start = edge.start;
    const end = edge.end;
    const dx = Number(end.x) - Number(start.x);
    const dz = Number(end.z) - Number(start.z);
    const length = Math.hypot(dx, dz);
    if (!(length > EPS)) continue;
    const trim = Math.min(width * 0.55, length * 0.2);
    const usableLength = Math.max(EPS, length - (trim * 2));
    const dirX = dx / length;
    const dirZ = dz / length;
    const normal = edge && edge.outwardNormal
      ? { x: Number(edge.outwardNormal.x) || 0, y: Number(edge.outwardNormal.y) || 0 }
      : { x: dirZ, y: -dirX };
    const offsetDist = (width / 2) + DEFAULT_CURB_OUTER_GAP;
    const centerX = (Number(start.x) + Number(end.x)) / 2 + (normal.x * offsetDist);
    const centerZ = (Number(start.z) + Number(end.z)) / 2 + (normal.y * offsetDist);
    const baseY = Math.max(Number(start.y), Number(end.y));
    const geometry = new THREE.BoxGeometry(usableLength, height, width);
    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    mesh.name = `ar-curb-segment-${String(edge.key || '')}`;
    mesh.position.set(centerX, baseY + yOffset + (height / 2), centerZ);
    mesh.rotation.y = Math.atan2(dz, dx);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.curbSegment = {
      edgeKey: String(edge.key || ''),
      zoneId: String(edge.zoneId || ''),
      boundaryType: String(edge.boundaryType || 'outer_boundary'),
      width,
      height,
      usableLength,
      offsetDist,
    };
    curbGroup.add(mesh);
  }
  if (!curbGroup.children.length) {
    try { sharedMaterial.dispose?.(); } catch (_) {}
    return null;
  }
  return curbGroup;
}

export function createArCurbHelpers(ctx = {}) {
  const state = ctx.state;
  if (!state || typeof state !== 'object') throw new Error('state is required');

  function ensureStorage() {
    if (!Array.isArray(state.arCurbs)) state.arCurbs = [];
    if (!Number.isFinite(state._arCurbSeq)) state._arCurbSeq = 0;
    if (typeof state.activeCurbId !== 'string') state.activeCurbId = '';
  }

  function nextCurbId() {
    ensureStorage();
    state._arCurbSeq += 1;
    return `curb_${state._arCurbSeq}`;
  }

  function getZones() {
    return Array.isArray(state.arZones) ? state.arZones.filter(Boolean) : [];
  }

  function getZoneById(zoneId) {
    const safeId = normalizeId(zoneId);
    if (!safeId) return null;
    return getZones().find((zone) => zone && String(zone.id || '') === safeId) || null;
  }

  function buildCurb(seed = {}) {
    ensureStorage();
    return {
      id: seed.id ? String(seed.id) : nextCurbId(),
      zoneId: normalizeId(seed.zoneId),
      edgeKeys: Array.isArray(seed.edgeKeys) ? seed.edgeKeys.map((item) => String(item)) : [],
      presetId: seed.presetId ? String(seed.presetId) : 'standard',
      materialId: seed.materialId ? String(seed.materialId) : '',
      side: seed.side ? String(seed.side) : 'outer',
      width: ensureFinite(seed.width, DEFAULT_CURB_WIDTH),
      height: ensureFinite(seed.height, DEFAULT_CURB_HEIGHT),
      yOffset: ensureFinite(seed.yOffset, DEFAULT_CURB_Y_OFFSET),
      boundaryMode: seed.boundaryMode ? String(seed.boundaryMode) : 'outer_perimeter',
      visible: seed.visible !== false,
      mesh: seed.mesh || null,
      createdAt: Number(seed.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
  }

  function getCurbs() {
    ensureStorage();
    return state.arCurbs.slice();
  }

  function getCurbById(curbId) {
    ensureStorage();
    const safeId = normalizeId(curbId);
    if (!safeId) return null;
    return state.arCurbs.find((curb) => curb && String(curb.id || '') === safeId) || null;
  }

  function getCurbsByZoneId(zoneId) {
    const safeId = normalizeId(zoneId);
    if (!safeId) return [];
    return getCurbs().filter((curb) => curb && String(curb.zoneId || '') === safeId);
  }

  function analyzeZoneEdges(zoneId, opts = {}) {
    const zone = typeof zoneId === 'object' ? zoneId : getZoneById(zoneId);
    if (!zone) return { zoneId: normalizeId(zoneId), edges: [] };
    const otherZones = (Array.isArray(opts.zones) ? opts.zones : getZones()).filter((item) => item && String(item.id || '') !== String(zone.id || ''));
    const edges = classifyEdges(getZoneEdges(zone), otherZones, ensureFinite(opts.epsilon, EPS));
    return { zoneId: String(zone.id || ''), edges };
  }

  function getOuterBoundaryEdges(zoneId, opts = {}) {
    const analysis = analyzeZoneEdges(zoneId, opts);
    return analysis.edges.filter((edge) => edge && edge.boundaryType === 'outer_boundary');
  }

  function upsertPerimeterCurb(zoneId, opts = {}) {
    ensureStorage();
    const zone = getZoneById(zoneId);
    if (!zone) return null;
    const outerEdges = getOuterBoundaryEdges(zone.id, opts);
    const nextEdgeKeys = Array.isArray(opts.edgeKeys) && opts.edgeKeys.length
      ? outerEdges.filter((edge) => opts.edgeKeys.includes(edge.key)).map((edge) => edge.key)
      : outerEdges.map((edge) => edge.key);
    let curb = getCurbsByZoneId(zone.id)[0] || null;
    if (!curb) {
      curb = buildCurb({ zoneId: zone.id });
      state.arCurbs.push(curb);
      state.activeCurbId = curb.id;
    }
    curb.zoneId = String(zone.id || '');
    curb.edgeKeys = nextEdgeKeys;
    curb.presetId = opts.presetId ? String(opts.presetId) : curb.presetId;
    curb.materialId = opts.materialId ? String(opts.materialId) : curb.materialId;
    curb.side = opts.side ? String(opts.side) : curb.side;
    curb.width = ensureFinite(opts.width, curb.width || DEFAULT_CURB_WIDTH);
    curb.height = ensureFinite(opts.height, curb.height || DEFAULT_CURB_HEIGHT);
    curb.yOffset = ensureFinite(opts.yOffset, curb.yOffset || DEFAULT_CURB_Y_OFFSET);
    curb.boundaryMode = opts.boundaryMode ? String(opts.boundaryMode) : 'outer_perimeter';
    curb.updatedAt = Date.now();
    return curb;
  }

  function buildPerimeterCurbMesh(zoneId, opts = {}) {
    const zone = getZoneById(zoneId);
    if (!zone) return null;
    const curb = upsertPerimeterCurb(zone.id, opts);
    if (!curb) return null;
    const outerEdges = getOuterBoundaryEdges(zone.id, opts);
    const selectedEdges = outerEdges.filter((edge) => curb.edgeKeys.includes(edge.key));
    const mesh = buildCurbStripMesh({
      edges: selectedEdges,
      width: ensureFinite(opts.width, curb.width),
      height: ensureFinite(opts.height, curb.height),
      yOffset: ensureFinite(opts.yOffset, curb.yOffset),
      material: opts.material || null,
    });
    return { curb, mesh, edges: selectedEdges };
  }

  function attachCurbMesh(curbId, mesh, opts = {}) {
    const curb = getCurbById(curbId);
    if (!curb) return null;
    const anchorGroup = opts.anchorGroup || null;
    if (curb.mesh && anchorGroup) {
      try { anchorGroup.remove(curb.mesh); } catch (_) {}
    }
    curb.mesh = mesh || null;
    curb.updatedAt = Date.now();
    if (curb.mesh && anchorGroup) {
      try { anchorGroup.add(curb.mesh); } catch (_) {}
    }
    return curb.mesh;
  }

  function disposeCurbMesh(curb, opts = {}) {
    if (!curb || !curb.mesh) return;
    const anchorGroup = opts.anchorGroup || null;
    const disposeObject3D = typeof opts.disposeObject3D === 'function' ? opts.disposeObject3D : null;
    if (anchorGroup) {
      try { anchorGroup.remove(curb.mesh); } catch (_) {}
    }
    if (disposeObject3D) {
      try { disposeObject3D(curb.mesh); } catch (_) {}
    } else {
      try {
        curb.mesh.traverse?.((child) => {
          if (child && child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
          const mat = child && child.material ? child.material : null;
          if (Array.isArray(mat)) {
            for (const item of mat) {
              try { item?.dispose?.(); } catch (_) {}
            }
          } else {
            try { mat?.dispose?.(); } catch (_) {}
          }
        });
      } catch (_) {}
    }
    curb.mesh = null;
    curb.updatedAt = Date.now();
  }

  function removeCurb(curbId, opts = {}) {
    ensureStorage();
    const safeId = normalizeId(curbId);
    const index = state.arCurbs.findIndex((curb) => curb && String(curb.id || '') === safeId);
    if (index < 0) return null;
    const curb = state.arCurbs[index];
    disposeCurbMesh(curb, opts);
    state.arCurbs.splice(index, 1);
    if (String(state.activeCurbId || '') === safeId) {
      const fallback = state.arCurbs[Math.max(0, Math.min(index, state.arCurbs.length - 1))] || null;
      state.activeCurbId = fallback && fallback.id ? String(fallback.id) : '';
    }
    return curb || null;
  }

  function removeCurbsForZone(zoneId, opts = {}) {
    ensureStorage();
    const safeId = normalizeId(zoneId);
    if (!safeId) return [];
    const removed = [];
    const curbIds = state.arCurbs
      .filter((curb) => curb && String(curb.zoneId || '') === safeId)
      .map((curb) => String(curb.id || ''));
    for (const curbId of curbIds) {
      const curb = removeCurb(curbId, opts);
      if (curb) removed.push(curb);
    }
    return removed;
  }

  function clearAllCurbRuntime(opts = {}) {
    ensureStorage();
    for (const curb of state.arCurbs) {
      disposeCurbMesh(curb, opts);
    }
  }

  function resetCurbStorage() {
    ensureStorage();
    state.arCurbs = [];
    state.activeCurbId = '';
  }

  ensureStorage();

  return {
    getCurbs,
    getCurbById,
    getCurbsByZoneId,
    analyzeZoneEdges,
    getOuterBoundaryEdges,
    upsertPerimeterCurb,
    buildPerimeterCurbMesh,
    attachCurbMesh,
    removeCurb,
    removeCurbsForZone,
    clearAllCurbRuntime,
    resetCurbStorage,
  };
}
