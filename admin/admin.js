/* Admin (Step 3 start) — shapes list + shape details (read-only palette), router scaffold */
(() => {
  const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'admin_jwt';

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
      const icon = sh?.icon || sh?.hero || '';

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
    const hero = shape?.hero || shape?.icon || '';
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
    const data = await apiFetch('/api/shapes');
    const shapes = Array.isArray(data?.shapes) ? data.shapes : [];
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
