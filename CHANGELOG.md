## 2026-04-22 — Patch f24dl: calculator mobile guide sticky sync

- База: `webar_patch_calculator_module_mobile_embed_safehide_candidate_f24dk.zip` (калькуляторный кандидат поверх подтверждённой стабильной базы `f24dh`).
- Что сделано: исправлена именно мобильная нижняя панель калькулятора в embedded-режиме — теперь она синхронизируется на стороне хоста, реально прилипает к нижнему краю экрана, показывает актуальные подсказки/выбранные параметры/счётчик корзины/итог/preview формы и цвета, а кнопка безопасно ведёт по текущему сценарию без вмешательства в расчётное ядро.
- Что не трогали: AR pipeline, multizone, curb, telemetry ingestion/summary, admin texture flows, palette validator, service worker и расчётную логику калькулятора.
- Проверка: `node --check` для изменённых JS, `python3 scripts/release_check.py`, `python3 scripts/package_release.py`, проверка telemetry ZIP и release token alignment.
- Release token: `20260422-f24dl`

## 2026-04-21 — Patch f24dh: telemetry summary timeout hardening

- База: `webar_patch_telemetry_auth_hardening_candidate_f24dg.zip` (не подтверждён как новая стабильная база; патч собран поверх кандидата P24 по явному продолжению работ над telemetry).
- Что сделано: облегчён default summary scan на сервере, добавлен budget/timebox для `mode=summary`, введён partial summary вместо gateway-timeout, админка теперь делает fallback на меньший limit и понятнее деградирует на локальные данные при недоступной серверной сводке.
- Что не трогали: public telemetry ingestion, AR runtime, multizone, curb, snapshot, texture flows, palette validator, service worker.
- Проверка: `node --check` для изменённых JS, `python3 scripts/release_check.py`, `python3 scripts/package_release.py`, проверка telemetry ZIP и release token alignment.
- Release token: `20260421-f24dh`

## 2026-04-21 — Patch f24dg: telemetry admin auth hardening

- Closed protected telemetry modes behind admin Bearer auth in `backend_yc_functions/telemetry_collector/index.js`: `summary`, `errors`, and `clear_errors` now require a valid HS256 admin JWT verified with `TELEMETRY_ADMIN_JWT_SECRET` / `ADMIN_JWT_SECRET` / `JWT_SECRET`.
- Kept public telemetry ingestion unchanged: `POST /api/telemetry` remains public so site-side event delivery and browser queue flushing do not regress.
- Forwarded the current admin session token from `js/telemetry.js` only for protected remote telemetry requests, without attaching auth to public event ingestion or health-check calls.
- Improved admin telemetry panel messaging so missing/invalid auth or missing backend secret shows up as a clear server-summary warning instead of silently looking like “no data”.
- Updated telemetry collector health version and backend docs to reflect the hardened access model.
- Release token: `20260421-f24dg`

## 2026-04-21 — Patch f24df
- AR-показ площади больше не исчезает после заливки: `arArea` сохраняется и продолжает показывать площадь в финальном режиме.
- Для многозонного сценария площадь теперь считается суммарно по всем зонам и обновляется во время построения новой зоны, чтобы пользователь всегда видел общий расчёт площади.
- Заголовок выбранной текстуры в AR больше не подменяется площадью; площадь вынесена в отдельную строку и остаётся видимой без вмешательства в геометрию и state flow.
- Release token: `20260421-f24df`

## 2026-04-21 — Patch f24dc

- Cleanup patch: removed the last residual `innerHTML` usage in the admin ZIP-mapping modal and replaced static `innerHTML` templates in AR help UI with DOM-based construction.
- Switched `openZipMappingModal()` reset path to `replaceChildren()` and built the map type cell through `createElement`/`textContent` instead of string HTML.
- Rebuilt `ensureArHelpUI()` and the non-Chrome Android hint in `app-ar-entry-helpers.js` using DOM APIs only, preserving existing IDs, behavior and styling.
- No AR geometry, multizone, curb, backend or admin API logic changes.
- Release token: `20260421-f24dc`

## 2026-04-21 — Patch f24db

- Усилен `scripts/release_check.py` для admin/periphery: добавлены guards для `js/palette-validator.js` и ключевых admin render-зон (`upload queue`, `bulk params`, основные telemetry blocks).
- Release-check теперь валит релиз, если в `palette-validator.js` появятся unsafe DOM-паттерны или исчезнут критичные safe URL helper-функции.
- Добавлена проверка, что ключевые admin render-функции остаются без `innerHTML`/`outerHTML`/`insertAdjacentHTML` и продолжают использовать безопасный render-path.
- `docs/RELEASE.md` синхронизирован с новым покрытием release-check.
- Release token: `20260421-f24db`

## 2026-04-21 — Patch f24da

- Service Worker update policy стала умнее: reload теперь блокируется не только при недавнем действии, но и при открытых dialog/modal-состояниях и явном page hold state.
- `sw-register.js` теперь учитывает visible dialog-like UI, explicit `window.__SW_UPDATE_STATE__` / `data-sw-update-hold`, а также активный editable focus в admin-like context.
- В `admin/admin.js` добавлены явные сигналы dirty-state для SW update flow: открытые modal-окна и активное редактирование помечают страницу как временно небезопасную для reload.
- Для texture/bulk/map/telemetry/confirm modal состояний dirty-state синхронизируется при open/close и при focus/input/change событиях.
- Admin по-прежнему не регистрирует SW намеренно; добавленные page-state сигналы делают поведение безопаснее для текущего и будущих shared runtime сценариев.
- Release token: `20260421-f24da`

## 2026-04-21 — Patch f24cz

- Усилен hardening `palette-validator.js` без вмешательства в основной AR/runtime.
- Убраны оставшиеся `innerHTML` там, где они были не нужны: summary/results reset, item meta и shape fallback option теперь собираются через DOM API.
- Добавлен safe URL handling для preview/thumb/open-link в валидаторе: небезопасные или битые URL fail-closed и не попадают напрямую в `img.src`/`href`.
- Выровнен стиль валидатора с public/admin runtime: безопасная установка preview, аккуратное состояние пустого thumb и disabled-ссылка для невалидного asset URL.
- Release token: `20260421-f24da`

## 2026-04-21 — Patch f24cy

- Добит admin DOM/render hardening в оставшихся structured/content-driven зонах без затрагивания AR-ядра.
- `renderUploadQueue()` переведён с `tr.innerHTML` на безопасную DOM-сборку через `createElement`/`textContent`/`appendChild`.
- `buildBulkParamRow()` переведён с `row.innerHTML` на безопасную DOM-сборку.
- Основные telemetry render blocks в админке переведены с `innerHTML` на DOM API: summary, error report, sources, stats, KPI, audience, dynamics, breakdown, funnel, devices, recent list.
- Статусы, бейджи и технические детали telemetry теперь формируются через DOM-ноды, без строковой HTML-сборки данных.
- Release token: `20260421-f24da`

## 20260421-f24cu — admin dom/url hardening
- Release token: `20260421-f24cu`
- Closed content-driven `innerHTML` usage in admin shape cards, texture cards, bucket cards, and texture settings preview UI by rebuilding those sections with DOM APIs (`createElement`, `textContent`, `appendChild`).
- Added safe admin URL normalization and image-source assignment for admin cards and preview surfaces, so invalid or unsupported URLs fail closed instead of being injected into `img.src`.
- Hardened texture preview loading and modal cleanup paths without changing public frontend, AR pipeline, multizone, curb logic, or backend semantics.

## 20260421-f24ct — admin status ux polish
- Release token: `20260421-f24ct`
- Improved admin status UX for delete/sync/upload flows with structured status cards and clearer partial-success messages.
- Normalized legacy status aliases (`error` -> `err`, `success` -> `ok`) to avoid misleading unstyled states.

## 20260421-f24cr — release check public runtime guard
- Release token: `20260421-f24cr`
- Усилен `scripts/release_check.py` для публичного runtime: добавлены проверки на unsafe `innerHTML`/`outerHTML`/`insertAdjacentHTML` в content-driven helper-модулях `app-catalog-detail-helpers.js` и `app-quick-launch-helpers.js`, при этом пустая очистка контейнеров по-прежнему разрешена.
- Добавлен минимальный public smoke-check на ключевые render/helper flows (`renderDetailTech`, `buildShapePickerList`, `renderDetailHeroCarousel`, `renderQuickLaunchCards`, `renderQuickLaunchRail`) и на ожидаемую DOM-safe сборку через `createElement`/`textContent`.
- Release check теперь способен ловить опасные регрессии публичного DOM-рендеринга до упаковки архива, не затрагивая AR-ядро, multizone, curb, admin runtime или backend.


## 20260421-f24cr — public fatal ui state instead of alert
- Release token: `20260421-f24cr`
- Public app init failure no longer falls back to `alert(...)`; it now shows a built-in fatal UI state with retry and site actions.
- Added a blocking in-app fatal card with a friendly message, reload action, and optional technical detail for debugging.
- Removed the remaining `window.alert` fallback from AR runtime toast handling in the public app; toast fallback now degrades to console warning instead of interrupting the user.


## 20260421-f24co
- admin UX hardening: replaced native confirm() dialogs with a consistent admin confirm overlay for telemetry clear and texture delete flows.
- Keeps destructive actions inside admin UI, with clearer copy for palette delete, bucket delete and telemetry error clear.

## 20260421-f24co — production-safe admin api override guard
- Release token: `20260421-f24co`
- Runtime config no longer accepts `?api=` / `localStorage` admin API overrides in production by default.
- Admin API override is now honored only in dev contexts (`localhost`, `file:`, local/private hosts) or when the target API base is explicitly whitelisted via `window.__ADMIN_API_OVERRIDE_WHITELIST__`.
- Non-whitelisted query/storage overrides are ignored and cleared, so production admin/public pages fall back to the configured API base instead of persisting a poisoned endpoint.
- Existing code-level `window.API_BASE_URL` / `window.__API_BASE_URL__` overrides remain supported for intentional deploy-time configuration.

## 20260421-f24co — admin texture api hotfix
- Release token: `20260421-f24co`
- Admin hotfix: restored missing helper functions `apiGetConfig`, `apiDeleteTexture`, and `apiSyncTexture` so delete/sync flows no longer crash with `ReferenceError`.
- Added endpoint negotiation for texture delete/sync (`/api/textures/...`, `/api/surfaces/...`) with safe fallbacks when a dedicated backend route is unavailable.
- Added fallback sync logic that rebuilds a palette item from the scanned bucket index and preserves existing `name`, `tileSizeM`, and `params`.
- Added fallback delete logic that safely removes a texture from the palette document even when the backend file-delete API is unavailable, while surfacing a clear warning that bucket files were not removed.
- Upload auto-add flow now reuses the restored sync helper, so upload → auto-add → sync no longer breaks on missing functions.

## 20260421-f24cf — admin palette validator access hardening
- Release token: `20260421-f24cf`
- Админка: валидатор палитр скрыт из публичной части и перенесён во внутренний admin-entry.
- Валидатор палитр требует активную admin-сессию; без JWT или с истекшим токеном выполняется возврат на страницу входа в админку.
- Ссылка на валидатор в шапке админки показывается только после успешного входа.

## 20260420-f24cd — ar admin calibration tab touch fix
- Release token: `20260420-f24cd`
- Fixed AR admin calibration tab/button responsiveness by removing the over-aggressive touch guard that intercepted panel interactions before they reached the target controls. Outside-tap collapse now uses a safer inside/outside target check, so `Масштаб`, `Визуально`, reset, collapse, and other calibration buttons remain clickable while tap-outside close still works.
- Locked the drawer body itself against stray internal scrolling and kept scrolling only in the visual parameter list; the calibration mode tabs are now laid out in a stable two-column row for clearer touch targeting.

## 20260420-f24ca — ar admin calibration side drawer and action rail scroll
- Release token: `20260420-f24ca`
- Converted the admin-only AR calibration panel from a full-width bottom block into a compact right-side drawer so texture changes stay visible while sliders are adjusted in AR.
- Added two safe close paths for the calibration drawer: a dedicated `Свернуть` button and tap-outside dismissal anywhere on the AR screen.
- Changed the final AR action row into a horizontal scroll rail, which keeps the calibration entry reachable on small screens without changing the existing action order or AR behavior.
- Kept the calibration save pipeline, texture parameter logic, AR geometry, multizone flow, curb logic, backend packaging, and telemetry backend unchanged.

## 20260420-f24bz — ar admin visual calibration mode
- Release token: `20260420-f24bz`
- Extended the admin-only AR calibration panel with a second visual calibration mode, so texture adjustments can now be tuned directly in AR for brightness, contrast, saturation, roughness, specular strength, normal relief, and height relief in addition to the existing scale control.
- Reused the existing admin AR save pipeline: the current texture now updates live in AR, auto-saves into the palette item params, and refreshes in-memory palette caches without changing the public AR entry flow.
- Added shader/runtime support for `contrast` and `saturation` so saved visual calibration parameters are applied consistently when textures are selected later.
- Kept AR geometry, multizone logic, curb flow, backend packaging, telemetry backend, and admin dashboard structure unchanged.

## 20260420-f24by — ar curb sheet active selection highlight fix
- Release token: `20260420-f24by`
- Fixed curb sheet active-state syncing for mode, preset, and material chips by matching hyphenated `data-*` attributes correctly instead of querying camelCase attribute names.
- Strengthened active highlighting for curb chips and segment chips with a clearer selected-state style and an `aria-pressed="true"` visual fallback so chosen parameters are immediately visible in the curb menu.
- Kept AR geometry, multizone flow, curb generation logic, admin behavior, telemetry, and backend packaging unchanged.

## 20260420-f24bx — homepage quick ar cta and rail priority order
- Release token: `20260420-f24bx`
- Added a safe homepage CTA button directly under the quick AR rail; it launches visualization through the existing quick-launch pipeline instead of introducing a separate AR entry flow.
- Changed quick AR rail ordering so items from `Брусчатка` appear first, then `Новый город`, `Старый город`, `Антика`, with all remaining shapes continuing after them in the existing alphabetical order.
- Kept AR geometry, multizone, curb logic, admin, telemetry, and backend release packaging unchanged.

## 20260419-f24bw — ar zone action order and curb ux simplification
- Release token: `20260419-f24bw`
- Reordered final AR action row to: Rotation → Zones+ → Snapshot → Shape picker.
- Moved curb entry to the top action row in the zone sheet to simplify the curb flow.
- Strengthened visible active highlighting for curb mode, preset, material, selected segments, and the main curb action.

## 20260419-f24bv — ar curb contact profile seam closure
- Release token: `20260419-f24bv`
- Adds a tiny inner contact lip profile for curb segments to visually close the remaining vertical seam between paving and curb without changing zone geometry, UI, or multizone logic.

## 20260419-f24bv — ar curb surface reference alignment
- Release token: `20260419-f24bv`
- Бордюр теперь опирается на ту же surface-plane, что и плоскость мощения, через модель embeddedDepth + exposedHeight.
- Убран вертикальный эффект левитации: бордюр должен выглядеть немного выше текстуры, но без пустой воздушной щели.

## 20260419-f24bv — ar curb vertical seam seat tuning
- Release token: `20260419-f24bv`
- Lowered curb seating relative to the paving plane, switched segment base anchoring to the lower edge reference, and tuned contact overlap so the curb visually meets the paving without a floating vertical seam.

## 20260419-f24bs — ar curb edge contact seam tuning
- Release token: `20260419-f24bs`
- Tuned the curb contact seam so the inner curb face seats against the paving contour with a tiny controlled overlap, eliminating the visible gap while preserving the stabilized outer-edge alignment logic.

## 20260419-f24bs — ar draft assist layout and deterministic zone numbering
- Release token: `20260419-f24bs`
- Объединён нижний draft-assist в единый компактный assist-bar: короткая подсказка и кнопки `Назад` / `Отменить зону` больше не конфликтуют и не перекрывают друг друга.
- Подсказки в режимах построения и выреза стали короче и контекстнее, чтобы новый пользователь видел следующий шаг без перегруженного нижнего UI.
- Пользовательские названия зон теперь считаются по текущему порядку зон в сцене: первая зона всегда отображается как `Зона 1`, вторая как `Зона 2` и так далее, независимо от внутренних id и исторического sequence.

## 20260419-f24bs — ar curb contour-edge alignment hardening
- Release token: `20260419-f24bs`
- Бордюрная геометрия перестроена от реальных рёбер контура: сегменты теперь строятся как edge-aligned призмы с miter/butt логикой, а не как смещённые box-меши по центру ребра.
- Нормали внешнего смещения теперь дополнительно валидируются пробой относительно полигона, чтобы бордюр всегда уходил наружу контура, а не случайно внутрь.
- Уменьшены дефолтные размеры пресетов бордюров, чтобы они были слегка выше текстуры и визуально не доминировали над зоной мощения.

## 20260419-f24bs — ar curb geometry stabilization
- Release token: `20260419-f24bs`
- Бордюры смещены наружу относительно внешнего контура зоны, уменьшены по высоте/ширине и обрезаются у углов, чтобы не пересекаться хаотично и не накладываться на плитку.
- Исправлена нестабильная curb-геометрия на острых углах и уменьшена визуальная агрессивность бордюров в AR.

## 20260419-f24bo — ar curb ux polish
- Release token: `20260419-f24bo`
- Polished the curb sheet into a clearer mobile-first flow with preview, segmented choice chips for boundary mode, curb preset and color, plus clearer state text for the active zone.
- Added a draft curb preview card so users can see what will be applied before committing, including the current zone and whether the whole outer perimeter or selected outer segments will be used.
- Made curb apply/remove less intrusive: after applying or removing a curb, the sheet closes automatically so the AR view stays clean while the curb remains linked to the active zone.

## 20260419-f24bo — ar curb perimeter ui
- Release token: `20260419-f24bo`
- Opened the first visible curb workflow in AR: the active zone now has a dedicated «Бордюр» action with an internal curb sheet for applying or removing a border without leaving the session.
- Added perimeter-only curb application for the active zone, with preset and material selection; curbs are built only along outer boundary edges and never on shared seams between zones.
- Added curb rebuild and cleanup hooks for zone finalization, zone deletion, draft cancel and AR reset/restart so curb meshes stay synchronized with the current zone geometry.

## 20260419-f24bk — ar multizone hard reset cleanup
- Release token: `20260419-f24bk`
- Hard reset AR now performs a full local scene cleanup before the next session, so stale multizone meshes and textures do not survive restart.
- Cleanup is executed on XR session end/restart and removes orphan anchor children before resetting zone state.
- Added live validation for the next segment while drawing AR zones, so a new point is blocked immediately when the segment would cross an existing zone or the current contour.
- Made zone snapping geometry-safe: vertex/edge snap is now accepted only when the snapped segment stays valid, preventing the UI from magnetizing users into an invalid crossing.
- Added clearer AR runtime messaging when a new point would cut through a neighbouring zone instead of following the outer side or the shared edge.

## 20260419-f24bk — ar multizone compact zone ui panel
- Release token: `20260419-f24bk`
- Reworked AR multi-zone controls into a compact default layout: the main final bar now shows the action row, a slim active-zone status line and the texture rail, while the full zone manager stays hidden until the user opens `Зоны`.
- Added a dedicated zone management sheet with active-zone summary, add-zone action, zone chips, edit/cutout/delete actions and an explicit close button to reduce screen occlusion in AR.
- Added user guidance for multi-zone work: intro hints explain that new zones can be added from `Зоны` and textures are changed for the active zone in the lower texture rail.

## 20260418-f24bf — ar multizone patch7 hardening limits cleanup telemetry
- Release token: `20260418-f24bf`
- Added hardening limits for AR multizone scenes: max zones, contour points, cutouts and hole points.
- Added safe runtime cleanup/dispose for zone mesh/material lifecycle and texture cache trimming after resets/deletes.
- Added multizone telemetry for add_done, delete_done, runtime cleanup and limit reached events.

## 20260418-f24bf — ar multizone patch6 zone edit cutouts delete
- Release token: `20260418-f24bf`
- Added per-zone AR actions in final mode: edit the active zone contour, add cutouts inside the active zone, and delete the active zone directly from the zone panel.
- Zone actions now stay explicitly tied to the selected active zone, while the rest of the multi-zone geometry, snapping and anti-overlap flow remains unchanged.
- Deleting the last zone safely returns AR to drawing mode on the locked floor so the user can build a new area without restarting the AR session.

## 20260418-f24bf — ar multizone patch5 zone controls polish
- Release token: `20260418-f24bf`
- Improved AR zone controls with a dedicated active-zone summary, clearer per-zone texture and rotation context, and richer zone chips in final AR mode.
- Rotation panel now explicitly shows which zone is being adjusted and keeps per-zone rotation intent obvious without changing the current geometry flow.

## 20260418-f24bb — ar multizone patch4 snap vertices and edges
- Release token: `20260418-f24bb`
- Adds AR zone snapping to existing vertices and edges for easier multi-zone joining.
- Keeps current anti-overlap validation and single-zone compatibility unchanged.

## 20260418-f24ba — ar multizone patch3 anti overlap validation
- Release token: `20260418-f24ba`
- Added AR zone contour validation before closing a zone: self-intersections are blocked and overlapping multi-zone contours are rejected.
- Allowed edge-to-edge adjacency while preventing real filled-area overlap between zones; the current UX stays lightweight and zones can still be added independently.
- Added user-facing AR validation feedback and telemetry guards for blocked self-intersection and overlap cases without changing admin/backend behavior.

## 20260418-f24az — ar multizone patch2 add zone active zone
- Release token: `20260418-f24az`
- Added AR multi-zone UX: create a new zone after finalizing the current one and switch the active zone from zone chips in final AR mode.
- Each zone now keeps its own contour data, fill mesh, tile material, selected tile id and texture rotation, while current AR flow remains compatible for single-zone use.
- Added safe active-zone switching without overlap validation yet; existing zones stay visible while a new zone is drawn and finalized independently.

## 20260418-f24ax — admin error report clear current errors
- Release token: `20260418-f24ax`
- Added a dedicated `Очистить ошибки` action next to export in the admin error report modal.
- Implemented soft server-side clearing for the current visible error selection: cleared error IDs are hidden from summary and detailed error reports without rewriting raw telemetry batches.
- Added safe local-browser clearing fallback for local-only error reports and kept the rest of analytics, AR logic and telemetry ingestion unchanged.

## 20260418-f24as — admin error report modal with classification and export
- Release token: `20260418-f24as`
- Карточка «Ошибок» в аналитике стала точкой входа в отдельный отчёт по ошибкам.
- Добавлен read-only режим `mode=errors` в telemetry collector без изменения текущего ingestion pipeline и KPI-сводки.
- В админке появился модальный отчёт по ошибкам: критичность, категории, источник, группировка, раскрытие технических деталей.
- Добавлен экспорт отчёта в CSV и JSON, плюс честный fallback на локальные ошибки браузера, если серверная сводка недоступна.
- Дополнительно выровнен `health` version telemetry collector до актуального release token.

## 20260418-f24ar — admin analytics wording and diagnostics ux polish
- Release token: `20260418-f24ar`
- Переименованы технические блоки аналитики в более понятный для администратора язык.
- Технические данные и журнал событий перенесены в сворачиваемый раздел «Служебная диагностика аналитики».
- Уточнены подписи кнопок и пояснения по синхронизации данных текущего устройства и общей сводки.
- Улучшена визуальная иерархия аналитики: добавлены информационные блоки и более чистая структура панели.

## 20260418-f24aq — admin analytics close button contrast hotfix
- Release token: `20260418-f24aq`
- Made the analytics modal close button visibly contrast on the light dashboard background.
- Added dark filled styling, clearer border, hover state and focus ring for the `Закрыть` action.

## 20260418-f24ap — admin analytics modal + mobile adaptive polish
- Release token: `20260418-f24ap`
- Вынес аналитический дашборд в отдельную открывающуюся панель по кнопке «Открыть аналитику».
- Доработан адаптив админки и аналитики для телефонов и планшетов: улучшены topbar, toolbar, CTA, модальное окно и поведение сеток без наездов за экран.
- Дошлифован визуал панели аналитики: отдельное light-sheet окно, более аккуратный autolayout и читаемая иерархия блоков.

## 20260418-f24ap — admin dashboard visual refresh
- Release token: `20260418-f24ap`
- полностью переработан визуальный стиль блока «Аналитика и ошибки» в админке
- повышен контраст текста, метрик и панелей для читаемости на десктопе и мобильных экранах
- улучшен autolayout dashboard: фильтры, KPI, аудитория, воронка, устройства и список событий адаптируются под планшеты и телефоны
- обновлены кнопки действий, карточки метрик, списки событий и code/JSON-блоки в более чистом современном light-стиле

## 2026-04-18 — Patch f24ai: admin login + telemetry hotfix
- Release token: `20260418-f24ai`
- Restored missing admin helper functions `getToken`, `setToken`, and `apiFetch` in `admin/admin.js`, fixing broken admin initialization and login after telemetry rollout.
- Verified telemetry client requests continue to use `credentials: 'omit'` for remote summary reads and event flushes, matching the public `/api/telemetry` endpoint setup.

## 2026-04-18 — Patch f24ah: audience metrics, repeat visits, quarter/year analytics
- Release token: `20260418-f24ah`
- Analytics dashboard now shows unique visitors, sessions, repeat visits from the same device/browser, returning devices and average sessions per device.
- Added period presets for quarter and year, plus dynamic time-series widgets aggregated by days, months, quarters and years.
- Telemetry records now include a persistent visitor/device identifier so repeat visits are visible across sessions.
- Telemetry collector default retention window for summaries increased to 365 days.

## 2026-04-18 — Patch f24ag: KPI standards + filterable product analytics
- Release token: `20260418-f24ah`
- Added explicit analytics filters in admin telemetry: period (`1 / 7 / 30 days`) and device segment (`all / mobile / tablet / desktop / unknown`).
- KPI cards now use product standards with visible status badges: `Норма`, `Внимание`, `Риск`, `Нет базы`.
- Local telemetry summaries now respect selected period and device filters.
- Remote telemetry summary accepts the same filters through the backend collector and reflects them in dashboard widgets.

## 2026-04-18 — Patch f24af: analytics semantics polish + AR funnel + device segmentation
- Release token: `20260418-f24af`
- Product analytics semantics clarified: KPI formulas refined for AR launch/start/completion, texture interaction, CTA and error rates.
- Dashboard in admin fully Russified for metric labels, event names and telemetry summaries.
- Added AR funnel widgets (launch → start → first point → contour closed → visualization ready).
- Added device segmentation widgets (phones / tablets / desktop / unknown) with sessions, AR completion and error rate per session.

## 2026-04-18 — Patch f24ae: product telemetry dashboard + KPI cards
- Release token: `20260418-f24af`
- Sprint 1 / Patch 2: added product dashboard in admin telemetry panel with KPI cards, AR funnel aggregates, top shapes, and top textures.
- Telemetry backend summary now returns dashboard aggregates and KPI-ready remote metrics.
- Hotfix: restored normalized `form_change` tracking helper and added AR calibration scale slider telemetry event.

## 2026-04-18 — Patch f24ad: telemetry event coverage completion (Patch 1)
- Release token: `20260418-f24ad`
- Added normalized `form_change` telemetry when switching forms from the catalog detail flow, AR shape picker, and unified AR texture rail.
- Added explicit `admin_ar_calibration_scale_slider_change` telemetry for slider-based UV scale changes in AR calibration.
- Added `admin_visual_param_change` telemetry for texture parameter changes inside the admin texture modal and palette defaults editor.
- Added `texture_map_load_failed` telemetry for failed texture map loading, including albedo candidate exhaustion and direct map failures.
- Added `palette_load_failed` / `palette_parse_failed` telemetry for surface palette and palette-defaults loading failures.
- Added `gallery_asset_missing` telemetry for missing explicit gallery assets and missing fallback hero/icon assets, while keeping sequential autodiscovery stable.

## 2026-04-18 — Patch f24ac: telemetry backend collector + remote admin summary
- Release token: `20260418-f24ac`
- Added backend telemetry collector source under `backend_yc_functions/telemetry_collector/` and a ready upload archive under `backend_yc_function_upload/telemetry_collector.zip`.
- Collector stores each telemetry POST batch as an immutable object in Object Storage to avoid race conditions on concurrent writes.
- Added `GET /api/telemetry?mode=summary` and `GET /api/telemetry?mode=health` contract for centralized aggregates.
- Extended `js/telemetry.js` with remote summary/health helpers.
- Upgraded the admin telemetry panel to show remote aggregate counts when the backend collector is deployed, while keeping local fallback intact.
- Added deployment notes in `docs/TELEMETRY_BACKEND.md`.

## 2026-04-18 — Sprint 1 foundation: analytics + errors (Patch f24ab)

- Added frontend telemetry core `js/telemetry.js` with:
  - local history ring buffer
  - pending queue for optional batch upload
  - global `window.error` / `unhandledrejection` capture
  - export/clear helpers for admin diagnostics
- Wired runtime config for optional telemetry endpoint resolution through the same runtime config layer.
- Instrumented key product events on the public site:
  - detail page opens
  - manager/site CTA clicks
  - AR launch requests / blocked states / successful starts / session end
  - first point, contour close, cutout close, final visualization
  - texture selection, shape picker selection, quick AR launches
  - rotation panel usage, snapshot usage and fallback, admin AR calibration saves/errors
- Added admin monitoring panel with summary, recent events/errors, export JSON, clear local history and manual flush of the pending queue.
- Kept telemetry safe by design: if `/api/telemetry` is absent, events remain local and do not break product flows.


## 2026-04-18 — Patch f24y: AR admin calibration save fix
- Release token: `20260418-f24y`
- Исправлено сохранение `uvScale` из AR-калибровки: запись теперь идёт через тот же admin API `/api/palettes/{shapeId}`, что и обычное редактирование палитры.
- Причина бага: в AR использовался public API base, который на сайте не был задан, поэтому визуальная калибровка применялась только локально в сессии и не записывалась в бакет.
- Дополнительно чтение текущей палитры перед записью переведено на admin API, чтобы поведение совпадало с режимом настройки палитры в админке.

## Fix24x — Admin AR texture calibration via admin session
- Added an admin-only AR calibration entry from the texture settings modal in the existing admin panel.
- The site now honors a secure admin AR session and opens the requested shape/texture directly for calibration.
- Added a calibration panel in AR final mode for live `uvScale` adjustment with autosave back to the palette via the admin API.
- Release token: `20260418-f24x`

## Fix24w — AR top title safe offset hotfix
- Added a dynamic top safe offset for the AR title bar so the form/color label stays visible below Android browser chrome, status bars, notches, and tablet overlays.
- Lowered the AR header and made the title/subtitle sizing calmer on narrow screens without changing the AR pipeline.
- Anchored scan hint positioning to the actual AR header height to avoid overlaps after the safer top offset.
- Release token: `20260418-f24w`

## Fix24v — AR snapshot UI safe-top + smaller logo
- Moved the AR top title block lower and made it adaptive, so the form/color label no longer gets visually clipped on narrow Android screens and tablets during snapshot flow.
- Replaced the single-line hard clamp with a responsive two-line title and safer subtitle sizing.
- Reduced the branded snapshot logo size and shrank its blurred background both in fallback overlay mode and in exported PNG snapshots.
- Release token: `20260418-f24v`

## Fix24u — AR snapshot button with branded export fallback
- Added an AR `Снимок` button in the final visualization toolbar.
- Built-in branded capture now hides the bottom AR menu, exports a PNG with the завод logo, and uses native share when supported.
- Added a safe fallback mode for devices where direct export cannot capture the composited AR frame: the app hides the bottom menu, overlays the logo, and prompts the user to make a system screenshot.
- Requested `camera-access` as an optional WebXR feature and detect support without making AR startup brittle.
- Release token: `20260418-f24v`

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
## 2026-04-21 — safe handling content URLs in public runtime
- Added safe normalization for content-driven image/background URLs in public helpers.
- Applied guarded URL handling to detail hero, catalog cards, shape picker, quick AR rail, and palette swatches.
- Invalid or unsupported content URLs now fail closed instead of being injected into src/backgroundImage directly.

## 2026-04-21 — Patch f24cv
- Усилен release artifact hygiene: `release_check.py` теперь валит релиз при наличии лишних артефактов вроде `test_write.txt`, файлов с префиксами `test_/tmp_/scratch_` и файлов с суффиксами `.tmp/.bak/.orig/.rej`.
- Удалён лишний `test_write.txt` из release-дерева.
- Усилен packaging guard: `package_release.py` теперь не только исключает запрещённые артефакты из архива, но и дополнительно проверяет готовый zip на их отсутствие.
- Release token: `20260421-f24cv`

## 2026-04-21 — Patch f24cw
- README.md синхронизирован с фактическим состоянием продукта: многозонный AR, active curb layer, quick AR rail с текущим порядком приоритета, CTA под лентой, актуальные ограничения Android/iPhone и текущая роль корневого `palette-validator.html`.
- `admin/README_STEP1.md` переписан из устаревшего step-1 skeleton в актуальное описание рабочего admin runtime: auth, palette/bucket flows, upload/sync/delete, telemetry и admin-only validator.
- `docs/RELEASE.md` обновлён под текущий release-check: forbidden artifact hygiene, admin critical helper guard и public DOM safety guard.
- Release token: `20260421-f24cw`

## 2026-04-21 — Patch f24cx
- Смягчена политика обновления service worker: новая версия больше не перезагружает страницу немедленно во время активной AR-сессии или недавнего взаимодействия пользователя.
- Обновление теперь откладывается до безопасного момента и показывает мягкий update-prompt с действиями «Обновить» и «Позже».
- Добавлены guards для активного AR-экрана, fullscreen/immersive состояний, splash-экрана и короткого idle-окна после действий пользователя.
- Release token: `20260421-f24cx`

## 2026-04-21 — Patch f24de

- P23: improved admin edge-case UX without changing backend/API semantics.
- Structured ZIP mapping now shows clearer guidance, file counts, and actionable validation errors for required maps and duplicate selections.
- Admin texture modal now explains missing/unsafe/broken preview states more clearly and keeps warnings visible after opening the modal.
- Upload + auto-add + sync now summarizes partial sync, fallback sync, and failed texture IDs instead of hiding the exact outcome.
- Palette and bucket texture cards now mark edge-case items with "без preview" for faster operator triage.
- Release token: `20260421-f24de`

## 2026-04-21 — Patch f24dd
- Расширен `release_check.py` на residual DOM cleanup spots: ZIP-mapping modal в `admin/admin.js` и AR help UI в `js/app-ar-entry-helpers.js`.
- Release check теперь валит релиз, если эти зоны снова возвращаются к `innerHTML`, `outerHTML` или `insertAdjacentHTML`, и проверяет ожидаемый безопасный DOM render-path.
- `docs/RELEASE.md` синхронизирован с новым coverage release-check.
- Release token: `20260421-f24de`
