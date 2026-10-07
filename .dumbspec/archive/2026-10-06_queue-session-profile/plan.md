# 2026-10-06_queue-session-profile: implementation plan (queue session profile)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Draft captured (`draft.md`)
- [x] Research collected (`research.md`): session-creation site, slot facts, host patterns, tests
- [x] Spec v1 written; user decisions recorded (capture at add time; preset always selected; old items untouched)
- [x] Plan written and committed (freezes the agreed scope)

**Criterion:** all four task files exist; `git log` shows the spec commit; tree clean.
**Commit:** `docs(dsh-global-queue): dumbspec task 2026-10-06_queue-session-profile (spec + plan)`

## Stage 1 — Deep-dive: preset read/mount mechanics
- [x] Verify the client-side read path: how the `dsh-global-queue` client half can read the selected preset from the `conversation.hero.agentPreset` slot / `AgentPresetSeatController` (slot value shape `HeroAgentPresetOwnerProps`, what `seatInjected` injects, how the controller exposes the selected id, scope access from the AddToQueue seat). Record exact API + excerpts.
- [x] Verify the host-side mount path for a host plugin: exact `agentPresets` inject name and `resolve` / `acquireScope` / `mount` signatures usable from `ctx` in `packages/dsh-global-queue/src/index.ts`. Record exact code.
- [x] Append both findings to `research.md` (sections D1, D2).

**Criterion:** `research.md` contains a verified, concrete client-read snippet and a host-mount snippet (file paths + line numbers), so Stages 2–3 implement against facts, not guesses.
**Commit:** `docs(dsh-global-queue): research — preset read/mount mechanics`

## Stage 2 — TDD: queue item carries the preset; host applies it at create AND resume
- [x] Red: extend `tests/unit/server/composition.test.ts` — the create call must be `{ sessionId, agentOptions, meta: { cwd, agentPreset }, setup }` (setup asserts `agentPresets.mount` called with the preset id). Test fails.
- [x] Red: unit tests for `add` RPC + store — `add` accepts `agentPreset`, `QueueItem` stores it, item list/edit round-trips it; watcher passes `item.agentPreset` into `deps.agents.create`. Tests fail.
- [x] Red: unit test for the **resume** wrapper — a session whose `header.agentPreset` is set is resumed with `setup` that calls `agentPresets.mount(agentCtx, headerPreset)`; a session without `header.agentPreset` is resumed with no setup. Test fails.
- [x] Green: `QueueItem` gains `agentPreset?: string` (`src/queue/types.ts`); RPC `add` param + store persistence (`src/rpc.ts`, `src/queue/store.ts`); watcher create call carries it (`src/queue/watcher.ts`).
- [x] Green: host `create` wrapper — `agentPresets` added to `inject`; `resolve(presetId)` (rejects unknown id before create) + `meta: { cwd, agentPreset: preset.id }` + `setup: (agentCtx) => agentPresets.mount(agentCtx, preset.id)` (`src/index.ts`). NO `acquireScope` (long-lived sessions self-retain via mount).
- [x] Green: host `resume` wrapper — read `header.agentPreset` from `sessionPersistence.stat(resumeSessionId)`; if set, pass `setup: (agentCtx) => agentPresets.mount(agentCtx, headerPreset)`; else no setup (`src/index.ts:183-188`).
- [x] Green: `pnpm typecheck` + `pnpm test` pass (old items without `agentPreset` still create without one — covered by an explicit test).
- [x] Refactor: keep create/resume wrappers reading as the happy path; no premature abstractions.

**Criterion:** unit suite green, including the updated `composition.test.ts` pinning `meta: { cwd, agentPreset }` + `setup`, and the resume-mount test; typecheck clean.
**Commit:** `fix(dsh-global-queue): apply agent preset on queued session create and resume`

## Stage 3 — TDD: client sends the selected preset on add
- [x] Red: client unit test — the Add-to-queue flow includes the currently selected preset (read via the Stage 1 mechanism) in the `add` RPC payload. Test fails.
- [x] Green: `src/client/*` reads the selected preset and passes it in `add`.
- [x] Green: `pnpm typecheck` + `pnpm test` pass.
- [x] Refactor.

**Criterion:** client unit test green: add payload carries the selected preset id.
**Commit:** `feat(dsh-global-queue): send selected agent preset when adding to queue`

## Stage 4 — E2E verification
- [x] E2e (RPC lane, isolated DSH_HOME): seed a queue item with `agentPreset` and `targetSessionId: null`; after the watcher executes it, assert the created session's `agentPreset` header equals the preset — `tests/e2e/server/preset.test.ts`; the session is inspected via the session-projection-cache artifact (the 0.2.0-rc.2 host RPC channel is broken host-side, so no session RPC exists in the lane).
- [x] E2e: a session that has `header.agentPreset` (created with a preset in the same run) is resumed by the watcher for a queued item targeting it; assert it comes back with the preset mounted (projection `agentPreset` non-null / header intact) — second test in the same file.
- [x] Boot smoke + existing RPC/acceptance lanes still green (`pnpm test:e2e`: 3 files, 10 tests, all pass).
- [x] Update `research.md`/this plan with the verified e2e evidence (research D3).

**Criterion:** `pnpm test:e2e` green, including the new preset assertion on the created session and the resume-with-preset assertion.
**Commit:** `test(dsh-global-queue): e2e — queued session carries and resumes agent preset`
