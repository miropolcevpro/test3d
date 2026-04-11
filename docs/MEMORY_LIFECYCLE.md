# Texture and material lifecycle

This project now includes a conservative lifecycle guard layer for runtime textures and materials.

## Goals
- Avoid unbounded growth of cached textures during long sessions and frequent material switches.
- Cancel deferred selection-related texture work when AR sessions are cleaned up or restarted.
- Dispose helper-only GPU warmup resources when they are no longer needed.

## What was added
- `trimTextureCaches(...)` in `js/app-texture-material-helpers.js`
- `touchMaterialTextures(...)` in `js/app-texture-material-helpers.js`
- `disposeWarmupResources(...)` in `js/app-texture-material-helpers.js`
- `disposeSelectionRuntime()` in `js/app-selection-helpers.js`

## Runtime behavior
- Active textures bound to the current tile material and preview material are marked as protected.
- Texture cache trimming runs conservatively after selection updates and during AR cleanup.
- AR cleanup cancels deferred heavy-map and prefetch timers before they can apply stale work.

## Scope
This change does not rewrite `updateXR()` and does not alter the core AR orchestration flow.
