import * as THREE from 'three';

const EPS = 1e-4;
const DEFAULT_CURB_WIDTH = 0.022;
const DEFAULT_CURB_HEIGHT = 0.01;
const DEFAULT_CURB_Y_OFFSET = -0.0006;
const DEFAULT_CURB_CONTACT_OVERLAP = 0.0022;
const DEFAULT_CURB_MITER_LIMIT = 2.5;
const DEFAULT_CURB_INNER_LIP_WIDTH = 0.0016;
const DEFAULT_CURB_INNER_LIP_EMBED = 0.0014;
const DEFAULT_CURB_INNER_LIP_RAISE = 0.00012;

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

function pointInPolygon(point, polygon, eps = EPS) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b, eps)) return true;
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < (((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || (eps || 1e-9))) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function flipNormal(normal) {
  return normal ? { x: -Number(normal.x || 0), y: -Number(normal.y || 0) } : { x: 0, y: 0 };
}

function validateOutwardNormal(midpoint, normal, polygon, probeDist = 0.01, eps = EPS) {
  if (!midpoint || !normal || !Array.isArray(polygon) || polygon.length < 3) return normal || { x: 0, y: 0 };
  const probe = { x: midpoint.x + (normal.x * probeDist), y: midpoint.y + (normal.y * probeDist) };
  if (pointInPolygon(probe, polygon, eps)) return flipNormal(normal);
  return normal;
}

function offsetPlanarPoint(point, normal, distance) {
  if (!point || !normal) return null;
  return { x: point.x + (normal.x * distance), y: point.y + (normal.y * distance) };
}

function intersectInfiniteLines(a1, a2, b1, b2, eps = EPS) {
  if (!a1 || !a2 || !b1 || !b2) return null;
  const x1 = a1.x;
  const y1 = a1.y;
  const x2 = a2.x;
  const y2 = a2.y;
  const x3 = b1.x;
  const y3 = b1.y;
  const x4 = b2.x;
  const y4 = b2.y;
  const denom = ((x1 - x2) * (y3 - y4)) - ((y1 - y2) * (x3 - x4));
  if (Math.abs(denom) <= eps) return null;
  const detA = (x1 * y2) - (y1 * x2);
  const detB = (x3 * y4) - (y3 * x4);
  const x = ((detA * (x3 - x4)) - ((x1 - x2) * detB)) / denom;
  const y = ((detA * (y3 - y4)) - ((y1 - y2) * detB)) / denom;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function planarToWorld(planar, y) {
  if (!planar) return null;
  return new THREE.Vector3(Number(planar.x || 0), Number(y || 0), Number(planar.y || 0));
}

function buildCurbPrismGeometry(innerStart, innerEnd, outerEnd, outerStart, baseY, height) {
  const verts = [
    planarToWorld(innerStart, baseY),
    planarToWorld(innerEnd, baseY),
    planarToWorld(outerEnd, baseY),
    planarToWorld(outerStart, baseY),
    planarToWorld(innerStart, baseY + height),
    planarToWorld(innerEnd, baseY + height),
    planarToWorld(outerEnd, baseY + height),
    planarToWorld(outerStart, baseY + height),
  ];
  if (verts.some((v) => !v)) return null;
  const pos = new Float32Array(verts.length * 3);
  verts.forEach((v, idx) => {
    pos[(idx * 3) + 0] = v.x;
    pos[(idx * 3) + 1] = v.y;
    pos[(idx * 3) + 2] = v.z;
  });
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 4, 5, 0, 5, 1,
    3, 6, 2, 3, 7, 6,
    0, 7, 4, 0, 3, 7,
    1, 5, 6, 1, 6, 2,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function computeOuterMiterPoint(currentEdge, adjacentEdge, atEnd, offsetDist, miterLimit = DEFAULT_CURB_MITER_LIMIT) {
  if (!currentEdge) return null;
  const currentStart = offsetPlanarPoint(currentEdge.a, currentEdge.outwardNormal, offsetDist);
  const currentEnd = offsetPlanarPoint(currentEdge.b, currentEdge.outwardNormal, offsetDist);
  const fallback = atEnd ? currentEnd : currentStart;
  if (!adjacentEdge) return fallback;
  const otherStart = offsetPlanarPoint(adjacentEdge.a, adjacentEdge.outwardNormal, offsetDist);
  const otherEnd = offsetPlanarPoint(adjacentEdge.b, adjacentEdge.outwardNormal, offsetDist);
  const hit = atEnd
    ? intersectInfiniteLines(currentStart, currentEnd, otherStart, otherEnd)
    : intersectInfiniteLines(otherStart, otherEnd, currentStart, currentEnd);
  if (!hit) return fallback;
  const vertex = atEnd ? currentEdge.b : currentEdge.a;
  const miterLen = Math.hypot(hit.x - vertex.x, hit.y - vertex.y);
  if (!Number.isFinite(miterLen) || miterLen > (offsetDist * Math.max(1, miterLimit))) return fallback;
  return hit;
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
  const probeDist = Math.max(DEFAULT_CURB_WIDTH * 0.5, 0.01);
  for (let i = 0; i < edgeCount; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const a = toPlanar(start);
    const b = toPlanar(end);
    if (!a || !b || samePoint(a, b)) continue;
    const length = computeEdgeLength(a, b);
    if (length <= EPS) continue;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    let outwardNormal = isCounterClockwise
      ? { x: dir.y, y: -dir.x }
      : { x: -dir.y, y: dir.x };
    outwardNormal = validateOutwardNormal(computeMidpoint(a, b), outwardNormal, planarPoints, probeDist, EPS);
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

function buildCurbStripMesh({
  edges = [],
  width = DEFAULT_CURB_WIDTH,
  height = DEFAULT_CURB_HEIGHT,
  yOffset = DEFAULT_CURB_Y_OFFSET,
  surfaceY = null,
  embeddedDepth = 0,
  exposedHeight = null,
  innerLipWidth = DEFAULT_CURB_INNER_LIP_WIDTH,
  innerLipEmbed = DEFAULT_CURB_INNER_LIP_EMBED,
  innerLipRaise = DEFAULT_CURB_INNER_LIP_RAISE,
  material = null,
} = {}) {
  const validEdges = Array.isArray(edges) ? edges.filter((edge) => edge && edge.start && edge.end) : [];
  if (!validEdges.length) return null;
  const curbGroup = new THREE.Group();
  curbGroup.name = 'ar-curb-group';
  const sharedMaterial = makeCurbMaterial({ material });
  const safeEmbeddedDepth = Math.max(0, ensureFinite(embeddedDepth, 0));
  const resolvedHeight = Math.max(EPS, Number.isFinite(exposedHeight)
    ? Math.max(0, ensureFinite(exposedHeight, 0)) + safeEmbeddedDepth
    : ensureFinite(height, DEFAULT_CURB_HEIGHT));
  const hasSurfaceY = Number.isFinite(surfaceY);
  const safeInnerLipWidth = Math.max(0, ensureFinite(innerLipWidth, DEFAULT_CURB_INNER_LIP_WIDTH));
  const safeInnerLipEmbed = Math.max(0, ensureFinite(innerLipEmbed, DEFAULT_CURB_INNER_LIP_EMBED));
  const safeInnerLipRaise = Math.max(0, ensureFinite(innerLipRaise, DEFAULT_CURB_INNER_LIP_RAISE));
  curbGroup.userData.curb = { width, height: resolvedHeight, yOffset, surfaceY, embeddedDepth: safeEmbeddedDepth, exposedHeight, innerLipWidth: safeInnerLipWidth, innerLipEmbed: safeInnerLipEmbed, innerLipRaise: safeInnerLipRaise };
  const byStart = new Map();
  const byEnd = new Map();
  for (const edge of validEdges) {
    byStart.set(`${String(edge.zoneId || '')}:${Number(edge.startIndex)}`, edge);
    byEnd.set(`${String(edge.zoneId || '')}:${Number(edge.endIndex)}`, edge);
  }
  const contactOverlap = Math.max(0, DEFAULT_CURB_CONTACT_OVERLAP);
  const innerOffset = -contactOverlap;
  const outerOffset = Math.max(innerOffset + EPS, width - contactOverlap);
  for (const edge of validEdges) {
    const start = edge.start;
    const end = edge.end;
    const dx = Number(end.x) - Number(start.x);
    const dz = Number(end.z) - Number(start.z);
    const length = Math.hypot(dx, dz);
    if (!(length > EPS)) continue;
    const zoneKey = String(edge.zoneId || '');
    const prevEdge = byEnd.get(`${zoneKey}:${Number(edge.startIndex)}`) || null;
    const nextEdge = byStart.get(`${zoneKey}:${Number(edge.endIndex)}`) || null;
    const innerStart = computeOuterMiterPoint(edge, prevEdge, false, innerOffset);
    const innerEnd = computeOuterMiterPoint(edge, nextEdge, true, innerOffset);
    const outerStart = computeOuterMiterPoint(edge, prevEdge, false, outerOffset);
    const outerEnd = computeOuterMiterPoint(edge, nextEdge, true, outerOffset);
    if (!innerStart || !innerEnd || !outerStart || !outerEnd) continue;
    const footprint = Math.max(
      computeEdgeLength(innerStart, innerEnd),
      computeEdgeLength(outerStart, outerEnd),
      computeEdgeLength(innerStart, outerStart),
      computeEdgeLength(innerEnd, outerEnd),
    );
    if (!(footprint > EPS)) continue;
    const baseY = hasSurfaceY
      ? Number(surfaceY) - safeEmbeddedDepth
      : Math.min(Number(start.y), Number(end.y)) + yOffset;
    const geometry = buildCurbPrismGeometry(innerStart, innerEnd, outerEnd, outerStart, baseY, resolvedHeight);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    mesh.name = `ar-curb-segment-${String(edge.key || '')}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.curbSegment = {
      edgeKey: String(edge.key || ''),
      zoneId: String(edge.zoneId || ''),
      boundaryType: String(edge.boundaryType || 'outer_boundary'),
      width,
      height: resolvedHeight,
      innerOffset,
      outerOffset,
      contactOverlap,
      surfaceY: hasSurfaceY ? Number(surfaceY) : null,
      embeddedDepth: safeEmbeddedDepth,
      exposedHeight: Number.isFinite(exposedHeight) ? Number(exposedHeight) : null,
      innerLipWidth: safeInnerLipWidth,
      innerLipEmbed: safeInnerLipEmbed,
      innerLipRaise: safeInnerLipRaise,
    };
    curbGroup.add(mesh);
    if (hasSurfaceY && safeInnerLipWidth > EPS) {
      const lipInnerOffset = innerOffset - safeInnerLipWidth;
      const lipInnerStart = computeOuterMiterPoint(edge, prevEdge, false, lipInnerOffset);
      const lipInnerEnd = computeOuterMiterPoint(edge, nextEdge, true, lipInnerOffset);
      if (lipInnerStart && lipInnerEnd) {
        const lipBaseY = Number(surfaceY) - safeInnerLipEmbed;
        const lipHeight = Math.max(EPS, safeInnerLipEmbed + safeInnerLipRaise);
        const lipGeometry = buildCurbPrismGeometry(lipInnerStart, lipInnerEnd, innerEnd, innerStart, lipBaseY, lipHeight);
        if (lipGeometry) {
          const lipMesh = new THREE.Mesh(lipGeometry, sharedMaterial);
          lipMesh.name = `ar-curb-seam-${String(edge.key || '')}`;
          lipMesh.castShadow = false;
          lipMesh.receiveShadow = false;
          lipMesh.userData.curbSegment = {
            edgeKey: String(edge.key || ''),
            zoneId: String(edge.zoneId || ''),
            boundaryType: String(edge.boundaryType || 'outer_boundary'),
            role: 'inner_lip',
            width: safeInnerLipWidth,
            surfaceY: Number(surfaceY),
            embeddedDepth: safeInnerLipEmbed,
            exposedHeight: safeInnerLipRaise,
          };
          curbGroup.add(lipMesh);
        }
      }
    }
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
      surfaceY: Number.isFinite(opts.surfaceY) ? Number(opts.surfaceY) : null,
      embeddedDepth: ensureFinite(opts.embeddedDepth, 0),
      exposedHeight: Number.isFinite(opts.exposedHeight) ? Number(opts.exposedHeight) : null,
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
