# 2026-10-13_dsh-ghl-improvements: dsh-ghl improvements

**Created:** 2026-10-13T11:35:49+03:00

## Scope

Четыре доработки плагина `dsh-ghl` (`packages/dsh-ghl`):

1. **Дебаг-лог API-использования.** Каждая операция с GitHub API логируется одной строкой вида
   `GET 200 https://api.github.com/repos/Apkawa/dsh-plugins/issues [cached|cache-miss]` — видно, как часто дёргается API и каков статус кеша (hit / miss).
2. **Кэш: 1 минута + ETag.** Глобальный (process-wide) кэш в разрезе репозитория с TTL 1 минута и revalidation через ETag (`If-None-Match` → `304 Not Modified` → тело из кеша).
3. **UI: reload при ошибке.** В состоянии ошибки — кнопка/ссылка «Reload» для повторной загрузки без закрытия и повторного открытия вкладки.
4. **UI: кнопка обновления над списком issues.** Обычный клик — refresh; клик при зажатом Ctrl — принудительное обновление с очисткой кеша.

Out of scope:
- смена источника данных (GitHub REST API остаётся), авторизация/токены;
- изменение rate-budget (60 req/h) — он остаётся;
- force-refresh для `getIssue`/`select()` — только для списка (кнопка живёт над списком);
- миграция на хостовый `ctx.logger` — остаётся существующий паттерн `dbg`.

## Approach

### 1. Дебаг-лог

- Логируется существующим `dbg` (`src/log.ts`: gate `DEBUG === '1'`, `console.*`, тег `[ghl]`) — тот же паттерн, что у `dsh-model-settings`; хостовый `ctx.logger` не используется ни одним плагином репо, конформность важнее.
- Строка формируется в **слое кеша** (единственное место, откуда известны и решение cached/miss, и HTTP-статус): кэш-враппер знает, было ли обращение к провайдеру, а статус приходит из провайдера (см. п. 2 — Entry хранит `status`).
- Формат: `GET <status> <url> [cached]` на hit (status — сохранённый), `GET <status> <url> [cache-miss]` на miss (200 — свежее тело, 304 — revalidation, тело из кеша).

### 2. Кэш 1 минута + ETag

- Кэш **уже** глобальный (одна инстанция на хост-процесс, создаётся в `apply`) и уже в разрезе репо (ключи `get:{owner}/{repo}:{number}`, `list:{owner}/{repo}[:query]`) — меняется TTL: `DEFAULT_TTL_MS` 5 мин → **1 мин** (negative-кэш 404 уже 60 с, остаётся).
- `Entry` получает поля `status: number` и `etag?: string`.
- Контракт `BaseIssue` расширяется минимально: методы принимают опциональные `opts?: { etag?: string }` и возвращают `{ value, status, etag? }`. Провайдер `GitHubIssue` шлёт `If-None-Match` (когда etag есть), обрабатывает `304` (возвращает статус 304 без тела) и `200` (тело + `ETag` заголовок ответа).
- Логика кеша: miss → вызов провайдера с сохранённым etag → 304: продлить entry, вернуть сохранённое значение; 200: сохранить значение + etag + status; hit: вернуть сохранённое.
- Rate-budget (`guard`, 60/h) и negative-кэш 404 — без изменений.
- **Очистка кеша** (для force-refresh): `createIssueCache` начинает возвращать объект с методом очистки записей репо (в дополнение к `BaseIssue`-методам) — нового паттерна в соседних плагинах нет, это новая возможность.

### 3. UI: reload при ошибке

- В error-блоке `IssuePane` — кнопка «Reload» (ghost sm capsule, как `.secondaryButton` у `dsh-model-settings` / `.back` у самого ghl, `data-testid`), `onClick` → `void refresh(workspacePath)`.
- Ошибка снимается успешным `refresh` — существующее поведение стора, менять не нужно.

### 4. UI: кнопка обновления + Ctrl-force

- Над списком issues — кнопка обновления (тот же ghost sm capsule), обычный клик → `refresh(workspacePath)`.
- Клик при `ctrlKey` → `refresh(workspacePath, true)`: клиент кладёт `force: true` в payload `listIssues`; хост (`dispatch`) читает флаг и через новый метод очистки удаляет записи репо из кеша до запроса.
- `force` — опциональное поле в payload `listIssues` (ad-hoc-валидация `listParams` расширится); без флага поведение как сейчас.

## Constraints

- Стек: TS, host (tsc) + client (tsdown, React), vitest (unit + e2e lanes), playwright acceptance; DSH 0.2.0-rc.2, RPC через prefix-роут `/ghl` на host webServer (workaround сломанного host-RPC).
- Кэш: in-memory `Map`, одна инстанция на хост-процесс; rate-limit GitHub 60 req/h без токена — budget-guard обязателен.
- `Fetcher = (url, init?) => Promise<Response>` — headers уже могут передаваться, но текущий контракт `BaseIssue` их не трит.
- UI: только plain `<button>` + CSS-модули, `--dsw-alias-*` токены, ghost sm capsule (h28/r14), `data-testid` на интерактивных элементах; клиентский бандл — reload страницы.
- Тесты: TDD, unit-тесты на in-process doubles без сети; закреплённые инварианты кеша (ключи, TTL, 404-neg, budget) — см. `tests/unit/server/cache.test.ts`.
- Конвенции репо: `dbg`-логирование, conventional commits, pnpm frozen, temp в `.tmp/`.

## Open questions

none — все вопросы черновика закрыты research'ом:
- лог — через существующий `dbg`, строка из слоя кеша;
- «глобально в разрезе репо» — кэш уже process-wide и per-repo, меняется TTL и добавляется ETag;
- UI-запросы — RPC `/ghl`, `force` — новое опциональное поле payload `listIssues`;
- паттерна force в соседних плагинах нет — новая возможность, дизайн в Approach.

## Changes

- 2026-10-13T11:35:49+03:00 -- v1, initial spec (draft + research)
