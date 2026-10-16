# 2026-10-07_dsh-ghl: dsh-ghl (GitHub Like)

**Created:** 2026-10-07T16:01:59+03:00

## Scope

В первой итерации — новый Cordis-плагин `packages/dsh-ghl` (host + client) для **read-only** доступа к GitHub issue **без токенов** (публичное API).

В scope (1-я итерация):

- **Пакет `packages/dsh-ghl`** по образцу `dsh-model-settings` / `dsh-global-queue` (host + client, Cordis bundle).
- **Host:**
  - **`BaseIssue`** (абстракция провайдера issue) + **`GitHubIssue`** (реализация поверх публичного API, без токена) — задел под Gitea / Gitverse без их реализаций.
  - **Repo detection:** `owner/repo` из `git remote` рабочего каталога сессии.
  - **RPC-канал `/ghl`** (prefix-роут на host `webServer`): endpoints `listIssues`, `getIssue`, `detectRepo`. Схемы — schemastery.
  - **Кэширование** на host под лимит **60 req/h unauthenticated**.
- **Client — правый сайдбар:** новая вкладка (мини-SPA): список issue, переход в конкретный issue (в текущей вкладке, detail-вид), статус (Open — зелёный, Closed — пурпурный), ссылка на страницу issue на github.com.

Out of scope (1-я итерация) — отложено в follow-up задачу:

- **`#`-composer** (триггер `#`, автодополнение, статус-цветной чип, автоподстановка issue в контекст при отправке). Блокируется upstream-PR в dsh core (расширение `TriggerChar` + ветка `#` в `detectTrigger`); `dsh/` в этом репо — read-only symlink, правка core делается в отдельном репозитории `deepseek-harness`.
- Gitea, Gitverse — только интерфейс `BaseIssue`, без реализаций.
- Write-операции (создание/изменение issue/комментариев), авторизация по токенам.
- GitHub Actions workflows (`wf`).
- Статусы issue кроме Open/Closed (Draft/PR).

**Решение для follow-up (`#`-composer):** формат автоподстановки в контекст — заголовок + `#номер` + body (KISS).

## Approach

- **Пакет:** `packages/dsh-ghl` — host half (`src/*.ts`) + client half (`src/client/*`), `package.json` с `dsh.bundle.patch` + `dsh.client` (inject: `dsh-client-ui-sidebar-right`, `dsh-client-ui-workspace`, `dsh-client-connection`, `dsh-client-modules`, `dsh-client-ui-slots`), `cordis.patch.yml` (`- insert`), tsconfig ×2, tsdown browser-bundle, vitest ×2.
- **Host `BaseIssue`/`GitHubIssue`:** интерфейс провайдера (list/get/detectRepo/status) в host; `GitHubIssue` — реализация поверх `fetch` к `https://api.github.com`. Остальные провайдеры в будущем расширяют тот же интерфейс.
- **Repo detection:** host читает `git remote` рабочего каталога сессии → `owner/repo`.
- **RPC `/ghl`:** собственный prefix-роут на host `webServer` через nested `ctx.inject(['webServer'], …)` (обход 0.2.0-rc.2 host-RPC бага), по образцу `dsh-global-queue` (`src/rpc.ts` `mountChannel`). Endpoints `listIssues` / `getIssue` / `detectRepo`.
- **Кэш:** host-кэш issue-данных (TTL, scope по repo) под 60 req/h.
- **Client сайдбар:** тип вкладки через `ctx.sidebarRightTabs.register({id, kind, title, ...})`, тело под слотом `sidebar.right.pane.tab` (keyed by id), открытие через `ctx.sidebarRight.openTab(kind)` — по образцу `dsh-global-queue`. Mini-SPA: список → detail, статус-цвет, ссылка на github.com.

## Constraints

- Pinned dsh `0.2.0-rc.2`; host `rpc-host` не получает `webServer` → каждый плагин монтирует свой prefix-роут через nested `ctx.inject(['webServer'], …)`.
- **`#`-trigger — не поддерживается core dsh** (`TriggerChar = '/' | '@'`, детекция хардкодится в `ui-input-trigger/src/core/detect.ts`). `#`-composer возможен только после upstream-PR в `deepseek-harness` → отложен из 1-й итерации.
- GitHub unauthenticated rate limit: **60 req/h** (public repo reads) — обязателен host-кэш.
- Репозиторий плагинов: pnpm, замороженные installs, TDD, KISS/SOLID, без новых deps сверх peers; общий e2e-инфра `tests-helpers/e2e/`.
- `docs/ghl/api-github.md` уже в репозитории (untracked), взят в ветку.
- `dsh/` — read-only symlink на `deepseek-harness`; core не меняется из этого репо.

## Open questions

- **Rate limit 60/h:** стратегия кэширования (TTL, scope по repo) — детали в план.
- **Глубина issue-данных в сайдбаре:** только body issue, или также labels/comments — решение в план (KISS: заголовок, #, body, статус, labels).
- **Определение `owner/repo`:** поведение, если git remote отсутствует / не GitHub — решение в план (graceful: пустой список + подсказка).

## Changes

- 2026-10-07T16:01:59+03:00 -- v1, initial spec (draft + research)
- 2026-10-07T16:31:22+03:00 -- пользователь отложил `#`-composer из 1-й итерации (зависит от upstream-PR в dsh core; `dsh/` read-only). 1-я итерация = сайдбар + read-only API + `BaseIssue`/`GitHubIssue` + repo detection. Формат автоподстановки в контекст (для follow-up) зафиксирован: заголовок + `#номер` + body.
