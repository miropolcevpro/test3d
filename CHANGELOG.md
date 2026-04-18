## Fix24u — AR snapshot button with branded export fallback
- Added an AR `Снимок` button in the final visualization toolbar.
- Built-in branded capture now hides the bottom AR menu, exports a PNG with the завод logo, and uses native share when supported.
- Added a safe fallback mode for devices where direct export cannot capture the composited AR frame: the app hides the bottom menu, overlays the logo, and prompts the user to make a system screenshot.
- Requested `camera-access` as an optional WebXR feature and detect support without making AR startup brittle.
- Release token: `20260418-f24u`

## Fix24t — AR shape picker auto-scrolls unified texture rail
- When a user selects a shape through `Выбрать форму` in AR, the bottom unified texture rail now auto-scrolls to that shape's texture section.
- Added a safe pending-scroll retry so the rail lands on the chosen form even if grouped textures finish rebuilding a moment later.
- Preserved the existing unified rail logic, AR pipeline, and current texture/form switching behavior.
- Release token: `20260418-f24t`

## Fix24s — detail CTA text fit + site icon center
- Increased the primary detail CTA share so `Связь с менеджером` fits fully inside the button.
- Reduced CTA label size slightly for safer fit on narrow screens.
- Recentered the decorative cart icon on the `Сайт` button and trimmed its visual footprint.
- Release token: `20260418-f24s`

## 2026-04-18 — f24r

- Form detail hero galleries no longer depend on the hardcoded 4-entry `gallery` arrays in `shapes.json`.
- Detail pages now auto-discover sequential hero frames from `assets/gallery/<shapeId>/1.webp`, `2.webp`, `3.webp` and so on, stopping safely at the first missing file.
- Forms with only `1.webp` now show just that frame, while newly added numbered frames appear automatically without code edits.
- Missing legacy gallery entries no longer produce broken-image artifacts in the form-page hero.
- Release token: `20260418-f24r`

## 2026-04-17 — f24q

- AR unified texture rail now shows only forms with real published textures; fallback placeholder tiles are skipped.
- Forms without real textures are omitted from the AR texture chooser instead of showing generic placeholders.
- Negative cache for no-texture shapes is avoided in the AR rail path so newly published textures can appear automatically on the next rebuild/open.
- Release token: `20260418-f24r`

## 2026-04-17 — f24o

- Increased AR texture preview cards by ~20% (64px → 77px) for better visibility and easier selection while preserving the unified grouped rail logic.
- Increased the trailing AR rail hint size to match the larger preview cards.
- Release token: `20260417-f24o`

## 2026-04-17 — f24n
- Increased the AR bottom texture preview cards by ~15% for easier selection without changing the unified rail logic.
- Kept the thinner form dividers intact while enlarging the swatch preview size from 56px to 64px.
- Matched the trailing rail hint height to the new card size so the AR bottom rail stays visually aligned.
- Release token: `20260417-f24n`

## 2026-04-17 — f24m
- AR unified texture rail: made shape separators much lighter and thinner.
- Reworked section labels from a tall top stripe into a compact inline divider with a subtle hairline + small form name.
- Kept the unified cross-form texture scroll logic intact while reducing the visual height/weight of the AR bottom rail.

## 2026-04-17 — Patch: unified AR texture rail across all forms with labeled sections
- Replaced the AR bottom swatch strip with one continuous horizontally scrollable rail that aggregates textures from all forms.
- Added per-form section labels inside the AR rail so the next form begins with a clear named divider instead of requiring manual form switching.
- Kept the current shape first in the AR rail for each session and switched shapes safely in-place when the user taps a texture from another form.
- The rail is data-driven from live per-form palettes, so newly added textures stay inside their own form section and appear automatically without manual UI curation.
- Release token: `20260417-f24m`

## 2026-04-17 — Patch: raise `Сайт` label above decorative cart icon on form pages
- Fixed the detail-page `Сайт` CTA layering so the text label always stays above the decorative cart icon.
- Reworked the site CTA styling to make the cart icon a right-side decorative layer instead of a competing inline element.
- Fixed the broken `convIconCart` CSS tail that could cause unstable icon sizing/overlap.
- Release token: `20260417-f24k`

## 2026-04-17 — Patch: producer site CTA on catalog and unified form-site links
- Added a bottom CTA button on the main catalog screen: «Перейти на сайт АКТИВ ГРУПП» → `https://ag-ru.com/`.
- Updated the shared `Сайт` button on form detail pages to open `https://ag-ru.com/`.
- Reduced the catalog bottom tail so the new footer CTA sits cleanly at the end of the page.
- Release token: `20260417-f24j`

## 2026-04-16 — Patch: safe AR texture rotation replaces layout switch
- В AR нижняя кнопка «Смена укладки» заменена на «Вращение».
- Добавлена компактная панель управления углом: −15°, +15°, ползунок 0–360° и сброс в 0°.
- Подсказка по использованию вращения показывается внутри панели по нажатию на кнопку «Вращение».
- Старое пользовательское переключение схем укладки безопасно нейтрализовано: AR работает в базовом straight-режиме с отдельным UV rotation.

# Changelog

All notable project stabilization work is recorded here.

## Unreleased

- Release token: `20260411-f24g`
- **F24c**: Added a compact/expanded Quick AR Launch Rail with a “Показать все / Свернуть” toggle and responsive expanded grid.

- Release token: `20260411-f24g`
- F24: added Quick AR Launch Rail on the catalog screen with alphabetically sorted shape/textures, background preset discovery, and fast AR start using the existing stable detail + tile + AR pipeline.
- F24b: switched Quick AR Launch Rail to published-only palette items so placeholders are excluded and newly published textures appear automatically without manual curation.

Release token: `20260411-f24g`

- **F23a**: kept AR session alive when switching forms from the in-AR shape picker by loading the new shape's textures and swatches in place instead of routing back through the detail screen.


- **F22d**: stabilized AR map loading with a strict 1k-ready-first path, optional 2k refinement, per-map timeouts, and faster downgrade when 2k assets are slow or missing.

- **F22b**: made AR texture readiness feedback honest on slow networks by tracking normal maps in the core loading phase, adding a visible loading status label, and showing a follow-up quality refinement phase while delayed maps continue to load.

- **F20a**: fixed real service worker metadata chain by importing `js/runtime-config.js` before `js/sw-meta.js` in `sw.js`, made `runtime-config.js` worker-safe, and strengthened release-check to validate the SW import chain and current runtime/SW token.

- Release token: `20260411-f24g`

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

## 2026-04-17 — remove bottom navigation from home screen
- Removed the fixed bottom navigation block on the main catalog screen (`Формы`, `3D`, `Админка`).
- Cleaned related CSS tails for the removed home-screen bottom navigation.
