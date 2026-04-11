import * as THREE from 'three';

export function distXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function polyArea2(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += (a.x * b.z - b.x * a.z);
  }
  return s * 0.5;
}

export function computeAreaM2FromContours(points, holes = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let outer = Math.abs(polyArea2(points));
  let holesArea = 0;
  for (const h of holes) {
    if (Array.isArray(h) && h.length >= 3) holesArea += Math.abs(polyArea2(h));
  }
  return Math.max(0, outer - holesArea);
}

export function createFlagMarker({
  baseColor = 0x00e5ff,
  ringColor = 0x2f6cff,
  poleColor = 0x00e5ff,
  withRing = false,
} = {}) {
  const g = new THREE.Group();
  g.name = 'flagMarker';
  g.userData.baseScale = 1.3;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.034, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shadow.position.y = 0.0005;
  g.add(shadow);

  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(0.0165, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: baseColor })
  );
  disk.position.y = 0.001;
  g.add(disk);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.0188, 0.0285, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.95, depthWrite: false })
  );
  ring.name = 'baseRing';
  ring.position.y = 0.0011;
  g.add(ring);

  if (withRing) {
    const firstRing = new THREE.Mesh(
      new THREE.RingGeometry(0.030, 0.052, 44).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.55, depthWrite: false })
    );
    firstRing.name = 'firstRing';
    firstRing.position.y = 0.0012;
    g.add(firstRing);
  }

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0024, 0.0024, 0.16, 12),
    new THREE.MeshBasicMaterial({ color: poleColor, transparent: true, opacity: 0.95 })
  );
  pole.position.y = 0.08;
  g.add(pole);

  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.0065, 16, 12),
    new THREE.MeshBasicMaterial({ color: poleColor, transparent: true, opacity: 0.95 })
  );
  top.position.y = 0.16;
  g.add(top);

  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false })
  );
  hit.name = 'hit';
  hit.position.y = 0.06;
  g.add(hit);

  g.scale.setScalar(g.userData.baseScale);
  return g;
}

export function rebuildThickLine({ anchorGroup, line, points, floorY, closed = false, disposeObject3D }) {
  if (line) {
    anchorGroup.remove(line);
    disposeObject3D?.(line);
    line = null;
  }

  const pts = Array.isArray(points) ? points.slice() : [];
  if (pts.length < 2) return null;

  const drawPts = pts.slice();
  if (closed) drawPts.push(pts[0].clone());

  const group = new THREE.Group();
  group.name = 'polyLine';
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const radius = 0.0045;

  for (let i = 0; i < drawPts.length - 1; i++) {
    const a = drawPts[i];
    const b = drawPts[i + 1];
    const len = distXZ(a, b);
    if (len < 1e-6) continue;

    const mid = new THREE.Vector3((a.x + b.x) / 2, floorY + 0.008, (a.z + b.z) / 2);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), mat);
    cyl.position.copy(mid);

    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cyl.quaternion.copy(quat);
    group.add(cyl);
  }

  anchorGroup.add(group);
  return group;
}

export function rebuildMarkersAndLine({
  pointsGroup,
  points,
  holePoints,
  phase,
  anchorGroup,
  line,
  floorY,
  disposeObject3D,
  closed = false,
}) {
  pointsGroup.clear();

  (points || []).forEach((p, i) => {
    const flag = createFlagMarker({ withRing: i === 0 });
    flag.position.copy(p);
    pointsGroup.add(flag);
  });

  if (phase === 'ar_cut') {
    (holePoints || []).forEach((p, i) => {
      const flag = createFlagMarker({
        baseColor: 0x5aa7ff,
        ringColor: 0x5aa7ff,
        poleColor: 0xffffff,
        withRing: i === 0,
      });
      flag.name = 'holeFlagMarker';
      flag.position.copy(p);
      pointsGroup.add(flag);
    });
  }

  return rebuildThickLine({ anchorGroup, line, points, floorY, closed, disposeObject3D });
}

export function rebuildFillMesh({ anchorGroup, fillMesh, state, tileMaterial, maskMaterial }) {
  if (fillMesh) {
    anchorGroup.remove(fillMesh);
    fillMesh.geometry.dispose();
    fillMesh = null;
  }

  const isClosed = state.closed && state.points.length >= 3;
  if (!isClosed) return null;

  const pts2 = state.points.map(p => new THREE.Vector2(p.x, -p.z));
  const shape = new THREE.Shape(pts2);

  for (const hole of state.holes) {
    if (hole.length < 3) continue;
    const hp2 = hole.map(p => new THREE.Vector2(p.x, -p.z));
    const path = new THREE.Path(hp2);
    shape.holes.push(path);
  }

  const geom = new THREE.ShapeGeometry(shape, 1);
  geom.rotateX(-Math.PI / 2);

  fillMesh = new THREE.Mesh(geom, tileMaterial || maskMaterial);
  fillMesh.position.y = state.floorY + 0.003;
  fillMesh.renderOrder = 10;
  anchorGroup.add(fillMesh);
  return fillMesh;
}

export function clearMeasureLabels(measureEls, measureLayer) {
  measureEls.splice(0, measureEls.length);
  if (measureLayer) measureLayer.innerHTML = '';
}

export function ensureMeasureEl(i, measureEls, measureLayer) {
  if (!measureLayer) return null;
  if (measureEls[i]) return measureEls[i];
  const el = document.createElement('div');
  el.className = 'measureLabel';
  measureLayer.appendChild(el);
  measureEls[i] = el;
  return el;
}

export function updateMeasureLabels({ state, measureEls, measureLayer, floorY, anchorGroup, xrCam, fmtMeters }) {
  if (state.phase === 'ar_final' || !state.floorLocked) {
    clearMeasureLabels(measureEls, measureLayer);
    return;
  }

  const pts = state.points;
  if (pts.length < 2) {
    clearMeasureLabels(measureEls, measureLayer);
    return;
  }

  const segCount = state.closed ? pts.length : (pts.length - 1);
  for (let i = segCount; i < measureEls.length; i++) measureEls[i]?.remove();
  measureEls.length = segCount;

  const w = window.innerWidth;
  const h = window.innerHeight;

  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = distXZ(a, b);

    const mid = new THREE.Vector3((a.x + b.x) / 2, floorY + 0.02, (a.z + b.z) / 2);
    const midW = anchorGroup.localToWorld(mid.clone());

    const v = midW.clone().project(xrCam);
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;

    const el = ensureMeasureEl(i, measureEls, measureLayer);
    if (!el) continue;

    const visible = v.z >= -1 && v.z <= 1;
    el.style.display = visible ? 'block' : 'none';
    el.textContent = fmtMeters(d);
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }
}

export function updateAreaUI({ UI, state, computeAreaM2, fmtArea }) {
  if (!UI.arArea) return;

  const areaText = (state.points.length >= 3) ? fmtArea(computeAreaM2()) : '—';
  if (state.phase === 'ar_final') {
    if (UI.arProductTitle) UI.arProductTitle.textContent = `Площадь: ${areaText}`;
    UI.arArea.textContent = '';
    return;
  }

  if (UI.arProductTitle && state.selectedTile) UI.arProductTitle.textContent = state.selectedTile.name;
  UI.arArea.textContent = state.closed ? fmtArea(computeAreaM2()) : areaText;
}
