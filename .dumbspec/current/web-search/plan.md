# web-search (ddgs): implementation plan

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan

- [x] Refine/confirm draft (autonomous per user instruction)
- [x] Research dsh web-search architecture (seam / providers / consumer)
- [x] Install ddgs, map internals, find the disabled yandex engine
- [x] Verify yandex activation + rate-limit characteristics + whitelist reachability
- [x] Measure uvx overhead → managed-venv decision
- [x] Write spec.md, review open questions (ctx.get seam access, venv self-heal)

**Criterion:** `draft.md`, `research.md`, `spec.md`, `plan.md` exist; yandex verified working via ENGINES injection.
**Commit:** `docs(web-search): add dumbspec task draft, research, spec, plan`

## Stage 1 — Package skeleton

- [ ] `packages/dsh-web-search-ddgs/`: package.json (`@apkawa/dsh-web-search-ddgs`, peers cordis/schemastery), tsconfig.json (mirror dsh-model-settings), vitest.config.ts, cordis.patch.yml (insert row)
- [ ] `src/index.ts` stub: `name = 'web-search-ddgs'`, `inject = ['web']`, `Config` (z, optional fields), `apply` placeholder
- [ ] Sanity test (plugin identity + apply hook) — red → green
- [ ] `pnpm typecheck` clean, tests green

**Criterion:** new package builds, typechecks, sanity test green; pnpm workspace picks it up.
**Commit:** `feat(web-search-ddgs): scaffold plugin package`

## Stage 2 — Python script + runner module

- [ ] `ddgs-search.py` (query/backend/max-results/timeout args, yandex ENGINES injection, JSON stdout)
- [ ] Runner unit tests (fake spawn): success + JSON→sources mapping (href→url, body→snippet, empty fields dropped), non-zero exit → error with stderr, subprocess timeout kills child, abort signal kills child, venv setup (missing `bin/python` → `uv venv` + `uv pip install`; missing `bin/ddgs` → reinstall)
- [ ] Implement `src/runner.ts` (spawn factory injectable; uv/venv logic) — green
- [ ] `pnpm typecheck` clean

**Criterion:** runner unit tests green (no network); live smoke of `ddgs-search.py` via the real venv returns yandex JSON (manual check, self-skip in tests).
**Commit:** `feat(web-search-ddgs): ddgs runner with managed uv venv`

## Stage 3 — Provider + composition

- [ ] Provider unit tests (TDD): `id`/`available()` (venv-or-uv, no network), search maps runner output → `WebSearchResult` (`truncated: false`, no `content`), **serialization** (concurrent searches run sequentially), timeout/abort forwarded
- [ ] Implement `src/provider.ts` (`DdgsSearchProvider`) — green
- [ ] Composition test: `apply` registers the provider into the web seam (`ctx.get('web')` pattern) with config defaults; fiber dispose removes it
- [ ] `src/index.ts` real wiring; local seam types module (no declaration-merge clash with dsh)
- [ ] `pnpm build` + `pnpm typecheck` clean, all unit tests green

**Criterion:** unit suite green; composition test proves registration/disposal; build emits lib/.
**Commit:** `feat(web-search-ddgs): ddgs search provider over ctx.web`

## Stage 4 — Live e2e + docs

- [ ] `scripts/e2e-live.mjs` (mirror dsh-model-settings): throwaway `dsh web` + `dsh plugin add`, ready line
- [ ] e2e test: plugin loads in the live instance (assert boot success)
- [ ] Integration test (self-skip without uv/network): real `<venv>/bin/python ddgs-search.py` against yandex → yandex sources
- [ ] README.md (usage, config, provider-selection note, rate-limit + known limitations)
- [ ] Full `pnpm typecheck` + `pnpm test` green; e2e verified live once

**Criterion:** live e2e boots dsh with the plugin; real yandex search verified (or self-skipped with a reason); README documents MVP limits.
**Commit:** `test(web-search-ddgs): live e2e + docs`
