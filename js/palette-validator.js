/*
  Палитра-валидатор (статическая страница)
  - проверяет структуру palettes/<shapeId>.json
  - резолвит пути так же, как в app.js
  - проверяет доступность файлов (HEAD -> GET Range fallback)
  - проверяет content-type, размеры/вес, дубликаты id, корректность tileSizeM
*/

const $ = (id) => document.getElementById(id);

// Base URL resolver for palettes.
// Priority:
//  1) window.__SURFACE_PALETTE_BASE_URL__ (if injected)
//  2) backend runtime config: GET <API_BASE_URL>/config -> public.palettesBaseUrl
//  3) fallback: YC Object Storage public URL
const FALLBACK_BASE_URL = 'https://storage.yandexcloud.net/webar3dtexture/palettes/';
let DEFAULT_BASE_URL = (typeof window !== 'undefined' && window.__SURFACE_PALETTE_BASE_URL__)
  ? String(window.__SURFACE_PALETTE_BASE_URL__).replace(/\/+$/, '') + '/'
  : FALLBACK_BASE_URL;

function getApiBaseUrl() {
  const v = (typeof window !== 'undefined' && (window.API_BASE_URL || window.__API_BASE_URL__))
    ? String(window.API_BASE_URL || window.__API_BASE_URL__).trim()
    : '';
  return v ? v.replace(/\/+$/, '') : '';
}

function getAdminToken() {
  try {
    // keep in sync with admin/admin.js
    return sessionStorage.getItem('admin_jwt') || '';
  } catch {
    return '';
  }
}

async function apiFetchJson(path) {
  const apiBase = getApiBaseUrl();
  if (!apiBase) throw new Error('api_base_url_not_set');
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(apiBase + path, { method: 'GET', headers, cache: 'no-store' });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || `${res.status} ${res.statusText}`;
    const e = new Error(msg);
    e.status = res.status;
    e.data = json;
    throw e;
  }
  return json;
}

const els = {
  shape: $('shape'),
  baseUrl: $('baseUrl'),
  paletteUrl: $('paletteUrl'),
  optImages: $('optImages'),
  optOnlyIssues: $('optOnlyIssues'),
  btnRun: $('btnRun'),
  btnCopy: $('btnCopy'),
  summary: $('summary'),
  results: $('results'),
  hint: $('hint'),
};

const state = {
  lastReportText: '',
};

function cloneValue(v) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(v);
  } catch { /* noop */ }
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

function safeText(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : (v < 10 ? 2 : (v < 100 ? 1 : 0));
  return `${v.toFixed(digits)} ${units[i]}`;
}

function pill(text) {
  const d = document.createElement('div');
  d.className = 'pv-pill';
  d.textContent = text;
  return d;
}

function badge(text) {
  const d = document.createElement('div');
  d.className = 'pv-badge';
  d.textContent = text;
  return d;
}

function cacheBust(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('pv', String(Date.now()));
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchJson(url) {
  const r = await fetch(cacheBust(url), { cache: 'no-store' });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    // If this is YC Object Storage XML error (NoSuchKey), show a clean message.
    const clean = simplifyNoSuchKeyMessage(txt, url);
    if (clean) throw new Error(clean);
    throw new Error(`Не удалось загрузить JSON: HTTP ${r.status} ${r.statusText}${txt ? `\n${txt}` : ''}`);
  }
  return r.json();
}

function simplifyNoSuchKeyMessage(txt, url) {
  const t = String(txt || '').trim();
  if (!t) return '';
  // Typical S3 XML: <Code>NoSuchKey</Code><Message>...<Resource>/bucket/palettes/x.json</Resource>
  if (!t.includes('<Code>NoSuchKey</Code>')) return '';
  let resource = '';
  const m = t.match(/<Resource>([^<]+)<\/Resource>/i);
  if (m) resource = m[1];
  const nice = resource ? `Палитра не найдена в Object Storage: ${resource}` : `Палитра не найдена: ${url}`;
  return `${nice}.\n\nПодсказка: если palettes/<shapeId>.json ещё не создан, валидатор может загрузить палитру через Admin API (нужен вход в админку).`;
}

async function loadPaletteJson(paletteUrl, shapeId) {
  try {
    return { source: 'public', palette: await fetchJson(paletteUrl) };
  } catch (e) {
    // Fallback: Admin API can build palette from bucket even if JSON is missing.
    const msg = String(e?.message || e);
    const isNotFound = /не найдена/i.test(msg) || /404\s/i.test(msg) || /NoSuchKey/i.test(msg);
    const apiBase = getApiBaseUrl();
    if (!isNotFound || !apiBase || !shapeId) throw e;

    // NOTE: /api/* requires auth; reuse admin sessionStorage token.
    const qs = '?autocreate=1&reconcile=1';
    const pal = await apiFetchJson(`/api/palettes/${encodeURIComponent(shapeId)}${qs}`);
    return { source: 'api', palette: pal };
  }
}

function isAbs(p) {
  return /^https?:\/\//i.test(String(p || ''));
}

function isSpecial(p) {
  return /^(data:|blob:)/i.test(String(p || ''));
}

function buildResolver(paletteUrl, data) {
  const paletteURL = new URL(paletteUrl);
  const paletteDir = new URL('./', paletteURL).toString();
  const siteRoot = new URL('/', window.location.href).toString();

  // If palette is hosted on Object Storage, bucket root is /<bucket>/
  let bucketRoot = `${paletteURL.protocol}//${paletteURL.host}/`;
  if (paletteURL.hostname.endsWith('storage.yandexcloud.net')) {
    const parts = paletteURL.pathname.split('/').filter(Boolean);
    const bucketName = parts[0] || '';
    if (bucketName) bucketRoot = `${paletteURL.protocol}//${paletteURL.host}/${bucketName}/`;
  }

  const rawBaseUrl = (typeof data?.baseUrl === 'string' && data.baseUrl.trim()) ? data.baseUrl.trim() : '';
  const baseAbs = rawBaseUrl
    ? (/^https?:\/\//i.test(rawBaseUrl)
      ? rawBaseUrl.replace(/\/+$/, '') + '/'
      : new URL(rawBaseUrl, paletteDir).toString())
    : '';

  const resolvePath = (p) => {
    if (!p) return p;
    const s = String(p);
    if (isAbs(s) || isSpecial(s)) return s;
    if (baseAbs) return new URL(s.replace(/^\/+/, ''), baseAbs).toString();
    if (s.startsWith('./') || s.startsWith('../')) return new URL(s, paletteDir).toString();
    if (s.startsWith('assets/') || s.startsWith('css/') || s.startsWith('js/')) return new URL(s, siteRoot).toString();
    if (paletteURL.hostname.endsWith('storage.yandexcloud.net')) return new URL(s.replace(/^\/+/, ''), bucketRoot).toString();
    return new URL(s.replace(/^\/+/, ''), siteRoot).toString();
  };

  return resolvePath;
}

async function headOrRange(url) {
  const out = {
    url,
    ok: false,
    status: 0,
    statusText: '',
    finalUrl: url,
    method: '',
    contentType: '',
    sizeBytes: NaN,
    error: '',
  };

  const tryParseSize = (headers) => {
    const len = headers.get('content-length');
    if (len && /^\d+$/.test(len)) return Number(len);
    const cr = headers.get('content-range');
    // bytes 0-0/12345
    if (cr) {
      const m = /\/(\d+)\s*$/.exec(cr);
      if (m) return Number(m[1]);
    }
    return NaN;
  };

  // 1) HEAD
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    out.method = 'HEAD';
    out.status = r.status;
    out.statusText = r.statusText;
    out.finalUrl = r.url || url;
    out.contentType = r.headers.get('content-type') || '';
    out.sizeBytes = tryParseSize(r.headers);
    out.ok = r.ok;

    // Some servers disallow HEAD (405) or do not provide useful headers — fallback.
    if (r.status === 405 || r.status === 501) throw new Error('HEAD not allowed');
    return out;
  } catch (e) {
    out.error = safeText(e?.message || e);
  }

  // 2) GET Range bytes=0-0
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(t);

    out.method = 'GET(range)';
    out.status = r.status;
    out.statusText = r.statusText;
    out.finalUrl = r.url || url;
    out.contentType = r.headers.get('content-type') || '';
    out.sizeBytes = tryParseSize(r.headers);
    out.ok = r.ok;

    try { r.body?.cancel?.(); } catch { /* noop */ }
    return out;
  } catch (e) {
    out.method = 'GET(range)';
    out.error = safeText(e?.message || e);
    out.ok = false;
    return out;
  }
}

async function getImageDims(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    let done = false;
    const finish = (w, h) => {
      if (done) return;
      done = true;
      resolve({ w, h });
    };

    const timer = setTimeout(() => {
      try { img.src = ''; } catch { /* noop */ }
      finish(NaN, NaN);
    }, 20000);

    img.onload = () => {
      clearTimeout(timer);
      finish(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(NaN, NaN);
    };
    img.src = cacheBust(url);
  });
}

function classifySizeAndDims(kind, sizeBytes, dims) {
  const warnings = [];
  const errors = [];

  const w = dims?.w;
  const h = dims?.h;

  // Size thresholds (heuristics)
  const isPreview = kind === 'preview';
  const sizeWarn = isPreview ? 800 * 1024 : 6 * 1024 * 1024;
  const sizeHardWarn = isPreview ? 1500 * 1024 : 10 * 1024 * 1024;

  if (Number.isFinite(sizeBytes)) {
    if (sizeBytes > sizeHardWarn) warnings.push(`слишком тяжёлый файл (${fmtBytes(sizeBytes)})`);
    else if (sizeBytes > sizeWarn) warnings.push(`тяжёлый файл (${fmtBytes(sizeBytes)})`);
  }

  // Dim thresholds
  if (Number.isFinite(w) && Number.isFinite(h)) {
    const maxDim = Math.max(w, h);
    if (isPreview) {
      if (maxDim > 1400) warnings.push(`слишком большое превью (${w}×${h})`);
      else if (maxDim > 900) warnings.push(`большое превью (${w}×${h})`);
    } else {
      if (maxDim > 4096) warnings.push(`очень большая текстура (${w}×${h}) — может тормозить на мобилках`);
      else if (maxDim > 2048) warnings.push(`текстура >2k (${w}×${h}) — проверь производительность`);
    }
  }

  return { warnings, errors };
}

function makeSummary({ itemsTotal, itemsShown, assetsChecked, ok, warn, err }) {
  els.summary.innerHTML = '';
  els.summary.appendChild(pill(`Текстур: ${itemsTotal}`));
  els.summary.appendChild(pill(`Показано: ${itemsShown}`));
  els.summary.appendChild(pill(`Файлов проверено: ${assetsChecked}`));
  els.summary.appendChild(pill(`✅ OK: ${ok}`));
  els.summary.appendChild(pill(`⚠️ Предупр.: ${warn}`));
  els.summary.appendChild(pill(`❌ Ошибок: ${err}`));
}

function buildItemCard(item) {
  const card = document.createElement('div');
  card.className = 'pv-item';

  const head = document.createElement('div');
  head.className = 'pv-item__head';
  const title = document.createElement('div');
  title.className = 'pv-item__title';
  title.textContent = `${item.name || item.id || '(без id)'}${item.id ? `  —  ${item.id}` : ''}`;
  head.appendChild(title);

  const badges = document.createElement('div');
  badges.className = 'pv-badges';
  if (item.errors.length) badges.appendChild(badge(`❌ ${item.errors.length} ошибок`));
  if (item.warnings.length) badges.appendChild(badge(`⚠️ ${item.warnings.length} предупрежд.`));
  if (!item.errors.length && !item.warnings.length) badges.appendChild(badge('✅ OK'));
  head.appendChild(badges);
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'pv-meta';
  meta.innerHTML = `
    <div>tileSizeM: <code>${Number(item.tileSizeM?.w).toFixed(3)} × ${Number(item.tileSizeM?.h).toFixed(3)}</code></div>
    <div>uvScale: <code>${item.uvScaleText}</code></div>
  `;
  card.appendChild(meta);

  const notes = document.createElement('div');
  notes.className = 'pv-note';
  const lines = [...item.errors.map((t) => `❌ ${t}`), ...item.warnings.map((t) => `⚠️ ${t}`)];
  notes.textContent = lines.join(' • ');
  if (lines.length) card.appendChild(notes);

  const assets = document.createElement('div');
  assets.className = 'pv-assets';
  item.assets.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'pv-asset';

    const thumb = document.createElement('img');
    thumb.className = 'pv-thumb';
    thumb.loading = 'lazy';
    thumb.alt = a.kind;
    if (a.isImage && a.check.ok && (a.kind === 'preview' || a.kind === 'albedo')) {
      thumb.src = cacheBust(a.url);
    }
    row.appendChild(thumb);

    const main = document.createElement('div');
    main.className = 'pv-asset__main';

    const name = document.createElement('div');
    name.className = 'pv-asset__name';
    name.textContent = `${a.label}${a.required ? ' (обяз.)' : ''}`;
    main.appendChild(name);

    const sub = document.createElement('div');
    sub.className = 'pv-asset__sub';
    const statusMark = a.level === 'error' ? '❌' : (a.level === 'warn' ? '⚠️' : '✅');
    const parts = [];
    parts.push(`${statusMark} ${a.check.method || ''} ${a.check.status || ''}`.trim());
    if (a.check.contentType) parts.push(a.check.contentType.split(';')[0]);
    if (Number.isFinite(a.check.sizeBytes)) parts.push(fmtBytes(a.check.sizeBytes));
    if (Number.isFinite(a.dims?.w) && Number.isFinite(a.dims?.h)) parts.push(`${a.dims.w}×${a.dims.h}`);
    if (a.check.error) parts.push(a.check.error);
    if (a.messages.length) parts.push(a.messages.join(', '));
    sub.textContent = parts.join(' • ');
    main.appendChild(sub);

    const urlLine = document.createElement('div');
    urlLine.className = 'pv-asset__sub';
    urlLine.textContent = a.url;
    main.appendChild(urlLine);

    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'pv-asset__actions';
    const open = document.createElement('a');
    open.href = a.url;
    open.target = '_blank';
    open.rel = 'noreferrer noopener';
    open.textContent = 'Открыть';
    actions.appendChild(open);
    row.appendChild(actions);

    assets.appendChild(row);
  });
  card.appendChild(assets);

  return card;
}

function getUvScaleText(params) {
  const p = params || {};
  const v = (p.uvScale ?? p.repeatScale);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v && typeof v === 'object') {
    const x = v.x;
    const y = v.y;
    if (typeof x === 'number' && typeof y === 'number') return `{x:${x}, y:${y}}`;
  }
  return '1';
}

function getUvScaleValue(params) {
  const p = params || {};
  const v = (p.uvScale ?? p.repeatScale);
  if (typeof v === 'number' && Number.isFinite(v)) return { x: v, y: v };
  if (v && typeof v === 'object') {
    const x = (typeof v.x === 'number' && Number.isFinite(v.x)) ? v.x : 1;
    const y = (typeof v.y === 'number' && Number.isFinite(v.y)) ? v.y : 1;
    return { x, y };
  }
  return { x: 1, y: 1 };
}

function addIssue(list, msg) {
  if (!msg) return;
  list.push(msg);
}

async function validatePalette(paletteUrl, opts) {
  const report = {
    paletteUrl,
    paletteSource: 'public',
    itemsTotal: 0,
    itemsShown: 0,
    assetsChecked: 0,
    ok: 0,
    warn: 0,
    err: 0,
    items: [],
  };

  const shapeId = (opts && opts.shapeId) ? String(opts.shapeId) : '';
  const loaded = await loadPaletteJson(paletteUrl, shapeId);
  report.paletteSource = loaded.source;
  const data = loaded.palette;
  const items = Array.isArray(data?.items) ? data.items : null;
  if (!items) throw new Error('Палитра должна содержать поле items: []');
  report.itemsTotal = items.length;

  const resolvePath = buildResolver(paletteUrl, data);

  // Pre-resolve paths
  const resolved = items.map((it) => {
    const out = (it && typeof it === 'object') ? cloneValue(it) : it;
    if (!out || typeof out !== 'object') return out;
    if (out.preview) out.preview = resolvePath(out.preview);
    if (out.texture) out.texture = resolvePath(out.texture);
    if (out.maps && typeof out.maps === 'object') {
      Object.keys(out.maps).forEach((k) => {
        out.maps[k] = resolvePath(out.maps[k]);
      });
    }
    return out;
  });

  // Duplicate id check
  const seen = new Map();
  resolved.forEach((it, idx) => {
    const id = (it && typeof it === 'object') ? String(it.id || '') : '';
    if (!id) return;
    const prev = seen.get(id);
    if (prev === undefined) seen.set(id, idx);
    else {
      // Mark duplicates later
      seen.set(id, -1);
    }
  });

  for (let i = 0; i < resolved.length; i += 1) {
    const it = resolved[i];
    const item = {
      index: i,
      id: '',
      name: '',
      tileSizeM: { w: NaN, h: NaN },
      uvScaleText: '1',
      errors: [],
      warnings: [],
      assets: [],
    };

    if (!it || typeof it !== 'object') {
      item.errors.push('Элемент items[] должен быть объектом');
      report.items.push(item);
      report.err += 1;
      continue;
    }

    item.id = String(it.id || '').trim();
    item.name = String(it.name || '').trim();
    item.tileSizeM = it.tileSizeM || {};
    item.uvScaleText = getUvScaleText(it.params);

    if (!item.id) addIssue(item.errors, 'Нет поля id');
    if (!item.name) addIssue(item.warnings, 'Нет поля name (будет показан id)');

    // Duplicate ids
    if (item.id && seen.get(item.id) === -1) {
      addIssue(item.errors, `Дубликат id: ${item.id}`);
    }

    // tileSizeM
    const w = Number(it.tileSizeM?.w);
    const h = Number(it.tileSizeM?.h);
    if (!(Number.isFinite(w) && w > 0)) addIssue(item.errors, 'tileSizeM.w должен быть числом > 0');
    if (!(Number.isFinite(h) && h > 0)) addIssue(item.errors, 'tileSizeM.h должен быть числом > 0');
    if (Number.isFinite(w) && (w < 0.03 || w > 2)) addIssue(item.warnings, `подозрительный tileSizeM.w: ${w}`);
    if (Number.isFinite(h) && (h < 0.03 || h > 2)) addIssue(item.warnings, `подозрительный tileSizeM.h: ${h}`);

    // params sanity
    const ns = it.params?.normalScale;
    const bs = it.params?.bumpScale;
    if (ns != null && !(typeof ns === 'number' && Number.isFinite(ns))) addIssue(item.warnings, 'params.normalScale должен быть числом');
    if (bs != null && !(typeof bs === 'number' && Number.isFinite(bs))) addIssue(item.warnings, 'params.bumpScale должен быть числом');
    const uv = getUvScaleValue(it.params);
    if (!Number.isFinite(uv.x) || !Number.isFinite(uv.y) || uv.x <= 0 || uv.y <= 0) {
      addIssue(item.warnings, 'uvScale/repeatScale должен быть > 0');
    }

    // maps / preview
    const maps = (it.maps && typeof it.maps === 'object') ? it.maps : null;
    const previewUrl = it.preview || (maps && maps.albedo) || it.texture || '';
    if (!previewUrl) addIssue(item.errors, 'Нет preview (и нет maps.albedo/texture для fallback)');

    const requiredKeys = ['albedo'];
    const recommendedKeys = ['normal', 'roughness', 'ao', 'height'];
    if (!maps) {
      addIssue(item.errors, 'Нет maps {} (минимум нужен albedo)');
    } else {
      requiredKeys.forEach((k) => {
        if (!maps[k]) addIssue(item.errors, `Нет maps.${k} (обязательная карта)`);
      });
      recommendedKeys.forEach((k) => {
        if (!maps[k]) addIssue(item.warnings, `Нет maps.${k} (желательно для реализма)`);
      });
    }

    // Build asset list to check
    const assetsToCheck = [];
    if (previewUrl) assetsToCheck.push({ kind: 'preview', label: 'preview', required: true, url: String(previewUrl) });
    if (maps) {
      Object.keys(maps).forEach((k) => {
        if (!maps[k]) return;
        assetsToCheck.push({ kind: k, label: `maps.${k}`, required: requiredKeys.includes(k), url: String(maps[k]) });
      });
    } else if (it.texture) {
      assetsToCheck.push({ kind: 'texture', label: 'texture', required: true, url: String(it.texture) });
    }

    // Validate each url
    for (const a of assetsToCheck) {
      const asset = {
        ...a,
        isImage: true,
        check: await headOrRange(a.url),
        dims: { w: NaN, h: NaN },
        level: 'ok',
        messages: [],
      };
      report.assetsChecked += 1;

      const ctype = (asset.check.contentType || '').toLowerCase();
      asset.isImage = ctype ? ctype.startsWith('image/') : true;

      if (!asset.check.ok) {
        asset.level = 'error';
        asset.messages.push(asset.check.status ? `HTTP ${asset.check.status}` : 'не удалось загрузить');
      } else {
        if (ctype && !ctype.startsWith('image/')) {
          asset.level = 'warn';
          asset.messages.push(`content-type не image/* (${ctype.split(';')[0]})`);
        }
      }

      if (opts.checkImages && asset.check.ok && asset.isImage) {
        asset.dims = await getImageDims(asset.url);
      }

      const { warnings: sw } = classifySizeAndDims(asset.kind === 'preview' ? 'preview' : 'map', asset.check.sizeBytes, asset.dims);
      if (sw.length) {
        if (asset.level === 'ok') asset.level = 'warn';
        asset.messages.push(...sw);
      }

      item.assets.push(asset);

      if (asset.level === 'error') report.err += 1;
      else if (asset.level === 'warn') report.warn += 1;
      else report.ok += 1;
    }

    // Bubble asset-level issues into item summary
    item.assets.forEach((a) => {
      if (a.level === 'error') addIssue(item.errors, `${a.label}: ошибка загрузки`);
      if (a.level === 'warn') addIssue(item.warnings, `${a.label}: есть замечания`);
    });

    report.items.push(item);
  }

  return report;
}

function renderReport(report, opts) {
  els.results.innerHTML = '';

  const itemsToRender = report.items.filter((it) => {
    if (!opts.onlyIssues) return true;
    const hasIssues = it.errors.length || it.warnings.length || it.assets.some((a) => a.level !== 'ok');
    return hasIssues;
  });

  report.itemsShown = itemsToRender.length;
  makeSummary(report);

  itemsToRender.forEach((it) => {
    // If onlyIssues: hide OK assets
    if (opts.onlyIssues) {
      it.assets = it.assets.filter((a) => a.level !== 'ok' || a.kind === 'preview');
    }
    els.results.appendChild(buildItemCard(it));
  });

  // Build copyable text
  const lines = [];
  lines.push(`Палитра: ${report.paletteUrl}`);
  lines.push(`Текстур: ${report.itemsTotal}, показано: ${report.itemsShown}`);
  lines.push(`Файлов проверено: ${report.assetsChecked}`);
  lines.push(`OK: ${report.ok}, WARN: ${report.warn}, ERR: ${report.err}`);
  lines.push('');
  report.items.forEach((it) => {
    const title = `${it.id || '(без id)'} — ${it.name || ''}`.trim();
    const issues = [...it.errors.map((t) => `  - ❌ ${t}`), ...it.warnings.map((t) => `  - ⚠️ ${t}`)];
    if (!issues.length) return;
    lines.push(title);
    lines.push(...issues);
    it.assets.forEach((a) => {
      if (a.level === 'ok') return;
      const size = Number.isFinite(a.check.sizeBytes) ? fmtBytes(a.check.sizeBytes) : '';
      const dims = Number.isFinite(a.dims?.w) ? `${a.dims.w}×${a.dims.h}` : '';
      const meta = [
        a.level === 'error' ? '❌' : '⚠️',
        a.label,
        a.check.status ? `HTTP ${a.check.status}` : '',
        size,
        dims,
      ].filter(Boolean).join(' ');
      lines.push(`  - ${meta}`);
      lines.push(`    ${a.url}`);
    });
    lines.push('');
  });
  state.lastReportText = lines.join('\n');
}

function setHint(text, isError = false) {
  els.hint.textContent = text;
  els.hint.style.color = isError ? '#ffb4b4' : '';
}

function updatePaletteUrlFromShape() {
  const shapeId = els.shape.value;
  const base = (els.baseUrl.value || DEFAULT_BASE_URL).trim();
  const baseFixed = base ? base.replace(/\/+$/, '') + '/' : '';
  if (!shapeId) return;
  els.paletteUrl.value = `${baseFixed}${encodeURIComponent(shapeId)}.json`;
}

async function initShapes() {
  // Try to load runtime config from backend (preferred). This allows the validator to
  // work across deployments without hardcoded storage URLs.
  try {
    const apiBase = getApiBaseUrl();
    if (apiBase) {
      const r = await fetch(apiBase + '/config', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cfg = await r.json().catch(() => null);
      const pbu = cfg && cfg.public && typeof cfg.public.palettesBaseUrl === 'string' ? cfg.public.palettesBaseUrl : '';
      if (pbu) {
        DEFAULT_BASE_URL = String(pbu).replace(/\/+$/, '') + '/';
      }
    }
  } catch {
    // ignore
  }

  els.baseUrl.value = DEFAULT_BASE_URL;

  // Populate shapes
  try {
    const shapes = await fetchJson('shapes.json');
    const list = Array.isArray(shapes) ? shapes : (Array.isArray(shapes?.shapes) ? shapes.shapes : []);
    els.shape.innerHTML = '';
    list.forEach((s) => {
      if (!s || typeof s !== 'object' || !s.id) return;
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = `${s.name || s.id} (${s.id})`;
      els.shape.appendChild(opt);
    });
    if (els.shape.options.length) {
      els.shape.selectedIndex = 0;
      updatePaletteUrlFromShape();
    }
  } catch {
    // If shapes.json not readable, user can paste URL manually.
    els.shape.innerHTML = '<option value="">(не удалось загрузить shapes.json)</option>';
  }
}

els.shape.addEventListener('change', updatePaletteUrlFromShape);
els.baseUrl.addEventListener('change', updatePaletteUrlFromShape);

els.btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.lastReportText || '');
    setHint('Отчёт скопирован в буфер обмена.');
  } catch {
    setHint('Не удалось скопировать отчёт (браузер запретил доступ к буферу).', true);
  }
});

els.btnRun.addEventListener('click', async () => {
  const paletteUrl = (els.paletteUrl.value || '').trim();
  if (!paletteUrl) {
    setHint('Укажите URL палитры.', true);
    return;
  }

  els.results.innerHTML = '';
  els.summary.innerHTML = '';
  setHint('Проверяю…');

  try {
    const shapeId = (els.shape && els.shape.value) ? String(els.shape.value) : '';
    const report = await validatePalette(paletteUrl, {
      checkImages: !!els.optImages.checked,
      onlyIssues: !!els.optOnlyIssues.checked,
      shapeId,
    });

    renderReport(report, {
      onlyIssues: !!els.optOnlyIssues.checked,
    });
    setHint(report.paletteSource === 'api'
      ? 'Готово. Палитра загружена через Admin API (autocreate/reconcile).'
      : 'Готово.');
  } catch (e) {
    setHint(safeText(e?.message || e), true);
  }
});

initShapes();
