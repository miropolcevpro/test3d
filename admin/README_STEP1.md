# Admin runtime — актуальное состояние

Это уже не step-1 skeleton и не read-only страница.
Текущая админка — рабочий внутренний инструмент для управления контентом, telemetry и AR-калибровкой.

## Точки входа
- `/admin/` — основная админка;
- `/admin/palette-validator.html` — валидатор палитры, доступный только при активной admin-сессии;
- корневой `/palette-validator.html` не используется как публичный рабочий entrypoint и служит redirect-gate в админку.

## Что умеет текущая админка

### Auth
- вход по логину/паролю;
- хранение admin JWT в session storage;
- скрытие внутренних admin-only маршрутов без активной сессии.

### Catalog / palette management
- загрузка списка форм;
- просмотр palette items по форме;
- карточки текстур с preview и metadata;
- добавление bucket texture в палитру;
- sync palette item из bucket;
- удаление texture из палитры;
- удаление texture из bucket;
- bulk edit / bulk reset параметров;
- palette settings per shape.

### Upload flows
- обычная ручная загрузка файлов;
- structured ZIP upload;
- auto-add в палитру;
- post-upload sync;
- понятные rich-status сообщения для upload / sync / delete;
- confirm overlay вместо нативных `confirm()` для destructive actions.

### Texture params / calibration
- редактирование texture params в модальном окне;
- preview текстуры в админке;
- bulk apply для параметров;
- вход в admin-only AR calibration режим через публичный runtime.

### Telemetry
- telemetry dashboard;
- KPI / funnel / devices / audience / dynamics;
- telemetry error report;
- CSV / JSON export;
- clear current errors.

## Важные замечания
- Admin runtime использует backend API и не рассчитан на GitHub Pages как полностью автономную записывающую систему.
- Upload / delete / sync работают корректно только при доступном backend и валидной конфигурации API.
- В production-пути опасный override API через `?api=` и `localStorage` ограничен dev/whitelist-сценариями.
- Для destructive actions используется встроенный confirm overlay.

## Release и качество
Перед выпуском нового архива по админке обязательны:
```bash
python3 scripts/release_check.py
python3 scripts/package_release.py --output dist/3d_release.zip
```

Текущий release-check дополнительно проверяет:
- critical admin symbols;
- ключевые admin flow names;
- public DOM-safety guards;
- release artifact hygiene.
