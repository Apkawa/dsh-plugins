# 2026-10-31_dsh-0.2.1-rc5-plugins: implementation plan (dsh 0.2.1-rc.5 matrix + plugin stabilization)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Draft captured (raw request verbatim)
- [x] Research R1: dsh checkout facts, upgrade guides, plugin API changes rc.2→rc.5
- [x] Research R2: repo e2e infra (matrix entry point, provisioning, lanes, defaults)
- [x] Research R3: version-sensitive plugin inventory + RISK LIST
- [x] spec.md v1, plan.md

**Criterion:** task directory contains draft/research/spec/plan; scope decisions recorded.
**Commit:** `docs(spec): add dsh 0.2.1-rc.5 matrix + plugin stabilization task`

## Stage 1 — Matrix entry + rc.5 provisioning probe
- [x] Append `'0.2.1-rc.5'` to `E2E_DSH_VERSIONS` (`tests-helpers/e2e/dsh.ts:29`)
- [x] Provision rc.5 via `ensureDshVersion` (throwaway project `.tmp/dsh-versions/0.2.1-rc.5`) and probe: run attach-editor boot smoke (strictest audit assertion) on rc.5; capture `dsh plugin add` exit code + stderr, `plugin ls` row format, disabled/active status, audit lines
- [x] Append probe findings to research.md (expected red: `catalog:` peers fail the gate)

**Criterion:** rc.5 provisioning succeeds; the boot lane runs across both matrix versions; probe facts recorded verbatim in research.md.
**Commit:** `test(e2e): add dsh 0.2.1-rc.5 to the version matrix` — `a5b78c5`

## Stage 2 — Plugin manifests pass the compatibility gate (red → green)
- [x] Red baseline probe: run model-settings + ghl boot/RPC lanes on both versions; capture gate behavior (their peer sets include `@deepseek-ai/dsh-*` `catalog:` — the only packages the name-filtered gate actually checks)
- [x] Replace `catalog:` peer values with concrete ranges in all plugin manifests (cordis `^4.0.1`, `@deepseek-ai/dsh-client-connection/modules/ui-slots` `^0.2.0-rc.2`, `@deepseek-ai/dsh-settings` `^0.2.0-rc.2`, `@deepseek-ai/schemastery` `^3.18.1`, react `^18.2.0`) — satisfies rc.2 and rc.5
- [x] Widen exact pins: `@deepseek-ai/dsh-home-paths` deps (global-queue, attach-editor) → `^0.2.0-rc.2`; `@deepseek-ai/dsh-web` devDep (web-search-ddgs) → `^0.2.0-rc.2`
- [x] Refresh root lockfile (`pnpm install`, no `pnpm add`), `pnpm typecheck` per package
- [x] Boot + RPC lanes green on rc.5: plugin add succeeds, plugin genuinely active (RPC endpoint answers, not just listed)
- [x] rc.2 regression check: boot + RPC lanes still green

**Criterion:** `dsh plugin --profile web add` succeeds on rc.5 with no `installation rejected`, plugin activates and its RPC endpoints respond; rc.2 lanes unchanged.
**Commit:** `fix(packages): use concrete peer ranges so the dsh compatibility gate accepts plugins` — `aa0482d`

## Stage 3 — RPC lanes stabilized on rc.5
- [x] Probe native `rpc-host` on rc.5: does the host channel work without our workaround; check for double-mount conflict with our own prefix routes; check error-envelope codes (`internal` vs `gateway/internal`); check warmModel revision-bump wait against rc.5 config-reload
- [x] Adapt plugin/helper source only where a probe shows an actual break (no speculative changes) — none needed: host `connection.rpc.handle` bug persists on rc.5, our prefix routes mount conflict-free, lanes green
- [x] Append probe outcomes to research.md (P3)

**Criterion:** model-settings RPC lane, global-queue rpc+preset lanes, ghl rpc lane green on both matrix versions.
**Commit:** `docs(spec): record rc.5 rpc-host probe — workaround intact, no adaptation needed` — `b4e8a14` (no plugin code change)

## Stage 4 — Client acceptance lanes on rc.5
- [x] Make model-settings `tests/e2e/acceptance.spec.ts` loop over `E2E_DSH_VERSIONS` (was `E2E_DSH_VERSIONS[0]` only)
- [x] Run playwright acceptance lanes (model-settings, global-queue, ghl, attach-editor) on rc.5; adaptations landed: version-agnostic `Get started`→`Close` dismissal (all 4 specs); rc.5 settings nav via Account menu popover (model-settings); plugin-side fixes for version-independent gaps — global-queue drag dimming/reorder + intake-gated watcher, ghl missing-repo pane branch
- [x] Unify vitest e2e config timeout key (`testTimeout: 180_000`) across the five packages (+ package AGENTS.md timeout wording)
- [x] Add `e2e:live` script to dsh-ghl package.json

**Criterion:** all playwright acceptance lanes green on both matrix versions; model-settings acceptance covers the whole matrix. — all four lanes green (attach-editor 6/6, model-settings 2/2, global-queue 44/44, ghl 2/2).
**Commit:** `test(e2e): stabilize acceptance lanes on both matrix versions` — `a98391b`; `fix(global-queue)` — `175dd4b`; `fix(ghl)` — `0d7ebb7`; `test(e2e): unify vitest e2e timeout key` — `ecb6285`; `feat(ghl): e2e:live script` — `8f886c9`

## Stage 5 — Version defaults + docs
- [x] Move hardcoded defaults to `0.2.1-rc.5`: `launchDsh`/`resolveDshBinary` (`tests-helpers/e2e/dsh.ts:55/:82`), `scripts/e2e-live.ts:88` (+ ready-line comments reworded for both versions)
- [x] Root `AGENTS.md` E2E paragraph: matrix `0.2.0-rc.2` + `0.2.1-rc.5`, baseline rc.5; added `packages/dsh-ghl` to the Projects list; new "Plugin manifests" section with the compatibility-gate rule
- [x] `CONTRIBUTING.md` baseline wording + peer-range constraint bullet; `packages/dsh-ghl/AGENTS.md` E2E paragraph replaced (lanes documented); package AGENTS.md workaround wording widened to both matrix versions (ghl, global-queue, model-settings)
- [x] Quick sanity: `node scripts/e2e-live.ts --package dsh-model-settings` boots on the rc.5 default — READY line `dsh web: http://127.0.0.1:…/?token=…` reached, temp root removed, child exit 0

**Criterion:** defaults point at rc.5, docs describe the two-version matrix and the compatibility-gate rule; e2e:live default boot succeeds.
**Commit:** `chore(e2e): move hardcoded dsh version defaults to 0.2.1-rc.5` — `4d4c648`; `docs: record the dsh 0.2.1-rc.5 e2e baseline and plugin compatibility rule` — `cdd2bbd`

## Stage 6 — Full green sweep
- [x] Run `pnpm test:e2e` for all five plugin packages (vitest lanes; model-settings + attach-editor include playwright; global-queue and ghl playwright lanes run separately) — full sweep after per-package rebuilds: every dsh-matrix lane green on BOTH versions (108/109; no gate markers anywhere; logs `.tmp/e2e-sweep/`)
- [x] Residual failure fixed: the ddgs live lanes (`backends.test.ts` duckduckgo, `live-search.test.ts`) hit DDG-side intermittent empty results (`DDGSException: No results found.` → exit 1, in runs of 5-12 attempts that lift after tens of seconds) — retry the same search with backoff in the lanes (no product-code change); re-runs green (boot/live/backends all pass, sequential runs green)

**Criterion:** every e2e lane green across both matrix versions; final results table reported to the user. — satisfied: model-settings 12, attach-editor 6, global-queue 44 (playwright ~10.7 min), ghl 12+2, web-search-ddgs boot 4 + live 2 + backends 3, all ✓ on `0.2.0-rc.2` and `0.2.1-rc.5`.
**Commit:** `test(web-search-ddgs): retry transient ddgs empty-result throttles in live lanes` — `c1a6212`
