# Research — 2026-10-13_dsh-ghl-improvements

## R1: plugin architecture & API calls (packages/dsh-ghl)

- **GitHub API calls:** `src/issues.ts`, class `GitHubIssue`, method `request(repo, path, number?)`. Injected `fetcher` boundary = `globalThis.fetch` (passed in `src/index.ts:43` `apply`). No token, public REST API.
  - Endpoints: `GET /repos/{owner}/{repo}/issues` (state/per_page/page) and `GET /repos/{owner}/{repo}/issues/{number}`.
  - Status handling: 403/429 → `RateLimitError`, 404 → `IssueNotFoundError`, other `!ok` → throw.
  - Already logs `dbg.debug('request: GET', path)` per request.
- **Existing cache:** `src/cache.ts`, `createIssueCache(provider, options)` — in-memory `Map`:
  - Keys: `get:{owner}/{repo}:{number}`, `list:{owner}/{repo}` + serialized state/per_page/page.
  - TTL: 5 min success (`DEFAULT_TTL_MS`), 60 s negative for `IssueNotFoundError` only; RateLimitError/other errors not cached.
  - Budget: sliding 1 h window, 60 upstream calls (`guard`) — guards unauthenticated 60 req/h GitHub limit.
  - **No ETag / If-None-Match / 304 handling.**
  - Instance: one per host session, created in `apply` (`src/index.ts`); comment: "keeps the rate-limit budget window process-wide".
- **Host → UI:** dsh carrier RPC over HTTP prefix route `/ghl` on host webServer (`src/rpc.ts` `mountChannel`, mounted in `apply` via `ctx.inject(['webServer'], ...)` — the 0.2.0-rc.2 host-RPC workaround). Envelope `{type:'client-request',rpcId,method,payload}` → `{type:'server-response',rpcId,result:{ok,value}|{ok,error:{code,message,details}}}`. Methods: `detectRepo`, `listIssues`, `getIssue` (`dispatch`, `src/rpc.ts:163-190`).
- **Client:** `src/client/index.ts` — `callRpc<T>(method, payload)` over `connection.rpc.call('/ghl', …)`; shared issue snapshot store (`refresh`/`select`/`back`); `refresh()` = `detectRepo` then `listIssues`; `select()` = `getIssue`. UI pane: `src/client/IssuePane.tsx`.
- **Package structure:** host entry `src/index.ts`→`lib/index.js` (plugin `ghl`, inject `['workspaceRegistry']`, empty `Config`); client entry `src/client/index.ts`→`lib/client.js` (React tab `@apkawa/dsh-ghl`, seat `sidebar.right.pane.tab`); build `pnpm build` = `tsc` + `tsdown`; unit tests `tests/unit/server/{repo,github-issue,cache,rpc,log,git-remote-url,repo-workspace}.test.ts` + `tests/unit/client/{format,issue-store,issue-store-error,rpc-client}.test.ts` (vitest); e2e `tests/e2e/server/{boot,rpc}.test.ts` (vitest e2e lane) + `tests/e2e/acceptance.spec.ts` (playwright).
- Notable: `src/log.ts` (`dbg` logger) exists and has a unit test `tests/unit/server/log.test.ts`; client already has `issue-store-error` test.

## R2: logging mechanism

- `packages/dsh-ghl/src/log.ts` (19 lines): hand-rolled `dbg` over `console.*`, gated on exact `process.env.DEBUG === '1'`, tag `[ghl]`; `dbg.error` never gated. Methods: log/info/warn/debug/error. Test `tests/unit/server/log.test.ts` asserts gating and `error` always-on.
- Host-side `dbg` call sites: `src/issues.ts:87` (`dbg.debug('request: GET', path)` per outgoing request), :89-91 (rate limit / 404 / failure → `dbg.error`), `src/cache.ts:91` (`dbg.warn` budget exhausted), `src/repo.ts` (several `dbg.debug` traces), `src/rpc.ts:23` (`dbg.error`). **Nothing logs cached/cache-miss today.**
- Siblings: `dsh-global-queue` has no host logging; `dsh-model-settings` has an identical `dbg` pattern (`TAG='[model-settings]'`) with per-request `dbg.debug('fetchModels GET <url> ...')` in `src/probe.ts`.
- DSH host API has a first-class logger: Cordis context `ctx.logger` / `ctx.logger(name)` (`dsh/vendor/cordis/src/context.ts:27`, `logger.ts`; console exporter in `dsh/vendor/logger-console/src/shared.ts`). **None of the three repo plugins uses it** — all use the local `dbg`-over-console pattern.
- Conformance: the repo-wide established pattern is the local `dbg` module; `ctx.logger` is the host-native alternative (not used by any sibling plugin).

## R3: client UI — error state & button conventions

- `IssuePane.tsx`: single component, states in priority order **error → no repo → detail → empty → list**; no explicit loading state. Error state (L39–48) is a **dead-end**: message + code, no button/retry. `data-testid="ghl-pane"` root, `ghl-error` on the error block.
- Store lives in `src/client/index.ts` (no separate issue-store.ts): state `{ repo, issues, selected, error: {code,message}|null }`; `refresh(workspacePath?)` = detectRepo → listIssues; on failure records error and **resolves** (no throw); **error is cleared only by a successful refresh** — no dismiss action exists. `select()` failure keeps previous selection.
- `tests/unit/client/issue-store-error.test.ts` pins: detection failure → repo null + error, only detectRepo called; list failure → repo kept + error; success after failure clears error; select failure keeps selection. No dismiss behavior tested/exists.
- Sibling button conventions: plain `<button type="button">` + CSS-module classes, "ghost sm capsule" (h28/r14, `--dsw-alias-border-l2`, transparent, hover tone, focus-visible ring, disabled opacity 0.4), `data-testid` on interactive elements. Direct analogue: model-settings `ReasoningSection.tsx:53` — **Retry button in error state** (`css.secondaryButton`, `onClick={() => props.loadRows()}`); `ReasoningSection.tsx:222–227` — Refresh button with `disabled={saving || refreshing}`.
- Tab registration (`src/client/index.ts` apply): `IssuePane` receives only `sessionId` + injected `useWorkspaces`; the tab face exposes no close/dismiss API. `refresh(workspacePath?)` is importable in `IssuePane` — the hook point for refresh/retry controls.

## R4: cache internals & force-refresh patterns

- `cache.ts` (114 lines): `Entry = { expires: number; notFound: IssueNotFoundError|null; value: Issue|IssueListResult|null }` — **no HTTP metadata fields**. Keys: `get:{owner}/{repo}:{number}`, `list:{owner}/{repo}[:{state/perPage/page suffix}]` (repo embedded in key string — global Map, per-repo entries). `lookup` expires at `now >= expires`; `miss` stores success at `t + ttlMs` (default 5 min), only `IssueNotFoundError` at 60 s; rate-limit/other errors never cached. `guard`: sliding 1 h window, 60 calls, throws `RateLimitError` when full. Public surface: `createIssueCache(provider, { now?, ttlMs?, budgetPerHour? }): BaseIssue` — **no invalidate/clear/force method; internal Map unreachable.**
- `issues.ts`: `BaseIssue { listIssues(repo, params?); getIssue(repo, number) }`; `Fetcher = (url: string, init?: RequestInit) => Promise<Response>` — `RequestInit` exists but the contract **cannot thread headers** (no param to pass `If-None-Match`). `GitHubIssue.request` calls `this.fetcher(url)` with **no init, no headers**; 304 would fall into `!response.ok` and throw — **no 304 handling**.
- `index.ts` apply: one `createIssueCache(new GitHubIssue(globalThis.fetch), { now: Date.now })` per host session (process-wide), mounted on `/ghl` via `ctx.inject(['webServer'], …)`. So the cache is **already global (process-wide) and per-repo** — the 1-min-TTL + ETag requirement is a TTL constant change + ETag plumbing.
- **No force/bypass/no-cache flag pattern exists** in `dsh-model-settings` or `dsh-global-queue` host RPC (grep: only unrelated `force` hits). New territory — design needed.
- `rpc.ts` dispatch: `detectRepo` / `listIssues` (ad-hoc `listParams` validation reads `{state?, perPage?, page?}`, null on mis-typed) / `getIssue` (`payload.number`). `payload: unknown` — no dedicated payload types, no `force` field today.
- `tests/unit/server/cache.test.ts` pinned: repeated get/list served from cache; refetch after TTL; no sharing across keys; budget fail-fast + sliding release; 404 negative cache 60 s; RateLimitError not cached. **Nothing pins invalidation/clear/force** (none exists).
