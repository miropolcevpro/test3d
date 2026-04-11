# Changelog

All notable project stabilization work is recorded here.

## Unreleased

Release token: `20260411-f22d`

- **F22d**: stabilized AR map loading with a strict 1k-ready-first path, optional 2k refinement, per-map timeouts, and faster downgrade when 2k assets are slow or missing.

- **F22b**: made AR texture readiness feedback honest on slow networks by tracking normal maps in the core loading phase, adding a visible loading status label, and showing a follow-up quality refinement phase while delayed maps continue to load.

- **F20a**: fixed real service worker metadata chain by importing `js/runtime-config.js` before `js/sw-meta.js` in `sw.js`, made `runtime-config.js` worker-safe, and strengthened release-check to validate the SW import chain and current runtime/SW token.

- Release token: `20260411-f22d`

- **F22d**: stabilized AR map loading with a strict 1k-ready-first path, optional 2k refinement, per-map timeouts, and faster downgrade when 2k assets are slow or missing.

- F18c: added real forceReload support to admin ensurePaletteLoaded() for clean palette refresh flow.

- F19d: aligned runtime-config and service worker version metadata with the current release token and strengthened release checks to verify HTML, runtime, SW, stamp, and changelog stay synchronized.

- **F18b**: enforced admin manual 2k uploads only when a complete canonical 1k texture set already exists in the bucket index.

- F17c: aligned admin upload policy so manual 2k uploads are allowed only as a supplement to an existing complete 1k texture set; palette sync stays anchored to canonical 1k assets.

- F17b: unified admin canonical textureId handling so manual uploads, ZIP imports, bucket paths, and palette sync all resolve to the same lowercase storage-safe textureId.
- F17a: fixed frontend palette cache initialization and switched reconcile palette loading to stable logical cache keys.
- F16: added adaptive prefetch, warmup, and quality tuning so texture strategy now scales by device/network tier while remaining conservative in AR.
- F15: added a texture/material lifecycle guard layer with cache trimming, warmup cleanup, and cancellation of deferred selection work to reduce memory growth during long AR sessions and repeated texture switches.
- F13: added a reproducible release ritual with `scripts/release_check.py`, `scripts/package_release.py`, `docs/RELEASE.md`, and a maintained changelog.

## 2026-04-11
- F12: completed the safe modular split of `js/app.js` into focused helper modules while keeping `updateXR()` as the protected core runtime block.
- F11: unified deploy/config/path logic under a central runtime config module.
- F10: cleaned and normalized product data for shapes, tiles, and visible catalog cards.
- F09: canonicalized content IDs and asset paths across runtime, validator, and admin tooling.
- F08: normalized the content model for shapes, tiles, and palettes.
- F07: synchronized `README.md` with the real runtime behavior and current feature set.
- F06: cleaned packaging junk and removed temp artifacts without changing runtime behavior.
- F05: hardened network fallback handling for palettes, defaults, and safe catalog startup.
- F04: added soft validation and normalization for tiles, shapes, and palette JSON.
- F03: stabilized service worker update flow and version handoff.
- F02: unified deploy base path resolution for runtime, validator, admin, and service worker scope.
- F01: fixed the palette surface filter helper call mismatch.

- F19b: structured ZIP upload now enforces the same bucket-based policy as manual upload: 2k is allowed only after an already existing complete 1k set for the same textureId.
