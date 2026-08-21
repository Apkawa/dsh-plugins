# Spec — Reasoning section UI: tidy-up, context-window editing, accordion

Task dir: `docs/specs/reasoning-section-ui/` · Inputs: [draft.md](./draft.md), [research.md](./research.md)

## Goal

Rework the "Model settings" top-level settings page (`ReasoningSection`) so that it:

1. **Looks like a dsh settings section** — styled with CSS Modules and `--dsw-*` design tokens per
   `docs/ai/ui-guideline.md`, instead of raw unstyled HTML.
2. **Edits each model's context window** — a numeric input above the reasoning editor, plus a
   **[refresh] button next to it that overwrites the value from llama.cpp** (fetched live from the
   route's `/v1/models` listing).
3. **Collapses the reasoning settings into an accordion, closed by default** — per model, wrapping
   the seven-level editor.

Out of scope: re-enabling the v1 card (`CLIENT_ENABLED` stays `false`); changing autofill
semantics (it keeps respecting user overrides); new runtime dependencies.

## Behavior

### 3.1 Context window row (per model)

- Each model row shows its current `contextWindow` in a numeric input (h32, r8, border-l2,
  bg-layer-1; focus → brand-primary). Absent value renders empty.
- **Manual edit** is held as a local draft and committed by the model's single **Save** button
  (see 3.2), which persists the context window together with the reasoning mapping in one commit.
  Input semantics: **empty = leave contextWindow unchanged**; a positive integer **overwrites**
  whatever is stored (explicit user act). A non-empty value that is not a positive integer is
  rejected client-side with an inline error and blocks the whole Save (all-or-nothing, like
  efforts validation today).
- **[refresh] button** (small capsule, next to the input) calls a new RPC endpoint
  `refreshContextWindow(routeId, modelId)`. Host behavior: resolve the route → fetch its
  `/v1/models` listing (existing `probe.fetchModels`) → find the entry by id →
  `contextWindowFromEntry` → `roundDown` → **force-write** it. Failure modes are loud and surface
  inline (`role="alert"`): route has no baseURL, model absent from the listing, or no
  ctx-size/fit-ctx in the preset — never a silent skip.
- After a refresh (or a Save) succeeds, the controller re-lists rows; the input syncs to the new
  row value while unfocused (a focused input keeps the user's draft).

### 3.2 Single per-model Save + reasoning accordion

- One **Save** capsule per model, on the model row (visible without opening the accordion),
  commits **both** the context-window draft and the seven-level mapping together:
  - efforts validation is unchanged (`validateEffortsClient` client-side, `validateEfforts`
    host-side);
  - ctx validation as in 3.1;
  - any validation error → inline notice, nothing is written.
- The seven-level editor (checkbox + level label + wire-value input per level) moves inside a
  native `<details>` element, **without `open`** → collapsed by default, zero extra state,
  keyboard accessible for free. It contains the level rows only — Save lives on the model row.
- Existing draft behavior is unchanged (`draftsFromEfforts`, preserved across re-lists).

### 3.3 Section layout (per route card)

```
[route name]                              ← rowHead inside a rowCard (border-l2, r12)
[model name]  [ctx input h32][refresh][Save]   ← model row: ctx above the accordion
  <details> (collapsed by default)        ← "Reasoning" summary
    7 × (checkbox + level label + wire input)
  </details>
  error notice (validation / RPC), if any
```

- Section wrapper: flex-column, gap 12, max-width 720 (the settings panel supplies its own
  padding/scroll — no page padding of our own).
- Loading / empty states stay textual, tone `label-tertiary`; errors keep `role="alert"` in
  `state-error-primary`.
- All controls: `box-sizing: border-box`, visible focus, transitions only via `--ds-ease-in-out`
  + duration tokens, disabled under `prefers-reduced-motion: reduce`.

## Data & API changes

### Host (`src/index.ts`, `src/settings-io.ts`, new `src/model-save.ts`)

- `listReasoningRows` rows gain `contextWindow?: number` (read from the same models list as
  `listModels`).
- New in `settings-io.ts`: a force-write pair — `planContextWindowOverwrite(models, modelId, value)`
  (always sets the value; creates the entry if missing; `changed: false` only when already equal)
  and `persistContextWindow(store, routeId, modelId, value)` with the same revision-fencing +
  single-conflict-retry as `persistModels`. Autofill's `planContextWindowWrite` is untouched.
- New module `src/model-save.ts`: composes the two existing pure planners into one commit —
  `planModelSave(models, modelId, { efforts?, contextWindow? })` (ctx overwrite applied when
  `contextWindow` is present; efforts mapping replaced when `efforts` is present; `changed: false`
  when neither differs) and `persistModelSave(store, routeId, modelId, parts)` with the same
  fenced write. A separate module avoids an import cycle (`efforts.ts` already imports types from
  `settings-io.ts`).
- RPC endpoints on `/model-settings`:
  - **`saveModel({ routeId, modelId, efforts?, contextWindow? })`** — replaces the section's
    current `setReasoningEfforts` endpoint (the section is its only consumer; pre-release rename).
    Validates: efforts against `validateEfforts` when present; `contextWindow` as a positive
    integer when present. One `persistModelSave` commit. Invalid input → `ok:false` with the
    validation message, nothing written.
  - **`refreshContextWindow({ routeId, modelId })`** — fetch + force-write as in 3.1; returns
    `{ ok: true, value: { contextWindow } }`.

### Client (`src/client/reasoning-controller.ts`, `ReasoningSection.tsx`)

- `ReasoningRow` gains `contextWindow?: number`; face's `save` becomes
  `save(routeId, modelId, efforts, contextWindow?)` posting to `saveModel`; new face action
  `refreshContextWindow(routeId, modelId)`. Both re-list rows on success and throw with the RPC
  message on failure (same pattern as today's `save`).
- Component: per-model ctx input with local draft + focus-aware sync from the row; refresh button
  with per-model busy state (disabled while in flight); one Save per model validating both drafts;
  `<details>` accordion around the level rows.

## Build infrastructure (prerequisite for all visual work)

Per ui-guideline §7.1 — must land and be verified before restyling:

- Port the `dsh-css-inline` plugin from `examples/tmp/dsh-stickers/tsdown.config.ts` into
  `packages/dsh-model-settings/tsdown.config.ts` (existing single-entry client config; node half
  stays on `tsc`).
- Add devDependency `lightningcss` (`^1.32.0`, matching stickers) and `src/css-modules.d.ts`.
- Verification: `pnpm build` succeeds; built `lib/client.js` contains the injected
  `<style data-plugin="@apkawa/dsh-model-settings" ...>` machinery with hashed class names.

## Styling

New `src/client/reasoning-section.module.css` following ui-guideline §3/§4/§5 (numbers and token
names verified there): section wrapper, rowCard/rowHead, model row, level rows, capsule buttons
(md h36 r18 primary for Save; sm h28 r14 for refresh), input h32 r8, error notice. Local `cx()`
helper instead of clsx. No literal colors, no theme selectors, no new runtime dependencies.

## Testing (TDD: failing test first per stage)

- `settings-io`: overwrite plan/persist — creates missing entry, replaces existing value, no-op on
  equal value, conflict retry once (mirrors existing `persistModels` tests).
- `model-save`: combined plan — ctx only / efforts only / both / no-op when identical; persist with
  fencing.
- `rpc.test.ts`: `saveModel` (both parts, ctx omitted → efforts-only commit, invalid efforts →
  `INVALID_EFFORTS`, non-positive ctx rejected) and `refreshContextWindow` (success, missing model
  in listing, no ctx keys, missing baseURL); updated exact-shape assertion for
  `listReasoningRows` with `contextWindow`.
- `reasoning-controller.test.ts`: `save` posts to `saveModel` with the optional ctx part;
  `refreshContextWindow` success → re-list, failure → throw.
- No component tests: the package has no jsdom/test-library infrastructure. UI is verified live in
  `dsh web` — both themes, keyboard focus visible, reduced-motion not broken (ui-guideline §7.3).

## Decisions & trade-offs

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | One-click per-model refresh (host does fetch+write in one endpoint) | Draft asks for a button "next to" the input; v1's two-step preview/apply flow is heavier than needed. Host logic still reuses probe/props/settings-io. |
| 2 | Force-write pair added beside `persistModels`, not a flag on it | Keeps autofill's override-respecting semantics provably untouched (separate function, separate tests). |
| 3 | Native `<details>` for the accordion | dsh itself uses plain `<details>` (ProviderEditor); DisclosureRow is controlled/icon-driven and overkill. Collapsed-by-default is free. |
| 4 | **One Save per model commits ctx + reasoning together** (user's choice) | Matches the existing "Save writes exactly what it holds" semantics; one validation gate, one commit. Empty input = unchanged, so models without a ctx keep working. |
| 5 | `saveModel` replaces `setReasoningEfforts` as the section endpoint | One endpoint per Save button; the old name would mislead once ctx rides the same commit. Pre-release rename is sanctioned; tests update with the behavior. |
| 6 | Refresh writes `roundDown`-ed value, same as autofill | Consistency: manual refresh and autofill produce identical values for the same preset. |
| 7 | CSS infra port is a standalone first stage | ui-guideline §7.1; every visual step depends on it, and its verification (hashed classes in DOM) is independent of component work. |

## Review resolution

- **Accordion granularity** — confirmed per model (each model row: name + ctx input + refresh +
  Save, then a closed `<details>` with its seven levels).
- **Ctx commit UX** — confirmed: no separate ctx Save; the single per-model Save commits both.
- No open questions remain.
