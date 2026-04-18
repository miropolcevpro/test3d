import * as THREE from 'three';

const EPS = 1e-5;

function toPlanarPoints(points = []) {
  return Array.isArray(points)
    ? points
      .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.z))
      .map((point) => ({ x: Number(point.x), y: Number(point.z) }))
    : [];
}

function eq(a, b, eps = EPS) {
  return Math.abs(a - b) <= eps;
}

function samePoint(a, b, eps = EPS) {
  return !!a && !!b && eq(a.x, b.x, eps) && eq(a.y, b.y, eps);
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function bboxDisjoint(a, b, c, d, eps = EPS) {
  const minAx = Math.min(a.x, b.x) - eps;
  const maxAx = Math.max(a.x, b.x) + eps;
  const minAy = Math.min(a.y, b.y) - eps;
  const maxAy = Math.max(a.y, b.y) + eps;
  const minCx = Math.min(c.x, d.x) - eps;
  const maxCx = Math.max(c.x, d.x) + eps;
  const minCy = Math.min(c.y, d.y) - eps;
  const maxCy = Math.max(c.y, d.y) + eps;
  return maxAx < minCx || maxCx < minAx || maxAy < minCy || maxCy < minAy;
}

function pointOnSegment(p, a, b, eps = EPS) {
  if (!p || !a || !b) return false;
  if (Math.abs(orient(a, b, p)) > eps) return false;
  return p.x >= Math.min(a.x, b.x) - eps
    && p.x <= Math.max(a.x, b.x) + eps
    && p.y >= Math.min(a.y, b.y) - eps
    && p.y <= Math.max(a.y, b.y) + eps;
}

function segmentIntersectionKind(a, b, c, d, eps = EPS) {
  if (bboxDisjoint(a, b, c, d, eps)) return 'none';

  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  const s1 = Math.abs(o1) <= eps ? 0 : (o1 > 0 ? 1 : -1);
  const s2 = Math.abs(o2) <= eps ? 0 : (o2 > 0 ? 1 : -1);
  const s3 = Math.abs(o3) <= eps ? 0 : (o3 > 0 ? 1 : -1);
  const s4 = Math.abs(o4) <= eps ? 0 : (o4 > 0 ? 1 : -1);

  if (s1 * s2 < 0 && s3 * s4 < 0) return 'proper';

  const touch =
    (s1 === 0 && pointOnSegment(c, a, b, eps)) ||
    (s2 === 0 && pointOnSegment(d, a, b, eps)) ||
    (s3 === 0 && pointOnSegment(a, c, d, eps)) ||
    (s4 === 0 && pointOnSegment(b, c, d, eps));

  if (!touch) return 'none';

  if (s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0) return 'colinear_overlap';
  return 'touch';
}

function polygonSegments(poly) {
  const out = [];
  if (!Array.isArray(poly) || poly.length < 2) return out;
  for (let i = 0; i < poly.length; i += 1) {
    out.push([poly[i], poly[(i + 1) % poly.length], i]);
  }
  return out;
}

function isAdjacentEdge(i, j, count) {
  if (i === j) return true;
  if ((i + 1) % count === j) return true;
  if ((j + 1) % count === i) return true;
  return false;
}

function hasSelfIntersection(poly) {
  const count = Array.isArray(poly) ? poly.length : 0;
  if (count < 4) return false;
  const segments = polygonSegments(poly);
  for (let i = 0; i < segments.length; i += 1) {
    const [a1, a2] = segments[i];
    for (let j = i + 1; j < segments.length; j += 1) {
      if (isAdjacentEdge(i, j, count)) continue;
      const [b1, b2] = segments[j];
      const kind = segmentIntersectionKind(a1, a2, b1, b2);
      if (kind !== 'none') return true;
    }
  }
  return false;
}

function pointOnPolygonBoundary(point, poly, eps = EPS) {
  const segments = polygonSegments(poly);
  for (const [a, b] of segments) {
    if (pointOnSegment(point, a, b, eps)) return true;
  }
  return false;
}

function isPointStrictlyInsidePolygon(point, poly, eps = EPS) {
  if (!point || !Array.isArray(poly) || poly.length < 3) return false;
  if (pointOnPolygonBoundary(point, poly, eps)) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pushUniquePoint(points, point, eps = EPS) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  if (points.some((item) => samePoint(item, point, eps))) return;
  points.push(point);
}

function getInteriorSamples(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const samples = [];
  try {
    const contour = poly.map((point) => new THREE.Vector2(point.x, point.y));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    if (Array.isArray(triangles) && triangles.length) {
      for (const tri of triangles) {
        if (!Array.isArray(tri) || tri.length < 3) continue;
        const a = poly[tri[0]];
        const b = poly[tri[1]];
        const c = poly[tri[2]];
        if (!a || !b || !c) continue;
        pushUniquePoint(samples, {
          x: (a.x + b.x + c.x) / 3,
          y: (a.y + b.y + c.y) / 3,
        });
      }
    }
  } catch (_) {}

  for (let i = 1; i < poly.length - 1; i += 1) {
    const a = poly[0];
    const b = poly[i];
    const c = poly[i + 1];
    if (!a || !b || !c) continue;
    pushUniquePoint(samples, {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
    });
  }

  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const point of poly) {
    if (!point) continue;
    sx += point.x;
    sy += point.y;
    count += 1;
  }
  if (count) pushUniquePoint(samples, { x: sx / count, y: sy / count });
  return samples;
}

function findEdgeConflict(polyA, polyB) {
  const segA = polygonSegments(polyA);
  const segB = polygonSegments(polyB);
  for (const [a1, a2] of segA) {
    for (const [b1, b2] of segB) {
      const kind = segmentIntersectionKind(a1, a2, b1, b2);
      if (kind === 'proper') return { kind: 'edge_cross' };
    }
  }
  return null;
}

function findPolygonOverlap(polyA, polyB) {
  const edgeConflict = findEdgeConflict(polyA, polyB);
  if (edgeConflict) return edgeConflict;

  const sampleA = getInteriorSamples(polyA);
  if (sampleA.some((point) => isPointStrictlyInsidePolygon(point, polyB))) {
    return { kind: 'inside_other' };
  }

  const sampleB = getInteriorSamples(polyB);
  if (sampleB.some((point) => isPointStrictlyInsidePolygon(point, polyA))) {
    return { kind: 'contains_other' };
  }

  return null;
}

export function validateZoneContourAgainstZones({ candidatePoints = [], zones = [], excludeZoneId = '' } = {}) {
  const candidate = toPlanarPoints(candidatePoints);
  if (candidate.length < 3) {
    return { ok: false, reason: 'too_few_points' };
  }

  if (hasSelfIntersection(candidate)) {
    return { ok: false, reason: 'self_intersection' };
  }

  const excluded = excludeZoneId ? String(excludeZoneId) : '';
  for (const zone of Array.isArray(zones) ? zones : []) {
    if (!zone || (excluded && String(zone.id || '') === excluded)) continue;
    const zonePoints = Array.isArray(zone.points) ? zone.points : [];
    if (zonePoints.length < 3) continue;
    const other = toPlanarPoints(zonePoints);
    const overlap = findPolygonOverlap(candidate, other);
    if (overlap) {
      return {
        ok: false,
        reason: 'zone_overlap',
        detail: overlap.kind,
        otherZoneId: zone.id ? String(zone.id) : '',
        otherZoneTitle: zone.title ? String(zone.title) : '',
      };
    }
  }

  return { ok: true, reason: '' };
}
