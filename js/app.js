import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadTiles, clamp, downloadJsonFile, nowIso, uid } from './utils.js';

const UI = {
  statusText: document.getElementById('statusText'),
  btnStartAR: document.getElementById('btnStartAR'),
  btnExitAR: document.getElementById('btnExitAR'),
  btnCalibrate: document.getElementById('btnCalibrate'),
  btnAddPoint: document.getElementById('btnAddPoint'),
  btnUndo: document.getElementById('btnUndo'),
  btnClose: document.getElementById('btnClose'),
  btnClear: document.getElementById('btnClear'),
  btnScreenshot: document.getElementById('btnScreenshot'),
  btnSaveProject: document.getElementById('btnSaveProject'),
  btnProjects: document.getElementById('btnProjects'),
  btnCloseProjects: document.getElementById('btnCloseProjects'),
  projectsModal: document.getElementById('projectsModal'),
  projectsList: document.getElementById('projectsList'),

  catalogDrawer: document.getElementById('catalogDrawer'),
  btnToggleCatalog: document.getElementById('btnToggleCatalog'),
  catalogList: document.getElementById('catalogList'),
  catalogSearch: document.getElementById('catalogSearch'),

  fallbackPanel: document.getElementById('fallbackPanel'),
  btnShowHelp: document.getElementById('btnShowHelp'),
  help: document.getElementById('help'),

  selectedTileChip: document.getElementById('selectedTileChip'),
  tileSizeChip: document.getElementById('tileSizeChip'),

  layoutSelect: document.getElementById('layoutSelect'),
  layoutWrap: document.getElementById('layoutWrap'),

  toggleOcclusionWrap: document.getElementById('toggleOcclusionWrap'),
  toggleOcclusion: document.getElementById('toggleOcclusion'),

  borderWrap: document.getElementById('borderWrap'),
  toggleBorder: document.getElementById('toggleBorder'),
  borderWidth: document.getElementById('borderWidth'),
  borderWidthLabel: document.getElementById('borderWidthLabel'),
};

const canvas = document.getElementById('xrCanvas');

// ------------------------
// Состояние приложения
// ------------------------
const state = {
  xrSupported: false,
  xrSession: null,
  referenceSpace: null,
  viewerSpace: null,
  hitTestSource: null,
  anchorsSupported: false,
  anchor: null,

  depthSupported: false,
  depthInfoSize: null,
  depthTexture: null,
  depthData: null,
  occlusionEnabled: false,

  floorLocked: false,
  floorY: 0,
  reticleVisible: false,

  points: /** @type {THREE.Vector3[]} */([]),
  closed: false,

  selectedTile: null,
  layout: 'straight',

  borderEnabled: false,
  borderWidth: 0.08,
};

// ------------------------
// Three.js сцена
// ------------------------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true, // для скриншота
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.2, 2.2);

const hemi = new THREE.HemisphereLight(0xffffff, 0x202030, 1.0);
scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(1, 3, 2);
scene.add(dirLight);

const world = new THREE.Group();
scene.add(world);

const anchorGroup = new THREE.Group();
world.add(anchorGroup);

// reticle
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.085, 40, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x2f6cff, transparent: true, opacity: 0.9 })
);
reticle.visible = false;
world.add(reticle);

// Preview plane (3D режим без AR)
const previewPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 3, 1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x666666 })
);
previewPlane.position.set(0, 0, 0);
world.add(previewPlane);

const previewGrid = new THREE.GridHelper(3, 12, 0x3a6cff, 0x666666);
previewGrid.position.y = 0.0005;
world.add(previewGrid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 0.6;
controls.maxDistance = 6;

// Полигональная линия и меш
let pointsGroup = new THREE.Group();
anchorGroup.add(pointsGroup);

let line = null;
let fillMesh = null;
let borderGroup = null;

// Материал заливки (shader)
let tileMaterial = null;

// ------------------------
// Shader Material для плитки с раскладкой + (опционально) окклюзией
// ------------------------
function makeTileMaterial(texture) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTex: { value: texture },
      uTileSize: { value: new THREE.Vector2(0.2, 0.2) },
      uLayoutMode: { value: 0 }, // 0 straight, 1 diagonal, 2 stagger
      uLightDir: { value: new THREE.Vector3(1, 2, 1).normalize() },
      uAmbient: { value: 0.35 },
      uUseOcclusion: { value: 0 },
      uDepthTex: { value: null },
      uDepthValid: { value: 0 },
      uOcclusionEps: { value: 0.02 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewPos;
      varying vec4 vClipPos;

      uniform vec2 uTileSize;
      uniform int uLayoutMode;

      mat2 rot(float a){
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
      }

      void main(){
        vec3 pos = position;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vViewPos = mv.xyz;
        vClipPos = projectionMatrix * mv;

        // world normal
        vNormalW = normalize((modelMatrix * vec4(normal,0.0)).xyz);

        // uv из координат XZ (плоскость пола)
        vec2 uv = vec2(pos.x / uTileSize.x, pos.z / uTileSize.y);

        if (uLayoutMode == 1) {
          uv = rot(0.78539816339) * uv; // 45°
        } else if (uLayoutMode == 2) {
          // вразбежку: каждый второй "ряд" сдвиг на 0.5
          float row = floor(uv.y);
          uv.x += 0.5 * mod(row, 2.0);
        }

        vUv = uv;
        gl_Position = vClipPos;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewPos;
      varying vec4 vClipPos;

      uniform sampler2D uTex;
      uniform vec3 uLightDir;
      uniform float uAmbient;

      uniform int uUseOcclusion;
      uniform sampler2D uDepthTex;
      uniform int uDepthValid;
      uniform float uOcclusionEps;

      vec2 safeFract(vec2 v){ return v - floor(v); }

      void main(){
        // depth-based occlusion (best-effort)
        if (uUseOcclusion == 1 && uDepthValid == 1) {
          vec3 ndc = (vClipPos.xyz / vClipPos.w);
          vec2 suv = ndc.xy * 0.5 + 0.5;
          if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
            float sceneDepth = texture2D(uDepthTex, suv).r;
            float fragDist = length(vViewPos);
            if (sceneDepth > 0.0 && sceneDepth < (fragDist - uOcclusionEps)) {
              discard;
            }
          }
        }

        vec3 albedo = texture2D(uTex, safeFract(vUv)).rgb;

        vec3 N = normalize(vNormalW);
        vec3 L = normalize(uLightDir);
        float diff = max(dot(N, L), 0.0);
        float light = uAmbient + (1.0 - uAmbient) * diff;

        vec3 color = albedo * light;
        gl_FragColor = vec4(color, 0.98);
      }
    `,
  });
  return mat;
}

// ------------------------
// Input helpers (tap-to-place)
// ------------------------
function isEventOnUI(target){
  if(!target || !target.closest) return false;
  return !!target.closest('.topbar, .leftDrawer, .tools, .modal, .toast, .bottombar, .fallback');
}
function distXZ(a,b){
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}


function setStatus(text) {
  UI.statusText.textContent = text;
}

function setChips() {
  if (state.selectedTile) {
    UI.selectedTileChip.textContent = `Плитка: ${state.selectedTile.name}`;
    const s = state.selectedTile.tileSizeM;
    UI.tileSizeChip.textContent = `Размер: ${s.w.toFixed(2)}×${s.h.toFixed(2)} м`;
  } else {
    UI.selectedTileChip.textContent = `Плитка: —`;
    UI.tileSizeChip.textContent = `Размер: —`;
  }
}

function show(el, on = true) {
  el.classList.toggle('hidden', !on);
}

function updateUIVisibility() {
  const inAR = !!state.xrSession;
  show(UI.btnStartAR, !inAR);
  show(UI.btnExitAR, inAR);

  // инструменты доступны только в AR
  const tools = [
    UI.btnCalibrate, UI.btnAddPoint, UI.btnUndo, UI.btnClose, UI.btnClear,
    UI.btnScreenshot, UI.btnSaveProject, UI.btnProjects,
    UI.layoutWrap, UI.borderWrap
  ];
  tools.forEach(el => show(el, inAR));

  // Окклюзия: показываем переключатель всегда (как настройку),
  // но фактически работает только если AR-сессия запрошена с depth-sensing.
  show(UI.toggleOcclusionWrap, true);
  if (UI.toggleOcclusion) {
    // во время AR не даём менять (для изменения нужна перезагрузка сессии)
    UI.toggleOcclusion.disabled = inAR;
  }

  // панель подсказки/фоллбек
  show(UI.fallbackPanel, !inAR);

  // show help button always in fallback
}

function updateBorderLabel() {
  UI.borderWidthLabel.textContent = `${state.borderWidth.toFixed(2)}м`;
}

// ------------------------
// Каталог
// ------------------------
let catalogData = await loadTiles();
let tiles = catalogData.tiles ?? [];
state.selectedTile = tiles[0] ?? null;
setChips();

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

async function getTexture(url) {
  if (textureCache.has(url)) return textureCache.get(url);
  const tex = await new Promise((resolve, reject) => {
    textureLoader.load(url, resolve, undefined, reject);
  });
  textureCache.set(url, tex);
  return tex;
}

function renderCatalog(list) {
  UI.catalogList.innerHTML = '';
  list.forEach(t => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="card__img" src="${t.preview}" alt="${escapeHtml(t.name)}" />
      <div class="card__body">
        <div class="card__title">${escapeHtml(t.name)}</div>
        <div class="card__meta">${t.tileSizeM.w.toFixed(2)}×${t.tileSizeM.h.toFixed(2)} м</div>
      </div>
    `;
    card.addEventListener('click', () => selectTile(t.id));
    UI.catalogList.appendChild(card);
  });
}

async function selectTile(id) {
  const t = tiles.find(x => x.id === id);
  if (!t) return;
  state.selectedTile = t;
  setChips();
  setStatus('Загрузка текстуры…');
  const tex = await getTexture(t.texture);

  if (!tileMaterial) {
    tileMaterial = makeTileMaterial(tex);
  } else {
    tileMaterial.uniforms.uTex.value = tex;
  }
  tileMaterial.uniforms.uTileSize.value.set(t.tileSizeM.w, t.tileSizeM.h);

  // preview plane
  previewPlane.material.map = tex;
  previewPlane.material.needsUpdate = true;
  previewPlane.material.map.repeat.set(3 / t.tileSizeM.w, 3 / t.tileSizeM.h);

  // если есть заливка — обновим материал/uv
  if (fillMesh) fillMesh.material = tileMaterial;

  setStatus('Готово');
}

renderCatalog(tiles);
await selectTile(state.selectedTile?.id ?? 1);

UI.catalogSearch.addEventListener('input', () => {
  const q = UI.catalogSearch.value.trim().toLowerCase();
  if (!q) renderCatalog(tiles);
  else renderCatalog(tiles.filter(t => t.name.toLowerCase().includes(q)));
});

UI.btnToggleCatalog.addEventListener('click', () => {
  const hidden = UI.catalogDrawer.style.display === 'none';
  UI.catalogDrawer.style.display = hidden ? 'flex' : 'none';
  UI.btnToggleCatalog.textContent = hidden ? 'Скрыть' : 'Показать';
});

// ------------------------
// XR helpers
// ------------------------
async function checkXrSupport() {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

async function startAR() {
  if (!navigator.xr) {
    alert('WebXR недоступен в этом браузере. Откройте проект в Chrome на Android.');
    return;
  }

  const supported = await checkXrSupport();
  if (!supported) {
    alert('Этот браузер/устройство не поддерживает immersive-ar. Нужен Chrome на Android с ARCore.');
    return;
  }

  // depth-sensing (окклюзия) в WebXR работает нестабильно в некоторых комбинациях Chrome/Android.
  // В three.js была известная проблема с getDepthInformation()==null в версиях >= r161,
  // исправленная в более новых релизах. Поэтому:
  // 1) включаем запрос depth-sensing ТОЛЬКО если пользователь явно включил тумблер
  // 2) и если XRWebGLBinding вообще существует в браузере.
  const wantsDepth = !!UI.toggleOcclusion?.checked;
  try { localStorage.setItem('occlusionWanted', wantsDepth ? '1' : '0'); } catch (_) {}
  const canRequestDepth = wantsDepth && (typeof XRWebGLBinding !== 'undefined');

const sessionInit = {
  requiredFeatures: ['hit-test', 'dom-overlay'],
  optionalFeatures: [
    'anchors',
    ...(canRequestDepth ? ['depth-sensing'] : []),
  ],
  domOverlay: { root: document.getElementById('overlay') },
  ...(canRequestDepth ? {
    depthSensing: {
      usagePreference: ['cpu-optimized', 'gpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
  } : {}),
};

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', sessionInit);
  } catch (e) {
    console.error(e);
    alert('Не удалось запустить AR-сессию. Проверьте разрешения камеры и поддержку ARCore.');
    return;
  }

  state.xrSession = session;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  // ref spaces
  state.referenceSpace = await session.requestReferenceSpace('local');
  state.viewerSpace = await session.requestReferenceSpace('viewer');

  // hit test
  state.hitTestSource = await session.requestHitTestSource({ space: state.viewerSpace });

  // anchors
  state.anchorsSupported = sessionInit.optionalFeatures.includes('anchors');
  // фактическую поддержку проверим через наличие requestAnchor
  state.anchorsSupported = typeof session.requestAnchor === 'function';

  // depth-sensing / окклюзия: считаем поддержанной только если сессия реально включила feature.
  // Важно: даже при наличии enabledFeatures, getDepthInformation() может возвращать null — это обработаем в кадре.
  state.depthSupported = false;
  state.occlusionEnabled = false;
  try {
    const enabled = session.enabledFeatures ? Array.from(session.enabledFeatures) : [];
    state.depthSupported = enabled.includes('depth-sensing');
  } catch (_) {
    state.depthSupported = false;
  }
  // Включаем окклюзию только если пользователь хотел и feature реально включилась.
  state.occlusionEnabled = wantsDepth && state.depthSupported;
  if (UI.toggleOcclusion) {
    UI.toggleOcclusion.checked = wantsDepth;
    // во время AR блокируем (изменение требует перезапуска сессии)
    UI.toggleOcclusion.disabled = true;
  }

  if (tileMaterial) tileMaterial.uniforms.uUseOcclusion.value = state.occlusionEnabled ? 1 : 0;

  resetSceneForAR();

  // В AR по умолчанию прячем каталог, чтобы он не перекрывал камеру.
  UI.catalogDrawer.style.display = 'none';
  UI.btnToggleCatalog.textContent = 'Показать';


  setStatus('Сканируйте пол: наведите камеру на пол, дождитесь маркера.');
  state.floorLocked = false;
  state.points = [];
  state.closed = false;

  show(UI.help, false);
  updateUIVisibility();

  session.addEventListener('end', () => endAR(false));

  // показать кнопку фиксации пола
  show(UI.btnCalibrate, true);
  show(UI.btnAddPoint, true);
  show(UI.btnUndo, true);
  show(UI.btnClose, true);
  show(UI.btnClear, true);
  show(UI.btnScreenshot, true);
  show(UI.btnSaveProject, true);
  show(UI.btnProjects, true);
  show(UI.layoutWrap, true);
  show(UI.borderWrap, true);

  state.reticleVisible = false;
}

function endAR(userInitiated = true) {
  const session = state.xrSession;
  state.xrSession = null;
  state.referenceSpace = null;
  state.viewerSpace = null;
  state.hitTestSource = null;
  state.anchor = null;
  state.floorLocked = false;
  reticle.visible = false;
  state.reticleVisible = false;

  if (session && userInitiated) session.end().catch(() => {});
  renderer.xr.setSession(null);

  setStatus('AR завершён');
  updateUIVisibility();

  // восстановим preview режим
  controls.enabled = true;
  previewPlane.visible = true;
  previewGrid.visible = true;

  // после выхода из AR снова разрешаем менять настройку окклюзии
  if (UI.toggleOcclusion) UI.toggleOcclusion.disabled = false;
}

function resetSceneForAR() {
  // AR: выключаем орбит-контролы, preview-плоскость
  controls.enabled = false;
  previewPlane.visible = false;
  previewGrid.visible = false;

  // очистить разметку
  clearAll();
}

UI.btnStartAR.addEventListener('click', startAR);
UI.btnExitAR.addEventListener('click', () => endAR(true));

// ------------------------
// Пол: фиксация, точки, контур
// ------------------------
function calibrateFloor() {
  if (!state.reticleVisible) {
    alert('Сначала наведите камеру на пол и дождитесь маркера.');
    return;
  }
  state.floorY = reticle.position.y;
  state.floorLocked = true;

  // Попытка создать anchor
  if (state.xrSession && state.anchorsSupported) {
    const frame = renderer.xr.getFrame();
    const refSpace = state.referenceSpace;
    if (frame && refSpace) {
      const pose = frame.getPose(reticle.userData.xrSpace, refSpace);
      // В three.js мы не имеем xrSpace напрямую. Поэтому best-effort:
      // создаём "якорь" как просто позицию в мире (без API anchor), если API неудобно.
    }
  }

  setStatus('Пол зафиксирован. Ставьте точки на полу.');
}

UI.btnCalibrate.addEventListener('click', calibrateFloor);

function addPointFromReticle() {
  if (!state.floorLocked) {
    alert('Сначала нажмите «Зафиксировать пол».');
    return;
  }
  if (!state.xrSession) return;
  if (!state.reticleVisible || !reticle.visible) return;

  // Берём позицию reticle (hit-test) и принудительно кладём на плоскость пола.
  const hitWorld = reticle.position.clone();
  hitWorld.y = state.floorY;

  // Переводим в локальные координаты anchorGroup
  const local = anchorGroup.worldToLocal(hitWorld);

  // защита от дублей (слишком близко)
  if (state.points.length) {
    const d = distXZ(state.points[state.points.length - 1], local);
    if (d < 0.04) return; // < 4 см
  }

  state.points.push(local);
  state.closed = false;
  rebuildMarkersAndLine();
  rebuildFill();

  setStatus(`Точка добавлена: ${state.points.length}`);

  if (state.points.length >= 3) {
    UI.btnClose.classList.remove('hidden');
  }
}

UI.btnAddPoint.addEventListener('click', addPointFromReticle);

// Добавление точки тапом по экрану (в AR), если пользователь нажимает НЕ по элементам UI
window.addEventListener('pointerup', (e) => {
  if (!state.xrSession) return;
  if (isEventOnUI(e.target)) return;
  addPointFromReticle();
});


function undoPoint() {
  if (!state.points.length) return;
  state.points.pop();
  state.closed = false;
  rebuildMarkersAndLine();
  rebuildFill();
}

UI.btnUndo.addEventListener('click', undoPoint);

function closeContour() {
  if (state.points.length < 3) {
    alert('Нужно минимум 3 точки.');
    return;
  }
  state.closed = true;
  rebuildMarkersAndLine(true);
  rebuildFill();
  setStatus('Контур замкнут. Плитка применена.');
}

UI.btnClose.addEventListener('click', closeContour);

function clearAll() {
  state.points = [];
  state.closed = false;
  if (line) { anchorGroup.remove(line); line.geometry.dispose(); line.material.dispose(); line = null; }
  if (fillMesh) { anchorGroup.remove(fillMesh); fillMesh.geometry.dispose(); /* material is shared */ fillMesh = null; }
  if (borderGroup) { anchorGroup.remove(borderGroup); borderGroup.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); borderGroup = null; }

  pointsGroup.clear();
}

UI.btnClear.addEventListener('click', () => { clearAll(); setStatus('Очищено'); });

// markers + line
function rebuildMarkersAndLine(closed = false) {
  pointsGroup.clear();

  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const markerGeo = new THREE.SphereGeometry(0.018, 18, 12);

  state.points.forEach((p, i) => {
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.position.copy(p);
    m.position.y += 0.002;
    pointsGroup.add(m);

    // подпись первой точки
    if (i === 0) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.03, 0.042, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x2f6cff, transparent: true, opacity: 0.85 })
      );
      ring.position.copy(p);
      ring.position.y += 0.001;
      pointsGroup.add(ring);
    }
  });

  // линия
  if (line) { anchorGroup.remove(line); line.geometry.dispose(); line.material.dispose(); line = null; }
  if (state.points.length >= 2) {
    const pts = state.points.slice();
    if (closed) pts.push(state.points[0].clone());
    const geom = new THREE.BufferGeometry().setFromPoints(pts.map(v => new THREE.Vector3(v.x, v.y + 0.001, v.z)));
    const mat = new THREE.LineBasicMaterial({ color: 0x9bb8ff, transparent: true, opacity: 0.9 });
    line = new THREE.Line(geom, mat);
    anchorGroup.add(line);
  }
}

// fill mesh
function rebuildFill() {
  if (fillMesh) { anchorGroup.remove(fillMesh); fillMesh.geometry.dispose(); fillMesh = null; }
  if (!state.closed || state.points.length < 3) {
    rebuildBorder();
    return;
  }
  const pts2 = state.points.map(p => new THREE.Vector2(p.x, p.z));
  const shape = new THREE.Shape(pts2);
  const geom = new THREE.ShapeGeometry(shape, 1);
  geom.rotateX(-Math.PI / 2);

  // чуть приподнимем, чтобы не z-fight (и положим на уровень пола)
  const baseY = state.points.reduce((s,p)=>s+p.y,0) / state.points.length;
  geom.translate(0, baseY + 0.002, 0);

  if (!tileMaterial) {
    // fallback material (shouldn't happen)
    tileMaterial = makeTileMaterial(new THREE.Texture());
  }
  fillMesh = new THREE.Mesh(geom, tileMaterial);
  fillMesh.renderOrder = 2;
  anchorGroup.add(fillMesh);

  rebuildBorder();
}

function rebuildBorder() {
  if (borderGroup) {
    anchorGroup.remove(borderGroup);
    borderGroup.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    borderGroup = null;
  }
  if (!state.borderEnabled || !state.closed || state.points.length < 3) return;

  borderGroup = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x20252f, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.95 });
  const h = 0.008;

  const pts = state.points;
  const baseY = pts.reduce((s,p)=>s+p.y,0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.02) continue;

    const geo = new THREE.BoxGeometry(len, h, state.borderWidth);
    const m = new THREE.Mesh(geo, mat);
    const mid = new THREE.Vector3((a.x + b.x) / 2, baseY + 0.006, (a.z + b.z) / 2);
    m.position.copy(mid);

    const ang = Math.atan2(dz, dx);
    m.rotation.y = -ang;
    borderGroup.add(m);
  }

  anchorGroup.add(borderGroup);
}

// Layout, border controls
UI.layoutSelect.addEventListener('change', () => {
  state.layout = UI.layoutSelect.value;
  if (tileMaterial) tileMaterial.uniforms.uLayoutMode.value = state.layout === 'straight' ? 0 : (state.layout === 'diagonal' ? 1 : 2);
});

UI.toggleBorder.addEventListener('change', () => {
  state.borderEnabled = UI.toggleBorder.checked;
  rebuildBorder();
});

UI.borderWidth.addEventListener('input', () => {
  state.borderWidth = clamp(parseFloat(UI.borderWidth.value), 0.01, 0.4);
  updateBorderLabel();
  rebuildBorder();
});
updateBorderLabel();

// Screenshot
UI.btnScreenshot.addEventListener('click', () => {
  try {
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const w = window.open();
    if (w) w.document.write(`<img style="width:100%" src="${dataUrl}" />`);
  } catch (e) {
    alert('Не удалось сделать скриншот.');
  }
});

// Help
UI.btnShowHelp.addEventListener('click', () => {
  show(UI.help, !UI.help.classList.contains('hidden'));
});

// ------------------------
// Проекты (localStorage)
// ------------------------
const LS_KEY = 'webar_tile_projects_v1';

function loadProjects() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveProjects(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

function saveCurrentProject() {
  if (!state.closed || state.points.length < 3 || !state.selectedTile) {
    alert('Сначала замкните контур (минимум 3 точки).');
    return;
  }
  const name = prompt('Название проекта:', `Проект ${new Date().toLocaleString('ru-RU')}`) || '';
  const projects = loadProjects();
  projects.unshift({
    id: uid(),
    name: name.trim() || 'Без названия',
    createdAt: nowIso(),
    tileId: state.selectedTile.id,
    layout: state.layout,
    borderEnabled: state.borderEnabled,
    borderWidth: state.borderWidth,
    floorY: state.floorY,
    points: state.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
  });
  saveProjects(projects.slice(0, 30));
  setStatus('Проект сохранён');
}

UI.btnSaveProject.addEventListener('click', saveCurrentProject);

function openProjectsModal() {
  renderProjectsList();
  show(UI.projectsModal, true);
}
function closeProjectsModal() {
  show(UI.projectsModal, false);
}
UI.btnProjects.addEventListener('click', openProjectsModal);
UI.btnCloseProjects.addEventListener('click', closeProjectsModal);

function renderProjectsList() {
  const projects = loadProjects();
  UI.projectsList.innerHTML = '';
  if (!projects.length) {
    UI.projectsList.innerHTML = `<div class="muted">Пока нет сохранённых проектов.</div>`;
    return;
  }
  projects.forEach(p => {
    const row = document.createElement('div');
    row.className = 'projectRow';
    row.innerHTML = `
      <div>
        <div class="projectRow__name">${escapeHtml(p.name)}</div>
        <div class="projectRow__meta">${new Date(p.createdAt).toLocaleString('ru-RU')} • плитка #${p.tileId}</div>
      </div>
      <div class="projectRow__actions">
        <button class="btn btn-primary">Загрузить</button>
        <button class="btn">Удалить</button>
      </div>
    `;
    const [btnLoad, btnDel] = row.querySelectorAll('button');
    btnLoad.addEventListener('click', async () => {
      await applyProject(p);
      closeProjectsModal();
    });
    btnDel.addEventListener('click', () => {
      if (!confirm('Удалить проект?')) return;
      const next = loadProjects().filter(x => x.id !== p.id);
      saveProjects(next);
      renderProjectsList();
    });
    UI.projectsList.appendChild(row);
  });
}

async function applyProject(p) {
  // применяем настройки
  state.layout = p.layout || 'straight';
  UI.layoutSelect.value = state.layout;
  if (tileMaterial) tileMaterial.uniforms.uLayoutMode.value = state.layout === 'straight' ? 0 : (state.layout === 'diagonal' ? 1 : 2);

  state.borderEnabled = !!p.borderEnabled;
  UI.toggleBorder.checked = state.borderEnabled;

  state.borderWidth = clamp(parseFloat(p.borderWidth), 0.01, 0.4);
  UI.borderWidth.value = String(state.borderWidth);
  updateBorderLabel();

  const tile = tiles.find(t => t.id === p.tileId);
  if (tile) await selectTile(tile.id);

  // точки
  state.points = (p.points || []).map(q => new THREE.Vector3(q.x, q.y, q.z));
  state.closed = true;
  state.floorY = typeof p.floorY === 'number' ? p.floorY : state.floorY;
  state.floorLocked = true;

  rebuildMarkersAndLine(true);
  rebuildFill();
  setStatus('Проект загружен');
}

// ------------------------
// Render loop
// ------------------------
renderer.setAnimationLoop((t, frame) => {
  if (state.xrSession && frame) {
    updateXR(frame);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

const __tmpUp = new THREE.Vector3();

function updateXR(frame) {
  // hit test (центр экрана)
  let gotHit = false;
  if (state.hitTestSource && state.referenceSpace) {
    const hits = frame.getHitTestResults(state.hitTestSource);
    if (hits.length) {
      const pose = hits[0].getPose(state.referenceSpace);
      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        reticle.matrix.decompose(reticle.position, reticle.quaternion, reticle.scale);
        // Фильтр: ретикл должен быть на полу (горизонтальная поверхность), иначе игнорируем (стены/мебель)
        __tmpUp.set(0, 1, 0).applyQuaternion(reticle.quaternion);
        if (__tmpUp.y < 0.75) {
          reticle.visible = false;
          gotHit = false;
        } else {
          // Если пол зафиксирован — принудительно кладём маркер на плоскость пола
          if (state.floorLocked) reticle.position.y = state.floorY;
          gotHit = true;
        }
      }
    }
  }
  state.reticleVisible = gotHit;
  if (!gotHit) {
    reticle.visible = false;
  }

  // depth (best-effort) — только если сессия запущена с depth-sensing.
  if (state.xrSession && state.depthSupported) {
    const xrCam = renderer.xr.getCamera(camera);
    const views = frame.getViewerPose(state.referenceSpace)?.views;
    if (views && views.length) {
      try {
        const depthInfo = frame.getDepthInformation?.(views[0]);
        if (depthInfo && depthInfo.width && depthInfo.height) {
          // getDepthInformation может иногда вернуться null даже при включённом feature.
          // Если сюда попали — глубина действительно доступна в этом кадре.

          const w = depthInfo.width, h = depthInfo.height;
          const key = `${w}x${h}`;
          if (!state.depthInfoSize || state.depthInfoSize !== key) {
            state.depthInfoSize = key;
            state.depthData = new Float32Array(w * h);
            state.depthTexture = new THREE.DataTexture(state.depthData, w, h, THREE.RedFormat, THREE.FloatType);
            state.depthTexture.needsUpdate = true;
            state.depthTexture.magFilter = THREE.NearestFilter;
            state.depthTexture.minFilter = THREE.NearestFilter;
            if (tileMaterial) {
              tileMaterial.uniforms.uDepthTex.value = state.depthTexture;
              tileMaterial.uniforms.uDepthValid.value = 1;
            }
            show(UI.toggleOcclusionWrap, true);
          }

          // заполнение depthData: читаем raw buffer если доступен
          const raw = depthInfo.data;
          const scale = depthInfo.rawValueToMeters || 1.0;

          // luminance-alpha как Uint16
          if (raw && state.depthData) {
            const u16 = new Uint16Array(raw);
            const n = Math.min(u16.length, state.depthData.length);
            for (let i = 0; i < n; i++) state.depthData[i] = u16[i] * scale;
            state.depthTexture.needsUpdate = true;
          }

          if (tileMaterial) {
            tileMaterial.uniforms.uUseOcclusion.value = state.occlusionEnabled ? 1 : 0;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // UI hints
  if (!state.floorLocked) {
    if (state.reticleVisible) setStatus('Маркер найден. Нажмите «Зафиксировать пол».');
  }
}

// occlusion toggle
UI.toggleOcclusion.addEventListener('change', () => {
  const want = !!UI.toggleOcclusion.checked;
  // Запоминаем настройку на следующий запуск AR.
  try { localStorage.setItem('occlusionWanted', want ? '1' : '0'); } catch (_) {}

  // Во время AR переключатель заблокирован (изменение требует перезапуска сессии),
  // но в preview обновим состояние/шейдер.
  if (!state.xrSession) {
    state.occlusionEnabled = want && state.depthSupported;
    if (tileMaterial) tileMaterial.uniforms.uUseOcclusion.value = state.occlusionEnabled ? 1 : 0;
  }
});

// Resize
window.addEventListener('resize', () => {
  // Во время XR-сессии размер управляется WebXR. Менять size нельзя.
  // Некоторые браузеры могут бросать resize ещё до того, как isPresenting станет true,
  // поэтому дополнительно проверяем наличие активной сессии.
  if (state.xrSession) return;
  if (renderer.xr && renderer.xr.isPresenting) return;

  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// Initial UI
(async function init() {
  // Настройка окклюзии запоминается. ВАЖНО: глубина/окклюзия в WebXR всё ещё нестабильны
  // на разных версиях Chrome/Android, поэтому по умолчанию выключена.
  try {
    const want = localStorage.getItem('occlusionWanted') === '1';
    if (UI.toggleOcclusion) UI.toggleOcclusion.checked = want;
  } catch (_) {}

  state.xrSupported = await checkXrSupport();
  updateUIVisibility();
  setStatus(state.xrSupported ? 'Готово. Можно запускать AR.' : 'AR недоступен: нужен Chrome на Android.');
})();

function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}
