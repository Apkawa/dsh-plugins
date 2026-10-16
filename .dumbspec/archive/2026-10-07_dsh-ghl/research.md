# 2026-10-07_dsh-ghl: research

Context collection for the new `packages/dsh-ghl` plugin (GitHub issue integration, read-only, no token).
Pinned dsh checkout: `0.2.0-rc.2` (symlink `dsh/`). All paths relative to repo root unless noted.

## 1. Plugin package structure (references: dsh-model-settings, dsh-global-queue)

Both are pnpm-workspace packages under `packages/<name>/` with a host half (`src/*.ts`) and a client half (`src/client/*`), wired by: one `package.json`, two tsconfigs, a tsdown browser-bundle config, two vitest configs, and a cordis patch file.

**`packages/dsh-model-settings/package.json`** — the manifest to mirror:
- `name "@apkawa/dsh-model-settings"`, `type module`, `main lib/index.js`
- `exports`: `.` / `./client` / `./package.json`
- `dsh.bundle.patch: "./cordis.patch.yml"`
- `dsh.client = { inject: [dsh-client-connection, dsh-client-modules, dsh-client-ui-slots], platform: "web" }`
- `files ["lib","cordis.patch.yml"]`
- peerDeps: `cordis ^4.0.1`, three `dsh-client-* ^0.2.0-rc.2`, `dsh-settings`, `schemastery ^3.18.1`, `react`
- devDeps: `@playwright/test`, `lightningcss`, `tsdown`, `typescript ^6.0.3`, `vitest ^4.1.8`
- scripts: `build: tsc -p tsconfig.json && tsdown`, `test: vitest run`, `test:e2e: vitest run --config vitest.e2e.config.ts && pnpm exec playwright test`, `typecheck: tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json`

**`packages/dsh-global-queue/package.json`** — same shape, differing in:
- `dsh.client.inject` adds `dsh-client-ui-sidebar-right` + `dsh-client-ui-workspace`
- `dependencies` (not peer) includes `@deepseek-ai/dsh-home-paths 0.2.0-rc.2`
- peerDeps only `cordis` + `schemastery`
- `test:e2e` has no playwright lane

**`packages/dsh-model-settings/cordis.patch.yml`**:
```yaml
- insert:
    - id: model-settings
      name: '@apkawa/dsh-model-settings'
```

**Build/type configs (both, same structure):**
- `tsconfig.json` (es2024, esnext, bundler resolution, `paths {"@root/tests-helpers/*": ["../../tests-helpers/*"]}`, strict, `outDir lib`, excludes `src/client`+`tests`)
- `tsconfig.client.json` (noEmit, jsx react-jsx, ES2024+DOM; model-settings maps `dsh-client-store`→`../../dsh/packages/client/store`; global-queue maps react types + `dsh-client-ui-primitives`→`.tmp/dsh-versions/0.2.0-rc.2/...`)
- `tsdown.config.ts` (browser bundle, `PLATFORM_MODULES` list, entry `client: './src/client/index.ts'`, banner `window.__ModuleLoader__.load({ id: PLUGIN_ID, ... })`, lightningcss CSS modules → `<style data-plugin>`)
- `vitest.config.ts` (node env, `tests/**/*.test.ts`, excludes e2e)
- `vitest.e2e.config.ts` (alias `@root/tests-helpers`, `testTimeout 120_000`, `hookTimeout 180_000`)

## 2. Composer `@` chips and the submit path (the template for `#` issue chips)

The `@` autocomplete is a **trigger source** feeding a **decorator chip node**; on submit each chip is **serialized to its "model form" and spliced into the outgoing text.**

- **Trigger contract** — `dsh/packages/client/ui-input-trigger/src/types.ts`: `TriggerChar = '/' | '@'` (line 34) — **`#` is NOT a currently-supported trigger; a `#` source would need to extend this union (upstream dsh change).** `InputTriggerSource` has `trigger`, `name`, `candidates(...)`, `onPick(...) → { insert: ReferenceInsert }`, and `codec?: ReferenceCodec` (line 233) with `clipboardText(ref)` and async `serialize(ref, signal)` ("required for sources producing insert outcomes").
- **Registration** — `dsh/packages/client/ui-input-trigger/src/client/service.ts`: `InputTriggerService.registerSource(src)` (duplicate trigger+name throws) and `sessionOf(actx)`.
- **Serialization** — `dsh/packages/client/ui-input-trigger/src/client/controller.ts` (346–351): `serializeReference(source, ref, signal) → owner.codec.serialize(ref, signal)`.
- **Chip node** — `dsh/packages/client/ui-conversation/src/client/input/editor/chip-node.tsx`: `ReferenceChipNode extends DecoratorNode`; `createDOM()` → `<span data-composer-chip={this.__source} contenteditable="false">`; `getTextContent()` → `__clipboardText` (never the model form); `decorate()` → `<ReferenceChip>`.
- **Chip styling** — `ReferenceChip.tsx` + `ReferenceChip.module.css`: icon (or `@` marker) + truncating label; normal color `--dsw-alias-state-business-primary`, `.invalid` → `--dsw-alias-state-error-primary` + line-through + opacity 0.7. **A status-colored border for issues is NEW styling, not a dsh built-in.**
- **Chip click** — `reference-activation.ts`: `registerReferenceActivation(editor, open)`; a valid chip fires `open(node.getSource(), { ref, ...appearance })`.
- **The `@` source** — `dsh/packages/client/ui-reference/src/client/index.ts`: `trigger:'@'`, `name:'reference'`; items from `ctx.remote.fileReferences.list(...)`; insert `clipboardText` via `formatFileMention` (`dsh/packages/context/file-reference/src/grammar.ts`) → `@path` / `@"path"`.

**Submit path (critical)** — `dsh/packages/client/ui-conversation/src/client/input/facade.ts`: `submit()` (297) → `dispatchRun({type:'enter', draft: this.projection.clipboardText})` → effect `default-sink` → `sinkSerialized` (646–694). When `occurrences.length === 0` it sends `draft.trim()` directly; otherwise for each occurrence it `await inputTriggers.serializeReference(o.source, o.ref, signal)` and **splices each model form over the chip's clipboard range** before `defaultSink(out.trim(), attachmentIds, mode, signal)`.

**Conclusion:** the chip content **IS** substituted into the text sent to the LLM — via `codec.serialize`'s model form. For `@` the model form is the `@path` mention and the file *body* travels separately via `attachmentIds` / `defaultSink(text, attachmentIds, ...)`. A `#` issue analog would have its `codec.serialize` emit the issue context text directly.

## 3. Right sidebar tabs

The right sidebar is `dsh/packages/client/ui-sidebar-right/`; a plugin contributes a **tab type** via a registry, registers its **body** under the keyed `sidebar.right.pane.tab` seat, and opens tabs through the service.

- **Tab-type registry** — `tab-registry.ts`: `SidebarRightTabDefinition` (line 94) = `{ id, kind, multiple?, keepMounted?, patterns?, priority?, canOpen?, title: (address) => string, guide? }`; `id` is the key its body/title register under; `kind` is what `openTab(kind)` names; `patterns` are resource-address globs (**omit for a page type opened by kind**); `priority` `extension` (default) | `builtin` | `fallback`. `register(definition) → disposer` (253) throws on duplicate `id` / colliding `kind`.
- **Service / navigation** — `service.ts`: public face acts on the on-screen Session (`mounted`); navigation is `openResource(...)` / `openTab(kind, params)`; `require()` throws `sidebarRight: no session surface is mounted` with no on-screen Session.
- **Params** — `contract/params.ts`: `SidebarRightTabParamsMap` (keyed by kind) and `SidebarRightResourceParamsMap` are merge-extensible; `SidebarRightTabParamsFor<K>` = the declared params for kind `K` (or `undefined`).
- **Reference usage** — `packages/dsh-global-queue/src/client/index.ts`: `TAB_ID='@apkawa/dsh-global-queue'`, `TAB_KIND='global-queue'`; registers the type via `ctx.sidebarRightTabs.register({id, kind, title, guide?})`, the body under `sidebar.right.pane.tab` (keyed by the type's `id`), and opens via `ctx.sidebarRight.openTab(kind)`.

## 4. Host ↔ client API (RPC / webServer route)

Carrier wire shape: `client-request {type, rpcId, method, payload}` → `server-response {type, rpcId, result}`; `RpcResult = {ok:true, value} | {ok:false, error:{code, message, details}}`.

- **Route registry** — `packages/dsh-model-settings/src/index.ts`: `WebRoute {kind:'prefix', path, handler(req,res)}`, `WebServerRegistry.register(route) → disposer`; `declare module '@deepseek-ai/cordis' { interface Context { webServer; hmr? } }`; `makeRpcHandler(store)(endpoint, message.payload)`; errors via `rpcFailure(code, message, details)`.
- **0.2.0-rc.2 host-RPC workaround** — the host `rpc-host` effect registers without `webServer`, so each plugin mounts its own prefix route via a nested inject. `packages/dsh-global-queue/src/index.ts`:
```ts
ctx.inject(['webServer'], webCtx =>
  webCtx.effect(() => mountChannel(store, webCtx.webServer, watcher.nudge), 'global-queue: /global-queue channel'))
```
- **Channel mount** — `packages/dsh-global-queue/src/rpc.ts`: `CHANNEL='/global-queue'`; `mountChannel(store, webServer, onAdd): () => void`; `endpointFromPath`; `clientRequestSchema` (schemastery); endpoints `list/add/reorder/editText/remove`; `dispatch(...)`.

## 5. GitHub public API surface (`docs/ghl/api-github.md`)

Base `https://api.github.com`, JSON; auth `Authorization: Bearer <TOKEN>` (optional for public reads).

- **Issues**: `GET /issues`; `GET /repos/{owner}/{repo}/issues`; `GET .../issues/{issue_number}`; `POST`/`PATCH` create/update; `GET .../events`, `.../timeline`; `POST`/`DELETE` labels. `issue_number` is the **number, not the id**.
- **Comments**: `GET/POST .../comments`; `GET/PATCH/DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}`.
- **Labels**: `GET/POST /repos/{owner}/{repo}/labels`; `GET/PATCH/DELETE .../labels/{name}`.
- **Search**: `GET /search/issues?q=...` with `is:issue`, `is:pr`, `repo:`, `label:`, `state:`.
- **Rate limits**: **60 req/h unauthenticated**, **5000 req/h authenticated**; `X-RateLimit-Remaining` / `X-RateLimit-Reset`; `403`/`429` + `Retry-After` when exhausted. Public repo issue reads work unauthenticated at 60/h — consistent with the read-only no-token requirement.
- **List params**: `state`, `sort` (`created`/`updated`/`comments`), `direction`, `per_page` (≤100), `page` (1-based).

## 6. Repo conventions and plugin discovery

- **Profile composition** — `dsh/packages/boot/app-boot/src/profile.ts`: a profile dir under `$DSH_HOME/profiles/<name>` holds `package.json` (`dsh.profile.bundles`) + its own `cordis.patch.yml`; a **bundle** is a package declaring `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` (doc 8–14). `bundlePatchFiles` (58) / `bundlePatchPaths` (73) read `dsh.bundle.patch`; `loadProfileDirectory` (655) stacks each selected bundle's patch layer in `dsh.profile.bundles` order; `composeEntries` (731) runs `applyEntryPatches` (from `@deepseek-ai/cordis-plugin-include`) into the effective entry list.
- **Client half loading** — `dsh/packages/client/web/src/boot-client.ts`: `ctx.plugin(Loader)`, `loader.internal = modules`, one `loader.create({name})` per manifest `plugins` row, `loader.await()`, `assertEntriesActive`; each client package is a dynamic bundle whose banner is `window.__ModuleLoader__.load({ id: PLUGIN_ID, ... })` (`packages/dsh-model-settings/tsdown.config.ts`), served as `lib/client.js`.
- **What a new `packages/<name>/` plugin declares:** `package.json` `dsh.bundle.patch` + `dsh.client = { inject: [...], platform: "web" }` (a `./client` export is required; `inject` edges are informational only); `cordis.patch.yml` with `- insert: [{ id, name: '<package>' }]`; a host **function plugin** (`name`/`inject`/`Config`/`apply`, no default export); a client `src/client/index.ts` registering into slots/services.
- **Registration convention** — `dsh/packages/AGENTS.md`: every contribution goes through `ctx.effect()`/`ctx.on()`; `register()` returns a disposer. To register into another package's slot: `ctx.slots.inject(name, () => ctx.slots.register(...))`.
- **Discovery for `dsh-ghl`:** the package is a **bundle** — a profile lists it in `dsh.profile.bundles` (or the user inserts the row in their profile's `cordis.patch.yml`); dsh resolves the package, applies its `dsh.bundle.patch` `insert` row, loads the host function plugin through the cordis Loader, and loads the client half as a dynamic `lib/client.js` bundle via `window.__ModuleLoader__`.

### Cross-cutting facts relevant to `dsh-ghl`

- Pinned dsh `0.2.0-rc.2`; host `rpc-host` registers without `webServer` → mount own prefix route via nested `ctx.inject(['webServer'], …)`.
- **A `#` composer trigger requires extending `TriggerChar` (`'/' | '@'`) in `dsh/packages/client/ui-input-trigger/src/types.ts` — this is an UPSTREAM dsh change, not a plugin-only change.** Flagged as a key constraint / open risk.
- Chip `getTextContent()` returns `clipboardText`, never the model form (`chip-node.tsx`); the model form is produced by `codec.serialize` at submit (`facade.ts` `sinkSerialized`) — where issue context text would be injected.
- A status-colored chip border is not a dsh built-in; the current chip only distinguishes valid vs invalid (`ReferenceChip.module.css`).

## 7. Deep-dive: `#` trigger feasibility (blocking question)

Targeted investigation of whether `#` support is plugin-only or requires a dsh-core change.

**Detection is core-owned and hardcoded.** There is no keydown trigger check; the composer re-detects on every editor update via the pure core function `detectTrigger` (`dsh/packages/client/ui-input-trigger/src/core/detect.ts:48–76`). It returns a hit only for `'@'` (delegated to `activeAtToken`, `dsh/packages/context/file-reference/src/grammar.ts:26–35`) or a backward-scanned `'/'` (`detect.ts:64`). For a `#123` draft it returns `null`, so `track()` (`controller.ts:131–145`) closes the menu and a registered `#` source is never consulted (`roster.sources(hit.trigger)` at `controller.ts:165` is reached only after a successful detection).

**`TriggerChar` is type-level only, not runtime-enforced.** `registerSource` (`service.ts:55–60`) does no char validation (only duplicate `(trigger,name)` check); a `trigger:'#'` source (via a cast) registers, is warmed and rostered — but is inert because detection never emits a `#` hit. Space adjudication is dead (`onSpace` needs a detection hit, `controller.ts:321–326`); Enter adjudication is gated to `/`-leading lines by the input machine (`ui-conversation/src/client/input/machine.ts:154`).

**Minimal dsh-core change for `#`:**
- `ui-input-trigger/src/types.ts:34` — widen `TriggerChar` to include `'#'`.
- `ui-input-trigger/src/core/detect.ts:48–76` — add a `#` detection branch (backward scan analogous to the `/` loop 61–74); `boundaryOk` (20–30) needs `#` boundary semantics; guard-tier policy (line 49/65; types.ts:237–240) needs a decision for `#`.
- Type-level union widenings (compile only, no runtime): `ui-conversation/src/client/contract/input.ts:91,101`; `contract/slots.ts:404`; `input/decorations.ts:20,44,52` (note `decorations.ts:24` `TEXT_REF_RE = /(^|\s)([/@])([\w-]+)/g` is a runtime regex for plain-text ref decoration — a `#name` token is not decorated without widening); `input/facade.ts:99,399`; `input/editor/runtime.ts:22`; `apply.ts:81`.
- Optional follow-ups (Enter adjudication / cosmetic): `machine.ts:154`; `apply.ts:247–250,511–512`; `skeleton/InputBar.tsx:308`; `input/editor/text-ref.ts:55`.
- **No change needed for chip rendering** (appearance-driven, `ReferenceInsert.appearance`, `contract/draft-editor.ts:18`) **or serialization** (data-driven through the owner codec, `controller.ts:346–352`).
- Tests pinning current behavior: `ui-input-trigger/tests/core-detect.client.spec.ts`, `ui-input-trigger/tests/service.client.spec.ts`, `ui-conversation/tests/input-scenarios.client.spec.tsx`, `ui-conversation/tests/submit-machine.client.spec.ts:371,392`.

**Plugin-side seam exists and is reachable.** The Cordis service `ctx.inputTriggers` → `InputTriggerService.registerSource` is the sole registration path; external plugins reach it by declaring `'inputTriggers'` in their client `inject` (in-tree examples: `ui-reference/src/client/index.ts:41–44,158`; `ui-commands/src/client/service.ts:113–123`; `ui-skill/src/client/index.ts:227–238`). No separate slot/seat.

**Verdict:**
- (a) Pure plugin (no dsh change): **not feasible** for the `#` popup — detection is core-owned and hardcoded.
- (b) Plugin + a small upstream dsh PR: **feasible** — widen `TriggerChar` + add `#` branch in `detectTrigger` + type widenings; then the plugin registers its `#` source through the existing `ctx.inputTriggers.registerSource` seam.
- (c) Not feasible without a core change: **correct** for the autocomplete popup.

**Repo boundary note:** `dsh/` in this repo is a READ-ONLY symlink to `/home/apkawa/source/deepseek-harness` (separate repo). Any upstream dsh core change for `#` must be made in that separate repo/checkout, not in `dsh-plugins`. The `dsh-ghl` plugin is built here against a dsh that already has `#` support.
