# research — vision input for model settings

Task: `vision-input`. Draft: [draft.md](./draft.md).

## Requirement recap (from draft)

1. A checkbox in the plugin's Model settings UI (the reasoning section, browser half) for "model supports vision". Checked adds `input: [text, image]` to the model's settings (text always present), analogous to how `efforts` is handled.
2. Autofill on model add: read llama.cpp `GET /v1/models` → `data[i].architecture.input_modalities` and pre-fill the vision state (e.g. `["text","image"]` → vision model).

## dsh `input` field (from `examples/tmp/dsh-docs/user/guide/providers.md`, "Image input" section)

- Per-model: `llm-pi-ai: providers: <route>: models: [{ id, input: [text, image] }]` — `input` accepts only `text` and `image`; unknown modalities are refused.
- Omitting `input` (or an empty list) = same thing → falls back to the installed catalog's description, else the route's `defaultInput` (defaults to `[text]`).
- Route-level `defaultInput` is a fallback, not an override.
- "Every list must name at least one modality except a model's own, where an empty list means the same as omitting it."
- Troubleshooting: to narrow a vision model to text-only, "Remove image from whichever list granted it — the model's `input`" → writing `input: [text]` is the explicit text-only spelling.
- So: a model's explicit `input` is always written per-model; dsh schema is the llm-pi-ai owner (we never validate the modality names ourselves beyond what dsh accepts).

## Plugin architecture (from `packages/dsh-model-settings/src`)

- **`settings-io.ts`** — `LlmModelEntry` (only `id`, `contextWindow?` modeled; `[key: string]: unknown` carries the rest — `input` passes through unchanged today); `SettingsStore` seam (`read` / `setRouteModels`, revision-fenced, `SETTINGS_CONFLICT` retry-once); `isCandidateRoute` (api ∈ {openai-completions, llama.cpp} + non-empty baseURL); `planContextWindowWrite` (autofill: respects user override) and `planContextWindowOverwrite` (UI: explicit replace).
- **`efforts.ts`** — `planReasoningWrite` (per-model mapping; explicit edit always wins) — the template for "one model field edited from the section".
- **`model-save.ts`** — `ModelSaveParts { efforts?, contextWindow?: number|null }`; `planModelSave` composes planners sequentially over a copied list (one Save = one revision write); `persistModelSave` (store read → plan → `setRouteModels`; conflict retry once; `changed:false` → no write). This is where a new `input` part slots in.
- **`probe.ts`** — `fetchModels(fetcher, baseURL, {apiKey})` → `ModelEntry[]`; endpoint join handles both `.../v1` and bare bases; 15s timeout; 4MB ceiling; any failure throws.
- **`props.ts`** — `ModelEntry` currently models only `id?` and `status.preset` (INI parse: `ctx-size` else `fit-ctx`). `architecture.input_modalities` is not read anywhere yet — it must be added to the `ModelEntry` shape and parsed here.
- **`autofill.ts`** — runs on the `llm-pi-ai` `settings/updated` event (watcher in `index.ts`, `running` flag dedupes). Per candidate route: skip if `models.every(hasNonzeroContextWindow)` (self-cycle guard); fetch listing once; per model without a nonzero ctx, write rounded ctx via `persistModels`. Every failure skips the model quietly (retry next round).
  - Consequence: the same "model not yet settled → route re-probed on every commit" property would apply to a model whose endpoint never reports `input_modalities`. That property already exists for ctx (no `ctx-size` in listing), so it is an accepted trade-off, not new risk.
- **`index.ts`** — composition root; RPC channel `/model-settings`: `listModels` (v1 card, disabled), `fetchModels`, `applyContextWindows` (v1 card), `listReasoningRows`, `saveModel`, `refreshContextWindow`. `saveModel` validates parts (`validateEfforts`; ctx positive integer) then `persistModelSave`. Errors: `rpcFailure` carrier-conformant codes (`bad-request` / `internal`).
- **Client half** (`src/client`):
  - `index.ts` — registers the `settings.section` slot "Model settings"; re-lists on forwarded `settings/document-updated` (ns `llm-pi-ai`); `CLIENT_ENABLED = false` keeps the v1 card + EffortButton off.
  - `reasoning-controller.ts` — `ReasoningRow { routeId, modelId, contextWindow?, efforts? }`; `save(routeId, modelId, efforts?, contextWindow?: number|null)` builds the `saveModel` payload (absent part = untouched; `null` ctx = clear) then re-lists.
  - `ReasoningSection.tsx` — per-model `ModelRow`: ctx text field (focus-aware draft sync), reasoning accordion (dirty-ref draft sync: `levelsDirty` ref, external re-list adopts stored value only while clean), one Save enabled when any part is dirty/changed.
  - `efforts-editor.ts` — pure draft logic (unit-tested, node env, no jsdom).
  - Tests: `tests/unit/client/*.test.ts` (node env, FakeStore/FakeConnection); `tests/unit/server/*.test.ts`; e2e `tests/e2e/server/model-settings.test.ts` + `dsh-fixture.ts` drives a live `dsh web` via `scripts/e2e-live.mjs` (no browser, no internet).

## Design decisions (drafted, to confirm in spec)

- **Checkbox state** derives from the stored per-model `input`: checked ⇔ `input` is an array containing `"image"`; `input` absent → unchecked.
- **Check** → save part `input: ["text","image"]`; **uncheck** → save part `input: ["text"]` (explicit text-only; always wins, like `contextWindow` overwrite; never drops the key).
- **Autofill rule** (analogous to ctx autofill, respects override): only fill when the model has no non-empty `input`; fill only when the listing entry's `architecture.input_modalities` includes `"image"`; write `["text","image"]` (text always). Endpoint with no `input_modalities` → nothing written, model stays on the dsh fallback, route may re-probe each commit (same property as ctx today).
- **Planner** lives in `settings-io.ts` as `planInputOverwrite` (explicit replace; absent model → created entry; identical list → `changed:false`).
- **`ModelSaveParts`** gains `input?: string[]`; `planModelSave` composes it alongside ctx/efforts → one Save still = one revision write.
- **RPC `saveModel`** gains `input?: string[]` validation (non-empty array; every element ∈ {text,image}).
- **`listReasoningRows`** exposes `input?: string[]` on the row so the checkbox renders the stored state.
- **Client**: `ReasoningRow` gains `input?: string[]`; `ModelRow` gets the checkbox with the same dirty-ref sync pattern as the reasoning editor; `save` gains an `input?` param (payload: absent = untouched).

## dsh-side confirmation (read-only, `dsh/packages/llm/llm-pi-ai/src`)

- `config.ts:209–222` — a `models` entry field: `input: z.array(z.union(MODALITIES))`; no default ("No explicit default … schemastery materializes `[]` … so the catalog entry below still applies"). Absent and empty list mean the same thing (fallback).
- `catalog.ts:42–48` — `MODALITY_GATE` proves `PiAiModality = 'text' | 'image'` (drift gate).
- `catalog.ts:533` — resolution: `input: declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput]` → per-model `input` wins over catalog and route `defaultInput`; `declaredInput` (catalog.ts:59) returns `undefined` for absent/empty lists.
- Confirmed: writing `input: ['text']` / `['text','image']` on a custom route's model passes the schema; clearing is NOT part of this feature (the UI always writes one of the two explicit lists).

## E2E fixture constraints (`tests/e2e/dsh-fixture.ts`)

- The e2e route (`ROUTE_ID='e2e'`) points `baseURL` at a closed local port (`http://127.0.0.1:9/v1`), so any host probe is refused locally and skipped quietly — the live instance has no llama.cpp. Therefore e2e can cover the **saveModel `input` roundtrip** (schema-validated write + row exposure) but NOT autofill-from-listing; autofill is unit-covered with the FakeListingFetcher.

## Final design (resolved)

- **`props.ts`**: `ModelEntry` gains `architecture?: { input_modalities?: unknown }`; `entrySupportsVision(entry)` = `input_modalities` is an array of strings containing `"image"` (malformed → false).
- **`settings-io.ts`**: `LlmModelEntry` gains `input?: string[]`; `planInputOverwrite(models, modelId, input)` = explicit replace (absent → creates `{ id, input }`; identical set (order-insensitive) → `changed:false`); `isInputList`-style guards stay local.
- **`model-save.ts`**: `ModelSaveParts.input?: string[]`; `planModelSave` composes it (one Save = one revision write).
- **`autofill.ts`**: per model, build parts: ctx part when unsized AND the listing has a size; `input` part when no explicit non-empty `input` AND the listing entry declares image → write `['text','image']`; one `persistModelSave` per model (was `persistModels`). Guard becomes `models.every(ctx && hasExplicitInput)` — an endpoint that never reports modalities leaves its route re-probed on every commit (same property as a missing `ctx-size` today; accepted).
- **`index.ts` RPC**: `listReasoningRows` rows gain `input?: string[]` (string arrays only); `saveModel` accepts `input?: string[]` (validated: non-empty, subset of {text,image}); the "nothing to save" check includes it.
- **Client**: `ReasoningRow.input?: string[]`; `ReasoningSectionController.save` gains a 5th `input?` param (absent = untouched); a pure `src/client/vision-input.ts` (constants + `hasVisionInput` + `inputForVision`) tested in node; `ModelRow` gets the checkbox with the same dirty-ref sync as the reasoning editor (`visionDirty` ref; adopt stored state on re-list only while clean); `canSave` includes the vision part; a successful save releases the checkbox ownership when its part was committed.
- **Uncheck writes `input: ['text']`** (explicit text-only; deterministic even when the route has `defaultInput: [text, image]`; autofill treats a non-empty `input` as a user override and never clobbers it — unlike "clear the key", which would let autofill re-fill it from a later listing).
- **Out of scope**: route-level `defaultInput` editing; `refreshContextWindow` stays ctx-only (vision arrives via autofill on add, per the draft); the disabled v1 card; catalog providers (not candidate routes).
