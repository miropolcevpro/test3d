#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_PARTS = {'.git', 'dist', '__MACOSX'}
EXCLUDE_NAMES = {'.DS_Store', 'app_texture_block.txt', 'test_write.txt'}
EXCLUDE_PREFIXES = ('._', 'test_', 'tmp_', 'scratch_')
EXCLUDE_SUFFIXES = ('.tmp', '.bak', '.orig', '.rej')


def should_skip(path: Path) -> bool:
    parts = set(path.relative_to(ROOT).parts)
    if parts & EXCLUDE_PARTS:
        return True
    if path.name in EXCLUDE_NAMES:
        return True
    if any(path.name.startswith(prefix) for prefix in EXCLUDE_PREFIXES):
        return True
    if any(path.name.endswith(suffix) for suffix in EXCLUDE_SUFFIXES):
        return True
    return False


def verify_archive(output_path: Path) -> None:
    forbidden_entries: list[str] = []
    with ZipFile(output_path, 'r') as zf:
        for name in zf.namelist():
            base = Path(name).name
            if not base:
                continue
            if base in EXCLUDE_NAMES:
                forbidden_entries.append(name)
                continue
            if any(base.startswith(prefix) for prefix in EXCLUDE_PREFIXES):
                forbidden_entries.append(name)
                continue
            if any(base.endswith(suffix) for suffix in EXCLUDE_SUFFIXES):
                forbidden_entries.append(name)
                continue
    if forbidden_entries:
        raise SystemExit('[FAIL] Packaged archive contains forbidden artifact files: ' + ', '.join(sorted(set(forbidden_entries))))


def build_archive(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_path, 'w', compression=ZIP_DEFLATED) as zf:
        for path in sorted(ROOT.rglob('*')):
            if not path.is_file() or should_skip(path):
                continue
            zf.write(path, arcname=path.relative_to(ROOT).as_posix())


def main() -> None:
    parser = argparse.ArgumentParser(description='Run release checks and package the project into a zip archive.')
    parser.add_argument('--output', default='dist/3d_release.zip', help='Output zip path relative to project root or absolute path')
    args = parser.parse_args()

    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = ROOT / output_path

    subprocess.run(['python3', str(ROOT / 'scripts/release_check.py')], cwd=ROOT, check=True)
    if output_path.exists():
        output_path.unlink()
    build_archive(output_path)
    verify_archive(output_path)
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f'[OK]   Packaged release: {output_path} ({size_mb:.1f} MB)')


if __name__ == '__main__':
    main()
