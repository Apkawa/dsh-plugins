# Research — reasoning-section-ui

Scope from the draft: (1) tidy up `ReasoningSection.tsx` UI, (2) add per-model context-window
editing with a [refresh] button that overwrites the value from llama.cpp, input placed above the
reasoning editor, (3) collapse the reasoning settings into an accordion, collapsed by default.

## 1. Current state of the section

- `src/client/ReasoningSection.tsx` is **raw unstyled HTML**: nested `<ul>/<li>`, `<strong>` route
  headers, 7 checkbox+text-input rows per model, a plain Save button. No CSS module, no design
  tokens, no focus styling, no box-sizing control.
- It is registered as a top-level `settings.section` entry (`id: 'model-settings'`, order 15,
  label "Model settings") in `src/client/index.ts`, with its own snapshot store created in `apply`
  and injected into `ReasoningSectionController`. The component is dumb: it renders the store via
  `props.useReasoningSection(...)` and calls face actions (`loadRows`, `save`).
- Host half (`src/index.ts`) serves the `/model-settings` RPC channel with endpoints:
  `listModels`, `fetchModels`, `applyContextWindows` (v1 card, currently disabled client-side via
  `CLIENT_ENABLED = false`), `listReasoningRows`, `setReasoningEfforts` (v2 section).
- `listReasoningRows` returns `{ routeId, modelId, efforts? }` only — **no contextWindow**, even
  though the host already reads the same models list for `listModels`.
- Client mirror: `ReasoningRow { routeId, modelId, efforts? }` in `reasoning-controller.ts`; the
  channel name is spelled on both halves (client bundle purity — no cross-import).

## 2. Context-window data path (existing, reusable)

- Source of truth for sizes: llama.cpp `GET <baseURL>/v1/models` → per-entry `status.preset` INI →
  `ctx-size` else `fit-ctx` (`src/props.ts`: `parsePreset`, `contextWindowFromEntry`).
- Fetch seam: `src/probe.ts` `fetchModels(fetcher, baseURL, options?)` — bounded read, timeout,
  throws on every failure (loud by design). `modelsUrl` handles both base spellings (with/without
  trailing `/v1`) — the recorded double-`/v1` pitfall.
- Rounding: `src/round.ts` `roundDown` — floor to nearest thousand (values ≤1000 unchanged);
  autofill writes rounded values, so a refresh should write the same value autofill would.
- Write seam: `src/settings-io.ts`. **Important constraint:** `planContextWindowWrite` deliberately
  *respects* an existing positive `contextWindow` (user override stands; autofill never clobbers).
  The draft explicitly wants [refresh] to **overwrite** ("перезапишет значение"), so a force-write
  path is needed — a new plan/persist pair in `settings-io.ts` with the same revision-fencing +
  single-conflict-retry as `persistModels`. This does not touch autofill semantics (the watcher
  keeps respecting overrides; an explicit refresh is a deliberate user act, and once sized the
  model is skipped by autofill anyway — no loop).
- The v1 card's two-step `fetchModels` → preview → `applyContextWindows` flow exists but is the
  manual path for *unsized* models; the draft wants a one-click overwrite per model, so a new
  single endpoint is the KISS fit (host-side logic still reuses probe + props + settings-io).

## 3. Styling / design system

- Authoritative rules: `dsh/docs/web-styling.md` — CSS Modules + local `cx()` helper, tokens only
  (`--dsw-alias-*`), no literal colors, no component libraries/Tailwind, `box-sizing: border-box`
  on every control, visible focus, reduced-motion handling.
- `docs/ai/ui-guideline.md` already contains a step-by-step restyle plan for exactly this section
  (§7) and the design-language numbers (§3: 14/22 body, capsules h36 r18 / sm h28 r14, inputs
  h32 r8 border-l2 bg-layer-1, cards border-l2 r12, max-width 720) plus verified token names (§4).
- **CSS infrastructure is missing from our package** (ui-guideline §7.1): the current
  `packages/dsh-model-settings/tsdown.config.ts` has no CSS plugin. The working reference is
  `examples/tmp/dsh-stickers/tsdown.config.ts` (`dsh-css-inline` plugin: lightningcss transform,
  `[hash]_[local]` module pattern, auto-injected `<style data-plugin>` tags). Porting it requires:
  the plugin code (vendored), a `lightningcss` devDependency (`^1.32.0` per stickers), and
  `src/css-modules.d.ts` (sample in `examples/tmp/ui-status-label/`).
- Our node half is built by `tsc -p tsconfig.json`; tsdown builds only `lib/client.js` — the CSS
  plugin goes into the existing single-entry config, not a restructure.
- Pattern sources to copy from (ui-guideline §5): `ModelsSection.module.css` (section wrapper,
  row cards), `StatusLabelRow.module.css` (title+desc+control row), `Button.module.css` /
  `Input.module.css` (primitives).

## 4. Accordion mechanics

- dsh has no shared accordion component; the native Models UI uses a plain `<details>` for its
  "customized" disclosure (`ui-settings-models/src/client/ProviderEditor.tsx:379`). The
  `DisclosureRow` primitive is controlled, icon-driven and aimed at compact flow rows — overkill.
- **Decision:** native `<details>` without `open` = collapsed by default, zero state, keyboard
  accessible for free. One per model, wrapping the seven-level editor + Save.

## 5. Layout implied by the draft

Per route card:

```
[route name]                              ← rowHead
[model name]  [ctx input h32][refresh]    ← context window row (above reasoning)
  <details collapsed>                     ← accordion, default closed
    7 × (checkbox + level label + wire input)
    [Save capsule]  error notice
  </details>
```

- "инпут поместить выше ризонинга" → the ctx input row sits above the `<details>` per model.
- Manual edit of the input: commit on Enter/blur via a new `setContextWindow` endpoint (explicit
  overwrite, validated positive integer); refresh = fetch + overwrite in one host call. Both reuse
  the same force-write path with different value sources.

## 6. State-sync subtlety (client)

- `ModelEditor` initializes drafts once from props (`useState` initializer). After a refresh the
  controller re-lists rows, so the ctx input must pick up the new row value: sync the local draft
  from `row.contextWindow` when it changes externally and the input is not focused. Reasoning
  drafts keep today's behavior (preserved across re-lists).

## 7. Testing posture

- Host side (TDD, unit-tested on doubles): new plan/persist overwrite pair in `settings-io.ts`,
  new RPC endpoints (`refreshContextWindow`, `setContextWindow`) in `makeRpcHandler` — existing
  patterns in `tests/settings-io.test.ts` and `tests/rpc.test.ts`. `listReasoningRows` gains
  `contextWindow?` → its exact-shape assertions in `rpc.test.ts` update with the behavior.
- Client side: `reasoning-controller.ts` gains two face actions — extend
  `tests/reasoning-controller.test.ts` (fake connection, same pattern as `save`).
- No jsdom/component-test infrastructure exists in this package (vitest env is node; no
  testing-library dependency). UI changes are verified per ui-guideline §7.3: build + typecheck +
  live check in `dsh web` in both themes, keyboard focus visible, reduced-motion not broken.

## 8. Risks / open questions

1. **Refresh granularity** — per-model button (each click fetches the whole route listing).
   Listings are small; acceptable. A per-route refresh was considered and rejected: the draft says
   the button sits "рядом" with the input, i.e. per model.
2. **Model absent from the live listing or without ctx-size/fit-ctx** — endpoint must fail loud
   (descriptive error → inline `role="alert"`), never silently skip (AGENTS.md pitfall 5).
3. **Refresh overwrites user overrides by design** — that is the point of the button; autofill
   stays non-clobbering. No loop risk (sized models are skipped by autofill).
4. **CSS infra is a hard prerequisite** for any visual tidy-up — it must land first and be
   verified (build + `<style data-plugin>` in DOM + hashed classes) before restyling work.
5. **No new runtime dependencies**: lightningcss is dev-only; class joining uses the local `cx()`
   helper per ui-guideline §2.4.
