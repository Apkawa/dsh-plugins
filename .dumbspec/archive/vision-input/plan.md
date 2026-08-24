# vision-input: implementation plan (vision checkbox + autofill from /v1/models)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Record the raw request in `draft.md`
- [x] Research: dsh `input` semantics, plugin architecture, test conventions, e2e fixture constraints → `research.md`
- [x] Write `spec.md` (checkbox semantics, autofill rules, RPC contract, out-of-scope)
- [x] Write `plan.md`

**Criterion:** `draft.md` + `research.md` + `spec.md` + `plan.md` exist under `current/vision-input/`; user granted autonomous run.
**Commit:** `docs(spec+plan): vision input spec + plan`

## Stage 1 — props: parse `architecture.input_modalities`
- [x] `tests/unit/server/props.test.ts`: red tests for `entrySupportsVision` (text+image → true; text-only → false; no architecture → false; malformed → false)
- [x] `src/props.ts`: `ModelEntry.architecture?` + `entrySupportsVision(entry)`
- [x] `pnpm test` green (unit) + `pnpm typecheck`

**Criterion:** `entrySupportsVision` is unit-tested and green.
**Commit:** `feat(props): parse architecture.input_modalities (entrySupportsVision)`

## Stage 2 — settings-io: `input` field + `planInputOverwrite`
- [x] `tests/unit/server/settings-io.test.ts`: red tests for `planInputOverwrite` (create absent; replace existing; no-op on identical set incl. order; siblings preserved)
- [x] `src/settings-io.ts`: `LlmModelEntry.input?` + `planInputOverwrite`
- [x] `pnpm test` green + `pnpm typecheck`

**Criterion:** `planInputOverwrite` is unit-tested and green.
**Commit:** `feat(settings-io): plan model input overwrite (planInputOverwrite)`

## Stage 3 — model-save: `input` part in `ModelSaveParts`
- [x] `tests/unit/server/model-save.test.ts`: red tests (`input` part alone / combined with ctx / no-op when identical)
- [x] `src/model-save.ts`: `ModelSaveParts.input?`; `planModelSave` composes `planInputOverwrite`
- [x] `pnpm test` green + `pnpm typecheck`

**Criterion:** a Save with an `input` part plans one merged entry and is green.
**Commit:** `feat(model-save): commit model input in one save (ModelSaveParts.input)`

## Stage 4 — autofill: vision fill from the listing
- [x] `tests/unit/server/autofill.test.ts`: red tests (fills `input` from listing for models without explicit input; leaves explicit input alone; no `input_modalities` → no input write; guard: fully settled route re-fetched once per commit only while unsettled; combined ctx+input in one write)
- [x] `src/autofill.ts`: per-model parts (ctx + vision) via `persistModelSave`; guard = every model has ctx AND explicit input
- [x] `pnpm test` green + `pnpm typecheck`

**Criterion:** autofill writes `input: ["text","image"]` from `architecture.input_modalities` and is idempotent.
**Commit:** `feat(autofill): fill model input from architecture.input_modalities`

## Stage 5 — RPC: `saveModel` input part + `listReasoningRows` exposure
- [x] `tests/unit/server/rpc.test.ts`: red tests (rows expose `input`; saveModel with valid `input`; rejects empty / unknown-modality / non-array `input`)
- [x] `src/index.ts`: `listReasoningRows` adds `input` to rows; `saveModel` validates + forwards the `input` part
- [x] `pnpm test` green + `pnpm typecheck`

**Criterion:** the RPC contract carries `input` (validations tested).
**Commit:** `feat(rpc): saveModel input part + listReasoningRows input exposure`

## Stage 6 — client: controller + checkbox
- [x] `tests/unit/client/vision-input.test.ts`: red tests for the new pure module (`hasVisionInput`, `inputForVision`)
- [x] `src/client/vision-input.ts`: constants + pure draft helpers
- [x] `tests/unit/client/reasoning-controller.test.ts`: red test — `save` sends / omits the `input` part
- [x] `src/client/reasoning-controller.ts`: `ReasoningRow.input?`; `save(..., input?)`
- [x] `src/client/ReasoningSection.tsx`: vision checkbox (dirty-ref sync, canSave, save part); `.visionRow` CSS
- [x] `pnpm test` green + `pnpm typecheck`

**Criterion:** the section renders the checkbox and saves `input` through the existing face.
**Commit:** `feat(client): vision checkbox in the Model settings section`

## Stage 7 — e2e: input roundtrip over live dsh web
- [x] `tests/e2e/server/model-settings.test.ts`: saveModel with `input` roundtrips; `listReasoningRows` exposes it
- [x] `pnpm test:e2e` green

**Criterion:** the live host writes/validates `input` through the real dsh settings schema.
**Commit:** `test(e2e): vision input roundtrip over live dsh web`

## Stage 8 — docs
- [x] `packages/dsh-model-settings/README.md`: vision checkbox + autofill features
- [x] `docs/ai/key-moments.md`: §2 (`architecture.input_modalities`) + §9 (`input` semantics)
- [x] `pnpm build` green

**Criterion:** docs describe the shipped behavior; the build succeeds.
**Commit:** `docs: vision input (README + key-moments)`
