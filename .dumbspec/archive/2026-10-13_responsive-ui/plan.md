# 2026-10-13_responsive-ui: implementation plan (loading feedback for dsh-ghl UI)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] `draft.md` captured (raw input verbatim)
- [x] research delegated to a synchronous subagent; findings appended to `research.md`
- [x] `spec.md` v1 written (open questions resolved by research)
- [x] `plan.md` written

**Criterion:** task dir has draft/research/spec/plan; no open questions in spec.
**Commit:** `docs(dsh-ghl): spec + plan for responsive UI loading feedback`

## Stage 1 — In-flight flags in the client store
- [x] red: extend `tests/unit/client/issue-store.test.ts` (and `issue-store-error.test.ts`) — `refresh` sets `listLoading` before the RPC and clears it on success **and** failure; `select` sets `issueLoading` before the RPC and clears it on success **and** failure
- [x] green: add `listLoading`/`issueLoading` to the store `state` in `packages/dsh-ghl/src/client/index.ts` (+ getters); set before RPC, clear in `finally`
- [x] refactor + verify: `pnpm typecheck`, `pnpm test` from `packages/dsh-ghl`

**Criterion:** unit tests pass, including failure paths; store exposes in-flight flags.
**Commit:** `feat(dsh-ghl): track in-flight issue list/detail loads in client store`

## Stage 2 — Spinners in the UI
- [x] make `@deepseek-ai/dsh-client-ui-primitives` importable: `paths` entry in `tsconfig.client.json` (sibling pattern, provisioned 0.2.0-rc.2 tree); no package.json/lockfile change — tsdown externals already carry the specifier
- [x] `IssuePane.tsx`: primary list load (empty list + `listLoading`) → loading block with `StateDot` + "Loading issues…" (`ghl-loading-list`, before missing-repo check); list refresh (non-empty + `listLoading`) → inline spinner on the Refresh button (`ghl-refresh-busy`); `issueLoading` → "Loading issue #N…" block (`ghl-loading-issue`, before detail view)
- [x] replace the local `refreshing` state in `IssuePane.tsx` with the store flag (Refresh button `disabled={listLoading}`, `onClick` straight to `refresh`)
- [x] fix: 3 client suites failed to resolve `@deepseek-ai/dsh-client-ui-primitives` under vitest — `resolve.alias` in `vitest.config.ts` to the dsh checkout's `packages/client/ui-primitives` (provisioned tree is host-only, no client deps)
- [x] `issue-pane.module.css`: `.loading` (centered block, 12/18 caption, `--dsw-alias-label-secondary`) + `.busyDot` (4px gap on the inline Refresh spinner)
- [x] verify: `pnpm typecheck` ✓, `pnpm test` ✓ (11/124), `pnpm build` ✓; browser check via `scripts/e2e-live.ts` — pane renders end-to-end, 0 console errors, error state (rate-limit) verified; live user report revealed the detail-load spinner sticks (spinner shows, RPC 200, no settled render) — tracked as Stage 2b

**Criterion:** every in-flight interaction renders a spinner; typecheck/tests/build green; browser check confirms immediate visual feedback.
**Commit:** `feat(dsh-ghl): show loading spinners for issue list and detail loads`

## Stage 2a — Fix: publish in-flight flag transitions (user-reported bug)
- [x] red: update store tests to the new publish contract — 4 new in-flight/failure snapshot tests + 7 existing assertions moved to two-publish; 11 tests red on the exact contract mismatch
- [x] green: restructured `refresh`/`select` — publish #1 on flag-set, flag cleared on every terminal path before the terminal publish (old outer try/finally gone)
- [x] refactor + verify: inlined single-use `listPayload`; per-path flag/publish audit clean; `pnpm typecheck` ✓, `pnpm test` ✓ (11/128)

**Criterion:** subscriber observes the in-flight state immediately (before the RPC resolves) and the settled state after; no stale-flag snapshots; full suite green.
**Commit:** `fix(dsh-ghl): publish in-flight flag transitions to subscribers`

## Stage 2b — Fix: stuck loading indicator after issue load (user-reported 2026-10-16)
- [x] root cause (synchronous subagent): static trace found no source defect — the settled publish reaches the live pane (`client/index.ts:214-215`, `IssuePane.tsx:34-41`); ranked runtime candidate #1 = stale served `lib/client.js` bundle; findings appended to `research.md` §6
- [x] red: N/A — the stuck-state contract is already pinned by `issue-store.test.ts:214-230` (select publishes in-flight, then settled snapshot with `issueLoading: false` + `selected`); no failing test exists against the current source
- [x] green: N/A — no source defect; live browser run against the freshly built bundle did not reproduce the symptom (16/16 detail loads: 200 → detail ≤ 818 ms, 0 stuck, 0 console errors)
- [x] verify: live browser run (`.tmp/playwright/dsh-ghl/`: stuck-issue-check.mjs, repeat-clicks.mjs, screenshots) — spinner appears and clears WITHOUT tab switch; `pnpm typecheck` + `pnpm test` re-run in Stage 3 acceptance
- [x] `spec.md` Changes entry: root cause = stale served bundle, no scope/approach change

**Criterion:** issue detail renders its text after the RPC settles, no tab switching needed; full suite green (suite re-verified in Stage 3).
**Commit:** `docs(dsh-ghl): stage 2b root cause — stale bundle, no source fix`

## Stage 3 — Independent acceptance
- [x] dedicated acceptance run (fresh subagent, does not trust Stage 2 self-report): re-ran `pnpm typecheck` + `pnpm test` + `pnpm build` from `packages/dsh-ghl` (all green, 128/128 tests), read the diffs of `3e0b6f8`/`2bf51a9`/`b1b00df`, verified the Criteria of Stages 1, 2 and 2a against the observable state — all PASS

**Criterion:** acceptance agent reports the criteria met, with evidence (commands + output).
**Commit:** N/A
