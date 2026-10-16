# 2026-10-07_dsh-ghl: implementation plan (dsh-ghl — GitHub issue, read-only)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

**1-я итерация scope:** пакет `dsh-ghl` (host + client) — read-only GitHub issue без токенов: `BaseIssue`/`GitHubIssue`, repo detection из `git remote`, RPC `/ghl`, host-кэш, правый сайдбар (мини-SPA: список → detail, статус-цвет, ссылка на github.com). `#`-composer отложен в follow-up (зависит от upstream-PR в dsh core).

---

## Stage 0 — Research + spec + plan
- [x] Бранч `2026-10-07_dsh-ghl`; `draft.md` (raw input) + `docs/ghl/api-github.md` в ветке
- [x] `spec.md` skeleton + refinement (решения: автоподстановка, git remote, `[название #N]`, wf=Actions)
- [x] Research (`research.md`): структура пакетов, `@`-чипы/submit, сайдбар, host↔client API, GitHub API, discovery
- [x] Deep-dive `#`-триггера (блокирующий вопрос): не feasible без правки dsh core → отложен
- [x] `spec.md` v1 (Created + Changes) + scope-решение (отложить `#`)
- [x] `plan.md`

**Criterion:** все 4 файла задачи существуют; scope 1-й итерации подтверждён пользователем.
**Commit:** `aeac19e docs(dsh-ghl): dumbspec task — spec + plan for read-only GitHub issue plugin`

## Stage 1 — Package scaffold
- [x] Создать `packages/dsh-ghl/`: `package.json` (`dsh.bundle.patch`, `dsh.client` inject: sidebar-right/workspace/connection/modules/ui-slots), `cordis.patch.yml` (`- insert`), `tsconfig.json` + `tsconfig.client.json`, `tsdown.config.ts`, `vitest.config.ts`, `vitest.e2e.config.ts`, `AGENTS.md`
- [x] Пустой host-entry (`src/index.ts`: function plugin `name`/`inject`/`Config`/`apply`, без default export) + client-entry (`src/client/index.ts`)
- [x] `pnpm typecheck` и `pnpm build` проходят для нового пакета
- [x] Новый importer в `pnpm-lock.yaml` (install через npmjs.org, без mirror-загрязнения)

**Criterion:** `pnpm typecheck` + `pnpm build` зелёные; пакет собирается как bundle.
**Commit:** `ea872bc feat(dsh-ghl): scaffold package`

## Stage 2 — Host: BaseIssue + GitHubIssue (TDD)
- [x] Определить `BaseIssue` (list/get) + типы `Issue`/`RepoRef`/`ListIssuesParams`/`IssueListResult`; интерфейс `Fetcher` (инжект, не `fetch`)
- [x] RED: unit-тесты `GitHubIssue` против записанных fixtures (list, get, 404, rate-limit 403/429) — без live-сети
- [x] GREEN: реализовать `GitHubIssue` поверх `Fetcher` к `https://api.github.com` (+ `IssueNotFoundError`, `RateLimitError`)
- [x] Refactor

**Criterion:** unit-тесты `GitHubIssue` против fixtures зелёные; live-сети в unit-тестах нет.
**Commit:** `0ca7faf feat(dsh-ghl): BaseIssue + GitHubIssue provider`

## Stage 3 — Host: repo detection + cache (TDD)
- [x] RED: тесты repo detection (github URL → `owner/repo` https/scp/ssh; не-GitHub / отсутствует → graceful null)
- [x] GREEN: реализовать `parseGithubRemote` + `detectRepo` (инжект `getRemoteUrl`, git не вызывается)
- [x] RED: тесты кэша (TTL, keys, бюджет 60 req/h sliding, negative-cache 404, 429 не кэшируется)
- [x] GREEN: реализовать `createIssueCache` (TTL + budget + negative, injectable `now`)

**Criterion:** unit-тесты detection + cache зелёные.
**Commit:** `5dfe69c feat(dsh-ghl): repo detection + issue cache`

## Stage 4 — Host: RPC /ghl channel (TDD)
- [x] RED: тесты `makeRpcHandler`/`endpointFromPath`/`handleRequest`-wire/`mountChannel` — endpoints `listIssues`/`getIssue`/`detectRepo` (wire-формат, `RpcResult` ok/error, `rpcFailure`)
- [x] GREEN: реализовать prefix-роут `/ghl` + dispatch endpoint'ов (+ маппинг `IssueNotFoundError`→not-found, `RateLimitError`→rate-limit)
- [x] Провести host `apply()` → mount канала через nested `ctx.inject(['webServer'], …)` (+ `gitRemoteUrl` shell-out в `repo.ts`)

**Criterion:** unit-тесты RPC-канала зелёные.
**Commit:** `645146a feat(dsh-ghl): /ghl RPC channel`

## Stage 5 — Client: right sidebar issue tab (TDD)
- [x] RED: client-тесты чистого логика — snapshot-store (refresh/select/back/subscribe, fake RPC) + format (statusToken, issueRef); без jsdom
- [x] GREEN: store в `client/index.ts` (+ `setRpc` seam), `ctx.sidebarRightTabs.register({id, kind, title})`, тело `IssuePane` под `sidebar.right.pane.tab` (keyed by id), list + detail-вид, статус-цвет (open/closed), ссылка на github.com; данные через RPC `/ghl`
- [x] Refactor (+ `css-modules.d.ts`, ambient `*.module.css`)

**Criterion:** client unit-тесты зелёные; вкладка открывается и рендерит список/detail.
**Commit:** `b487023 feat(dsh-ghl): right sidebar issue tab`

## Stage 6 — e2e + acceptance
- [x] e2e boot smoke (version matrix `0.2.0-rc.2`): плагин грузится, HTTP 200 (изолированный `DSH_HOME`, без live-сети)
- [x] e2e RPC lane (version matrix): `detectRepo`→null, `listIssues`/`getIssue`→`no-repo`, unknown→`internal` (throwaway CWD = fresh git repo без origin)
- [x] Acceptance (playwright lane): вкладка "Issues" открывается по guide-entry, рендерит `ghl-pane` + no-repo состояние, без console-ошибок (live-данные не проверяются — launcher не даёт CWD в GitHub-репо, без правок shared-инфраструктуры)
- [x] `pnpm typecheck` + `pnpm test` + `pnpm test:e2e` + playwright зелёные
- [x] Баги, найденные линиями: host `Config` → `z.object({})` (schemastery) + `ctx.inject(['webServer'])` (не `ctx.get`/`ctx.webServer`); клиентский `guide`-entry (без него вкладка не открывалась)

**Criterion:** `pnpm test:e2e` проходит; acceptance демонстрирует вкладку→pane→no-repo состояние.
**Commit:** `c68363e test(dsh-ghl): e2e boot smoke + acceptance`
