# Module structure

This project now keeps `js/app.js` as the orchestration layer and pushes reusable logic into focused modules.

## Runtime orchestration
- `app.js` — screen flow, AR session flow, catalog/detail orchestration, XR loop entrypoints

## UI and catalog
- `app-ui-helpers.js` — screen/UI utility helpers
- `app-catalog-detail-helpers.js` — catalog cards, detail hero/tech, shape picker helpers
- `app-ar-entry-helpers.js` — AR entry gating, help UI, Chrome/ARCore guidance

## Data and content
- `app-palette-helpers.js` — palette URL resolution, swatch rendering, preview helpers
- `app-palette-data-helpers.js` — palette/defaults loading and reconcile filtering
- `content-identity.js` — canonical IDs and content path normalization
- `runtime-config.js` — deploy/runtime config and base URL resolution
- `site-env.js` / `sw-meta.js` — compatibility facades over runtime config
- `utils.js` / `data-validation.js` — JSON loading, validation, normalization

## Rendering and materials
- `app-texture-material-helpers.js` — texture loading, fallbacks, GPU warmup, map application
- `app-shader-material-helpers.js` — tile shader source and material factory
- `app-selection-helpers.js` — tile/layout selection orchestration and deferred map loading

## Geometry and AR session helpers
- `app-geometry-helpers.js` — contour geometry, markers, fill mesh, measurements, area calculations
- `app-ar-session-helpers.js` — XR support checks, stop/cleanup/restart session adapters

## Rule for future work
- Keep `updateXR()` and core AR runtime orchestration in `app.js` until a dedicated AR runtime split is planned and validated separately.
- New reusable logic should go into focused helper modules first, then be wired into `app.js` as orchestration.

- `app-quick-launch-helpers.js` — сборка и рендер quick AR launch rail на каталоге; сортировка presets и карточки быстрого старта в AR.
