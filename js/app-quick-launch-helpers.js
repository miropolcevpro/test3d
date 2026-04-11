export function sortQuickLaunchItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const shapeCmp = String(a?.shapeName || '').localeCompare(String(b?.shapeName || ''), 'ru', { sensitivity: 'base' });
    if (shapeCmp !== 0) return shapeCmp;
    return String(a?.tileName || '').localeCompare(String(b?.tileName || ''), 'ru', { sensitivity: 'base' });
  });
}

export function renderQuickLaunchRail(railEl, items = [], opts = {}) {
  const { onLaunch } = opts;
  if (!railEl) return;
  railEl.innerHTML = '';

  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  for (const item of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quickArCard';
    btn.setAttribute('aria-label', `Быстрый AR: ${item.shapeName} — ${item.tileName}`);

    const preview = document.createElement('div');
    preview.className = 'quickArCardPreview';
    if (item.previewUrl) preview.style.backgroundImage = `url(${item.previewUrl})`;
    btn.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'quickArCardMeta';
    meta.innerHTML = `
      <div class="quickArCardShape">${item.shapeName || 'Форма'}</div>
      <div class="quickArCardTile">${item.tileName || 'Текстура'}</div>
    `;
    btn.appendChild(meta);

    btn.addEventListener('click', async () => {
      if (typeof onLaunch === 'function') {
        await onLaunch(item);
      }
    });

    railEl.appendChild(btn);
  }
}
