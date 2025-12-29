import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'index.html');

const exts = new Set(['.webp', '.png', '.jpg', '.jpeg']);

const PALETTES = [
  {
    key: 'stonemix',
    dirRel: 'assets/stonemix_palette',
    itemClass: 'stonemixPaletteItem',
    start: '<!-- AUTOGEN:STONEMIX_START -->',
    end: '<!-- AUTOGEN:STONEMIX_END -->',
  },
  {
    key: 'colormix',
    dirRel: 'assets/colormix_palette',
    itemClass: 'colormixPaletteItem',
    start: '<!-- AUTOGEN:COLORMIX_START -->',
    end: '<!-- AUTOGEN:COLORMIX_END -->',
  },
  {
    key: 'monotone',
    dirRel: 'assets/monotone_palette',
    itemClass: 'monotonePaletteItem',
    start: '<!-- AUTOGEN:MONOTONE_START -->',
    end: '<!-- AUTOGEN:MONOTONE_END -->',
  },
];

function isImageFile(name) {
  if (!name) return false;
  if (name.startsWith('.') || name.startsWith('_')) return false;
  const ext = path.extname(name).toLowerCase();
  return exts.has(ext);
}

function getMtimeMs(absPath) {
  try {
    return fs.statSync(absPath).mtimeMs;
  } catch {
    return 0;
  }
}

function cacheBust(relPath) {
  const abs = path.join(ROOT, relPath);
  const mtime = getMtimeMs(abs);
  const v = Math.floor(mtime) || Date.now();
  return `${relPath}?v=${v}`;
}

function sortByNumberThenName(a, b) {
  const num = (s) => {
    const m = s.match(/(\d+)(?!.*\d)/); // last number
    return m ? parseInt(m[1], 10) : NaN;
  };
  const na = num(a);
  const nb = num(b);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.localeCompare(b, 'en');
}

function deriveLabelFromFilename(filename) {
  const base = filename.replace(path.extname(filename), '');
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractExistingLabels(html, startMarker, endMarker) {
  const out = new Map();
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return out;
  const seg = html.slice(start, end);

  // Match: aria-label="..." ... url('assets/.../file.ext')
  const re = /aria-label="([^"]*)"[\s\S]*?background-image:url\('\s*([^']+)\s*'\)/g;
  let m;
  while ((m = re.exec(seg)) !== null) {
    const label = m[1] || '';
    const url = m[2] || '';
    const clean = url.split('?')[0];
    const file = path.basename(clean);
    if (file) out.set(file, label);
  }
  return out;
}

function replaceBetween(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Markers not found: ${startMarker} ... ${endMarker}`);
  }
  const before = html.slice(0, start + startMarker.length);
  const after = html.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

function buildItems({ dirRel, itemClass }, labelsMap) {
  const dirAbs = path.join(ROOT, dirRel);
  if (!fs.existsSync(dirAbs)) return '';

  const files = fs
    .readdirSync(dirAbs)
    .filter(isImageFile)
    .sort(sortByNumberThenName);

  return files
    .map((f) => {
      const label = labelsMap.get(f) || deriveLabelFromFilename(f);
      const rel = `${dirRel}/${f}`;
      const url = cacheBust(rel);
      return `          <div class="${itemClass}" role="img" aria-label="${escapeHtml(label)}" style="background-image:url('${url}')"></div>`;
    })
    .join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('index.html not found');
    process.exit(1);
  }

  let html = fs.readFileSync(INDEX_PATH, 'utf8');

  for (const p of PALETTES) {
    const labelsMap = extractExistingLabels(html, p.start, p.end);
    const items = buildItems(p, labelsMap);
    html = replaceBetween(html, p.start, p.end, items || '          <!-- (no images found) -->');
  }

  fs.writeFileSync(INDEX_PATH, html, 'utf8');
  console.log('OK: palettes synced into index.html');
}

main();
