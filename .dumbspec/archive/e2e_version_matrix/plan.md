# Plan — e2e_version_matrix

Spec approved at the review gate. One checkbox = one sequential subagent task.
Commit at the end of each stage (checkpoint), Conventional Commits, no `--amend`, no push.
All runs: `CI=true pnpm_config_store_dir=/home/apkawa/code/dsh-model-settings/.cache/pnpm/v11` in env; frozen installs in the repo (provisioning throwaway projects are exempt); never `playwright install`; isolated `DSH_HOME` only; temp in `.tmp/`, caches in `.cache/`; never touch `~/.dsh`; one subagent at a time.

- [ ] **Stage 1 — shared launch core** `tests-helpers/e2e/dsh.ts`
  - Spikes first (record results in `.tmp/e2e-vmatrix-notes.md`):
    - cross-file `.ts` → `.ts` import under plain `node` (Node 24 type stripping);
    - playwright 1.62.1 ESM loader resolves a tsconfig `paths` alias (`@root/tests-helpers/*`) in a scratch spec;
    - `dsh web` child exit code on SIGTERM (0 vs other) for `stopDsh` assertions.
  - Core: `launchDsh({ packageName, port?, keyless?, version? })`, `stopDsh(handle)`, `resolveDshBinary(version?)` (E2E_DSH_BIN → ensureDshVersion, no PATH fallback), `ensureDshVersion(version)` (throwaway project + pnpm install, mkdir lock, stale timeout), `E2E_DSH_VERSIONS = ['0.1.1-rc.2', '0.1.2-rc.1']`; internals: temp root, env (keyless strip optional), ensureBuilt from exports map, `plugin add`, spawn `web --port <n> --no-open`, ready line, token→cookie exchange for 0.1.2+, `DshHandle { url, port, root, package, bin, cookie, child, version }`; no `@playwright/test` imports.
  - Verify: launch/stop via the core against both packages on 0.1.1-rc.2; `ensureDshVersion('0.1.2-rc.1')` provisions `.tmp/dsh-versions/0.1.2-rc.1/` and launches (cookie non-null).
  - Commit: `refactor(e2e): add shared launch core tests-helpers/e2e/dsh.ts`

- [x] **Stage 1 — shared launch core** `tests-helpers/e2e/dsh.ts` *(done, 88cf846)*
- [x] **Stage 2 — CLI on the core** *(done, b906fcb)*
  - `scripts/e2e-live.mjs` → `scripts/e2e-live.ts` (git mv + rewrite): thin wrapper over the core; flags `--package <name>` (required), `--port <n>` (default 3081), `--keep`, `--version <v>` (default 0.1.1-rc.2); same printed lines (`dsh binary:`, `dsh e2e instance:`, `session cookie:`, `temp root:`, `pid:`); SIGINT/SIGTERM → child SIGTERM + root removal unless `--keep`.
  - Both package `package.json`: `e2e:live: node ../../scripts/e2e-live.ts --package <name>`.
  - Verify: `pnpm e2e:live` from both packages (5 lines, SIGTERM, root removed); `--version 0.1.2-rc.1` prints a real session cookie.
  - Commit: `refactor(e2e): rewrite e2e-live CLI on the shared core (TS, --version flag)`

- [x] **Stage 3 — vitest lane on the core + alias** *(done, c92a33e)*
  - `tests-helpers/e2e/dsh-fixture.ts`: `startDsh({ packageName, version?, port? })` as a thin wrapper over `launchDsh` (no CLI spawn, no stdout parsing); drop `E2E_PORT`; domain helpers stay (`rpc`, `warmModel`, `pluginListed`, `writeSettings`, `findRow`, `startJsonServer`, `sleep`, `ModelRow`, `ROUTE_ID`, `MODEL_ID`).
  - Alias: `resolve.alias: { '@root/tests-helpers': <repo>/tests-helpers }` in both `vitest.e2e.config.ts`; `baseUrl: "."` + `"paths": { "@root/tests-helpers/*": ["../../tests-helpers/*"] }` in both package `tsconfig.json`.
  - Test imports → `@root/tests-helpers/e2e/dsh-fixture.ts` (model-settings server test, ddgs boot test).
  - Verify: `pnpm typecheck` 0 in both packages; full vitest e2e lanes green (4/4 model-settings, 2/2 ddgs boot).
  - Commit: `refactor(e2e): vitest lane on the shared core, @root/tests-helpers alias`

- [ ] **Stage 4 — version matrix**
  - ddgs `boot.test.ts`: `describe.each(E2E_DSH_VERSIONS)` — per-iteration handle (beforeAll/afterAll), both tests per version (2×2).
  - model-settings: new `tests/e2e/server/boot.test.ts` boot-smoke on the full matrix (`pluginListed` + HTTP 200, no RPC); RPC suite stays pinned to `0.1.1-rc.2` with a comment pointing at the documented 405 / `fix_0.1.2-rc1`.
  - Verify: ddgs `pnpm test:e2e` (4 boot tests across 2 versions + live-search pass/self-skip); model-settings `pnpm test:e2e` (4/4 RPC + boot-smoke both versions).
  - Commit: `feat(e2e): dsh version matrix (describe.each) across e2e lanes`

- [x] **Stage 4 — version matrix** *(done, 6d27471)*
- [x] **Stage 5 — playwright lane on the core** *(done, bb13eed)*
  - `tests-helpers/e2e/live.ts`: `launchPluginTestHome(packageName, version?)` thin wrapper over `launchDsh({ keyless: true, port: 0, version? })`; `trackConsoleErrors` stays.
  - `acceptance.spec.ts`: explicit version (default 0.1.1-rc.2), explicit hook timeout on the launch hook (provisioning is a slow path); spike the 0.1.2-rc.1 acceptance run and record the outcome (console-error risk from the 405 RPC) — lane stays pinned to 0.1.1-rc.2 regardless.
  - Verify: model-settings `pnpm test:e2e` full chain green (vitest + playwright 1/1); 0.1.2-rc.1 spike recorded in notes.
  - Commit: `refactor(e2e): playwright lane on the shared core`

- [x] **Stage 6 — docs + acceptance + archive** *(done: docs aa520d1, archive 9f899de, acceptance ACCEPT 8/8)*
  - `CONTRIBUTING.md` E2E section + root `AGENTS.md` E2E section + both package `AGENTS.md` bullets: unified core, version matrix, `--version`, provisioning helper, alias imports, per-version 405 pointer.
  - Dedicated independent acceptance run (per spec acceptance criteria 1–8).
  - Move `.dumbspec/current/e2e_version_matrix/` → `.dumbspec/archive/e2e_version_matrix/`; commit `chore(dumbspec): archive e2e_version_matrix (task complete, stage 6 accepted)`.
