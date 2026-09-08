# Plan — shared e2e infrastructure + run docs

Stage commits: one Conventional Commit per stage, no push, no --amend.
Acceptance = dedicated independent run after stage 5.

- [x] **Stage 1 — shared launcher `scripts/e2e-live.mjs`**
  - `git mv packages/dsh-model-settings/scripts/e2e-live.mjs scripts/e2e-live.mjs`
  - required `--package <name>` arg → `packages/<name>` (REPO_ROOT-derived, cwd-independent); fail loud when missing/unknown
  - artifact check: `lib/index.js` always; `lib/client.js` iff the package's `exports` has a `./client` key
  - model-settings `tests/e2e/dsh-fixture.ts`: LAUNCHER path → repo `scripts/`, spawn arg `--package dsh-model-settings` (file stays per-package for now)
  - Verify: standalone `node scripts/e2e-live.mjs --package dsh-model-settings` and `--package dsh-web-search-ddgs` both boot (session line, `dsh binary:` line, temp root removed on stop); model-settings vitest e2e lane green (4/4)
  - Commit: `refactor(e2e): hoist shared e2e launcher to scripts/ with --package`
- [x] **Stage 2 — shared vitest fixture `tests-helpers/e2e/dsh-fixture.ts`**
  - `git mv packages/dsh-model-settings/tests/e2e/dsh-fixture.ts tests-helpers/e2e/dsh-fixture.ts`
  - `startDsh({ packageName, port? })`; `DshHandle { url (plain, token stripped), port, root, package, bin, cookie, child }`; parse `dsh binary:` line into `handle.bin`
  - `pluginListed(handle)` (from ddgs copy): uses `handle.bin`, expects `@apkawa/<handle.package>`
  - `rpc<T>(handle, channel, endpoint, payload)` — explicit channel
  - `warmModel`/`writeSettings`/`findRow`/`startJsonServer`/`sleep`/`ModelRow`/`ROUTE_ID`/`MODEL_ID` move as-is; READY_TIMEOUT 120 s
  - `model-settings.test.ts`: import from `tests-helpers/`, `rpc(handle, 'model-settings', …)`
  - Verify: model-settings vitest e2e lane green (4/4)
  - Commit: `refactor(e2e): hoist vitest e2e fixture to tests-helpers/`
- [x] **Stage 3 — ddgs onto the shared lane**
  - delete `packages/dsh-web-search-ddgs/scripts/e2e-live.mjs` and `packages/dsh-web-search-ddgs/tests/e2e/dsh-fixture.ts` (content subsumed)
  - `boot.test.ts`: shared fixture import, `startDsh({ packageName: 'dsh-web-search-ddgs' })`, `fetch` plain URL + cookie (no cookie → no header)
  - ddgs `package.json`: `e2e:live` → `node ../../scripts/e2e-live.mjs --package dsh-web-search-ddgs`
  - model-settings `package.json`: `e2e:live` → `node ../../scripts/e2e-live.mjs --package dsh-model-settings`
  - Verify: ddgs `pnpm test:e2e` green (boot 2/2; live-search self-skip without `uv` is normal), model-settings lane still green
  - Commit: `refactor(e2e): ddgs e2e lane uses the shared launcher and fixture`
- [x] **Stage 4 — shared playwright lane `tests-helpers/e2e/live.ts`**
  - `git mv packages/dsh-model-settings/tests/e2e/live.ts tests-helpers/e2e/live.ts`
  - `launchPluginTestHome(packageName)`; packageDir = `join(repoRoot, 'packages', packageName)`; same exports-based artifact rule
  - `acceptance.spec.ts`: import from `tests-helpers/`, `launchPluginTestHome('dsh-model-settings')`
  - Verify: model-settings full chain green: `pnpm test:e2e` → vitest 4/4 + playwright 1/1
  - Commit: `refactor(e2e): hoist playwright lane launcher to tests-helpers/`
- [x] **Stage 5 — docs**
  - `CONTRIBUTING.md`: new "E2E tests" section — two lanes, `pnpm test:e2e` / `pnpm e2e:live` (flags `--port`, `--keep`, `E2E_KEEP`), version chain `E2E_DSH_BIN` → provisioned `0.1.1-rc.2` → PATH + how to provision on a fresh clone, standalone env (`pnpm_config_store_dir`), keyless playwright lane, artifacts under `.tmp/playwright/<package>`, one-line pointer to the known 405 on dsh ≥ 0.1.2 (`fix_0.1.2-rc1`)
  - root `AGENTS.md`: short section — shared e2e layout + how to run + hard constraints (frozen pnpm installs, no `playwright install`, isolated `DSH_HOME` only)
  - both package `AGENTS.md`: E2E lines updated to the shared paths
  - Commit: `docs: how to run the shared e2e lanes (CONTRIBUTING, AGENTS)`
- [x] **Stage 6 — acceptance + archive**
  - dedicated independent run: model-settings `pnpm test:e2e` (4/4 + 1/1); ddgs `pnpm test:e2e` (2/2); `pnpm e2e:live` from both packages (session line + cleanup); `pnpm typecheck` 0 in both; no per-package e2e-infra files left; git renames visible; no stray `.tmp/dsh-e2e-*` roots; `~/.dsh` untouched
  - move `.dumbspec/current/shared_e2e_infra/` → `.dumbspec/archive/shared_e2e_infra/`
  - Commit: `chore(dumbspec): archive shared_e2e_infra (task complete, stage 6 accepted)`
