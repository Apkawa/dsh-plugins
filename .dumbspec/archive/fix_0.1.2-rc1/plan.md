# fix_0.1.2-rc1: implementation plan (dual-version client-store load + 405 workaround)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

Delegation rule: one subagent per checkbox step (synchronous, sequential); orchestrator only does task-file glue + checkbox toggling + commits.

---

## Stage 0 — Research + spec + plan
- [x] draft.md captured (verbatim user report: import failure + profile workaround)
- [x] initial spec.md from draft
- [x] refinement gate: user confirmed "no edits"; scope = both dsh versions (0.1.1-rc.2 + 0.1.2-rc.1); autonomy granted
- [x] research via subagent → research.md §1–§5 (error origin, version delta, plugin side, profile materialization, related facts)
- [x] spec.md refined (root cause, approach candidates A/B/C, 405 ownership per archived decisions, done-criteria)
- [x] plan.md written

**Criterion:** all four task files exist and are consistent with each other.
**Commit:** `docs(spec): add fix_0.1.2-rc1 spec, research, and plan` (ddd097d)

## Stage 1 — Deep investigation: dual-version resolution mechanism
- [x] Verify `createSnapshotStore` API parity: old `dsh/packages/client/runtime/src/client/contract/store.ts` (0.1.1-rc.2 tag) vs new `dsh/packages/client/store/src/index.ts:103` (0.1.2-rc.1 tag) — signatures, return shape, `ClientContext`/`SnapshotStore` type compatibility (append to research.md)
- [x] npm registry check (read-only fetch): does `@deepseek-ai/dsh-client-runtime` exist at `^0.1.0-rc.7` with a `./client` export; does `@deepseek-ai/dsh-client-store` exist at all (candidate A feasibility; append to research.md)
- [x] Determine exact `dsh.client.external` semantics in both tags: name→graph-row mapping, where the supplier bundle comes from, whether a seed-named external conflicts, behavior when the external package is absent (append to research.md)
- [x] Decide the mechanism (A / B / C per spec.md), record the decision + evidence in research.md; orchestrator carries it into spec.md/plan.md

**Criterion:** a concrete mechanism is chosen with evidence for BOTH dsh versions; no source changes yet.
**Commit:** `docs(spec): record dual-version mechanism decision`

## Stage 2 — Red: failing e2e on 0.1.2-rc.1
- [x] Run `pnpm test:e2e` (boot smoke lane, version matrix) from `packages/dsh-model-settings/`; capture current per-lane outcomes with evidence (which lanes fail, exact error lines)
- [x] If no existing test observes the import failure specifically, add a focused red test asserting the plugin loader entry imports cleanly on 0.1.2-rc.1 (isolated DSH_HOME, frozen installs, state under `.tmp/`)
- [x] Confirm red: 0.1.2-rc.1 lane fails with the module-table error; 0.1.1-rc.2 lane passes (baseline)

**Criterion:** a failing test reproduces the draft's error on 0.1.2-rc.1 and passes on 0.1.1-rc.2.
**Commit:** `test(e2e): red boot test for 0.1.2-rc.1 client-modules import failure` (db8eba4) — full `pnpm test:e2e` first (all lanes passed — the boot smoke asserts host-side facts only, so the failure passed silently); then reworked `tests/e2e/acceptance.spec.ts` into an `E2E_DSH_VERSIONS` matrix with new assertions: no `/missed the module table/` console error and no "Failed to load plugins" screen on both versions (blanket zero-console-errors kept for 0.1.1-rc.2 only; the RPC-405 pin is the separate vitest lane). `tests-helpers/e2e/live.ts` `launchPluginTestHome` now also returns the minted session cookie (needed for the 0.1.2+ browser auth). Red evidence: 0.1.2-rc.1 fails with the module-table console error + "Failed to load plugins" screen; 0.1.1-rc.2 passes.

## Stage 3 — Green: the import fix
- [x] Implement the Stage-1 mechanism in `packages/dsh-model-settings/` (source imports / `package.json` `dsh.client` fields / `tsdown.config.ts` CLIENT_EXTERNALS / peer deps), sync the stale local `PLATFORM_MODULES` copy to the union of both tags' real seed lists, and bump the package version 0.1.0 → 0.1.1
- [x] `pnpm build` + `pnpm typecheck` green
- [x] E2E green on BOTH dsh versions (boot smoke matrix); 0.1.1-rc.2 lane stays green

**Criterion:** boot smoke green on 0.1.1-rc.2 and 0.1.2-rc.1 with the plugin installed; no manual profile surgery.
**Commit:** `fix(dsh-model-settings): load client store on 0.1.2-rc.1 while keeping 0.1.1-rc.2` (4e8f51f) — mechanism B as decided in research.md §9: value-import `createSnapshotStore` from `@deepseek-ai/dsh-client-store` (types stay on the old specifier), `CLIENT_EXTERNALS` swapped to the store seed, `PLATFORM_MODULES` synced to the 8-word union, tsdown banner shadows `require` with a store→runtime/client fallback wrapper, version 0.1.0→0.1.1. Forced deviation: `tsconfig.client.json` gains a type-check-only `paths` entry for `@deepseek-ai/dsh-client-store` → `dsh/packages/client/store` (the store pkg can't be a devDep: frozen installs, and a peer would fail on 0.1.1-rc.2 where the package doesn't exist). Residual-risk check clean: published `@deepseek-ai/dsh-client-runtime@0.1.0-rc.8` declares no `dsh.bundle`. Outcomes: boot smoke 8/8 both versions; acceptance 0.1.1-rc.2 fully green; acceptance 0.1.2-rc.1 cleared of the module-table signal (tab renders, no error screen) but still red on the empty-state text — the known 0.1.2-rc.1 host 405 (`transport failure for /model-settings/listReasoningRows: HTTP 405`), which is Stage 4's scope and its red test.

## Stage 4 — 405 plugin-side workaround (secondary scope)
- [x] Red: run the RPC lane against 0.1.2-rc.1 (temporary override of the 0.1.1-rc.2 pin) and capture the 405 on `POST /model-settings/*` — captured during Stage 3's acceptance run: 0.1.2-rc.1 section renders `alert: "transport failure for /model-settings/listReasoningRows: HTTP 405" + Retry`; empty-state text unreachable because `listReasoningRows` (an in-session `POST /model-settings/*`) 405s. Root cause: the host applies profile plugins BEFORE the web-app `client-connection` row activates, so `ctx.get('connection')` is undefined at apply and the plugin's RPC channel is never registered → the POST falls through to the static 405 fallback (`dsh/packages/host/frontend-static/src/index.ts:124-130`).
- [x] Implement the plugin-side workaround (connection availability at apply time; archived proposal `ctx.inject(['settings','connection'])` or equivalent) + `pnpm build` + `pnpm typecheck`
- [x] Green: RPC lane green on 0.1.2-rc.1 and on 0.1.1-rc.2; update the e2e pin notes in root `AGENTS.md` + `packages/dsh-model-settings/AGENTS.md` (unpin the RPC lane)

**Criterion:** RPC/acceptance e2e green on both versions; pin notes updated.
**Commit:** `fix(dsh-model-settings): register RPC channel under 0.1.2-rc.1 apply order` (225af97) — `src/index.ts`: the RPC channel row now defers on `sctx.inject(['connection'], connCtx => connCtx.effect(...))` (verified: identical host-side inject semantics in both tags — `vendor/cordis/src/registry.ts:300-301`, fiber INACTIVE/PENDING epochs, `reflect.ts` provide/notify; precedent `packages/bundle/web-app/src/index.ts:262`); settings card + autofill watcher still mount immediately. RPC lane reworked into `describe.each(E2E_DSH_VERSIONS)` (pin removed; stale doc line in `boot.test.ts` fixed). Pin notes in root + package `AGENTS.md` rewritten: lanes are version matrices, 405 worked around plugin-side, host ordering bug remains in dsh. Full `pnpm test:e2e` green: vitest 12/12 (boot 4 + RPC 8, both versions), playwright acceptance 2/2 (both versions) — the 0.1.2-rc.1 empty-state assertion passes (405 gone). Out-of-scope finding: `pnpm test` (unit) is red at HEAD — unit `vitest.config.ts` includes `tests/**/*.test.ts` without the `@root` alias and picks up the e2e specs (all 199 real unit tests pass); needs `exclude: ['tests/e2e/**']` — follow-up, separate commit.

## Stage 5 — Refactor + docs + final acceptance
- [x] Refactor pass over Stage 3/4 changes (KISS/SOLID review; no behavior change) — 5 no-behavior edits: dropped the now-redundant `CLIENT_EXTERNALS` alias in `tsdown.config.ts` (byte-identical to `PLATFORM_MODULES` since `4e8f51f` — exactly the stale-copy drift this task fixed), optional catch binding in the banner, removed the dead `@root` paths entry from `tsconfig.client.json`, corrected its comment (the seed answers directly on 0.1.2-rc.1; only 0.1.1-rc.2 goes through the banner fallback), dropped the sole `return await` in `src/index.ts`.
- [x] Update stale doc: `docs/ai/ui-guideline.md` §2 baseline list (drop `runtime/client`, add `dsh-client-store`) — also dropped `web-react` (stale in both tags; no such seed/package).
- [x] Full acceptance: `pnpm typecheck` + `pnpm build` + `pnpm test:e2e` green — vitest 12/12 (boot 4 + RPC 8, both versions), playwright 2/2 (both versions); built `lib/client.js` requires exactly `@deepseek-ai/dsh-client-store` + the react pair and carries the fallback wrapper. All done-criteria PASS.
- [x] Orchestrator: move `.dumbspec/current/fix_0.1.2-rc1/` → `.dumbspec/archive/fix_0.1.2-rc1/` (lifecycle: all steps `[x]`)

**Criterion:** all lanes green on both versions, docs consistent, task archived.
**Commit:** `docs: update plugin baseline docs and archive fix_0.1.2-rc1` — separate follow-up commit for the pre-existing out-of-scope unit-lane bug: `vitest.config.ts` gained `exclude: ['tests/e2e/**']` so `pnpm test` runs only unit tests (199 passed / 1 skipped; the e2e specs need the `@root` alias the unit config lacks; `dsh-web-search-ddgs` checked — no latent bug there, it scopes to `tests/unit/**`).
