# Embedded calculator module

This release introduces an isolated calculator module under `calculator_module/`.

## Update surface

For routine commercial updates, change only files inside `calculator_module/`:

- `price_catalog.json`
- `forms.json`
- `technologies.json`
- `palettes_*.json`
- preview folders (`mono_preview/`, `colormix_preview/`, `stonemix_preview/`, `curb_preview/`, `forms/`, `forms2/`)

These edits do **not** require touching AR/runtime logic in `js/app.js`.

## Structure

- `calculator_module/paver-configurator-core.js` — imported calculator core copied from the standalone calculator archive with local asset base.
- `calculator_module/bridge.js` — standalone integration bridge for the visualizer (submit preparation, resize reporting, parent messaging).
- `calculator_module/config.js` — isolated config for future transport integration (endpoint / Telegram share / privacy policy URL).
- `js/calculator-embed.js` — parent-side singleton iframe host injected into catalog/detail screens.

## Current transport mode

The calculator currently runs in `draft` mode by default. It prepares the payload and can later be switched to:

- backend endpoint via `submitEndpoint`
- Telegram share/deep link via `telegramShareBaseUrl` / `telegramUsername`

without changing calculation logic.


## Standalone transport boundary
- Legacy Tilda submit transport has been removed from the calculator core.
- Calculator core keeps calculation state, UI, previews, cart and hidden summary fields only.
- Standalone submit transport now lives in `calculator_module/bridge.js`.
- Future Telegram / CRM integration must extend the standalone bridge, not the core runtime.
