# Release process

This project uses a simple repeatable release ritual so every fix or improvement ships from the same clean baseline.

## Release flow
1. Start from the latest stable archive or the latest validated working tree.
2. Apply exactly one scoped fix or one scoped improvement.
3. Run the release check:
   ```bash
   python3 scripts/release_check.py
   ```
4. If the check passes, package a clean archive:
   ```bash
   python3 scripts/package_release.py --output dist/3d_release.zip
   ```
5. Smoke-check the packaged archive if needed.
6. Add a short entry to `CHANGELOG.md`.
7. Publish the archive.

## What the release check verifies
- critical runtime files exist
- core JSON files parse correctly
- no macOS junk or temp files are bundled
- forbidden release artifacts (for example `test_*`, `tmp_*`, scratch files, `.bak/.tmp/.orig/.rej`) are blocked
- all JavaScript files parse with Node.js
- admin critical helpers and key admin flow wiring are still present
- guarded public helper files do not regress to unsafe DOM patterns
- palette-validator.js is guarded against unsafe DOM regressions and missing safe URL helpers
- key admin periphery render zones (upload queue, bulk params, telemetry blocks) are guarded against unsafe DOM patterns
- residual DOM cleanup spots are guarded so ZIP-mapping modal and AR help UI do not regress to unsafe DOM patterns
- module structure docs are present and in sync with the modular layout
- release docs exist
- core content files still contain tiles and shapes

## Release naming convention
- Fix archive example: `3d_fix14_some_change.zip`
- Release package example: `dist/3d_release.zip`

## Scope rule
Ship one root change per archive. Do not combine unrelated fixes into one release package.

## Notes
- `updateXR()` is still the protected core runtime block and should only be refactored as a dedicated future task.
- `scripts/package_release.py` automatically runs `scripts/release_check.py` before building the archive.

## Release token discipline

- Keep the current release token in `RELEASE_STAMP.txt`.
- Keep all local HTML asset `?v=` tokens equal to `RELEASE_STAMP.txt`.
- Record the same token in the `## Unreleased` section of `CHANGELOG.md` before packaging.
