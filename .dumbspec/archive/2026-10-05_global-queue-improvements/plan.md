# 2026-10-05_global-queue-improvements: implementation plan (доработки dsh-global-queue)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

**Standing constraints:** e2e only against dsh `0.2.0-rc.2` (`E2E_DSH_VERSIONS`); the `dsh/` symlink checkout may be NEWER than the pinned release — client/host API code must be verified against the provisioned tree `.tmp/dsh-versions/0.2.0-rc.2/`; no new runtime deps; `data-testid` DOM contract of `tests/e2e/acceptance.spec.ts` preserved; frozen pnpm installs; isolated `DSH_HOME` under `.tmp/`.

---

## Stage 0 — Research + spec + plan
- [x] `draft.md` (raw input + addenda) + initial `spec.md`
- [x] Research R1–R6 (6 sequential subagents: client UI, model-settings styling, ui-guideline doc, Start tab, state machine, session creation, e2e/fake provider) — findings in `research.md`
- [x] Spec v1 (full format, Changes section)
- [x] Spec review: all open questions resolved with the user (item 3 context signal, fix both create+resume, e2e asserts all three, watcher wakes on `add` only)
- [x] `plan.md`

**Criterion:** all four task files exist; spec v1 with `**Created:**` and `## Changes`; no open questions remain.
**Commit:** `docs(global-queue): dumbspec task — research, spec, plan` (`d040275`)

## Stage 1 — Deep research: "new session" client signal in 0.2.0-rc.2 (item 3)
- [x] Research in the provisioned tree `.tmp/dsh-versions/0.2.0-rc.2/node_modules/…`: how a new/blank session is represented client-side (`blank`, `seq`, `turn/start` in session summaries); what the `useSessions` / slot props expose to `conversation.input.right` components in that version; where profile/workspace selectors render (the "new session" state)
- [x] Append findings to `research.md` immediately (concrete `path:line` in the 0.2.0-rc.2 tree)
- [x] If the signal differs from the spec assumption, update `spec.md` + append a `## Changes` entry — signal confirmed: `SessionSnapshot.blank` via slot prop `useConversation` (`SC/lib/types/client/contract/snapshot.d.ts:74`, `SLT/lib/types/client/slot-catalog.d.ts:88-106`); spec approach stands

**Criterion:** `research.md` names the exact client signal (path:line in the 0.2.0-rc.2 tree) the plugin can read to distinguish "new (blank) session" from "session with conversation"; item 3 approach is settled.
**Commit:** `docs(global-queue): research new-session client signal (0.2.0-rc.2)` (`96322de`)

## Stage 2 — Host: watcher fixes (items 4, 5)
- [x] Verify in the 0.2.0-rc.2 tree which host APIs the plugin `ctx` exposes for workspace attachment (`workspaceRegistry` / `sessions` remote / `ctx.workspaces`) — pick the attach mechanism → `ctx.workspaceRegistry.create(path).then(ws => ws.attachSession(sessionId))` (service `workspaceRegistry` in `dsh-workspace`, registered in the web profile)
- [x] RED: unit tests — (a) `add` with zero live agents → item goes `running` (watcher woken by `add`); (b) `create` branch delivers `item.text` via `followup` after `agents.create` resolves; (c) `resume` branch delivers `item.text`; (d) created session is attached to the item's workspace
- [x] GREEN: implement in `src/queue/watcher.ts` + adapter in `src/index.ts` (await the real `Promise<AgentHandle>`, deliver text, attach session) — plus serialized dispatch chain, `nudge` trigger from `rpc.ts` `add`, failures → `interrupted`
- [x] Refactor; full unit suite green — 41/41 tests, `pnpm typecheck` passes

**Criterion:** new unit tests pass: no-activity `add` → `running` with a workspace-attached session and a delivered prompt; `resume` path delivers its prompt.
**Commit:** `fix(global-queue): wake watcher on add, deliver prompt on create/resume, attach session to workspace` (`c4d6a47`)

## Stage 3 — Client: context-driven target, drop the menu (item 3)
- [x] RED: unit test for the pure target-resolution (new/blank session → `null`; session with conversation → current id); update `tests/e2e/acceptance.spec.ts` — menu items `global-queue-add-current`/`-new` gone; add in new session → item `targetSessionId` null; add in ongoing session → item targets the current session
- [x] GREEN: `AddToQueue.tsx` — remove the dropdown, derive target from the Stage 1 signal (correction: the hook over `SessionSnapshot` in 0.2.0-rc.2 is `useSession`, NOT `useConversation` — `useConversation` is over `ConversationSnapshot { views, activeTargets }`; verified in the provisioned tree)
- [x] Refactor — 43/43 unit, 10/10 acceptance (incl. both context tests, target read via RPC `list`), `pnpm typecheck` green

**Criterion:** unit + acceptance lanes green; no menu in the DOM; both contexts queue the correct target.
**Commit:** `feat(global-queue): context-driven queue target, remove target menu` (`0966210`)

## Stage 4 — Client: styling plumbing + styled button + Start tab entry (items 1, 2)
- [x] RED: acceptance assertions — button computed styles (sm capsule h28, token-based fill/border, icon present); Start tab: close all tabs → "Show queue" entry visible → click opens the queue pane
- [x] GREEN: vendor `dsh-css-inline` into `tsdown.config.ts` + `lightningcss` devDep + `src/client/css-modules.d.ts`; queue CSS module; 16px icon; `guide: [{ id: 'show-queue', order: 40, … }]` in `sidebarRightTabs.register` — deviations: NO `Button` atom (excess `data-testid` prop + no dsh client dep in package.json under frozen installs → plain `<button>` + local CSS module); guide `icon` omitted (GuideBody cube-glyph fallback)
- [x] Refactor — typecheck + build (13.05 kB) + 43/43 unit + 12/12 acceptance green. Start-tab note (empirical): guide entries register late via their own `ctx.effect` — the seeded pane shows only our entry at mint; a collapsed column re-seeds from the live registry on expand (test handles both)

**Criterion:** `pnpm build` OK (style tag injected in the client bundle); acceptance green: styled button renders, Start tab entry appears and opens the queue pane.
**Commit:** `feat(global-queue): styled Add to queue button with icon; Start tab entry` (`6c5ca3b`)

## Stage 5 — Client: restyle the queue pane (item 6)
- [x] RED: acceptance assertions for pane styling (row layout/hairlines, status label colors per state, edit input h32, remove button, open-session link, themed scrollbar)
- [x] GREEN: `QueuePane.tsx` on a CSS module per `docs/ai/ui-guideline.md` (14/22 + 12/18, `border-l2` hairlines, state tokens for `queued`/`running`/`done`/`interrupted`, flex-fill scrollable list with themed scrollbar) — deviations: link token is `--dsw-alias-link` (not `label-link`); tab body is `flex column; height: 100%; min-height: 0` so the list fills it (no magic max-height)
- [x] Refactor; keep the `data-testid` contract — typecheck + build (17.30 kB) + 43/43 unit + 14/14 acceptance green

**Criterion:** acceptance green; pane styled per the guideline; existing DOM hooks unchanged.
**Commit:** `feat(global-queue): restyle queue pane` (`91a54dd`)

## Stage 6 — E2E: fake provider + new-session flow acceptance (item 5)
- [x] RED: new acceptance test — fake provider written to `<root>/.dsh/profiles/web/cordis.patch.yml` (pattern: `warmModel`/`upsertLlmEntry` from `tests-helpers/e2e/dsh-fixture.ts`, `llm-pi-ai`, `openai-completions`, closed local port, `e2e-model`); add an item for a new session; assert (a) item → `running`, (b) session visible (workspace list) + "open session" link navigates, (c) connection error → item → `interrupted`
- [x] GREEN: wire the provider into the global-queue e2e fixture; fix any remaining gap found by the test — notes: (a) asserts the `sessionId` (durable proof the watcher started it — `running` itself is sub-poll transient); the created session ran the keyless home default model (`DeepSeek-V41-Flash`), turn failed `MISSING_CREDENTIAL`; the pane is pull-only (no server-push) — status transitions need a pane remount to surface (UX limitation flagged, not fixed)
- [x] Refactor — 15/15 acceptance (2.2m), all other lanes green

**Criterion:** `pnpm test:e2e` green including the new new-session flow test (all three asserts).
**Commit:** `test(global-queue): e2e new-session flow with fake provider` (`b185383`)

## Stage 7 — Full regression + visual verification
- [x] `pnpm typecheck`, `pnpm test` (unit 43/43), `pnpm test:e2e` (vitest 8/8), `npx playwright test` (acceptance 15/15) all green
- [x] Playwright screenshots of the new UI (button, Start tab, pane, statuses) → `.tmp/` — SKIPPED by user (too slow); regression-only
- [x] Final pass over plan.md checkboxes

**Criterion:** every lane green; screenshots captured.
**Commit:** N/A (fix commits only if something surfaces)

## Stage 8 — Host: bind the current model to created sessions (item 5 residual)
User report: a queued new-session item's turn fails with `prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")`. Root cause (researched): the web-app deployment `personaPrefix` references `{{model}}` (`dsh-web-app/cordis.patch.yml:16-20`), the baseline variable resolves from `agent.options.model` (`dsh/packages/core/agent-loop/src/index.ts:371`), and the plugin's `ctx.agents.create` omits `agentOptions` → `model` undefined → `interpolate()` throws (`dsh/packages/core/system-prompt/src/index.ts:356`). Normal sessions bind `agentOptions: ctx.agentDefaultModel.currentSelection()` at creation (`dsh/packages/api/session-controller/src/agent.ts:486-494, 497-500`).
- [x] RED: unit test — the `create` adapter passes `agentOptions: ctx.agentDefaultModel.currentSelection()` to `ctx.agents.create` (new `agentDefaultModel` seam in the test deps) — `tests/unit/server/composition.test.ts` (real Cordis `Context` + `ctx.provide` doubles; red confirmed first)
- [x] GREEN: `src/index.ts` — `'agentDefaultModel'` in `inject`, `AgentsSeam.create` widened with `agentOptions?`, binding `agentOptions: { provider, model }` from `currentSelection()` in the `create` adapter (watcher seam unchanged; `resume` branch unchanged — restored from the logged `request/header`)
- [x] Verify the Stage 6 e2e flow: strengthened with step (d) — the turn's failure line must NOT contain `{{model}}` and must match `/credential|connection|api key/i`; observed post-fix: `No API key for provider: e2e`
- [x] Refactor; full lanes green — typecheck ✅, build ✅, 44/44 unit, 15/15 acceptance

**Criterion:** a queued new-session item's turn assembles the prompt with a real `{{model}}` value; e2e shows the provider-level failure, not the assembly error.
**Commit:** `fix(global-queue): bind current model to created sessions` (`e991c23`)
