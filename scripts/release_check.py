#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CRITICAL_FILES = [
    'index.html',
    'admin/index.html',
    'palette-validator.html',
    'sw.js',
    'README.md',
    'CHANGELOG.md',
    'RELEASE_STAMP.txt',
    'tiles.json',
    'shapes.json',
    'js/app.js',
    'js/runtime-config.js',
    'js/MODULE_STRUCTURE.md',
]

JSON_FILES = [
    'tiles.json',
    'shapes.json',
    'assets/palettes/klassika.json',
]

JUNK_GLOBS = [
    '**/.DS_Store',
    '**/._*',
    '**/__MACOSX',
    '**/__MACOSX/**',
]

FORBIDDEN_RELEASE_FILES = [
    'app_texture_block.txt',
]

HTML_FILES = [
    'index.html',
    'admin/index.html',
    'palette-validator.html',
]

JS_GLOBS = [
    'js/*.js',
    'admin/*.js',
    'sw.js',
]


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def fail(msg: str) -> None:
    print(f'[FAIL] {msg}')
    raise SystemExit(1)


def ok(msg: str) -> None:
    print(f'[OK]   {msg}')


def check_required_files() -> None:
    missing = [p for p in CRITICAL_FILES if not (ROOT / p).exists()]
    if missing:
        fail('Missing critical files: ' + ', '.join(missing))
    ok(f'Critical files present ({len(CRITICAL_FILES)})')


def check_json() -> None:
    for name in JSON_FILES:
        path = ROOT / name
        with path.open('r', encoding='utf-8') as fh:
            json.load(fh)
    ok(f'JSON parsed successfully ({len(JSON_FILES)})')


def check_junk() -> None:
    found: list[str] = []
    for pattern in JUNK_GLOBS:
        for path in ROOT.glob(pattern):
            if path.exists():
                found.append(rel(path))
    if found:
        fail('Junk files found: ' + ', '.join(sorted(set(found))))
    ok('No macOS/temp junk files detected')


def check_forbidden_release_files() -> None:
    found = [name for name in FORBIDDEN_RELEASE_FILES if (ROOT / name).exists()]
    if found:
        fail('Forbidden release files found: ' + ', '.join(found))
    ok('No forbidden release artifact files detected')


def read_release_stamp() -> str:
    stamp = (ROOT / 'RELEASE_STAMP.txt').read_text(encoding='utf-8').strip()
    if not stamp:
        fail('RELEASE_STAMP.txt is empty')
    return stamp


def read_html_asset_token() -> str:

    versions: set[str] = set()
    local_versioned_refs = 0
    pattern = re.compile(r'''(?:src|href)=["']([^"']+\?v=([^"'&]+)[^"']*)["']''')
    for name in HTML_FILES:
        text = (ROOT / name).read_text(encoding='utf-8')
        for full_ref, version in pattern.findall(text):
            if full_ref.startswith(('http://', 'https://', '//')):
                continue
            versions.add(version)
            local_versioned_refs += 1
    if local_versioned_refs == 0:
        fail('No versioned local asset URLs found in HTML entrypoints')
    if len(versions) != 1:
        fail('HTML entrypoints contain mixed asset version tokens: ' + ', '.join(sorted(versions)))
    token = next(iter(versions))
    ok('HTML asset version token is synchronized across entrypoints (' + token + ')')
    return token


def read_runtime_config_versions() -> tuple[str, str]:

    text = (ROOT / 'js/runtime-config.js').read_text(encoding='utf-8')
    app_match = re.search(r"var\s+config\s*=\s*Object\.freeze\(\{\s*version:\s*'([^']+)'", text, re.DOTALL)
    sw_match = re.search(r"sw:\s*Object\.freeze\(\{\s*version:\s*'([^']+)'", text, re.DOTALL)
    if not app_match:
        fail('Could not read config.version from js/runtime-config.js')
    if not sw_match:
        fail('Could not read sw.version from js/runtime-config.js')
    return app_match.group(1), sw_match.group(1)



def read_admin_build_id() -> str:
    text = (ROOT / 'admin/admin.js').read_text(encoding='utf-8')
    m = re.search(r'const\s+__BUILD_ID__\s*=\s*"([^"]+)"', text)
    if not m:
        fail('Could not read __BUILD_ID__ from admin/admin.js')
    return m.group(1)

def check_release_token_alignment() -> None:
    stamp = read_release_stamp()
    token = read_html_asset_token()
    if token != stamp:
        fail(f'HTML asset token ({token}) does not match RELEASE_STAMP.txt ({stamp})')
    runtime_version, sw_version = read_runtime_config_versions()
    if runtime_version != stamp:
        fail(f'js/runtime-config.js config.version ({runtime_version}) does not match RELEASE_STAMP.txt ({stamp})')
    if sw_version != stamp:
        fail(f'js/runtime-config.js sw.version ({sw_version}) does not match RELEASE_STAMP.txt ({stamp})')
    admin_build_id = read_admin_build_id()
    if admin_build_id != stamp:
        fail(f'admin/admin.js __BUILD_ID__ ({admin_build_id}) does not match RELEASE_STAMP.txt ({stamp})')
    changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    if f'Release token: `{stamp}`' not in changelog:
        fail('CHANGELOG.md does not record the current release token: ' + stamp)
    ok('Release token matches HTML entrypoints, RELEASE_STAMP.txt, runtime-config.js, admin/admin.js, and CHANGELOG.md (' + stamp + ')')




def check_sw_import_chain() -> None:

    sw_text = (ROOT / 'sw.js').read_text(encoding='utf-8')
    imports = re.findall(r"importScripts\(([^)]*)\)", sw_text)
    ordered = []
    for group in imports:
        ordered.extend(re.findall(r'''['\"]([^'\"]+)['\"]''', group))
    if './js/runtime-config.js' not in ordered:
        fail('sw.js does not import ./js/runtime-config.js')
    if './js/sw-meta.js' not in ordered:
        fail('sw.js does not import ./js/sw-meta.js')
    if ordered.index('./js/runtime-config.js') > ordered.index('./js/sw-meta.js'):
        fail('sw.js imports ./js/sw-meta.js before ./js/runtime-config.js')

    sw_meta_text = (ROOT / 'js/sw-meta.js').read_text(encoding='utf-8')
    if '__RUNTIME_CONFIG__' not in sw_meta_text:
        fail('js/sw-meta.js no longer reads __RUNTIME_CONFIG__')
    ok('Service worker import chain loads runtime-config before sw-meta')


def check_js_syntax() -> None:
    node = shutil.which('node')
    if not node:
        fail('Node.js is required for JS syntax validation')
    files: list[Path] = []
    for pattern in JS_GLOBS:
        files.extend(ROOT.glob(pattern))
    files = sorted({p for p in files if p.is_file()})
    for path in files:
        result = subprocess.run(
            [node, '--check', str(path)],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        if result.returncode != 0:
            sys.stdout.write(result.stdout)
            sys.stderr.write(result.stderr)
            fail(f'JavaScript syntax failed: {rel(path)}')
    ok(f'JavaScript syntax OK ({len(files)})')


def check_modular_docs() -> None:
    module_doc = (ROOT / 'js/MODULE_STRUCTURE.md').read_text(encoding='utf-8')
    required_tokens = [
        'app-selection-helpers.js',
        'app-ar-session-helpers.js',
        'app-shader-material-helpers.js',
    ]
    missing = [token for token in required_tokens if token not in module_doc]
    if missing:
        fail('MODULE_STRUCTURE.md missing entries: ' + ', '.join(missing))
    ok('Module structure doc is in sync with current helper layout')


def check_release_docs() -> None:
    release_md = ROOT / 'docs/RELEASE.md'
    changelog = ROOT / 'CHANGELOG.md'
    if not release_md.exists() or not changelog.exists():
        fail('Release docs missing (docs/RELEASE.md and CHANGELOG.md are required)')
    ok('Release docs present')


def check_content_summary() -> None:
    tiles = json.loads((ROOT / 'tiles.json').read_text(encoding='utf-8'))
    shapes = json.loads((ROOT / 'shapes.json').read_text(encoding='utf-8'))

    tile_items: list = []
    shape_items: list = []

    if isinstance(tiles, dict):
        tile_items = tiles.get('tiles') or tiles.get('items') or []
    elif isinstance(tiles, list):
        tile_items = tiles

    if isinstance(shapes, dict):
        shape_items = shapes.get('shapes') or shapes.get('items') or []
    elif isinstance(shapes, list):
        shape_items = shapes

    if not tile_items:
        fail('tiles.json contains no tiles/items')
    if not shape_items:
        fail('shapes.json contains no shapes/items')
    ok(f'Content summary: {len(tile_items)} tiles, {len(shape_items)} shapes')


def main() -> None:
    print('[INFO] Running release check from', ROOT)
    check_required_files()
    check_json()
    check_junk()
    check_forbidden_release_files()
    check_js_syntax()
    check_sw_import_chain()
    check_release_token_alignment()
    check_modular_docs()
    check_release_docs()
    check_content_summary()
    print('[INFO] Release check passed')


if __name__ == '__main__':
    main()
