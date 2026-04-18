import * as THREE from 'three';

const EPS = 1e-5;

function samePoint2D(a, b, eps = EPS) {
  return !!a && !!b && Math.abs(a.x - b.x) <= eps && Math.abs(a.z - b.z) <= eps;
}

function toLocalPoint(point, fallbackY = 0) {
  const x = Number(point && point.x);
  const z = Number(point && point.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const y = Number.isFinite(Number(point && point.y)) ? Number(point.y) : fallbackY;
  return new THREE.Vector3(x, y, z);
}

function distXZSquared(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  return dx * dx + dz * dz;
}

function projectPointToSegmentXZ(point, a, b) {
  if (!point || !a || !b) return null;
  const abx = Number(b.x) - Number(a.x);
  const abz = Number(b.z) - Number(a.z);
  const len2 = abx * abx + abz * abz;
  if (!(len2 > EPS)) return null;
  const apx = Number(point.x) - Number(a.x);
  const apz = Number(point.z) - Number(a.z);
  let t = (apx * abx + apz * abz) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return {
    x: Number(a.x) + abx * t,
    z: Number(a.z) + abz * t,
    t,
  };
}

function iterateZoneVertices(zones = [], excludeZoneId = '') {
  const excluded = excludeZoneId ? String(excludeZoneId) : '';
  const out = [];
  for (const zone of Array.isArray(zones) ? zones : []) {
    if (!zone || (excluded && String(zone.id || '') === excluded)) continue;
    const points = Array.isArray(zone.points) ? zone.points : [];
    if (!points.length) continue;
    for (let index = 0; index < points.length; index += 1) {
      const point = toLocalPoint(points[index]);
      if (!point) continue;
      out.push({
        kind: 'vertex',
        point,
        distanceSq: Number.POSITIVE_INFINITY,
        zoneId: zone.id ? String(zone.id) : '',
        zoneTitle: zone.title ? String(zone.title) : '',
        vertexIndex: index,
      });
    }
  }
  return out;
}

function iterateZoneEdges(zones = [], excludeZoneId = '') {
  const excluded = excludeZoneId ? String(excludeZoneId) : '';
  const out = [];
  for (const zone of Array.isArray(zones) ? zones : []) {
    if (!zone || (excluded && String(zone.id || '') === excluded)) continue;
    const points = Array.isArray(zone.points) ? zone.points : [];
    if (points.length < 2) continue;
    const isClosed = zone.closed !== false && points.length >= 3;
    const edgeCount = isClosed ? points.length : (points.length - 1);
    for (let index = 0; index < edgeCount; index += 1) {
      const a = toLocalPoint(points[index]);
      const b = toLocalPoint(points[(index + 1) % points.length]);
      if (!a || !b) continue;
      if (samePoint2D(a, b)) continue;
      out.push({
        kind: 'edge',
        a,
        b,
        zoneId: zone.id ? String(zone.id) : '',
        zoneTitle: zone.title ? String(zone.title) : '',
        edgeIndex: index,
      });
    }
  }
  return out;
}

export function computeZoneSnapTarget({
  point = null,
  zones = [],
  excludeZoneId = '',
  vertexThreshold = 0.12,
  edgeThreshold = 0.08,
} = {}) {
  const source = toLocalPoint(point);
  if (!source) return { armed: false, kind: 'none', point: null };

  const vertexThresholdSq = Math.max(0, Number(vertexThreshold) || 0) ** 2;
  const edgeThresholdSq = Math.max(0, Number(edgeThreshold) || 0) ** 2;

  let bestVertex = null;
  for (const candidate of iterateZoneVertices(zones, excludeZoneId)) {
    const distanceSq = distXZSquared(source, candidate.point);
    if (!(distanceSq <= vertexThresholdSq)) continue;
    if (!bestVertex || distanceSq < bestVertex.distanceSq) {
      bestVertex = { ...candidate, distanceSq };
    }
  }
  if (bestVertex) {
    return {
      armed: true,
      kind: 'vertex',
      point: bestVertex.point.clone(),
      distanceM: Math.sqrt(bestVertex.distanceSq),
      zoneId: bestVertex.zoneId,
      zoneTitle: bestVertex.zoneTitle,
      vertexIndex: bestVertex.vertexIndex,
      sourcePoint: source.clone(),
    };
  }

  let bestEdge = null;
  for (const edge of iterateZoneEdges(zones, excludeZoneId)) {
    const projected = projectPointToSegmentXZ(source, edge.a, edge.b);
    if (!projected) continue;
    const projectedPoint = new THREE.Vector3(projected.x, source.y, projected.z);
    const distanceSq = distXZSquared(source, projectedPoint);
    if (!(distanceSq <= edgeThresholdSq)) continue;
    if (!bestEdge || distanceSq < bestEdge.distanceSq) {
      bestEdge = {
        ...edge,
        point: projectedPoint,
        projectionT: projected.t,
        distanceSq,
      };
    }
  }

  if (bestEdge) {
    return {
      armed: true,
      kind: 'edge',
      point: bestEdge.point.clone(),
      distanceM: Math.sqrt(bestEdge.distanceSq),
      zoneId: bestEdge.zoneId,
      zoneTitle: bestEdge.zoneTitle,
      edgeIndex: bestEdge.edgeIndex,
      projectionT: bestEdge.projectionT,
      sourcePoint: source.clone(),
    };
  }

  return { armed: false, kind: 'none', point: source.clone() };
}
