# 2026-10-13_dsh-ghl-improvements: implementation plan (dsh-ghl improvements)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Pre-checks (clean tree, branch `2026-10-07_dsh-ghl`)
- [x] `draft.md` — raw input
- [x] Research R1–R4 → `research.md` (architecture, logging, UI, cache)
- [x] `spec.md` v1
- [x] `plan.md`

**Criterion:** all four task files exist; spec has no open questions.
**Commit:** `docs: dsh-ghl improvements spec + plan`

## Stage 1 — Provider: ETag / status / 304
- [x] Red: `tests/unit/server/github-issue.test.ts` — provider sends `If-None-Match` when `opts.etag` given; `200` → `{ value, status: 200, etag }` (etag from response `ETag` header); `304` → status 304, no body parsed
- [x] Green: extend `BaseIssue` contract (`opts?: { etag?: string }`, returns `{ value, status, etag? }`) and `GitHubIssue.request` (init headers, 304 handling)
- [x] Refactor + `pnpm typecheck` + unit tests green (typecheck debt in `cache.ts` carried into Stage 2 by design)

**Criterion:** provider unit tests pass; 304 no longer throws.
**Commit:** `feat(ghl): provider ETag/304 support`

## Stage 2 — Cache: 1-min TTL + ETag revalidation + clear + debug log
- [x] Red: `tests/unit/server/cache.test.ts` — TTL now 60 s (refetch after 60 s); 304 from provider → stored value returned, entry refreshed, no re-store; entry stores `status`/`etag`; `clear(repo)` removes that repo's `get:`/`list:` entries; log line `GET <status> <url> [cached]` on hit and `[cache-miss]` on miss (via console spy / captured dbg)
- [x] Green: `cache.ts` — `DEFAULT_TTL_MS` 1 min; `Entry { status, etag? }`; revalidation flow; expose clear method alongside `BaseIssue` methods; `dbg` log line per operation
- [x] Refactor + existing pinned tests (keys, 404-neg, budget) still green; typecheck debt cleared; `issues.ts` exports `issuesUrl`/`issueUrl` reused by the log line

**Criterion:** cache unit tests pass; hit/miss log line observable with `DEBUG=1`.
**Commit:** `feat(ghl): 1-min ETag cache with clear + api debug log`

_Note for Stage 3: `dispatch` in `rpc.ts` now sees `IssueResult` envelopes — it must unwrap to domain values (`{ issues: result.value }`) as part of the `force` work._

## Stage 3 — RPC: `force` flag on `listIssues`
- [x] Red: `tests/unit/server/rpc.test.ts` — `listIssues` payload `{ force: true }` → cache cleared for the repo before fetch; absent/false → no clear; mis-typed `force` ignored
- [x] Green: `dispatch` reads optional `force`; `RpcDeps` gains the clear function; `index.ts` wiring (no change needed — cache wrapper already matches)
- [x] Refactor + `pnpm typecheck`; envelope unwrapped to domain values in `listIssues`/`getIssue`

**Criterion:** RPC unit tests pass; force path clears repo entries.
**Commit:** `feat(ghl): force refresh on listIssues`

## Stage 4 — Client: `refresh(force)` + UI buttons
- [x] Red: `tests/unit/client/issue-store*.test.ts` — `refresh(workspacePath?, force?)` puts `force: true` into the `listIssues` payload only when forced
- [x] Green: store `refresh` signature + payload
- [x] UI `IssuePane.tsx`: Reload button in error state (`data-testid="ghl-reload"`) → `void refresh(workspacePath)`
- [x] UI `IssuePane.tsx`: Refresh button above the issues list (`data-testid="ghl-refresh"`) → `void refresh(workspacePath, e.ctrlKey)`; disabled while refreshing; ghost sm capsule CSS (`.ghost`) in `issue-pane.module.css`
- [x] Client build + typecheck

**Criterion:** client unit tests pass; buttons rendered per state; Ctrl+click forces.
**Commit:** `feat(ghl-ui): reload on error + refresh button with ctrl-force`

## Stage 5 — Full validation
- [x] `pnpm typecheck` + `pnpm test` (unit) in `packages/dsh-ghl` (120 tests green)
- [x] `pnpm test:e2e` (vitest e2e lane) green (2 files / 6 tests)
- [x] Independent acceptance run verifies the four Criteria (log line format, 1-min+ETag cache, reload button, refresh+Ctrl) — PASS; live `/ghl` RPC exercised end-to-end (rate-limited by GitHub, unit evidence carries the log lines)

**Criterion:** all lanes green; acceptance subagent confirms the observable criteria.
**Commit:** N/A (fixups, if any, get their own commits)
