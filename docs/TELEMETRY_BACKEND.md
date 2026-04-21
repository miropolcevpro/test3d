# Telemetry backend collector (`/api/telemetry`)

Этот патч добавляет серверный коллектор телеметрии для централизованного сбора событий со всех устройств.

## Что делает

- `POST /api/telemetry` — принимает клиентские батчи событий и сохраняет их в Object Storage как immutable batch objects.
- `GET /api/telemetry?mode=summary&days=7` — собирает сводку по батчам за последние N дней. Требует Bearer token админки.
- `GET /api/telemetry?mode=errors&days=7` — детальный отчёт по ошибкам. Требует Bearer token админки.
- `POST /api/telemetry?mode=clear_errors` — пометка текущих ошибок как очищенных. Требует Bearer token админки.
- `GET /api/telemetry?mode=health` — быстрый health-check.

## Почему хранение сделано пакетами, а не в одном summary.json

Чтобы не ловить гонки записи при одновременных отправках, backend пишет **каждый батч в отдельный объект**:

`telemetry/batches/YYYY/MM/DD/<timestamp>_<rand>.json`

Это безопаснее для ранней production-версии и не ломает ingestion при параллельных клиентах.

## Env для Cloud Function

Коллектор может использовать существующие `S3_*`, если они уже есть в backend.

Минимально:

- `S3_BUCKET` или `TELEMETRY_S3_BUCKET`
- `S3_ENDPOINT` или `TELEMETRY_S3_ENDPOINT`
- `S3_REGION` или `TELEMETRY_S3_REGION`
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
  или
- `TELEMETRY_S3_ACCESS_KEY_ID` / `TELEMETRY_S3_SECRET_ACCESS_KEY`

Опционально:

- `TELEMETRY_ADMIN_JWT_SECRET` или `ADMIN_JWT_SECRET` или `JWT_SECRET` — секрет для проверки admin JWT в protected telemetry режимах (`summary`, `errors`, `clear_errors`)
- `TELEMETRY_PREFIX=telemetry`
- `TELEMETRY_MAX_EVENTS=50`
- `TELEMETRY_MAX_DAYS=365`
- `TELEMETRY_MAX_OBJECTS_PER_DAY=250`

## Что нужно настроить в API Gateway

Добавить маршрут на ту же функцию:

- `POST /api/telemetry`
- `GET /api/telemetry`
- `OPTIONS /api/telemetry`

Важно: `summary`, `errors` и `clear_errors` теперь должны доходить до той же функции вместе с `Authorization: Bearer <admin_jwt>`. Публичный ingestion `POST /api/telemetry` остаётся без auth, чтобы не ломать сбор клиентской аналитики.

## Что меняется на фронте

- клиент уже умеет отправлять очередь в `/api/telemetry`
- админка теперь умеет читать remote summary и показывать aggregate по всем устройствам
- если backend не развернут, продукт не ломается: данные остаются локально

## Ограничения текущей версии

- remote summary сейчас считается на чтении из batch objects
- это безопасно и стабильно для ранней стадии, но при большом трафике позже лучше перейти на pre-aggregated summary или БД
- raw remote recent list намеренно не публикуется, чтобы не светить лишние подробности событий


## Dashboard aggregates
The collector summary now includes a `dashboard` object with KPI metrics, AR funnel aggregates, and top shapes/textures for the admin telemetry panel.


- Summary windows now support up to 365 days by default, which allows building monthly, quarterly and yearly product analytics views from the same raw telemetry batches.
