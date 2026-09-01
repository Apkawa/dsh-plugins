# dsh-web-search-ddgs

Host-only Cordis plugin: a ddgs-backed `WebSearchProvider` on the `ctx.web`
seam, so the `web_search` tool runs keyless. Configuration, provider-selection,
and caveats: [README.md](./README.md).

Repo-wide rules (style, commits, TDD, sandbox): [../../AGENTS.md](../../AGENTS.md).

## Build

`pnpm build` = `tsc -p tsconfig.json` → `lib/` (no bundler; `ddgs-search.py`
ships as a file). Host-only plugin: host changes need a full `dsh web`
restart. `pnpm typecheck` is strict tsc over `src/`; `pnpm test` (unit) and
`pnpm test:e2e` are separate runs.

## Project structure

Host half only (`src/*.ts`; pure logic + composition root, unit-tested):

* `index.ts` — composition root: plugin `name`, `inject: ['web']`, the `web-search-ddgs` config schema (`backend`, `maxResults`, `timeoutMs`, `venvDir`, `ddgsVersion`), and provider registration on `ctx.web`.
* `provider.ts` — `DdgsSearchProvider` (`PROVIDER_ID = 'ddgs'`): implements `WebSearchProvider`; serializes searches through an internal queue (the tool fires up to 4 queries concurrently and bursts trip backend rate limits); cheap local `available()` (venv exists or `uv` is on PATH — no network).
* `runner.ts` — spawns `ddgs-search.py` under the managed uv venv with per-search timeout + abort signal; the venv is provisioned lazily on first search (`uv venv` + `uv pip install ddgs`) and self-healed if the install goes missing.
* `ddgs-search.py` — one-shot ddgs text search: JSON array on stdout (exit 0) or a one-line error (exit 1); re-registers the upstream-disabled yandex engine only for `backend=yandex`.
* `log.ts` — `dbg` wrapper, gated on `DEBUG=1`, errors always loud.

**Tests**: `tests/unit/server/<module>.test.ts` — vitest node env, in-process spawner/seam doubles, no network.

**E2E**: `tests/e2e/server/*.test.ts` — boots a live independent `dsh web` with the plugin linked (via `scripts/e2e-live.mjs`); the live-search test runs a real ddgs search through the real runner and self-skips when `uv` is absent. `pnpm test:e2e`; `pnpm e2e:live` boots a throwaway instance manually (`--keep` preserves the temp root).
