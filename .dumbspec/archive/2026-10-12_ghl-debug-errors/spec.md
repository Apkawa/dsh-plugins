# 2026-10-12_ghl-debug-errors: dsh-ghl — прозрачные ошибки и отладочные логи

**Created:** 2026-10-12T17:12:29+03:00

## Scope

В скоуп:
1. **Корневая причина `repo: null`**: хост-часть плагина выполняет `git remote get-url origin` в CWD процесса dsh-хоста, а не в директории workspace (workspace-контекста на хосте нет вообще). Фикс: резолвить путь workspace (dsh-шим `ctx.workspaceRegistry`) и запускать git в этой директории.
2. **Прозрачность API**: эндпоинт `detectRepo` возвращает failure с причиной (`no-workspace` / `no-remote` / `not-github` / `ambiguous-workspace`) вместо постоянного `ok: true, repo: null`; существующие failures (`no-repo`, `rate-limit`, `not-found`, `internal`) доходят до клиента с сообщением.
3. **UI**: клиент сохраняет RPC-failures (code + message) и отображает их в панели вместо тихой деградации в «No issues»; сообщение GitHub rate-limit выводится как есть.
4. **Отладочные логи**: gated-логгер по образцу `packages/dsh-model-settings` (`src/log.ts`: `DEBUG=1`, тег `[ghl]`, негated `error`), расставленный по точкам: workspace/git-резолв, HTTP-запросы, RPC-failures, бюджет кэша.
5. **Токен остаётся необязательным**: кода токена в плагине нет и не добавляется — плагин уже работает unauthenticated на free limits (60/h, локальный бюджет в `cache.ts`); это фиксируется в README.

Не в скоуп:
- добавление поддержки токена (не запрашивалось);
- починка host-side `connection` RPC-канала в dsh 0.2.0-rc.2 (существующий `webServer`-workaround сохраняется);
- client-side логи (reference-пакет не логит на клиенте);
- рефакторинг логики кэша/TTL.

## Approach

- **Хост — workspace-aware detection**: `gitRemoteUrl(cwd)` принимает `cwd` для `execFile`. Резолв workspace (хост): `payload.workspacePath` (валидированный non-empty string) имеет приоритет — клиент шлёт его (см. ниже); fallback — `workspaceRegistry.list()` → 1 → его `path`; 0 → failure `no-workspace`; >1 → failure `ambiguous-workspace` (со списком путей). Детект всегда даёт структурированный результат: success (`repo`) или failure с кодом и сообщением — без тихих `null`.
- **Хост — прозрачный RPC**: `detectRepo` возвращает `ok: false` с кодом и сообщением при неудаче детекта (больше нет `ok: true, repo: null`); остальные эндпоинты не меняются, `rate-limit` несёт сообщение GitHub API.
- **Клиент — отображение ошибок**: `callRpc` бросает типизированную ошибку, сохраняющую `code`/`details`; store получает поле `error`; `refresh`/`select` ловят failure, записывают в store и publish; `IssuePane` рендерит error-ветку (message + code) — текст «No GitHub repository detected» появляется только при server-side no-repo-failure с причиной. Клиент деривирует свой workspace path по образцу `dsh-global-queue` (`workspaces`-сервис + session id) и включает `workspacePath` в RPC-payload (хост его валидирует — e2e-проверенный прецедент sibling-плагина).
- **Логи**: копирование `src/log.ts` из `dsh-model-settings` с `TAG = '[ghl]'`; точки: workspace/git-резолв (команда, cwd, результат), HTTP-запросы (URL, статус), RPC-failures, срабатывание бюджета кэша; тест-зеркало `tests/unit/server/log.test.ts`; секция «Debugging» в README.
- **TDD** на каждом этапе; unit-тесты без сети (in-process doubles, записанные fixtures); `pnpm typecheck` из директории пакета.

## Constraints

- Cordis-плагин `@apkawa/dsh-ghl`, host + client halves; хост маунтит префикс `/ghl` на host `webServer` (задокументированный 0.2.0-rc.2 workaround — host `connection`-канал сломан), поэтому хэндлер видит только `req`/`res`, на wire нет peer/workspace.
- Dsh-шим `ctx.workspaceRegistry` (`list(): Workspace[]`, `Workspace.path`) **подтверждён в 0.2.0-rc.2** (Stage 1): `dsh/packages/workspace/workspace/src/index.ts:113-116`; e2e-проверенный прецедент — `dsh-global-queue` (`inject` + structural mirror, `src/index.ts:18,102-130`).
- Клиентский шим 0.2.0-rc.2: `workspaces`-сервис (`IWorkspaces`, `WorkspaceView { workspaceId, path, sessionIds }`) и хук `useWorkspaces`; «моя workspace» = строка, чей `sessionIds` содержит session id (прецедент `dsh-global-queue`, `AddToQueue.tsx:40`). App-level «current workspace» не существует.
- Токен нигде в плагине не читается — unauthenticated API by design, локальный бюджет 60/h (`src/cache.ts`).
- Конвенции репо: frozen pnpm installs, TDD, `pnpm typecheck` (не голый `tsc`), Conventional Commits, temp-файлы в `.tmp/`, e2e-матрица версий 0.2.0-rc.2.
- Reference для логов: `packages/dsh-model-settings/src/log.ts` + `tests/unit/server/log.test.ts` + README.

## Open questions

- (решено) почему `repo: null` — CWD хост-процесса, а не workspace (R1/R2).
- (решено) блокирует ли токен — нет, кода токена нет (R1).
- (решено в Stage 1) `workspaceRegistry` доступен в 0.2.0-rc.2; дизамбигуация — hybrid: клиент шлёт `workspacePath` в payload, fallback хоста через `workspaceRegistry` (1 → path, 0 → `no-workspace`, >1 → `ambiguous-workspace`).

## Changes

- 2026-10-12T17:12:29+03:00 -- v1, initial spec (draft + research)
- 2026-10-12T18:04:22+03:00 -- Stage 1: подтверждён `workspaceRegistry`-шим в 0.2.0-rc.2 (прецедент `dsh-global-queue`); принят hybrid-резолв — клиент шлёт `workspacePath` в payload, fallback хоста через `workspaceRegistry` (1 → path, 0 → `no-workspace`, >1 → `ambiguous-workspace`)
