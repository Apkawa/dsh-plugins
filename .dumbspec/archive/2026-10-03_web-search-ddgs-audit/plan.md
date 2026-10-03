# 2026-10-03_web-search-ddgs-audit: implementation plan (web-search-ddgs audit)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Create `draft.md` (raw input verbatim)
- [x] Initial `spec.md` skeleton from the draft
- [x] Research: package structure, dsh 0.2.0 seam, e2e infra (appended to `research.md`)
- [x] Spec v1 (full format) + plan

**Criterion:** `draft.md`, `research.md`, `spec.md` (v1), `plan.md` exist; branch `2026-10-03_web-search-ddgs-audit` created.
**Commit:** `docs(web-search-ddgs): dumbspec task draft, research, spec v1, plan`

## Stage 1 — Baseline: run existing tests
- [x] Run unit tests (`pnpm test`) in `packages/dsh-web-search-ddgs`; record pass/fail (23/23 green)
- [x] Run e2e lane (`pnpm test:e2e`): boot matrix + live-search on 0.2.0-rc.2; record pass/fail/skip (boot 2/2 green; live-search 1/2 red — uv cache `~/.cache/uv` read-only under workspace-write sandbox, environmental)
- [x] Record baseline findings in `research.md`

**Criterion:** baseline test results recorded in `research.md` with exact output summaries.
**Commit:** N/A

## Stage 2 — Backend verification (which ddgs backends work)
- [x] Probe each backend (duckduckgo, bing, yandex) via the real runner with a temp venv; record which answer and which fail (typed errors) — all three work on ddgs 9.16.0 (latest)
- [x] Add/adjust tests so the yandex re-registration path in `ddgs-search.py` is covered — new `tests/e2e/server/backends.test.ts` (shared venv, `describe.each` over the 3 backends, self-skip without `uv`, `UV_CACHE_DIR` pointed at repo-local `.cache/uv`); green
- [x] Pin `ddgsVersion` if latest proves fragile for the yandex monkey-patch (only if the probe shows breakage) — NOT needed: latest (9.16.0) works for yandex too
- [x] Record per-backend status in `research.md`

**Criterion:** per-backend status (works / fails + why) recorded; yandex path covered by a test.
**Commit:** `test(web-search-ddgs): e2e per-backend coverage (duckduckgo, bing, yandex)`

## Stage 3 — E2E fixes/updates
- [x] Fix any e2e breakage on 0.2.0-rc.2 that belongs to this package (not upstream) — `live-search.test.ts` UV_CACHE_DIR fix (sandbox read-only `~/.cache/uv`)
- [x] Ensure `boot.test.ts` and `live-search.test.ts` pass (or are legitimately skipped with a recorded reason) — full lane 7/7 green on re-run (run 1 had 3 flaky `No results found` live-network failures)

**Criterion:** `pnpm test:e2e` green (or documented skip) on 0.2.0-rc.2.
**Commit:** `fix(web-search-ddgs): point e2e uv cache at repo-local dir (sandbox read-only ~/.cache/uv)`

## Stage 4 — Docs update
- [x] Update `README.md`: real backend status, correct replacement procedure for 0.2.0 (profile patch `searchProvider: ddgs`, config beats env), current test setup
- [x] Update `AGENTS.md` to match code/docs reality
- [x] Fix stale bits: `package.json` description (yandex→duckduckgo default), `cordis.patch.yml` header comment, `provider.ts` fossil comment (`runner.ts` had no fossil)
- [x] Verify `pnpm typecheck` green after doc-adjacent edits

**Criterion:** README/AGENTS/package.json describe reality; typecheck green.
**Commit:** `docs(web-search-ddgs): backend status, 0.2.0 replacement procedure, test setup; fix stale yandex references`
