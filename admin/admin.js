/* Admin (Step 1) — read-only */
(() => {
  const elSelect = document.getElementById('shapeSelect');
  const elGrid = document.getElementById('texturesGrid');
  const elEmpty = document.getElementById('emptyState');
  const elStatus = document.getElementById('status');
  const elReload = document.getElementById('reloadBtn');
  const elBucket = document.getElementById('bucketBase');

  function setStatus(type, msg) {
    elStatus.className = 'status ' + (type || '');
    elStatus.textContent = msg || '';
    elStatus.style.display = msg ? 'block' : 'none';
  }

  function normalizeBucketBase(v) {
    let s = (v || '').trim();
    if (!s) return 'https://storage.yandexcloud.net/webar3dtexture/';
    if (!s.endsWith('/')) s += '/';
    return s;
  }

  function resolveUrl(bucketBase, path) {
    if (!path) return '';
    const p = String(path).trim();
    if (!p) return '';
    if (p.startsWith('http://') || p.startsWith('https://')) return p;
    const base = normalizeBucketBase(bucketBase);
    return base + p.replace(/^\/+/, '');
  }

  async function loadShapes() {
    setStatus('', '');
    elSelect.innerHTML = '<option value="">Загрузка…</option>';
    try {
      const res = await fetch('../shapes.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('shapes.json: ' + res.status);
      const shapes = await res.json();

      // shapes может быть массивом или объектом, стараемся быть устойчивыми
      const ids = [];
      if (Array.isArray(shapes)) {
        for (const s of shapes) {
          if (typeof s === 'string') ids.push(s);
          else if (s && typeof s.id === 'string') ids.push(s.id);
          else if (s && typeof s.shapeId === 'string') ids.push(s.shapeId);
        }
      } else if (shapes && typeof shapes === 'object') {
        if (Array.isArray(shapes.shapes)) {
          for (const s of shapes.shapes) {
            if (s && typeof s.id === 'string') ids.push(s.id);
            else if (s && typeof s.shapeId === 'string') ids.push(s.shapeId);
          }
        } else {
          // если объект вида {klassika:{...}, antika:{...}}
          for (const k of Object.keys(shapes)) ids.push(k);
        }
      }

      const unique = Array.from(new Set(ids)).sort((a,b)=>a.localeCompare(b));
      elSelect.innerHTML = '<option value="">— выберите —</option>' + unique.map(id => (
        `<option value="${id}">${id}</option>`
      )).join('');

      setStatus('ok', `Загружено форм: ${unique.length}`);
    } catch (e) {
      console.warn(e);
      elSelect.innerHTML = '<option value="">Ошибка загрузки shapes.json</option>';
      setStatus('err', 'Не удалось загрузить shapes.json. Проверьте, что файл существует в корне проекта.');
    }
  }

  function renderTextures(items, bucketBase) {
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
      const previewPath = it?.preview || it?.maps?.albedo || '';
      const previewUrl = resolveUrl(bucketBase, previewPath);

      const card = document.createElement('div');
      card.className = 'tile';
      card.innerHTML = `
        <img class="thumb" alt="" loading="lazy" src="${previewUrl}">
        <div class="meta">
          <div class="name">${escapeHtml(name)}</div>
          <div class="id">${escapeHtml(id)}</div>
        </div>
      `;
      frag.appendChild(card);
    }
    elGrid.appendChild(frag);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  async function loadPalette(shapeId) {
    elGrid.innerHTML = '';
    elEmpty.style.display = 'block';

    if (!shapeId) {
      setStatus('', '');
      return;
    }
    const bucketBase = normalizeBucketBase(elBucket.value);
    const url = bucketBase + 'palettes/' + encodeURIComponent(shapeId) + '.json';

    setStatus('', `Загружаем палитру: ${url}`);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        // 404 — ожидаемо, просто предупреждаем
        if (res.status === 404) {
          setStatus('warn', `Палитра не найдена (404): ${url}. Это нормально, если для формы ещё не заведён файл палитры.`);
          renderTextures([], bucketBase);
          return;
        }
        throw new Error('palette: ' + res.status);
      }
      const palette = await res.json();
      const items = Array.isArray(palette?.items) ? palette.items : [];
      setStatus('ok', `Палитра загружена: ${items.length} текстур`);
      renderTextures(items, bucketBase);
    } catch (e) {
      console.warn(e);
      setStatus('err', `Ошибка загрузки палитры: ${url}`);
      renderTextures([], normalizeBucketBase(elBucket.value));
    }
  }

  async function init() {
    await loadShapes();
    elSelect.addEventListener('change', () => loadPalette(elSelect.value));
    elReload.addEventListener('click', async () => {
      await loadShapes();
      await loadPalette(elSelect.value);
    });
  }

  init();
})();
