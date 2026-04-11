#!/usr/bin/env python3
import argparse
from pathlib import Path
from collections import defaultdict

DEFAULT_EXTS = {'.png', '.jpg', '.jpeg', '.webp'}

def human(n):
    for unit in ['B','KB','MB','GB']:
        if n < 1024 or unit == 'GB':
            return f"{n:.2f} {unit}" if unit != 'B' else f"{int(n)} B"
        n /= 1024


def gather(root: Path):
    files=[]
    for p in root.rglob('*'):
        if p.is_file() and p.suffix.lower() in DEFAULT_EXTS:
            files.append((p.stat().st_size, p.relative_to(root).as_posix()))
    return sorted(files, reverse=True)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--top', type=int, default=25)
    args=ap.parse_args()
    root=Path(args.root).resolve()
    files=gather(root)
    print('Top files:')
    for size, rel in files[:args.top]:
        print(f"{human(size):>10}  {rel}")
    sizes=defaultdict(int)
    for size, rel in files:
        parts=rel.split('/')
        for i in range(1, len(parts)):
            sizes['/'.join(parts[:i])] += size
    print('\nTop directories:')
    for rel, size in sorted(sizes.items(), key=lambda kv: kv[1], reverse=True)[:args.top]:
        print(f"{human(size):>10}  {rel}")

if __name__ == '__main__':
    main()
