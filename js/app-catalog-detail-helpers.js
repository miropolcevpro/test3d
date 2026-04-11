function readCssPxVar(name, fallback = 0) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch (_) {
    return fallback;
  }
}

function clampShapePickerPanelBounds(UI) {
  try {
    if (!UI || !UI.shapePickerPanel) return;
    const top = readCssPxVar('--ar-top-strip', 56);
    const bottom = readCssPxVar('--ar-bottom-strip', 0);
    UI.shapePickerPanel.style.top = `${Math.max(56, top)}px`;
    UI.shapePickerPanel.style.bottom = `${Math.max(0, bottom)}px`;
  } catch (_) {}
}

export function setShapePickerOpen(open, ctx = {}) {
  const { UI, updateArTopStripVar, updateArBottomStripVar } = ctx;
  if (!UI || !UI.shapePickerPanel || !UI.shapePickerBackdrop) return;
  if (open) {
    if (typeof updateArTopStripVar === 'function') updateArTopStripVar(UI);
    if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);
    clampShapePickerPanelBounds(UI);
    UI.shapePickerBackdrop.hidden = false;
    UI.shapePickerPanel.hidden = false;
    requestAnimationFrame(() => {
      if (typeof updateArTopStripVar === 'function') updateArTopStripVar(UI);
      if (typeof updateArBottomStripVar === 'function') updateArBottomStripVar(UI);
      clampShapePickerPanelBounds(UI);
      UI.shapePickerPanel.classList.add('open');
    });
  } else {
    UI.shapePickerPanel.classList.remove('open');
    UI.shapePickerBackdrop.hidden = true;
    setTimeout(() => {
      if (!UI.shapePickerPanel.classList.contains('open')) {
        UI.shapePickerPanel.hidden = true;
      }
    }, 210);
  }
}

export function buildFallbackShapesFromTiles(tiles = []) {
  return (Array.isArray(tiles) ? tiles : []).map((t) => ({
    id: String(t.id),
    name: t.name,
    icon: t.preview,
    hero: t.preview,
    tileIds: [t.id],
    tech: { 'Размер': `${t.tileSizeM.w.toFixed(2)}×${t.tileSizeM.h.toFixed(2)} м` },
  }));
}

export function renderCatalog(list, ctx = {}) {
  const { UI, onShapeSelect, emptyMessage } = ctx;
  if (!UI || !UI.catalogCards) return;
  UI.catalogCards.innerHTML = '';

  const shapes = Array.isArray(list) ? list : [];
  if (!shapes.length) {
    const empty = document.createElement('div');
    empty.className = 'catalogEmptyState';
    empty.textContent = (typeof emptyMessage === 'string' && emptyMessage.trim())
      ? emptyMessage.trim()
      : 'Нет доступных форм. Проверьте данные каталога или сетевые пути.';
    UI.catalogCards.appendChild(empty);
    return;
  }

  shapes.forEach((shape) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'catalogCard catalogCard--square';
    card.style.backgroundImage = `url(${shape.icon || shape.hero || ''})`;
    card.setAttribute('aria-label', shape.name || shape.id || 'Форма');
    card.addEventListener('click', () => {
      if (typeof onShapeSelect === 'function') onShapeSelect(shape.id, shape);
    });
    UI.catalogCards.appendChild(card);
  });
}

export function renderDetailHero(detailHeroEl, shape) {
  if (!detailHeroEl) return;
  const gallery = Array.isArray(shape?.gallery) ? shape.gallery.filter(Boolean) : [];
  if (gallery.length > 0) {
    detailHeroEl.style.backgroundImage = 'none';
    detailHeroEl.innerHTML = `
      <div class="heroCarousel">
        <div class="heroTrack" id="heroTrack">
          ${gallery.map((src, idx) => `
            <div class="heroSlide" data-idx="${idx}">
              <img src="${src}" alt="">
            </div>`).join('')}
        </div>
        <div class="heroDots" id="heroDots">
          ${gallery.map((_, idx) => `<div class="heroDot ${idx===0?'active':''}" data-idx="${idx}"></div>`).join('')}
        </div>
      </div>
    `;
    const track = detailHeroEl.querySelector('#heroTrack');
    const dots = [...detailHeroEl.querySelectorAll('.heroDot')];
    const activateDot = (i) => dots.forEach((d, di) => d.classList.toggle('active', di === i));
    track.addEventListener('scroll', () => {
      const w = track.clientWidth || 1;
      const idx = Math.round(track.scrollLeft / w);
      activateDot(Math.max(0, Math.min(dots.length - 1, idx)));
    }, { passive: true });
    return;
  }

  detailHeroEl.innerHTML = '';
  detailHeroEl.style.backgroundImage = `url(${shape?.hero || shape?.icon || ''})`;
}

export function renderDetailTech(detailTechEl, techBodyEl, btnTechToggleEl, shape) {
  if (!detailTechEl) return;
  detailTechEl.innerHTML = '';
  const tech = shape?.tech || {
    'Толщина': '—',
    'Назначение': '—',
    'Класс': '—',
  };
  for (const [k, v] of Object.entries(tech)) {
    const key = String(k);
    const val = String(v);
    if (/^\s*Толщина/.test(key)) {
      const row = document.createElement('div');
      row.className = 'kvRow kvRowFull';
      row.innerHTML = `<div class="kvFull">${key.replace(/\s*,\s*мм\s*$/i,'')} - ${val.replace(/\s*мм\s*$/i,'')}мм</div>`;
      detailTechEl.appendChild(row);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'kvRow';
    row.innerHTML = `<div class="kvK">${key}</div><div class="kvV">${val}</div>`;
    detailTechEl.appendChild(row);
  }
  if (techBodyEl) techBodyEl.hidden = true;
  if (btnTechToggleEl) btnTechToggleEl.hidden = false;
}

export function buildShapePickerList(ctx = {}) {
  const { UI, state, onShapeSelect, setShapePickerOpen } = ctx;
  if (!UI || !UI.shapePickerList) return;
  UI.shapePickerList.innerHTML = '';

  const shapes = Array.isArray(state?.shapes) ? state.shapes : [];
  for (const s of shapes) {
    const wrap = document.createElement('div');
    wrap.className = 'shapePickerItem';
    if (state?.selectedShape && state.selectedShape.id === s.id) {
      wrap.classList.add('active');
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    const icon = (s.hero ? s.hero : (s.icon ? s.icon : ''));
    const name = s.name ? s.name : s.id;

    btn.innerHTML = `
      <div class="shapePickerThumbWrap">
        <img class="shapePickerThumb" src="${icon}" alt="" loading="lazy">
      </div>
      <div class="shapePickerName">${name}</div>
    `;

    btn.addEventListener('click', async () => {
      if (typeof setShapePickerOpen === 'function') setShapePickerOpen(false);
      if (state?.selectedShape && state.selectedShape.id === s.id) return;
      if (typeof onShapeSelect === 'function') {
        await onShapeSelect(s.id, s);
      }
    });

    wrap.appendChild(btn);
    UI.shapePickerList.appendChild(wrap);
  }
}
