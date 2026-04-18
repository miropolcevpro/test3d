# WebAR визуализатор плитки (без 8thWall)

Проект — статическое веб‑приложение для GitHub Pages и обычного http(s)-хостинга:
- сканирование пола (hit-test)
- калибровка/фиксация пола
- постановка точек строго по полу (по центральному лучу камеры)
- замыкание контура и заливка выбранной плиткой
- переключение раскладки (**прямая** / **диагональ 45°**)
- depth-based окклюзия (best-effort, если поддерживается WebXR Depth API)
- локальный каталог плитки (`tiles.json`) и форм (`shapes.json`)
- палитры покрытий из локальных JSON и удалённых источников с fallback на встроенный каталог
- админка для редактирования каталога и выгрузки JSON
- валидатор палитр для проверки структуры и ассетов

## Актуальные ограничения текущей сборки
- В текущем production-билде поддерживаются только **две** раскладки: `straight` и `diagonal`.
- Значение `stagger` рассматривается как legacy и нормализуется в `straight`.
- **Бордюр по контуру в текущей сборке не активирован** и не должен считаться доступной пользовательской функцией.
- Полноценный AR-режим зависит от поддержки WebXR `immersive-ar` и hit-test на устройстве.

## Важно про поддержку устройств
Полноценный режим разметки и заливки работает в **Chrome на Android** с поддержкой WebXR `immersive-ar` (обычно требуется ARCore).
На iOS (Safari) WebXR `immersive-ar` обычно недоступен. Для iOS понадобится отдельная реализация (native / 8thWall / Lightship) или другой подход.

## Локальный запуск
Статика должна открываться через http(s), иначе `fetch('tiles.json')` и другие загрузки будут блокироваться браузером.

Из папки проекта:
```bash
python -m http.server 8080
```
Откройте: `http://localhost:8080`

## Развёртывание на GitHub Pages
1. Залейте файлы в репозиторий.
2. В настройках репозитория включите GitHub Pages (ветка `main`, папка `root`).
3. Откройте URL GitHub Pages.

Текущая версия проекта корректно работает как:
- на корневом хостинге (`https://example.com/`),
- так и в подпапке GitHub Pages (`https://user.github.io/repo/`).

## Каталог и контент
- `tiles.json` — базовые плитки и параметры материалов.
- `shapes.json` — формы, карточки, галереи и связи с плитками/палитрами.
- `assets/palettes/*.json` — локальные палитры покрытий.

При сетевых сбоях или проблемах с palette JSON приложение использует безопасные fallback-сценарии и не должно падать целиком из-за одной невалидной палитры.

## Админка каталога
- `/admin/` — редактирование каталога и работа с JSON.
- `palette-validator.html` — проверка структуры палитры и связанных ассетов.

На GitHub Pages запись на сервер невозможна, поэтому итоговые JSON-файлы нужно заменять в репозитории вручную.

## Service Worker
В проекте используется облегчённый service worker для контроля обновлений сборки.
Кэширование сетевых запросов к контенту намеренно не используется как основной механизм, чтобы не создавать рассинхрон по JSON, текстурам и внешним ассетам.

## Заметки по окклюзии
Окклюзия включается, если устройство/браузер отдаёт depth (`frame.getDepthInformation(view)`).
Реализация — best-effort: сравнение глубины фрагмента заливки с глубиной сцены.


## JavaScript module layout

The runtime is now split into focused helper modules under `js/`, while `js/app.js` remains the orchestration layer for screen flow, AR entry, and the XR loop. A concise map of the current module boundaries is kept in `js/MODULE_STRUCTURE.md`.

## Texture and material lifecycle hygiene
- Texture loading now uses cache trimming with protection for currently bound runtime materials, helping long sessions avoid unbounded texture growth.
- Deferred heavy-map work is cancelled on AR cleanup/restart so stale loads do not keep accumulating after session changes.
- Warmup GPU helper resources are explicitly disposed during AR cleanup.

## Быстрый запуск в AR

На экране каталога есть горизонтальный блок **«Быстрый запуск в AR»**. Он автоматически собирается из доступных форм и текстур, сортируется по алфавиту и позволяет запустить AR сразу с выбранной формой и текстурой без перехода на detail-screen. Для запуска используется тот же стабильный pipeline: подготовка формы и текстуры через `openDetail(...)`, затем `startAR()`.

## Release check and packaging

Current release token is recorded in `RELEASE_STAMP.txt`, and HTML asset URLs must match it exactly.


The project now includes a repeatable release ritual:

```bash
python3 scripts/release_check.py
python3 scripts/package_release.py --output dist/3d_release.zip
```

The release check validates critical files, JSON, JavaScript syntax, junk-free packaging, and the current module map before a new archive is built. Full release notes are kept in `docs/RELEASE.md`, and shipped changes are tracked in `CHANGELOG.md`.


## Performance tuning

Texture loading now uses an adaptive runtime strategy instead of one fixed profile for every device:
- weaker devices and slow networks reduce adjacent prefetch and skip expensive deferred maps in AR
- balanced devices keep albedo-first application fast while warming roughness opportunistically
- stronger devices can prefetch more aggressively and refine materials faster

For controlled testing you can use query overrides such as `?tex=1k`, `?prefetch=0`, `?warm=off`, or `?maps=lite`. Full notes are kept in `docs/PERFORMANCE_TUNING.md`.
