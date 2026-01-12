/* Admin (Step 3 start) — shapes list + shape details (read-only palette), router scaffold */
(() => {
  const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'admin_jwt';

  // In GitHub Pages the admin lives under /<repo>/admin/, while site assets are under /<repo>/assets/.
  // Resolve any relative asset paths (e.g. "assets/forms/klassika.png") against the site root ("/<repo>/").
  const SITE_BASE_URL = (() => {
    const basePath = window.location.pathname.replace(/\/admin\/.*$/, '/');
    return window.location.origin + basePath;
  })();

  function resolveSiteUrl(u) {
    if (!u) return '';
    try {
      return new URL(u, SITE_BASE_URL).toString();
    } catch {
      return u;
    }
  }

  const $ = (id) => document.getElementById(id);

  // Auth / common
  const elLoginCard = $('loginCard');
  const elMainCard = $('mainCard');
  const elLoginUser = $('loginUser');
  const elLoginPass = $('loginPass');
  const elBtnLogin = $('btnLogin');
  const elBtnLogout = $('btnLogout');
  const elLoginStatus = $('loginStatus');
  const elStatus = $('status');
  const elReload = $('reloadBtn');

  // Views
  const elViewShapes = $('viewShapes');
  const elShapesGrid = $('shapesGrid');
  const elShapesEmpty = $('shapesEmpty');
  const elShapeSearch = $('shapeSearch');

  const elViewShape = $('viewShape');
  const elBackBtn = $('backBtn');
  const elShapeHeader = $('shapeHeader');
  const elShapeTitle = $('shapeTitle');
  const elShapeTabs = $('shapeTabs');
  const elPaneTextures = $('paneTextures');
  const elPaneUpload = $('paneUpload');
  const elPaneSettings = $('paneSettings');
  const elBtnUploadGo = $('btnUploadGo');

  // Upload UI
  const elUploadTextureId = $('uploadTextureId');
  const elUploadTextureName = $('uploadTextureName');
  const elUploadQuality = $('uploadQuality');
  const elUploadConcurrency = $('uploadConcurrency');
  const elUploadTileW = $('uploadTileW');
  const elUploadTileH = $('uploadTileH');
  const elUploadAutoAdd = $('uploadAutoAdd');
  const elUploadFiles = $('uploadFiles');
  const elUploadZip = $('uploadZip');
  const elUploadStartBtn = $('uploadStartBtn');
  const elUploadClearBtn = $('uploadClearBtn');
  const elUploadStatus = $('uploadStatus');
  const elUploadTbody = $('uploadTbody');

  // Palette settings UI
  const elSettingsStatus = $('settingsStatus');
  const elBtnSettingsReload = $('btnSettingsReload');
  const elBtnSettingsSave = $('btnSettingsSave');
  const elSettingsTileW = $('settingsTileW');
  const elSettingsTileH = $('settingsTileH');
  const elSettingsUvScale = $('settingsUvScale');
  const elSettingsExposure = $('settingsExposure');
  const elSettingsContrast = $('settingsContrast');
  const elSettingsSaturation = $('settingsSaturation');
  const elSettingsRoughness = $('settingsRoughness');
  const elSettingsSpec = $('settingsSpec');
  const elSettingsNormalScale = $('settingsNormalScale');
  const elSettingsBumpScale = $('settingsBumpScale');

  const elTexturesGrid = $('texturesGrid');
  const elEmptyTextures = $('emptyState');

  /** @type {{ shapes: any[], paletteByShapeId: Map<string, any> }} */
  const state = {
    shapes: [],
    paletteByShapeId: new Map(),
    paletteSettingsByShapeId: new Map(),
    uploadTasks: [],
  };

  function setStatus(el, type, msg) {
    if (!el) return;
    el.className = 'status ' + (type || '');
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function guessMimeByExt(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'webp') return 'image/webp';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'json') return 'application/json';
    return 'application/octet-stream';
  }

  function detectMapType(filename) {
    const n = String(filename || '').toLowerCase();
    const checks = [
      ['albedo', ['_albedo', 'albedo', 'basecolor', 'diffuse']],
      ['normal', ['_normal', 'normal']],
      ['roughness', ['_roughness', 'roughness', 'rgh']],
      ['height', ['_height', 'height', 'displacement', 'bump']],
      ['ao', ['_ao', 'ambientocclusion', 'occlusion']],
    ];
    for (const [type, keys] of checks) {
      for (const k of keys) {
        if (n.includes(k)) return type;
      }
    }
    return '';
  }

  function normalizeTextureId(v) {
    return String(v || '').trim();
  }

  function standardMapFilename(textureId, mapType, originalName) {
    const ext = String(originalName || '').split('.').pop() || 'bin';
    const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    return `${textureId}_${mapType}.${safeExt}`;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function unzipToFiles(zipFile) {
    if (!zipFile) return { files: [], meta: {} };
    if (typeof DecompressionStream !== 'function') {
      throw new Error('ZIP распаковка не поддерживается: требуется современный Chrome (DecompressionStream)');
    }
    const buf = await zipFile.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Find EOCD (end of central directory)
    const sig = 0x06054b50;
    const maxBack = Math.min(bytes.length, 22 + 65535);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= bytes.length - maxBack; i--) {
      if (i < 0) break;
      if ((bytes[i] | (bytes[i+1]<<8) | (bytes[i+2]<<16) | (bytes[i+3]<<24)) >>> 0 === sig) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Не удалось прочитать ZIP (EOCD не найден)');

    const dv = new DataView(buf);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    let ptr = cdOffset;
    const files = [];
    const meta = {};

    const CDFH = 0x02014b50;
    const LFH = 0x04034b50;
    while (ptr < cdOffset + cdSize) {
      if ((dv.getUint32(ptr, true) >>> 0) !== CDFH) break;
      const compMethod = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const uncompSize = dv.getUint32(ptr + 24, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const nameBytes = bytes.slice(ptr + 46, ptr + 46 + nameLen);
      const name = new TextDecoder().decode(nameBytes);
      ptr = ptr + 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue;

      // Parse some meta if zip has full paths
      const m = name.match(/surfaces\/([^/]+)\/([^/]+)\/(1k|2k)\//);
      if (m) {
        meta.shapeId = meta.shapeId || m[1];
        meta.textureId = meta.textureId || m[2];
        meta.quality = meta.quality || m[3];
      }

      // Local header
      if ((dv.getUint32(localOff, true) >>> 0) !== LFH) continue;
      const lfNameLen = dv.getUint16(localOff + 26, true);
      const lfExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lfNameLen + lfExtraLen;
      const compData = bytes.slice(dataStart, dataStart + compSize);

      let out;
      if (compMethod === 0) {
        out = compData;
      } else if (compMethod === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([compData]).stream().pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        out = new Uint8Array(ab);
      } else {
        // unsupported
        continue;
      }
      if (uncompSize && out.byteLength !== uncompSize) {
        // best-effort; continue
      }
      const base = name.split('/').pop();
      const file = new File([out], base, { type: guessMimeByExt(base) });
      files.push({ file, originalPath: name });
    }

    return { files, meta };
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(t) {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  async function apiFetch(path, opts = {}) {
    const url = API_BASE_URL + path;
    const headers = new Headers(opts.headers || {});
    headers.set('Accept', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');

    const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) json = await res.json().catch(() => null);
    else {
      const text = await res.text().catch(() => '');
      json = text ? { message: text } : null;
    }
    if (!res.ok) {
      const msg = json?.message || json?.error || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json;
  }

  function showLoggedInUI(isLoggedIn) {
    elLoginCard.hidden = !!isLoggedIn;
    elMainCard.hidden = !isLoggedIn;
  }

  async function login(username, password) {
    setStatus(elLoginStatus, '', `Подключение к API: ${API_BASE_URL} ...`);
    const json = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!json?.token) throw new Error('Не получили token от backend');
    setToken(json.token);
  }

  function parseRoute() {
    const h = (location.hash || '').replace(/^#/, '');
    const parts = h.split('/').filter(Boolean);
    // Supported:
    //  - #/forms
    //  - #/shape/<id>/<tab>
    if (parts.length === 0) return { name: 'forms' };
    if (parts[0] === 'forms') return { name: 'forms' };
    if (parts[0] === 'shape') {
      return {
        name: 'shape',
        id: parts[1] || '',
        tab: parts[2] || 'textures',
      };
    }
    return { name: 'forms' };
  }

  function setActiveTab(tab) {
    const panes = {
      textures: elPaneTextures,
      upload: elPaneUpload,
      settings: elPaneSettings,
    };
    for (const [k, el] of Object.entries(panes)) {
      if (!el) continue;
      el.hidden = k !== tab;
    }
    if (elShapeTabs) {
      for (const btn of elShapeTabs.querySelectorAll('.tab')) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      }
    }
  }

  function showView(name) {
    elViewShapes.hidden = name !== 'forms';
    elViewShape.hidden = name !== 'shape';
  }

  function renderShapesList(filterText = '') {
    const q = (filterText || '').trim().toLowerCase();
    const shapes = state.shapes || [];
    const filtered = !q
      ? shapes
      : shapes.filter(s => {
          const id = String(s?.id || '').toLowerCase();
          const name = String(s?.name || '').toLowerCase();
          return id.includes(q) || name.includes(q);
        });

    elShapesGrid.innerHTML = '';
    elShapesEmpty.style.display = filtered.length ? 'none' : 'block';

    const frag = document.createDocumentFragment();
    for (const sh of filtered) {
      const id = sh?.id || '';
      const name = sh?.name || id;
      const desc = sh?.description || '';
      const icon = resolveSiteUrl(sh?.icon || sh?.hero || '');

      const card = document.createElement('div');
      card.className = 'shapeCard';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="shapeThumb">
          ${icon ? `<img alt="" loading="lazy" src="${escapeHtml(icon)}" />` : ''}
        </div>
        <div class="shapeBody">
          <div class="shapeName">${escapeHtml(name)}</div>
          <div class="shapeId">${escapeHtml(id)}</div>
          <div class="shapeDesc">${escapeHtml(desc)}</div>
        </div>
      `;
      const go = () => {
        location.hash = `#/shape/${encodeURIComponent(id)}/textures`;
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      frag.appendChild(card);
    }
    elShapesGrid.appendChild(frag);
  }

  function renderShapeHeader(shape) {
    const id = shape?.id || '';
    const name = shape?.name || id;
    const hero = resolveSiteUrl(shape?.hero || shape?.icon || '');
    const desc = shape?.description || '';

    elShapeTitle.textContent = id ? `shapeId: ${id}` : '';
    elShapeHeader.innerHTML = `
      ${hero ? `<img class="shapeHero" alt="" loading="lazy" src="${escapeHtml(hero)}" />` : ''}
      <div class="shapeInfo">
        <div class="hName">${escapeHtml(name)}</div>
        <div class="hMeta">${escapeHtml(id)}</div>
        ${desc ? `<div class="hDesc">${escapeHtml(desc)}</div>` : ''}
      </div>
    `;
  }

  function renderTextures(items) {
    elTexturesGrid.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    elEmptyTextures.style.display = list.length ? 'none' : 'block';
    if (!list.length) return;

    const frag = document.createDocumentFragment();
    for (const it of list) {
      const id = it?.id || it?.textureId || '';
      const name = it?.name || id || '(без названия)';
      const previewUrl = it?.previewUrl || it?.preview || it?.maps?.albedoUrl || it?.maps?.albedo || '';

      const card = document.createElement('div');
      card.className = 'tile';
      card.innerHTML = `
        <img class="thumb" alt="" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(previewUrl)}">
        <div class="meta">
          <div class="name">${escapeHtml(name)}</div>
          <div class="id">${escapeHtml(id)}</div>
        </div>
      `;
      frag.appendChild(card);
    }
    elTexturesGrid.appendChild(frag);
  }

  async function ensureShapesLoaded() {
    if (!API_BASE_URL) throw new Error('API_BASE_URL не задан. Проверьте admin/config.js');
    setStatus(elStatus, '', 'Загружаем формы…');
    const payload = await apiFetch('/api/shapes');

    // Backwards/forwards compatible parsing:
    // - Newer backend may respond: { ok:true, shapes:[...] }
    // - Current deployed backend responds: { ok:true, data:{ shapes:[...] } }
    // - Older backend may respond: { ok:true, shapes:["klassika", ...] } or { shapeIds:[...] }
    const rawShapes =
      (Array.isArray(payload?.shapes) ? payload.shapes : null) ||
      (Array.isArray(payload?.data?.shapes) ? payload.data.shapes : null) ||
      (Array.isArray(payload?.data?.data?.shapes) ? payload.data.data.shapes : null) ||
      (Array.isArray(payload?.shapeIds) ? payload.shapeIds : null) ||
      (Array.isArray(payload?.data?.shapeIds) ? payload.data.shapeIds : null) ||
      [];

    // Normalize to objects with at least {id}
    const shapes = rawShapes
      .map((s) => {
        if (typeof s === 'string') return { id: s };
        if (s && typeof s === 'object') return s;
        return null;
      })
      .filter(Boolean);

    state.shapes = shapes;
    setStatus(elStatus, 'ok', `Загружено форм: ${shapes.length}`);
  }

  async function ensurePaletteLoaded(shapeId) {
    if (!shapeId) return null;
    if (state.paletteByShapeId.has(shapeId)) return state.paletteByShapeId.get(shapeId);
    setStatus(elStatus, '', `Загружаем палитру формы: ${shapeId} …`);
    const palette = await apiFetch('/api/palettes/' + encodeURIComponent(shapeId));
    state.paletteByShapeId.set(shapeId, palette);
    const items = Array.isArray(palette?.items) ? palette.items : [];
    if (palette?._meta?.missing) {
      setStatus(elStatus, 'warn', `Палитра для формы "${shapeId}" не найдена в бакете — возвращён пустой шаблон.`);
    } else {
      setStatus(elStatus, 'ok', `Палитра загружена: ${items.length} текстур`);
    }
    return palette;
  }

  async function ensurePaletteSettingsLoaded(shapeId, { forceReload = false } = {}) {
    if (!shapeId) return null;
    if (!forceReload && state.paletteSettingsByShapeId.has(shapeId)) return state.paletteSettingsByShapeId.get(shapeId);
    setStatus(elSettingsStatus, '', `Загружаем настройки палитры: ${shapeId} …`);
    const settings = await apiFetch('/api/palette-settings/' + encodeURIComponent(shapeId));
    state.paletteSettingsByShapeId.set(shapeId, settings);
    if (settings?._meta?.missing) {
      setStatus(elSettingsStatus, 'warn', 'Файл настроек не найден — показаны значения по умолчанию. Нажмите «Сохранить», чтобы создать файл.');
    } else {
      setStatus(elSettingsStatus, 'ok', 'Настройки загружены.');
    }
    return settings;
  }

  function clearUploadUI() {
    state.uploadTasks = [];
    if (elUploadFiles) elUploadFiles.value = '';
    if (elUploadZip) elUploadZip.value = '';
    renderUploadQueue();
    setStatus(elUploadStatus, '', '');
  }

  function renderUploadQueue() {
    if (!elUploadTbody) return;
    const tasks = state.uploadTasks || [];
    elUploadTbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const t of tasks) {
      const tr = document.createElement('tr');
      const pct = (t.totalBytes > 0) ? Math.round((t.sentBytes / t.totalBytes) * 100) : (t.status === 'done' ? 100 : 0);
      const st = t.status || 'pending';
      const stClass = st === 'done' ? 'uploadOk' : (st === 'error' ? 'uploadErr' : (st === 'uploading' ? 'uploadWarn' : ''));
      tr.innerHTML = `
        <td><span class="uploadPill">${escapeHtml(t.mapType || '?')}</span></td>
        <td>${escapeHtml(t.fileName || '')}<div class="muted mono">${escapeHtml((t.sizeMB || 0).toFixed ? t.sizeMB.toFixed(2) : '')} MB</div></td>
        <td class="mono">${escapeHtml(t.key || '')}</td>
        <td>${escapeHtml(String(pct))}%</td>
        <td><span class="${stClass}">${escapeHtml(st)}</span>${t.error ? `<div class="muted">${escapeHtml(t.error)}</div>` : ''}</td>
      `;
      frag.appendChild(tr);
    }
    elUploadTbody.appendChild(frag);
  }

  async function presignPut(key, contentType) {
    const res = await apiFetch('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({ key, contentType, expiresInSec: 900 }),
    });
    if (!res?.url) throw new Error('presign: не получили url');
    return res;
  }

  function xhrPutWithProgress(url, file, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        onProgress?.(evt.loaded, evt.total);
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`PUT failed: ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('PUT failed: network_error'));
      xhr.send(file);
    });
  }

  async function runUploadQueue(concurrency) {
    const limit = Math.max(1, Math.min(8, Number(concurrency) || 3));
    const tasks = state.uploadTasks || [];
    let idx = 0;
    let active = 0;
    let failed = 0;

    return new Promise((resolve) => {
      const next = async () => {
        while (active < limit && idx < tasks.length) {
          const t = tasks[idx++];
          active++;
          (async () => {
            try {
              t.status = 'presign';
              renderUploadQueue();
              const ct = t.contentType || guessMimeByExt(t.fileName);
              const ps = await presignPut(t.key, ct);
              t.status = 'uploading';
              renderUploadQueue();
              await xhrPutWithProgress(ps.url, t.file, ct, (sent, total) => {
                t.sentBytes = sent;
                t.totalBytes = total;
                renderUploadQueue();
              });
              t.status = 'done';
              t.sentBytes = t.totalBytes || t.file.size || 0;
            } catch (e) {
              t.status = 'error';
              t.error = e.message;
              failed++;
            } finally {
              active--;
              renderUploadQueue();
              if (idx >= tasks.length && active === 0) {
                resolve({ ok: failed === 0, failed });
              } else {
                next();
              }
            }
          })();
        }
      };
      next();
    });
  }

  function buildTasksFromFiles(shapeId, textureId, quality, files) {
    const out = [];
    const byType = new Map();
    for (const f of files) {
      const t = detectMapType(f.name);
      if (!t) continue;
      if (!byType.has(t)) byType.set(t, f);
    }
    const required = ['albedo', 'normal', 'roughness', 'height'];
    for (const t of required) {
      if (!byType.has(t)) {
        throw new Error(`Не найден обязательный файл: ${t}. Имя файла должно содержать _${t}`);
      }
    }

    for (const [mapType, file] of byType.entries()) {
      const fileName = standardMapFilename(textureId, mapType, file.name);
      const key = `surfaces/${shapeId}/${textureId}/${quality}/${fileName}`;
      out.push({
        mapType,
        file,
        fileName,
        key,
        contentType: file.type || guessMimeByExt(fileName),
        status: 'pending',
        sentBytes: 0,
        totalBytes: file.size || 0,
        sizeMB: (file.size || 0) / (1024 * 1024),
      });
    }
    // prefer deterministic order
    out.sort((a, b) => String(a.mapType).localeCompare(String(b.mapType)));
    return out;
  }

  function buildPaletteItemFromUpload(shapeId, textureId, name, quality, tasks, tileSizeMOrNull) {
    const maps = {};
    for (const t of tasks) {
      const rel = `surfaces/${shapeId}/${textureId}/${quality}/${t.fileName}`;
      maps[t.mapType] = rel;
    }
    const item = {
      id: textureId,
      name: name || textureId,
      preview: maps.albedo || '',
      maps,
      params: {},
    };
    if (tileSizeMOrNull) item.tileSizeM = tileSizeMOrNull;
    return item;
  }

  async function savePalette(shapeId, palette) {
    const res = await apiFetch('/api/palettes/' + encodeURIComponent(shapeId), {
      method: 'POST',
      body: JSON.stringify(palette),
    });
    return res;
  }

  async function upsertItemAndSavePalette(shapeId, item) {
    const palette = await ensurePaletteLoaded(shapeId);
    const items = Array.isArray(palette?.items) ? [...palette.items] : [];
    const idx = items.findIndex(x => x && x.id === item.id);
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    const next = {
      shapeId,
      items,
    };
    await savePalette(shapeId, next);
    // refresh
    state.paletteByShapeId.delete(shapeId);
    const fresh = await ensurePaletteLoaded(shapeId);
    renderTextures(Array.isArray(fresh?.items) ? fresh.items : []);
  }

  function num(v, fallback = null) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function fillPaletteSettingsForm(settings, shapeId) {
    const d = (settings && settings.defaults && typeof settings.defaults === 'object') ? settings.defaults : {};

    const tile = d.tileSizeM || {};
    const wMm = (typeof tile.w === 'number') ? Math.round(tile.w * 1000) : 115;
    const hMm = (typeof tile.h === 'number') ? Math.round(tile.h * 1000) : 115;

    elSettingsTileW.value = String(wMm);
    elSettingsTileH.value = String(hMm);
    elSettingsUvScale.value = String(typeof d.uvScale === 'number' ? d.uvScale : 1.0);
    elSettingsExposure.value = String(typeof d.exposureMult === 'number' ? d.exposureMult : 1.0);
    elSettingsContrast.value = String(typeof d.contrast === 'number' ? d.contrast : 1.0);
    elSettingsSaturation.value = String(typeof d.saturation === 'number' ? d.saturation : 1.0);
    elSettingsRoughness.value = String(typeof d.roughnessMult === 'number' ? d.roughnessMult : 1.0);
    elSettingsSpec.value = String(typeof d.specStrength === 'number' ? d.specStrength : 1.0);
    elSettingsNormalScale.value = String(typeof d.normalScale === 'number' ? d.normalScale : 1.0);
    elSettingsBumpScale.value = String(typeof d.bumpScale === 'number' ? d.bumpScale : 1.0);

    // Helpful context in title area
    if (shapeId) {
      elSettingsTileW.placeholder = '115';
      elSettingsTileH.placeholder = '115';
      elSettingsUvScale.placeholder = '1.00';
    }
  }

  function collectPaletteSettingsFromForm(shapeId) {
    const wMm = num(elSettingsTileW.value, 115);
    const hMm = num(elSettingsTileH.value, 115);
    const w = Math.max(1, wMm) / 1000;
    const h = Math.max(1, hMm) / 1000;

    return {
      shapeId,
      defaults: {
        tileSizeM: { w, h },
        uvScale: num(elSettingsUvScale.value, 1.0),
        exposureMult: num(elSettingsExposure.value, 1.0),
        contrast: num(elSettingsContrast.value, 1.0),
        saturation: num(elSettingsSaturation.value, 1.0),
        roughnessMult: num(elSettingsRoughness.value, 1.0),
        specStrength: num(elSettingsSpec.value, 1.0),
        normalScale: num(elSettingsNormalScale.value, 1.0),
        bumpScale: num(elSettingsBumpScale.value, 1.0),
      },
    };
  }

  function findShapeById(shapeId) {
    return (state.shapes || []).find(s => String(s?.id) === String(shapeId)) || null;
  }

  async function renderRoute() {
    const r = parseRoute();
    if (r.name === 'forms') {
      showView('forms');
      renderShapesList(elShapeSearch.value);
      return;
    }

    if (r.name === 'shape') {
      const shapeId = decodeURIComponent(r.id || '');
      if (!shapeId) {
        location.hash = '#/forms';
        return;
      }
      showView('shape');
      setActiveTab(r.tab);

      const shape = findShapeById(shapeId);
      if (!shape) {
        setStatus(elStatus, 'warn', `Форма "${shapeId}" не найдена в shapes.json. Обновите список.`);
        elShapeHeader.innerHTML = '';
      } else {
        renderShapeHeader(shape);
      }

      if (r.tab === 'textures') {
        const palette = await ensurePaletteLoaded(shapeId);
        renderTextures(Array.isArray(palette?.items) ? palette.items : []);
      }

      if (r.tab === 'upload') {
        // keep existing queue; just re-render
        renderUploadQueue();
        setStatus(elUploadStatus, '', '');
      }
      if (r.tab === 'settings') {
        const settings = await ensurePaletteSettingsLoaded(shapeId);
        fillPaletteSettingsForm(settings, shapeId);
      }
      return;
    }
  }

  async function initAfterLogin() {
    await ensureShapesLoaded();
    state.paletteByShapeId.clear();
    state.paletteSettingsByShapeId.clear();
    renderShapesList(elShapeSearch.value);

    // Default route
    if (!location.hash) location.hash = '#/forms';
    await renderRoute();
  }

  function bindUI() {
    elBtnLogin.addEventListener('click', async () => {
      const u = (elLoginUser.value || '').trim();
      const p = (elLoginPass.value || '').trim();
      if (!API_BASE_URL) {
        setStatus(elLoginStatus, 'err', 'API_BASE_URL не задан. Проверьте admin/config.js');
        return;
      }
      if (!u || !p) {
        setStatus(elLoginStatus, 'warn', 'Введите логин и пароль');
        return;
      }
      elBtnLogin.disabled = true;
      try {
        await login(u, p);
        setStatus(elLoginStatus, 'ok', 'Успешно. Загружаем данные…');
        showLoggedInUI(true);
        await initAfterLogin();
        setStatus(elLoginStatus, '', '');
      } catch (e) {
        console.warn(e);
        setToken('');
        setStatus(elLoginStatus, 'err', `Ошибка входа: ${e.message}`);
        showLoggedInUI(false);
      } finally {
        elBtnLogin.disabled = false;
      }
    });

    elBtnLogout.addEventListener('click', () => {
      setToken('');
      showLoggedInUI(false);
      setStatus(elStatus, '', '');
      setStatus(elLoginStatus, '', '');
      state.shapes = [];
      state.paletteByShapeId.clear();
      state.paletteSettingsByShapeId.clear();
    });

    elReload.addEventListener('click', async () => {
      try {
        await ensureShapesLoaded();
        state.paletteByShapeId.clear();
        await renderRoute();
      } catch (e) {
        console.warn(e);
        setStatus(elStatus, 'err', `Ошибка обновления: ${e.message}`);
      }
    });

    elShapeSearch.addEventListener('input', () => {
      if (parseRoute().name !== 'forms') return;
      renderShapesList(elShapeSearch.value);
    });

    elBackBtn.addEventListener('click', () => {
      location.hash = '#/forms';
    });

    // Tabs
    elShapeTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      const tab = btn.dataset.tab;
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const id = r.id || '';
      location.hash = `#/shape/${id}/${tab}`;
    });

    // Quick action to upload tab
    elBtnUploadGo.addEventListener('click', () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      location.hash = `#/shape/${r.id || ''}/upload`;
    });

    // Upload actions
    elUploadClearBtn?.addEventListener('click', () => {
      clearUploadUI();
    });

    elUploadStartBtn?.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      const textureId = normalizeTextureId(elUploadTextureId?.value);
      const quality = String(elUploadQuality?.value || '1k');
      const displayName = String(elUploadTextureName?.value || '').trim();

      if (!shapeId) {
        setStatus(elUploadStatus, 'err', 'Неизвестна форма (shapeId).');
        return;
      }
      if (!textureId) {
        setStatus(elUploadStatus, 'err', 'Укажите textureId.');
        return;
      }

      try {
        setStatus(elUploadStatus, '', 'Подготавливаем файлы…');
        elUploadStartBtn.disabled = true;

        let files = [];
        let meta = {};
        const zipFile = elUploadZip?.files?.[0] || null;
        const listFiles = Array.from(elUploadFiles?.files || []);

        if (zipFile) {
          const z = await unzipToFiles(zipFile);
          files = z.files.map(x => x.file);
          meta = z.meta || {};
        }
        if (listFiles.length) {
          files.push(...listFiles);
        }
        if (!files.length) {
          setStatus(elUploadStatus, 'warn', 'Выберите файлы или ZIP для загрузки.');
          return;
        }

        // If ZIP contains a different textureId, warn but continue with user-provided textureId.
        if (meta?.textureId && meta.textureId !== textureId) {
          setStatus(elUploadStatus, 'warn', `ZIP содержит textureId="${meta.textureId}", но будет использовано значение из формы: "${textureId}".`);
          await sleep(300);
        }

        const tasks = buildTasksFromFiles(shapeId, textureId, quality, files);
        state.uploadTasks = tasks;
        renderUploadQueue();

        const conc = Number(elUploadConcurrency?.value || 3);
        setStatus(elUploadStatus, '', 'Загрузка началась…');
        const res = await runUploadQueue(conc);
        if (!res.ok) {
          setStatus(elUploadStatus, 'err', `Загрузка завершена с ошибками: ${res.failed}. Проверьте CORS бакета и имена файлов.`);
          return;
        }
        setStatus(elUploadStatus, 'ok', 'Файлы загружены.');

        if (elUploadAutoAdd?.checked) {
          setStatus(elUploadStatus, '', 'Обновляем палитру…');

          // tileSizeM: explicit (uploadTileW/H) wins, else from palette-settings defaults if exists, else omit.
          let tileSizeM = null;
          const wMm = num(elUploadTileW?.value, null);
          const hMm = num(elUploadTileH?.value, null);
          if (wMm && hMm) {
            tileSizeM = { w: Math.max(1, wMm) / 1000, h: Math.max(1, hMm) / 1000 };
          } else {
            try {
              const ps = await ensurePaletteSettingsLoaded(shapeId);
              const d = ps?.defaults;
              if (d?.tileSizeM && typeof d.tileSizeM.w === 'number' && typeof d.tileSizeM.h === 'number') {
                tileSizeM = { w: d.tileSizeM.w, h: d.tileSizeM.h };
              }
            } catch {
              // ignore
            }
          }

          const item = buildPaletteItemFromUpload(shapeId, textureId, displayName, quality, tasks, tileSizeM);
          await upsertItemAndSavePalette(shapeId, item);
          setStatus(elUploadStatus, 'ok', 'Готово: файлы загружены, палитра обновлена и сохранена.');
        }
      } catch (e) {
        console.warn(e);
        const hint = e?.data?.hint ? `\n${e.data.hint}` : '';
        setStatus(elUploadStatus, 'err', `Ошибка: ${e.message}${hint}`);
      } finally {
        elUploadStartBtn.disabled = false;
      }
    });

    // Palette settings actions
    elBtnSettingsReload.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      try {
        state.paletteSettingsByShapeId.delete(shapeId);
        const settings = await ensurePaletteSettingsLoaded(shapeId, { forceReload: true });
        fillPaletteSettingsForm(settings, shapeId);
      } catch (e) {
        console.warn(e);
        setStatus(elSettingsStatus, 'err', `Ошибка загрузки настроек: ${e.message}`);
      }
    });

    elBtnSettingsSave.addEventListener('click', async () => {
      const r = parseRoute();
      if (r.name !== 'shape') return;
      const shapeId = decodeURIComponent(r.id || '');
      const payload = collectPaletteSettingsFromForm(shapeId);
      elBtnSettingsSave.disabled = true;
      try {
        setStatus(elSettingsStatus, '', 'Сохраняем…');
        const res = await apiFetch('/api/palette-settings/' + encodeURIComponent(shapeId), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        // invalidate cache and re-load
        state.paletteSettingsByShapeId.delete(shapeId);
        const settings = await ensurePaletteSettingsLoaded(shapeId, { forceReload: true });
        fillPaletteSettingsForm(settings, shapeId);
        setStatus(elSettingsStatus, 'ok', `Сохранено: ${res?.key || `palette_settings/${shapeId}.json`}`);
      } catch (e) {
        console.warn(e);
        const hint = e?.data?.hint ? `\n${e.data.hint}` : '';
        setStatus(elSettingsStatus, 'err', `Ошибка сохранения: ${e.message}${hint}`);
      } finally {
        elBtnSettingsSave.disabled = false;
      }
    });

    window.addEventListener('hashchange', () => {
      // no await
      renderRoute().catch((e) => {
        console.warn(e);
        setStatus(elStatus, 'err', `Ошибка: ${e.message}`);
      });
    });
  }

  async function init() {
    bindUI();

    if (!API_BASE_URL) {
      setStatus(elLoginStatus, 'warn', 'API_BASE_URL не задан. Укажите его в admin/config.js');
    }

    // try restore
    if (getToken()) {
      showLoggedInUI(true);
      try {
        await initAfterLogin();
      } catch (e) {
        console.warn(e);
        setToken('');
        showLoggedInUI(false);
        setStatus(elLoginStatus, 'warn', 'Сессия истекла или backend недоступен. Войдите снова.');
      }
    } else {
      showLoggedInUI(false);
      if (!location.hash) location.hash = '#/forms';
    }
  }

  init();
})();
