# 2026-09-30_e2e-matrix-0-2-0: implementation plan (e2e matrix → 0.2.0-rc.2)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Research R1: inventory of version references, matrix consumers, e2e plumbing, `scripts/e2e-live.ts`, `fix_0.1.2-rc1` state, per-package e2e files (appended to research.md)
- [x] Research R2: dsh 0.2.0-rc.2 impact — npm state, 405 ordering status, plugin API surface deltas, ready line, release notes (appended to research.md)
- [x] spec.md v1 written (draft + research), open questions 1–2 deferred to a plan-stage deep investigation
- [x] plan.md written

**Criterion:** draft/spec/research/plan exist in the task dir; research covers both R1 and R2; spec v1 has `Created` + `Changes`.
**Commit:** `docs: spec for e2e matrix switch to dsh 0.2.0-rc.2`

## Stage 1 — Matrix → 0.2.0-rc.2 (red)
- [x] `tests-helpers/e2e/dsh.ts`: `E2E_DSH_VERSIONS = ['0.2.0-rc.2']`; default version in `launchDsh`/`resolveDshBinary` → `0.2.0-rc.2`; update header/inline comments (tokenless-vs-tokenized notes now only about the 0.1.1 baseline being gone)
- [x] `tests-helpers/e2e/live.ts`: update baseline comments (no literal 0.1.1 default left)
- [x] `scripts/e2e-live.ts`: `--version` default → `0.2.0-rc.2`
- [x] Provision `.tmp/dsh-versions/0.2.0-rc.2` (first e2e launch auto-provisions, ~180 s) — done via `pnpm e2e:live --port 3991`, `dsh --version` → `0.2.0-rc.2`
- [x] Run both packages' e2e lanes on 0.2.0-rc.2 (boot, RPC, acceptance, ddgs boot/live-search) and RECORD the failures as red evidence (no fixes yet) — model-settings all red on peer-dep install rejection (new fact R3); ddgs boot green; ddgs live-search red on live-network (`No results found`)
- [x] Acceptance run: matrix is single-version, red failures captured — independent verifier PASS (single-version matrix, defaults, provisioned bin, red logs for both packages, no source fixes)

**Criterion:** `E2E_DSH_VERSIONS` = `['0.2.0-rc.2']` only; an e2e run on 0.2.0-rc.2 executed for both packages with failures recorded (expected: model-settings host half breaks on settings API).
**Commit:** `test(e2e): switch version matrix to 0.2.0-rc.2`

## Stage 2 — Deep investigation: settings API migration mapping
- [x] From `.tmp/dsh-src-0.2.0-rc.2/` source + extracted `@deepseek-ai/dsh-settings@0.2.0-rc.2` types: determine how a host-side plugin declares its `Config` schema, what the namespace id will be for our bundle (entry `model-settings`), what `describe()` returns, and what `mutate` path ops are accepted (incl. `providers.<route>.models`-style ops) — R4.1/R4.2/R4.6
- [x] Verify whether the `llm-pi-ai` entry carries a `Config` in 0.2.0-rc.2 (autofill `makeLlmStore` depends on `mutate('llm-pi-ai', …)`) — R4.5: YES, `providers: z.dict(profile).default({}).volatile()`
- [x] Decide the import strategy: bump types-only `@deepseek-ai/dsh-settings` devDep to 0.2.0-rc.2 vs drop the `settingsNamespace`/`SettingsProvider` imports — R4.9: drop the dead imports, keep usable types (`SettingsNamespace`/`SettingsPathOp`/`SettingsConflictError`)
- [x] Record the concrete migration mapping in research.md (R4) and resolve spec open questions 1–2 (decision: no `Config`, no `model-settings` namespace — data lives only in `llm-pi-ai`; NEW FACT: client slot `settings.plugin.item` gone in 0.2.0-rc.2)
- [x] Acceptance run: mapping recorded, open questions resolved in spec.md — independent verifier PASS (R4 subsections verified against sources; spot-checks 2a/2b/2c all confirmed; spec Q1–Q2 resolved; no source files touched)

**Criterion:** research.md contains a concrete mapping (Config schema shape, namespace id, mutate ops, imports) for the model-settings host half; spec open questions 1–2 answered.
**Commit:** N/A (research only, folded into the Stage 3 commit or a `docs` commit)

## Stage 3 — model-settings host half → settings API (green: RPC lane)
- [x] Bump `peerDependencies` in `packages/dsh-model-settings/package.json` from `^0.1.0-rc.7` to ranges covering 0.2.0-rc.2 (`@deepseek-ai/dsh-client-connection`, `dsh-client-runtime`, `dsh-client-ui-slots`, `dsh-settings`) so `dsh plugin add` accepts the plugin (R3: install-time compatibility check) — done; `dsh plugin add` accepted after the bump
- [x] Implement the migration per R4: DROP the empty `model-settings` namespace (remove `register(NS, ModelSettingsSchema, {base})`, `ModelSettingsSchema`/`EMPTY_CONFIG`, and the `settingsNamespace` import — `SettingsProvider` stays, it types the injected settings service in `makeLlmStore`; no `Config` export added); rename `ctx.on('settings/updated', …)` → `ctx.on('settings/document-updated', (ns, revision) => …)`; use plain-string namespace ids (`'llm-pi-ai'`) in `makeLlmStore` (`describe()`/`mutate({op:'set', path:['providers', routeId, 'models']})` unchanged); if the install check still rejects after the peer bump, extend the cordis/schemastery peer ranges per R4.9/R4.11-3
- [x] Rewrite `tests/unit/server/composition.test.ts`: the two registration tests encode the removed 0.1.x behavior — replace with (a) apply() no longer registers a `model-settings` namespace, (b) fiber teardown disposes cleanly; `pnpm test` fully green — done (16/16 files, 199 pass)
- [x] `pnpm typecheck` green in packages/dsh-model-settings
- [x] NEW (Stage-3 red, root-caused): 0.2.0-rc.2 HOST BUG — `rpc-host.ts` `register()` reads `owner.webServer` off the connection entry's own context; the sibling `webserver` fiber is not in that chain, so `conn.rpc.handle(CHANNEL, …)` never mounts the route (405). No first-party 0.2.0 plugin exercises this path. Workaround (plugin-side): replace the `sctx.inject(['connection'], …)` leg with the host's own proven nested-inject pattern — `sctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register({kind:'prefix', path: CHANNEL, handler})))` — where the handler implements the 0.2.0 rpc wire envelope (`client-request` → `server-response`, see `rpc-host.ts` `rpcFetchHandler` L222-268); drop the stale 3-arg `ConnectionRpcHandle` type. Upstream one-line fix (register the effect inside `owner.inject(['webServer'], …)`) tracked separately — note in docs — DONE (cold + saveModel lanes green)
- [x] NEW (Stage-3 red, root-caused R6): the e2e fixture seeded models by writing `<home>/settings.yaml` — a dead 0.1.x seam in 0.2.0 (one-time boot import, never watched). Rewrote `tests-helpers/e2e/dsh-fixture.ts` to upsert the `llm-pi-ai:` section into `$DSH_HOME/profiles/web/cordis.patch.yml` (the only runtime config seam, HMR-watched) — DONE (warm lanes green)
- [x] NEW (Stage-3 red, root-caused R7): the host emits `settings/document-updated` from INSIDE its open HMR transaction, so the autofill round's `settings.mutate` is rejected as a nested transaction (`HMR transactions cannot be nested`; the check is AsyncLocalStorage-bound — `setImmediate` deferral verified insufficient). Workaround: run the round under the hmr service's `executing.exit(…)` idiom (handle read via `ctx.inject(['hmr'], …)`; `exit` forwards the round promise so `.catch`/`.finally` work); `listReasoningRows` now treats schemastery's materialized `[]` input as absent (same semantics as autofill) — DONE (autofill lane green, 6/6)
- [x] RPC lane (`tests/e2e/server/model-settings.test.ts`) green on 0.2.0-rc.2 (saveModel roundtrips, autofill) — 6/6 green (boot 2/2; RPC: cold, saveModel ×2, autofill)
- [x] Acceptance run: RPC suite green on 0.2.0-rc.2, independently re-run — independent verifier PASS (typecheck/build green, 6/6 e2e re-run, peer ranges, fixture seam, `testTimeout` key, no leaks)

**Criterion:** `pnpm typecheck` green; model-settings RPC e2e suite fully green on 0.2.0-rc.2.
**Commit:** `fix(dsh-model-settings): adapt host half to dsh 0.2.0-rc.2 settings API`

## Stage 4 — model-settings client-store + acceptance lane (green: playwright)
- [x] `tsdown.config.ts`: client-store seed list narrowed to the 0.2.0-rc.2 seed (comment now cites the 0.2.0 `PLATFORM_MODULES` seed list; the `__nq` dual-version store fallback dropped — verified against `packages/client/web/src/{platform.ts,seed.ts}` that every external is statically seeded, `PRELOADED_CLIENT_EXTERNALS` is empty)
- [x] Client slot migration (R4.10): resolved — the LIVE client registration already targets the current 0.2.0 slot `settings.section` (`src/client/index.ts:72-77`); the gone `settings.plugin.item` only survives in the type-only `slot-contract.ts` augmentation and the disabled v1 card path (`CLIENT_ENABLED = false`, never runs) — no runtime migration needed
- [x] `tests/e2e/acceptance.spec.ts`: flattened to the single version, 0.1.1-only branches removed (console-clean now unconditional), header rewritten for 0.2.0 (Preview Notice → API-key dialog order; R5 `webServer`-route workaround note); `__DSH_BOOT__` interface updated to the 0.2.0 `WebBootGraph` shape (entries + batches, per-entry rev)
- [x] `tests-helpers/e2e/live.ts`: comment updated — the keyless 0.2.0-rc.2 home is console-clean at every severity (live probe: zero console messages), so no filter is needed (severity filter kept as-is)
- [x] Acceptance lane (`pnpm exec playwright test`) green on 0.2.0-rc.2 — 1/1 passed twice (25.7–25.8 s); vitest lane re-run 6/6 after the tsdown change
- [x] Acceptance run: playwright suite green on 0.2.0-rc.2, independently re-run — independent verifier PASS (`pnpm test:e2e`: vitest 6/6 + playwright 1/1, typecheck green, diff-backed, 0.2.0 seed-table cross-check, no leaks)

**Criterion:** model-settings `pnpm test:e2e` (vitest + playwright) fully green on 0.2.0-rc.2.
**Commit:** `test(dsh-model-settings): single-version acceptance lane for 0.2.0-rc.2`

## Stage 5 — dsh-web-search-ddgs on 0.2.0-rc.2 (+ unified 0.2.0 type baseline)
- [x] Bump types-only devDep `@deepseek-ai/dsh-web` 0.1.1-rc.2 → 0.2.0-rc.2 in `packages/dsh-web-search-ddgs/package.json`
- [x] R8/R9: plain install blocked by pnpm prerelease peer-range intersection → bump model-settings' four dsh-* devDeps `^0.1.0-rc.7` → `^0.2.0-rc.2` (types baseline unified on 0.2.0) and adapt host/client types to the 0.2.0 exports: drop the `SettingsProvider` import in `src/index.ts` (local structural seam for `makeLlmStore`, import real `SettingsPathOp`), rewrite `tests/unit/server/composition.test.ts` on the `ctx.provide(… as never)` fake-service idiom, fix client imports (`ClientContext` → cordis `Context`; `SnapshotStore` → `@deepseek-ai/dsh-client-store` generic). NEW FACT: `dsh-client-runtime` was renamed `dsh-client-modules` in 0.2.0 (inject list + peers + devDeps moved); `ctx.slots` typing moved to ui-renderer → local `SlotRegistryFace` mirror
- [x] ONE plain `pnpm install` at the repo root (sanctioned exception to frozen installs) regenerates the lockfile — no new deps; `pnpm install --frozen-lockfile` green, zero 0.1.x `@deepseek-ai/dsh-*` lockfile nodes (entire 0.1.x closure replaced by the 0.2.0-rc.2 closure)
- [x] ddgs `pnpm typecheck` green with NO source changes (`WebSearchProvider` still exported from `@deepseek-ai/dsh-web` 0.2.0, seam unchanged)
- [x] ddgs e2e lane (`pnpm test:e2e`, `UV_CACHE_DIR=.cache/uv`) green on 0.2.0-rc.2 — 4/4 (boot 2/2; live-search PASSED this run, 5 real results — no environmental failure to document)
- [x] model-settings re-verify on the unified baseline: `pnpm typecheck` + `pnpm test` (unit 199/199 + 1 pre-existing skip) + `pnpm test:e2e` (vitest 6/6 + playwright 1/1) green
- [x] Acceptance run: ddgs e2e green on 0.2.0-rc.2, independently re-run — independent verifier PASS (all 5 criteria: ddgs lanes, model-settings lanes, frozen lockfile + zero 0.1.x nodes, diff hygiene, style spot-check)

**Criterion:** web-search-ddgs typecheck + e2e green on 0.2.0-rc.2; lockfile regenerated and frozen-installable; model-settings remains fully green on the unified 0.2.0 baseline.
**Commit:** `chore: unify dsh type baseline to 0.2.0-rc.2 (ddgs dsh-web bump + model-settings devDeps + lockfile)`

## Stage 6 — Docs + final full e2e green
- [x] Root `AGENTS.md`: matrix = `0.2.0-rc.2`, `e2e-live --version` default note, workaround note now for the 0.2.0-rc.2 host `rpc-host` bug (plugin mounts its own `/model-settings` prefix route), stale ref → `.dumbspec/archive/fix_0.1.2-rc1`
- [x] `CONTRIBUTING.md`: drop stale "pinned to 0.1.1-rc.2" wording, matrix wording, `--version` default `0.2.0-rc.2`, ready-URL + known-issue paragraphs rewritten for 0.2.0-rc.2
- [x] `packages/dsh-model-settings/AGENTS.md`: same stale ref → archive + 0.2.0-rc.2 `rpc-host` workaround wording
- [x] Full final run: both packages' `pnpm test:e2e` green on 0.2.0-rc.2, both `pnpm typecheck` green
- [x] Acceptance run: final independent e2e + typecheck green on both packages — independent verifier PASS (docs, diff hygiene, model-settings typecheck/unit 199/199+1 skip/e2e vitest 6/6 + playwright 1/1, ddgs typecheck/unit 23/23/e2e 4/4 incl. live-search green, cleanup)
- [x] Archive the task dir `current/2026-09-30_e2e-matrix-0-2-0` → `archive/`

**Criterion:** all e2e lanes + typecheck green on 0.2.0-rc.2 for both packages; docs updated; all plan checkboxes `[x]`; task archived.
**Commit:** `docs: e2e matrix is now 0.2.0-rc.2 (0.1.1 support dropped)`
