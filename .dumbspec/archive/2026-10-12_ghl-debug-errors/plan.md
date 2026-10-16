# 2026-10-12_ghl-debug-errors: implementation plan (dsh-ghl transparent errors + debug logs)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Draft captured (draft.md)
- [x] Research: dsh-ghl repo detection + token handling (R1)
- [x] Research: client rendering + workspace context availability (R2)
- [x] Research: dsh-model-settings logging pattern (R3)
- [x] Spec v1 written; plan written

**Criterion:** draft/research/spec/plan exist in `.dumbspec/current/2026-10-12_ghl-debug-errors/`; spec v1 in full format.
**Commit:** `docs(ghl): dumbspec task 2026-10-12_ghl-debug-errors` (task committed before execution, freezes scope)

## Stage 1 — Deep research: workspace seam on dsh 0.2.0-rc.2
- [x] Verify `ctx.workspaceRegistry` availability in the pinned e2e dsh version 0.2.0-rc.2 (not just the `dsh/` symlink source)
- [x] Determine what workspace info the dsh client (browser) context exposes — can the client send a workspace id/path in the payload?
- [x] Decide the disambiguation approach for >1 registered workspaces; record in research.md and update spec Approach if needed

**Criterion:** research.md contains the answers; the spec's deferred open question is resolved; the approach is final.
**Commit:** N/A (research only)

## Stage 2 — Host: workspace-aware repo detection
- [x] Failing tests: `gitRemoteUrl(cwd)` runs git in the given cwd; workspace resolution (payload `workspacePath` first, registry fallback); detection failures with codes `no-workspace` / `no-remote` / `not-github` / `ambiguous-workspace`
- [x] Implement: `gitRemoteUrl` takes `cwd`; workspace resolution (payload `workspacePath` → registry fallback); structured detection result (no silent null)
- [ ] Wire `workspaceRegistry` into the composition root (`src/index.ts`)

**Criterion:** unit tests green; every former silent-`null` case now yields a code + message.
**Commit:** `feat(ghl): workspace-aware repo detection`

## Stage 3 — Host: transparent RPC errors
- [x] Failing tests: `detectRepo` endpoint returns `ok:false` with code + message on detection failure; existing codes (`no-repo`, `rate-limit`, `not-found`, `internal`) unchanged
- [ ] Implement in `src/rpc.ts`

**Criterion:** tests green; no `ok:true, repo:null` path remains.
**Commit:** `fix(ghl): surface repo-detection failures in the RPC`

## Stage 4 — Client: show RPC errors in the pane
- [x] Failing tests: `callRpc` preserves `code`/`details`; store `error` state; `refresh`/`select` catch and publish; pane renders the error branch
- [x] Implement: typed RPC error, `state.error`, catch + publish, `IssuePane` error UI (message + code); the no-repo text only on a server no-repo failure with the reason
- [ ] Client derives its workspace path (global-queue pattern: `workspaces` service + session id) and sends `workspacePath` in the RPC payload

**Criterion:** unit tests green; a `rate-limit` message reaches the UI instead of a silent "No issues".
**Commit:** `feat(ghl): show RPC errors in the Issues pane`

## Stage 5 — Debug logging (dsh-model-settings pattern)
- [x] Failing test for `src/log.ts` (mirror the reference four cases)
- [x] Implement `src/log.ts` with `TAG = '[ghl]'`; place logs: workspace/git resolution, HTTP requests, RPC failures, cache budget
- [x] README "Debugging" section

**Criterion:** tests green; `DEBUG=1` traces the full detect→list path; `error` lines always print.
**Commit:** `feat(ghl): add DEBUG=1 gated logging`

## Stage 6 — Verification + docs
- [x] `pnpm typecheck` + `pnpm test` in `packages/dsh-ghl` green
- [x] e2e boot smoke (package lane)
- [x] README: no token required (free limits), transparent errors, `DEBUG=1`

**Criterion:** all package checks green; README reflects the behavior.
**Commit:** `docs(ghl): document errors and debugging`
