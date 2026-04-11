#!/usr/bin/env python3
import argparse
import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile

MAGICK = '/opt/imagemagick/bin/magick'

WEBP_GROUPS = [
    ('assets/stonemix_palette/*.webp', '900x1116>', '82'),
    ('assets/colormix_palette/*.webp', '900x1116>', '82'),
    ('assets/monotone_palette/*.webp', '900x1116>', '82'),
    ('assets/gallery/**/*.webp', '1280x1280>', '82'),
]
PNG_GROUPS = [
    ('assets/forms/*.png',),
    ('assets/color_tech/*.png',),
]
ICON_GROUPS = [
    ('assets/icons/cart.webp', '256x256>', '85'),
]


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def optimize_webp(path: Path, resize: str, quality: str, dry_run: bool):
    before = path.stat().st_size
    with NamedTemporaryFile(suffix='.webp', delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        cmd=[MAGICK, str(path), '-resize', resize, '-strip', '-quality', quality, str(tmp_path)]
        run(cmd)
        after=tmp_path.stat().st_size
        if after < before:
            if not dry_run:
                tmp_path.replace(path)
            return before, after, True
        tmp_path.unlink(missing_ok=True)
        return before, before, False
    finally:
        tmp_path.unlink(missing_ok=True)


def optimize_png8(path: Path, dry_run: bool):
    before = path.stat().st_size
    with NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        cmd=[MAGICK, str(path), '-strip', '-colors', '256', 'PNG8:'+str(tmp_path)]
        run(cmd)
        after=tmp_path.stat().st_size
        if after < before:
            if not dry_run:
                tmp_path.replace(path)
            return before, after, True
        tmp_path.unlink(missing_ok=True)
        return before, before, False
    finally:
        tmp_path.unlink(missing_ok=True)


def matched_files(root: Path, pattern: str):
    if '**' in pattern:
        return sorted(root.glob(pattern))
    return sorted(root.glob(pattern))


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--dry-run', action='store_true')
    args=ap.parse_args()
    root=Path(args.root).resolve()
    total_before=0
    total_after=0
    touched=[]

    for pattern, resize, quality in WEBP_GROUPS:
        for p in matched_files(root, pattern):
            if p.is_file():
                before, after, changed = optimize_webp(p, resize, quality, args.dry_run)
                total_before += before; total_after += after
                if changed:
                    touched.append((p.relative_to(root).as_posix(), before, after))
    for (pattern,) in PNG_GROUPS:
        for p in matched_files(root, pattern):
            if p.is_file():
                before, after, changed = optimize_png8(p, args.dry_run)
                total_before += before; total_after += after
                if changed:
                    touched.append((p.relative_to(root).as_posix(), before, after))
    for pattern, resize, quality in ICON_GROUPS:
        for p in matched_files(root, pattern):
            if p.is_file():
                before, after, changed = optimize_webp(p, resize, quality, args.dry_run)
                total_before += before; total_after += after
                if changed:
                    touched.append((p.relative_to(root).as_posix(), before, after))

    saved = total_before - total_after
    print(f'optimized_files={len(touched)}')
    print(f'total_before={total_before}')
    print(f'total_after={total_after}')
    print(f'saved_bytes={saved}')
    for rel, b, a in touched:
        print(f'{rel}\t{b}\t{a}')

if __name__ == '__main__':
    main()
