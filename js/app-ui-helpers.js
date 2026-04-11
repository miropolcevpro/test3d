export function show(el, on = true) {
  if (!el) return;
  if (on) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

export function setActiveScreen(name, ui, showFn = show) {
  const map = {
    catalog: ui?.screenCatalog || null,
    detail: ui?.screenDetail || null,
    ar: ui?.screenAR || null,
  };
  for (const k of Object.keys(map)) {
    const el = map[k];
    if (!el) continue;
    const isActive = k === name;
    el.classList.toggle('screen--active', isActive);
    showFn(el, isActive);
  }
}

export function fmtMeters(m) {
  return `${m.toFixed(2).replace('.', ',')} м`;
}

export function fmtArea(m2) {
  return `${m2.toFixed(2).replace('.', ',')} м²`;
}

export function updateArBottomStripVar(ui, doc = document) {
  try {
    const bar = ui?.finalBar || null;
    const h = (bar && !bar.hasAttribute('hidden')) ? bar.getBoundingClientRect().height : 0;
    doc.documentElement.style.setProperty('--ar-bottom-strip', `${Math.ceil(h)}px`);
  } catch (_) {}
}

export function updateArTopStripVar(ui, doc = document) {
  try {
    const top = ui?.arTop || null;
    const h = top ? top.getBoundingClientRect().height : 0;
    doc.documentElement.style.setProperty('--ar-top-strip', `${Math.max(56, Math.ceil(h))}px`);
  } catch (_) {}
}
