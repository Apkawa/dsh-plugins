# Plan — reasoning-section-ui

Spec: [spec.md](./spec.md) · Research: [research.md](./research.md)

Every stage ends with a Conventional Commits checkpoint (`feat|build(model-settings): …`), no push.
TDD stages write the failing test first (red → green). Stage order is a hard dependency chain:
CSS infra before restyling, host write paths before the endpoints that use them, controller face
before the component that calls it.

## Stage 0 — Port the CSS-module build pipeline (prerequisite)

- Copy the `dsh-css-inline` plugin out of `examples/tmp/dsh-stickers/tsdown.config.ts` into
  `packages/dsh-model-settings/tsdown.config.ts` (keep the existing single client entry, CJS,
  externals; node half stays on `tsc`).
- Add devDependency `lightningcss@^1.32.0`; add `src/css-modules.d.ts` (pattern from
  `examples/tmp/ui-status-label/`).
- Verify: `pnpm build` + `pnpm typecheck` pass; built `lib/client.js` contains the injected
  `<style data-plugin>` machinery with `[hash]_[local]` class names.
- Commit: `build(model-settings): port CSS-module pipeline from stickers reference`

## Stage 1 — Host: context-window force-write pair (TDD)

- Red: `tests/settings-io.test.ts` — `planContextWindowOverwrite` (creates missing entry, replaces
  existing value, `changed:false` on equal) and `persistContextWindow` (revision-fenced write,
  single retry on SETTINGS_CONFLICT), mirroring the existing `persistModels` tests.
- Green: implement both in `src/settings-io.ts`. Autofill's `planContextWindowWrite` untouched.
- Commit: `feat(model-settings): add context-window overwrite write path`

## Stage 2 — Host: combined saveModel commit (TDD)

- Red: new `tests/model-save.test.ts` — `planModelSave` combinations (ctx only / efforts only /
  both / no-op when identical) and `persistModelSave` fencing.
- Green: new `src/model-save.ts` composing `planContextWindowOverwrite` + `planReasoningWrite`
  (separate module to avoid the settings-io ↔ efforts import cycle).
- Commit: `feat(model-settings): add combined model save commit`

## Stage 3 — Host: RPC endpoints (TDD)

- Red: `tests/rpc.test.ts` — replace the three `setReasoningEfforts` tests with `saveModel`
  (both parts; ctx omitted → efforts-only commit; invalid efforts → `INVALID_EFFORTS`, nothing
  written; non-positive/zero ctx rejected); add `refreshContextWindow` (success writes rounded
  value; model absent from listing; no ctx-size/fit-ctx; route without baseURL — each fails loud);
  update the `listReasoningRows` exact-shape assertion to include `contextWindow`.
- Green: in `src/index.ts` — `saveModel` replaces the `setReasoningEfforts` case (payload
  validation at the wire boundary, one `persistModelSave` commit); add
  `refreshContextWindow` (route resolve → `fetchModels(productionFetcher, …)` → entry by id →
  `contextWindowFromEntry` → `roundDown` → `persistContextWindow`); extend
  `listReasoningRows(store)` rows with `contextWindow?`.
- Commit: `feat(model-settings): add saveModel and refreshContextWindow endpoints`

## Stage 4 — Client: controller face (TDD)

- Red: `tests/reasoning-controller.test.ts` — `save(routeId, modelId, efforts, contextWindow?)`
  posts to `saveModel` (ctx part omitted when undefined) then re-lists; failure still throws with
  the RPC message; new `refreshContextWindow` action (success → re-list, failure → throw).
- Green: in `src/client/reasoning-controller.ts` — extend `ReasoningRow` with
  `contextWindow?: number`; face `save` gains the optional ctx arg and posts to `saveModel`; add
  `refreshContextWindow`. Update the module doc comment (endpoint names).
- Commit: `feat(model-settings): extend section face for saveModel and refresh`

## Stage 5 — UI restyle + context-window editing (no component tests)

- New `src/client/reasoning-section.module.css` per ui-guideline §3/§4/§5: section wrapper
  (flex-column, gap 12, max-width 720), rowCard (border-l2 r12 pad 12–14) + rowHead, model row,
  level rows, capsule buttons (Save md h36 r18 primary; refresh sm h28 r14), input h32 r8
  border-l2 bg-layer-1 with brand-primary focus, error notice (`state-error-primary`), loading/empty
  `label-tertiary`. Tokens only, no literal colors, local `cx()` helper (no clsx).
- Rework `src/client/ReasoningSection.tsx`:
  - route cards from `groupByRoute`; per model: name + ctx input (h32) + [refresh] sm capsule +
    [Save] md capsule on one row;
  - `<details>` (no `open`) titled "Reasoning" wrapping the seven level rows — Save stays on the
    model row so it is reachable with the accordion closed;
  - ctx input: local draft, empty = unchanged, focus-aware sync from `row.contextWindow` after
    re-lists; refresh button per-model busy state (disabled while in flight);
  - single Save validates efforts (`validateEffortsClient`) **and** ctx (positive integer when
    non-empty) before calling `save(routeId, modelId, efforts, ctx?)`; validation/RPC errors inline
    with `role="alert"`.
- Verify: `pnpm build` + `pnpm typecheck`; live in `dsh web` — both light and dark themes,
  keyboard focus visible on input/buttons/summary, accordion collapses by default, refresh flow
  end-to-end against a real llama.cpp route, reduced-motion not broken.
- Commit: `feat(model-settings): restyle reasoning section with context-window editing`

## Final verification (no separate commit)

- Full package: `pnpm build`, `pnpm typecheck`, `pnpm test` — all green.
- Live pass in `dsh web`: load the Model settings page, expand/collapse accordion, edit ctx +
  levels, Save; refresh a model; check both themes and keyboard navigation.
- Update `docs/ai/key-moments.md` if the endpoint rename changes anything recorded there (it
  references v1 card endpoints; confirm no stale `setReasoningEfforts` mention remains).
