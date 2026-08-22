# Research: model-ui-refresh

Problem: changing models in dsh's standard settings UI (persisted to the settings
file) is picked up by dsh instantly, but our plugin's "Model settings" section UI
does not refresh.

## Findings

### 1. Bug mechanism (our client half)

- `src/client/index.ts` (`apply`): creates `ReasoningSectionController` with a
  fresh snapshot store and calls `void reasoningController.loadRows()` **once, at
  apply time**. There is no subscription to any change event.
- `src/client/reasoning-controller.ts`: `loadRows()` sets `phase: 'loading'`, calls
  the Host RPC `listReasoningRows`, sets `phase: 'ready'` + rows. `save()` and
  `refreshContextWindow()` re-list **only after their own actions**.
- Conclusion: any external model change (standard UI edit, settings-file edit,
  host autofill) never reaches the section — the store is not re-listed.

### 2. Why the standard Models UI is instant (the pattern to copy)

- `dsh/packages/client/ui-settings-models/src/client/index.ts` wraps a pushed
  invalidation in `ctx.effect(...)`:
  `ctx.remote.$on('settings/document-updated', (ns) => refreshModels())`,
  plus `credentials/updated`, `llm/adapters-updated`, `connection/reset`.
  Refetch only after the page's first load (`refreshIfLoaded`).
- The Models page writes via `api.settings.mutate({ ns, ops, expectedRevision })`
  (`ProviderEditor.tsx`, `ModelsSection.tsx`); for llm-pi-ai rows `ns` is exactly
  `'llm-pi-ai'` (the editor has a dedicated `'llm-pi-ai'` layout branch).

### 3. Host event source — fires for BOTH UI commits and file edits

- `dsh/packages/settings/settings/src/index.ts`: `bumpRevision` emits
  `settings/document-updated(ns, revision)` whenever a namespace's **raw**
  section changed (`deepEqualJson`), deliberately independent of resolved-value
  equality. Two call paths:
  - the API mutation path (`mutate` → `bumpRevision` + `commit`, ~line 642) —
    standard UI edits;
  - the provider `publish()` path (~line 681, "commit a complete raw document
    observed in storage") — the reload path.
- `dsh/packages/settings/settings-file/src/index.ts`: chokidar file watcher,
  `watch: true` by default; watcher reload commits through `publish` — so an
  external settings-**file** edit also emits the event. This matches the user's
  "из файла" scenario.
- Event signature (`dsh/packages/settings/settings/src/types.ts`):
  `'settings/document-updated'(ns: SettingsNamespace, revision: number): void`.
- `settingsNamespace()` is a brand cast only — at runtime `ns === 'llm-pi-ai'`.

### 4. Client-side event channel

- `dsh/packages/api/remotes/src/remote-events.ts`:
  `API_REMOTE_FORWARDED_EVENTS` includes `'settings/document-updated'` —
  forwarded to the client verbatim; the allowlist is the one legal key set of
  `ctx.remote.$on`.
- The `remote` client service is provided by `@deepseek-ai/dsh-api-gateway`
  client: `ClientRemoteService` (key `'remote'`), `$on(event, listener)` — the
  listener receives the Host argument list `(ns, revision)`; returns a disposer.
- `dsh/packages/bundle/web-app/cordis.patch.yml` contains `api-gateway`,
  `api-remotes`, `client-runtime`, `client-connection` rows — the `remote`
  service is available in the same client scope our plugin's section runs in.
- `ClientContext = Context` (`dsh/packages/client/runtime/src/client/index.ts`),
  so `ctx.get('remote')` is the right access; `ctx.remote` typing would require
  a type-only import of `@deepseek-ai/dsh-api-remotes/client` (module merge),
  which would add a new peer dep. The plugin already uses the lighter pattern:
  `ctx.get('connection') as ConnectionHandle` with a structural mirror.

### 5. What our section depends on

- Host `listReasoningRows` (`src/index.ts`) reads ONLY the `llm-pi-ai`
  settings section (`store.read()`). No adapter/credential input. So the only
  forwarded event that can change our rows is
  `settings/document-updated` with `ns === 'llm-pi-ai'`. No need for
  `credentials/updated` or `llm/adapters-updated`.

### 6. UI consequences of a naive refresh

- `ReasoningSection.tsx`: `phase === 'loading'` renders "Loading models…" —
  calling the existing `loadRows()` on every external event would unmount the
  whole list (flicker) and destroy `ModelRow` local draft state (`useState`
  initialized once from `row.efforts` / `row.contextWindow`).
- Therefore external invalidation needs a **silent** re-list variant: no phase
  flip, keep last rows until the response arrives (or on failure), and a
  sequence guard so an out-of-order response cannot apply stale rows over newer
  ones (the event-driven path makes concurrent re-lists possible; user actions
  alone are rare).

### 7. Draft-clobber hazard (data loss, not just staleness)

- `ModelRow` drafts (`useState`, keyed by `modelId`) persist across a silent
  re-list. After an external `reasoningEfforts` change, untouched drafts differ
  from the new stored value → `draftsDirty(drafts, row.efforts)` becomes true →
  a subsequent Save on that row would push the STALE mapping and clobber the
  external change.
- Fix without new state: a `useEffect` on `row.efforts` that re-adopts
  `draftsFromEfforts(row.efforts)` only when `draftsDirty(drafts, row.efforts)`
  is false (user has not edited → drafts are exactly the previous stored value).
  Both primitives already exist and are tested in `efforts-editor.ts`.
  Mirrors the existing focus-aware ctx-field sync in the same component.

### 8. Tests

- `tests/reasoning-controller.test.ts` has `FakeConnection` / `FakeStore`
  doubles — silent refresh + sequence guard are unit-testable there.
- `src/client/index.ts` `apply` wiring is not unit-tested (no cordis ctx in
  node, no jsdom); keep the wiring a few lines in `apply` following the
  ui-settings-models `ctx.effect` pattern; the testable seam is the
  controller method.
- `efforts-editor.test.ts` covers `draftsDirty` / `draftsFromEfforts` — the
  re-adopt effect needs no new pure logic.
