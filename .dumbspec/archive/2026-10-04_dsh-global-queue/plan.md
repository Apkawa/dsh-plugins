# 2026-10-04_dsh-global-queue: implementation plan (global message queue)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] `draft.md` — raw input recorded
- [x] `research.md` — R1 package structure, R2/R3 right sidebar + Send button (0.2.0-rc.2), R4 sessions from host, R5 global storage, R6 e2e infra (covered by R1)
- [x] `spec.md` v1 — reviewed with the user, open questions resolved
- [x] `plan.md` — this file

**Criterion:** task files exist in `.dumbspec/current/2026-10-04_dsh-global-queue/`; spec v1 agreed by the user.
**Commit:** `chore(dsh-global-queue): dumbspec research, spec and plan`

## Stage 1 — Package scaffold (host, boot smoke)
- [x] `packages/dsh-global-queue/package.json` — `@apkawa/dsh-global-queue`, `main: lib/index.js`, exports `.`, `dsh.bundle.patch`, peers cordis+schemastery, scripts (build/typecheck/test/test:e2e/e2e:live)
- [x] `cordis.patch.yml` — `- insert: - id: global-queue, name: '@apkawa/dsh-global-queue'`
- [x] `src/index.ts` — Cordis face: `name = 'global-queue'`, minimal `apply(ctx)`
- [x] `tsconfig.json`, `vitest.config.ts`, `vitest.e2e.config.ts`, `AGENTS.md`, `README.md`
- [x] frozen `pnpm install` (lockfile), bullet in root `AGENTS.md` `## Projects`
- [x] `tests/e2e/server/boot.test.ts` — boot smoke, `describe.each(E2E_DSH_VERSIONS)`: plugin listed, instance serves

**Criterion:** `pnpm typecheck` green; `pnpm test:e2e` green (boot smoke on 0.2.0-rc.2).
**Commit:** `feat(dsh-global-queue): scaffold package with boot smoke`

## Stage 2 — Queue store (host)
- [x] Queue file format + `QueueStore`: `$DSH_HOME/.global-queue.json` (config `path` default `join(resolveDshHome(), '.global-queue.json')`), atomic tmp+rename writes (mode 0o600) under a cross-process lock (sync mirror of `@deepseek-ai/dsh-atomic-write`'s mechanism — that package is async-only, the store contract is sync)
- [x] Operations: add, reorder (index-based, for drag-and-drop), edit text, remove, status/stats update; item shape `{ id, text, workspacePath, targetSessionId, status, sessionId?, stats?, startedAt?, endedAt?, createdAt, updatedAt }`
- [x] Unit tests — real implementation against a temp dir, no mocks (add/reorder/edit/remove/status transitions/persistence; 16 tests, RED→GREEN)

**Criterion:** `pnpm test` green (store unit tests). — accepted 2026-10-04, 6/6
**Commit:** `feat(dsh-global-queue): queue store with atomic persistence`

## Stage 3 — Watcher + execution (host)
- [x] Idle detection: `ctx.on('agent/status', …)` + initial check on boot; "free" = `ctx.agents.list().every(a => a.status === 'idle')`
- [x] Execution of next `queued` item: new session `ctx.agents.create({ sessionId, meta: { cwd: workspacePath } })` / continue: live `agent.followup(createUserMessage(…))` or `ctx.agents.resume({ resumeSessionId })` for persisted sessions; mark `running` (`sessionId`, `startedAt`, pre-snapshot of `tokenUsage`)
- [x] Completion: `turn/end` → `done` (reason `completed`) / `interrupted` (other reasons) with `endedAt` and token delta
- [x] Restart recovery: `running` items whose agent is not live → `interrupted`
- [x] Unit tests — doubles for the agents registry/events (global idle → run → done; stays queued while any agent busy; interrupted on restart; new vs continue targeting)

**Criterion:** `pnpm test` green (watcher unit tests). — accepted 2026-10-04, 26/26 (10 watcher + 16 store), typecheck 0, boot e2e 2/2
**Commit:** `feat(dsh-global-queue): background watcher and session execution`

## Stage 4 — RPC channel + client half wiring
- [x] Mount `/global-queue` prefix route on host `webServer` (model-settings nested-inject pattern); endpoints: `list`, `add`, `reorder`, `editText`, `remove`
- [x] Client half: `package.json` (`exports["./client"]`, `dsh.client` block, react/tsdown/lightningcss/@playwright/test devDeps), `tsconfig.client.json`, `tsdown.config.ts`, `src/client/index.ts` (RPC client + shared snapshot store)
- [x] e2e RPC tests via `tests-helpers` `rpc()` (list/add/reorder/editText/remove round-trip over the real boot)

**Criterion:** `pnpm typecheck` green (host + client); `pnpm test:e2e` green (RPC lane). — accepted 2026-10-04: typecheck 0 (host + client), test 26/26, test:e2e 8/8 (boot 2 + RPC 6), frozen install 0; follow-ups (stale RED comment, dangling client `types` export, stale AGENTS.md) applied in the same commit. Shared-infra note: `tests-helpers/e2e/dsh.ts` `requiredArtifacts()` now derives the client artifact from the package's exports map (behavior-identical for model-settings).
**Commit:** `feat(dsh-global-queue): RPC channel and client half wiring`

## Stage 5 — UI: "Show queue" tab
- [x] Tab type: `ctx.sidebarRightTabs.register({ id, kind: 'global-queue', title, … })` + keyed slots `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`
- [x] Body: item list; **drag-and-drop** reorder; text editing; remove; status; compact stats `1h 35m, 30.5M`; "open session" link via `ctx.uiWorkspace.openSession(sessionId)` for `running`/`done`/`interrupted`
- [x] Playwright acceptance (`tests/e2e/acceptance.spec.ts`): tab opens, list renders, drag-and-drop reorders, item text edits

**Criterion:** `pnpm exec playwright test` green. — accepted 2026-10-04: playwright 6/6, unit 37/37, typecheck 0, build clean. One legitimate spec adjustment: the status `it` asserts status-label membership in the four valid statuses (the live watcher may pick up a freshly seeded item in the test instance); all other spec assertions unchanged. `formatStats` pinned by a pure-module unit test (`1h 35m, 30.5M` form).
**Commit:** `feat(dsh-global-queue): Show queue tab in right sidebar`

## Stage 6 — UI: "Add to queue" control
- [x] Control in `conversation.input.right` slot: button with target choice ("current session" / "new session"); sends the composer draft text to the queue, clears the field
- [x] Playwright acceptance: control visible, click adds the item (verified via RPC/queue file)

**Criterion:** `pnpm exec playwright test` green. — accepted 2026-10-04: playwright 10/10, unit 37/37, typecheck 0, build clean. Empty draft no-ops (no RPC); the composer is cleared only after a successful add; labels ("Add to queue"/"current session"/"new session") do not collide with dsh's built-in per-session queue names.
**Commit:** `feat(dsh-global-queue): Add to queue control`

## Stage 7 — Full e2e + docs
- [x] Full suite green: unit + e2e (vitest) + acceptance (playwright) on the 0.2.0-rc.2 matrix
- [x] `README.md` + `AGENTS.md` polish (install, usage, structure)

**Criterion:** all test lanes green from `packages/dsh-global-queue`; docs complete. — accepted 2026-10-04: typecheck 0, unit 37/37, build clean, vitest e2e 8/8 (boot 2 + RPC 6), playwright 10/10 on 0.2.0-rc.2; docs free of stale placeholders, all referenced paths exist, documented commands match `package.json`; the stale "host-only" phrasing in the root `AGENTS.md` bullet and the package `description` was fixed in the same commit.
**Commit:** `chore(dsh-global-queue): full e2e green and docs`
