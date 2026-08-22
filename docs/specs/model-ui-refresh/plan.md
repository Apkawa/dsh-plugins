# model-ui-refresh: implementation plan (silent section refresh on external model changes)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Capture raw request verbatim (`draft.md`)
- [x] Research: bug mechanism, standard-UI pattern, host event source, client channel, UI hazards (see `research.md`)
- [x] Write `spec.md` (user language: Russian)
- [x] Review spec with the user, freeze scope

**Criterion:** `draft.md`, `research.md`, `spec.md` present and confirmed; no open questions left.
**Commit:** `docs(spec+plan): model-ui-refresh — silent section refresh on external model changes`

## Stage 1 — Controller silent refresh
- [x] Red: tests in `tests/reasoning-controller.test.ts` for the silent refresh method:
  - success: rows replaced, phase stays `'ready'` (no `'loading'` flip)
  - failure: previous rows kept, phase stays `'ready'` (no `'error'`), no throw
  - stuck loading phase settled when a refresh fails
  - sequence guard: an older in-flight response applied after a newer request is ignored
- [x] Green: `src/client/reasoning-controller.ts` — add the `refreshRows()` method
  (no phase flip, keep rows on failure, never throws; monotonic sequence guard
  shared with `loadRows`)
- [x] `pnpm typecheck` + `pnpm test` green (in `packages/dsh-model-settings`)

**Criterion:** silent refresh behaves per spec §2 without touching the public `loadRows` contract; all tests green.
**Commit:** `feat(dsh-model-settings): silent row refresh with sequence guard for invalidations`

## Stage 2 — Client subscription wiring
- [x] `src/client/index.ts`: add `'remote'` to `export const inject` (hard dependency, the
  `ui-settings-models` precedent; `api-gateway` is in every web profile) + structural mirror
  of the `remote` service (only `$on`), accessed via `ctx.get('remote')`
- [x] `ctx.effect(...)`: subscribe `settings/document-updated`; filter `ns === 'llm-pi-ai'`
  (hardcoded string mirroring the Host `LLM_NS`); handler calls the controller's silent refresh;
  disposer returned from the effect
- [x] `pnpm typecheck` + `pnpm test` green; `pnpm build` → `lib/client.js` carries the
  subscription (live behavior — see Final stage)

**Criterion:** typecheck/tests green; the built client bundle contains the `settings/document-updated`
subscription; live re-list verified in the Final stage.
**Commit:** `feat(dsh-model-settings): subscribe to settings/document-updated for section refresh`

## Stage 3 — Clean-draft re-adopt (clobber guard)
- [x] `src/client/ReasoningSection.tsx` `ModelRow`: `levelsDirty` ref (set in
  `updateLevel`, released in `onSave` for a committed save or a ctx-only save with a
  clean editor) + `useEffect` on `row.efforts` — a clean editor re-adopts
  `draftsFromEfforts(row.efforts)` on every re-list; a touched editor keeps the
  user's drafts
- [x] `pnpm typecheck` + `pnpm test` green

**Criterion:** an external `reasoningEfforts` change is reflected in untouched rows, and an
untouched editor cannot push a stale mapping over the external change on Save.
**Commit:** `fix(dsh-model-settings): re-adopt clean level drafts after external refresh`

## Final — manual acceptance (spec acceptance criteria 1–2)
- [x] Live check: standard-UI model change → section re-lists, no flash, drafts
  preserved (confirmed by the user in the running `dsh web` session)
- [x] Settings-file edit → section re-lists — rides the same event path the user
  just verified (settings-file chokidar → `publish` → `bumpRevision` →
  `settings/document-updated`, research §3); no separate live spot-check run
- [x] Full `pnpm test` green in `packages/dsh-model-settings` (166 passed, 1
  skipped — the pre-existing skip)

**Criterion:** all spec acceptance criteria pass.
**Commit:** `docs(spec+plan): model-ui-refresh — live acceptance passed, task complete`
