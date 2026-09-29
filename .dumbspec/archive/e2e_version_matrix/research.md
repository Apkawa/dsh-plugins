# Research — e2e_version_matrix

Facts verified in this repo (branch `web-search`, HEAD `4362d52`) unless noted.

## 1. dsh versions available in the registry

`pnpm view @deepseek-ai/dsh versions --json` (verified):

- usable stable line: **`0.1.1-rc.2`** (current e2e baseline, tokenless session) and **`0.1.2-rc.1`** (`latest` dist-tag, token/session-cookie flow).
- `0.1.3-alpha.2` exists (dist-tag `alpha`) — alpha, not included in the default matrix.
- Known per-version behavior:
  - `0.1.1-rc.2` — ready URL without token (`session cookie: none`).
  - `0.1.2-rc.1` — `?token=…` ready URL, exchanged 303 → session cookie; **in-session `POST /model-settings/*` returns 405** (host plugin apply-ordering; documented-deferred, owned by `.dumbspec/current/fix_0.1.2-rc1`). This blocks any model-settings RPC test on `0.1.2-rc.1` until that fix lands.

## 2. Current duplication map (user point 5)

Three files implement the same launch plumbing:

| file | role | plumbing implemented |
| --- | --- | --- |
| `scripts/e2e-live.mjs` | manual CLI | version chain, temp root, env, artifacts check, `plugin add`, spawn `web --port N`, ready line, session exchange, HTTP 200 check, SIGTERM/cleanup, `--keep` |
| `tests-helpers/e2e/live.ts` | playwright lane | **same plumbing in-process** (chain, temp root, keyless env, ensureBuilt, `plugin add`, spawn `web --port 0`, ready line, stop) + `trackConsoleErrors` (playwright-only) |
| `tests-helpers/e2e/dsh-fixture.ts` | vitest lane | spawns the CLI as a child and **parses 4 stdout lines** (fragile); plus domain helpers (`rpc`, `warmModel`, `pluginListed`, `writeSettings`, `findRow`, `startJsonServer`, `sleep`, `ModelRow`, `ROUTE_ID`, `MODEL_ID`) |

So the plumbing exists twice (CLI + live.ts) and a third consumer couples to the CLI via stdout-line parsing. Merging into one core removes both the duplication and the line-parsing fragility.

## 3. Node 24 native TypeScript (verified by spike)

- `node --version` → `v24.19.0`; `node file.ts` runs erasable-TS natively (spike `.tmp/ts-spike.ts` → `NODE_TS_OK`).
- Consequence: `scripts/e2e-live.mjs` can be rewritten as `scripts/e2e-live.ts` and import the shared TS core with an explicit `.ts` extension — one implementation for CLI, vitest lane, and playwright lane. Constraint: erasable-only syntax (no enum/namespace/parameter properties) — the existing code style already complies.
- Remaining spike: cross-file `.ts` → `.ts` import under plain node.

## 4. Import alias (user point 4)

- **Playwright `1.62.1` has no `alias` config option** (verified in the pinned `playwright/types/test.d.ts` — the only "alias" hit is `toThrowError`). But its ESM loader **reads tsconfig `paths`** (verified: `playwright/lib/transform/esmLoader.js` — `tsconfig.absoluteBaseUrl ?? tsconfig.paths?.pathsBasePath`, `tsconfig.paths?.mapping`). So playwright-side aliasing = `baseUrl` + `paths` in the package `tsconfig.json`.
- **Vitest** is Vite-based: first-class `resolve.alias` in `vitest.e2e.config.ts` (string key = prefix match, `@root/tests-helpers` prefix → absolute `<repo>/tests-helpers`).
- `tsc` typecheck is unaffected: both package tsconfigs `include: ["src"]` and `exclude` the tests — `baseUrl`/`paths` entries are inert for `pnpm typecheck`.
- Import shape (matches the user's example): `@root/tests-helpers/e2e/dsh-fixture.ts` replaces `../../../../../tests-helpers/e2e/dsh-fixture.ts`.
- Playwright loader resolves the tsconfig nearest to the test file (`packages/<name>/tsconfig.json`); paths relative to `baseUrl` = package root: `"@root/tests-helpers/*": ["../../tests-helpers/*"]`.
- Remaining spike: empirically confirm the pinned playwright resolves a `@root/tests-helpers/…` import through the package tsconfig (exact pattern form to be pinned down in the spike).

## 5. Version provisioning (user points 1+3)

- Existing baseline: `.tmp/dsh-versions/0.1.1-rc.2/` — throwaway `package.json` (`private`, dep `@deepseek-ai/dsh: 0.1.1-rc.2`, `pnpm.onlyBuiltDependencies`: `@deepseek-ai/dsh-subprocess-local`, `@google/genai`, `koffi`, `node-pty`, `protobufjs`).
- New helper `ensureDshVersion(version)` in the shared core:
  - `.tmp/dsh-versions/<version>/node_modules/.bin/dsh` exists → return path.
  - else write the same throwaway `package.json` (version parameterized, same `onlyBuiltDependencies` list) and run `pnpm install` with `CI=true` + `pnpm_config_store_dir=<repo>/.cache/pnpm/v11`; hard-fail on non-zero exit.
- **Concurrency risk**: vitest runs the two packages' test files in parallel workers; both may provision `0.1.2-rc.1` into the same directory at once. Two concurrent `pnpm install` in one project dir can corrupt `node_modules`. Mitigation: atomic `mkdir` lock dir (`.tmp/dsh-versions/<version>/.provision-lock`) with a wait loop + stale-lock timeout, then re-check the bin.
- Resolution chain becomes: `E2E_DSH_BIN` (must exist → hard fail, kept per user) → `ensureDshVersion(version ?? '0.1.1-rc.2')`. The old PATH `dsh` fallback is dropped (provisioning is now automatic; silent fallback to an unknown PATH version defeats the point of a version matrix).
- First-time provisioning of a version is a slow path (tens of seconds) — test hook timeouts (vitest `hookTimeout: 180_000` already; playwright needs an explicit per-hook timeout on the launch hook).
- CLI gains `--version <v>` (optional, default `0.1.1-rc.2`); env `E2E_DSH_BIN` stays the highest-priority override.

## 6. Version matrix in tests (user point 2)

- Default matrix set (constant in the shared core): `['0.1.1-rc.2', '0.1.2-rc.1']` — the two usable lines; `0.1.3-alpha.2` excluded (alpha).
- `describe.each(E2E_DSH_VERSIONS)` with per-iteration `beforeAll`/`afterAll` (vitest runs describes within a file sequentially).
- **Port collisions are eliminated**: the shared core always spawns `web --port 0` and reads the real port from the ready URL into `DshHandle.port` (playwright lane already does this; the vitest lane currently pins `E2E_PORT = 3091` — dropped). Manual CLI keeps `--port` (default 3081) for humans.
- Per-lane matrix feasibility:
  - **ddgs `boot.test.ts`** — clean on both versions (no RPC; boot + `pluginListed` + HTTP 200). Full matrix.
  - **model-settings RPC suite** — **blocked on `0.1.2-rc.1` by the documented 405** (any `POST /model-settings/*`, including `listModels`). Stays pinned to `0.1.1-rc.2` until `fix_0.1.2-rc1` lands; the matrix constant is what lets the suite go full-matrix later without redesign.
  - **model-settings playwright acceptance** — empty-state UI on `0.1.2-rc.1` is uncertain: the client fires RPC on load, a 405 may surface as a console error and fail `trackConsoleErrors`. Must be spiked; scope decided at the review gate.
- Decision points for the review gate (spec): exact matrix scope per lane; whether `E2E_DSH_VERSIONS` gets an env override; whether a small version-matrix boot smoke is added to the model-settings lane.

## 7. Behavioral deltas to watch in the spike

- `dsh web` child SIGTERM exit code: today the fixture asserts `code === 0` on the **CLI wrapper** (which maps its own exit), while the core would assert the **dsh child** code directly — must verify the child exits 0 on SIGTERM (else assert on `rootRemoved` only).
- In-process launch removes the extra CLI process layer → faster, no stdout parsing; the CLI's printed lines (`dsh binary:` etc.) stay in the CLI wrapper for humans.
- `E2E_KEEP=1` (playwright lane) / `--keep` (CLI) semantics preserved in the core's `stopDsh`/cleanup.
- Docs (`CONTRIBUTING.md`, root + package `AGENTS.md`) need the new version-matrix story: helper, `--version`, alias imports, merged core, per-version 405 pointer.
