# Research — shared e2e infrastructure + run docs

## Current state (as of `51d6af1`)

**Three e2e-infrastructure files exist in per-package copies, two of them duplicated:**

| File | `packages/dsh-model-settings/` | `packages/dsh-web-search-ddgs/` |
| --- | --- | --- |
| `scripts/e2e-live.mjs` (vitest-lane launcher) | 185 lines — current: session exchange (`?token=…` → 303 → cookie), version chain (`E2E_DSH_BIN` → provisioned 0.1.1-rc.2 → PATH), `.tmp/dsh-e2e-*` root, artifact check `index.js` + `client.js` | 142 lines — **stale**: no session exchange, no version chain (bare PATH `dsh` for plugin add AND spawn), system-tmpdir root `web-search-ddgs-e2e-*`, artifact check `index.js` only |
| `tests/e2e/dsh-fixture.ts` (vitest-lane fixture) | current: waits ready+root+`session cookie:` lines, `DshHandle.cookie`, `rpc()` carries cookie, `warmModel`/`writeSettings`/`findRow`/`startJsonServer`, READY_TIMEOUT 120 s | **stale**: no cookie, no session line, `pluginListed(handle)` runs PATH `dsh` (version-chain inconsistency) and hardcodes `@apkawa/dsh-web-search-ddgs`, READY_TIMEOUT 180 s |
| `tests/e2e/live.ts` (playwright-lane launcher) | 153 lines: own second launcher implementation — port 0, keyless strip, `E2E_KEEP`, readline ready-line, version chain | (no playwright lane; ddgs GUI e2e was deferred by the previous task, spec item 7) |

**Consumers (test files stay per-package — they own the test content):**
- `dsh-model-settings`: `tests/e2e/server/model-settings.test.ts` (fixture), `tests/e2e/acceptance.spec.ts` (live.ts), `playwright.config.ts`, `vitest.e2e.config.ts`
- `dsh-web-search-ddgs`: `tests/e2e/server/boot.test.ts` (fixture: `pluginListed` + `fetch(handle.url)`), `tests/e2e/server/live-search.test.ts` (**no fixture** — direct provider/runner test, self-skips without `uv`), `vitest.e2e.config.ts`

**Package scripts today:** both have `"e2e:live": "node scripts/e2e-live.mjs"`; `test:e2e` = `vitest run --config vitest.e2e.config.ts` (ddgs) or that plus `&& pnpm exec playwright test` (model-settings).

**Docs gap (the user's point 1):** `CONTRIBUTING.md` documents only `pnpm test/typecheck/build`; neither it nor the root `AGENTS.md` explains how to run the e2e lanes, what `E2E_DSH_BIN`/version chain means, or what env the standalone launcher needs (`pnpm_config_store_dir`, keyless for the playwright lane). Package `AGENTS.md` files carry a one-liner pointing at `scripts/e2e-live.mjs` (a path that will move).

## Design decisions

1. **Launcher → `scripts/e2e-live.mjs`, parameterized by required `--package <name>`** (resolved to `packages/<name>` from the repo root derived from the script's own URL — cwd-independent). The current model-settings copy is the base; the ddgs copy is deleted (everything it did is a subset). Package-specific artifacts: `index.js` always; `client.js` additionally **iff the package's `package.json` `exports` map contains a `./client` key** — self-describing, no per-package artifact list in the launcher.
2. **Fixture → `tests-helpers/e2e/dsh-fixture.ts`**, merged from both copies:
   - `startDsh({ packageName, port? })` — spawns `node <repo>/scripts/e2e-live.mjs --package <name> --port <p>`; parses four launcher lines: `dsh binary:` → `handle.bin`, ready line → **plain** `handle.url` (token stripped), `temp root:` → `handle.root`, `session cookie:` → `handle.cookie` (`none` → null). `DshHandle = { url, port, root, package, bin, cookie, child }`.
   - `pluginListed(handle)` (from the ddgs copy) — uses `handle.bin` (not PATH `dsh`: fixes the ddgs version-chain inconsistency) and expects `@apkawa/<handle.package>` (derived, not hardcoded).
   - `rpc<T>(handle, channel, endpoint, payload)` — channel made explicit (`model-settings` today; the only RPC consumer passes it). Cookie header as now.
   - `warmModel`/`writeSettings`/`findRow`/`startJsonServer`/`sleep`/`ModelRow`/`ROUTE_ID`/`MODEL_ID` move as-is (model-settings domain helpers living in the shared file — KISS: one file, no premature split).
   - READY_TIMEOUT unified to 120 s (the launcher's own ready timeout is 90 s, so 120 s bounds it; ddgs's 180 s was over-margin).
3. **Playwright lane → `tests-helpers/e2e/live.ts`**: `launchPluginTestHome(packageName)`; `packageDir = join(repoRoot, 'packages', packageName)`; same exports-based artifact rule as the launcher (it runs `pnpm build` when artifacts are missing); everything else unchanged (keyless strip, `E2E_KEEP`, port 0, version chain).
4. **Test files, configs, scripts stay per-package** — they own package-specific content. Imports point at the shared files via relative paths (`../../../../tests-helpers/e2e/…` from a test in `tests/e2e/server/`). `vitest.e2e.config.ts` / `playwright.config.ts` unchanged (`include`/`testDir`/`outputDir` already per-package). `e2e:live` scripts become `node ../../scripts/e2e-live.mjs --package <name>`.
5. **Moves via `git mv`** where the content lineage is 1:1 (model-settings launcher → `scripts/`, model-settings fixture → `tests-helpers/`, model-settings live.ts → `tests-helpers/`); the stale ddgs copies are plain deletes (their content is subsumed — `pluginListed` lands in the merged fixture).
6. **Docs:**
   - `CONTRIBUTING.md` — new "E2E tests" section: what the two lanes are, `pnpm test:e2e` / `pnpm e2e:live` (flags `--port`, `--keep`, `E2E_KEEP`), the version-selection chain (`E2E_DSH_BIN` → provisioned `.tmp/dsh-versions/0.1.1-rc.2/…/dsh` → PATH) and how to provision the baseline on a fresh clone, standalone-launcher env (`pnpm_config_store_dir`), keyless requirement for the playwright lane, where artifacts land (`.tmp/playwright/<package>`), and a one-line pointer that dsh ≥ 0.1.2 RPC is blocked by a known host bug (`fix_0.1.2-rc1`).
   - Root `AGENTS.md` — short section: shared e2e layout (`scripts/e2e-live.mjs`, `tests-helpers/e2e/`) + how to run each lane + the hard constraints (no `pnpm install` drift, no `playwright install`, isolated `DSH_HOME` only).
   - Both package `AGENTS.md` — E2E lines updated to the shared paths.
7. **`tests-helpers/` joins no tsconfig and gets no package.json** — its files stay transpile-gated by vitest/playwright exactly like today's `tests/e2e` lane files (excluded from package tsconfigs). `live.ts` needs `@playwright/test` types from a package that has them (model-settings today).

## Risks

- **vitest importing TS outside the package root** (`tests-helpers/…` from `packages/<name>/tests/e2e/…`): vitest transforms imported TS regardless of root, but this is unverified on this exact setup — verified in the first stage that switches a lane; fallback if it fails: per-package one-line re-export shims (kept as a note, not built preemptively).
- ddgs `boot.test.ts` does `fetch(handle.url)` — with a plain URL + cookie this must become `fetch(handle.url, cookie === null ? undefined : { headers: { cookie } })` (test-file change, part of the ddgs switch stage).
- Both packages' default port is 3091 — suites never run concurrently in this repo, acceptable.
