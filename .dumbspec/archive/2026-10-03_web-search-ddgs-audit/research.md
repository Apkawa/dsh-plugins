# research — 2026-10-03_web-search-ddgs-audit

Superficial context collection for the web-search-ddgs audit. Findings appended as they come in.

## A. Package structure (packages/dsh-web-search-ddgs)

Layout: `src/` (index.ts composition root, provider.ts DdgsSearchProvider, runner.ts subprocess+uv venv, log.ts), `tests/unit/server/` (composition, log, provider, runner, sanity — in-process doubles, no network), `tests/e2e/server/` (boot.test.ts via E2E_DSH_VERSIONS matrix; live-search.test.ts — real duckduckgo search, skips without `uv`, 120s timeout), `ddgs-search.py` (one-shot CLI; re-registers upstream-disabled yandex engine only), `cordis.patch.yml` (inserts `web-search-ddgs` row into profile), package.json, tsconfig, vitest.config.ts, vitest.e2e.config.ts, README.md, AGENTS.md.

Key facts:
- No npm `ddgs` dependency — ddgs is a Python package installed into a managed uv venv at `~/.cache/dsh-web-search-ddgs/venv` (default) via `uv venv` + `uv pip install <ddgsVersion>`; `ddgsVersion` defaults to **latest** (`'ddgs'`).
- Config: `backend` (default `duckduckgo`), `maxResults` (8), `timeoutMs` (30000), `venvDir`, `ddgsVersion`.
- Provider: `PROVIDER_ID = 'ddgs'`, implements `WebSearchProvider` from `@deepseek-ai/dsh-web 0.2.0-rc.2` (dev dep, types for the seam); serializes searches through an internal promise queue; `available()` = venv python exists OR `uv` on PATH; maps href/title/body → url/title/snippet.
- Runner: spawns `<venv>/bin/python ddgs-search.py --query … --backend … --max-results … --timeout 10`; lazy venv provisioning with self-heal (venv present but `bin/ddgs` missing → reinstall); injected `Spawner` interface; errors: non-zero exit / malformed JSON / timeout / abort — one generic error path, no per-backend taxonomy.
- Plugin entry: `name = 'web-search-ddgs'`, `inject = ['web']`, `apply` registers via `ctx.web.registerSearchProvider(...)`.

Stale/TODO-ish bits found:
- `package.json` description says "yandex backend" but default is `duckduckgo` (same drift in `cordis.patch.yml` header comment).
- No test coverage for the yandex re-registration path; `ddgs-search.py` has no tests at all.
- The yandex engine is a runtime monkey-patch of ddgs internals (`ENGINES['text']['yandex'] = Yandex`) — fragile across ddgs versions, and `ddgsVersion` defaults to latest.
- `provider.ts` doc comment fossil: "yandex' rate limiter" while default is duckduckgo.
- No `docs/ai/` notes reference this package.

## B. dsh 0.2.0 provider seam (how to replace the search backend)

Key files: `dsh/packages/web/web/src/{index.ts,types.ts}`, `dsh/packages/web/web-search-{deepseek,exa,perplexity}/src/index.ts`, `dsh/packages/bundle/base/cordis.patch.yml:447-459`, `docs/subsystems/web.md`, `packages/dsh-web-search-ddgs/{src/index.ts,cordis.patch.yml,README.md}`.

- `WebSearchProvider` = `{ readonly id: string; available(): boolean; search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> }`; `WebSearchRequest { query, maxResults? }`; `WebSearchResult { content?, sources: WebSearchSource[], truncated }`; `WebSearchSource { url, title?, snippet?, publishedAt? }`. `WebFetchProvider` is the parallel fetch type. `WebError extends HarnessError` with open-string `code`.
- `WebRuntime` (the `ctx.web` service, one instance per context; distinct from `ctx.webServer`) exposes `registerSearchProvider` / `registerFetchProvider` / `search` / `fetch` + static `Config = z.object({ searchProvider: z.string(), fetchProvider: z.string() })` — optional free-form strings, no enum.
- Provider plugins: `export const inject = ['web']`, `apply()` → `ctx.web.registerSearchProvider(...)`. Duplicate id → `WEB_DUPLICATE_PROVIDER`. Disposer returned.
- Selection resolves at call time: config `searchProvider` beats env `DSH_WEB_SEARCH_PROVIDER`; configured id must be registered AND `available()`; no id → exactly one usable auto-selects, multiple → `WEB_PROVIDER_AMBIGUOUS`, none → `WEB_PROVIDER_UNAVAILABLE`; configured-but-missing → `WEB_PROVIDER_CONFIGURED_MISSING`; configured-but-unavailable → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
- Stock base profile pins `searchProvider: deepseek-official`, `fetchProvider: http` (`dsh/packages/bundle/base/cordis.patch.yml:447-459`). Inserting a provider row (as the ddgs `cordis.patch.yml` does) does NOT change selection.
- Sanctioned override: profile's own patch layer applied after all bundle layers — `~/.dsh/profiles/web/cordis.patch.yml` with `- id: web / config: { searchProvider: ddgs }` (keep `fetchProvider: http` in the same entry; the entry replaces the web config map), then restart `dsh web`.
- No CLI flag for provider selection. `dsh-tool-web` has a separate `searchMaxResults` config (default 8).
- IMPORTANT version fact: the `dsh/` checkout is at `dsh-v0.1.2-rc.1` (clean tree, no 0.2* tags, no CHANGELOG). The only 0.2.0 artifact available is the published `@deepseek-ai/dsh-web@0.2.0-rc.2` in `packages/dsh-web-search-ddgs/node_modules/` — its `lib/types/types.d.ts` is **byte-identical** to the checkout's `dsh/packages/web/web/lib/types/types.d.ts`; the whole `ctx.web` seam was introduced 2026-06-26 (`d01f5f73b7`) and is unchanged between 0.1.2-rc.1 and 0.2.0-rc.2. So "много изменилось в 0.2.0" is NOT true for the search-provider seam itself (per available artifacts); the known 0.2.0-rc.2 change affecting e2e is the broken host RPC channel (host-side, per root AGENTS.md).

## C. Shared e2e infrastructure + current state

- `tests-helpers/e2e/dsh.ts` — core: `launchDsh({ packageName, port?, keyless?, version? })` (temp root `.tmp/dsh-e2e-*` with `.dsh`/`.agents`, `DSH_HOME`/`DSH_AGENTS_HOME` isolated, builds package if `lib/` missing, `dsh plugin --profile web add`, `dsh web --port <n> --no-open`, waits for ready line, 303 token→cookie exchange for 0.2.0-rc.2), `stopDsh` (SIGTERM, removes root unless `E2E_KEEP=1`), `resolveDshBinary` (E2E_DSH_BIN override → provisioned; no PATH fallback), `ensureDshVersion` (provisions `.tmp/dsh-versions/<version>` via throwaway pnpm project, 180s install, per-version lock). `E2E_DSH_VERSIONS = ['0.2.0-rc.2']` defined here (line 29). `READY_TIMEOUT_MS = 90_000`.
- `tests-helpers/e2e/dsh-fixture.ts` — vitest wrapper: `startDsh` (port default 0), `stopDsh`, `pluginListed`, `rpc`, `warmModel`, `writeSettings`, `startJsonServer`, etc.
- `tests-helpers/e2e/live.ts` — playwright lane: `launchPluginTestHome`, `trackConsoleErrors`. `scripts/e2e-live.ts` — manual CLI: `--package` (required), `--port` (3081), `--version` (0.2.0-rc.2), `--keep`; not keyless.
- `packages/dsh-web-search-ddgs/tests/e2e/server/boot.test.ts` — `describe.each(E2E_DSH_VERSIONS)`: asserts plugin listed in `web` profile + web app HTTP 200. No skip conditions.
- `packages/dsh-web-search-ddgs/tests/e2e/server/live-search.test.ts` — NOT a dsh boot; real `createRunner` + provider with temp venv; `describe.skipIf(!uvAvailable)`; real network; asserts `available()`, id, `'react version'` search → ≥1 http(s) URL, `truncated === false`; 120s timeouts.
- Vitest configs: unit lane `tests/unit/**/*.test.ts`; e2e lane `tests/e2e/**/*.test.ts`, `timeout: 120_000`, `hookTimeout: 180_000`, alias `@root/tests-helpers`.
- model-settings comparison: has boot + RPC (`model-settings.test.ts`) + playwright acceptance (`acceptance.spec.ts`); ddgs has boot + live-search (no RPC lane, no acceptance).
- Environment: `uv` present at `/home/apkawa/.local/bin/uv`; `.tmp/dsh-versions/` already has 0.2.0-rc.2 provisioned (plus 0.1.1-rc.2, 0.1.2-rc.1, 0.1.7-rc.2); `packages/dsh-web-search-ddgs/lib/` is built.

## D. Baseline test results (stage 1)

Run 2026-10-03, branch `2026-10-03_web-search-ddgs-audit`, measurement-only (no source changes). Both lanes run from `packages/dsh-web-search-ddgs` with `pnpm_config_store_dir=./.cache/pnpm/v11`.

### Unit lane

Command: `pnpm_config_store_dir=./.cache/pnpm/v11 pnpm test` (= `vitest run`).

Result: **5 test files passed, 23/23 tests passed**, duration 449ms, exit 0.

Per file:

| File | Tests | Result |
| ---- | ----- | ------ |
| `tests/unit/server/sanity.test.ts` | 1 | passed |
| `tests/unit/server/log.test.ts` | 4 | passed |
| `tests/unit/server/composition.test.ts` | 2 | passed |
| `tests/unit/server/runner.test.ts` | 9 | passed |
| `tests/unit/server/provider.test.ts` | 7 | passed |

No failures.

### E2E lane

Command: `pnpm_config_store_dir=./.cache/pnpm/v11 pnpm test:e2e` (= `vitest run --config vitest.e2e.config.ts`). Boots live `dsh web` 0.2.0-rc.2 under an isolated `DSH_HOME` (`.tmp/dsh-e2e-*`).

Result: **2 test files (1 passed, 1 failed), 4 tests — 3 passed, 1 failed, 0 skipped**, duration 4.35s, exit 1.

Per file:

| File | Tests | Result |
| ---- | ----- | ------ |
| `tests/e2e/server/boot.test.ts` | 2 | passed (incl. "links the plugin into the fresh web profile", 4177ms) |
| `tests/e2e/server/live-search.test.ts` | 2 | 1 passed, 1 failed |

Failure detail:

- **`live ddgs search (real uv + network) > returns real search results with URLs`** (live-search.test.ts) — failed in 47ms:
  ```
  Error: uv venv failed: error: Could not acquire lock
    Caused by: Could not create temporary file
    Caused by: Read-only file system (os error 30) at path "/home/apkawa/.cache/uv/.tmpLnJGBs"
    ❯ uv src/runner.ts:77:35
    ❯ setupVenv src/runner.ts:62:7
    ❯ Object.search src/runner.ts:82:7
  ```
  Cause: uv's cache dir `/home/apkawa/.cache/uv` is not writable under this session's sandbox (workspace-write), so venv provisioning failed before any network search was attempted. Environmental, not a code defect; the search path itself was never exercised.
- `live ddgs search (real uv + network) > is available and reports its id` passed (availability is cheap/local — `uv` on PATH).

### Verdict

Unit: **green**. E2E: **red** (1 failure, sandbox read-only `~/.cache/uv` blocking uv venv provisioning; no skips).

## E. Backend probe results (stage 2)

- **Installed ddgs version:** 9.16.0 (via `uv pip install ddgs` into throwaway venv `.tmp/ddgs-probe-venv`, Python 3.14.7)
- **Probe command:** `.tmp/ddgs-probe-venv/bin/python packages/dsh-web-search-ddgs/ddgs-search.py --query "react version" --backend <b> --max-results 3 --timeout 10`

| Backend | Exit | Status | Evidence excerpt |
| --- | --- | --- | --- |
| duckduckgo | 0 | works | `{"title": "React (software) - Wikipedia", "href": "https://en.wikipedia.org/wiki/React_(software)", ...}` + `{"title": "React Versions - React", "href": "https://react.dev/versions", ...}` (3 results, clean JSON, empty stderr) |
| bing | 0 | works | `{"title": "React (software) - Wikipedia", "href": "https://en.wikipedia.org/wiki/React_(software)", ...}` + `{"title": "React Versions – React", "href": "https://react.dev/versions", ...}` (3 results, clean JSON, empty stderr) |
| yandex | 0 | works | `{"title": "React Versions – React", "href": "https://react.dev/versions", ...}` + `{"title": "How To Check The Version of ReactJS Project? - GeeksforGeeks", "href": "https://www.geeksforgeeks.org/...", ...}` (3 results, clean JSON, empty stderr)

### Per-backend verdicts

- **duckduckgo:** works — 3 results, no rate-limiting, no stderr.
- **bing:** works — 3 results, no rate-limiting, no stderr (note: third result's title/body contained concatenated snippets, a ddgs-side parsing quirk, not a probe failure).
- **yandex:** works — 3 results, no rate-limiting, no stderr; the re-registered `ENGINES['text']['yandex']` in `ddgs-search.py` resolves and returns results against live yandex.

### Notes

- No retries were needed; all backends succeeded on the first attempt. No rate-limit hits, no timeouts, no stderr output on any run.
- All three backends were live and functional at the time of the probe; the stage-1 e2e failure was caused purely by the sandbox-unwritable `~/.cache/uv` (worked around here by `UV_CACHE_DIR` under the repo's `.cache/uv`).

## F. Stage 3 — e2e fix + full lane result

- `live-search.test.ts` now mirrors the `backends.test.ts` pattern: `const uvCacheDir = fileURLToPath(new URL('../../../../.cache/uv', import.meta.url))` + `process.env.UV_CACHE_DIR = uvCacheDir` in `beforeAll` before venv provisioning. This resolves the sandbox read-only `~/.cache/uv` failure from stage 1.
- Full e2e lane (`pnpm test:e2e`, 0.2.0-rc.2): run 1 = 4/7 (3 failures, all `DDGSException: No results found` — flaky live-network empty results); run 2 = **7/7 green** (boot 2/2, live-search 2/2, backends 3/3). No package-owned defect remained.
- Note: live ddgs searches are flaky under load (empty results possible); the suite has no retry wrapper (consistent with existing style).
