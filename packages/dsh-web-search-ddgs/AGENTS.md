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
* Logging: shared `@apkawa/utils` `Log` (gated on `DEBUG=1`, errors always loud).

**Tests**: `tests/unit/server/<module>.test.ts` — vitest node env, in-process spawner/seam doubles, no network.

**E2E**: `tests/e2e/server/*.test.ts` (120 s timeouts) — boots a live independent `dsh web` with the plugin linked via the vitest wrapper `tests-helpers/e2e/dsh-fixture.ts` over the shared launch core `tests-helpers/e2e/dsh.ts` (manual CLI `scripts/e2e-live.ts` at the repo root). `boot.test.ts` runs the version matrix via `describe.each(E2E_DSH_VERSIONS)` and asserts the plugin is listed and serves HTTP 200; `live-search.test.ts` runs a real ddgs search through the real runner; `backends.test.ts` runs one real search per backend over `duckduckgo`, `bing`, and `yandex` against a single shared venv. The live-search and backends tests self-skip when `uv` is absent, and both set `process.env.UV_CACHE_DIR` to the repo-local `.cache/uv` because the sandbox makes `~/.cache/uv` read-only. `pnpm test:e2e`; `pnpm e2e:live` boots a throwaway instance manually (`--keep` preserves the temp root, `--version` selects the dsh). Test files import the helpers via the `@root/tests-helpers/…` alias; versions auto-provision into throwaway projects under `.tmp/dsh-versions/<version>` on first launch.
