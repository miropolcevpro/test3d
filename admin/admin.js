/* Admin (Step 2) — backend + JWT (read-only via API) */
(() => {
  const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'admin_jwt';

  const $ = (id) => document.getElementById(id);

  const elLoginCard = $('loginCard');
  const elMainCard = $('mainCard');
  const elLoginUser = $('loginUser');
  const elLoginPass = $('loginPass');
  const elBtnLogin = $('btnLogin');
  const elBtnLogout = $('btnLogout');
  const elLoginStatus = $('loginStatus');

  const elSelect = $('shapeSelect');
  const elGrid = $('texturesGrid');
  const elEmpty = $('emptyState');
  const elStatus = $('status');
  const elReload = $('reloadBtn');

  function setStatus(el, type, msg) {
    if (!el) return;
    el.className = 'status ' + (type || '');
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
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
    if (opts.body && !(opts.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      json = await res.json().catch(() => null);
    } else {
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
      body: JSON.stringify({ username, password })
    });
    if (!json?.token) throw new Error('Не получили token от backend');
    setToken(json.token);
  }

  async function loadShapes() {
    setStatus(elStatus, '', 'Загружаем формы…');
    elSelect.innerHTML = '<option value="">Загрузка…</option>';

    const data = await apiFetch('/api/shapes');
    const ids = Array.isArray(data?.shapes) ? data.shapes : [];
    const unique = Array.from(new Set(ids)).sort((a,b)=>a.localeCompare(b));

    elSelect.innerHTML = '<option value="">— выберите —</option>' + unique.map(id => (
      `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`
    )).join('');

    setStatus(elStatus, 'ok', `Загружено форм: ${unique.length}`);
  }

  function renderTextures(items) {
    elGrid.innerHTML = '';
    if (!items || !items.length) {
      elEmpty.style.display = 'block';
      return;
    }
    elEmpty.style.display = 'none';

    const frag = document.createDocumentFragment();
    for (const it of items) {
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
    elGrid.appendChild(frag);
  }

  async function loadPalette(shapeId) {
    elGrid.innerHTML = '';
    elEmpty.style.display = 'block';

    if (!shapeId) {
      setStatus(elStatus, '', '');
      return;
    }

    setStatus(elStatus, '', `Загружаем палитру формы: ${shapeId} …`);

    const palette = await apiFetch('/api/palettes/' + encodeURIComponent(shapeId));
    const items = Array.isArray(palette?.items) ? palette.items : [];

    if (palette?._meta?.missing) {
      setStatus(elStatus, 'warn', `Палитра для формы "${shapeId}" не найдена в бакете — возвращён пустой шаблон.`);
    } else {
      setStatus(elStatus, 'ok', `Палитра загружена: ${items.length} текстур`);
    }

    renderTextures(items);
  }

  async function initAfterLogin() {
    await loadShapes();
    await loadPalette(elSelect.value);
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
    });

    elSelect.addEventListener('change', () => loadPalette(elSelect.value));

    elReload.addEventListener('click', async () => {
      try {
        await loadShapes();
        await loadPalette(elSelect.value);
      } catch (e) {
        console.warn(e);
        setStatus(elStatus, 'err', `Ошибка обновления: ${e.message}`);
      }
    });
  }

  async function init() {
    bindUI();

    // если токен уже есть — попробуем сразу загрузить данные
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
    }

    if (!API_BASE_URL) {
      setStatus(elLoginStatus, 'warn', 'API_BASE_URL не задан. Укажите его в admin/config.js');
    }
  }

  init();
})();
